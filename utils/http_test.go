package utils

import (
	"bytes"
	"context"
	"errors"
	"log"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"os"
	"strings"
	"testing"
)

func TestSendHTTPRequest_SSOExpiration(t *testing.T) {
	tests := []struct {
		name          string
		setCookies    []string
		loginURL      string
		expectedError error
	}{
		{
			name:          "No cookies",
			setCookies:    nil,
			expectedError: nil,
		},
		{
			name:          "Other cookie empty",
			setCookies:    []string{"other=; Path=/"},
			expectedError: nil,
		},
		{
			name:          "uid cookie has value",
			setCookies:    []string{"uid=123; Path=/"},
			expectedError: nil,
		},
		{
			name:          "uid cookie empty",
			setCookies:    []string{"uid=; Path=/"},
			expectedError: ErrSSOExpired,
		},
		{
			name:          "prod_cftk cookie empty",
			setCookies:    []string{"prod_cftk=; Path=/"},
			expectedError: ErrSSOExpired,
		},
		{
			name:          "prod_J_SESSION_ID cookie empty",
			setCookies:    []string{"prod_J_SESSION_ID=; Path=/"},
			expectedError: ErrSSOExpired,
		},
		{
			name:          "Multiple cookies with one empty matching SSO",
			setCookies:    []string{"other=abc; Path=/", "prod_cftk=; Path=/"},
			expectedError: ErrSSOExpired,
		},
		{
			name:          "x-login-url header exists",
			setCookies:    nil,
			loginURL:      "http://sso.example.com/login",
			expectedError: ErrSSOExpired,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				for _, sc := range tc.setCookies {
					w.Header().Add("Set-Cookie", sc)
				}
				if tc.loginURL != "" {
					w.Header().Set("x-login-url", tc.loginURL)
				}
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write([]byte(`{"status":"ok"}`))
			}))
			defer server.Close()

			_, err := SendHTTPRequest(
				context.Background(),
				"GET",
				server.URL,
				nil,
				HTTPOptions{},
				[]int{http.StatusOK},
				"TestContext",
			)

			if tc.expectedError != nil {
				if !errors.Is(err, tc.expectedError) {
					t.Errorf("expected error %v, got %v", tc.expectedError, err)
				}
			} else {
				if err != nil {
					t.Errorf("expected no error, got %v", err)
				}
			}
		})
	}
}

func TestLogHTTPErrorDetails(t *testing.T) {
	var logBuf bytes.Buffer
	log.SetOutput(&logBuf)
	defer func() {
		log.SetOutput(os.Stderr)
	}()

	bodyBytes := []byte(`{"hello":"world"}`)
	req, err := http.NewRequest("POST", "http://example.com/api", bytes.NewBuffer(bodyBytes))
	if err != nil {
		t.Fatalf("failed to create request: %v", err)
	}

	LogHTTPErrorDetails("TestContext", req, http.StatusInternalServerError, []byte(`{"error":"internal"}`))

	output := logBuf.String()
	if !strings.Contains(output, "-d '{\"hello\":\"world\"}'") {
		t.Errorf("expected log output to contain request body in curl command, got: %s", output)
	}
}

func TestSendHTTPRequest_HeaderCase(t *testing.T) {
	var rawRequestHeaders string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		dump, err := httputil.DumpRequest(r, false)
		if err == nil {
			rawRequestHeaders = string(dump)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	payload := map[string]interface{}{"key": "val"}
	_, err := SendHTTPRequest(
		context.Background(),
		"POST",
		server.URL,
		payload,
		HTTPOptions{
			Headers: map[string]string{
				"Content-Type": "application/json",
			},
		},
		[]int{http.StatusOK},
		"TestHeaderCase",
	)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// 验证请求报文中 Content-Type 只出现一次（没有重复 Header）
	count := strings.Count(strings.ToLower(rawRequestHeaders), "content-type:")
	if count != 1 {
		t.Errorf("expected exactly 1 'content-type:' header in raw HTTP request, but found %d times:\n%s", count, rawRequestHeaders)
	}
}
