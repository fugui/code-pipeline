package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"code-pipeline/database"
	"code-pipeline/models"
	"code-pipeline/services"

	"github.com/gin-gonic/gin"
	"gorm.io/datatypes"
)

// GetManagedApprovals 获取被管代码仓与保护分支审批单列表
func GetManagedApprovals(c *gin.Context) {
	status := c.Query("status")
	appType := c.Query("type")

	userIDVal, _ := c.Get("userID")
	userID, _ := userIDVal.(uint)

	var user models.User
	isAdmin := false
	if userID > 0 {
		if err := database.DB.First(&user, userID).Error; err == nil {
			isAdmin = user.IsSuperAdmin() || user.HasRole("pipeline_admin")
		}
	}

	query := database.DB.Model(&models.ManagedRepoApproval{})
	if !isAdmin {
		query = query.Where("applicant_id = ?", userID)
	}

	if status != "" && status != "all" {
		query = query.Where("status = ?", status)
	}
	if appType != "" && appType != "all" {
		query = query.Where("type = ?", appType)
	}

	var approvals []models.ManagedRepoApproval
	if err := query.Preload("Applicant").Preload("Approver").Preload("Group").Preload("Repo").Order("created_at DESC").Find(&approvals).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch approval requests"})
		return
	}

	c.JSON(http.StatusOK, approvals)
}

// CreateManagedApproval 提交代码仓或保护分支创建申请
func CreateManagedApproval(c *gin.Context) {
	var req struct {
		Type           string   `json:"type" binding:"required"` // "repo_create" | "protected_branch" | "batch_branch"
		ManagedGroupID uint     `json:"managed_group_id"`
		RepoName       string   `json:"repo_name"`
		RepoID         *uint    `json:"repo_id"`
		TargetBranch   string   `json:"target_branch"`
		BaseBranch     string   `json:"base_branch"`
		MultiRepoIDs   []uint   `json:"multi_repo_ids"`
		Reason         string   `json:"reason"`
		OwnerID        *uint    `json:"owner_id"`
		OwnerName      string   `json:"owner_name"`
		SubsystemID    *uint    `json:"subsystem_id"`
		Subsystem      string   `json:"subsystem"`
		DepartmentID   *uint    `json:"department_id"`
		Department     string   `json:"department"`
		Language       string   `json:"language"`
		MachineType    string   `json:"machine_type"`
		Tags           string   `json:"tags"`
		Description    string   `json:"description"`
		DefaultBranch  string   `json:"default_branch"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request format"})
		return
	}

	userIDVal, _ := c.Get("userID")
	userID, _ := userIDVal.(uint)
	if userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var multiRepoJSON datatypes.JSON
	if len(req.MultiRepoIDs) > 0 {
		bytes, err := json.Marshal(req.MultiRepoIDs)
		if err == nil {
			multiRepoJSON = bytes
		}
	}

	defaultBranch := req.DefaultBranch
	if defaultBranch == "" {
		defaultBranch = req.TargetBranch
	}
	if defaultBranch == "" {
		defaultBranch = "master"
	}

	approval := models.ManagedRepoApproval{
		Type:           req.Type,
		ApplicantID:    userID,
		ManagedGroupID: req.ManagedGroupID,
		RepoName:       req.RepoName,
		RepoID:         req.RepoID,
		TargetBranch:   req.TargetBranch,
		BaseBranch:     req.BaseBranch,
		MultiRepoIDs:   multiRepoJSON,
		Reason:         req.Reason,
		OwnerID:        req.OwnerID,
		OwnerName:      req.OwnerName,
		DepartmentID:   req.DepartmentID,
		Department:     req.Department,
		SubsystemID:    req.SubsystemID,
		Subsystem:      req.Subsystem,
		Language:       req.Language,
		MachineType:    req.MachineType,
		Tags:           req.Tags,
		Description:    req.Description,
		DefaultBranch:  defaultBranch,
		Status:         "pending",
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
	}

	if err := database.DB.Create(&approval).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to create approval request: %v", err)})
		return
	}

	database.DB.Preload("Applicant").Preload("Group").Preload("Repo").First(&approval, approval.ID)
	c.JSON(http.StatusCreated, approval)
}

// ApproveManagedApproval 管理员审核通过申请单
func ApproveManagedApproval(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid approval ID"})
		return
	}

	userIDVal, _ := c.Get("userID")
	userID, _ := userIDVal.(uint)

	var req struct {
		Comment string `json:"comment"`
	}
	_ = c.ShouldBindJSON(&req)

	var approval models.ManagedRepoApproval
	if err := database.DB.Preload("Group").Preload("Repo").First(&approval, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Approval request not found"})
		return
	}

	if approval.Status != "pending" {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Approval request is already %s", approval.Status)})
		return
	}

	// 针对代码仓创建申请
	if approval.Type == "repo_create" {
		if approval.ManagedGroupID == 0 || approval.RepoName == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid repository creation details in approval"})
			return
		}

		var group models.ManagedGroup
		if err := database.DB.First(&group, approval.ManagedGroupID).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Target managed group not found"})
			return
		}

		// 1. 调用远程 Git 平台创建代码仓
		remoteID, sshURL, httpURL, err := services.CreateRemoteRepo(c.Request.Context(), approval.RepoName, group.FullPath)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("Failed to create remote repository: %v", err)})
			return
		}

		// 2. 配置并注册 Webhook
		projectIDStr := strconv.Itoa(int(remoteID))
		headers := prepareRequestHeaders(c)
		_ = services.RegisterWebhook(c.Request.Context(), projectIDStr, headers)
		_ = services.UpdateRepoSettings(c.Request.Context(), projectIDStr, headers)

		defaultBranch := approval.DefaultBranch
		if defaultBranch == "" {
			defaultBranch = approval.TargetBranch
		}
		if defaultBranch == "" {
			defaultBranch = "master"
		}

		ownerID := approval.ApplicantID
		if approval.OwnerID != nil && *approval.OwnerID > 0 {
			ownerID = *approval.OwnerID
		}

		// 3. 写入数据库
		newRepo := models.ManagedRepository{
			ID:                remoteID,
			ManagedGroupID:    approval.ManagedGroupID,
			Name:              approval.RepoName,
			SSHURL:            sshURL,
			HTTPURL:           httpURL,
			OwnerID:           ownerID,
			OwnerName:         approval.OwnerName,
			DepartmentID:      approval.DepartmentID,
			Department:        approval.Department,
			SubsystemID:       approval.SubsystemID,
			Subsystem:         approval.Subsystem,
			Language:          approval.Language,
			MachineType:       approval.MachineType,
			Tags:              approval.Tags,
			Description:       approval.Description,
			DefaultBranch:     defaultBranch,
			IsActive:          true,
			WebhookRegistered: true,
			CreatedAt:         time.Now(),
		}

		if err := database.DB.Create(&newRepo).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to save approved repo to database: %v", err)})
			return
		}

		approval.RepoID = &newRepo.ID
	} else if approval.Type == "protected_branch" {
		if approval.RepoID != nil && *approval.RepoID > 0 {
			var repo models.ManagedRepository
			if err := database.DB.First(&repo, *approval.RepoID).Error; err == nil {
				projectIDStr := strconv.Itoa(int(repo.ID))
				targetBranch := approval.TargetBranch
				if targetBranch == "" {
					targetBranch = "master"
				}
				baseBranch := approval.BaseBranch
				if baseBranch == "" {
					baseBranch = "master"
				}
				_ = services.CreateRemoteBranch(c.Request.Context(), projectIDStr, targetBranch, baseBranch)
				_ = services.ConfigureBranchProtection(c.Request.Context(), projectIDStr, targetBranch)

				// 记录保护规则
				rule := models.ManagedProtectedBranchRule{
					ManagedRepositoryID: repo.ID,
					BranchPattern:       targetBranch,
					AllowForcePush:      false,
					RequireMrAudit:      true,
					CreatorID:           userID,
					CreatedAt:           time.Now(),
				}
				database.DB.Create(&rule)
			}
		}
	}

	approval.Status = "approved"
	approval.ApproverID = &userID
	approval.ApprovalComment = req.Comment
	approval.UpdatedAt = time.Now()

	if err := database.DB.Save(&approval).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update approval status"})
		return
	}

	database.DB.Preload("Applicant").Preload("Approver").Preload("Group").Preload("Repo").First(&approval, approval.ID)
	c.JSON(http.StatusOK, approval)
}

// RejectManagedApproval 管理员驳回申请单
func RejectManagedApproval(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid approval ID"})
		return
	}

	userIDVal, _ := c.Get("userID")
	userID, _ := userIDVal.(uint)

	var req struct {
		Comment string `json:"comment"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Comment is required for rejection"})
		return
	}

	var approval models.ManagedRepoApproval
	if err := database.DB.First(&approval, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Approval request not found"})
		return
	}

	if approval.Status != "pending" {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Approval request is already %s", approval.Status)})
		return
	}

	approval.Status = "rejected"
	approval.ApproverID = &userID
	approval.ApprovalComment = req.Comment
	approval.UpdatedAt = time.Now()

	if err := database.DB.Save(&approval).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to reject approval request"})
		return
	}

	database.DB.Preload("Applicant").Preload("Approver").Preload("Group").Preload("Repo").First(&approval, approval.ID)
	c.JSON(http.StatusOK, approval)
}
