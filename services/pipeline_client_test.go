package services

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"code-pipeline/database"
	"code-pipeline/models"
)

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

func TestRegisterWebhook(t *testing.T) {
	origCreateURL := models.AppConfig.PipelineSystem.CreateWebhookURL
	origCreateBody := models.AppConfig.PipelineSystem.CreateWebhookBody
	origCallbackURL := models.AppConfig.PipelineSystem.WebhookCallbackURL
	origUpdateURL := models.AppConfig.PipelineSystem.UpdateRepoSettingsURL
	origUpdateBody := models.AppConfig.PipelineSystem.UpdateRepoSettingsBody

	defer func() {
		models.AppConfig.PipelineSystem.CreateWebhookURL = origCreateURL
		models.AppConfig.PipelineSystem.CreateWebhookBody = origCreateBody
		models.AppConfig.PipelineSystem.WebhookCallbackURL = origCallbackURL
		models.AppConfig.PipelineSystem.UpdateRepoSettingsURL = origUpdateURL
		models.AppConfig.PipelineSystem.UpdateRepoSettingsBody = origUpdateBody
	}()

	var receivedPostMethod string
	var receivedPostPath string
	var receivedPostPayload string
	var receivedPutMethod string
	var receivedPutPath string
	var receivedPutPayload string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" {
			receivedPostMethod = r.Method
			receivedPostPath = r.URL.Path
			body, _ := io.ReadAll(r.Body)
			receivedPostPayload = string(body)
			w.WriteHeader(http.StatusCreated)
			w.Write([]byte(`{"status":"success"}`))
			return
		}
		if r.Method == "PUT" {
			receivedPutMethod = r.Method
			receivedPutPath = r.URL.Path
			body, _ := io.ReadAll(r.Body)
			receivedPutPayload = string(body)
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"status":"success"}`))
			return
		}
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer server.Close()

	models.AppConfig.PipelineSystem.CreateWebhookURL = server.URL + "/projects/{REPO_ID}/hooks"
	models.AppConfig.PipelineSystem.CreateWebhookBody = `{"url":"{WEBHOOK_URL}","repo_id":"{REPO_ID}"}`
	models.AppConfig.PipelineSystem.WebhookCallbackURL = "http://callback.local"
	models.AppConfig.PipelineSystem.UpdateRepoSettingsURL = server.URL + "/projects/{REPO_ID}/settings"
	models.AppConfig.PipelineSystem.UpdateRepoSettingsBody = `{"project_id":"{PROJECT_ID}","enabled":true}`

	ctx := context.Background()
	err := RegisterWebhook(ctx, "project-123", nil)
	if err != nil {
		t.Fatalf("RegisterWebhook failed: %v", err)
	}

	if receivedPostMethod != "POST" {
		t.Errorf("expected POST method for webhook creation, got %q", receivedPostMethod)
	}
	if receivedPostPath != "/projects/project-123/hooks" {
		t.Errorf("expected POST path '/projects/project-123/hooks', got %q", receivedPostPath)
	}
	if receivedPostPayload != `{"repo_id":"project-123","url":"http://callback.local"}` {
		t.Errorf("expected POST body replacement, got %q", receivedPostPayload)
	}

	if receivedPutMethod != "PUT" {
		t.Errorf("expected PUT method for settings update, got %q", receivedPutMethod)
	}
	if receivedPutPath != "/projects/project-123/settings" {
		t.Errorf("expected PUT path '/projects/project-123/settings', got %q", receivedPutPath)
	}
	if receivedPutPayload != `{"enabled":true,"project_id":"project-123"}` {
		t.Errorf("expected PUT body replacement, got %q", receivedPutPayload)
	}
}

func TestManagedGitPlatformAPI(t *testing.T) {
	var receivedPostRepo string
	var receivedPostBranch string
	var receivedPostProtect string
	var receivedPostACL string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		path := r.URL.Path

		if r.Method == "POST" && path == "/api/v1/projects" {
			receivedPostRepo = string(body)
			w.WriteHeader(http.StatusCreated)
			w.Write([]byte(`{"id":456,"ssh_url":"git@git.local:group/repo.git","http_url":"http://git.local/group/repo"}`))
			return
		}
		if r.Method == "POST" && path == "/api/v1/projects/456/branches" {
			receivedPostBranch = string(body)
			w.WriteHeader(http.StatusCreated)
			w.Write([]byte(`{"status":"success"}`))
			return
		}
		if r.Method == "POST" && path == "/api/v1/projects/456/protected_branches" {
			receivedPostProtect = string(body)
			w.WriteHeader(http.StatusCreated)
			w.Write([]byte(`{"status":"success"}`))
			return
		}
		if r.Method == "POST" && path == "/api/v1/projects/456/members" {
			receivedPostACL = string(body)
			w.WriteHeader(http.StatusCreated)
			w.Write([]byte(`{"status":"success"}`))
			return
		}
		if r.Method == "GET" && path == "/api/v1/groups" {
			searchVal := r.URL.Query().Get("search")
			if searchVal == "tech/infra" {
				w.WriteHeader(http.StatusOK)
				w.Write([]byte(`{"status":"success","result":[{"id":999,"full_path":"tech/infra"}]}`))
				return
			}
		}
		if r.Method == "GET" && path == "/api/v1/groups/999/subgroups" {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`[{"id":1001,"name":"sub1","path":"sub1","full_path":"tech/infra/sub1"}]`))
			return
		}
		if r.Method == "GET" && path == "/api/v1/groups/999/projects" {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"status":"success","result":[{"id":888,"name":"repo1","ssh_url_to_repo":"git@git.local:tech/infra/repo1.git"}]}`))
			return
		}
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer server.Close()

	// 重定向 BaseURL (模拟用户在 base_url 中自定义 API 前缀)
	origBaseURL := GitPlatformBaseURL
	GitPlatformBaseURL = server.URL + "/api/v1"

	// 备份并注入 Mock Body 模板
	origRepoBody := models.AppConfig.CodeHub.CreateRepoBody
	origBranchBody := models.AppConfig.CodeHub.CreateBranchBody
	origProtectBody := models.AppConfig.CodeHub.ConfigureProtectionBody
	origACLBody := models.AppConfig.CodeHub.ConfigureACLBody

	models.AppConfig.CodeHub.CreateRepoBody = `{"name":"{REPO_NAME}","namespace_path":"{GROUP_PATH}","namespace_id":"{GROUP_ID}","tag_list":[{TAG_LIST}],"description":"{DESCRIPTION}","visibility":"private"}`
	models.AppConfig.CodeHub.CreateBranchBody = `{"branch_name":"{BRANCH_NAME}","ref":"{SOURCE_REF}"}`
	models.AppConfig.CodeHub.ConfigureProtectionBody = `{"name":"{BRANCH_PATTERN}","push_access_level":0}`
	models.AppConfig.CodeHub.ConfigureACLBody = `{"principal_type":"{PRINCIPAL_TYPE}","principal_id":"{PRINCIPAL_ID}","access_level":{ACCESS_LEVEL}}`

	defer func() {
		GitPlatformBaseURL = origBaseURL
		models.AppConfig.CodeHub.CreateRepoBody = origRepoBody
		models.AppConfig.CodeHub.CreateBranchBody = origBranchBody
		models.AppConfig.CodeHub.ConfigureProtectionBody = origProtectBody
		models.AppConfig.CodeHub.ConfigureACLBody = origACLBody
	}()

	ctx := context.Background()

	// 1. 测试创建远程代码仓
	repoID, sshURL, httpURL, err := CreateRemoteRepo(ctx, "test-repo", "tech/infra", 100, "tag1, tag2", "这是代码仓的详细描述信息")
	if err != nil {
		t.Fatalf("CreateRemoteRepo failed: %v", err)
	}
	if repoID != 456 || sshURL != "git@git.local:group/repo.git" || httpURL != "http://git.local/group/repo" {
		t.Errorf("unexpected CreateRemoteRepo return values: %d, %s, %s", repoID, sshURL, httpURL)
	}
	if !strings.Contains(receivedPostRepo, `"name":"test-repo"`) ||
		!strings.Contains(receivedPostRepo, `"namespace_path":"tech/infra"`) ||
		!strings.Contains(receivedPostRepo, `"namespace_id":"100"`) ||
		!strings.Contains(receivedPostRepo, `"tag_list":["tag1","tag2","CodeShield"]`) ||
		!strings.Contains(receivedPostRepo, `"description":"这是代码仓的详细描述信息"`) {
		t.Errorf("unexpected CreateRemoteRepo body: %s", receivedPostRepo)
	}

	// 2. 测试创建远程分支
	err = CreateRemoteBranch(ctx, "456", "feature-auth", "master")
	if err != nil {
		t.Fatalf("CreateRemoteBranch failed: %v", err)
	}
	if !strings.Contains(receivedPostBranch, `"branch_name":"feature-auth"`) || !strings.Contains(receivedPostBranch, `"ref":"master"`) {
		t.Errorf("unexpected CreateRemoteBranch body: %s", receivedPostBranch)
	}

	// 3. 测试设置分支保护
	err = ConfigureBranchProtection(ctx, "456", "feature-*")
	if err != nil {
		t.Fatalf("ConfigureBranchProtection failed: %v", err)
	}
	if !strings.Contains(receivedPostProtect, `"name":"feature-*"`) || !strings.Contains(receivedPostProtect, `"push_access_level":0`) {
		t.Errorf("unexpected ConfigureBranchProtection body: %s", receivedPostProtect)
	}

	// 4. 测试授权成员
	err = ConfigureRemoteACL(ctx, "repository", "456", "user", "1001", 30)
	if err != nil {
		t.Fatalf("ConfigureRemoteACL failed: %v", err)
	}
	if !strings.Contains(receivedPostACL, `"principal_type":"user"`) || !strings.Contains(receivedPostACL, `"principal_id":"1001"`) || !strings.Contains(receivedPostACL, `"access_level":30`) {
		t.Errorf("unexpected ConfigureRemoteACL body: %s", receivedPostACL)
	}

	// 5. 测试获取远程群组详情 (GetRemoteGroupDetails)
	remoteGroupID, err := GetRemoteGroupDetails(ctx, "tech/infra")
	if err != nil {
		t.Fatalf("GetRemoteGroupDetails failed: %v", err)
	}
	if remoteGroupID != 999 {
		t.Errorf("expected group ID 999, got %d", remoteGroupID)
	}

	// 6. 测试获取远程子组 (GetRemoteSubgroups)
	subgroups, err := GetRemoteSubgroups(ctx, 999)
	if err != nil {
		t.Fatalf("GetRemoteSubgroups failed: %v", err)
	}
	if len(subgroups) != 1 || subgroups[0].ID != 1001 || subgroups[0].FullPath != "tech/infra/sub1" {
		t.Errorf("unexpected subgroups result: %v", subgroups)
	}

	// 7. 测试获取远程项目 (GetRemoteProjects)
	projects, err := GetRemoteProjects(ctx, 999)
	if err != nil {
		t.Fatalf("GetRemoteProjects failed: %v", err)
	}
	if len(projects) != 1 || projects[0].ID != 888 || projects[0].Name != "repo1" {
		t.Errorf("unexpected projects result: %v", projects)
	}
}

func TestQueryCheckerTaskInfo(t *testing.T) {
	origQueryURL := models.AppConfig.PipelineSystem.QueryCheckerTaskURL
	defer func() {
		models.AppConfig.PipelineSystem.QueryCheckerTaskURL = origQueryURL
	}()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" && r.URL.Query().Get("search") == "my-checker-task" {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{
				"status": "success",
				"result": {
					"info": [
						{
							"id": "checker-99",
							"name": "my-checker-task",
							"repoURL": "https://example.com/repo.git",
							"branchName": "main",
							"configTemplateId": "tmpl-777"
						}
					]
				}
			}`))
			return
		}
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer server.Close()

	models.AppConfig.PipelineSystem.QueryCheckerTaskURL = server.URL

	ctx := context.Background()
	infos, err := QueryCheckerTaskInfo(ctx, "my-checker-task", nil)
	if err != nil {
		t.Fatalf("QueryCheckerTaskInfo failed: %v", err)
	}
	if len(infos) != 1 {
		t.Fatalf("expected 1 info item, got %d", len(infos))
	}
	if infos[0].ID != "checker-99" || infos[0].ConfigTemplateID != "tmpl-777" {
		t.Errorf("unexpected info result: %+v", infos[0])
	}
}

func TestSyncUpdateCheckerTaskRemote(t *testing.T) {
	origURL := models.AppConfig.PipelineSystem.CreateCheckerTaskURL
	origQueryURL := models.AppConfig.PipelineSystem.QueryCheckerTaskURL
	origBody := models.AppConfig.PipelineSystem.CreateCheckerTaskBody
	origRuleSets := models.AppConfig.PipelineSystem.RuleSets
	defer func() {
		models.AppConfig.PipelineSystem.CreateCheckerTaskURL = origURL
		models.AppConfig.PipelineSystem.QueryCheckerTaskURL = origQueryURL
		models.AppConfig.PipelineSystem.CreateCheckerTaskBody = origBody
		models.AppConfig.PipelineSystem.RuleSets = origRuleSets
	}()

	var receivedPutMethod string
	var receivedPutBody map[string]interface{}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{
				"status": "success",
				"result": {
					"info": [
						{
							"id": "checker-task-8891",
							"name": "update-task-test",
							"repoURL": "https://example.com/repo.git",
							"branchName": "main",
							"configTemplateId": "tmpl-config-555"
						}
					]
				}
			}`))
			return
		}
		if r.Method == "PUT" {
			receivedPutMethod = r.Method
			bodyBytes, err := io.ReadAll(r.Body)
			if err == nil {
				json.Unmarshal(bodyBytes, &receivedPutBody)
			}
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"status": "success"}`))
			return
		}
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer server.Close()

	models.AppConfig.PipelineSystem.CreateCheckerTaskURL = server.URL
	models.AppConfig.PipelineSystem.QueryCheckerTaskURL = server.URL
	models.AppConfig.PipelineSystem.CreateCheckerTaskBody = `{
		"ruleSets": {RULE_SETS},
		"languages": {LANGUAGES},
		"id": "{TEMPLATE_ID}",
		"branch": "{REPO_BRANCH}"
	}`
	models.AppConfig.PipelineSystem.RuleSets = map[string]string{
		"GO": "go_rule_1",
	}

	ctx := context.Background()
	usedID, err := SyncUpdateCheckerTaskRemote(ctx, "checker-task-8891", "update-task-test", "https://example.com/repo.git", "main", "Go", nil)
	if err != nil {
		t.Fatalf("SyncUpdateCheckerTaskRemote failed: %v", err)
	}

	if usedID != "checker-task-8891" {
		t.Errorf("expected returned task ID 'checker-task-8891', got %q", usedID)
	}

	if receivedPutMethod != "PUT" {
		t.Errorf("expected PUT method, got %q", receivedPutMethod)
	}

	if receivedPutBody["id"] != "checker-task-8891" {
		t.Errorf("expected root id 'checker-task-8891', got %v", receivedPutBody["id"])
	}

	if receivedPutBody["configTemplateId"] != "tmpl-config-555" {
		t.Errorf("expected root configTemplateId 'tmpl-config-555', got %v", receivedPutBody["configTemplateId"])
	}

	cfgTmpl, ok := receivedPutBody["configTemplate"].(map[string]interface{})
	if !ok || cfgTmpl["id"] != "tmpl-config-555" {
		t.Errorf("expected configTemplate.id 'tmpl-config-555', got %v", cfgTmpl)
	}

	langsArr, ok := receivedPutBody["languages"].([]interface{})
	if !ok || len(langsArr) != 1 || langsArr[0] != "Go" {
		t.Errorf("expected languages ['Go'], got %v", receivedPutBody["languages"])
	}
}

// TestSyncUpdateCheckerTaskRemoteStaleID 验证：DB 缓存的 taskID 已失配（远程任务被删除重建，同名新 ID）
// 时应按名称精确匹配继续更新（upsert 续接），并返回实际使用的远程任务 ID
func TestSyncUpdateCheckerTaskRemoteStaleID(t *testing.T) {
	origURL := models.AppConfig.PipelineSystem.CreateCheckerTaskURL
	origQueryURL := models.AppConfig.PipelineSystem.QueryCheckerTaskURL
	origBody := models.AppConfig.PipelineSystem.CreateCheckerTaskBody
	origRuleSets := models.AppConfig.PipelineSystem.RuleSets
	defer func() {
		models.AppConfig.PipelineSystem.CreateCheckerTaskURL = origURL
		models.AppConfig.PipelineSystem.QueryCheckerTaskURL = origQueryURL
		models.AppConfig.PipelineSystem.CreateCheckerTaskBody = origBody
		models.AppConfig.PipelineSystem.RuleSets = origRuleSets
	}()

	var putCount int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{
				"status": "success",
				"result": {
					"info": [
						{
							"id": "checker-task-RECREATED",
							"name": "stale-id-task",
							"repoURL": "https://example.com/repo.git",
							"branchName": "main",
							"configTemplateId": "tmpl-new-1"
						}
					]
				}
			}`))
			return
		}
		if r.Method == "PUT" {
			putCount++
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"status": "success"}`))
			return
		}
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer server.Close()

	models.AppConfig.PipelineSystem.CreateCheckerTaskURL = server.URL
	models.AppConfig.PipelineSystem.QueryCheckerTaskURL = server.URL
	models.AppConfig.PipelineSystem.CreateCheckerTaskBody = `{
		"id": "{TEMPLATE_ID}",
		"name": "{NAME}",
		"languages": {LANGUAGES}
	}`
	models.AppConfig.PipelineSystem.RuleSets = map[string]string{"GO": "go_rule_1"}

	// DB 缓存 ID 是旧的 checker-task-OLD，远程实际 ID 是 checker-task-RECREATED，名称一致
	usedID, err := SyncUpdateCheckerTaskRemote(context.Background(), "checker-task-OLD", "stale-id-task", "https://example.com/repo.git", "main", "Go", nil)
	if err != nil {
		t.Fatalf("stale ID upsert should succeed, got: %v", err)
	}
	if putCount != 1 {
		t.Errorf("expected 1 PUT after stale-ID upsert, got %d", putCount)
	}
	if usedID != "checker-task-RECREATED" {
		t.Errorf("expected returned ID 'checker-task-RECREATED', got %q", usedID)
	}
}

// TestSyncUpdateCheckerTaskRemoteAmbiguous 验证：远程查询返回多条结果且 ID/名称均未精确匹配时，
// 必须中止更新（不得降级取第一条误更新无关任务）
func TestSyncUpdateCheckerTaskRemoteAmbiguous(t *testing.T) {
	origURL := models.AppConfig.PipelineSystem.CreateCheckerTaskURL
	origQueryURL := models.AppConfig.PipelineSystem.QueryCheckerTaskURL
	origBody := models.AppConfig.PipelineSystem.CreateCheckerTaskBody
	origRuleSets := models.AppConfig.PipelineSystem.RuleSets
	defer func() {
		models.AppConfig.PipelineSystem.CreateCheckerTaskURL = origURL
		models.AppConfig.PipelineSystem.QueryCheckerTaskURL = origQueryURL
		models.AppConfig.PipelineSystem.CreateCheckerTaskBody = origBody
		models.AppConfig.PipelineSystem.RuleSets = origRuleSets
	}()

	var putCount int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{
				"status": "success",
				"result": {
					"info": [
						{
							"id": "task-A",
							"name": "Daily-Build",
							"repoURL": "https://example.com/repo.git",
							"branchName": "main",
							"configTemplateId": "tmpl-a"
						},
						{
							"id": "task-B",
							"name": "Daily-Build-2",
							"repoURL": "https://example.com/repo.git",
							"branchName": "dev",
							"configTemplateId": "tmpl-b"
						}
					]
				}
			}`))
			return
		}
		if r.Method == "PUT" {
			putCount++
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"status": "success"}`))
			return
		}
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer server.Close()

	models.AppConfig.PipelineSystem.CreateCheckerTaskURL = server.URL
	models.AppConfig.PipelineSystem.QueryCheckerTaskURL = server.URL
	models.AppConfig.PipelineSystem.CreateCheckerTaskBody = `{
		"id": "{TEMPLATE_ID}",
		"name": "{NAME}"
	}`
	models.AppConfig.PipelineSystem.RuleSets = map[string]string{"GO": "go_rule_1"}

	// 传入的 taskID/taskName 均不在查询结果中（模糊搜索命中两条无关任务）
	usedID, err := SyncUpdateCheckerTaskRemote(context.Background(), "task-X", "Nightly-Build", "https://example.com/repo.git", "main", "Go", nil)
	if err == nil {
		t.Fatalf("ambiguous result should abort with error, but returned success, usedID=%q, putCount=%d", usedID, putCount)
	}
	if putCount != 0 {
		t.Errorf("expected no PUT on ambiguous result, got %d", putCount)
	}
}

// TestSyncUpdateCheckerTaskRemoteCachedIDMiss 验证：本地缓存了 taskID 但按名称查询不到任务时，
// 必须中止并告警，不得回退新建（否则会在任务被改名/删除的场景下制造重复任务）
func TestSyncUpdateCheckerTaskRemoteCachedIDMiss(t *testing.T) {
	origURL := models.AppConfig.PipelineSystem.CreateCheckerTaskURL
	origQueryURL := models.AppConfig.PipelineSystem.QueryCheckerTaskURL
	origBody := models.AppConfig.PipelineSystem.CreateCheckerTaskBody
	origRuleSets := models.AppConfig.PipelineSystem.RuleSets
	defer func() {
		models.AppConfig.PipelineSystem.CreateCheckerTaskURL = origURL
		models.AppConfig.PipelineSystem.QueryCheckerTaskURL = origQueryURL
		models.AppConfig.PipelineSystem.CreateCheckerTaskBody = origBody
		models.AppConfig.PipelineSystem.RuleSets = origRuleSets
	}()

	var postCount, putCount int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"status": "success", "result": {"info": []}}`))
			return
		}
		if r.Method == "POST" {
			postCount++
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"status": "success"}`))
			return
		}
		if r.Method == "PUT" {
			putCount++
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"status": "success"}`))
			return
		}
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer server.Close()

	models.AppConfig.PipelineSystem.CreateCheckerTaskURL = server.URL
	models.AppConfig.PipelineSystem.QueryCheckerTaskURL = server.URL
	models.AppConfig.PipelineSystem.CreateCheckerTaskBody = `{
		"id": "{TEMPLATE_ID}",
		"name": "{NAME}"
	}`
	models.AppConfig.PipelineSystem.RuleSets = map[string]string{"GO": "go_rule_1"}

	// DB 缓存 ID 存在但查询按名称 miss（任务被改名/删除）→ 中止，不得回退新建
	usedID, err := SyncUpdateCheckerTaskRemote(context.Background(), "checker-task-CACHED", "renamed-scheme", "https://example.com/repo.git", "main", "Go", nil)
	if err == nil {
		t.Fatalf("cached-ID miss should abort with error, but returned success, usedID=%q", usedID)
	}
	if postCount != 0 || putCount != 0 {
		t.Errorf("expected no POST/PUT on cached-ID miss, got postCount=%d putCount=%d", postCount, putCount)
	}
}

func TestSyncDeleteExecutionScheme_LastSchemeDeletesCheckerTask(t *testing.T) {
	origDeleteCheckerURL := models.AppConfig.PipelineSystem.DeleteCheckerTaskURL
	origSchemeURL := models.AppConfig.PipelineSystem.GetExecutionSchemeURL
	defer func() {
		models.AppConfig.PipelineSystem.DeleteCheckerTaskURL = origDeleteCheckerURL
		models.AppConfig.PipelineSystem.GetExecutionSchemeURL = origSchemeURL
	}()

	var checkerTaskDeleted bool
	var deletedTaskIDs []string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "DELETE" && r.URL.Path == "/delete-checker-task" {
			checkerTaskDeleted = true
			bodyBytes, _ := io.ReadAll(r.Body)
			var payload map[string][]string
			json.Unmarshal(bodyBytes, &payload)
			deletedTaskIDs = payload["taskIds"]
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"status":"success"}`))
			return
		}
		if r.Method == "DELETE" {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"status":"success"}`))
			return
		}
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer server.Close()

	models.AppConfig.PipelineSystem.DeleteCheckerTaskURL = server.URL + "/delete-checker-task"
	models.AppConfig.PipelineSystem.GetExecutionSchemeURL = server.URL + "/schemes/delete"

	// 初始化测试 DB 数据
	repo := models.Repository{
		ID:                  9991,
		Name:                "test-repo-delete-checker",
		CodeCheckerTaskID:   "checker-task-9991",
		CodeCheckerTaskName: "test-repo-delete-checker",
	}
	database.DB.Delete(&models.ExecutionScheme{}, "repository_id = ?", 9991)
	database.DB.Delete(&models.Repository{}, "id = ?", 9991)

	if err := database.DB.Create(&repo).Error; err != nil {
		t.Fatalf("Failed to create test repo: %v", err)
	}
	defer database.DB.Delete(&models.Repository{}, "id = ?", 9991)

	scheme1 := models.ExecutionScheme{
		ID:                9991,
		Name:              "scheme-1",
		RepositoryID:      9991,
		ExecutionSchemeID: "ext-scheme-1",
		CodeCheckerTaskID: "checker-task-9991",
	}
	scheme2 := models.ExecutionScheme{
		ID:                9992,
		Name:              "scheme-2",
		RepositoryID:      9991,
		ExecutionSchemeID: "ext-scheme-2",
		CodeCheckerTaskID: "checker-task-9991",
	}

	database.DB.Create(&scheme1)
	database.DB.Create(&scheme2)
	defer func() {
		database.DB.Delete(&models.ExecutionScheme{}, "id IN ?", []uint{9991, 9992})
	}()

	// 1. 删除 Scheme 1（仓库仍有 Scheme 2，不应触发删除代码检查任务）
	if err := SyncDeleteExecutionSchemeRemote(scheme1, nil); err != nil {
		t.Fatalf("SyncDeleteExecutionSchemeRemote for scheme1 failed: %v", err)
	}
	if checkerTaskDeleted {
		t.Errorf("Expected checker task NOT to be deleted when other scheme exists, but it was deleted")
	}
	database.DB.Delete(&scheme1)

	// 2. 删除 Scheme 2（仓库最后一个执行方案，必须触发删除代码检查任务并清理 Repo 缓存）
	if err := SyncDeleteExecutionSchemeRemote(scheme2, nil); err != nil {
		t.Fatalf("SyncDeleteExecutionSchemeRemote for scheme2 failed: %v", err)
	}
	if !checkerTaskDeleted {
		t.Errorf("Expected checker task to be deleted for last scheme of repository, but it was not")
	}
	if len(deletedTaskIDs) != 1 || deletedTaskIDs[0] != "checker-task-9991" {
		t.Errorf("Expected deleted taskIds ['checker-task-9991'], got %v", deletedTaskIDs)
	}

	database.DB.Delete(&scheme2)

	// 验证 Repository 的 code_checker_task_id 是否已被重置为空
	var updatedRepo models.Repository
	if err := database.DB.First(&updatedRepo, 9991).Error; err == nil {
		if updatedRepo.CodeCheckerTaskID != "" || updatedRepo.CodeCheckerTaskName != "" {
			t.Errorf("Expected repo CodeCheckerTaskID/Name to be cleared, got ID=%q Name=%q", updatedRepo.CodeCheckerTaskID, updatedRepo.CodeCheckerTaskName)
		}
	}
}




