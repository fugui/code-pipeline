package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"code-pipeline/models"
)

// FetchRemotePipelineInfo 调用远程接口获取三方流水线元数据
func FetchRemotePipelineInfo(ctx context.Context, pipelineID string, headers map[string]string) (*models.Pipeline, error) {
	apiURLStr := models.AppConfig.PipelineSystem.GetPipelineURL
	if apiURLStr == "" {
		return nil, fmt.Errorf("get_pipeline_url not configured")
	}

	u, err := url.Parse(apiURLStr)
	if err != nil {
		return nil, fmt.Errorf("invalid configured get_pipeline_url: %v", err)
	}

	q := u.Query()
	q.Set("pipelineId", pipelineID)
	u.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, "GET", u.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create HTTP request: %v", err)
	}

	for k, v := range headers {
		req.Header.Set(k, v)
	}

	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to execute remote request: %v", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %v", err)
	}

	// Pretty print remote JSON response to console
	var prettyJSON bytes.Buffer
	if err := json.Indent(&prettyJSON, body, "", "  "); err == nil {
		log.Printf("[PipelineClient] FetchPipelineInfo remote response:\n%s\n", prettyJSON.String())
	} else {
		log.Printf("[PipelineClient] FetchPipelineInfo remote response: %s\n", string(body))
	}

	if resp.StatusCode != http.StatusOK {
		LogHTTPErrorDetails("FetchPipelineInfo", req, resp.StatusCode, body)
		return nil, fmt.Errorf("remote server returned status %d", resp.StatusCode)
	}

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
		LogHTTPErrorDetails("FetchPipelineInfo", req, resp.StatusCode, body)
		return nil, fmt.Errorf("failed to parse remote response JSON: %v", err)
	}

	res := remoteResp.Entity.Result
	name := res.PipelineName
	if name == "" {
		name = fmt.Sprintf("Pipeline_%s", pipelineID)
	}

	return &models.Pipeline{
		PipelineID:  res.ID,
		Name:         name,
		Type:         "每日构建",
		GroupName:   "DefaultGroup",
		Description:  fmt.Sprintf("三方服务 %s (%s) 自动同步录入", res.ServiceName, res.ServiceID),
		ServiceID:   res.ServiceID,
		WorkspaceID: res.WorkspaceID,
		Owner:        res.Owner,
		ServiceName: res.ServiceName,
	}, nil
}

// FetchRemoteExecutionPlans 从三方系统获取指定流水线的执行方案列表
func FetchRemoteExecutionPlans(ctx context.Context, pipelineBusinessID string, pipelineID uint, headers map[string]string) ([]models.ExecutionPlan, error) {
	apiURLStr := models.AppConfig.PipelineSystem.GetExecutionPlanURL
	if apiURLStr == "" {
		return nil, fmt.Errorf("get_execution_plan_url not configured")
	}

	u, err := url.Parse(apiURLStr)
	if err != nil {
		return nil, fmt.Errorf("invalid configured get_execution_plan_url: %v", err)
	}

	q := u.Query()
	q.Set("pipelineId", pipelineBusinessID)
	u.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, "GET", u.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create HTTP request: %v", err)
	}

	for k, v := range headers {
		req.Header.Set(k, v)
	}

	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch remote execution plans: %v", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %v", err)
	}

	var prettyJSON bytes.Buffer
	if err := json.Indent(&prettyJSON, body, "", "  "); err == nil {
		log.Printf("[PipelineClient] SyncExecutionPlans remote response:\n%s\n", prettyJSON.String())
	} else {
		log.Printf("[PipelineClient] SyncExecutionPlans remote response: %s\n", string(body))
	}

	if resp.StatusCode != http.StatusOK {
		LogHTTPErrorDetails("SyncExecutionPlans", req, resp.StatusCode, body)
		return nil, fmt.Errorf("remote server returned status %d", resp.StatusCode)
	}

	var remoteResp struct {
		Entities []struct {
			ID              string `json:"id"`
			Name            string `json:"name"`
			CustomParameter string `json:"customParameter"`
		} `json:"entities"`
	}

	if err := json.Unmarshal(body, &remoteResp); err != nil {
		LogHTTPErrorDetails("SyncExecutionPlans", req, resp.StatusCode, body)
		return nil, fmt.Errorf("failed to parse remote response JSON: %v", err)
	}

	var fetchedPlans []models.ExecutionPlan
	for _, entity := range remoteResp.Entities {
		plan := models.ExecutionPlan{
			ExecutionPlanID:  entity.ID,
			PipelineID:       pipelineID,
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
				log.Printf("[PipelineClient] Warning: failed to parse customParameter JSON for entity %s: %v\n", entity.ID, err)
			}
		}

		if plan.Repository == "" {
			log.Printf("[PipelineClient] Warning: skipped entity %s because repository (code_url) is empty\n", entity.ID)
			continue
		}

		fetchedPlans = append(fetchedPlans, plan)
	}

	return fetchedPlans, nil
}

// SyncCreateExecutionPlanRemote 在三方系统中同步创建执行方案
func SyncCreateExecutionPlanRemote(pipelineBusinessID string, plan models.ExecutionPlan) (string, error) {
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
		LogHTTPErrorDetails("SyncCreatePlan", req, resp.StatusCode, body)
		return "", fmt.Errorf("remote API returned status code %d", resp.StatusCode)
	}

	var responseData map[string]interface{}
	if err := json.Unmarshal(body, &responseData); err != nil {
		LogHTTPErrorDetails("SyncCreatePlan", req, resp.StatusCode, body)
		return "", err
	}

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

// SyncUpdateExecutionPlanRemote 在三方系统中同步修改执行方案
func SyncUpdateExecutionPlanRemote(pipelineBusinessID string, plan models.ExecutionPlan) error {
	apiURLStr := models.AppConfig.PipelineSystem.GetExecutionPlanURL
	if apiURLStr == "" {
		return fmt.Errorf("get_execution_plan_url not configured")
	}

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
		LogHTTPErrorDetails("SyncUpdatePlan", req, resp.StatusCode, body)
		return fmt.Errorf("remote API returned status code %d", resp.StatusCode)
	}

	return nil
}

// SyncDeleteExecutionPlanRemote 在三方系统中删除执行方案
func SyncDeleteExecutionPlanRemote(executionPlanID string) error {
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
		LogHTTPErrorDetails("SyncDeletePlan", req, resp.StatusCode, body)
		return fmt.Errorf("remote API returned status code %d", resp.StatusCode)
	}

	return nil
}

// LogHTTPErrorDetails 打印详细的 HTTP 错误日志，包括等价的 curl 调试命令及三方返回的原始报文
func LogHTTPErrorDetails(contextMsg string, req *http.Request, statusCode int, respBody []byte) {
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
