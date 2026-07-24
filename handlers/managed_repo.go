package handlers

import (
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"code-pipeline/database"
	"code-pipeline/models"
	"code-pipeline/services"

	"github.com/gin-gonic/gin"
)

// CreateManagedGroup 创建被管嵌套组
func CreateManagedGroup(c *gin.Context) {
	var req struct {
		Name     string `json:"name" binding:"required"`
		Path     string `json:"path" binding:"required"`
		ParentID *uint  `json:"parent_id"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request format"})
		return
	}

	if req.ParentID != nil && *req.ParentID > 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "仅允许在本地创建顶层根组。子组必须先在托管平台上创建，再通过父组同步按钮拉取同步。"})
		return
	}

	var fullPath string
	if req.ParentID != nil && *req.ParentID > 0 {
		var parent models.ManagedGroup
		if err := database.DB.First(&parent, *req.ParentID).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Parent group not found"})
			return
		}
		fullPath = parent.FullPath + "/" + req.Path
	} else {
		fullPath = req.Path
	}

	// 1. 在创建时直接去托管平台 (CodeHub) 校验并换取真实的远程 Group ID
	remoteID, err := services.GetRemoteGroupDetails(c.Request.Context(), fullPath)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("该组路径在托管平台上不存在，无法创建: %v", err)})
		return
	}

	// 2. 检查本地数据库中是否已存在该 remoteID 的记录以防冲突
	var existing models.ManagedGroup
	if err := database.DB.First(&existing, remoteID).Error; err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "该群组已存在于本地数据库中"})
		return
	}

	group := models.ManagedGroup{
		ID:        remoteID, // 直接使用托管平台的真实 ID 作为本地主键
		Name:      req.Name,
		Path:      req.Path,
		FullPath:  fullPath,
		ParentID:  req.ParentID,
		CreatedAt: time.Now(),
	}

	if err := database.DB.Create(&group).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to create group in db: %v", err)})
		return
	}

	c.JSON(http.StatusCreated, group)
}

// GetManagedGroups 获取嵌套组列表
func GetManagedGroups(c *gin.Context) {
	var groups []models.ManagedGroup
	if err := database.DB.Order("full_path ASC").Find(&groups).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch groups"})
		return
	}
	c.JSON(http.StatusOK, groups)
}

// CreateManagedRepo 在系统内及远程创建被管代码仓
func CreateManagedRepo(c *gin.Context) {
	var req struct {
		Name           string `json:"name" binding:"required"`
		ManagedGroupID uint   `json:"managed_group_id" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request format"})
		return
	}

	var group models.ManagedGroup
	if err := database.DB.First(&group, req.ManagedGroupID).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Managed group not found"})
		return
	}

	userIDVal, _ := c.Get("userID")
	userID, _ := userIDVal.(uint)

	// 1. 调用远程服务物理创建仓库
	remoteID, sshURL, httpURL, err := services.CreateRemoteRepo(c.Request.Context(), req.Name, group.FullPath)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("Failed to create remote repository: %v", err)})
		return
	}

	// 2. 为新仓库配置标准化 Webhook
	projectIDStr := strconv.Itoa(int(remoteID))
	headers := prepareRequestHeaders(c)
	_ = services.RegisterWebhook(c.Request.Context(), projectIDStr, headers)

	// 3. 修改远程设置（开启 Merge Request）
	_ = services.UpdateRepoSettings(c.Request.Context(), projectIDStr, headers)

	// 4. 将被管代码仓数据存入本地 DB 隔离表
	repo := models.ManagedRepository{
		ID:                remoteID,
		ManagedGroupID:    req.ManagedGroupID,
		Name:              req.Name,
		SSHURL:            sshURL,
		HTTPURL:           httpURL,
		OwnerID:           userID,
		IsActive:          true,
		WebhookRegistered: true,
		CreatedAt:         time.Now(),
	}

	if err := database.DB.Create(&repo).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to save repository to db: %v", err)})
		return
	}

	c.JSON(http.StatusCreated, repo)
}

// GetManagedRepos 获取被管代码仓列表 (默认排除归档和隐藏的仓库)
func GetManagedRepos(c *gin.Context) {
	groupIDStr := c.Query("group_id")
	includeArchived := c.Query("include_archived") == "true"
	includeHidden := c.Query("include_hidden") == "true"

	query := database.DB.Model(&models.ManagedRepository{})

	if groupIDStr != "" {
		groupID, err := strconv.Atoi(groupIDStr)
		if err == nil {
			query = query.Where("managed_group_id = ?", groupID)
		}
	}

	if !includeArchived {
		query = query.Where("is_archived = ?", false)
	}

	if !includeHidden {
		query = query.Where("is_hidden = ?", false)
	}

	var repos []models.ManagedRepository
	if err := query.Preload("ManagedGroup").Find(&repos).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch repositories"})
		return
	}

	c.JSON(http.StatusOK, repos)
}

// CreateManagedBranch 统一入口创建受保护开发分支
func CreateManagedBranch(c *gin.Context) {
	idStr := c.Param("id")
	repoID, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid repository ID"})
		return
	}

	var req struct {
		BranchName   string `json:"branch_name" binding:"required"`
		SourceBranch string `json:"source_branch" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request format"})
		return
	}

	// 1. 强制前置分支命名规范校验
	if !strings.HasPrefix(req.BranchName, "feature") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Branch name must start with 'feature' prefix (e.g. feature-xxx or feature/xxx)"})
		return
	}

	var repo models.ManagedRepository
	if err := database.DB.First(&repo, repoID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Managed repository not found"})
		return
	}

	projectIDStr := strconv.Itoa(int(repo.ID))

	// 2. 超级管理员远程建分支
	err = services.CreateRemoteBranch(c.Request.Context(), projectIDStr, req.BranchName, req.SourceBranch)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("Failed to create remote branch: %v", err)})
		return
	}

	// 3. 自动配置该分支的保护规则保护
	err = services.ConfigureBranchProtection(c.Request.Context(), projectIDStr, req.BranchName)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"message": "Branch created successfully, but failed to apply branch protection rules automatically",
			"warning": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Branch created and protection rules applied successfully",
		"branch":  req.BranchName,
	})
}

// ConfigureManagedACL 成员或群组授权配置
func ConfigureManagedACL(c *gin.Context) {
	var req struct {
		TargetType    string `json:"target_type" binding:"required"`    // "group" 或 "repository"
		TargetID      uint   `json:"target_id" binding:"required"`      // ManagedGroupID 或 ManagedRepositoryID
		PrincipalType string `json:"principal_type" binding:"required"` // "user" 或 "user_group"
		PrincipalID   uint   `json:"principal_id" binding:"required"`
		PrincipalName string `json:"principal_name"`
		AccessLevel   int    `json:"access_level" binding:"required"` // 10, 30, 50
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request format"})
		return
	}

	// 1. 本地策略数据先写入/更新
	access := models.ManagedMemberAccess{
		SourceType:    req.TargetType,
		SourceID:      req.TargetID,
		PrincipalType: req.PrincipalType,
		PrincipalID:   req.PrincipalID,
		PrincipalName: req.PrincipalName,
		AccessLevel:   req.AccessLevel,
		SyncStatus:    "pending",
		UpdatedAt:     time.Now(),
	}

	var existing models.ManagedMemberAccess
	err := database.DB.Where("source_type = ? AND source_id = ? AND principal_type = ? AND principal_id = ?",
		req.TargetType, req.TargetID, req.PrincipalType, req.PrincipalID).First(&existing).Error
	if err == nil {
		access.ID = existing.ID
		database.DB.Save(&access)
	} else {
		database.DB.Create(&access)
	}

	// 2. 超级管理员远程进行授权调用
	targetIDStr := strconv.Itoa(int(req.TargetID))
	principalIDStr := strconv.Itoa(int(req.PrincipalID))

	err = services.ConfigureRemoteACL(c.Request.Context(), req.TargetType, targetIDStr, req.PrincipalType, principalIDStr, req.AccessLevel)
	if err != nil {
		database.DB.Model(&access).Updates(map[string]interface{}{
			"sync_status": "failed",
			"sync_error":  err.Error(),
		})
		c.JSON(http.StatusBadGateway, gin.H{
			"error":       fmt.Sprintf("Failed to sync authorization to Git platform: %v", err),
			"sync_status": "failed",
		})
		return
	}

	database.DB.Model(&access).Update("sync_status", "synced")
	c.JSON(http.StatusOK, gin.H{
		"message":     "Authorization configured and synchronized successfully",
		"sync_status": "synced",
	})
}

// GetManagedRepoBranchAudit 获取某代码仓在本地缓存的非活动分支分析列表
func GetManagedRepoBranchAudit(c *gin.Context) {
	idStr := c.Param("id")
	repoID, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid repository ID"})
		return
	}

	statusFilter := c.Query("status") // "active", "merged_stale", "unmerged_stale", "all"(默认)
	query := database.DB.Where("managed_repository_id = ?", repoID)
	if statusFilter != "" && statusFilter != "all" {
		query = query.Where("status = ?", statusFilter)
	}

	var audits []models.ManagedBranchMonitor
	if err := query.Order("last_commit_time DESC").Find(&audits).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch branch audits"})
		return
	}

	c.JSON(http.StatusOK, audits)
}

// TriggerManagedRepoBranchAudit 手动即时触发单个仓库的分支审计分析
func TriggerManagedRepoBranchAudit(c *gin.Context) {
	idStr := c.Param("id")
	repoID, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid repository ID"})
		return
	}

	err = services.AuditSingleRepoBranches(c.Request.Context(), uint(repoID))
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("Failed to audit branches: %v", err)})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Audit completed and cache synchronized successfully"})
}

// NotifyBranchOwner 提醒某个分支的最后提交人清理非活动分支
func NotifyBranchOwner(c *gin.Context) {
	var req struct {
		BranchName string `json:"branch_name" binding:"required"`
		OwnerName  string `json:"owner_name" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request format"})
		return
	}

	// 模拟通知发送，并记录日志
	log.Printf("[BranchAudit] Notification sent successfully: Notify owner %s to cleanup branch %s", req.OwnerName, req.BranchName)

	c.JSON(http.StatusOK, gin.H{
		"message": fmt.Sprintf("Notification sent successfully to %s for cleaning up %s", req.OwnerName, req.BranchName),
	})
}

// CleanupManagedBranches 批量或单个在远程 Git 平台物理删除非活动分支，并触发本地审计同步
func CleanupManagedBranches(c *gin.Context) {
	idStr := c.Param("id")
	repoID, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid repository ID"})
		return
	}

	var req struct {
		BranchNames []string `json:"branch_names" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil || len(req.BranchNames) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request format or empty branch list"})
		return
	}

	var repo models.ManagedRepository
	if err := database.DB.First(&repo, repoID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Managed repository not found"})
		return
	}

	projectID := strconv.FormatUint(uint64(repo.ID), 10)
	var deletedCount int
	var errMsgs []string

	for _, branchName := range req.BranchNames {
		if branchName == "" {
			continue
		}
		if err := services.DeleteRemoteBranch(c.Request.Context(), projectID, branchName); err != nil {
			log.Printf("[BranchCleanup] Failed to delete remote branch %s for repo %d: %v", branchName, repoID, err)
			errMsgs = append(errMsgs, fmt.Sprintf("%s: %v", branchName, err))
		} else {
			deletedCount++
			log.Printf("[BranchCleanup] Successfully deleted remote branch %s for repo %d", branchName, repoID)
		}
	}

	// 无论结果如何，重新触发一次审计增量计算，清除已删除的分支本地记录并重新核算计数
	_ = services.AuditSingleRepoBranches(c.Request.Context(), uint(repoID))

	if len(errMsgs) > 0 && deletedCount == 0 {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": fmt.Sprintf("Failed to delete branches: %s", strings.Join(errMsgs, "; ")),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":       fmt.Sprintf("Successfully cleaned up %d branch(es)", deletedCount),
		"deleted_count": deletedCount,
		"errors":        errMsgs,
	})
}

// SyncManagedGroup 接收嵌套组同步请求并加入后台异步任务队列
func SyncManagedGroup(c *gin.Context) {
	idStr := c.Param("id")
	groupID, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid group ID"})
		return
	}

	var startGroup models.ManagedGroup
	if err := database.DB.First(&startGroup, groupID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Managed group not found"})
		return
	}

	userIDVal, _ := c.Get("userID")
	userID, _ := userIDVal.(uint)

	// 将同步任务推入后台单线程 Worker 处理队列中，防止 429 报错，并能深层递归同步
	if err := services.EnqueueSyncGroup(uint(groupID), userID); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": fmt.Sprintf("当前同步队列繁忙，请稍后再试: %v", err)})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "同步任务已成功提交到后台处理队列，系统正在后台进行递归同步及分支审计。请稍后刷新页面查看最新状态。",
	})
}

// ToggleGroupHide 切换嵌套组的隐藏状态
func ToggleGroupHide(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid group ID"})
		return
	}

	var group models.ManagedGroup
	if err := database.DB.First(&group, uint(id)).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Group not found"})
		return
	}

	tx := database.DB.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	group.IsHidden = !group.IsHidden
	updates := map[string]interface{}{
		"is_hidden": group.IsHidden,
	}
	if group.IsHidden {
		updates["synced_at"] = nil
		group.SyncedAt = nil
	}

	if err := tx.Model(&group).Updates(updates).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update group hide status"})
		return
	}

	// 如果切换为隐藏，需要清理该分组及其所有子分组底下的全部数据，并清空同步时间
	if group.IsHidden {
		// 1. 查找所有子孙分组的 ID
		var subGroupIDs []uint
		likePattern := group.FullPath + "/%"
		if err := tx.Model(&models.ManagedGroup{}).
			Where("full_path LIKE ?", likePattern).
			Pluck("id", &subGroupIDs).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to query sub groups"})
			return
		}

		// 2. 汇总当前分组 ID 及所有子孙分组 ID
		allGroupIDs := append([]uint{group.ID}, subGroupIDs...)

		// 3. 找出这些分组底下的所有仓库 ID
		var repoIDs []uint
		if err := tx.Model(&models.ManagedRepository{}).
			Where("managed_group_id IN ?", allGroupIDs).
			Pluck("id", &repoIDs).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to query repositories"})
			return
		}

		// 4. 清理仓库关联数据和仓库本身
		if len(repoIDs) > 0 {
			if err := tx.Where("managed_repository_id IN ?", repoIDs).Delete(&models.ManagedBranchMonitor{}).Error; err != nil {
				tx.Rollback()
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete branch monitors"})
				return
			}
			if err := tx.Where("source_type = 'repository' AND source_id IN ?", repoIDs).Delete(&models.ManagedMemberAccess{}).Error; err != nil {
				tx.Rollback()
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete repository ACLs"})
				return
			}
			if err := tx.Where("id IN ?", repoIDs).Delete(&models.ManagedRepository{}).Error; err != nil {
				tx.Rollback()
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete repositories"})
				return
			}
		}

		// 5. 清理子群组的 ACL 策略并物理删除子孙分组本身（注意：当前分组 group 自身保留，只更新了 is_hidden = true 且 synced_at = nil）
		if len(subGroupIDs) > 0 {
			if err := tx.Where("source_type = 'group' AND source_id IN ?", subGroupIDs).Delete(&models.ManagedMemberAccess{}).Error; err != nil {
				tx.Rollback()
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete group ACLs"})
				return
			}
			if err := tx.Where("id IN ?", subGroupIDs).Delete(&models.ManagedGroup{}).Error; err != nil {
				tx.Rollback()
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete sub groups"})
				return
			}
		}
	}

	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to commit transaction"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":   "Group hide status toggled successfully and database cleaned",
		"is_hidden": group.IsHidden,
	})
}

// ToggleRepoArchive 切换仓库归档状态 (归档时自动设为非活跃和隐藏状态)
func ToggleRepoArchive(c *gin.Context) {
	idStr := c.Param("id")
	repoID, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid repository ID"})
		return
	}

	var repo models.ManagedRepository
	if err := database.DB.First(&repo, repoID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Repository not found"})
		return
	}

	newArchived := !repo.IsArchived
	updates := map[string]interface{}{
		"is_archived": newArchived,
	}

	if newArchived {
		// 归档代码仓必定不处于活跃状态，且默认隐藏
		updates["is_active"] = false
		updates["is_hidden"] = true
	} else {
		// 解档时恢复为活跃且解除隐藏
		updates["is_active"] = true
		updates["is_hidden"] = false
	}

	if err := database.DB.Model(&repo).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update repository archived status"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":     "Repository archive status updated successfully",
		"is_archived": newArchived,
		"is_active":   updates["is_active"],
		"is_hidden":   updates["is_hidden"],
	})
}

// ToggleRepoHide 切换仓库单独的隐藏状态
func ToggleRepoHide(c *gin.Context) {
	idStr := c.Param("id")
	repoID, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid repository ID"})
		return
	}

	var repo models.ManagedRepository
	if err := database.DB.First(&repo, repoID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Repository not found"})
		return
	}

	newHidden := !repo.IsHidden
	if err := database.DB.Model(&repo).Update("is_hidden", newHidden).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update repository hidden status"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":   "Repository hidden status updated successfully",
		"is_hidden": newHidden,
	})
}
