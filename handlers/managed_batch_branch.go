package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"sync"
	"time"

	"code-pipeline/database"
	"code-pipeline/models"
	"code-pipeline/services"

	"github.com/gin-gonic/gin"
	"gorm.io/datatypes"
)

type BatchRepoResult struct {
	RepoID   uint   `json:"repo_id"`
	RepoName string `json:"repo_name"`
	Status   string `json:"status"` // "success" | "skipped" | "failed"
	Message  string `json:"message"`
}

// BatchCreateManagedBranches 跨仓一键同步创建特性分支
func BatchCreateManagedBranches(c *gin.Context) {
	var req struct {
		FeatureName string `json:"feature_name" binding:"required"`
		BaseBranch  string `json:"base_branch"`
		RepoIDs     []uint `json:"repo_ids" binding:"required"`
		Description string `json:"description"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request format"})
		return
	}

	if len(req.RepoIDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "At least one repository must be selected"})
		return
	}

	userIDVal, _ := c.Get("userID")
	userID, _ := userIDVal.(uint)

	baseBranch := req.BaseBranch
	if baseBranch == "" {
		baseBranch = "master"
	}

	var repos []models.ManagedRepository
	if err := database.DB.Where("id IN ?", req.RepoIDs).Find(&repos).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to query selected repositories"})
		return
	}

	results := make([]BatchRepoResult, len(repos))
	var wg sync.WaitGroup

	for i, repo := range repos {
		wg.Add(1)
		go func(idx int, r models.ManagedRepository) {
			defer wg.Done()
			projectIDStr := strconv.Itoa(int(r.ID))

			// 调用远程 Git API 同步拉起分支
			err := services.CreateRemoteBranch(c.Request.Context(), projectIDStr, req.FeatureName, baseBranch)
			if err != nil {
				results[idx] = BatchRepoResult{
					RepoID:   r.ID,
					RepoName: r.Name,
					Status:   "failed",
					Message:  fmt.Sprintf("拉起分支失败: %v", err),
				}
			} else {
				results[idx] = BatchRepoResult{
					RepoID:   r.ID,
					RepoName: r.Name,
					Status:   "success",
					Message:  "特性分支创建成功",
				}

				// 记录/更新分支监控
				var monitor models.ManagedBranchMonitor
				if errDb := database.DB.Where("managed_repository_id = ? AND branch_name = ?", r.ID, req.FeatureName).First(&monitor).Error; errDb != nil {
					newMonitor := models.ManagedBranchMonitor{
						ManagedRepositoryID: r.ID,
						BranchName:          req.FeatureName,
						LastCommitTime:      time.Now(),
						Status:              "active",
						UpdatedAt:           time.Now(),
					}
					database.DB.Create(&newMonitor)
				}
			}
		}(i, repo)
	}

	wg.Wait()

	// 序列化结果与仓库 IDs 保存批次日志
	repoIDsJSON, _ := json.Marshal(req.RepoIDs)
	resultsJSON, _ := json.Marshal(results)
	batchID := fmt.Sprintf("batch_%d_%s", time.Now().Unix(), req.FeatureName)

	logEntry := models.ManagedBatchBranchLog{
		BatchID:     batchID,
		FeatureName: req.FeatureName,
		BaseBranch:  baseBranch,
		CreatorID:   userID,
		RepoIDs:     datatypes.JSON(repoIDsJSON),
		Results:     datatypes.JSON(resultsJSON),
		Description: req.Description,
		CreatedAt:   time.Now(),
	}
	database.DB.Create(&logEntry)

	c.JSON(http.StatusOK, gin.H{
		"batch_id":     batchID,
		"feature_name": req.FeatureName,
		"base_branch":  baseBranch,
		"results":      results,
	})
}

// GetManagedBatchBranchLogs 获取跨仓特性分支批量拉起历史记录
func GetManagedBatchBranchLogs(c *gin.Context) {
	var logs []models.ManagedBatchBranchLog
	if err := database.DB.Preload("Creator").Order("created_at DESC").Limit(50).Find(&logs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch batch branch logs"})
		return
	}
	c.JSON(http.StatusOK, logs)
}

// GetProtectedBranchRules 获取保护分支规则配置
func GetProtectedBranchRules(c *gin.Context) {
	repoIDStr := c.Query("repo_id")
	query := database.DB.Model(&models.ManagedProtectedBranchRule{})

	if repoIDStr != "" {
		if repoID, err := strconv.Atoi(repoIDStr); err == nil {
			query = query.Where("managed_repository_id = ?", repoID)
		}
	}

	var rules []models.ManagedProtectedBranchRule
	if err := query.Preload("Repo").Order("created_at DESC").Find(&rules).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch protected branch rules"})
		return
	}
	c.JSON(http.StatusOK, rules)
}

// CreateProtectedBranchRule 新增保护分支规则
func CreateProtectedBranchRule(c *gin.Context) {
	var req struct {
		ManagedRepositoryID uint   `json:"managed_repository_id" binding:"required"`
		BranchPattern       string `json:"branch_pattern" binding:"required"`
		AllowForcePush      bool   `json:"allow_force_push"`
		RequireMrAudit      bool   `json:"require_mr_audit"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request format"})
		return
	}

	userIDVal, _ := c.Get("userID")
	userID, _ := userIDVal.(uint)

	var repo models.ManagedRepository
	if err := database.DB.First(&repo, req.ManagedRepositoryID).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Managed repository not found"})
		return
	}

	// 远程配置保护分支
	projectIDStr := strconv.Itoa(int(repo.ID))
	_ = services.ConfigureBranchProtection(c.Request.Context(), projectIDStr, req.BranchPattern)

	rule := models.ManagedProtectedBranchRule{
		ManagedRepositoryID: req.ManagedRepositoryID,
		BranchPattern:       req.BranchPattern,
		AllowForcePush:      req.AllowForcePush,
		RequireMrAudit:      req.RequireMrAudit,
		CreatorID:           userID,
		CreatedAt:           time.Now(),
	}

	if err := database.DB.Create(&rule).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create protected branch rule"})
		return
	}

	database.DB.Preload("Repo").First(&rule, rule.ID)
	c.JSON(http.StatusCreated, rule)
}
