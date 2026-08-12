package handlers

import (
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"

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
	Name             string `json:"name" binding:"required"`
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

	template := models.AppConfig.PipelineSystem.PipelineLinkTemplate
	if template != "" {
		for i := range pipelines {
			pipelines[i].WebURL = generateWebURL(&pipelines[i], template)
		}
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

	template := models.AppConfig.PipelineSystem.PipelineLinkTemplate
	if template != "" {
		pipeline.WebURL = generateWebURL(&pipeline, template)
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

	template := models.AppConfig.PipelineSystem.PipelineLinkTemplate
	if template != "" {
		pipeline.WebURL = generateWebURL(&pipeline, template)
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
	// 同步从三方系统删除方案，若有失败则终止流程
	for _, scheme := range schemes {
		if scheme.ExecutionSchemeID != "" || scheme.MRBindingID != "" || scheme.ExecutionPlanID != "" {
			if err := services.SyncDeleteExecutionSchemeRemote(scheme, headers); err != nil {
				tx.Rollback()
				c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("下架关联执行方案[%s]失败: %v", scheme.Name, err)})
				return
			}
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

	name := strings.TrimSpace(req.Name)
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "执行方案名称 (name) 不能为空"})
		return
	}

	scheme := models.ExecutionScheme{
		LocalPipelineID:  *req.PipelineID,
		RepositoryID:     *req.RepositoryID,
		Name:             name,
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
		scheme.DailyBuildTime = utils.GetRandomDailyBuildTime()
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
		log.Printf("[Pipeline] DB.Create failed for scheme %s: %v. Rolling back remote objects...", scheme.Name, err)
		go services.SyncDeleteExecutionSchemeRemote(scheme, headers)
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

// UpdateExecutionScheme 更新执行方案（更新构建参数、触发参数等）
func UpdateExecutionScheme(c *gin.Context) {
	id := c.Param("id")
	var scheme models.ExecutionScheme
	if err := database.DB.First(&scheme, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Execution scheme not found"})
		return
	}

	var req ExecutionSchemeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		log.Printf("[UpdateExecutionScheme] Bind JSON failed: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	oldName := scheme.Name
	oldBranch := scheme.Branch
	oldCustomAttrs := scheme.CustomAttributes
	oldLanguages := scheme.Languages
	oldMRTrigger := scheme.MRTrigger
	oldMRBindingID := scheme.MRBindingID
	oldDailyBuild := scheme.DailyBuild
	oldDailyBuildTime := scheme.DailyBuildTime
	oldExecutionPlanID := scheme.ExecutionPlanID

	nameChanged := req.Name != "" && strings.TrimSpace(req.Name) != oldName
	languagesChanged := req.Languages != "" && req.Languages != oldLanguages

	updates := map[string]interface{}{
		"custom_attributes": req.CustomAttributes,
	}
	if req.Name != "" {
		newName := strings.TrimSpace(req.Name)
		updates["name"] = newName
		updates["execution_scheme_name"] = newName
	}
	if req.Branchs != "" {
		updates["branch"] = req.Branchs
	}
	if req.Languages != "" {
		updates["languages"] = req.Languages
	}
	if req.MRTrigger != nil {
		updates["mr_trigger"] = *req.MRTrigger
	}
	if req.DailyBuild != nil {
		updates["daily_build"] = *req.DailyBuild
	}
	if req.DailyBuildTime != "" {
		updates["daily_build_time"] = req.DailyBuildTime
	}

	if err := database.DB.Model(&scheme).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update execution scheme in local DB"})
		return
	}

	database.DB.Preload("Repository").Preload("PipelineInfo").First(&scheme, scheme.ID)

	repoURL := ""
	if scheme.Repository != nil {
		repoURL = scheme.Repository.HTTPURL
		if repoURL == "" {
			repoURL = scheme.Repository.URL
		}
	}
	if repoURL == "" {
		var repo models.Repository
		if err := database.DB.First(&repo, scheme.RepositoryID).Error; err == nil {
			repoURL = repo.HTTPURL
			if repoURL == "" {
				repoURL = repo.URL
			}
		}
	}
	if repoURL != "" {
		repoURL = utils.SSHToHTTPS(repoURL)
	}

	headers := prepareRequestHeaders(c)

	// 1. 若修改了方案名称、构建参数或编程语言，同步修改三方 ExecutionScheme
	customAttrsChanged := req.CustomAttributes != oldCustomAttrs
	if (nameChanged || customAttrsChanged || languagesChanged) && repoURL != "" {
		if err := services.SyncUpdateExecutionSchemeRemote(c.Request.Context(), &scheme, repoURL, headers); err != nil {
			log.Printf("[UpdateExecutionScheme] Warning: failed to sync remote ExecutionScheme for scheme %d: %v\n", scheme.ID, err)
		}
	}

	// 1.5 若修改了编程语言，同步修改三方代码检查任务 (CheckerTask)
	if languagesChanged && repoURL != "" {
		if err := services.SyncUpdateCheckerTaskRemote(c.Request.Context(), scheme.Name, repoURL, scheme.Branch, scheme.Languages, headers); err != nil {
			log.Printf("[UpdateExecutionScheme] Warning: failed to sync remote CheckerTask for scheme %d: %v\n", scheme.ID, err)
		}
	}

	// 2. MR 触发联动逻辑：
	// a. 如果从开启变为关闭：调用 SyncDeleteMRBindingRemote 解绑删除三方 MR 触发规则
	// b. 如果开启 MR 触发，且名称、分支变更、由关闭变为开启或尚未绑定：调用 SyncUpdateMRBindingRemote 同步或新建三方 MR 触发规则
	mrTriggerToggledOff := oldMRTrigger && !scheme.MRTrigger
	mrTriggerToggledOn := !oldMRTrigger && scheme.MRTrigger
	branchChanged := (req.Branchs != "" && req.Branchs != oldBranch) || scheme.Branch != oldBranch

	if mrTriggerToggledOff && oldMRBindingID != "" {
		schemeToDelete := scheme
		schemeToDelete.MRBindingID = oldMRBindingID
		if err := services.SyncDeleteMRBindingRemote(c.Request.Context(), &schemeToDelete, headers); err != nil {
			log.Printf("[UpdateExecutionScheme] Warning: failed to delete remote MR binding for scheme %d: %v\n", scheme.ID, err)
		} else {
			// 同步内存状态，避免接口响应中残留已删除的绑定 ID
			scheme.MRBindingID = ""
			scheme.MRBindingName = ""
		}
	} else if scheme.MRTrigger && (branchChanged || mrTriggerToggledOn || scheme.MRBindingID == "") && repoURL != "" {
		if err := services.SyncUpdateMRBindingRemote(c.Request.Context(), &scheme, repoURL, headers); err != nil {
			log.Printf("[UpdateExecutionScheme] Warning: failed to sync remote MR binding for scheme %d: %v\n", scheme.ID, err)
		}
	}

	// 3. 每日构建联动逻辑：
	// a. 如果从开启变为关闭：删除三方每日构建计划
	// b. 如果从关闭变为开启（或开启状态下无 planID）：创建三方每日构建计划
	// c. 如果在开启状态下修改了每日构建运行时间：删除旧计划并重新创建新计划
	dailyBuildToggledOff := oldDailyBuild && !scheme.DailyBuild
	dailyBuildToggledOn := !oldDailyBuild && scheme.DailyBuild
	dailyBuildTimeChanged := scheme.DailyBuild && req.DailyBuildTime != "" && req.DailyBuildTime != oldDailyBuildTime

	var pipelineBusinessID string
	if scheme.PipelineInfo != nil {
		pipelineBusinessID = scheme.PipelineInfo.PipelineID
	}

	if dailyBuildToggledOff && oldExecutionPlanID != "" {
		if err := services.SyncDeleteExecutionPlanRemote(oldExecutionPlanID, headers); err != nil {
			log.Printf("[UpdateExecutionScheme] Warning: failed to delete remote execution plan for scheme %d: %v\n", scheme.ID, err)
		} else {
			scheme.ExecutionPlanID = ""
			scheme.ExecutionPlanName = ""
			database.DB.Model(&scheme).Updates(map[string]interface{}{
				"execution_plan_id":   "",
				"execution_plan_name": "",
			})
		}
	} else if (dailyBuildToggledOn || (scheme.DailyBuild && scheme.ExecutionPlanID == "")) && pipelineBusinessID != "" {
		planID, err := services.CreateExecutionPlanStep(c.Request.Context(), pipelineBusinessID, &scheme, scheme.ExecutionSchemeID, headers)
		if err != nil {
			log.Printf("[UpdateExecutionScheme] Warning: failed to create remote execution plan for scheme %d: %v\n", scheme.ID, err)
		} else {
			scheme.ExecutionPlanID = planID
			scheme.ExecutionPlanName = scheme.Name
			database.DB.Model(&scheme).Updates(map[string]interface{}{
				"execution_plan_id":   planID,
				"execution_plan_name": scheme.Name,
			})
		}
	} else if dailyBuildTimeChanged && oldExecutionPlanID != "" && pipelineBusinessID != "" {
		if err := services.SyncDeleteExecutionPlanRemote(oldExecutionPlanID, headers); err != nil {
			// 删除旧计划失败时中止重建，保留旧 planID 不落库，避免三方残留孤儿计划，下次更新时再重试
			log.Printf("[UpdateExecutionScheme] Warning: failed to delete old remote execution plan for scheme %d: %v\n", scheme.ID, err)
		} else {
			planID, err := services.CreateExecutionPlanStep(c.Request.Context(), pipelineBusinessID, &scheme, scheme.ExecutionSchemeID, headers)
			if err != nil {
				log.Printf("[UpdateExecutionScheme] Warning: failed to recreate remote execution plan for scheme %d: %v\n", scheme.ID, err)
			} else {
				scheme.ExecutionPlanID = planID
				scheme.ExecutionPlanName = scheme.Name
				database.DB.Model(&scheme).Updates(map[string]interface{}{
					"execution_plan_id":   planID,
					"execution_plan_name": scheme.Name,
				})
			}
		}
	}

	taskTemplate := models.AppConfig.PipelineSystem.LinkCheckerTaskURL
	if taskTemplate != "" {
		scheme.CodeCheckerTaskWebURL = generateTaskWebURL(scheme.CodeCheckerTaskID, taskTemplate)
	}

	c.JSON(http.StatusOK, scheme)
}

// DeleteExecutionScheme 删除执行方案，并从三方流水线系统删除
func DeleteExecutionScheme(c *gin.Context) {
	id := c.Param("id")
	var scheme models.ExecutionScheme
	if err := database.DB.First(&scheme, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Execution scheme not found"})
		return
	}

	if scheme.ExecutionSchemeID != "" || scheme.MRBindingID != "" || scheme.ExecutionPlanID != "" {
		headers := prepareRequestHeaders(c)
		// 同步删除远程系统中的方案，三方失败则中断并保留本地记录
		if err := services.SyncDeleteExecutionSchemeRemote(scheme, headers); err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("在三方系统中下架方案失败: %v", err)})
			return
		}
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
