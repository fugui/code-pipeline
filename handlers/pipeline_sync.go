package handlers

import (
	"fmt"
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

	// 2. 调用 service 抓取执行方案列表
	fetchedPlans, err := services.FetchRemoteExecutionPlans(c.Request.Context(), pipeline.PipelineID, pipeline.ID, headers)
	if err != nil {
		if err.Error() == "get_execution_plan_url not configured" {
			// 未配置接口，返回 Mock 数据
			fetchedPlans = []models.ExecutionPlan{
				{
					ExecutionPlanID:  fmt.Sprintf("ext_plan_%d_1", pipeline.ID),
					PipelineID:       pipeline.ID,
					Repository:       "git@github.com:mock-org/service-a.git",
					Branch:          "master",
					Username:        "mock_user_a",
					Languages:       "Go,TypeScript",
					CustomAttributes: "{}",
				},
				{
					ExecutionPlanID:  fmt.Sprintf("ext_plan_%d_2", pipeline.ID),
					PipelineID:       pipeline.ID,
					Repository:       "git@github.com:mock-org/service-b.git",
					Branch:          "main",
					Username:        "mock_user_b",
					Languages:       "Python,Java",
					CustomAttributes: "{}",
				},
			}
		} else {
			c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
			return
		}
	}

	// 3. 事务更新本地数据库：先删后加
	tx := database.DB.Begin()
	if err := tx.Where("pipeline_id = ?", pipeline.ID).Delete(&models.ExecutionPlan{}).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to clear old execution plans"})
		return
	}

	for i := range fetchedPlans {
		if err := tx.Create(&fetchedPlans[i]).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save synced execution plans"})
			return
		}
	}

	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Transaction commit failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": fmt.Sprintf("Successfully synced %d execution plans", len(fetchedPlans))})
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
