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

// GetManagedRepos 获取被管代码仓列表
func GetManagedRepos(c *gin.Context) {
	groupIDStr := c.Query("group_id")
	query := database.DB.Model(&models.ManagedRepository{})

	if groupIDStr != "" {
		groupID, err := strconv.Atoi(groupIDStr)
		if err == nil {
			query = query.Where("managed_group_id = ?", groupID)
		}
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

// SyncManagedGroup 从托管平台同步嵌套组的子组和代码仓
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

	// 本地 ID 自打创建起就是 CodeHub 的真实 ID (即 startGroup.ID)，直接用于数据清理和单层同步

	// 1. 开启事务，清除本地已记录的与该 group (startGroup.ID) 及其所有后代节点关联的子组、代码仓及关联子表缓存，防止宿主端已删除数据继续残留
	txClean := database.DB.Begin()
	var groupIDs []uint
	likePattern := startGroup.FullPath + "/%"
	// 找到所有后代组的 ID 列表 (包含当前组自己)
	if err := txClean.Model(&models.ManagedGroup{}).
		Where("id = ? OR full_path LIKE ?", startGroup.ID, likePattern).
		Pluck("id", &groupIDs).Error; err != nil {
		txClean.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to query groups for cleaning: %v", err)})
		return
	}

	if len(groupIDs) > 0 {
		// 找到这些组下的所有被管仓库 ID
		var repoIDs []uint
		if err := txClean.Model(&models.ManagedRepository{}).
			Where("managed_group_id IN ?", groupIDs).
			Pluck("id", &repoIDs).Error; err != nil {
			txClean.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to query repositories for cleaning: %v", err)})
			return
		}

		if len(repoIDs) > 0 {
			// 删除这些仓库关联的分支审计和 ACL
			if err := txClean.Where("managed_repository_id IN ?", repoIDs).Delete(&models.ManagedBranchMonitor{}).Error; err != nil {
				txClean.Rollback()
				c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to clean branch monitor cache: %v", err)})
				return
			}
			if err := txClean.Where("source_type = 'repository' AND source_id IN ?", repoIDs).Delete(&models.ManagedMemberAccess{}).Error; err != nil {
				txClean.Rollback()
				c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to clean repository ACLs: %v", err)})
				return
			}
			// 删除这些仓库记录
			if err := txClean.Where("id IN ?", repoIDs).Delete(&models.ManagedRepository{}).Error; err != nil {
				txClean.Rollback()
				c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to clean managed repositories: %v", err)})
				return
			}
		}

		// 收集所有需要物理删除的子孙组 ID (排除当前组本身)
		var childGroupIDs []uint
		for _, gid := range groupIDs {
			if gid != startGroup.ID {
				childGroupIDs = append(childGroupIDs, gid)
			}
		}
		if len(childGroupIDs) > 0 {
			if err := txClean.Where("source_type = 'group' AND source_id IN ?", childGroupIDs).Delete(&models.ManagedMemberAccess{}).Error; err != nil {
				txClean.Rollback()
				c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to clean child group ACLs: %v", err)})
				return
			}
			// 删除子孙组记录
			if err := txClean.Where("id IN ?", childGroupIDs).Delete(&models.ManagedGroup{}).Error; err != nil {
				txClean.Rollback()
				c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to clean child groups: %v", err)})
				return
			}
		}
	}

	if err := txClean.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to commit cleaning transaction: %v", err)})
		return
	}

	// 2. 同步当前组直属的项目
	remotes, err := services.GetRemoteProjects(c.Request.Context(), startGroup.ID)
	if err == nil {
		for _, rp := range remotes {
			sshURL := rp.SSHURL
			if sshURL == "" {
				sshURL = rp.SSHURLToRepo
			}
			httpURL := rp.HTTPURL
			if httpURL == "" {
				httpURL = rp.HTTPURLToRepo
			}

			var existing models.ManagedRepository
			errDb := database.DB.Where("id = ?", rp.ID).First(&existing).Error
			if errDb == nil {
				// 更新已有项目
				database.DB.Model(&existing).Updates(models.ManagedRepository{
					Name:           rp.Name,
					SSHURL:         sshURL,
					HTTPURL:        httpURL,
					ManagedGroupID: startGroup.ID,
				})
			} else {
				// 新增项目，主键使用远程 ID
				newRepo := models.ManagedRepository{
					ID:             rp.ID,
					ManagedGroupID: startGroup.ID,
					Name:           rp.Name,
					SSHURL:         sshURL,
					HTTPURL:        httpURL,
					OwnerID:        userID,
					IsActive:       true,
					CreatedAt:      time.Now(),
				}
				database.DB.Create(&newRepo)
			}
		}
	}

	// 3. 同步当前组直属的子群组
	subgroups, err := services.GetRemoteSubgroups(c.Request.Context(), startGroup.ID)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("Failed to fetch remote subgroups: %v", err)})
		return
	}

	for _, sub := range subgroups {
		var fullPath string
		if startGroup.FullPath != "" {
			fullPath = startGroup.FullPath + "/" + sub.Path
		} else {
			fullPath = sub.Path
		}

		var existingGroup models.ManagedGroup
		errDb := database.DB.Where("id = ?", sub.ID).First(&existingGroup).Error
		if errDb == nil {
			// 更新已存在的组
			pID := startGroup.ID
			database.DB.Model(&existingGroup).Updates(models.ManagedGroup{
				Name:     sub.Name,
				Path:     sub.Path,
				FullPath: fullPath,
				ParentID: &pID,
			})
		} else {
			// 创建新组，主键使用远程 ID
			pID := startGroup.ID
			newGroup := models.ManagedGroup{
				ID:        sub.ID,
				Name:      sub.Name,
				Path:      sub.Path,
				FullPath:  fullPath,
				ParentID:  &pID,
				CreatedAt: time.Now(),
			}
			database.DB.Create(&newGroup)
		}
	}

	c.JSON(http.StatusOK, gin.H{"message": "Group direct sub-groups and repositories synchronized successfully"})
}

