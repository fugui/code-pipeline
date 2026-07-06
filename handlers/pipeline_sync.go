package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"code-pipeline/database"
	"code-pipeline/models"
	"code-pipeline/services"
	"code-pipeline/utils"

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
		if HandleSSOExpired(c, err) {
			return
		}
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
		"owner_id":     pipelineInfo.OwnerID,
		"service_name": pipelineInfo.ServiceName,
		"is_mock":      false,
	})
}

// SyncExecutionSchemes 从三方系统同步指定流水线的执行方案，并保存至本地数据库
func SyncExecutionSchemes(c *gin.Context) {
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
	mrBindings, err := services.FetchRemoteMRBindings(c.Request.Context(), pipeline.PipelineID, headers)
	if err != nil {
		if HandleSSOExpired(c, err) {
			return
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("Failed to fetch MR bindings: %v", err)})
		return
	}
	log.Printf("[SyncExecutionSchemes] Fetched %d MR bindings from remote\n", len(mrBindings))

	// 2.2 调用 service 抓取执行方案列表
	schemes, err := services.FetchRemoteExecutionSchemes(c.Request.Context(), pipeline.PipelineID, headers)
	if err != nil {
		if HandleSSOExpired(c, err) {
			return
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	// 2.3 调用 service 抓取执行计划列表
	plans, err := services.FetchRemoteExecutionPlans(c.Request.Context(), pipeline.PipelineID, headers)
	if err != nil {
		if HandleSSOExpired(c, err) {
			return
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("Failed to fetch execution plans: %v", err)})
		return
	}
	log.Printf("[SyncExecutionSchemes] Fetched %d execution plans from remote\n", len(plans))

	// 3.1 根据获取的方案数据、MR 绑定数据、执行计划数据，更新本地数据
	var allRepos []models.Repository
	repoMap := make(map[string]models.Repository)
	if err := database.DB.Find(&allRepos).Error; err == nil {
		for _, r := range allRepos {
			normalizedURL := utils.NormalizeGitURL(r.URL)
			if normalizedURL != "" {
				repoMap[normalizedURL] = r
			}
		}
	} else {
		log.Printf("[SyncExecutionSchemes] Error pre-loading repositories from DB: %v\n", err)
	}

	var finalSchemes []models.ExecutionScheme
	for _, remoteScheme := range schemes {
		// 根据 Scheme 的原始数据组装 ExecutionScheme 实例
		scheme := models.ExecutionScheme{
			ExecutionSchemeID: remoteScheme.ID,
			Name:              remoteScheme.Name,
			LocalPipelineID:   pipeline.ID,
			CustomAttributes:  remoteScheme.CustomParameter,
			MRTrigger:         false,
			DailyBuild:        false,
		}

		var codeURL string
		var branch string

		// 从 Scheme 的 CustomParameter 中解析 Username, Password, CodeCheckerTaskID 极其代码仓与分支属性
		if remoteScheme.CustomParameter != "" {
			var cp struct {
				BuildParameters []struct {
					Name  string `json:"name"`
					Value string `json:"value"`
				} `json:"buildParameters"`
			}
			if err := json.Unmarshal([]byte(remoteScheme.CustomParameter), &cp); err == nil {
				for _, param := range cp.BuildParameters {
					switch param.Name {
					case "cmc_username":
						scheme.Username = param.Value
					case "cmc_password":
						scheme.Password = param.Value
					case "code_checker_task_id":
						scheme.CodeCheckerTaskID = param.Value
					case "repository":
						codeURL = param.Value
					case "branch":
						branch = param.Value
					}
				}
			} else {
				log.Printf("[SyncExecutionSchemes] Warning: failed to parse customParameter JSON for scheme %s: %v\n", remoteScheme.ID, err)
			}
		}

		// 匹配 MR 绑定
		var matchedMRBinding *models.MRBinding
		for i := range mrBindings {
			if mrBindings[i].SchemeID == remoteScheme.ID {
				matchedMRBinding = &mrBindings[i]
				break
			}
		}

		if matchedMRBinding != nil {
			scheme.MRBindingID = matchedMRBinding.ID
			scheme.MRTrigger = true
			if matchedMRBinding.Branches != "" {
				branch = matchedMRBinding.Branches
			}
			if matchedMRBinding.CodeURL != "" {
				codeURL = matchedMRBinding.CodeURL
			}
		}

		// 匹配执行计划
		var matchedPlan *models.RemoteExecutionPlan
		for i := range plans {
			if plans[i].PfkSchemeID == remoteScheme.ID {
				matchedPlan = &plans[i]
				break
			}
		}

		if matchedPlan != nil {
			scheme.ExecutionPlanID = matchedPlan.ID
			scheme.DailyBuild = true
		}

		scheme.Branch = branch

		// 合并代码仓数据，并利用规格化逻辑在本地仓库中匹配关联
		if codeURL != "" {
			normalizedCodeURL := utils.NormalizeGitURL(codeURL)
			if r, found := repoMap[normalizedCodeURL]; found {
				scheme.RepositoryID = r.ID
				scheme.Repository = &r
			} else {
				log.Printf("[SyncExecutionSchemes] Warning: CodeURL %s (normalized: %s) not found in local mirrors\n", codeURL, normalizedCodeURL)
			}
		}

		// 如果 RepositoryID 是 0（没有在本地同步此镜像），则跳过该执行方案以保证运行安全性
		if scheme.RepositoryID == 0 {
			log.Printf("[SyncExecutionSchemes] Warning: skipped execution scheme %s because repository ID is 0\n", scheme.ExecutionSchemeID)
			continue
		}

		finalSchemes = append(finalSchemes, scheme)
	}

	tx := database.DB.Begin()
	if err := tx.Where("pipeline_id = ?", pipeline.ID).Delete(&models.ExecutionScheme{}).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to clear old execution schemes"})
		return
	}

	for i := range finalSchemes {
		if err := tx.Omit("Repository", "PipelineInfo").Create(&finalSchemes[i]).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save synced execution schemes"})
			return
		}
	}

	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Transaction commit failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": fmt.Sprintf("Successfully synced %d execution schemes", len(finalSchemes))})
}
