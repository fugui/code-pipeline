package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"code-pipeline/database"
	"code-pipeline/models"
	"code-pipeline/services"

	"github.com/gin-gonic/gin"
)

// FetchPipelineInfoFromRemote 根据 pipeline_id 调用配置接口获取三方流水线系统中的名称等信息
func FetchPipelineInfoFromRemote(c *gin.Context) {
	pipelineID := c.Query("pipeline_id")
	if pipelineID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "pipeline_id is required"})
		return
	}

	// 1. 获取要透传的 HTTP Headers
	headers := prepareRequestHeaders(c)

	// 2. 调用 service 获取数据
	pipelineInfo, err := services.FetchRemotePipelineInfo(c.Request.Context(), pipelineID, headers)
	if err != nil {
		if err.Error() == "get_pipeline_url not configured" {
			// 未配置接口，返回 Mock 数据
			c.JSON(http.StatusOK, gin.H{
				"pipeline_id":  pipelineID,
				"name":         fmt.Sprintf("Mock流水线_%s", pipelineID),
				"type":         "每日构建",
				"group_name":   "DefaultGroup",
				"description":  "此配置由本地 Mock 数据自动回填，未配置 pipeline_system.get_pipeline_url",
				"service_id":   "mock_svc_1001",
				"workspace_id": "mock_ws_2002",
				"owner":        "MockOwner",
				"service_name": "MockService",
				"is_mock":      true,
			})
			return
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"pipeline_id":  pipelineInfo.PipelineID,
		"name":         pipelineInfo.Name,
		"type":         pipelineInfo.Type,
		"group_name":   pipelineInfo.GroupName,
		"description":  pipelineInfo.Description,
		"service_id":   pipelineInfo.ServiceID,
		"workspace_id": pipelineInfo.WorkspaceID,
		"owner":        pipelineInfo.Owner,
		"service_name": pipelineInfo.ServiceName,
		"is_mock":      false,
	})
}

// SyncExecutionPlans 从三方系统同步指定流水线的执行方案，并保存至本地数据库
func SyncExecutionPlans(c *gin.Context) {
	pipelineIDStr := c.Query("pipeline_id")
	if pipelineIDStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "pipeline_id is required"})
		return
	}

	var pipeline models.Pipeline
	if err := database.DB.Where("pipeline_id = ?", pipelineIDStr).First(&pipeline).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Pipeline not found"})
		return
	}

	// 1. 获取要透传的 HTTP Headers
	headers := prepareRequestHeaders(c)

	// 2.1 先获取 MR 绑定的列表
	//  根据配置的 MR绑定列表API， 使用查询参数 pipelineId 查询获得全部的MR绑定列表
	//  返回的对象格式为： { "status":"success",  "result": [ {
	//  "id", "codeUrl", "branches" (使用逗号分开),  schemeId, schemeName
	//  } ]}
	mrBindings, err := services.FetchRemoteMRBindings(c.Request.Context(), pipeline.PipelineID, headers)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("Failed to fetch MR bindings: %v", err)})
	}
	log.Printf("[SyncExecutionPlans] Fetched %d MR bindings from remote\n", len(mrBindings))

	// 2.2 调用 service 抓取执行方案列表
	schemes, err := services.FetchRemoteExecutionPlans(c.Request.Context(), pipeline.PipelineID, headers)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	// 3.1 事务更新本地数据库：先删后加
	// 3.2 根据获取的 MR 数据和 执行计划数据， 更新本地数据
	// 以 MR 数据为准， 根据 MR 数据中的 SchemeID 匹配 fetchedPlans 中的 ExecutionPlanID， 进行信息合并（把MR中的 CodeURL 和 Branches 覆盖 fetchedPlans 中的信息）
	// 最终生成完整的 执行计划：
	var allRepos []models.Repository
	repoMap := make(map[string]models.Repository)
	if err := database.DB.Find(&allRepos).Error; err == nil {
		for _, r := range allRepos {
			normalizedURL := services.NormalizeGitURL(r.URL)
			if normalizedURL != "" {
				repoMap[normalizedURL] = r
			}
		}
	} else {
		log.Printf("[SyncExecutionPlans] Error pre-loading repositories from DB: %v\n", err)
	}

	var finalPlans []models.ExecutionPlan
	for _, binding := range mrBindings {
		var matchedScheme *models.RemoteExecutionScheme
		for i := range schemes {
			if schemes[i].ID == binding.SchemeID {
				matchedScheme = &schemes[i]
				break
			}
		}

		if matchedScheme == nil {
			log.Printf("[SyncExecutionPlans] Warning: MR binding SchemeID %s not found in remote execution schemes\n", binding.SchemeID)
			continue
		}

		// 根据 Scheme 的原始数据组装 ExecutionPlan 实例
		plan := models.ExecutionPlan{
			ExecutionPlanID:  matchedScheme.ID,
			PipelineID:       pipeline.ID,
			Branch:           binding.Branches, // 用 MR 数据的分支信息覆盖
			CustomAttributes: matchedScheme.CustomParameter,
		}

		// 从 Scheme 中解析 Username, Password 和 CodeCheckerTaskID 等基础属性
		if matchedScheme.CustomParameter != "" {
			var cp struct {
				BuildParameters []struct {
					Name  string `json:"name"`
					Value string `json:"value"`
				} `json:"buildParameters"`
			}
			if err := json.Unmarshal([]byte(matchedScheme.CustomParameter), &cp); err == nil {
				for _, param := range cp.BuildParameters {
					switch param.Name {
					case "cmc_username":
						plan.Username = param.Value
					case "cmc_password":
						plan.Password = param.Value
					case "code_checker_task_id":
						plan.CodeCheckerTaskID = param.Value
					}
				}
			} else {
				log.Printf("[SyncExecutionPlans] Warning: failed to parse customParameter JSON for scheme %s: %v\n", matchedScheme.ID, err)
			}
		}

		// 合并代码仓数据，并利用规格化逻辑在本地仓库中重新匹配（用 MR 数据的 CodeURL 覆盖）
		normalizedCodeURL := services.NormalizeGitURL(binding.CodeURL)
		if r, found := repoMap[normalizedCodeURL]; found {
			plan.RepositoryID = r.ID
			plan.Repository = r
		} else {
			log.Printf("[SyncExecutionPlans] Warning: MR binding CodeURL %s (normalized: %s) not found in local mirrors\n", binding.CodeURL, normalizedCodeURL)
			plan.RepositoryID = 0
		}

		// 如果 RepositoryID 是 0（没有在本地同步此镜像），则跳过该执行方案以保证运行安全性
		if plan.RepositoryID == 0 {
			log.Printf("[SyncExecutionPlans] Warning: skipped execution plan %s because repository ID is 0\n", plan.ExecutionPlanID)
			continue
		}

		finalPlans = append(finalPlans, plan)
	}

	tx := database.DB.Begin()
	if err := tx.Where("pipeline_id = ?", pipeline.ID).Delete(&models.ExecutionPlan{}).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to clear old execution plans"})
		return
	}

	for i := range finalPlans {
		if err := tx.Omit("Repository").Create(&finalPlans[i]).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save synced execution plans"})
			return
		}
	}

	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Transaction commit failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": fmt.Sprintf("Successfully synced %d execution plans", len(finalPlans))})
}

// prepareRequestHeaders 透传 Cookie, cftk 和 x-requested-with Header
func prepareRequestHeaders(c *gin.Context) map[string]string {
	headers := make(map[string]string)
	if cookie := c.GetHeader("Cookie"); cookie != "" {
		headers["Cookie"] = cookie
	}
	cftk := c.GetHeader("cftk")
	if cftk == "" {
		cftk, _ = c.Cookie("prod_cftk")
	}
	if cftk != "" {
		headers["cftk"] = cftk
	}
	headers["x-requested-with"] = "XMLHttpRequest"
	return headers
}

// UpdateCheckerTask 为执行方案创建并更新三方代码检查任务
func UpdateCheckerTask(c *gin.Context) {
	var req ExecutionPlanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var repo models.Repository
	if err := database.DB.First(&repo, req.RepositoryID).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Associated repository not found"})
		return
	}

	headers := prepareRequestHeaders(c)

	taskID, updatedAttrs, err := services.UpdateCheckerTaskRemote(c.Request.Context(), repo.URL, req.Branch, req.Languages, req.CustomAttributes, headers)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to update checker task: %v", err)})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code_checker_task_id": taskID,
		"custom_attributes":    updatedAttrs,
	})
}
