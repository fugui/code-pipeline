package services

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"code-pipeline/models"
	"code-pipeline/utils"
)

// APIGTokenResponse 定义获取 Token 的接口返回数据结构
type APIGTokenResponse struct {
	Status string `json:"status"`
	Result struct {
		Token string `json:"token"`
	} `json:"result"`
}

// TokenManager 统一管理 APIG Token 的获取、内存缓存与并发自动刷新
type TokenManager struct {
	mu        sync.RWMutex
	token     string
	expiresAt time.Time
}

var globalTokenManager = &TokenManager{}

// ResetTokenCache 清除内存中缓存的 Token（主要用于测试或强制重刷新）
func (tm *TokenManager) ResetTokenCache() {
	tm.mu.Lock()
	defer tm.mu.Unlock()
	tm.token = ""
	tm.expiresAt = time.Time{}
}

// GetToken 获取或自动刷新 Token（缓存 1 小时，提前 5 分钟自动刷新）
func (tm *TokenManager) GetToken(ctx context.Context) (string, error) {
	tm.mu.RLock()
	now := time.Now()
	// 若缓存存在且在有效期（提前 5 分钟刷新）内，则直接使用
	if tm.token != "" && now.Add(5*time.Minute).Before(tm.expiresAt) {
		token := tm.token
		tm.mu.RUnlock()
		return token, nil
	}
	tm.mu.RUnlock()

	// 加写锁进行重刷新（Double Check）
	tm.mu.Lock()
	defer tm.mu.Unlock()

	if tm.token != "" && now.Add(5*time.Minute).Before(tm.expiresAt) {
		return tm.token, nil
	}

	apigCfg := models.AppConfig.PipelineSystem.APIG
	if apigCfg.TokenURL == "" {
		return "", fmt.Errorf("apig.token_url is not configured")
	}

	payload := map[string]interface{}{
		"account":  apigCfg.TokenAccount,
		"password": apigCfg.TokenPassword,
	}

	reqHeaders := map[string]string{
		"Content-Type": "application/json",
	}
	for k, v := range apigCfg.TokenHeaders {
		reqHeaders[k] = v
	}

	respBytes, err := utils.SendHTTPRequest(
		ctx,
		"POST",
		apigCfg.TokenURL,
		payload,
		utils.HTTPOptions{Headers: reqHeaders},
		[]int{http.StatusOK},
		"APIGFetchToken",
	)
	if err != nil {
		log.Printf("[TokenManager] Failed to fetch APIG Token from %s: %v", apigCfg.TokenURL, err)
		return "", fmt.Errorf("failed to fetch token: %w", err)
	}

	var resp APIGTokenResponse
	if err := json.Unmarshal(respBytes, &resp); err != nil {
		log.Printf("[TokenManager] Failed to unmarshal token response: %v, raw: %s", err, string(respBytes))
		return "", fmt.Errorf("invalid token response format: %w", err)
	}

	if resp.Status != "ok" || resp.Result.Token == "" {
		log.Printf("[TokenManager] Token API returned non-ok status or empty token: status=%s, resp=%s", resp.Status, string(respBytes))
		return "", fmt.Errorf("failed to obtain token: status=%s", resp.Status)
	}

	tm.token = resp.Result.Token
	// 默认设置 1 小时缓存
	tm.expiresAt = time.Now().Add(1 * time.Hour)

	log.Printf("[TokenManager] Successfully refreshed APIG token, valid until %s", tm.expiresAt.Format(time.RFC3339))
	return tm.token, nil
}

// GetAPIGHeaders 获取 APIG 三方业务请求所需的完整 Header
func GetAPIGHeaders(ctx context.Context) (map[string]string, error) {
	token, err := globalTokenManager.GetToken(ctx)
	if err != nil {
		return nil, err
	}

	headers := map[string]string{
		"x-auth-token": token,
		"Content-Type": "application/json",
	}

	// 合并 service_headers 中配置的全局静态 Header
	for k, v := range models.AppConfig.PipelineSystem.APIG.ServiceHeaders {
		headers[k] = v
	}

	return headers, nil
}
