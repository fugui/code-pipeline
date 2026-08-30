package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"code-common/backend/testdb"
	"code-pipeline/database"
	"code-pipeline/internal/testutil"
	"code-pipeline/models"

	"github.com/gin-gonic/gin"
)

func setupTestDB(t *testing.T) {
	// handlers 的部分逻辑依赖 config.yaml 中的默认配置（如三方系统 body 模板），
	// 这里显式加载配置；数据库本身使用隔离临时库，不读取 config 中的 DSN。
	_ = models.LoadConfig("../config.yaml")

	oldDB := database.DB
	t.Cleanup(func() { database.DB = oldDB })

	db := testdb.SetupIsolatedDB(t, "pipeline_execution", testutil.PipelineModels()...)
	if db == nil {
		return
	}
	database.DB = db
}

func TestReportExecutionLogAndDashboardStats(t *testing.T) {
	gin.SetMode(gin.TestMode)
	setupTestDB(t)

	r := gin.New()
	api := r.Group("/api")
	{
		api.POST("/v1/report/code-check-log", ReportExecutionLog)
		api.GET("/dashboard/stats", GetDashboardStats)
	}

	payload := map[string]interface{}{
		"task_id":              "check_task_test_001",
		"task_type":            "code_check",
		"code_checker_task_id": "checker_task_8891",
		"repo_url":             "http://192.168.56.18:9080/tech/infra/auth-service.git",
		"branch":               "feature/auth-v2",
		"commit_id":            "a1b2c3d4e5f678901234567890abcdef12345678",
		"status":               "success",
		"duration_sec":         90,
		"trigger_type":         "mr",
		"trigger_user":         "lisi",
		"code_check_details": map[string]interface{}{
			"gate_status":           "passed",
			"lines_scanned":         15420,
			"files_scanned":         86,
			"total_issues":          4,
			"fatal_issues":          0,
			"critical_issues":       1,
			"major_issues":          3,
			"minor_issues":          0,
			"code_duplication_rate": "1.2%",
			"checker_report_url":    "http://192.168.56.18:9080/shield/public/report/checker_task_8891",
		},
		"log_content":      "2026-07-24 14:00:01 [INFO] Starting static code analysis...",
		"external_log_url": "http://192.168.56.18:9080/pipelines/check-logs/check_task_test_001",
	}

	payloadBytes, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", "/api/v1/report/code-check-log", bytes.NewBuffer(payloadBytes))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d, body: %s", w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if code, ok := resp["code"].(float64); !ok || code != 0 {
		t.Fatalf("Expected response code 0, got %v", resp["code"])
	}

	// 校验 Dashboard 状态列表
	reqStats, _ := http.NewRequest("GET", "/api/dashboard/stats", nil)
	wStats := httptest.NewRecorder()
	r.ServeHTTP(wStats, reqStats)

	if wStats.Code != http.StatusOK {
		t.Fatalf("Expected stats status 200, got %d", wStats.Code)
	}

	var statsResp map[string]interface{}
	_ = json.Unmarshal(wStats.Body.Bytes(), &statsResp)
	recentRuns, ok := statsResp["recent_runs"].([]interface{})
	if !ok || len(recentRuns) == 0 {
		t.Fatalf("Expected non-empty recent_runs in stats response")
	}

	firstRun := recentRuns[0].(map[string]interface{})
	if firstRun["task_id"] != "check_task_test_001" {
		t.Errorf("Expected first run task_id to be 'check_task_test_001', got '%v'", firstRun["task_id"])
	}
	if firstRun["task_type"] != "code_check" {
		t.Errorf("Expected task_type 'code_check', got '%v'", firstRun["task_type"])
	}
}

func TestReportExecutionLogAndWebhookAuditSkip(t *testing.T) {
	gin.SetMode(gin.TestMode)
	setupTestDB(t)

	r := gin.New()
	// 验证请求经过审计中间件后，会被 Skip(c) 成功跳过
	skippedCheckLogged := false
	r.Use(func(c *gin.Context) {
		c.Next()
		if skipVal, exists := c.Get("audit_skip"); exists {
			if skip, ok := skipVal.(bool); ok && skip {
				skippedCheckLogged = true
			}
		}
	})

	api := r.Group("/api")
	{
		api.POST("/v1/report/code-check-log", ReportExecutionLog)
		api.POST("/webhook", HandleWebhook)
	}

	// 1. 测试 code-check-log 跳过审计
	payload := map[string]interface{}{
		"task_id":      "check_task_audit_skip_001",
		"task_type":    "code_check",
		"repo_url":     "http://192.168.56.18:9080/tech/infra/demo.git",
		"branch":       "master",
		"status":       "success",
		"duration_sec": 10,
	}
	payloadBytes, _ := json.Marshal(payload)
	reqLog, _ := http.NewRequest("POST", "/api/v1/report/code-check-log", bytes.NewBuffer(payloadBytes))
	reqLog.Header.Set("Content-Type", "application/json")
	wLog := httptest.NewRecorder()
	skippedCheckLogged = false
	r.ServeHTTP(wLog, reqLog)

	if !skippedCheckLogged {
		t.Errorf("expected audit_skip to be true for ReportExecutionLog, got false")
	}

	// 2. 测试 webhook 跳过审计
	webhookPayload := map[string]interface{}{
		"object_kind": "merge_request",
		"project": map[string]string{
			"name":         "test-repo",
			"git_http_url": "http://192.168.56.18:9080/tech/demo.git",
		},
		"user": map[string]string{
			"name": "developer",
		},
		"object_attributes": map[string]interface{}{
			"id":            1,
			"source_branch": "feature/1",
			"target_branch": "master",
			"action":        "open",
			"url":           "http://192.168.56.18:9080/tech/demo/merge_requests/1",
		},
	}
	whBytes, _ := json.Marshal(webhookPayload)
	reqWh, _ := http.NewRequest("POST", "/api/webhook", bytes.NewBuffer(whBytes))
	reqWh.Header.Set("Content-Type", "application/json")
	wWh := httptest.NewRecorder()
	skippedCheckLogged = false
	r.ServeHTTP(wWh, reqWh)

	if !skippedCheckLogged {
		t.Errorf("expected audit_skip to be true for HandleWebhook, got false")
	}
}
