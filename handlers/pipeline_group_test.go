package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"code-pipeline/database"
	"code-pipeline/models"

	"github.com/gin-gonic/gin"
)

func TestCreateExecutionScheme_RoutingPriorityAndNoFallback(t *testing.T) {
	gin.SetMode(gin.TestMode)
	setupTestDB(t)

	// 设置 Mock 三方服务
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet {
			if strings.Contains(r.URL.RawQuery, "pipelineId") {
				w.WriteHeader(http.StatusOK)
				w.Write([]byte(`{
					"status": "success",
					"entities": [
						{"id": "ext-scheme-123", "name": "scheme-by-group"},
						{"id": "ext-scheme-456", "name": "scheme-by-specific-pipeline"}
					]
				}`))
				return
			}
			if strings.Contains(r.URL.RawQuery, "search") {
				w.WriteHeader(http.StatusOK)
				w.Write([]byte(`{
					"status": "success",
					"result": {
						"info": [
							{"id": "mock-task-123", "name": "scheme-by-group"},
							{"id": "mock-task-456", "name": "scheme-by-specific-pipeline"}
						]
					}
				}`))
				return
			}
			// RepoAuthCheck
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"status": "success", "entities": [{"id": "cred-123"}]}`))
			return
		}
		// POST 创建各类三方资源
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"success","result":"success","id":"mock-task-123","execution_scheme_id":"ext-scheme-123","mr_binding_id":"mr-binding-123"}`))
	}))
	defer mockServer.Close()

	oldTaskURL := models.AppConfig.PipelineSystem.CreateCheckerTaskURL
	oldQueryTaskURL := models.AppConfig.PipelineSystem.QueryCheckerTaskURL
	oldGetSchemeURL := models.AppConfig.PipelineSystem.GetExecutionSchemeURL
	oldCreateSchemeURL := models.AppConfig.PipelineSystem.CreateExecutionSchemeURL
	oldBindingURL := models.AppConfig.PipelineSystem.CreateMRBindingURL
	oldPlanURL := models.AppConfig.PipelineSystem.CreateExecutionPlanURL
	oldGetPlanURL := models.AppConfig.PipelineSystem.GetExecutionPlanURL
	oldCheckRepoURL := models.AppConfig.PipelineSystem.RepoAuthCheckURL

	models.AppConfig.PipelineSystem.CreateCheckerTaskURL = mockServer.URL
	models.AppConfig.PipelineSystem.QueryCheckerTaskURL = mockServer.URL
	models.AppConfig.PipelineSystem.GetExecutionSchemeURL = mockServer.URL
	models.AppConfig.PipelineSystem.CreateExecutionSchemeURL = mockServer.URL
	models.AppConfig.PipelineSystem.CreateMRBindingURL = mockServer.URL
	models.AppConfig.PipelineSystem.CreateExecutionPlanURL = mockServer.URL
	models.AppConfig.PipelineSystem.GetExecutionPlanURL = mockServer.URL
	models.AppConfig.PipelineSystem.RepoAuthCheckURL = mockServer.URL

	defer func() {
		models.AppConfig.PipelineSystem.CreateCheckerTaskURL = oldTaskURL
		models.AppConfig.PipelineSystem.QueryCheckerTaskURL = oldQueryTaskURL
		models.AppConfig.PipelineSystem.GetExecutionSchemeURL = oldGetSchemeURL
		models.AppConfig.PipelineSystem.CreateExecutionSchemeURL = oldCreateSchemeURL
		models.AppConfig.PipelineSystem.CreateMRBindingURL = oldBindingURL
		models.AppConfig.PipelineSystem.CreateExecutionPlanURL = oldPlanURL
		models.AppConfig.PipelineSystem.GetExecutionPlanURL = oldGetPlanURL
		models.AppConfig.PipelineSystem.RepoAuthCheckURL = oldCheckRepoURL
	}()

	// 1. 创建测试 Repo (满足外键)
	var dept models.Department
	_ = database.DB.First(&dept)
	deptID := dept.ID
	if deptID == 0 {
		deptID = 1
	}
	var user models.User
	_ = database.DB.First(&user)
	ownerID := user.ID
	if ownerID == 0 {
		ownerID = 1
	}

	repo := models.Repository{
		ID:           9988,
		DepartmentID: deptID,
		OwnerID:      ownerID,
		Name:         "test-handler-repo",
	}
	database.DB.Delete(&models.ExecutionScheme{}, "repository_id = ?", 9988)
	database.DB.Delete(&models.Repository{}, 9988)
	database.DB.Create(&repo)
	defer database.DB.Delete(&models.Repository{}, 9988)
	defer database.DB.Delete(&models.ExecutionScheme{}, "repository_id = ?", 9988)

	// 2. 创建测试流水线组
	groupKey := fmt.Sprintf("test-h-group-%d", time.Now().UnixNano())
	group := models.PipelineGroup{
		GroupKey: groupKey,
		Name:     "Handler测试组",
		Type:     "MR",
		IsActive: true,
	}
	database.DB.Create(&group)
	defer database.DB.Delete(&group)

	// 3. 创建两条属于该组的物理流水线
	p1 := models.Pipeline{
		PipelineID: fmt.Sprintf("pipe-h-1-%d", time.Now().UnixNano()),
		Name:       "Node-1",
		Type:       "MR",
		GroupID:    &group.ID,
		Status:     "active",
	}
	p2 := models.Pipeline{
		PipelineID: fmt.Sprintf("pipe-h-2-%d", time.Now().UnixNano()),
		Name:       "Node-2",
		Type:       "MR",
		GroupID:    &group.ID,
		Status:     "active",
	}
	database.DB.Create(&p1)
	database.DB.Create(&p2)
	defer database.DB.Delete(&p1)
	defer database.DB.Delete(&p2)

	r := gin.New()
	r.POST("/api/execution-schemes", CreateExecutionScheme)

	// 场景 A: 既不传 group_id 也不传 pipeline_id -> 必须直接返回 400 (不做兜底)
	{
		body, _ := json.Marshal(map[string]interface{}{
			"repository_id": repo.ID,
			"name":          "scheme-no-target",
			"branchs":       "master",
			"languages":     "Go",
		})
		req, _ := http.NewRequest(http.MethodPost, "/api/execution-schemes", bytes.NewBuffer(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Fatalf("预期返回 400 Bad Request, 实际返回: %d, body: %s", w.Code, w.Body.String())
		}
	}

	mrTriggerFalse := false
	dailyBuildFalse := false

	// 场景 B: 仅传 group_id -> 组智能调度分配 (当前两节点均为0，分配至 Node-1)
	{
		body, _ := json.Marshal(map[string]interface{}{
			"repository_id": repo.ID,
			"group_id":      group.ID,
			"name":          "scheme-by-group",
			"branchs":       "master",
			"languages":     "Go",
			"mr_trigger":    &mrTriggerFalse,
			"daily_build":   &dailyBuildFalse,
		})
		req, _ := http.NewRequest(http.MethodPost, "/api/execution-schemes", bytes.NewBuffer(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusCreated {
			t.Fatalf("按组创建方案失败, status: %d, body: %s", w.Code, w.Body.String())
		}

		var created models.ExecutionScheme
		database.DB.Where("name = ?", "scheme-by-group").First(&created)
		if created.LocalPipelineID != p1.ID {
			t.Fatalf("预期智能分配至 Node-1 (%d), 实际分配至: %d", p1.ID, created.LocalPipelineID)
		}
	}

	// 场景 C: 同时传 group_id 和 pipeline_id (指定 Node-2) -> pipeline_id 优先覆盖
	{
		body, _ := json.Marshal(map[string]interface{}{
			"repository_id": repo.ID,
			"group_id":      group.ID,
			"pipeline_id":   p2.ID,
			"name":          "scheme-by-specific-pipeline",
			"branchs":       "master",
			"languages":     "Go",
			"mr_trigger":    &mrTriggerFalse,
			"daily_build":   &dailyBuildFalse,
		})
		req, _ := http.NewRequest(http.MethodPost, "/api/execution-schemes", bytes.NewBuffer(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusCreated {
			t.Fatalf("指定物理流水线创建方案失败, status: %d, body: %s", w.Code, w.Body.String())
		}

		var created models.ExecutionScheme
		database.DB.Where("name = ?", "scheme-by-specific-pipeline").First(&created)
		if created.LocalPipelineID != p2.ID {
			t.Fatalf("预期精准绑定至 Node-2 (%d), 实际绑定至: %d", p2.ID, created.LocalPipelineID)
		}
	}
}

func TestAttachPipelinesToGroup_TypeValidation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	setupTestDB(t)

	// 创建 MR 类型的测试组
	group := models.PipelineGroup{
		GroupKey: fmt.Sprintf("test-type-group-%d", time.Now().UnixNano()),
		Name:     "MR同质性测试组",
		Type:     "MR",
		IsActive: true,
	}
	database.DB.Create(&group)
	defer database.DB.Delete(&group)

	// 创建一个 MR 流水线和一个 每日构建 流水线
	pMr := models.Pipeline{
		PipelineID: fmt.Sprintf("p-mr-%d", time.Now().UnixNano()),
		Name:       "MR-Pipeline",
		Type:       "MR",
	}
	pDaily := models.Pipeline{
		PipelineID: fmt.Sprintf("p-daily-%d", time.Now().UnixNano()),
		Name:       "Daily-Pipeline",
		Type:       "每日构建",
	}
	database.DB.Create(&pMr)
	database.DB.Create(&pDaily)
	defer database.DB.Delete(&pMr)
	defer database.DB.Delete(&pDaily)

	r := gin.New()
	r.POST("/api/pipeline-groups/:id/pipelines", AttachDetachPipelinesToGroup)

	// 1. 尝试将异质流水线 (每日构建) 加入 MR 组 -> 必须返回 400 且提示类型不匹配
	{
		body, _ := json.Marshal(AttachDetachPipelinesRequest{
			PipelineIDs: []uint{pDaily.ID},
			Action:      "attach",
		})
		req, _ := http.NewRequest(http.MethodPost, fmt.Sprintf("/api/pipeline-groups/%d/pipelines", group.ID), bytes.NewBuffer(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Fatalf("预期类型不匹配返回 400, 实际返回: %d, body: %s", w.Code, w.Body.String())
		}
	}

	// 2. 将同质流水线 (MR) 加入 MR 组 -> 成功
	{
		body, _ := json.Marshal(AttachDetachPipelinesRequest{
			PipelineIDs: []uint{pMr.ID},
			Action:      "attach",
		})
		req, _ := http.NewRequest(http.MethodPost, fmt.Sprintf("/api/pipeline-groups/%d/pipelines", group.ID), bytes.NewBuffer(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("同质流水线加入组失败, status: %d, body: %s", w.Code, w.Body.String())
		}

		var checkP models.Pipeline
		database.DB.First(&checkP, pMr.ID)
		if checkP.GroupID == nil || *checkP.GroupID != group.ID {
			t.Fatalf("流水线 group_id 未正确更新")
		}
	}
}
