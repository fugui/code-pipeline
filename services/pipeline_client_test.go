package services

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
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

func TestCreateCheckerTaskStep(t *testing.T) {
	// 备份原配置，以便测试结束后恢复
	origURL := models.AppConfig.PipelineSystem.CreateCheckerTaskURL
	origBody := models.AppConfig.PipelineSystem.CreateCheckerTaskBody
	origRuleSets := models.AppConfig.PipelineSystem.RuleSets
	origQueryURL := models.AppConfig.PipelineSystem.QueryCheckerTaskURL
	defer func() {
		models.AppConfig.PipelineSystem.CreateCheckerTaskURL = origURL
		models.AppConfig.PipelineSystem.CreateCheckerTaskBody = origBody
		models.AppConfig.PipelineSystem.RuleSets = origRuleSets
		models.AppConfig.PipelineSystem.QueryCheckerTaskURL = origQueryURL
	}()

	var receivedBody []byte
	var receivedMethodCreate string
	var receivedMethodQuery string
	var receivedQueryName string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" {
			receivedMethodCreate = r.Method
			body, err := io.ReadAll(r.Body)
			if err == nil {
				receivedBody = body
			}
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"status": "success"}`))
			return
		}
		if r.Method == "GET" {
			receivedMethodQuery = r.Method
			receivedQueryName = r.URL.Query().Get("search")
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{
				"status": "success",
				"result": {
					"info": [
						{"id": "test-task-123", "name": "matching-task"}
					]
				}
			}`))
			return
		}
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer server.Close()

	models.AppConfig.PipelineSystem.CreateCheckerTaskURL = server.URL
	models.AppConfig.PipelineSystem.QueryCheckerTaskURL = server.URL
	models.AppConfig.PipelineSystem.CreateCheckerTaskBody = `{
		"ruleSets": {RULE_SETS},
		"branch": "{REPO_BRANCH}"
	}`
	models.AppConfig.PipelineSystem.RuleSets = map[string]string{
		"GO":     "go_rule_1",
		"PYTHON": "py_rule_1",
	}

	ctx := context.Background()
	taskID, err := createCheckerTaskStep(ctx, "https://github.com/test/repo.git", "main,develop", "Go,Python", "mock-task-name", nil)
	if err != nil {
		t.Fatalf("createCheckerTaskStep failed: %v", err)
	}

	if taskID != "test-task-123" {
		t.Errorf("expected taskID 'test-task-123', got '%s'", taskID)
	}

	if receivedMethodCreate != "POST" {
		t.Errorf("expected POST method to create task, got %q", receivedMethodCreate)
	}
	if receivedMethodQuery != "GET" {
		t.Errorf("expected GET method to query task, got %q", receivedMethodQuery)
	}
	if receivedQueryName == "" {
		t.Error("expected query parameter 'name' to be non-empty")
	}

	var reqPayload struct {
		Branch   string `json:"branch"`
		RuleSets []struct {
			Language  string `json:"language"`
			RuleSetID string `json:"ruleSetId"`
		} `json:"ruleSets"`
	}

	if err := json.Unmarshal(receivedBody, &reqPayload); err != nil {
		t.Fatalf("failed to unmarshal request body: %v", err)
	}

	if reqPayload.Branch != "main" {
		t.Errorf("expected branch 'main', got '%s'", reqPayload.Branch)
	}

	if len(reqPayload.RuleSets) != 2 {
		t.Errorf("expected 2 rule sets, got %d", len(reqPayload.RuleSets))
	}

	expectedRules := []struct {
		Lang string
		ID   string
	}{
		{"GO", "go_rule_1"},
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
