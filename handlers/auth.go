package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"code-pipeline/database"
	"code-pipeline/models"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/datatypes"
)

type PortalClaims struct {
	UserID     uint     `json:"user_id"`
	Email      string   `json:"email"`
	Name       string   `json:"name"`
	EmployeeID string   `json:"employee_id"`
	Roles      []string `json:"roles"`
	jwt.RegisteredClaims
	SSOUserID string `json:"-"`
}

func (c *PortalClaims) UnmarshalJSON(data []byte) error {
	type Alias PortalClaims
	aux := &struct {
		UserID interface{} `json:"user_id"`
		*Alias
	}{
		Alias: (*Alias)(c),
	}
	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}

	if aux.UserID != nil {
		switch v := aux.UserID.(type) {
		case float64:
			c.UserID = uint(v)
		case string:
			c.SSOUserID = v
		}
	}
	return nil
}

func parseToken(tokenString string) (*PortalClaims, error) {
	secret := []byte(models.AppConfig.Auth.JWTSecret)
	claims := &PortalClaims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return secret, nil
	})
	if err != nil {
		return nil, err
	}
	if !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}
	return claims, nil
}

func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		tokenString := c.GetHeader("Authorization")
		if tokenString == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization header missing"})
			c.Abort()
			return
		}

		if len(tokenString) > 7 && tokenString[:7] == "Bearer " {
			tokenString = tokenString[7:]
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
		// 这是因为不同微服务系统的自增 ID 是独立的，需要通过全局唯一的 Email 字段来进行分布式映射。
		if claims.Email != "" {
			_ = database.DB.Where("email = ?", claims.Email).First(&user).Error
			if user.ID != 0 {
				claims.UserID = user.ID
				rolesJSON, _ := json.Marshal(claims.Roles)
				if user.Name != claims.Name || user.EmployeeID != claims.EmployeeID || string(user.Roles) != string(rolesJSON) {
					user.Name = claims.Name
					user.EmployeeID = claims.EmployeeID
					user.Roles = datatypes.JSON(rolesJSON)
					_ = database.DB.Save(&user).Error
				}
			}
		}

		if claims.UserID != 0 {
			findErr = database.DB.First(&user, claims.UserID).Error
		} else {
			findErr = fmt.Errorf("user not found by email or userID")
		}

		if findErr != nil {
			// 如果是合法的 SSO 用户但在本系统尚不存在，自动注册
			user = models.User{
				Email:      claims.Email,
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

		c.Set("userID", user.ID)
		c.Set("email", user.Email)
		c.Set("roles", claims.Roles)
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

type LoginRequest struct {
	Email    string `json:"email" binding:"required"`
	Password string `json:"password" binding:"required"`
}

func Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid login request format"})
		return
	}

	var user models.User
	if err := database.DB.Where("email = ?", req.Email).First(&user).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email or password"})
		return
	}

	if !user.IsActive {
		c.JSON(http.StatusForbidden, gin.H{"error": "Account is inactive"})
		return
	}

	// 密码对比
	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email or password"})
		return
	}

	// 生成 JWT
	expirationTime := time.Now().Add(6 * time.Hour)
	claims := &PortalClaims{
		UserID: user.ID,
		Email:  user.Email,
		Name:   user.Name,
		Roles:  user.GetRoles(),
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expirationTime),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString([]byte(models.AppConfig.Auth.JWTSecret))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate auth token"})
		return
	}

	// 记录登录 IP 与时间
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
