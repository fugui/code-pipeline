package services

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"code-pipeline/models"
)

func TestExtractRepoName(t *testing.T) {
	testCases := []struct {
		url      string
		expected string
	}{
		{"https://github.com/username/project.git", "project"},
		{"git@github.com:username/project.git", "project"},
		{"/path/to/local/project.git", "project"},
		{"/path/to/local/project", "project"},
		{"git@github.com:project", "project"},
		{"https://github.com/username/project", "project"},
		{"project.git", "project"},
		{"project", "project"},
		{"", "repo"},
	}

	for _, tc := range testCases {
		result := extractRepoName(tc.url)
		if result != tc.expected {
			t.Errorf("extractRepoName(%q) = %q, expected %q", tc.url, result, tc.expected)
		}
	}
}

func TestUpdateCheckerTaskRemote(t *testing.T) {
	// Setup mock server
	var checkReceivedMethod string
	var checkReceivedURL string
	var copyReceivedMethod string
	var copyReceivedBody []byte
	var copyReceivedHeaders http.Header

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			checkReceivedMethod = r.Method
			checkReceivedURL = r.URL.String()
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"status": "success", "count": "1"}`))
			return
		}

		if r.Method == "POST" {
			copyReceivedMethod = r.Method
			copyReceivedHeaders = r.Header
			body, err := io.ReadAll(r.Body)
			if err == nil {
				copyReceivedBody = body
			}
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"status": "success"}`))
			return
		}

		w.WriteHeader(http.StatusBadRequest)
	}))
	defer server.Close()

	// Configure app config to use mock server
	models.AppConfig.PipelineSystem.RepoAuthCheckURL = server.URL
	models.AppConfig.PipelineSystem.CopyCheckerTaskURL = server.URL
	models.AppConfig.PipelineSystem.CheckerTaskTemplateID = "template-12345"

	ctx := context.Background()
	repository := "git@github.com:my-org/my-target-repo.git"
	branch := "feature/cool-stuff"
	languages := "Go,Python"
	customAttributes := `{"existing_key": "existing_value"}`
	headers := map[string]string{
		"Authorization": "Bearer some-token",
		"X-Custom-Req":  "true",
	}

	taskID, updatedAttrs, err := UpdateCheckerTaskRemote(ctx, repository, branch, languages, customAttributes, headers)
	if err != nil {
		t.Fatalf("UpdateCheckerTaskRemote failed: %v", err)
	}

	if taskID == "" {
		t.Error("Expected taskID to be non-empty")
	}

	// Verify Check Repo Auth API properties
	if checkReceivedMethod != "GET" {
		t.Errorf("Expected GET request for auth check, got %q", checkReceivedMethod)
	}
	if !strings.Contains(checkReceivedURL, "fuzzyMatch=git%40github.com%3Amy-org%2Fmy-target-repo.git") {
		t.Errorf("Expected URL to contain fuzzyMatch param, got %q", checkReceivedURL)
	}

	// Verify Copy Task HTTP Request properties
	if copyReceivedMethod != "POST" {
		t.Errorf("Expected POST request, got %q", copyReceivedMethod)
	}

	if copyReceivedHeaders.Get("Content-Type") != "application/json" {
		t.Errorf("Expected Content-Type 'application/json', got %q", copyReceivedHeaders.Get("Content-Type"))
	}

	if copyReceivedHeaders.Get("Authorization") != "Bearer some-token" {
		t.Errorf("Expected Authorization header, got %q", copyReceivedHeaders.Get("Authorization"))
	}

	// Verify POST payload JSON structure
	var payload struct {
		ID              string `json:"id"`
		Name            string `json:"name"`
		CopyIgnoreGroup string `json:"copyIgnoreGroup"`
		IsCopyCategory  string `json:"isCopyCategory"`
	}

	if err := json.Unmarshal(copyReceivedBody, &payload); err != nil {
		t.Fatalf("Failed to parse request payload: %v", err)
	}

	expectedName := "my-target-repo-feature-cool-stuff"
	if payload.ID != "template-12345" {
		t.Errorf("Expected payload.id to be %q, got %q", "template-12345", payload.ID)
	}
	if payload.Name != expectedName {
		t.Errorf("Expected payload.name to be %q, got %q", expectedName, payload.Name)
	}
	if payload.CopyIgnoreGroup != "false" {
		t.Errorf("Expected payload.copyIgnoreGroup to be %q, got %q", "false", payload.CopyIgnoreGroup)
	}
	if payload.IsCopyCategory != "false" {
		t.Errorf("Expected payload.isCopyCategory to be %q, got %q", "false", payload.IsCopyCategory)
	}

	// Verify generated customAttributes
	var outConfig map[string]interface{}
	if err := json.Unmarshal([]byte(updatedAttrs), &outConfig); err != nil {
		t.Fatalf("Failed to parse returned customAttributes: %v", err)
	}

	if outConfig["code_checker_task_id"] != taskID {
		t.Errorf("Expected code_checker_task_id to be %q, got %q", taskID, outConfig["code_checker_task_id"])
	}

	if val, ok := outConfig["existing_key"]; !ok || val != "existing_value" {
		t.Errorf("Expected custom attributes to contain existing_key=existing_value, got %v", outConfig)
	}
}

func TestCheckRepoAuthorized(t *testing.T) {
	testCases := []struct {
		name           string
		mockStatus     int
		mockBody       string
		expectedAuth   bool
		expectedHasErr bool
	}{
		{
			name:           "Authorized string count",
			mockStatus:     http.StatusOK,
			mockBody:       `{"status": "success", "count": "1"}`,
			expectedAuth:   true,
			expectedHasErr: false,
		},
		{
			name:           "Authorized int count",
			mockStatus:     http.StatusOK,
			mockBody:       `{"status": "success", "count": 2}`,
			expectedAuth:   true,
			expectedHasErr: false,
		},
		{
			name:           "Unauthorized",
			mockStatus:     http.StatusOK,
			mockBody:       `{"status": "success", "count": "0"}`,
			expectedAuth:   false,
			expectedHasErr: false,
		},
		{
			name:           "API returns status error",
			mockStatus:     http.StatusOK,
			mockBody:       `{"status": "error", "count": "1"}`,
			expectedAuth:   false,
			expectedHasErr: true,
		},
		{
			name:           "HTTP status not 200",
			mockStatus:     http.StatusInternalServerError,
			mockBody:       `{}`,
			expectedAuth:   false,
			expectedHasErr: true,
		},
		{
			name:           "Invalid JSON body",
			mockStatus:     http.StatusOK,
			mockBody:       `{invalid-json}`,
			expectedAuth:   false,
			expectedHasErr: true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				// Verify query parameters
				fuzzyMatch := r.URL.Query().Get("fuzzyMatch")
				if fuzzyMatch != "git@github.com:my-org/my-target-repo.git" {
					t.Errorf("Expected fuzzyMatch query param, got %q", fuzzyMatch)
				}
				w.WriteHeader(tc.mockStatus)
				w.Write([]byte(tc.mockBody))
			}))
			defer server.Close()

			models.AppConfig.PipelineSystem.RepoAuthCheckURL = server.URL

			auth, err := checkRepoAuthorized(context.Background(), "git@github.com:my-org/my-target-repo.git", nil)
			if (err != nil) != tc.expectedHasErr {
				t.Fatalf("Expected error: %v, got: %v", tc.expectedHasErr, err)
			}
			if auth != tc.expectedAuth {
				t.Errorf("Expected auth: %v, got: %v", tc.expectedAuth, auth)
			}
		})
	}
}
