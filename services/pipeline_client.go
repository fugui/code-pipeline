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
	"strconv"
	"strings"
	"time"

	"code-pipeline/database"
	"code-pipeline/models"
)

// FetchRemotePipelineInfo 调用远程接口获取三方流水线元数据
func FetchRemotePipelineInfo(ctx context.Context, pipelineID string, headers map[string]string) (*models.Pipeline, error) {
	apiURLStr := models.AppConfig.PipelineSystem.GetPipelineURL
	if apiURLStr == "" {
		return nil, fmt.Errorf("get_pipeline_url not configured")
	}

	body, err := sendHTTPRequest(ctx, "GET", apiURLStr, nil, httpOptions{
		Headers:     headers,
		QueryParams: map[string]string{"pipelineId": pipelineID},
	}, []int{http.StatusOK}, "FetchPipelineInfo")
	if err != nil {
		return nil, err
	}

	// Pretty print remote JSON response to console
	var prettyJSON bytes.Buffer
	if err := json.Indent(&prettyJSON, body, "", "  "); err == nil {
		log.Printf("[PipelineClient] FetchPipelineInfo remote response:\n%s\n", prettyJSON.String())
	} else {
		log.Printf("[PipelineClient] FetchPipelineInfo remote response: %s\n", string(body))
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
		log.Printf("[FetchPipelineInfo] Failed to parse JSON: %v, Body: %s", err, string(body))
		return nil, fmt.Errorf("failed to parse remote response JSON: %v", err)
	}

	res := remoteResp.Entity.Result
	name := res.PipelineName
	if name == "" {
		name = fmt.Sprintf("Pipeline_%s", pipelineID)
	}

	return &models.Pipeline{
		PipelineID:  res.ID,
		Name:        name,
		Type:        "每日构建",
		GroupName:   "DefaultGroup",
		Description: fmt.Sprintf("三方服务 %s (%s) 自动同步录入", res.ServiceName, res.ServiceID),
		ServiceID:   res.ServiceID,
		WorkspaceID: res.WorkspaceID,
		Owner:       res.Owner,
		ServiceName: res.ServiceName,
	}, nil
}

// FetchRemoteExecutionPlans 从三方系统获取指定流水线的执行方案列表
func FetchRemoteExecutionPlans(ctx context.Context, pipelineBusinessID string, pipelineID uint, headers map[string]string) ([]models.ExecutionPlan, error) {
	apiURLStr := models.AppConfig.PipelineSystem.GetExecutionPlanURL
	if apiURLStr == "" {
		return nil, fmt.Errorf("get_execution_plan_url not configured")
	}

	body, err := sendHTTPRequest(ctx, "GET", apiURLStr, nil, httpOptions{
		Headers:     headers,
		QueryParams: map[string]string{"pipelineId": pipelineBusinessID},
	}, []int{http.StatusOK}, "SyncExecutionPlans")
	if err != nil {
		return nil, err
	}

	var prettyJSON bytes.Buffer
	if err := json.Indent(&prettyJSON, body, "", "  "); err == nil {
		log.Printf("[PipelineClient] SyncExecutionPlans remote response:\n%s\n", prettyJSON.String())
	} else {
		log.Printf("[PipelineClient] SyncExecutionPlans remote response: %s\n", string(body))
	}

	var remoteResp struct {
		Entities []struct {
			ID              string `json:"id"`
			Name            string `json:"name"`
			CustomParameter string `json:"customParameter"`
		} `json:"entities"`
	}

	if err := json.Unmarshal(body, &remoteResp); err != nil {
		log.Printf("[SyncExecutionPlans] Failed to parse JSON: %v, Body: %s", err, string(body))
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

		var codeURL string
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
						codeURL = param.Value
					case "code_checker_task_id":
						plan.CodeCheckerTaskID = param.Value
					}
				}
			} else {
				log.Printf("[PipelineClient] Warning: failed to parse customParameter JSON for entity %s: %v\n", entity.ID, err)
			}
		}

		if codeURL != "" {
			var repo models.Repository
			if err := database.DB.Where("url = ?", codeURL).First(&repo).Error; err == nil {
				plan.RepositoryID = repo.ID
				plan.Repository = repo
			} else {
				log.Printf("[PipelineClient] Warning: code_url %s not found in local mirrors\n", codeURL)
			}
		}

		if plan.RepositoryID == 0 {
			log.Printf("[PipelineClient] Warning: skipped entity %s because repository ID is 0 or URL %s is not synced\n", entity.ID, codeURL)
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

	var repo models.Repository
	database.DB.First(&repo, plan.RepositoryID)
	repoURL := repo.URL
	if repoURL == "" {
		repoURL = plan.Repository.URL
	}

	payload := map[string]interface{}{
		"pipeline_id":          pipelineBusinessID,
		"repository":           repoURL,
		"branch":               plan.Branch,
		"username":             plan.Username,
		"password":             plan.Password,
		"code_checker_task_id": plan.CodeCheckerTaskID,
		"languages":            strings.Split(plan.Languages, ","),
		"custom_attributes":    plan.CustomAttributes,
	}

	body, err := sendHTTPRequest(context.Background(), "POST", apiURLStr, payload, httpOptions{}, []int{http.StatusOK, http.StatusCreated}, "SyncCreatePlan")
	if err != nil {
		return "", err
	}

	var responseData map[string]interface{}
	if err := json.Unmarshal(body, &responseData); err != nil {
		log.Printf("[SyncCreatePlan] Failed to parse JSON: %v, Body: %s", err, string(body))
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

	var repo models.Repository
	database.DB.First(&repo, plan.RepositoryID)
	repoURL := repo.URL
	if repoURL == "" {
		repoURL = plan.Repository.URL
	}

	targetURL := fmt.Sprintf("%s/%s", strings.TrimSuffix(apiURLStr, "/"), plan.ExecutionPlanID)

	payload := map[string]interface{}{
		"pipeline_id":          pipelineBusinessID,
		"repository":           repoURL,
		"branch":               plan.Branch,
		"username":             plan.Username,
		"password":             plan.Password,
		"code_checker_task_id": plan.CodeCheckerTaskID,
		"languages":            strings.Split(plan.Languages, ","),
		"custom_attributes":    plan.CustomAttributes,
	}

	_, err := sendHTTPRequest(context.Background(), "PUT", targetURL, payload, httpOptions{}, []int{http.StatusOK, http.StatusNoContent}, "SyncUpdatePlan")
	return err
}

// SyncDeleteExecutionPlanRemote 在三方系统中删除执行方案
func SyncDeleteExecutionPlanRemote(executionPlanID string) error {
	apiURLStr := models.AppConfig.PipelineSystem.GetExecutionPlanURL
	if apiURLStr == "" {
		return fmt.Errorf("get_execution_plan_url not configured")
	}

	targetURL := fmt.Sprintf("%s/%s", strings.TrimSuffix(apiURLStr, "/"), executionPlanID)

	_, err := sendHTTPRequest(context.Background(), "DELETE", targetURL, nil, httpOptions{}, []int{http.StatusOK, http.StatusNoContent, http.StatusAccepted}, "SyncDeletePlan")
	return err
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

// copyCheckerTask 复制三方检查任务
func copyCheckerTask(ctx context.Context, repository string, branch string, headers map[string]string) ([]byte, error) {
	apiURL := models.AppConfig.PipelineSystem.CopyCheckerTaskURL
	if apiURL == "" {
		return nil, fmt.Errorf("copy_checker_task_url not configured")
	}
	templateTaskID := models.AppConfig.PipelineSystem.CheckerTaskTemplateID
	if templateTaskID == "" {
		return nil, fmt.Errorf("checker_task_template_id not configured")
	}

	repoName := extractRepoName(repository)
	taskName := fmt.Sprintf("%s-%s", repoName, branch)
	taskName = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-' || r == '.' {
			return r
		}
		return '-'
	}, taskName)

	postData := map[string]string{
		"id":              templateTaskID,
		"name":            taskName,
		"copyIgnoreGroup": "false",
		"isCopyCategory":  "false",
	}

	log.Printf("[UpdateCheckerTaskRemote_CopyTask] Request URL: %s, Headers: %v, Body: %v", apiURL, headers, postData)

	respBody, err := sendHTTPRequest(ctx, "POST", apiURL, postData, httpOptions{
		Headers: headers,
	}, []int{http.StatusOK, http.StatusCreated}, "UpdateCheckerTaskRemote_CopyTask")
	if err != nil {
		return nil, err
	}

	log.Printf("[UpdateCheckerTaskRemote_CopyTask] Response Body: %s", string(respBody))
	return respBody, nil
}

// UpdateCheckerTaskRemote 调用远程三方接口完成：1. 创建任务，2. 获取 ID，3. 进行设置
func UpdateCheckerTaskRemote(ctx context.Context, repository string, branch string, languages string, customAttributes string, headers map[string]string) (string, string, error) {

	//1. 检查代码仓授权（进行 MR 的 Webhook 的配置等）
	authorized, err := checkRepoAuthorized(ctx, repository, headers)
	if err != nil {
		return "", "", fmt.Errorf("repo auth check failed: %v", err)
	}
	if !authorized {
		return "", "", fmt.Errorf("repository %s is unauthorized", repository)
	}

	//2. 需要检查代码仓是否关联到“关联凭证”里面了。
	// 关联凭证检查需要 API URL， 查询参数 authorized=true, uri=代码仓地址
	// 返回的响应体为： { "success": true,  "result"：{"content":[]}}， 如果 content 的 size 大于0， 则已经关联凭证了。
	associated, err := checkRepoCredentialAssociated(ctx, repository, headers)
	if err != nil {
		return "", "", fmt.Errorf("repo credential check failed: %v", err)
	}
	if !associated {
		return "", "", fmt.Errorf("repository %s has no associated credentials", repository)
	}

	// 1. 复制任务 (Remote API Call 1)
	_, err = copyCheckerTask(ctx, repository, branch, headers)
	if err != nil {
		return "", "", err
	}

	// 2. 获取任务 ID (Remote API Call 2) - 下一步再实现，目前只判断复制成功，故使用原本的 Mock ID 逻辑
	// 3. 进行规则/语言配置设置 (Remote API Call 3)

	// 框架占位实现，暂时生成一个 Mock 任务 ID 并合并配置
	mockTaskID := "task_" + fmt.Sprintf("%d", time.Now().UnixNano())

	// 临时 Mock 配置生成 logic
	var currentConfig map[string]interface{}
	if customAttributes != "" {
		_ = json.Unmarshal([]byte(customAttributes), &currentConfig)
	}
	if currentConfig == nil {
		currentConfig = make(map[string]interface{})
	}

	currentConfig["code_checker_task_id"] = mockTaskID

	var selectedLangs []string
	if languages != "" {
		selectedLangs = strings.Split(languages, ",")
	}
	currentConfig["languages"] = selectedLangs

	checkerConfig := make(map[string]interface{})
	for _, lang := range selectedLangs {
		if lang == "C/C++" {
			checkerConfig["c_cpp_rules"] = []string{"memory_leak", "coredump_risk", "thread_create"}
		}
		if lang == "Python" {
			checkerConfig["python_rules"] = []string{"format", "linter"}
		}
		if lang == "Java" {
			checkerConfig["java_rules"] = []string{"naming", "complexity"}
		}
	}
	currentConfig["checker_config"] = checkerConfig

	updatedAttrsBytes, _ := json.MarshalIndent(currentConfig, "", "  ")

	return mockTaskID, string(updatedAttrsBytes), nil
}

// extractRepoName 从 Git 仓库 URL 或路径中提取代码仓的 basename 名称
func extractRepoName(repoURL string) string {
	u := strings.TrimSuffix(repoURL, "/")
	u = strings.TrimSuffix(u, ".git")

	// 取最后一个 "/" 后面的部分
	if idx := strings.LastIndex(u, "/"); idx != -1 {
		u = u[idx+1:]
	}
	// 如果是 ssh 格式类似 git@github.com:org/repo.git ，且刚才没找到 "/" 时只剩下 git@github.com:repo
	if idx := strings.LastIndex(u, ":"); idx != -1 {
		u = u[idx+1:]
	}

	if u == "" {
		return "repo"
	}
	return u
}

// checkRepoAuthorized 检查代码仓是否授权
func checkRepoAuthorized(ctx context.Context, repository string, headers map[string]string) (bool, error) {
	apiURLStr := models.AppConfig.PipelineSystem.RepoAuthCheckURL
	if apiURLStr == "" {
		return false, fmt.Errorf("repo_auth_check_url not configured")
	}

	body, err := sendHTTPRequest(ctx, "GET", apiURLStr, nil, httpOptions{
		Headers:     headers,
		QueryParams: map[string]string{"fuzzyMatch": repository, "filterType": "allTeam"},
	}, []int{http.StatusOK}, "checkRepoAuthorized")
	if err != nil {
		return false, err
	}

	var responseData map[string]interface{}
	if err := json.Unmarshal(body, &responseData); err != nil {
		log.Printf("[checkRepoAuthorized] Failed to parse JSON: %v, Body: %s", err, string(body))
		return false, fmt.Errorf("failed to parse auth check response JSON: %v", err)
	}

	status, _ := responseData["status"].(string)
	if status != "success" {
		return false, fmt.Errorf("auth check failed with status: %s", status)
	}

	countVal, exists := responseData["count"]
	if !exists {
		return false, fmt.Errorf("auth check response does not contain count")
	}

	var count int
	switch v := countVal.(type) {
	case string:
		c, err := strconv.Atoi(v)
		if err != nil {
			return false, fmt.Errorf("invalid count value %q in auth check response: %v", v, err)
		}
		count = c
	case float64:
		count = int(v)
	case int:
		count = v
	default:
		return false, fmt.Errorf("unexpected count type %T in auth check response", countVal)
	}

	return count > 0, nil
}

// checkRepoCredentialAssociated 检查代码仓是否关联到凭证
func checkRepoCredentialAssociated(ctx context.Context, repository string, headers map[string]string) (bool, error) {
	apiURLStr := models.AppConfig.PipelineSystem.RepoCredentialCheckURL
	if apiURLStr == "" {
		return false, fmt.Errorf("repo_credential_check_url not configured")
	}

	body, err := sendHTTPRequest(ctx, "GET", apiURLStr, nil, httpOptions{
		Headers: headers,
		QueryParams: map[string]string{
			"authorized": "true",
			"uri":        repository,
		},
	}, []int{http.StatusOK}, "checkRepoCredentialAssociated")
	if err != nil {
		return false, err
	}

	type CredentialResponse struct {
		Success bool `json:"success"`
		Result  struct {
			Content []interface{} `json:"content"`
		} `json:"result"`
	}

	var resp CredentialResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		log.Printf("[checkRepoCredentialAssociated] Failed to parse JSON: %v, Body: %s", err, string(body))
		return false, fmt.Errorf("failed to parse credential response JSON: %v", err)
	}

	if !resp.Success {
		return false, fmt.Errorf("credential association check failed")
	}

	return len(resp.Result.Content) > 0, nil
}

// httpOptions 定义 HTTP 请求的附加参数
type httpOptions struct {
	Headers     map[string]string
	QueryParams map[string]string
}

// sendHTTPRequest 封装统一的 HTTP 请求发送与错误处理逻辑
func sendHTTPRequest(ctx context.Context, method, rawURL string, payload interface{}, opt httpOptions, expectedStatuses []int, contextMsg string) ([]byte, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse URL %s: %v", rawURL, err)
	}

	if len(opt.QueryParams) > 0 {
		q := u.Query()
		for k, v := range opt.QueryParams {
			q.Set(k, v)
		}
		u.RawQuery = q.Encode()
	}

	var bodyReader io.Reader
	if payload != nil {
		jsonBytes, err := json.Marshal(payload)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal request payload: %v", err)
		}
		bodyReader = bytes.NewBuffer(jsonBytes)
	}

	req, err := http.NewRequestWithContext(ctx, method, u.String(), bodyReader)
	if err != nil {
		return nil, fmt.Errorf("failed to create HTTP request: %v", err)
	}

	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	for k, v := range opt.Headers {
		req.Header.Set(k, v)
	}

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to execute remote request: %v", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %v", err)
	}

	isExpected := false
	for _, status := range expectedStatuses {
		if resp.StatusCode == status {
			isExpected = true
			break
		}
	}

	if !isExpected {
		LogHTTPErrorDetails(contextMsg, req, resp.StatusCode, body)
		return nil, fmt.Errorf("remote API returned status code %d", resp.StatusCode)
	}

	return body, nil
}
