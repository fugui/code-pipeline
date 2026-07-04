package handlers

import (
	"errors"
	"net/http"

	"code-pipeline/utils"

	"github.com/gin-gonic/gin"
)

// prepareRequestHeaders 透传 Cookie, cftk 和 x-requested-with Header
func prepareRequestHeaders(c *gin.Context) map[string]string {
	headers := make(map[string]string)
	if cookie := c.GetHeader("Cookie"); cookie != "" {
		headers["Cookie"] = cookie
	}
	cftk := c.GetHeader("cftk")
	if cftk == "" {
		cftk, _ = c.Cookie("prod_cftk")
	}
	if cftk != "" {
		headers["cftk"] = cftk
	}
	headers["x-requested-with"] = "XMLHttpRequest"
	return headers
}

// HandleSSOExpired 统一拦截底层返回的 SSO 过期错误，若为过期则向浏览器清除 uid、prod_cftk 与 prod_J_SESSION_ID Cookie 并返回 401 响应
func HandleSSOExpired(c *gin.Context, err error) bool {
	if errors.Is(err, utils.ErrSSOExpired) {
		c.Writer.Header().Add("Set-Cookie", "uid=; Path=/; Max-Age=0")
		c.Writer.Header().Add("Set-Cookie", "prod_cftk=; Path=/; Max-Age=0")
		c.Writer.Header().Add("Set-Cookie", "prod_J_SESSION_ID=; Path=/; Max-Age=0")
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "SSO session expired, please login again",
			"code":  "SSO_EXPIRED",
		})
		return true
	}
	return false
}
