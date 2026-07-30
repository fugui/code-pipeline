package utils

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"
)

// ErrSSOExpired 定义 SSO 过期错误
var ErrSSOExpired = errors.New("SSO session expired")

// HTTPOptions 定义 HTTP 请求的附加参数
type HTTPOptions struct {
	Headers     map[string]string
	QueryParams map[string]string
}

// LogHTTPErrorDetails 打印详细的 HTTP 错误日志，包括等价的 curl 调试命令及三方返回的原始报文
func LogHTTPErrorDetails(contextMsg string, req *http.Request, statusCode int, respBody []byte) {
	var curlHeaders []string
	for name, values := range req.Header {
		for _, value := range values {
			escapedValue := strings.ReplaceAll(value, "'", "'\\''")
			curlHeaders = append(curlHeaders, fmt.Sprintf("-H '%s: %s'", name, escapedValue))
		}
	}

	var bodyStr string
	if req.GetBody != nil {
		bodyReadCloser, err := req.GetBody()
		if err == nil {
			bodyBytes, err := io.ReadAll(bodyReadCloser)
			if err == nil {
				bodyStr = string(bodyBytes)
			}
			bodyReadCloser.Close()
		}
	}

	curlCmd := fmt.Sprintf("curl -X %s '%s' %s", req.Method, req.URL.String(), strings.Join(curlHeaders, " "))
	if bodyStr != "" {
		escapedBody := strings.ReplaceAll(bodyStr, "'", "'\\''")
		curlCmd = fmt.Sprintf("%s -d '%s'", curlCmd, escapedBody)
	}

	log.Printf("[%s] Curl Command:\n%s\n", contextMsg, curlCmd)
	log.Printf("[%s] Remote server returned status %d. Response Body: %s\n", contextMsg, statusCode, string(respBody))
}

// SendHTTPRequest 封装统一的 HTTP 请求发送与错误处理逻辑
func SendHTTPRequest(ctx context.Context, method, rawURL string, payload interface{}, opt HTTPOptions, expectedStatuses []int, contextMsg string) ([]byte, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse URL %s: %v", rawURL, err)
	}

	if len(opt.QueryParams) > 0 {
		q := u.Query()
		for k, v := range opt.QueryParams {
			q.Set(k, v)
		}
		u.RawQuery = q.Encode()
	}

	var bodyReader io.Reader
	if payload != nil {
		jsonBytes, err := json.Marshal(payload)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal request payload: %v", err)
		}
		bodyReader = bytes.NewBuffer(jsonBytes)
	}

	req, err := http.NewRequestWithContext(ctx, method, u.String(), bodyReader)
	if err != nil {
		return nil, fmt.Errorf("failed to create HTTP request: %v", err)
	}

	req.Header = make(http.Header)
	if payload != nil {
		req.Header["content-type"] = []string{"application/json"}
	}

	for k, v := range opt.Headers {
		if strings.EqualFold(k, "host") {
			req.Host = v
			req.Header["Host"] = []string{v}
		} else {
			req.Header[strings.ToLower(k)] = []string{v}
		}
	}

	if len(req.Header["accept"]) == 0 {
		req.Header["accept"] = []string{"application/json, text/plain, */*"}
	}

	tr := &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}
	client := &http.Client{
		Timeout:   5 * time.Second,
		Transport: tr,
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to execute remote request: %v", err)
	}
	defer resp.Body.Close()

	// 检查是否返回了 set-cookie: uid/prod_cftk/prod_J_SESSION_ID 为空; 代表 SSO 过期
	for _, cookie := range resp.Cookies() {
		if slices.Contains([]string{"uid", "prod_cftk", "prod_J_SESSION_ID"}, cookie.Name) && cookie.Value == "" {
			return nil, ErrSSOExpired
		}
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %v", err)
	}

	isExpected := false
	for _, status := range expectedStatuses {
		if resp.StatusCode == status {
			isExpected = true
			break
		}
	}

	if !isExpected {
		LogHTTPErrorDetails(contextMsg, req, resp.StatusCode, body)
		return nil, fmt.Errorf("remote API returned status code %d", resp.StatusCode)
	}

	// 临时把非 GET 请求打印出来， 调试一下代码
	if strings.ToUpper(req.Method) != "GET" {
		LogHTTPErrorDetails(contextMsg, req, resp.StatusCode, body)
	}
	return body, nil
}
