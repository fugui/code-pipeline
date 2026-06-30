package handlers

import (
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
)

type PortalClaims struct {
	UserID  uint   `json:"user_id"`
	Email   string `json:"email"`
	Name    string `json:"name"`
	IsAdmin bool   `json:"is_admin"`
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

		// 如果是从 SSO 传入的字符串唯一 ID，尝试按 Email 关联定位真正的自增 uint ID
		if claims.SSOUserID != "" && claims.UserID == 0 && claims.Email != "" {
			_ = database.DB.Where("email = ?", claims.Email).First(&user).Error
			if user.ID != 0 {
				claims.UserID = user.ID
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
				Email:    claims.Email,
				Name:     claims.Name,
				IsAdmin:  claims.IsAdmin,
				IsActive: true,
				Password: "SSO_USER_NO_PASSWORD",
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
		c.Set("isAdmin", user.IsAdmin)
		c.Next()
	}
}

func AdminMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		isAdmin, exists := c.Get("isAdmin")
		if !exists || !isAdmin.(bool) {
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
	expirationTime := time.Now().Add(24 * time.Hour)
	claims := &PortalClaims{
		UserID:  user.ID,
		Email:   user.Email,
		Name:    user.Name,
		IsAdmin: user.IsAdmin,
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
			"id":       user.ID,
			"email":    user.Email,
			"name":     user.Name,
			"is_admin": user.IsAdmin,
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
	c.JSON(http.StatusOK, gin.H{
		"id":       user.ID,
		"email":    user.Email,
		"name":     user.Name,
		"is_admin": user.IsAdmin,
	})
}
