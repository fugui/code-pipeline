package services

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"code-pipeline/models"
)

func TestTokenManager_GetTokenAndHeaders(t *testing.T) {
	requestCount := 0
	receivedHeaders := make(http.Header)

	// 创建 Mock HTTP Server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		receivedHeaders = r.Header.Clone()

		var reqBody map[string]string
		_ = json.NewDecoder(r.Body).Decode(&reqBody)

		if reqBody["account"] != "test_account" || reqBody["password"] != "test_password" {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"status":"error"}`))
			return
		}

		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok","result":{"token":"mock_apig_token_123456"}}`))
	}))
	defer server.Close()

	// 配置 APIG 参数
	models.AppConfig.PipelineSystem.EnableAPIGAuth = true
	models.AppConfig.PipelineSystem.APIG = models.APIGConfig{
		TokenURL:      server.URL,
		TokenAccount:  "test_account",
		TokenPassword: "test_password",
		TokenHeaders: map[string]string{
			"x-apig-appcode": "test_appcode_999",
		},
		MRBindingURL: "http://192.168.56.18:9080/api/v1/apig/mr-bindings",
		ServiceHeaders: map[string]string{
			"X-Custom-Client": "TestClient",
		},
	}

	// 清设缓存
	globalTokenManager.ResetTokenCache()

	ctx := context.Background()

	// 1. 首次获取 Token，应该触发 HTTP 请求
	headers, err := GetAPIGHeaders(ctx)
	if err != nil {
		t.Fatalf("GetAPIGHeaders failed: %v", err)
	}

	if requestCount != 1 {
		t.Errorf("Expected 1 HTTP request to token URL, got %d", requestCount)
	}

	// 验证请求 Token 时发送的 Header
	if gotAppCode := receivedHeaders.Get("x-apig-appcode"); gotAppCode != "test_appcode_999" {
		t.Errorf("Expected x-apig-appcode 'test_appcode_999', got '%s'", gotAppCode)
	}

	// 验证 GetAPIGHeaders 返回的业务 Header
	if headers["x-auth-token"] != "mock_apig_token_123456" {
		t.Errorf("Expected x-auth-token 'mock_apig_token_123456', got '%s'", headers["x-auth-token"])
	}
	if headers["X-Custom-Client"] != "TestClient" {
		t.Errorf("Expected X-Custom-Client 'TestClient', got '%s'", headers["X-Custom-Client"])
	}
	if _, exists := headers["x-requested-with"]; exists {
		t.Errorf("x-requested-with should not be present in APIG headers")
	}

	// 2. 第二次获取，应该命中缓存，requestCount 不应该增加
	headers2, err := GetAPIGHeaders(ctx)
	if err != nil {
		t.Fatalf("GetAPIGHeaders (cached) failed: %v", err)
	}

	if requestCount != 1 {
		t.Errorf("Expected requestCount to stay 1 due to cache, got %d", requestCount)
	}
	if headers2["x-auth-token"] != "mock_apig_token_123456" {
		t.Errorf("Expected cached token 'mock_apig_token_123456', got '%s'", headers2["x-auth-token"])
	}
}

func TestTokenManager_Concurrency(t *testing.T) {
	requestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(10 * time.Millisecond) // 模拟网络延迟
		requestCount++
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok","result":{"token":"concurrent_token"}}`))
	}))
	defer server.Close()

	models.AppConfig.PipelineSystem.APIG = models.APIGConfig{
		TokenURL:      server.URL,
		TokenAccount:  "test_account",
		TokenPassword: "test_password",
	}

	globalTokenManager.ResetTokenCache()
	ctx := context.Background()

	// 并发 10 个 goroutine
	done := make(chan bool)
	for i := 0; i < 10; i++ {
		go func() {
			tok, err := globalTokenManager.GetToken(ctx)
			if err != nil || tok != "concurrent_token" {
				t.Errorf("Concurrent GetToken failed: err=%v, tok=%s", err, tok)
			}
			done <- true
		}()
	}

	for i := 0; i < 10; i++ {
		<-done
	}

	if requestCount != 1 {
		t.Errorf("Expected only 1 HTTP request under concurrency, got %d", requestCount)
	}
}
