package handlers

import (
	commonAuth "code-common/backend/auth"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"code-pipeline/database"
	"code-pipeline/models"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

type PortalClaims = commonAuth.PortalClaims

var pipelineOAuth2States *commonAuth.StateStore

func init() {
	pipelineOAuth2States = commonAuth.NewStateStore()
}

func parseToken(tokenString string) (*PortalClaims, error) {
	return commonAuth.ParseToken(tokenString, models.AppConfig.Auth.JWTSecret)
}

func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		tokenString := commonAuth.ExtractToken(c)
		if tokenString == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization header or token missing"})
			c.Abort()
			return
		}

		claims, err := parseToken(tokenString)
		if err != nil {
			log.Printf("[Auth] JWT validation failed: %v", err)
			c.JSON(http.StatusUnauthorized, gin.H{"error": fmt.Sprintf("Invalid token signature: %v", err)})
			c.Abort()
			return
		}

		// 从数据库中查找对应用户
		var user models.User
		var findErr error

		// 只要有 Email，就应该优先在 code-pipeline 数据库中按 Email 定位本地自增 uint ID。
		if claims.Email != "" {
			_ = database.DB.Where("LOWER(email) = LOWER(?)", claims.Email).First(&user).Error
			if user.ID != 0 {
				claims.UserID = user.ID
				updates := map[string]interface{}{}
				if claims.Name != "" && user.Name != claims.Name {
					updates["name"] = claims.Name
					user.Name = claims.Name
				}
				if claims.EmployeeID != "" && user.EmployeeID != claims.EmployeeID {
					updates["employee_id"] = claims.EmployeeID
					user.EmployeeID = claims.EmployeeID
				}
				if len(updates) > 0 {
					_ = database.DB.Model(&user).Updates(updates).Error
				}
			}
		}

		if claims.UserID != 0 && user.ID == 0 {
			findErr = database.DB.First(&user, claims.UserID).Error
		} else if user.ID == 0 {
			findErr = fmt.Errorf("user not found by email or userID")
		}

		if findErr != nil {
			// 如果是合法的 SSO 用户但在本系统尚不存在，自动注册
			user = models.User{
				Email:      claims.Email,
				Username:   claims.Email,
				Name:       claims.Name,
				EmployeeID: claims.EmployeeID,
				IsActive:   true,
				Password:   "SSO_USER_NO_PASSWORD",
			}
			if errCreate := database.DB.Create(&user).Error; errCreate != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to auto-register SSO user"})
				c.Abort()
				return
			}
			// 自动注册成功后回填用户自增的 ID
			claims.UserID = user.ID
		}

		if !user.IsActive {
			c.JSON(http.StatusForbidden, gin.H{"error": "User account is inactive"})
			c.Abort()
			return
		}

		effectiveRoles := claims.Roles
		if user.ID != 0 {
			dbRoles := user.GetRoles()
			if len(dbRoles) > 0 {
				effectiveRoles = dbRoles
			}
		}

		c.Set("userID", user.ID)
		c.Set("email", user.Email)
		c.Set("username", user.Email)
		c.Set("roles", effectiveRoles)
		c.Set("user", user)
		c.Set("employeeID", user.EmployeeID)

		ctx := context.WithValue(c.Request.Context(), "employeeID", user.EmployeeID)
		c.Request = c.Request.WithContext(ctx)

		c.Next()
	}
}

func AdminMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		rolesVal, rolesExists := c.Get("roles")
		hasRole := false
		if rolesExists {
			if roles, ok := rolesVal.([]string); ok {
				for _, r := range roles {
					if r == "super_admin" || r == "pipeline_admin" {
						hasRole = true
						break
					}
				}
			}
		}

		userVal, userExists := c.Get("user")
		if userExists {
			if user, ok := userVal.(models.User); ok && user.HasRole("pipeline_admin") {
				hasRole = true
			}
		}

		if !hasRole {
			c.JSON(http.StatusForbidden, gin.H{"error": "Admin privilege required"})
			c.Abort()
			return
		}
		c.Next()
	}
}

func GetAuthConfig(c *gin.Context) {
	authCfg := models.AppConfig.Auth
	passwordEnabled := authCfg.StandaloneMode || authCfg.PasswordLoginEnabled
	oauth2Enabled := authCfg.OAuth2.Enabled

	c.JSON(http.StatusOK, gin.H{
		"oauth2_enabled":         oauth2Enabled,
		"password_login_enabled": passwordEnabled,
		"dept_api_url":           authCfg.OAuth2.DeptAPIURL,
	})
}

type LoginRequest struct {
	Email    string `json:"email"`
	Username string `json:"username"`
	Password string `json:"password" binding:"required"`
}

func Login(c *gin.Context) {
	authCfg := models.AppConfig.Auth
	if !authCfg.StandaloneMode && !authCfg.PasswordLoginEnabled {
		c.JSON(http.StatusForbidden, gin.H{"error": "本地直接登录已停用，请使用主门户登录。"})
		return
	}

	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid login request format"})
		return
	}

	identifier := strings.ToLower(strings.TrimSpace(req.Email))
	if identifier == "" {
		identifier = strings.ToLower(strings.TrimSpace(req.Username))
	}
	if identifier == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Email or Username is required"})
		return
	}

	var user models.User
	if err := database.DB.Where("LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?)", identifier, identifier).First(&user).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email/username or password"})
		return
	}

	if !user.IsActive {
		c.JSON(http.StatusForbidden, gin.H{"error": "Account is inactive"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email/username or password"})
		return
	}

	tokenString, err := commonAuth.GenerateToken(
		user.ID,
		user.Email,
		user.Email,
		user.Name,
		user.IsAdmin,
		user.GetRoles(),
		models.AppConfig.Auth.JWTSecret,
		6*time.Hour,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate auth token"})
		return
	}

	now := time.Now()
	user.LastLogin = &now
	user.LastIP = c.ClientIP()
	database.DB.Save(&user)

	c.JSON(http.StatusOK, gin.H{
		"token": tokenString,
		"user": gin.H{
			"id":    user.ID,
			"email": user.Email,
			"name":  user.Name,
			"roles": user.GetRoles(),
		},
	})
}

func UpdatePassword(c *gin.Context) {
	authCfg := models.AppConfig.Auth
	if !authCfg.StandaloneMode && !authCfg.PasswordLoginEnabled {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请在 CodeBench 主控制台修改您的密码！"})
		return
	}

	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User ID missing"})
		return
	}

	var req struct {
		OldPassword string `json:"old_password" binding:"required"`
		NewPassword string `json:"new_password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var user models.User
	if err := database.DB.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.OldPassword)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "当前密码不正确"})
		return
	}

	hashed, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
		return
	}

	if err := database.DB.Model(&user).Update("password", string(hashed)).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update password"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "密码修改成功"})
}

func GetMe(c *gin.Context) {
	userID, _ := c.Get("userID")
	var user models.User
	if err := database.DB.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}
	var roles []string
	if len(user.Roles) > 0 {
		_ = json.Unmarshal(user.Roles, &roles)
	}
	c.JSON(http.StatusOK, gin.H{
		"id":    user.ID,
		"email": user.Email,
		"name":  user.Name,
		"roles": roles,
	})
}

func StartOAuth2Flow(c *gin.Context) {
	oauth2Cfg := models.AppConfig.Auth.OAuth2
	if !oauth2Cfg.Enabled {
		c.JSON(http.StatusNotFound, gin.H{"error": "OAuth2 SSO is not enabled"})
		return
	}

	state, _, codeChallenge, err := pipelineOAuth2States.GenerateState()
	if err != nil {
		log.Printf("[OAuth2] Failed to generate state: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to initiate SSO login"})
		return
	}

	params := url.Values{
		"response_type":         {"code"},
		"client_id":             {oauth2Cfg.ClientID},
		"redirect_uri":          {oauth2Cfg.RedirectURL},
		"scope":                 {strings.Join(oauth2Cfg.Scopes, " ")},
		"state":                 {state},
		"code_challenge":        {codeChallenge},
		"code_challenge_method": {"S256"},
	}

	authURL := oauth2Cfg.AuthURL + "?" + params.Encode()
	c.Redirect(http.StatusFound, authURL)
}

func OAuth2Callback(c *gin.Context) {
	oauth2Cfg := models.AppConfig.Auth.OAuth2
	if !oauth2Cfg.Enabled {
		c.JSON(http.StatusNotFound, gin.H{"error": "OAuth2 SSO is not enabled"})
		return
	}

	if errMsg := c.Query("error"); errMsg != "" {
		errDesc := c.Query("error_description")
		log.Printf("[OAuth2] IdP returned error: %s - %s", errMsg, errDesc)
		redirectPipelineSSOError(c, "SSO 登录失败: "+errDesc)
		return
	}

	code := c.Query("code")
	state := c.Query("state")
	if code == "" || state == "" {
		redirectPipelineSSOError(c, "SSO 回调参数缺失")
		return
	}

	codeVerifier, ok := pipelineOAuth2States.ValidateAndConsume(state)
	if !ok {
		redirectPipelineSSOError(c, "SSO 登录超时或状态无效，请重试")
		return
	}

	tokenData, err := commonAuth.ExchangeCodeForToken(oauth2Cfg, code, codeVerifier)
	if err != nil {
		log.Printf("[OAuth2] Token exchange failed: %v", err)
		redirectPipelineSSOError(c, "SSO Token 交换失败")
		return
	}

	accessToken, _ := tokenData["access_token"].(string)
	if accessToken == "" {
		redirectPipelineSSOError(c, "SSO 未返回有效的 access_token")
		return
	}

	userInfo, err := commonAuth.FetchUserInfo(oauth2Cfg.UserInfoURL, oauth2Cfg.ClientID, oauth2Cfg.Scopes, accessToken)
	if err != nil {
		log.Printf("[OAuth2] UserInfo fetch failed: %v", err)
		redirectPipelineSSOError(c, "SSO 用户信息获取失败")
		return
	}

	mapping := oauth2Cfg.FieldMapping
	email := strings.ToLower(strings.TrimSpace(commonAuth.GetStringField(userInfo, mapping.Email)))
	rawUsername := commonAuth.GetStringField(userInfo, mapping.Username)
	name := commonAuth.ParseSSOAttribute(rawUsername)
	if customName := commonAuth.GetStringField(userInfo, mapping.Name); customName != "" {
		name = customName
	}
	employeeID := strings.TrimSpace(commonAuth.GetStringField(userInfo, mapping.EmployeeID))

	if email == "" {
		email = strings.ToLower(strings.TrimSpace(commonAuth.ParseSSOEnglishName(rawUsername)))
	}
	if email == "" {
		redirectPipelineSSOError(c, "SSO 未返回用户邮箱或标识信息")
		return
	}

	if !commonAuth.IsEmailDomainAllowed(email, oauth2Cfg.AllowedEmailDomains) {
		var count int64
		if err := database.DB.Model(&models.User{}).Where("LOWER(email) = LOWER(?)", email).Count(&count).Error; err != nil || count == 0 {
			redirectPipelineSSOError(c, "邮箱域名未被允许，请联系系统管理员")
			return
		}
	}

	isAdmin := false
	for _, adminEmail := range oauth2Cfg.AdminList {
		if strings.EqualFold(strings.TrimSpace(adminEmail), strings.TrimSpace(email)) {
			isAdmin = true
			break
		}
	}

	var user models.User
	if err := database.DB.Where("LOWER(email) = LOWER(?)", email).First(&user).Error; err != nil {
		var initialRoles []byte
		if isAdmin {
			initialRoles, _ = json.Marshal([]string{"super_admin", "pipeline_admin"})
		}
		user = models.User{
			Email:      email,
			Username:   email,
			Name:       name,
			EmployeeID: employeeID,
			IsActive:   true,
			Roles:      initialRoles,
			Password:   "SSO_USER_NO_PASSWORD",
		}
		if err := database.DB.Create(&user).Error; err != nil {
			log.Printf("[OAuth2] Auto register pipeline user failed: %v", err)
			redirectPipelineSSOError(c, "SSO 用户自动创建失败")
			return
		}
	}

	now := time.Now()
	user.LastLogin = &now
	user.LastIP = c.ClientIP()
	database.DB.Save(&user)

	tokenString, err := commonAuth.GenerateToken(
		user.ID,
		user.Email,
		user.Email,
		user.Name,
		user.IsAdmin,
		user.GetRoles(),
		models.AppConfig.Auth.JWTSecret,
		6*time.Hour,
	)
	if err != nil {
		redirectPipelineSSOError(c, "登录凭证生成失败")
		return
	}

	redirectTarget := "/?token=" + url.QueryEscape(tokenString)
	c.Redirect(http.StatusFound, redirectTarget)
}

func redirectPipelineSSOError(c *gin.Context, errorMsg string) {
	loginURL := "/login?sso_error=" + url.QueryEscape(errorMsg)
	c.Redirect(http.StatusFound, loginURL)
}
