package services

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"code-pipeline/models"
)

func TestGetMrListFromGitRemote(t *testing.T) {
	// 备份配置
	origURL := models.AppConfig.CodeHub.GetMRsURL
	origHeaders := models.AppConfig.CodeHub.Headers
	defer func() {
		models.AppConfig.CodeHub.GetMRsURL = origURL
		models.AppConfig.CodeHub.Headers = origHeaders
	}()

	testCases := []struct {
		name           string
		mockStatus     int
		mockBody       string
		configHeaders  map[string]string
		contextHeaders map[string]string
		expectedCount  int
		expectError    bool
		skipURLConfig  bool
		checkFields    func(t *testing.T, list []GitMr)
	}{
		{
			name:       "Standard Snake Case Array response",
			mockStatus: http.StatusOK,
			mockBody: `[
				{
					"id": 1001,
					"iid": 1,
					"title": "feat: init commit",
					"state": "opened",
					"description": "first mr",
					"target_branch": "master",
					"source_branch": "feat/init",
					"web_url": "http://codehub/mr/1",
					"author": {"name": "User A", "username": "usera"},
					"created_at": "2026-07-14T05:00:00Z",
					"updated_at": "2026-07-14T06:00:00Z"
				}
			]`,
			expectedCount: 1,
			expectError:   false,
			checkFields: func(t *testing.T, list []GitMr) {
				mr := list[0]
				if mr.Title != "feat: init commit" {
					t.Errorf("Expected title 'feat: init commit', got '%s'", mr.Title)
				}
				if mr.TargetBranch != "master" {
					t.Errorf("Expected target branch 'master', got '%s'", mr.TargetBranch)
				}
				if mr.SourceBranch != "feat/init" {
					t.Errorf("Expected source branch 'feat/init', got '%s'", mr.SourceBranch)
				}
				if mr.WebURL != "http://codehub/mr/1" {
					t.Errorf("Expected web_url, got '%s'", mr.WebURL)
				}
			},
		},
		{
			name:       "Camel Case Response parsing test",
			mockStatus: http.StatusOK,
			mockBody: `[
				{
					"id": "abc-123",
					"iid": 5,
					"title": "fix: UI layout",
					"state": "merged",
					"description": "fix it",
					"targetBranch": "release/v1.0",
					"sourceBranch": "bugfix/ui",
					"webUrl": "http://codehub/mr/5",
					"author": {"name": "User B", "username": "userb"},
					"created_at": "2026-07-14T07:00:00Z",
					"updated_at": "2026-07-14T08:00:00Z"
				}
			]`,
			expectedCount: 1,
			expectError:   false,
			checkFields: func(t *testing.T, list []GitMr) {
				mr := list[0]
				if mr.TargetBranch != "release/v1.0" {
					t.Errorf("Expected target branch 'release/v1.0', got '%s'", mr.TargetBranch)
				}
				if mr.SourceBranch != "bugfix/ui" {
					t.Errorf("Expected source branch 'bugfix/ui', got '%s'", mr.SourceBranch)
				}
				if mr.WebURL != "http://codehub/mr/5" {
					t.Errorf("Expected web_url 'http://codehub/mr/5', got '%s'", mr.WebURL)
				}
			},
		},
		{
			name:       "Wrapped result format response",
			mockStatus: http.StatusOK,
			mockBody: `{
				"status": "success",
				"result": [
					{
						"id": 99,
						"iid": 2,
						"title": "docs: update readme",
						"state": "closed",
						"target_branch": "main",
						"source_branch": "docs-patch"
					}
				]
			}`,
			expectedCount: 1,
			expectError:   false,
			checkFields: func(t *testing.T, list []GitMr) {
				mr := list[0]
				if mr.Title != "docs: update readme" {
					t.Errorf("Expected title 'docs: update readme', got '%s'", mr.Title)
				}
			},
		},
		{
			name:           "Header Merge Test",
			mockStatus:     http.StatusOK,
			mockBody:       `[]`,
			configHeaders:  map[string]string{"X-Config-Header": "config-val", "X-Override-Header": "config-override"},
			contextHeaders: map[string]string{"X-Context-Header": "context-val", "X-Override-Header": "context-override"},
			expectedCount:  0,
			expectError:    false,
		},
		{
			name:          "API Error 500 Response",
			mockStatus:    http.StatusInternalServerError,
			mockBody:      `{"error":"internal server error"}`,
			expectedCount: 0,
			expectError:   true,
		},
		{
			name:          "No Configured URL Response",
			mockStatus:    http.StatusOK,
			mockBody:      `[]`,
			expectedCount: 0,
			expectError:   true,
			skipURLConfig:  true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				// Verify Header Merging
				if tc.name == "Header Merge Test" {
					if val := r.Header.Get("X-Config-Header"); val != "config-val" {
						t.Errorf("Expected X-Config-Header='config-val', got '%s'", val)
					}
					if val := r.Header.Get("X-Context-Header"); val != "context-val" {
						t.Errorf("Expected X-Context-Header='context-val', got '%s'", val)
					}
					if val := r.Header.Get("X-Override-Header"); val != "context-override" {
						t.Errorf("Expected overridden header to be 'context-override', got '%s'", val)
					}
				}

				w.WriteHeader(tc.mockStatus)
				w.Write([]byte(tc.mockBody))
			}))
			defer server.Close()

			if !tc.skipURLConfig {
				models.AppConfig.CodeHub.GetMRsURL = server.URL + "/projects/{REPO_ID}/merge_requests"
			} else {
				models.AppConfig.CodeHub.GetMRsURL = ""
			}
			models.AppConfig.CodeHub.Headers = tc.configHeaders

			list, err := GetMrListFromGitRemote(context.Background(), "test-project-123", "test_sync_repo", tc.contextHeaders)
			if (err != nil) != tc.expectError {
				t.Fatalf("Expected expectError=%v, got err=%v", tc.expectError, err)
			}

			if !tc.expectError {
				if len(list) != tc.expectedCount {
					t.Errorf("Expected %d items, got %d", tc.expectedCount, len(list))
				}
				if tc.checkFields != nil {
					tc.checkFields(t, list)
				}
			}
		})
	}
}

func TestGetRemoteSubgroupsPagination(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		pageStr := r.URL.Query().Get("page")
		if pageStr == "1" {
			var list []string
			for i := 0; i < 100; i++ {
				list = append(list, `{"id":100, "name":"sub", "path":"sub", "full_path":"path"}`)
			}
			w.WriteHeader(http.StatusOK)
			w.Write([]byte("[" + stringJoin(list, ",") + "]"))
			return
		}
		if pageStr == "2" {
			var list []string
			for i := 0; i < 5; i++ {
				list = append(list, `{"id":200, "name":"sub", "path":"sub", "full_path":"path"}`)
			}
			w.WriteHeader(http.StatusOK)
			w.Write([]byte("[" + stringJoin(list, ",") + "]"))
			return
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("[]"))
	}))
	defer server.Close()

	origBaseURL := GitPlatformBaseURL
	GitPlatformBaseURL = server.URL
	defer func() {
		GitPlatformBaseURL = origBaseURL
	}()

	subgroups, err := GetRemoteSubgroups(context.Background(), 999)
	if err != nil {
		t.Fatalf("GetRemoteSubgroups failed: %v", err)
	}
	if len(subgroups) != 105 {
		t.Errorf("Expected 105 subgroups, got %d", len(subgroups))
	}
}

func TestGetRemoteProjectsPagination(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		pageStr := r.URL.Query().Get("page")
		if pageStr == "1" {
			var list []string
			for i := 0; i < 100; i++ {
				list = append(list, `{"id":100, "name":"repo", "ssh_url_to_repo":"git@git.local:repo.git"}`)
			}
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"status":"success", "result":[` + stringJoin(list, ",") + `]}`))
			return
		}
		if pageStr == "2" {
			var list []string
			for i := 0; i < 5; i++ {
				list = append(list, `{"id":200, "name":"repo", "ssh_url_to_repo":"git@git.local:repo.git"}`)
			}
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"status":"success", "result":[` + stringJoin(list, ",") + `]}`))
			return
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"success", "result":[]}`))
	}))
	defer server.Close()

	origBaseURL := GitPlatformBaseURL
	GitPlatformBaseURL = server.URL
	defer func() {
		GitPlatformBaseURL = origBaseURL
	}()

	projects, err := GetRemoteProjects(context.Background(), 999)
	if err != nil {
		t.Fatalf("GetRemoteProjects failed: %v", err)
	}
	if len(projects) != 105 {
		t.Errorf("Expected 105 projects, got %d", len(projects))
	}
}

func stringJoin(elems []string, sep string) string {
	if len(elems) == 0 {
		return ""
	}
	res := elems[0]
	for _, s := range elems[1:] {
		res += sep + s
	}
	return res
}
