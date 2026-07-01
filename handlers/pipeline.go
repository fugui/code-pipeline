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
	Owner       string `json:"owner"`
	ServiceName string `json:"service_name"`
}

// ExecutionPlanRequest 执行方案输入结构体
type ExecutionPlanRequest struct {
	PipelineID       *uint  `json:"pipeline_id" binding:"required"`
	RepositoryID     *uint  `json:"repository_id" binding:"required"`
	Branchs          string `json:"branchs" binding:"required"`
	Languages        string `json:"languages"` // 英文逗号分隔字符串
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
		Owner:       req.Owner,
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
	pipeline.Owner = req.Owner
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
	var plans []models.ExecutionPlan
	if err := tx.Where("pipeline_id = ?", pipeline.ID).Find(&plans).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to query associated execution plans"})
		return
	}

	// 同步从三方系统删除方案
	for _, plan := range plans {
		if plan.ExecutionPlanID != "" {
			go services.SyncDeleteExecutionPlanRemote(plan.ExecutionPlanID)
		}
	}

	if err := tx.Where("pipeline_id = ?", pipeline.ID).Delete(&models.ExecutionPlan{}).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete associated execution plans"})
		return
	}

	if err := tx.Delete(&pipeline).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete pipeline"})
		return
	}

	tx.Commit()
	c.JSON(http.StatusOK, gin.H{"message": "Pipeline and associated execution plans deleted successfully"})
}

// GetExecutionPlans 获取指定流水线的执行方案
func GetExecutionPlans(c *gin.Context) {
	pipelineIDStr := c.Query("pipeline_id")
	repoIDStr := c.Query("repository_id")

	if pipelineIDStr == "" && repoIDStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "pipeline_id or repository_id query parameter is required"})
		return
	}

	query := database.DB.Preload("Repository")

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

	var plans []models.ExecutionPlan
	if err := query.Find(&plans).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch execution plans"})
		return
	}

	c.JSON(http.StatusOK, plans)
}

// CreateExecutionPlan 创建执行方案，并同步到三方流水线系统
func CreateExecutionPlan(c *gin.Context) {
	var req ExecutionPlanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		log.Printf("[CreateExecutionPlan] Bind JSON failed: %v", err)
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

	plan := models.ExecutionPlan{
		PipelineID:       *req.PipelineID,
		RepositoryID:     *req.RepositoryID,
		Branch:           req.Branchs,
		Languages:        req.Languages,
		CustomAttributes: req.CustomAttributes,
	}

	// 创建一个流水线执行方案， 需要多个步骤
	// 1. 创建一个代码检查执行任务
	// 2. 创建一个执行方案（关联到这个代码检查任务）
	// 3. 创建一个 MR 触发关联（MR触发关联到这个方案）

	headers := prepareRequestHeaders(c)
	// 同步去三方流水线系统创建
	extID, err := services.SyncCreateExecutionPlanRemote(c.Request.Context(), pipeline.PipelineID, &plan, headers)
	if err != nil {
		log.Printf("[Pipeline] Remote sync failed for CreateExecutionPlan (using Mock ID): %v\n", err)
		extID = fmt.Sprintf("ext_plan_%d", time.Now().UnixNano())
	}
	plan.ExecutionPlanID = extID

	if err := database.DB.Create(&plan).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create execution plan in local DB"})
		return
	}

	// 加载 repository
	database.DB.Preload("Repository").First(&plan, plan.ID)

	c.JSON(http.StatusCreated, plan)
}

// UpdateExecutionPlan 修改执行方案，并同步更新至三方流水线系统
func UpdateExecutionPlan(c *gin.Context) {
	id := c.Param("id")
	var plan models.ExecutionPlan
	if err := database.DB.First(&plan, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Execution plan not found"})
		return
	}

	var req ExecutionPlanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
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

	var pipeline models.Pipeline
	if err := database.DB.First(&pipeline, *req.PipelineID).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Associated pipeline not found"})
		return
	}

	plan.PipelineID = *req.PipelineID
	plan.RepositoryID = *req.RepositoryID
	plan.Branch = req.Branchs
	plan.Languages = req.Languages
	plan.CustomAttributes = req.CustomAttributes

	// 如果原来没有 ext ID，则生成一个
	if plan.ExecutionPlanID == "" {
		plan.ExecutionPlanID = fmt.Sprintf("ext_plan_%d", time.Now().UnixNano())
	}

	// 同步修改至三方系统
	if err := services.SyncUpdateExecutionPlanRemote(pipeline.PipelineID, plan); err != nil {
		log.Printf("[Pipeline] Remote sync failed for UpdateExecutionPlan: %v\n", err)
	}

	if err := database.DB.Save(&plan).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update execution plan locally"})
		return
	}

	// 加载 repository
	database.DB.Preload("Repository").First(&plan, plan.ID)

	c.JSON(http.StatusOK, plan)
}

// DeleteExecutionPlan 删除执行方案，并从三方流水线系统删除
func DeleteExecutionPlan(c *gin.Context) {
	id := c.Param("id")
	var plan models.ExecutionPlan
	if err := database.DB.First(&plan, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Execution plan not found"})
		return
	}

	if plan.ExecutionPlanID != "" {
		// 异步或同步删除远程系统中的方案
		go services.SyncDeleteExecutionPlanRemote(plan.ExecutionPlanID)
	}

	if err := database.DB.Delete(&plan).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete execution plan locally"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Execution plan deleted successfully"})
}
