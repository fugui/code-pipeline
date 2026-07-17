package handlers

import (
	"fmt"
	"log"
	"net/http"
	"strconv"

	"code-pipeline/database"
	"code-pipeline/models"
	"code-pipeline/services"
	"code-pipeline/utils"

	"github.com/gin-gonic/gin"
)

// PipelineRequest 流水线输入结构体
type PipelineRequest struct {
	PipelineID  string `json:"pipeline_id" binding:"required"`
	Name        string `json:"name" binding:"required"`
	Type        string `json:"type" binding:"required"`
	GroupName   string `json:"group_name"`
	Description string `json:"description"`
	ServiceID   string `json:"service_id"`
	WorkspaceID string `json:"workspace_id"`
	OwnerID     string `json:"owner_id"`
	OwnerName   string `json:"owner_name"`
	ServiceName string `json:"service_name"`
}

// ExecutionSchemeRequest 执行方案输入结构体
type ExecutionSchemeRequest struct {
	PipelineID       *uint  `json:"pipeline_id" binding:"required"`
	RepositoryID     *uint  `json:"repository_id" binding:"required"`
	Branchs          string `json:"branchs" binding:"required"`
	Languages        string `json:"languages"` // 英文逗号分隔字符串
	MRTrigger        *bool  `json:"mr_trigger"`
	DailyBuild       *bool  `json:"daily_build"`
	DailyBuildTime   string `json:"daily_build_time"`
	CustomAttributes string `json:"custom_attributes"`
}

// GetPipelines 获取流水线列表
func GetPipelines(c *gin.Context) {
	var pipelines []models.Pipeline
	query := database.DB.Model(&models.Pipeline{})

	search := c.Query("search")
	if search != "" {
		query = query.Where("name LIKE ? OR pipeline_id LIKE ? OR group_name LIKE ?", "%"+search+"%", "%"+search+"%", "%"+search+"%")
	}

	if err := query.Find(&pipelines).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch pipelines"})
		return
	}

	c.JSON(http.StatusOK, pipelines)
}

// CreatePipeline 创建流水线
func CreatePipeline(c *gin.Context) {
	var req PipelineRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	pipeline := models.Pipeline{
		PipelineID:  req.PipelineID,
		Name:        req.Name,
		Type:        req.Type,
		GroupName:   req.GroupName,
		Description: req.Description,
		ServiceID:   req.ServiceID,
		WorkspaceID: req.WorkspaceID,
		OwnerID:     req.OwnerID,
		OwnerName:   req.OwnerName,
		ServiceName: req.ServiceName,
	}

	if err := database.DB.Create(&pipeline).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create pipeline. Pipeline ID might already exist."})
		return
	}

	c.JSON(http.StatusCreated, pipeline)
}

// UpdatePipeline 修改流水线
func UpdatePipeline(c *gin.Context) {
	id := c.Param("id")
	var pipeline models.Pipeline
	if err := database.DB.First(&pipeline, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Pipeline not found"})
		return
	}

	var req PipelineRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	pipeline.PipelineID = req.PipelineID
	pipeline.Name = req.Name
	pipeline.Type = req.Type
	pipeline.GroupName = req.GroupName
	pipeline.Description = req.Description
	pipeline.ServiceID = req.ServiceID
	pipeline.WorkspaceID = req.WorkspaceID
	pipeline.OwnerID = req.OwnerID
	pipeline.OwnerName = req.OwnerName
	pipeline.ServiceName = req.ServiceName

	if err := database.DB.Save(&pipeline).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update pipeline"})
		return
	}

	c.JSON(http.StatusOK, pipeline)
}

// DeletePipeline 删除流水线及关联的执行方案
func DeletePipeline(c *gin.Context) {
	id := c.Param("id")
	var pipeline models.Pipeline
	if err := database.DB.First(&pipeline, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Pipeline not found"})
		return
	}

	// 事务删除关联的执行方案
	tx := database.DB.Begin()
	var schemes []models.ExecutionScheme
	if err := tx.Where("pipeline_id = ?", pipeline.ID).Find(&schemes).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to query associated execution schemes"})
		return
	}

	headers := prepareRequestHeaders(c)
	// 同步从三方系统删除方案
	for _, scheme := range schemes {
		if scheme.ExecutionSchemeID != "" {
			go services.SyncDeleteExecutionSchemeRemote(scheme, headers)
		}
	}

	if err := tx.Where("pipeline_id = ?", pipeline.ID).Delete(&models.ExecutionScheme{}).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete associated execution schemes"})
		return
	}

	if err := tx.Delete(&pipeline).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete pipeline"})
		return
	}

	tx.Commit()
	c.JSON(http.StatusOK, gin.H{"message": "Pipeline and associated execution schemes deleted successfully"})
}

// GetExecutionSchemes 获取指定流水线的执行方案
func GetExecutionSchemes(c *gin.Context) {
	pipelineIDStr := c.Query("pipeline_id")
	repoIDStr := c.Query("repository_id")

	if pipelineIDStr == "" && repoIDStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "pipeline_id or repository_id query parameter is required"})
		return
	}

	query := database.DB.Preload("Repository").Preload("PipelineInfo")

	if pipelineIDStr != "" {
		pipelineID, err := strconv.ParseUint(pipelineIDStr, 10, 32)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid pipeline_id"})
			return
		}
		query = query.Where("pipeline_id = ?", uint(pipelineID))
	}

	if repoIDStr != "" {
		repoID, err := strconv.ParseUint(repoIDStr, 10, 32)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid repository_id"})
			return
		}
		query = query.Where("repository_id = ?", uint(repoID))
	}

	var schemes []models.ExecutionScheme
	if err := query.Find(&schemes).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch execution schemes"})
		return
	}

	template := models.AppConfig.PipelineSystem.PipelineLinkTemplate
	taskTemplate := models.AppConfig.PipelineSystem.LinkCheckerTaskURL
	for i := range schemes {
		if template != "" && schemes[i].PipelineInfo != nil {
			schemes[i].PipelineInfo.WebURL = generateWebURL(schemes[i].PipelineInfo, template)
		}
		if taskTemplate != "" {
			schemes[i].CodeCheckerTaskWebURL = generateTaskWebURL(schemes[i].CodeCheckerTaskID, taskTemplate)
		}
	}

	c.JSON(http.StatusOK, schemes)
}

// CreateExecutionScheme 创建执行方案，并同步到三方流水线系统
func CreateExecutionScheme(c *gin.Context) {
	var req ExecutionSchemeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		log.Printf("[CreateExecutionScheme] Bind JSON failed: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.PipelineID == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "pipeline_id is required"})
		return
	}
	if req.RepositoryID == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "repository_id is required"})
		return
	}

	// 检查 Pipeline 是否存在
	var pipeline models.Pipeline
	if err := database.DB.First(&pipeline, *req.PipelineID).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Associated pipeline not found"})
		return
	}

	scheme := models.ExecutionScheme{
		LocalPipelineID:  *req.PipelineID,
		RepositoryID:     *req.RepositoryID,
		Branch:           req.Branchs,
		Languages:        req.Languages,
		CustomAttributes: req.CustomAttributes,
	}
	if req.MRTrigger != nil {
		scheme.MRTrigger = *req.MRTrigger
	} else {
		scheme.MRTrigger = true
	}
	if req.DailyBuild != nil {
		scheme.DailyBuild = *req.DailyBuild
	} else {
		scheme.DailyBuild = true
	}
	if req.DailyBuildTime != "" {
		scheme.DailyBuildTime = req.DailyBuildTime
	} else {
		scheme.DailyBuildTime = "00:30"
	}

	// 创建一个流水线执行方案， 需要多个步骤
	// 1. 创建一个代码检查执行任务
	// 2. 创建一个执行方案（关联到这个代码检查任务）
	// 3. 创建一个 MR 触发关联（MR触发关联到这个方案）

	headers := prepareRequestHeaders(c)
	// 同步去三方流水线系统创建
	extID, err := services.SyncCreateExecutionSchemeRemote(c.Request.Context(), pipeline.PipelineID, &scheme, headers)
	if err != nil {
		log.Printf("[Pipeline] Remote sync failed for CreateExecutionScheme: %v\n", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("同步到三方流水线系统失败: %v", err)})
		return
	}
	scheme.ExecutionSchemeID = extID

	if err := database.DB.Create(&scheme).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create execution scheme in local DB"})
		return
	}

	// 加载 repository
	database.DB.Preload("Repository").First(&scheme, scheme.ID)

	taskTemplate := models.AppConfig.PipelineSystem.LinkCheckerTaskURL
	if taskTemplate != "" {
		scheme.CodeCheckerTaskWebURL = generateTaskWebURL(scheme.CodeCheckerTaskID, taskTemplate)
	}

	c.JSON(http.StatusCreated, scheme)
}

// DeleteExecutionScheme 删除执行方案，并从三方流水线系统删除
func DeleteExecutionScheme(c *gin.Context) {
	id := c.Param("id")
	var scheme models.ExecutionScheme
	if err := database.DB.First(&scheme, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Execution scheme not found"})
		return
	}

	if scheme.ExecutionSchemeID != "" {
		headers := prepareRequestHeaders(c)
		// 异步或同步删除远程系统中的方案
		go services.SyncDeleteExecutionSchemeRemote(scheme, headers)
	}

	if err := database.DB.Delete(&scheme).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete execution scheme locally"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Execution scheme deleted successfully"})
}

// generateWebURL 使用公共的模板占位符替换函数生成可供前端跳转的流水线外链
func generateWebURL(p *models.Pipeline, template string) string {
	if template == "" || p == nil {
		return ""
	}
	return utils.ReplacePlaceholders(template, map[string]string{
		"{OWNER_ID}":    p.OwnerID,
		"{SERVICE_ID}":  p.ServiceID,
		"{PIPELINE_ID}": p.PipelineID,
	})
}

// generateTaskWebURL 使用公共的模板占位符替换函数生成可供前端跳转的检查任务外链
func generateTaskWebURL(taskID string, template string) string {
	if template == "" || taskID == "" {
		return ""
	}
	return utils.ReplacePlaceholders(template, map[string]string{
		"{TASK_ID}": taskID,
	})
}

// RunExecutionScheme 运行/触发执行方案
func RunExecutionScheme(c *gin.Context) {
	id := c.Param("id")
	var scheme models.ExecutionScheme
	if err := database.DB.First(&scheme, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Execution scheme not found"})
		return
	}

	if scheme.ExecutionSchemeID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Execution scheme has no remote binding ID"})
		return
	}

	// 查询对应的 Pipeline 以获取 OwnerID
	var pipeline models.Pipeline
	if err := database.DB.First(&pipeline, scheme.LocalPipelineID).Error; err == nil {
		pipelineBusinessID := pipeline.PipelineID
		_ = pipelineBusinessID
	} else {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Associated pipeline not found"})
		return
	}

	// 从 Context 获取 EmployeeID 并格式化，避免重复查询数据库
	employeeID := utils.FormatEmployeeID(c.GetString("employeeID"))

	headers := prepareRequestHeaders(c)
	if headers == nil {
		headers = make(map[string]string)
	}
	headers["x-user-name"] = employeeID
	headers["x-user-owner"] = pipeline.OwnerID

	jobID, err := services.SyncRunExecutionSchemeRemote(scheme, headers)
	if err != nil {
		log.Printf("[Pipeline] Remote run failed for scheme %s: %v\n", scheme.ExecutionSchemeID, err)
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("启动流水线失败: %v", err)})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "流水线已成功启动", "job_id": jobID})
}
