package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"code-pipeline/database"
	"code-pipeline/models"

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
	PipelineID       uint   `json:"pipeline_id" binding:"required"`
	Repository       string `json:"repository" binding:"required"`
	Branch           string `json:"branch" binding:"required"`
	Username         string `json:"username"`
	Password         string `json:"password"`
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
			go syncDeleteExecutionPlanRemote(plan.ExecutionPlanID)
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

// FetchPipelineInfoFromRemote 根据 pipeline_id 调用配置接口获取三方流水线系统中的名称等信息
func FetchPipelineInfoFromRemote(c *gin.Context) {
	pipelineID := c.Query("pipeline_id")
	if pipelineID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "pipeline_id is required"})
		return
	}

	apiURLStr := models.AppConfig.PipelineSystem.GetPipelineURL
	if apiURLStr == "" {
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

	u, err := url.Parse(apiURLStr)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Invalid configured get_pipeline_url"})
		return
	}

	q := u.Query()
	q.Set("pipelineId", pipelineID)
	u.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(c.Request.Context(), "GET", u.String(), nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create HTTP request"})
		return
	}

	// 透传前端传递的 Cookie 和 cftk 头
	if cookie := c.GetHeader("Cookie"); cookie != "" {
		req.Header.Set("Cookie", cookie)
	}
	cftk := c.GetHeader("cftk")
	if cftk == "" {
		cftk, _ = c.Cookie("prod_cftk")
	}
	if cftk != "" {
		req.Header.Set("cftk", cftk)
	}
	req.Header.Set("x-requested-with", "XMLHttpRequest")

	log.Printf("[Pipeline] Sending request to remote URL: %s, Headers: %+v\n", req.URL.String(), req.Header)
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[Pipeline] Error fetching remote pipeline info: %v\n", err)
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("Failed to fetch remote pipeline info: %v", err)})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("[Pipeline] Remote server returned non-200 status: %d\n", resp.StatusCode)
		c.JSON(resp.StatusCode, gin.H{"error": fmt.Sprintf("Remote server returned status %d. Please check if your SSO session has expired.", resp.StatusCode)})
		return
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read response body"})
		return
	}

	// 针对新嵌套响应结构的反序列化定义
	type RemoteResponse struct {
		Entity struct {
			Result struct {
				ID           string `json:"id"`
				ServiceID    string `json:"serviceId"`
				WorkspaceID  string `json:"workspaceId"`
				Owner        string `json:"owner"`
				ServiceName  string `json:"serviceName"`
				PipelineName string `json:"pipelineName"`
			} `json:"result"`
		} `json:"entity"`
	}

	var remoteResp RemoteResponse
	if err := json.Unmarshal(body, &remoteResp); err != nil {
		log.Printf("[Pipeline] Failed to parse remote data JSON: %v\n", err)
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("Failed to parse remote response JSON: %v", err)})
		return
	}

	res := remoteResp.Entity.Result
	name := res.PipelineName
	if name == "" {
		name = fmt.Sprintf("Pipeline_%s", pipelineID)
	}

	c.JSON(http.StatusOK, gin.H{
		"pipeline_id":  res.ID,
		"name":         name,
		"type":         "每日构建", // 默认触发类型
		"group_name":   "DefaultGroup",
		"description":  fmt.Sprintf("三方服务 %s (%s) 自动同步录入", res.ServiceName, res.ServiceID),
		"service_id":   res.ServiceID,
		"workspace_id": res.WorkspaceID,
		"owner":        res.Owner,
		"service_name": res.ServiceName,
		"is_mock":      false,
	})
}

// GetExecutionPlans 获取指定流水线的执行方案
func GetExecutionPlans(c *gin.Context) {
	pipelineIDStr := c.Query("pipeline_id")
	if pipelineIDStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "pipeline_id query parameter is required"})
		return
	}

	pipelineID, err := strconv.ParseUint(pipelineIDStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid pipeline_id"})
		return
	}

	var plans []models.ExecutionPlan
	if err := database.DB.Where("pipeline_id = ?", uint(pipelineID)).Find(&plans).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch execution plans"})
		return
	}

	c.JSON(http.StatusOK, plans)
}

// CreateExecutionPlan 创建执行方案，并同步到三方流水线系统
func CreateExecutionPlan(c *gin.Context) {
	var req ExecutionPlanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 检查 Pipeline 是否存在
	var pipeline models.Pipeline
	if err := database.DB.First(&pipeline, req.PipelineID).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Associated pipeline not found"})
		return
	}

	plan := models.ExecutionPlan{
		PipelineID:       req.PipelineID,
		Repository:       req.Repository,
		Branch:           req.Branch,
		Username:         req.Username,
		Password:         req.Password,
		Languages:        req.Languages,
		CustomAttributes: req.CustomAttributes,
	}

	// 同步去三方流水线系统创建
	extID, err := syncCreateExecutionPlanRemote(pipeline.PipelineID, plan)
	if err != nil {
		log.Printf("[Pipeline] Remote sync failed for CreateExecutionPlan (using Mock ID): %v\n", err)
		extID = fmt.Sprintf("ext_plan_%d", time.Now().UnixNano())
	}
	plan.ExecutionPlanID = extID

	if err := database.DB.Create(&plan).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create execution plan in local DB"})
		return
	}

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

	var pipeline models.Pipeline
	if err := database.DB.First(&pipeline, req.PipelineID).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Associated pipeline not found"})
		return
	}

	plan.Repository = req.Repository
	plan.Branch = req.Branch
	plan.Username = req.Username
	plan.Password = req.Password
	plan.Languages = req.Languages
	plan.CustomAttributes = req.CustomAttributes

	// 如果原来没有 ext ID，则生成一个
	if plan.ExecutionPlanID == "" {
		plan.ExecutionPlanID = fmt.Sprintf("ext_plan_%d", time.Now().UnixNano())
	}

	// 同步修改至三方系统
	if err := syncUpdateExecutionPlanRemote(pipeline.PipelineID, plan); err != nil {
		log.Printf("[Pipeline] Remote sync failed for UpdateExecutionPlan: %v\n", err)
	}

	if err := database.DB.Save(&plan).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update execution plan locally"})
		return
	}

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
		go syncDeleteExecutionPlanRemote(plan.ExecutionPlanID)
	}

	if err := database.DB.Delete(&plan).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete execution plan locally"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Execution plan deleted successfully"})
}

// ---- HTTP 同步辅助函数 ----

// 同步创建远程方案
func syncCreateExecutionPlanRemote(pipelineBusinessID string, plan models.ExecutionPlan) (string, error) {
	apiURLStr := models.AppConfig.PipelineSystem.SyncExecutionPlanURL
	if apiURLStr == "" {
		return "", fmt.Errorf("sync_execution_plan_url not configured")
	}

	payload := map[string]interface{}{
		"pipeline_id":       pipelineBusinessID,
		"repository":        plan.Repository,
		"branch":            plan.Branch,
		"username":          plan.Username,
		"password":          plan.Password,
		"languages":         strings.Split(plan.Languages, ","),
		"custom_attributes": plan.CustomAttributes,
	}

	jsonBytes, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}

	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Post(apiURLStr, "application/json", bytes.NewBuffer(jsonBytes))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return "", fmt.Errorf("remote API returned status code %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	var responseData map[string]interface{}
	if err := json.Unmarshal(body, &responseData); err != nil {
		return "", err
	}

	// 约定返回的 JSON 中，外部系统的方案 ID 属性为 "id" 或 "execution_plan_id"
	extID, ok := responseData["id"].(string)
	if !ok || extID == "" {
		if val, exist := responseData["execution_plan_id"].(string); exist && val != "" {
			extID = val
		} else {
			extID = fmt.Sprintf("ext_plan_%d", time.Now().UnixNano())
		}
	}

	return extID, nil
}

// 同步修改远程方案
func syncUpdateExecutionPlanRemote(pipelineBusinessID string, plan models.ExecutionPlan) error {
	apiURLStr := models.AppConfig.PipelineSystem.SyncExecutionPlanURL
	if apiURLStr == "" {
		return fmt.Errorf("sync_execution_plan_url not configured")
	}

	// 拼接具体的 PUT 路由：{url}/{execution_plan_id}
	targetURL := fmt.Sprintf("%s/%s", strings.TrimSuffix(apiURLStr, "/"), plan.ExecutionPlanID)

	payload := map[string]interface{}{
		"pipeline_id":       pipelineBusinessID,
		"repository":        plan.Repository,
		"branch":            plan.Branch,
		"username":          plan.Username,
		"password":          plan.Password,
		"languages":         strings.Split(plan.Languages, ","),
		"custom_attributes": plan.CustomAttributes,
	}

	jsonBytes, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequest(http.MethodPut, targetURL, bytes.NewBuffer(jsonBytes))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		return fmt.Errorf("remote API returned status code %d", resp.StatusCode)
	}

	return nil
}

// 同步删除远程方案
func syncDeleteExecutionPlanRemote(executionPlanID string) error {
	apiURLStr := models.AppConfig.PipelineSystem.SyncExecutionPlanURL
	if apiURLStr == "" {
		return fmt.Errorf("sync_execution_plan_url not configured")
	}

	targetURL := fmt.Sprintf("%s/%s", strings.TrimSuffix(apiURLStr, "/"), executionPlanID)

	req, err := http.NewRequest(http.MethodDelete, targetURL, nil)
	if err != nil {
		return err
	}

	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusAccepted {
		return fmt.Errorf("remote API returned status code %d", resp.StatusCode)
	}

	return nil
}
