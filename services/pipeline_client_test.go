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

func TestUpdateCheckerTaskRemote(t *testing.T) {
	// Setup mock server
	var receivedMethod string
	var receivedBody []byte
	var receivedHeaders http.Header

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedMethod = r.Method
		receivedHeaders = r.Header
		body, err := io.ReadAll(r.Body)
		if err == nil {
			receivedBody = body
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status": "success"}`))
	}))
	defer server.Close()

	// Configure app config to use mock server
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

	// Verify HTTP Request properties
	if receivedMethod != "POST" {
		t.Errorf("Expected POST request, got %q", receivedMethod)
	}

	if receivedHeaders.Get("Content-Type") != "application/json" {
		t.Errorf("Expected Content-Type 'application/json', got %q", receivedHeaders.Get("Content-Type"))
	}

	if receivedHeaders.Get("Authorization") != "Bearer some-token" {
		t.Errorf("Expected Authorization header, got %q", receivedHeaders.Get("Authorization"))
	}

	// Verify POST payload JSON structure
	var payload struct {
		ID              string `json:"id"`
		Name            string `json:"name"`
		CopyIgnoreGroup string `json:"copyIgnoreGroup"`
		IsCopyCategory  string `json:"isCopyCategory"`
	}

	if err := json.Unmarshal(receivedBody, &payload); err != nil {
		t.Fatalf("Failed to parse request payload: %v", err)
	}

	expectedName := "my-target-repo-feature/cool-stuff"
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
