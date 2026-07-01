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
	var checkAuthReceivedMethod string
	var checkAuthReceivedURL string
	var checkCredReceivedMethod string
	var checkCredReceivedURL string
	var copyReceivedMethod string
	var copyReceivedBody []byte
	var copyReceivedHeaders http.Header

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			if strings.Contains(r.URL.RawQuery, "fuzzyMatch=") {
				checkAuthReceivedMethod = r.Method
				checkAuthReceivedURL = r.URL.String()
				w.WriteHeader(http.StatusOK)
				w.Write([]byte(`{"status": "success", "count": "1", "entities": [{"id": "12345"}]}`))
				return
			}
			if strings.Contains(r.URL.RawQuery, "authorized=true") {
				checkCredReceivedMethod = r.Method
				checkCredReceivedURL = r.URL.String()
				w.WriteHeader(http.StatusOK)
				w.Write([]byte(`{"success": true, "result": {"content": [{"id": 1}]}}`))
				return
			}
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
	models.AppConfig.PipelineSystem.RepoCredentialCheckURL = server.URL
	models.AppConfig.PipelineSystem.CreateCheckerTaskURL = server.URL
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
	if checkAuthReceivedMethod != "GET" {
		t.Errorf("Expected GET request for auth check, got %q", checkAuthReceivedMethod)
	}
	if !strings.Contains(checkAuthReceivedURL, "fuzzyMatch=my-org%2Fmy-target-repo") {
		t.Errorf("Expected URL to contain fuzzyMatch param, got %q", checkAuthReceivedURL)
	}

	// Verify Check Repo Credential API properties
	if checkCredReceivedMethod != "GET" {
		t.Errorf("Expected GET request for credential check, got %q", checkCredReceivedMethod)
	}
	if !strings.Contains(checkCredReceivedURL, "authorized=true") || !strings.Contains(checkCredReceivedURL, "uri=git%40github.com%3Amy-org%2Fmy-target-repo.git") {
		t.Errorf("Expected URL to contain authorized=true and uri param, got %q", checkCredReceivedURL)
	}

	// Verify Create Task HTTP Request properties
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

	if payload.ID != "template-12345" {
		t.Errorf("Expected payload.id to be %q, got %q", "template-12345", payload.ID)
	}
	expectedPrefix := "my-target-repo-feature-cool-stuff-CodeShield-"
	if !strings.HasPrefix(payload.Name, expectedPrefix) {
		t.Errorf("Expected payload.name to start with %q, got %q", expectedPrefix, payload.Name)
	}
	suffix := strings.TrimPrefix(payload.Name, expectedPrefix)
	if len(suffix) != 4 {
		t.Errorf("Expected 4-character random suffix, got %q in %q", suffix, payload.Name)
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
		expectedAuthID string
		expectedHasErr bool
	}{
		{
			name:           "Authorized string ID",
			mockStatus:     http.StatusOK,
			mockBody:       `{"status": "success", "count": 1, "entities": [{"id": "auth-12345"}]}`,
			expectedAuthID: "auth-12345",
			expectedHasErr: false,
		},
		{
			name:           "Unauthorized",
			mockStatus:     http.StatusOK,
			mockBody:       `{"status": "success", "count": 0, "entities": []}`,
			expectedAuthID: "",
			expectedHasErr: false,
		},
		{
			name:           "API returns status error",
			mockStatus:     http.StatusOK,
			mockBody:       `{"status": "error", "entities": [{"id": "123"}]}`,
			expectedAuthID: "",
			expectedHasErr: true,
		},
		{
			name:           "HTTP status not 200",
			mockStatus:     http.StatusInternalServerError,
			mockBody:       `{}`,
			expectedAuthID: "",
			expectedHasErr: true,
		},
		{
			name:           "Invalid JSON body",
			mockStatus:     http.StatusOK,
			mockBody:       `{invalid-json}`,
			expectedAuthID: "",
			expectedHasErr: true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				// Verify query parameters
				fuzzyMatch := r.URL.Query().Get("fuzzyMatch")
				if fuzzyMatch != "my-org/my-target-repo" {
					t.Errorf("Expected fuzzyMatch query param, got %q", fuzzyMatch)
				}
				w.WriteHeader(tc.mockStatus)
				w.Write([]byte(tc.mockBody))
			}))
			defer server.Close()

			models.AppConfig.PipelineSystem.RepoAuthCheckURL = server.URL

			authID, err := CheckRepoAuthorized(context.Background(), "git@github.com:my-org/my-target-repo.git", nil)
			if (err != nil) != tc.expectedHasErr {
				t.Fatalf("Expected error: %v, got: %v", tc.expectedHasErr, err)
			}
			if authID != tc.expectedAuthID {
				t.Errorf("Expected authID: %q, got: %q", tc.expectedAuthID, authID)
			}
		})
	}
}

func TestCheckRepoCredentialAssociated(t *testing.T) {
	testCases := []struct {
		name           string
		mockStatus     int
		mockBody       string
		expectedAssoc  bool
		expectedHasErr bool
	}{
		{
			name:           "Associated with credentials",
			mockStatus:     http.StatusOK,
			mockBody:       `{"success": true, "result": {"content": [{"id": 1, "name": "cred"}]}}`,
			expectedAssoc:  true,
			expectedHasErr: false,
		},
		{
			name:           "Not associated with credentials",
			mockStatus:     http.StatusOK,
			mockBody:       `{"success": true, "result": {"content": []}}`,
			expectedAssoc:  false,
			expectedHasErr: false,
		},
		{
			name:           "API returns success false",
			mockStatus:     http.StatusOK,
			mockBody:       `{"success": false, "result": {"content": []}}`,
			expectedAssoc:  false,
			expectedHasErr: true,
		},
		{
			name:           "HTTP status not 200",
			mockStatus:     http.StatusInternalServerError,
			mockBody:       `{}`,
			expectedAssoc:  false,
			expectedHasErr: true,
		},
		{
			name:           "Invalid JSON body",
			mockStatus:     http.StatusOK,
			mockBody:       `{invalid-json}`,
			expectedAssoc:  false,
			expectedHasErr: true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				// Verify query parameters
				authorized := r.URL.Query().Get("authorized")
				uri := r.URL.Query().Get("uri")
				if authorized != "true" || uri != "git@github.com:my-org/my-target-repo.git" {
					t.Errorf("Expected query params authorized=true and uri, got authorized=%q, uri=%q", authorized, uri)
				}
				w.WriteHeader(tc.mockStatus)
				w.Write([]byte(tc.mockBody))
			}))
			defer server.Close()

			models.AppConfig.PipelineSystem.RepoCredentialCheckURL = server.URL

			assoc, err := checkRepoCredentialAssociated(context.Background(), "git@github.com:my-org/my-target-repo.git", nil)
			if (err != nil) != tc.expectedHasErr {
				t.Fatalf("Expected error: %v, got: %v", tc.expectedHasErr, err)
			}
			if assoc != tc.expectedAssoc {
				t.Errorf("Expected assoc: %v, got: %v", tc.expectedAssoc, assoc)
			}
		})
	}
}

func TestCreateCheckerTaskStep(t *testing.T) {
	// 备份原配置，以便测试结束后恢复
	origURL := models.AppConfig.PipelineSystem.CreateCheckerTaskURL
	origBody := models.AppConfig.PipelineSystem.CreateCheckerTaskBody
	origRuleSets := models.AppConfig.PipelineSystem.RuleSets
	defer func() {
		models.AppConfig.PipelineSystem.CreateCheckerTaskURL = origURL
		models.AppConfig.PipelineSystem.CreateCheckerTaskBody = origBody
		models.AppConfig.PipelineSystem.RuleSets = origRuleSets
	}()

	var receivedBody []byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err == nil {
			receivedBody = body
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"id": "test-task-123"}`))
	}))
	defer server.Close()

	models.AppConfig.PipelineSystem.CreateCheckerTaskURL = server.URL
	models.AppConfig.PipelineSystem.CreateCheckerTaskBody = `{
		"languages": {LANGUAGES},
		"ruleSets": {RULE_SETS}
	}`
	models.AppConfig.PipelineSystem.RuleSets = map[string][]string{
		"GO":     {"go_rule_1", "go_rule_2"},
		"PYTHON": {"py_rule_1"},
	}

	ctx := context.Background()
	taskID, err := createCheckerTaskStep(ctx, "https://github.com/test/repo.git", "main", "Go,Python", nil)
	if err != nil {
		t.Fatalf("createCheckerTaskStep failed: %v", err)
	}

	if taskID != "test-task-123" {
		t.Errorf("expected taskID 'test-task-123', got '%s'", taskID)
	}

	var reqPayload struct {
		Languages []string `json:"languages"`
		RuleSets  []struct {
			Language  string `json:"language"`
			RuleSetID string `json:"ruleSetId"`
		} `json:"ruleSets"`
	}

	if err := json.Unmarshal(receivedBody, &reqPayload); err != nil {
		t.Fatalf("failed to unmarshal request body: %v", err)
	}

	if len(reqPayload.Languages) != 2 || reqPayload.Languages[0] != "Go" || reqPayload.Languages[1] != "Python" {
		t.Errorf("unexpected languages: %v", reqPayload.Languages)
	}

	if len(reqPayload.RuleSets) != 3 {
		t.Errorf("expected 3 rule sets, got %d", len(reqPayload.RuleSets))
	}

	expectedRules := []struct {
		Lang string
		ID   string
	}{
		{"GO", "go_rule_1"},
		{"GO", "go_rule_2"},
		{"PYTHON", "py_rule_1"},
	}

	for i, r := range expectedRules {
		if i >= len(reqPayload.RuleSets) {
			break
		}
		if reqPayload.RuleSets[i].Language != r.Lang || reqPayload.RuleSets[i].RuleSetID != r.ID {
			t.Errorf("at index %d: expected %s/%s, got %s/%s", i, r.Lang, r.ID, reqPayload.RuleSets[i].Language, reqPayload.RuleSets[i].RuleSetID)
		}
	}
}

