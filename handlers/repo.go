package handlers

import (
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"code-pipeline/database"
	"code-pipeline/models"
	"code-pipeline/services"
	"code-pipeline/utils"

	"github.com/gin-gonic/gin"
)

func GetRepos(c *gin.Context) {
	var repos []models.Repository
	query := database.DB.Model(&models.Repository{})

	search := c.Query("search")
	if search != "" {
		query = query.Where("name LIKE ?", "%"+search+"%")
	}

	if err := query.Find(&repos).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch repositories"})
		return
	}

	c.JSON(http.StatusOK, repos)
}

func GetRepoDetails(c *gin.Context) {
	id := c.Param("id")
	var repo models.Repository
	if err := database.DB.First(&repo, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Repository not found"})
		return
	}
	c.JSON(http.StatusOK, repo)
}

func TriggerRepo(c *gin.Context) {
	idStr := c.Param("id")
	branch := c.Query("branch")
	if branch == "" {
		branch = "master"
	}

	repoID, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid repository ID"})
		return
	}

	// 查找该分支所绑定的执行方案 (ExecutionPlan)
	var plan models.ExecutionPlan
	if err := database.DB.Where("repository_id = ? AND branch = ?", repoID, branch).First(&plan).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "No execution plan configured for this branch"})
		return
	}

	// 模拟触发第三方系统
	log.Printf("[ThirdPartyTrigger] Triggering pipeline plan %s (ID: %s) for repo %d branch %s...",
		plan.CodeCheckerTaskID, plan.ExecutionPlanID, repoID, branch)

	c.JSON(http.StatusOK, gin.H{
		"message":           "Third-party pipeline triggered successfully",
		"execution_plan_id": plan.ExecutionPlanID,
		"status":            "running",
	})
}

// GetRepoLatestLog 实时向第三方系统拉取最新执行日志及状态
func GetRepoLatestLog(c *gin.Context) {
	idStr := c.Param("id")
	branch := c.Query("branch")
	if branch == "" {
		branch = "master"
	}

	repoID, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid repository ID"})
		return
	}

	var plan models.ExecutionPlan
	if err := database.DB.Where("repository_id = ? AND branch = ?", repoID, branch).First(&plan).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{
			"has_plan": false,
			"message":  "No execution plan bound",
		})
		return
	}

	// 实时代理拉取第三方系统的最后执行状态与日志 URL (此处提供高保真模拟)
	c.JSON(http.StatusOK, gin.H{
		"has_plan":          true,
		"execution_plan_id": plan.ExecutionPlanID,
		"status":            "success", // 模拟状态: success, failed, running
		"duration_sec":      128,
		"start_time":        time.Now().Add(-1 * time.Hour).Format(time.RFC3339),
		"checker_task_id":   plan.CodeCheckerTaskID,
		"external_log_url":  "http://192.168.56.18:9080/pipelines/logs/" + plan.ExecutionPlanID, // 跳转三方系统的链接
	})
}

// GetRepoBranches 获取仓库相关的分支列表
func GetRepoBranches(c *gin.Context) {
	id := c.Param("id")
	// 验证仓库是否存在
	var repo models.Repository
	if err := database.DB.First(&repo, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Repository not found"})
		return
	}

	// 1. 把 Repo 的 URL 格式化成为 https 格式
	formattedURL := utils.SSHToHTTPS(repo.URL)

	// 2. 获取代码仓的授权ID (调用 CheckRepoAuthorized)
	headers := prepareRequestHeaders(c)
	authID, err := services.CheckRepoAuthorized(c.Request.Context(), formattedURL, headers)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to check repository authorization: %v", err)})
		return
	}
	if authID == "" {
		c.JSON(http.StatusForbidden, gin.H{"error": fmt.Sprintf("Repository %s is not authorized", repo.Name)})
		return
	}

	// 3. 调用 API 获取该代码仓的分支信息， 该API由三方流水线系统提供， 基于 URL 的GET请求的RESTful API
	// 其返回格式为：{"status":"success", "result": [string]}
	branches, err := services.GetRepoBranchesRemote(c.Request.Context(), formattedURL, authID, headers)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to fetch branches from remote: %v", err)})
		return
	}

	c.JSON(http.StatusOK, branches)
}
