package services

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"code-pipeline/database"
	"code-pipeline/models"

	"gorm.io/datatypes"
)

func setupComplianceTestDB(t *testing.T) {
	_ = models.LoadConfig("../config.yaml")
	database.InitDB()

	// 清理可能遗留的测试数据
	database.DB.Exec("DELETE FROM managed_repositories WHERE id = 101")
	database.DB.Exec("DELETE FROM managed_protected_branch_rules WHERE managed_repository_id = 101")
	database.DB.Exec("DELETE FROM repo_compliance_reports WHERE managed_repository_id = 101")
}

func TestDefaultComplianceRules(t *testing.T) {
	rules := DefaultComplianceRules()
	if len(rules) < 20 {
		t.Fatalf("Expected at least 20 default compliance rules, got %d", len(rules))
	}

	dimSet := make(map[string]bool)
	for _, r := range rules {
		dimSet[r.Dimension] = true
	}

	expectedDims := []string{
		"global_config",
		"mr_review_security",
		"quality_gate",
		"traceability",
		"branch_protection",
		"branch_hygiene",
		"ownership",
		"engineering",
	}

	for _, dim := range expectedDims {
		if !dimSet[dim] {
			t.Errorf("Expected dimension %s to be present in default rules", dim)
		}
	}
}

func TestEnsureDefaultBaselineAndGetGlobalBaseline(t *testing.T) {
	setupComplianceTestDB(t)

	// 第一次调用生成默认基线
	baseline, err := GetGlobalBaseline()
	if err != nil {
		t.Fatalf("GetGlobalBaseline failed: %v", err)
	}

	if baseline == nil || baseline.Name != "通用合规基线" {
		t.Fatalf("Expected baseline name '通用合规基线', got %v", baseline)
	}

	var rules []models.ComplianceRule
	if err := json.Unmarshal(baseline.Rules, &rules); err != nil {
		t.Fatalf("Failed to unmarshal baseline rules: %v", err)
	}

	if len(rules) < 20 {
		t.Errorf("Expected >= 20 rules, got %d", len(rules))
	}

	// 验证规则热迁移逻辑：当存量数据少规则时，再次 GetGlobalBaseline 会自动补齐
	partialRules := []models.ComplianceRule{
		{Dimension: "global_config", CheckKey: "private_repo_required", Label: "私有代码仓", Severity: "critical", Enabled: true},
	}
	partialJSON, _ := json.Marshal(partialRules)
	database.DB.Model(&models.ComplianceBaseline{}).Where("id = ?", baseline.ID).Update("rules", datatypes.JSON(partialJSON))

	reloaded, err := GetGlobalBaseline()
	if err != nil {
		t.Fatalf("Reload failed: %v", err)
	}

	var reloadedRules []models.ComplianceRule
	_ = json.Unmarshal(reloaded.Rules, &reloadedRules)
	if len(reloadedRules) < len(DefaultComplianceRules()) {
		t.Errorf("Expected missing rules to be automatically filled, got %d rules", len(reloadedRules))
	}
}

func TestAuditRepoComplianceWithMockServer(t *testing.T) {
	setupComplianceTestDB(t)

	// Mock Remote Git Server
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/projects/101" {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{
				"id": 101,
				"name": "test-repo",
				"description": "A demo test repo",
				"visibility": "private",
				"security": "inner_source",
				"request_access_enabled": false,
				"main_repository_language": "Go",
				"statistics": {
					"storage_size": 15.5
				}
			}`))
			return
		}

		if r.URL.Path == "/projects/101/merge_requests/settings" {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{
				"merge_request_setting": {
					"id": 501,
					"project_id": 101,
					"disable_merge_by_self": true,
					"can_force_merge": false,
					"reset_approvals_on_push": true,
					"approval_required_approvers": 2,
					"must_pass_quality_gate": true,
					"mr_codecheck": true,
					"forced_rebuild_pipeline_before_merge": true,
					"must_relate_issue": true,
					"need_all_issues_check_passed": true,
					"delete_source_branch_when_merged": true
				},
				"only_allow_merge_if_all_discussions_are_resolved": true,
				"only_allow_merge_if_pipeline_succeeds": true
			}`))
			return
		}

		if r.URL.Path == "/projects/101/members" {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`[
				{
					"id": 405,
					"username": "u00000001",
					"name_cn": "用户A",
					"domain_group": "GROUP-A",
					"new_member_roles": [
						{
							"access_level": 30,
							"role_name": "Developer"
						}
					]
				},
				{
					"id": 14049,
					"username": "u00000002",
					"name_cn": "用户B",
					"domain_group": "GROUP-B",
					"committer_system_from": true,
					"new_member_roles": [
						{
							"access_level": 40,
							"role_name": "Committer"
						}
					]
				}
			]`))
			return
		}

		http.NotFound(w, r)
	}))
	defer mockServer.Close()

	// 临时将 GitPlatformBaseURL 指向 Mock Server
	origBaseURL := GitPlatformBaseURL
	GitPlatformBaseURL = mockServer.URL
	defer func() {
		GitPlatformBaseURL = origBaseURL
	}()

	// 准备本地被管代码仓及保护分支
	depID := uint(1)
	subID := uint(2)
	repo := models.ManagedRepository{
		ID:                 101,
		Name:               "test-repo",
		OwnerID:            10,
		DepartmentID:       &depID,
		SubsystemID:        &subID,
		Language:           "Go",
		Description:        "A demo test repo",
		DefaultBranch:      "master",
		WebhookRegistered:  true,
		BranchCount:        3,
		StaleUnmergedCount: 1,
		StaleMergedCount:   2,
		CreatedAt:          time.Now(),
	}
	database.DB.Create(&repo)

	database.DB.Create(&models.ManagedProtectedBranchRule{
		ManagedRepositoryID: 101,
		BranchPattern:       "master",
		AllowForcePush:      false,
		RequireMrAudit:      true,
	})

	baseline, err := GetGlobalBaseline()
	if err != nil {
		t.Fatalf("Failed to get baseline: %v", err)
	}

	report, err := AuditRepoCompliance(context.Background(), &repo, baseline)
	if err != nil {
		t.Fatalf("AuditRepoCompliance returned error: %v", err)
	}

	if report.Score < 90 {
		t.Errorf("Expected high compliance score (>= 90), got %d (Grade: %s)", report.Score, report.Grade)
	}

	var results []models.ComplianceCheckResult
	if err := json.Unmarshal(report.Details, &results); err != nil {
		t.Fatalf("Failed to parse report details: %v", err)
	}

	checkMap := make(map[string]models.ComplianceCheckResult)
	for _, r := range results {
		checkMap[r.CheckKey] = r
	}

	// 检查核心规则校验结果
	if r, ok := checkMap["disable_merge_by_self"]; !ok || !r.Passed {
		t.Errorf("Expected disable_merge_by_self to pass, got %+v", r)
	}
	if r, ok := checkMap["reset_approvals_on_push"]; !ok || !r.Passed {
		t.Errorf("Expected reset_approvals_on_push to pass, got %+v", r)
	}
	if r, ok := checkMap["pipeline_succeed_required"]; !ok || !r.Passed {
		t.Errorf("Expected pipeline_succeed_required to pass, got %+v", r)
	}
	if r, ok := checkMap["must_relate_issue"]; !ok || !r.Passed {
		t.Errorf("Expected must_relate_issue to pass, got %+v", r)
	}
	if r, ok := checkMap["committer_group_required"]; !ok || !r.Passed {
		t.Errorf("Expected committer_group_required to pass, got %+v", r)
	}
}
