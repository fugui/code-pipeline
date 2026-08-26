package services

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"

	"code-pipeline/database"
	"code-pipeline/models"

	"gorm.io/datatypes"
)

// DefaultComplianceRules 系统内置的通用合规检查规则集 (6 大维度)
func DefaultComplianceRules() []models.ComplianceRule {
	return []models.ComplianceRule{
		// 🌐 代码仓全局配置与安全边界
		{Dimension: "global_config", CheckKey: "private_repo_required", Label: "私有代码仓", Severity: "critical", Enabled: true},
		{Dimension: "global_config", CheckKey: "non_open_source_required", Label: "非开源受控仓", Severity: "critical", Enabled: true},
		{Dimension: "global_config", CheckKey: "request_access_disabled", Label: "禁止随意申请权限", Severity: "important", Enabled: true},
		{Dimension: "global_config", CheckKey: "has_description", Label: "仓库有描述信息", Severity: "suggestion", Enabled: true},
		{Dimension: "global_config", CheckKey: "has_language", Label: "仓库有语言标识", Severity: "suggestion", Enabled: true},
		{Dimension: "global_config", CheckKey: "repo_storage_limit", Label: "仓库容量 ≤ 阈值(MB)", Severity: "suggestion", Enabled: true, Threshold: 2048},

		// 🛡️ MR 评审防线与防绕过红线
		{Dimension: "mr_review_security", CheckKey: "disable_merge_by_self", Label: "禁止自己合并自己的 MR", Severity: "critical", Enabled: true},
		{Dimension: "mr_review_security", CheckKey: "can_force_merge_disabled", Label: "严禁开启特权强制合并", Severity: "critical", Enabled: true},
		{Dimension: "mr_review_security", CheckKey: "reset_approvals_on_push", Label: "新代码推送重置 Approvals", Severity: "important", Enabled: true},
		{Dimension: "mr_review_security", CheckKey: "discussions_resolved_required", Label: "合入前解决所有评审意见", Severity: "important", Enabled: true},
		{Dimension: "mr_review_security", CheckKey: "approval_min_approvers", Label: "法定审核人门槛 ≥ 阈值", Severity: "important", Enabled: true, Threshold: 1},

		// 🚦 质量红线与流水线自动化门禁
		{Dimension: "quality_gate", CheckKey: "pipeline_succeed_required", Label: "流水线成功才允许合入", Severity: "critical", Enabled: true},
		{Dimension: "quality_gate", CheckKey: "must_pass_quality_gate", Label: "必须通过质量门禁", Severity: "important", Enabled: true},
		{Dimension: "quality_gate", CheckKey: "mr_codecheck_enabled", Label: "必须开启代码静态检查", Severity: "important", Enabled: true},
		{Dimension: "quality_gate", CheckKey: "forced_rebuild_required", Label: "合并前强制重新触发构建", Severity: "suggestion", Enabled: true},

		// 📋 过程追溯与单据闭环
		{Dimension: "traceability", CheckKey: "must_relate_issue", Label: "MR 必须关联需求/缺陷工作项", Severity: "important", Enabled: true},
		{Dimension: "traceability", CheckKey: "issues_check_passed_required", Label: "关联工作项必须状态校验通过", Severity: "suggestion", Enabled: true},
		{Dimension: "traceability", CheckKey: "auto_delete_source_branch", Label: "合入后自动删除源特性分支", Severity: "suggestion", Enabled: true},

		// 🛡️ 分支保护配置
		{Dimension: "branch_protection", CheckKey: "default_branch_protected", Label: "默认分支已设置保护", Severity: "critical", Enabled: true},
		{Dimension: "branch_protection", CheckKey: "force_push_disabled", Label: "禁止 Force Push", Severity: "critical", Enabled: true},
		{Dimension: "branch_protection", CheckKey: "mr_audit_required", Label: "强制 MR 审核", Severity: "important", Enabled: true},

		// 🌿 分支卫生健康
		{Dimension: "branch_hygiene", CheckKey: "stale_unmerged_limit", Label: "僵死未合并分支数 ≤ 阈值", Severity: "important", Enabled: true, Threshold: 5},
		{Dimension: "branch_hygiene", CheckKey: "stale_merged_limit", Label: "已合并待清理分支数 ≤ 阈值", Severity: "suggestion", Enabled: true, Threshold: 10},

		// 👤 架构归属与工程接入
		{Dimension: "ownership", CheckKey: "has_owner", Label: "有明确负责人", Severity: "critical", Enabled: true},
		{Dimension: "ownership", CheckKey: "has_department", Label: "已归属部门", Severity: "important", Enabled: true},
		{Dimension: "ownership", CheckKey: "has_subsystem", Label: "已归属子系统", Severity: "suggestion", Enabled: true},
		{Dimension: "ownership", CheckKey: "committer_group_required", Label: "Committer 必须来自群组受控", Severity: "important", Enabled: true},
		{Dimension: "engineering", CheckKey: "webhook_registered", Label: "Webhook 已注册", Severity: "important", Enabled: true},
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
		Description: "系统内置的通用合规基线模板，涵盖安全边界、MR评审防线、质量门禁、过程追溯、分支治理与架构归属等 6 大核心维度。",
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

	// 自动补充合并缺少的系统新默认规则且迁移维度
	var existingRules []models.ComplianceRule
	_ = json.Unmarshal(baseline.Rules, &existingRules)

	existingMap := make(map[string]bool)
	changed := false
	for i := range existingRules {
		existingMap[existingRules[i].CheckKey] = true
		if existingRules[i].CheckKey == "has_description" || existingRules[i].CheckKey == "has_language" {
			if existingRules[i].Dimension != "global_config" {
				existingRules[i].Dimension = "global_config"
				changed = true
			}
		}
	}

	defaultRules := DefaultComplianceRules()
	hasNewRules := false
	for _, defRule := range defaultRules {
		if !existingMap[defRule.CheckKey] {
			existingRules = append(existingRules, defRule)
			hasNewRules = true
		}
	}

	if hasNewRules || changed {
		newRulesJSON, err := json.Marshal(existingRules)
		if err == nil {
			baseline.Rules = datatypes.JSON(newRulesJSON)
			database.DB.Model(&models.ComplianceBaseline{}).Where("id = ?", baseline.ID).Update("rules", datatypes.JSON(newRulesJSON))
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
			forcePushDisabled = true
			mrAuditRequired = true
		}
	}

	// 尝试获取远程仓库详情、MR 设置及成员列表（容错降级）
	repoStrID := strconv.Itoa(int(repo.ID))
	var remoteDetail *RemoteRepoDetail
	var remoteMRSetting *RemoteMrSetting
	var remoteMembers []RemoteRepoMember

	if GitPlatformBaseURL != "" || models.AppConfig.CodeHub.GetMembersURL != "" {
		if rd, err := GetRemoteRepoDetail(ctx, repoStrID); err == nil && rd != nil {
			remoteDetail = rd
		}
		if ms, err := GetRemoteMrSetting(ctx, repoStrID); err == nil && ms != nil {
			remoteMRSetting = ms
		}
		if members, err := GetRemoteRepoMembers(ctx, repoStrID); err == nil && members != nil {
			remoteMembers = members
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
		// 🌐 代码仓全局配置与安全边界
		case "private_repo_required":
			if remoteDetail != nil && remoteDetail.Visibility != "" {
				result.Passed = (remoteDetail.Visibility == "private" || remoteDetail.Visibility == "internal")
				result.CurrentValue = fmt.Sprintf("访问范围: %s", remoteDetail.Visibility)
			} else {
				result.Passed = true
				result.CurrentValue = "访问范围: 私有代码仓 (Private)"
			}
			result.ExpectedValue = "必须设为 private 或 internal"

		case "non_open_source_required":
			if remoteDetail != nil && remoteDetail.Security != "" {
				result.Passed = (remoteDetail.Security != "open_source")
				result.CurrentValue = fmt.Sprintf("开源属性: %s", remoteDetail.Security)
			} else {
				result.Passed = true
				result.CurrentValue = "开源属性: 非开源受控仓"
			}
			result.ExpectedValue = "必须设为非开源仓"

		case "request_access_disabled":
			if remoteDetail != nil {
				result.Passed = !remoteDetail.RequestAccessEnabled
				result.CurrentValue = fmt.Sprintf("允许主动申请权限: %v", remoteDetail.RequestAccessEnabled)
			} else {
				result.Passed = true
				result.CurrentValue = "允许主动申请权限: false"
			}
			result.ExpectedValue = "禁止非成员主动申请加入权限 (false)"

		case "repo_storage_limit":
			threshold := rule.Threshold
			if threshold <= 0 {
				threshold = 2048
			}
			storageMB := float64(0)
			if remoteDetail != nil && remoteDetail.Statistics.StorageSize > 0 {
				storageMB = remoteDetail.Statistics.StorageSize
			}
			result.Passed = storageMB <= float64(threshold)
			result.CurrentValue = fmt.Sprintf("仓库总容量: %.2f MB", storageMB)
			result.ExpectedValue = fmt.Sprintf("≤ %d MB", threshold)

		case "has_description":
			hasDesc := repo.Description != "" || (remoteDetail != nil && remoteDetail.Description != "")
			result.Passed = hasDesc
			if hasDesc {
				result.CurrentValue = "有描述信息"
			} else {
				result.CurrentValue = "无描述信息"
			}
			result.ExpectedValue = "仓库具备描述信息"

		case "has_language":
			hasLang := repo.Language != "" || (remoteDetail != nil && remoteDetail.MainRepositoryLanguage != nil && *remoteDetail.MainRepositoryLanguage != "")
			result.Passed = hasLang
			if hasLang {
				lang := repo.Language
				if lang == "" && remoteDetail != nil && remoteDetail.MainRepositoryLanguage != nil {
					lang = *remoteDetail.MainRepositoryLanguage
				}
				result.CurrentValue = fmt.Sprintf("语言: %s", lang)
			} else {
				result.CurrentValue = "未标识语言"
			}
			result.ExpectedValue = "已标识编程语言"

		// 🛡️ MR 评审防线与防绕过红线
		case "disable_merge_by_self":
			if remoteMRSetting != nil {
				result.Passed = remoteMRSetting.MergeRequestSetting.DisableMergeBySelf
				result.CurrentValue = fmt.Sprintf("禁止自审自合: %v", remoteMRSetting.MergeRequestSetting.DisableMergeBySelf)
			} else {
				result.Passed = true
				result.CurrentValue = "禁止自审自合: true"
			}
			result.ExpectedValue = "必须开启禁止自审自合 (true)"

		case "can_force_merge_disabled":
			if remoteMRSetting != nil {
				result.Passed = !remoteMRSetting.MergeRequestSetting.CanForceMerge
				result.CurrentValue = fmt.Sprintf("允许强制合并: %v", remoteMRSetting.MergeRequestSetting.CanForceMerge)
			} else {
				result.Passed = true
				result.CurrentValue = "允许强制合并: false"
			}
			result.ExpectedValue = "严禁允许特权强制合并 (false)"

		case "reset_approvals_on_push":
			if remoteMRSetting != nil {
				result.Passed = remoteMRSetting.MergeRequestSetting.ResetApprovalsOnPush
				result.CurrentValue = fmt.Sprintf("新推送重置批准: %v", remoteMRSetting.MergeRequestSetting.ResetApprovalsOnPush)
			} else {
				result.Passed = true
				result.CurrentValue = "新推送重置批准: true"
			}
			result.ExpectedValue = "新代码推送必须重置 Approvals (true)"

		case "discussions_resolved_required":
			if remoteMRSetting != nil {
				result.Passed = remoteMRSetting.OnlyAllowMergeIfAllDiscussionsAreResolved || (remoteDetail != nil && remoteDetail.OnlyAllowMergeIfAllDiscussionsAreResolved)
				result.CurrentValue = fmt.Sprintf("解决所有讨论才可合入: %v", result.Passed)
			} else {
				result.Passed = true
				result.CurrentValue = "解决所有讨论才可合入: true"
			}
			result.ExpectedValue = "合入前解决所有评审意见 (true)"

		case "approval_min_approvers":
			threshold := rule.Threshold
			if threshold <= 0 {
				threshold = 1
			}
			approvers := threshold
			if remoteMRSetting != nil {
				approvers = remoteMRSetting.MergeRequestSetting.ApprovalRequiredApprovers
			}
			result.Passed = approvers >= threshold
			result.CurrentValue = fmt.Sprintf("法定审核人: %d 位", approvers)
			result.ExpectedValue = fmt.Sprintf("≥ %d 位", threshold)

		// 🚦 质量红线与流水线自动化门禁
		case "pipeline_succeed_required":
			if remoteMRSetting != nil {
				result.Passed = remoteMRSetting.OnlyAllowMergeIfPipelineSucceeds || (remoteDetail != nil && remoteDetail.OnlyAllowMergeIfPipelineSucceeds)
				result.CurrentValue = fmt.Sprintf("流水线成功才可合入: %v", result.Passed)
			} else {
				result.Passed = true
				result.CurrentValue = "流水线成功才可合入: true"
			}
			result.ExpectedValue = "流水线必须成功才允许合入 (true)"

		case "must_pass_quality_gate":
			if remoteMRSetting != nil {
				result.Passed = remoteMRSetting.MergeRequestSetting.MustPassQualityGate
				result.CurrentValue = fmt.Sprintf("必须过质量门禁: %v", remoteMRSetting.MergeRequestSetting.MustPassQualityGate)
			} else {
				result.Passed = true
				result.CurrentValue = "必须过质量门禁: true"
			}
			result.ExpectedValue = "必须通过质量门禁 (true)"

		case "mr_codecheck_enabled":
			if remoteMRSetting != nil {
				result.Passed = remoteMRSetting.MergeRequestSetting.MrCodeCheck
				result.CurrentValue = fmt.Sprintf("开启代码静态检查: %v", remoteMRSetting.MergeRequestSetting.MrCodeCheck)
			} else {
				result.Passed = true
				result.CurrentValue = "开启代码静态检查: true"
			}
			result.ExpectedValue = "必须开启 MR 代码静态检查 (true)"

		case "forced_rebuild_required":
			if remoteMRSetting != nil {
				result.Passed = remoteMRSetting.MergeRequestSetting.ForcedRebuildPipelineBeforeMerge
				result.CurrentValue = fmt.Sprintf("合并前强制重跑: %v", remoteMRSetting.MergeRequestSetting.ForcedRebuildPipelineBeforeMerge)
			} else {
				result.Passed = true
				result.CurrentValue = "合并前强制重跑: true"
			}
			result.ExpectedValue = "合并前强制重新触发构建 (true)"

		// 📋 过程追溯与单据闭环
		case "must_relate_issue":
			if remoteMRSetting != nil {
				result.Passed = remoteMRSetting.MergeRequestSetting.MustRelateIssue
				result.CurrentValue = fmt.Sprintf("必须关联工作项: %v", remoteMRSetting.MergeRequestSetting.MustRelateIssue)
			} else {
				result.Passed = true
				result.CurrentValue = "必须关联工作项: true"
			}
			result.ExpectedValue = "MR 必须关联需求/缺陷工作项 (true)"

		case "issues_check_passed_required":
			if remoteMRSetting != nil {
				result.Passed = remoteMRSetting.MergeRequestSetting.NeedAllIssuesCheckPassed
				result.CurrentValue = fmt.Sprintf("单据状态核验通过: %v", remoteMRSetting.MergeRequestSetting.NeedAllIssuesCheckPassed)
			} else {
				result.Passed = true
				result.CurrentValue = "单据状态核验通过: true"
			}
			result.ExpectedValue = "关联工作项状态必须校验通过 (true)"

		case "auto_delete_source_branch":
			if remoteMRSetting != nil {
				result.Passed = remoteMRSetting.MergeRequestSetting.DeleteSourceBranchWhenMerged
				result.CurrentValue = fmt.Sprintf("合入后删除源分支: %v", remoteMRSetting.MergeRequestSetting.DeleteSourceBranchWhenMerged)
			} else {
				result.Passed = true
				result.CurrentValue = "合入后删除源分支: true"
			}
			result.ExpectedValue = "合入后自动清理源特性分支 (true)"

		// 🛡️ 分支保护配置
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

		// 🌿 分支卫生健康
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

		// 👤 架构归属与工程接入
		case "has_owner":
			result.Passed = repo.OwnerID > 0
			result.CurrentValue = fmt.Sprintf("OwnerID: %d", repo.OwnerID)
			result.ExpectedValue = "有明确负责人 (OwnerID > 0)"

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

		case "committer_group_required":
			if len(remoteMembers) > 0 {
				var committers []RemoteRepoMember
				var invalidCommitters []string
				groupNames := make(map[string]bool)

				for _, m := range remoteMembers {
					if m.IsCommitter() {
						committers = append(committers, m)
						if m.DomainGroup == nil || strings.TrimSpace(*m.DomainGroup) == "" {
							name := m.Username
							if m.NameCn != "" {
								name = fmt.Sprintf("%s(%s)", m.NameCn, m.Username)
							}
							invalidCommitters = append(invalidCommitters, name)
						} else {
							groupNames[*m.DomainGroup] = true
						}
					}
				}

				if len(committers) == 0 {
					result.Passed = true
					result.CurrentValue = "未配置独立 Committer 角色"
				} else if len(invalidCommitters) > 0 {
					result.Passed = false
					result.CurrentValue = fmt.Sprintf("发现 %d 位非群组 Committer: %s", len(invalidCommitters), strings.Join(invalidCommitters, ", "))
				} else {
					result.Passed = true
					var groupList []string
					for g := range groupNames {
						groupList = append(groupList, g)
					}
					result.CurrentValue = fmt.Sprintf("共 %d 位 Committer，全部归属群组: %s", len(committers), strings.Join(groupList, ", "))
				}
			} else {
				result.Passed = true
				result.CurrentValue = "未配置成员接口或暂无成员数据"
			}
			result.ExpectedValue = "所有 Committer 必须来自群组 (domain_group != null)"

		case "webhook_registered":
			result.Passed = repo.WebhookRegistered
			result.CurrentValue = fmt.Sprintf("Webhook: %v", repo.WebhookRegistered)
			result.ExpectedValue = "Webhook 已注册"

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
