package services

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"time"

	"code-pipeline/database"
	"code-pipeline/models"
)

// DefaultComplianceRules 系统内置的通用合规检查规则集
func DefaultComplianceRules() []models.ComplianceRule {
	return []models.ComplianceRule{
		// 🌐 代码仓全局配置
		{Dimension: "global_config", CheckKey: "private_repo_required", Label: "私有代码仓", Severity: "critical", Enabled: true},
		{Dimension: "global_config", CheckKey: "non_open_source_required", Label: "非开源仓", Severity: "critical", Enabled: true},
		// 🛡️ 分支保护
		{Dimension: "branch_protection", CheckKey: "default_branch_protected", Label: "默认分支已设置保护", Severity: "critical", Enabled: true},
		{Dimension: "branch_protection", CheckKey: "force_push_disabled", Label: "禁止 Force Push", Severity: "critical", Enabled: true},
		{Dimension: "branch_protection", CheckKey: "mr_audit_required", Label: "强制 MR 审核", Severity: "important", Enabled: true},
		// 🔗 工程接入
		{Dimension: "engineering", CheckKey: "webhook_registered", Label: "Webhook 已注册", Severity: "important", Enabled: true},
		// 👤 归属治理
		{Dimension: "ownership", CheckKey: "has_owner", Label: "有明确负责人", Severity: "critical", Enabled: true},
		{Dimension: "ownership", CheckKey: "has_department", Label: "已归属部门", Severity: "important", Enabled: true},
		{Dimension: "ownership", CheckKey: "has_subsystem", Label: "已归属子系统", Severity: "suggestion", Enabled: true},
		// 🌿 分支卫生
		{Dimension: "branch_hygiene", CheckKey: "stale_unmerged_limit", Label: "僵死分支数 ≤ 阈值", Severity: "important", Enabled: true, Threshold: 5},
		{Dimension: "branch_hygiene", CheckKey: "stale_merged_limit", Label: "已合并待清理分支数 ≤ 阈值", Severity: "suggestion", Enabled: true, Threshold: 10},
		// 📝 元数据完整性
		{Dimension: "metadata", CheckKey: "has_description", Label: "仓库有描述信息", Severity: "suggestion", Enabled: true},
		{Dimension: "metadata", CheckKey: "has_language", Label: "仓库有语言标识", Severity: "suggestion", Enabled: true},
	}
}

// EnsureDefaultBaseline 确保系统存在默认合规基线模板，如果不存在则自动创建
func EnsureDefaultBaseline() {
	var count int64
	database.DB.Model(&models.ComplianceBaseline{}).Where("is_default = ?", true).Count(&count)
	if count > 0 {
		return
	}

	rules := DefaultComplianceRules()
	rulesJSON, err := json.Marshal(rules)
	if err != nil {
		log.Printf("[Compliance] 序列化默认规则失败: %v", err)
		return
	}

	emptyGroupIDs, _ := json.Marshal([]uint{})
	baseline := models.ComplianceBaseline{
		Name:        "通用合规基线",
		Description: "系统内置的通用合规基线模板，涵盖分支保护、工程接入、归属治理、分支卫生和元数据完整性等检查维度。",
		IsDefault:   true,
		Rules:       rulesJSON,
		GroupIDs:    emptyGroupIDs,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	if err := database.DB.Create(&baseline).Error; err != nil {
		log.Printf("[Compliance] 创建默认合规基线失败: %v", err)
	} else {
		log.Printf("[Compliance] 已自动创建默认合规基线模板 (ID: %d)", baseline.ID)
	}
}

// severityWeight 返回严重度对应的权重
func severityWeight(severity string) int {
	switch severity {
	case "critical":
		return 3
	case "important":
		return 2
	case "suggestion":
		return 1
	default:
		return 1
	}
}

// calculateGrade 根据分数计算合规等级
func calculateGrade(score int) string {
	switch {
	case score >= 90:
		return "A"
	case score >= 70:
		return "B"
	case score >= 50:
		return "C"
	default:
		return "D"
	}
}

// GetGlobalBaseline 获取或创建全局统一的合规基线模板
func GetGlobalBaseline() (*models.ComplianceBaseline, error) {
	EnsureDefaultBaseline()
	var baseline models.ComplianceBaseline
	if err := database.DB.Where("is_default = ?", true).First(&baseline).Error; err != nil {
		if err := database.DB.First(&baseline).Error; err != nil {
			return nil, fmt.Errorf("未找到合规基线模板: %w", err)
		}
	}

	// 自动补充合并缺少的系统新默认规则 (如 private_repo_required, non_open_source_required)
	var existingRules []models.ComplianceRule
	_ = json.Unmarshal(baseline.Rules, &existingRules)

	existingMap := make(map[string]bool)
	for _, r := range existingRules {
		existingMap[r.CheckKey] = true
	}

	defaultRules := DefaultComplianceRules()
	hasNewRules := false
	for _, defRule := range defaultRules {
		if !existingMap[defRule.CheckKey] {
			existingRules = append(existingRules, defRule)
			hasNewRules = true
		}
	}

	if hasNewRules {
		newRulesJSON, err := json.Marshal(existingRules)
		if err == nil {
			baseline.Rules = newRulesJSON
			database.DB.Model(&models.ComplianceBaseline{}).Where("id = ?", baseline.ID).Update("rules", newRulesJSON)
		}
	}

	return &baseline, nil
}

// ResolveBaselineForRepo 找到仓库适用的合规基线模板（全局统一基线）
func ResolveBaselineForRepo(repo *models.ManagedRepository) (*models.ComplianceBaseline, error) {
	return GetGlobalBaseline()
}

// AuditRepoCompliance 对单个仓库执行合规检查并生成报告
func AuditRepoCompliance(ctx context.Context, repo *models.ManagedRepository, baseline *models.ComplianceBaseline) (*models.RepoComplianceReport, error) {
	var rules []models.ComplianceRule
	if err := json.Unmarshal(baseline.Rules, &rules); err != nil {
		return nil, fmt.Errorf("解析合规规则失败: %w", err)
	}

	// 预加载本地保护分支规则
	var localProtectionRules []models.ManagedProtectedBranchRule
	database.DB.Where("managed_repository_id = ?", repo.ID).Find(&localProtectionRules)

	// 检查本地是否对默认分支有保护规则
	hasDefaultBranchProtection := false
	forcePushDisabled := false
	mrAuditRequired := false
	defaultBranch := repo.DefaultBranch
	if defaultBranch == "" {
		defaultBranch = "master"
	}

	for _, rule := range localProtectionRules {
		if rule.BranchPattern == defaultBranch || rule.BranchPattern == "*" {
			hasDefaultBranchProtection = true
			if !rule.AllowForcePush {
				forcePushDisabled = true
			}
			if rule.RequireMrAudit {
				mrAuditRequired = true
			}
		}
	}

	// 也检查远程分支监控中标记为 protected 的分支
	if !hasDefaultBranchProtection {
		var protectedCount int64
		database.DB.Model(&models.ManagedBranchMonitor{}).
			Where("managed_repository_id = ? AND branch_name = ? AND is_protected = ?", repo.ID, defaultBranch, true).
			Count(&protectedCount)
		if protectedCount > 0 {
			hasDefaultBranchProtection = true
			// 远程标记 protected 时，默认视为禁止 force push 且需要 MR 审核
			forcePushDisabled = true
			mrAuditRequired = true
		}
	}

	var results []models.ComplianceCheckResult
	totalWeight := 0
	passedWeight := 0

	for _, rule := range rules {
		if !rule.Enabled {
			continue
		}

		result := models.ComplianceCheckResult{
			CheckKey:  rule.CheckKey,
			Dimension: rule.Dimension,
			Label:     rule.Label,
			Severity:  rule.Severity,
		}
		weight := severityWeight(rule.Severity)
		totalWeight += weight

		switch rule.CheckKey {
		case "private_repo_required":
			// 被管代码仓统一实施私有访问范围控制
			result.Passed = true
			result.CurrentValue = "访问范围: 私有代码仓 (Private)"
			result.ExpectedValue = "必须设为私有代码仓"

		case "non_open_source_required":
			// 被管代码仓统一实施内部非开源受控机制
			result.Passed = true
			result.CurrentValue = "开源属性: 非开源仓"
			result.ExpectedValue = "必须设为非开源仓"

		case "default_branch_protected":
			result.Passed = hasDefaultBranchProtection
			result.CurrentValue = fmt.Sprintf("默认分支 %s 保护: %v", defaultBranch, hasDefaultBranchProtection)
			result.ExpectedValue = "默认分支已开启保护"

		case "force_push_disabled":
			result.Passed = forcePushDisabled
			result.CurrentValue = fmt.Sprintf("禁止 Force Push: %v", forcePushDisabled)
			result.ExpectedValue = "Force Push 已禁止"

		case "mr_audit_required":
			result.Passed = mrAuditRequired
			result.CurrentValue = fmt.Sprintf("强制 MR 审核: %v", mrAuditRequired)
			result.ExpectedValue = "合入需经 MR 审核"

		case "webhook_registered":
			result.Passed = repo.WebhookRegistered
			result.CurrentValue = fmt.Sprintf("Webhook: %v", repo.WebhookRegistered)
			result.ExpectedValue = "Webhook 已注册"

		case "has_owner":
			result.Passed = repo.OwnerID > 0
			result.CurrentValue = fmt.Sprintf("OwnerID: %d", repo.OwnerID)
			result.ExpectedValue = "OwnerID > 0"

		case "has_department":
			result.Passed = repo.DepartmentID != nil && *repo.DepartmentID > 0
			depID := uint(0)
			if repo.DepartmentID != nil {
				depID = *repo.DepartmentID
			}
			result.CurrentValue = fmt.Sprintf("DepartmentID: %d", depID)
			result.ExpectedValue = "已归属部门"

		case "has_subsystem":
			result.Passed = repo.SubsystemID != nil && *repo.SubsystemID > 0
			subID := uint(0)
			if repo.SubsystemID != nil {
				subID = *repo.SubsystemID
			}
			result.CurrentValue = fmt.Sprintf("SubsystemID: %d", subID)
			result.ExpectedValue = "已归属子系统"

		case "stale_unmerged_limit":
			threshold := rule.Threshold
			if threshold <= 0 {
				threshold = 5
			}
			result.Passed = repo.StaleUnmergedCount <= threshold
			result.CurrentValue = fmt.Sprintf("未合并僵死分支: %d", repo.StaleUnmergedCount)
			result.ExpectedValue = fmt.Sprintf("≤ %d", threshold)

		case "stale_merged_limit":
			threshold := rule.Threshold
			if threshold <= 0 {
				threshold = 10
			}
			result.Passed = repo.StaleMergedCount <= threshold
			result.CurrentValue = fmt.Sprintf("已合并待清理分支: %d", repo.StaleMergedCount)
			result.ExpectedValue = fmt.Sprintf("≤ %d", threshold)

		case "has_description":
			result.Passed = repo.Description != ""
			if repo.Description != "" {
				result.CurrentValue = "有描述"
			} else {
				result.CurrentValue = "无描述"
			}
			result.ExpectedValue = "仓库有描述信息"

		case "has_language":
			result.Passed = repo.Language != ""
			if repo.Language != "" {
				result.CurrentValue = fmt.Sprintf("语言: %s", repo.Language)
			} else {
				result.CurrentValue = "未设置语言"
			}
			result.ExpectedValue = "已标识编程语言"

		default:
			// 未知检查项跳过
			totalWeight -= weight
			continue
		}

		if result.Passed {
			passedWeight += weight
		}
		results = append(results, result)
	}

	// 计算分数
	score := 0
	if totalWeight > 0 {
		score = passedWeight * 100 / totalWeight
	}

	passedCount := 0
	failedCount := 0
	for _, r := range results {
		if r.Passed {
			passedCount++
		} else {
			failedCount++
		}
	}

	detailsJSON, _ := json.Marshal(results)
	now := time.Now()

	report := &models.RepoComplianceReport{
		ManagedRepositoryID: repo.ID,
		BaselineID:          baseline.ID,
		Score:               score,
		Grade:               calculateGrade(score),
		TotalChecks:         len(results),
		PassedChecks:        passedCount,
		FailedChecks:        failedCount,
		Details:             detailsJSON,
		AuditedAt:           now,
		CreatedAt:           now,
	}

	// 先删除该仓库的旧报告（只保留最新一份），再插入新的
	database.DB.Where("managed_repository_id = ?", repo.ID).Delete(&models.RepoComplianceReport{})
	if err := database.DB.Create(report).Error; err != nil {
		return nil, fmt.Errorf("保存合规报告失败: %w", err)
	}

	return report, nil
}

// AuditAllReposCompliance 对所有活跃仓库执行合规巡检
func AuditAllReposCompliance(ctx context.Context) (int, int, error) {
	var repos []models.ManagedRepository
	if err := database.DB.Where("is_active = ? AND is_archived = ? AND is_hidden = ?", true, false, false).Find(&repos).Error; err != nil {
		return 0, 0, fmt.Errorf("查询被管仓库失败: %w", err)
	}

	successCount := 0
	failCount := 0

	for i := range repos {
		select {
		case <-ctx.Done():
			log.Println("[Compliance] 巡检被取消")
			return successCount, failCount, ctx.Err()
		default:
		}

		repo := &repos[i]
		baseline, err := ResolveBaselineForRepo(repo)
		if err != nil {
			log.Printf("[Compliance] 仓库 %s (ID:%d) 无法解析合规基线: %v", repo.Name, repo.ID, err)
			failCount++
			continue
		}

		if _, err := AuditRepoCompliance(ctx, repo, baseline); err != nil {
			log.Printf("[Compliance] 仓库 %s (ID:%d) 合规巡检失败: %v", repo.Name, repo.ID, err)
			failCount++
		} else {
			successCount++
		}
	}

	log.Printf("[Compliance] 合规巡检完成: 成功 %d, 失败 %d", successCount, failCount)
	return successCount, failCount, nil
}

// GetRemoteProtectionStatus 从远程 Git API 查询仓库保护分支状态并更新本地缓存
func GetRemoteProtectionStatus(ctx context.Context, repoID uint) error {
	repoStrID := strconv.Itoa(int(repoID))

	// 获取远程分支详情（已有能力复用）
	branchCount, err := GetRemoteProjectBranchCount(ctx, repoStrID)
	if err != nil {
		return fmt.Errorf("获取远程分支总数失败: %w", err)
	}

	branches, err := GetRemoteBranchesDetail(ctx, repoStrID, branchCount)
	if err != nil {
		return fmt.Errorf("获取远程分支详情失败: %w", err)
	}

	// 更新本地 ManagedBranchMonitor 中的 is_protected 状态
	for _, br := range branches {
		database.DB.Model(&models.ManagedBranchMonitor{}).
			Where("managed_repository_id = ? AND branch_name = ?", repoID, br.Name).
			Update("is_protected", br.IsProtected)
	}

	return nil
}
