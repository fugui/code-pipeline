package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"code-pipeline/database"
	"code-pipeline/models"
	"code-pipeline/services"

	"github.com/gin-gonic/gin"
)

// GetComplianceBaselines 获取所有合规基线模板
func GetComplianceBaselines(c *gin.Context) {
	var baselines []models.ComplianceBaseline
	if err := database.DB.Order("is_default DESC, id ASC").Find(&baselines).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取合规基线失败"})
		return
	}
	c.JSON(http.StatusOK, baselines)
}

// GetComplianceBaseline 获取单个合规基线模板
func GetComplianceBaseline(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 ID"})
		return
	}

	var baseline models.ComplianceBaseline
	if err := database.DB.First(&baseline, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "合规基线不存在"})
		return
	}
	c.JSON(http.StatusOK, baseline)
}

// CreateComplianceBaseline 创建合规基线模板
func CreateComplianceBaseline(c *gin.Context) {
	var req struct {
		Name        string                 `json:"name" binding:"required"`
		Description string                 `json:"description"`
		IsDefault   bool                   `json:"is_default"`
		Rules       []models.ComplianceRule `json:"rules"`
		GroupIDs    []uint                 `json:"group_ids"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的请求格式"})
		return
	}

	// 如果没有传入规则，使用默认规则
	if len(req.Rules) == 0 {
		req.Rules = services.DefaultComplianceRules()
	}

	rulesJSON, err := json.Marshal(req.Rules)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "序列化规则失败"})
		return
	}

	if req.GroupIDs == nil {
		req.GroupIDs = []uint{}
	}
	groupIDsJSON, err := json.Marshal(req.GroupIDs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "序列化 GroupIDs 失败"})
		return
	}

	// 如果设置为默认，取消其他模板的默认状态
	if req.IsDefault {
		database.DB.Model(&models.ComplianceBaseline{}).Where("is_default = ?", true).Update("is_default", false)
	}

	userID := c.GetUint("user_id")
	now := time.Now()

	baseline := models.ComplianceBaseline{
		Name:        req.Name,
		Description: req.Description,
		IsDefault:   req.IsDefault,
		Rules:       rulesJSON,
		GroupIDs:    groupIDsJSON,
		CreatorID:   userID,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	if err := database.DB.Create(&baseline).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建合规基线失败"})
		return
	}

	c.JSON(http.StatusCreated, baseline)
}

// UpdateComplianceBaseline 更新合规基线模板
func UpdateComplianceBaseline(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 ID"})
		return
	}

	var existing models.ComplianceBaseline
	if err := database.DB.First(&existing, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "合规基线不存在"})
		return
	}

	var req struct {
		Name        string                 `json:"name"`
		Description string                 `json:"description"`
		IsDefault   *bool                  `json:"is_default"`
		Rules       []models.ComplianceRule `json:"rules"`
		GroupIDs    []uint                 `json:"group_ids"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的请求格式"})
		return
	}

	updates := map[string]interface{}{
		"updated_at": time.Now(),
	}

	if req.Name != "" {
		updates["name"] = req.Name
	}
	if req.Description != "" {
		updates["description"] = req.Description
	}
	if req.IsDefault != nil {
		if *req.IsDefault {
			database.DB.Model(&models.ComplianceBaseline{}).Where("is_default = ? AND id != ?", true, id).Update("is_default", false)
		}
		updates["is_default"] = *req.IsDefault
	}
	if len(req.Rules) > 0 {
		rulesJSON, err := json.Marshal(req.Rules)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "序列化规则失败"})
			return
		}
		updates["rules"] = rulesJSON
	}
	if req.GroupIDs != nil {
		groupIDsJSON, err := json.Marshal(req.GroupIDs)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "序列化 GroupIDs 失败"})
			return
		}
		updates["group_ids"] = groupIDsJSON
	}

	if err := database.DB.Model(&existing).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新合规基线失败"})
		return
	}

	database.DB.First(&existing, id)
	c.JSON(http.StatusOK, existing)
}

// DeleteComplianceBaseline 删除合规基线模板
func DeleteComplianceBaseline(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 ID"})
		return
	}

	var baseline models.ComplianceBaseline
	if err := database.DB.First(&baseline, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "合规基线不存在"})
		return
	}

	if baseline.IsDefault {
		c.JSON(http.StatusBadRequest, gin.H{"error": "不允许删除默认合规基线模板"})
		return
	}

	if err := database.DB.Delete(&baseline).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除合规基线失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "已删除"})
}

// TriggerComplianceAudit 触发全量合规巡检
func TriggerComplianceAudit(c *gin.Context) {
	ctx := context.Background()
	success, fail, err := services.AuditAllReposCompliance(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error(), "success": success, "fail": fail})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "合规巡检完成", "success": success, "fail": fail})
}

// TriggerSingleRepoComplianceAudit 触发单仓合规巡检
func TriggerSingleRepoComplianceAudit(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 ID"})
		return
	}

	var repo models.ManagedRepository
	if err := database.DB.First(&repo, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "仓库不存在"})
		return
	}

	baseline, err := services.ResolveBaselineForRepo(&repo)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	report, err := services.AuditRepoCompliance(c.Request.Context(), &repo, baseline)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, report)
}

// GetRepoComplianceReport 获取单仓最新合规报告
func GetRepoComplianceReport(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 ID"})
		return
	}

	var report models.RepoComplianceReport
	if err := database.DB.Where("managed_repository_id = ?", id).
		Preload("Baseline").
		Order("audited_at DESC").
		First(&report).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "该仓库尚无合规报告，请先执行巡检"})
		return
	}

	c.JSON(http.StatusOK, report)
}

// GetManagedDashboardStats 管控模块全局 Dashboard 统计接口
func GetManagedDashboardStats(c *gin.Context) {
	db := database.DB

	// 基础统计
	var totalRepos, activeRepos, archivedRepos, hiddenRepos int64
	db.Model(&models.ManagedRepository{}).Count(&totalRepos)
	db.Model(&models.ManagedRepository{}).Where("is_active = ? AND is_archived = ? AND is_hidden = ?", true, false, false).Count(&activeRepos)
	db.Model(&models.ManagedRepository{}).Where("is_archived = ?", true).Count(&archivedRepos)
	db.Model(&models.ManagedRepository{}).Where("is_hidden = ?", true).Count(&hiddenRepos)

	// 分支统计
	var totalStaleUnmerged, totalStaleMerged int64
	db.Model(&models.ManagedBranchMonitor{}).Where("status = 'unmerged_stale'").Count(&totalStaleUnmerged)
	db.Model(&models.ManagedBranchMonitor{}).Where("status = 'merged_stale'").Count(&totalStaleMerged)

	// Webhook 覆盖率
	var webhookRegistered int64
	db.Model(&models.ManagedRepository{}).Where("is_active = ? AND is_archived = ? AND is_hidden = ? AND webhook_registered = ?", true, false, false, true).Count(&webhookRegistered)

	// 保护分支覆盖率
	var reposWithProtection int64
	db.Model(&models.ManagedProtectedBranchRule{}).Distinct("managed_repository_id").Count(&reposWithProtection)

	// 待审批
	var pendingApprovals int64
	db.Model(&models.ManagedRepoApproval{}).Where("status = 'pending'").Count(&pendingApprovals)

	// 有明确负责人的仓库数
	var reposWithOwner int64
	db.Model(&models.ManagedRepository{}).Where("is_active = ? AND is_archived = ? AND is_hidden = ? AND owner_id > 0", true, false, false).Count(&reposWithOwner)

	// 合规统计
	var totalReports int64
	db.Model(&models.RepoComplianceReport{}).Count(&totalReports)

	var gradeA, gradeB, gradeC, gradeD int64
	db.Model(&models.RepoComplianceReport{}).Where("grade = 'A'").Count(&gradeA)
	db.Model(&models.RepoComplianceReport{}).Where("grade = 'B'").Count(&gradeB)
	db.Model(&models.RepoComplianceReport{}).Where("grade = 'C'").Count(&gradeC)
	db.Model(&models.RepoComplianceReport{}).Where("grade = 'D'").Count(&gradeD)

	var avgScore float64
	db.Model(&models.RepoComplianceReport{}).Select("COALESCE(AVG(score), 0)").Scan(&avgScore)

	// 合规率 (B 级及以上视为合规)
	complianceRate := float64(0)
	if totalReports > 0 {
		complianceRate = float64(gradeA+gradeB) * 100 / float64(totalReports)
	}

	// 僵死分支 Top5 仓库
	type StaleTop struct {
		RepoID             uint   `json:"repo_id"`
		RepoName           string `json:"repo_name"`
		StaleUnmergedCount int    `json:"stale_unmerged_count"`
	}
	var staleTop5 []StaleTop
	db.Model(&models.ManagedRepository{}).
		Select("id as repo_id, name as repo_name, stale_unmerged_count").
		Where("is_active = ? AND is_archived = ? AND is_hidden = ? AND stale_unmerged_count > 0", true, false, false).
		Order("stale_unmerged_count DESC").
		Limit(5).
		Scan(&staleTop5)

	// 合规评分最低 Top5 仓库
	type ComplianceBottom struct {
		RepoID   uint   `json:"repo_id"`
		RepoName string `json:"repo_name"`
		Score    int    `json:"score"`
		Grade    string `json:"grade"`
	}
	var complianceBottom5 []ComplianceBottom
	db.Table("repo_compliance_reports").
		Select("repo_compliance_reports.managed_repository_id as repo_id, managed_repositories.name as repo_name, repo_compliance_reports.score, repo_compliance_reports.grade").
		Joins("JOIN managed_repositories ON managed_repositories.id = repo_compliance_reports.managed_repository_id").
		Where("managed_repositories.is_active = ? AND managed_repositories.is_archived = ?", true, false).
		Order("repo_compliance_reports.score ASC").
		Limit(5).
		Scan(&complianceBottom5)

	// 组统计
	var totalGroups int64
	db.Model(&models.ManagedGroup{}).Where("is_hidden = ?", false).Count(&totalGroups)

	c.JSON(http.StatusOK, gin.H{
		// 基础仓库统计
		"total_repos":         totalRepos,
		"active_repos":        activeRepos,
		"archived_repos":      archivedRepos,
		"hidden_repos":        hiddenRepos,
		"total_groups":        totalGroups,
		"repos_with_owner":    reposWithOwner,
		"webhook_registered":  webhookRegistered,
		"repos_with_protection": reposWithProtection,
		"pending_approvals":   pendingApprovals,

		// 分支统计
		"total_stale_unmerged": totalStaleUnmerged,
		"total_stale_merged":   totalStaleMerged,

		// 合规统计
		"compliance_total_reports": totalReports,
		"compliance_avg_score":     avgScore,
		"compliance_rate":          complianceRate,
		"compliance_grade_a":       gradeA,
		"compliance_grade_b":       gradeB,
		"compliance_grade_c":       gradeC,
		"compliance_grade_d":       gradeD,

		// 排行榜
		"stale_top5":           staleTop5,
		"compliance_bottom5":   complianceBottom5,
	})
}

// GetDefaultComplianceRules 获取系统内置的默认合规规则集（供前端创建模板时参考）
func GetDefaultComplianceRules(c *gin.Context) {
	c.JSON(http.StatusOK, services.DefaultComplianceRules())
}

// TriggerRepoRemoteProtectionCheck 管理员主动触发远程保护状态查询
func TriggerRepoRemoteProtectionCheck(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 ID"})
		return
	}

	if err := services.GetRemoteProtectionStatus(c.Request.Context(), uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "远程保护状态已同步"})
}
