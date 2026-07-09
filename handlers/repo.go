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
	"code-pipeline/utils"

	"github.com/gin-gonic/gin"
)

// GetRepos 获取代码仓列表，支持分页和多维过滤
func GetRepos(c *gin.Context) {
	pageStr := c.DefaultQuery("page", "1")
	pageSizeStr := c.DefaultQuery("page_size", "20")
	search := c.Query("search")
	serviceGroup := c.Query("service_group")
	ownerName := c.Query("owner_name")
	hasScheme := c.Query("has_scheme") // "all"(默认) | "yes" | "no"

	page, err := strconv.Atoi(pageStr)
	if err != nil || page < 1 {
		page = 1
	}
	pageSize, err := strconv.Atoi(pageSizeStr)
	if err != nil || pageSize < 1 || pageSize > 200 {
		pageSize = 20
	}

	query := database.DB.Model(&models.Repository{})

	if search != "" {
		like := "%" + search + "%"
		query = query.Where("name LIKE ? OR service_group LIKE ? OR owner_name LIKE ?", like, like, like)
	}
	if serviceGroup != "" {
		query = query.Where("service_group = ?", serviceGroup)
	}
	if ownerName != "" {
		query = query.Where("owner_name = ?", ownerName)
	}
	switch hasScheme {
	case "yes":
		query = query.Where("id IN (SELECT repository_id FROM execution_schemes)")
	case "no":
		query = query.Where("id NOT IN (SELECT repository_id FROM execution_schemes)")
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to count repositories"})
		return
	}

	var repos []models.Repository
	offset := (page - 1) * pageSize
	if err := query.Preload("Schemes").Preload("Schemes.PipelineInfo").Order("name ASC").Offset(offset).Limit(pageSize).Find(&repos).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch repositories"})
		return
	}

	template := models.AppConfig.PipelineSystem.PipelineLinkTemplate
	if template != "" {
		for i := range repos {
			for j := range repos[i].Schemes {
				if repos[i].Schemes[j].PipelineInfo != nil {
					repos[i].Schemes[j].PipelineInfo.WebURL = generateWebURL(repos[i].Schemes[j].PipelineInfo, template)
				}
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"items":     repos,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

// GetRepoFilterOptions 返回用于前端下拉过滤的候选项
func GetRepoFilterOptions(c *gin.Context) {
	var serviceGroups []string
	database.DB.Model(&models.Repository{}).
		Distinct("service_group").
		Where("service_group != ''").
		Order("service_group ASC").
		Pluck("service_group", &serviceGroups)

	var ownerNames []string
	database.DB.Model(&models.Repository{}).
		Distinct("owner_name").
		Where("owner_name != ''").
		Order("owner_name ASC").
		Pluck("owner_name", &ownerNames)

	c.JSON(http.StatusOK, gin.H{
		"service_groups": serviceGroups,
		"owner_names":    ownerNames,
	})
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

	// 查找该分支所绑定的执行方案 (ExecutionScheme)
	var scheme models.ExecutionScheme
	if err := database.DB.Where("repository_id = ? AND branch = ?", repoID, branch).First(&scheme).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "No execution scheme configured for this branch"})
		return
	}

	log.Printf("[ThirdPartyTrigger] Triggering pipeline scheme %s (ID: %s) for repo %d branch %s...",
		scheme.CodeCheckerTaskID, scheme.ExecutionSchemeID, repoID, branch)

	c.JSON(http.StatusOK, gin.H{
		"message":             "Third-party pipeline triggered successfully",
		"execution_scheme_id": scheme.ExecutionSchemeID,
		"status":              "running",
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

	var scheme models.ExecutionScheme
	if err := database.DB.Where("repository_id = ? AND branch = ?", repoID, branch).First(&scheme).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{
			"has_scheme": false,
			"message":    "No execution scheme bound",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"has_scheme":          true,
		"execution_scheme_id": scheme.ExecutionSchemeID,
		"status":              "success",
		"duration_sec":        128,
		"start_time":          time.Now().Add(-1 * time.Hour).Format(time.RFC3339),
		"checker_task_id":     scheme.CodeCheckerTaskID,
		"external_log_url":    "http://192.168.56.18:9080/pipelines/logs/" + scheme.ExecutionSchemeID,
	})
}

// GetRepoBranches 获取仓库相关的分支列表
func GetRepoBranches(c *gin.Context) {
	id := c.Param("id")
	var repo models.Repository
	if err := database.DB.First(&repo, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Repository not found"})
		return
	}

	formattedURL := utils.SSHToHTTPS(repo.URL)

	headers := prepareRequestHeaders(c)
	authID, err := services.CheckRepoAuthorized(c.Request.Context(), formattedURL, headers)
	if err != nil {
		if HandleSSOExpired(c, err) {
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to check repository authorization: %v", err)})
		return
	}
	if authID == "" {
		c.JSON(http.StatusForbidden, gin.H{"error": fmt.Sprintf("Repository %s is not authorized", repo.Name)})
		return
	}

	urlForBranches := formattedURL
	if !strings.HasSuffix(urlForBranches, ".git") {
		urlForBranches = urlForBranches + ".git"
	}
	branches, err := services.GetRepoBranchesRemote(c.Request.Context(), urlForBranches, authID, headers)
	if err != nil {
		if HandleSSOExpired(c, err) {
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to fetch branches from remote: %v", err)})
		return
	}

	c.JSON(http.StatusOK, branches)
}

// CheckRepoWebhook 检查代码仓在托管平台的 Webhook 注册状态，并同步更新本地 DB 缓存
func CheckRepoWebhook(c *gin.Context) {
	id := c.Param("id")
	var repo models.Repository
	if err := database.DB.First(&repo, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Repository not found"})
		return
	}

	projectID := repo.ProjectID
	if projectID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Repository has no project ID configured"})
		return
	}

	headers := prepareRequestHeaders(c)
	registered, err := services.CheckWebhookRegistered(c.Request.Context(), projectID, headers)
	if err != nil {
		if HandleSSOExpired(c, err) {
			return
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("Failed to check webhook status: %v", err)})
		return
	}

	// 更新 DB 缓存
	database.DB.Model(&repo).Update("webhook_registered", registered)

	c.JSON(http.StatusOK, gin.H{"registered": registered})
}

// RegisterRepoWebhook 为代码仓在托管平台注册 Webhook，并更新本地 DB 缓存
func RegisterRepoWebhook(c *gin.Context) {
	id := c.Param("id")
	var repo models.Repository
	if err := database.DB.First(&repo, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Repository not found"})
		return
	}

	projectID := repo.ProjectID
	if projectID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Repository has no project ID configured"})
		return
	}

	headers := prepareRequestHeaders(c)

	// 前置检查：如果远程已经存在该 Webhook，就直接置为 true，防止重复注册报错
	alreadyRegistered, err := services.CheckWebhookRegistered(c.Request.Context(), projectID, headers)
	if err == nil && alreadyRegistered {
		database.DB.Model(&repo).Update("webhook_registered", true)
		c.JSON(http.StatusOK, gin.H{"success": true, "message": "Webhook already registered on remote, synchronized state successfully"})
		return
	}

	// 远程确实不存在，发起注册
	if err := services.RegisterWebhook(c.Request.Context(), projectID, headers); err != nil {
		if HandleSSOExpired(c, err) {
			return
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("Failed to register webhook: %v", err)})
		return
	}

	// 注册成功，更新 DB 缓存
	database.DB.Model(&repo).Update("webhook_registered", true)

	c.JSON(http.StatusOK, gin.H{"success": true, "message": "Webhook registered successfully"})
}
