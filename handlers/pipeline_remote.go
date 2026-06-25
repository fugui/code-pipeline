package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"code-pipeline/database"
	"code-pipeline/models"

	"github.com/gin-gonic/gin"
)

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

	prepareRemoteRequest(c, req)

	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[Pipeline] Error fetching remote pipeline info: %v\n", err)
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("Failed to fetch remote pipeline info: %v", err)})
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read response body"})
		return
	}

	// Pretty print remote JSON response to console
	var prettyJSON bytes.Buffer
	if err := json.Indent(&prettyJSON, body, "", "  "); err == nil {
		log.Printf("[Pipeline] FetchPipelineInfo remote response:\n%s\n", prettyJSON.String())
	} else {
		log.Printf("[Pipeline] FetchPipelineInfo remote response: %s\n", string(body))
	}

	if resp.StatusCode != http.StatusOK {
		logHTTPErrorDetails("FetchPipelineInfo", req, resp.StatusCode, body)
		c.JSON(resp.StatusCode, gin.H{"error": fmt.Sprintf("Remote server returned status %d. Please check if your SSO session has expired.", resp.StatusCode)})
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
		logHTTPErrorDetails("FetchPipelineInfo", req, resp.StatusCode, body)
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

// ---- HTTP 同步辅助函数 ----

// 同步创建远程方案
func syncCreateExecutionPlanRemote(pipelineBusinessID string, plan models.ExecutionPlan) (string, error) {
	apiURLStr := models.AppConfig.PipelineSystem.GetExecutionPlanURL
	if apiURLStr == "" {
		return "", fmt.Errorf("get_execution_plan_url not configured")
	}

	payload := map[string]interface{}{
		"pipeline_id":          pipelineBusinessID,
		"repository":           plan.Repository,
		"branch":               plan.Branch,
		"username":             plan.Username,
		"password":             plan.Password,
		"code_checker_task_id": plan.CodeCheckerTaskID,
		"languages":            strings.Split(plan.Languages, ","),
		"custom_attributes":    plan.CustomAttributes,
	}

	jsonBytes, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequest(http.MethodPost, apiURLStr, bytes.NewBuffer(jsonBytes))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		logHTTPErrorDetails("SyncCreatePlan", req, resp.StatusCode, body)
		return "", fmt.Errorf("remote API returned status code %d", resp.StatusCode)
	}

	var responseData map[string]interface{}
	if err := json.Unmarshal(body, &responseData); err != nil {
		logHTTPErrorDetails("SyncCreatePlan", req, resp.StatusCode, body)
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
	apiURLStr := models.AppConfig.PipelineSystem.GetExecutionPlanURL
	if apiURLStr == "" {
		return fmt.Errorf("get_execution_plan_url not configured")
	}

	// 拼接具体的 PUT 路由：{url}/{execution_plan_id}
	targetURL := fmt.Sprintf("%s/%s", strings.TrimSuffix(apiURLStr, "/"), plan.ExecutionPlanID)

	payload := map[string]interface{}{
		"pipeline_id":          pipelineBusinessID,
		"repository":           plan.Repository,
		"branch":               plan.Branch,
		"username":             plan.Username,
		"password":             plan.Password,
		"code_checker_task_id": plan.CodeCheckerTaskID,
		"languages":            strings.Split(plan.Languages, ","),
		"custom_attributes":    plan.CustomAttributes,
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

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		logHTTPErrorDetails("SyncUpdatePlan", req, resp.StatusCode, body)
		return fmt.Errorf("remote API returned status code %d", resp.StatusCode)
	}

	return nil
}

// 同步删除远程方案
func syncDeleteExecutionPlanRemote(executionPlanID string) error {
	apiURLStr := models.AppConfig.PipelineSystem.GetExecutionPlanURL
	if apiURLStr == "" {
		return fmt.Errorf("get_execution_plan_url not configured")
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

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusAccepted {
		logHTTPErrorDetails("SyncDeletePlan", req, resp.StatusCode, body)
		return fmt.Errorf("remote API returned status code %d", resp.StatusCode)
	}

	return nil
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

	apiURLStr := models.AppConfig.PipelineSystem.GetExecutionPlanURL
	var fetchedPlans []models.ExecutionPlan

	if apiURLStr == "" {
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
		// 调用三方系统抓取执行方案
		u, err := url.Parse(apiURLStr)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Invalid configured get_execution_plan_url"})
			return
		}

		q := u.Query()
		q.Set("pipelineId", pipeline.PipelineID)
		u.RawQuery = q.Encode()

		req, err := http.NewRequestWithContext(c.Request.Context(), "GET", u.String(), nil)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create HTTP request"})
			return
		}

		prepareRemoteRequest(c, req)

		client := &http.Client{Timeout: 3 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			log.Printf("[Pipeline] Error fetching remote execution plans: %v\n", err)
			c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("Failed to fetch remote execution plans: %v", err)})
			return
		}
		defer resp.Body.Close()

		body, err := io.ReadAll(resp.Body)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read response body"})
			return
		}

		// Pretty print remote JSON response to console
		var prettyJSON bytes.Buffer
		if err := json.Indent(&prettyJSON, body, "", "  "); err == nil {
			log.Printf("[Pipeline] SyncExecutionPlans remote response:\n%s\n", prettyJSON.String())
		} else {
			log.Printf("[Pipeline] SyncExecutionPlans remote response: %s\n", string(body))
		}

		if resp.StatusCode != http.StatusOK {
			logHTTPErrorDetails("SyncExecutionPlans", req, resp.StatusCode, body)
			c.JSON(resp.StatusCode, gin.H{"error": fmt.Sprintf("Remote server returned status %d. Please check if your SSO session has expired.", resp.StatusCode)})
			return
		}

		var remoteResp struct {
			Entities []struct {
				ID              string `json:"id"`
				Name            string `json:"name"`
				CustomParameter string `json:"customParameter"`
			} `json:"entities"`
		}

		if err := json.Unmarshal(body, &remoteResp); err != nil {
			log.Printf("[Pipeline] Failed to parse remote plans JSON: %v\n", err)
			logHTTPErrorDetails("SyncExecutionPlans", req, resp.StatusCode, body)
			c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("Failed to parse remote response JSON: %v", err)})
			return
		}

		for _, entity := range remoteResp.Entities {
			plan := models.ExecutionPlan{
				ExecutionPlanID:  entity.ID,
				PipelineID:       pipeline.ID,
				Branch:           "master",
				CustomAttributes: entity.CustomParameter,
			}

			if entity.CustomParameter != "" {
				var cp struct {
					BuildParameters []struct {
						Name  string `json:"name"`
						Value string `json:"value"`
					} `json:"buildParameters"`
				}
				if err := json.Unmarshal([]byte(entity.CustomParameter), &cp); err == nil {
					for _, param := range cp.BuildParameters {
						switch param.Name {
						case "cmc_username":
							plan.Username = param.Value
						case "cmc_password":
							plan.Password = param.Value
						case "code_branch":
							plan.Branch = param.Value
						case "code_url":
							plan.Repository = param.Value
						case "code_checker_task_id":
							plan.CodeCheckerTaskID = param.Value
						}
					}
				} else {
					log.Printf("[Pipeline] Warning: failed to parse customParameter JSON for entity %s: %v\n", entity.ID, err)
				}
			}

			if plan.Repository == "" {
				log.Printf("[Pipeline] Warning: skipped entity %s because repository (code_url) is empty\n", entity.ID)
				continue
			}

			fetchedPlans = append(fetchedPlans, plan)
		}
	}

	// 事务更新本地数据库：先删后加
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

// logHTTPErrorDetails 打印详细的 HTTP 错误日志，包括等价的 curl 调试命令及三方返回的原始报文
func logHTTPErrorDetails(contextMsg string, req *http.Request, statusCode int, respBody []byte) {
	var curlHeaders []string
	for name, values := range req.Header {
		for _, value := range values {
			escapedValue := strings.ReplaceAll(value, "'", "'\\''")
			curlHeaders = append(curlHeaders, fmt.Sprintf("-H '%s: %s'", name, escapedValue))
		}
	}
	curlCmd := fmt.Sprintf("curl -X %s '%s' %s", req.Method, req.URL.String(), strings.Join(curlHeaders, " "))

	log.Printf("[%s] Curl Command:\n%s\n", contextMsg, curlCmd)
	log.Printf("[%s] Remote server returned status %d. Response Body: %s\n", contextMsg, statusCode, string(respBody))
}

// prepareRemoteRequest 透传 Cookie, cftk 和 x-requested-with Header 到发往外部系统的 Request
func prepareRemoteRequest(c *gin.Context, req *http.Request) {
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
}
