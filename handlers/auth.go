package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	commonAudit "code-common/backend/audit"
	commonAuth "code-common/backend/auth"
	commonModels "code-common/backend/models"

	"code-pipeline/database"
	"code-pipeline/models"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type PortalClaims = commonAuth.PortalClaims

var pipelineOAuth2States *commonAuth.StateStore

func init() {
	pipelineOAuth2States = commonAuth.NewStateStore()
}

func parseToken(tokenString string) (*PortalClaims, error) {
	return commonAuth.ParseToken(tokenString, models.AppConfig.Auth.JWTSecret)
}

// ProvisionPipelineUser SSO 用户自动注册与 Email 优先匹配（供 commonAuth.AuthMiddleware 回调）
func ProvisionPipelineUser(c *gin.Context, claims *commonAuth.PortalClaims, db *gorm.DB) (*models.User, error) {
	var user models.User

	// 只要有 Email，就优先在 code-pipeline 数据库中按 Email 定位本地用户
	if claims.Email != "" {
		_ = db.Where("LOWER(email) = LOWER(?)", claims.Email).First(&user).Error
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
				_ = db.Model(&user).Updates(updates).Error
			}
			return &user, nil
		}
	}

	// 若未找到，自动注册
	user = models.User{
		Email:      claims.Email,
		Username:   claims.Email,
		Name:       claims.Name,
		EmployeeID: claims.EmployeeID,
		IsActive:   true,
		Password:   "SSO_USER_NO_PASSWORD",
	}
	if errCreate := db.Create(&user).Error; errCreate != nil {
		return nil, errCreate
	}
	claims.UserID = user.ID
	return &user, nil
}

// SyncPipelineUser 用户已存在时同步字段
func SyncPipelineUser(c *gin.Context, claims *commonAuth.PortalClaims, user *models.User, db *gorm.DB) {
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
		_ = db.Model(user).Updates(updates).Error
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
		commonAudit.SetAuditContext(c, "auth", "login", commonModels.AuditLevelP2,
			fmt.Sprintf("用户登录失败: 尝试账号 [%s], 用户不存在", identifier),
			"user", "", identifier, nil, nil)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email/username or password"})
		return
	}

	if !user.IsActive {
		commonAudit.SetAuditContext(c, "auth", "login", commonModels.AuditLevelP2,
			fmt.Sprintf("用户登录失败: 尝试账号 [%s], 账号已被禁用", identifier),
			"user", fmt.Sprintf("%d", user.ID), user.Name, nil, nil)
		c.JSON(http.StatusForbidden, gin.H{"error": "Account is inactive"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)); err != nil {
		commonAudit.SetAuditContext(c, "auth", "login", commonModels.AuditLevelP2,
			fmt.Sprintf("用户登录失败: 尝试账号 [%s], 密码错误", identifier),
			"user", fmt.Sprintf("%d", user.ID), user.Name, nil, nil)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email/username or password"})
		return
	}

	tokenString, err := commonAuth.GenerateTokenWithEmployeeID(
		user.ID,
		user.Email,
		user.Email,
		user.Name,
		user.EmployeeID,
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

	displayName := user.Name
	if displayName == "" {
		displayName = user.Email
	}

	commonAuth.SetUserContext(c, &commonAuth.UserContext{
		UserID:   user.ID,
		Username: user.Email,
		Name:     user.Name,
		Email:    user.Email,
		Roles:    user.GetRoles(),
	})

	commonAudit.SetAuditContext(c, "auth", "login", commonModels.AuditLevelP2,
		fmt.Sprintf("用户 [%s] 登录系统成功 (IP: %s)", displayName, c.ClientIP()),
		"user", fmt.Sprintf("%d", user.ID), displayName, nil, nil)

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

	displayName := user.Name
	if displayName == "" {
		displayName = user.Email
	}
	commonAudit.SetAuditContext(c, "auth", "update_password", commonModels.AuditLevelP1,
		fmt.Sprintf("用户 [%s] 修改个人密码成功", displayName),
		"user", fmt.Sprintf("%d", user.ID), displayName, nil, nil)

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

	tokenString, err := commonAuth.GenerateTokenWithEmployeeID(
		user.ID,
		user.Email,
		user.Email,
		user.Name,
		user.EmployeeID,
		user.IsAdmin,
		user.GetRoles(),
		models.AppConfig.Auth.JWTSecret,
		6*time.Hour,
	)
	if err != nil {
		redirectPipelineSSOError(c, "登录凭证生成失败")
		return
	}

	displayName := user.Name
	if displayName == "" {
		displayName = user.Email
	}

	commonAuth.SetUserContext(c, &commonAuth.UserContext{
		UserID:   user.ID,
		Username: user.Email,
		Name:     user.Name,
		Email:    user.Email,
		Roles:    user.GetRoles(),
	})

	commonAudit.SetAuditContext(c, "auth", "sso_login", commonModels.AuditLevelP2,
		fmt.Sprintf("用户 [%s] SSO单点登录系统成功 (IP: %s)", displayName, c.ClientIP()),
		"user", fmt.Sprintf("%d", user.ID), displayName, nil, nil)

	redirectTarget := "/?token=" + url.QueryEscape(tokenString)
	c.Redirect(http.StatusFound, redirectTarget)
}

func redirectPipelineSSOError(c *gin.Context, errorMsg string) {
	loginURL := "/login?sso_error=" + url.QueryEscape(errorMsg)
	c.Redirect(http.StatusFound, loginURL)
}
