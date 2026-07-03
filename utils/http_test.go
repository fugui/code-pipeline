package utils

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSendHTTPRequest_SSOExpiration(t *testing.T) {
	tests := []struct {
		name          string
		setCookies    []string
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
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				for _, sc := range tc.setCookies {
					w.Header().Add("Set-Cookie", sc)
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
