package services

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"code-pipeline/database"
	"code-pipeline/models"
	"code-pipeline/utils"
)

// FetchRemotePipelineInfo 调用远程接口获取三方流水线元数据
func FetchRemotePipelineInfo(ctx context.Context, pipelineID string, headers map[string]string) (*models.Pipeline, error) {
	apiURLStr := models.AppConfig.PipelineSystem.GetPipelineURL
	if apiURLStr == "" {
		return nil, fmt.Errorf("get_pipeline_url not configured")
	}

	body, err := utils.SendHTTPRequest(ctx, "GET", apiURLStr, nil, utils.HTTPOptions{
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

// FetchRemoteExecutionPlans 从三方系统获取指定流水线的执行方案原始数据列表
func FetchRemoteExecutionPlans(ctx context.Context, pipelineBusinessID string, headers map[string]string) ([]models.RemoteExecutionScheme, error) {
	apiURLStr := models.AppConfig.PipelineSystem.GetExecutionPlanURL
	if apiURLStr == "" {
		return nil, fmt.Errorf("get_execution_plan_url not configured")
	}

	body, err := utils.SendHTTPRequest(ctx, "GET", apiURLStr, nil, utils.HTTPOptions{
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
		Entities []models.RemoteExecutionScheme `json:"entities"`
	}

	if err := json.Unmarshal(body, &remoteResp); err != nil {
		log.Printf("[SyncExecutionPlans] Failed to parse JSON: %v, Body: %s", err, string(body))
		return nil, fmt.Errorf("failed to parse remote response JSON: %v", err)
	}

	return remoteResp.Entities, nil
}

// createCheckerTaskStep 步骤一：创建代码检查执行任务
func createCheckerTaskStep(ctx context.Context, repoURL string, branch string, languages string, headers map[string]string) (string, error) {
	apiURL := models.AppConfig.PipelineSystem.CreateCheckerTaskURL
	if apiURL == "" {
		return "", fmt.Errorf("create_checker_task_url not configured")
	}

	firstBranch := branch
	if idx := strings.Index(branch, ","); idx != -1 {
		firstBranch = strings.TrimSpace(branch[:idx])
	} else if idx := strings.Index(branch, ";"); idx != -1 {
		firstBranch = strings.TrimSpace(branch[:idx])
	} else {
		firstBranch = strings.TrimSpace(branch)
	}

	repoName := extractRepoName(repoURL)
	randomSuffix := "0000"
	randBytes := make([]byte, 2)
	if _, err := rand.Read(randBytes); err == nil {
		randomSuffix = hex.EncodeToString(randBytes)
	}
	taskName := fmt.Sprintf("%s-%s-CodeShield-%s", repoName, firstBranch, randomSuffix)
	taskName = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-' || r == '.' {
			return r
		}
		return '-'
	}, taskName)

	var langs []string
	if languages != "" {
		langs = strings.Split(languages, ",")
	}

	type RuleSetParam struct {
		Language  string `json:"language"`
		RuleSetID string `json:"ruleSetId"`
	}
	var ruleSets []RuleSetParam
	for _, lang := range langs {
		langUpper := strings.ToUpper(strings.TrimSpace(lang))
		if ids, ok := models.AppConfig.PipelineSystem.RuleSets[langUpper]; ok {
			for _, id := range ids {
				ruleSets = append(ruleSets, RuleSetParam{
					Language:  langUpper,
					RuleSetID: id,
				})
			}
		}
	}
	ruleSetsJSON, err := json.Marshal(ruleSets)
	if err != nil {
		log.Printf("[SyncCreatePlan] Step 1: Failed to marshal ruleSets: %v", err)
		return "", fmt.Errorf("failed to marshal ruleSets to JSON: %w", err)
	}

	tmpl := models.AppConfig.PipelineSystem.CreateCheckerTaskBody
	if tmpl == "" {
		return "", fmt.Errorf("create_checker_task_body not configured")
	}

	bodyStr := utils.ReplacePlaceholders(tmpl, map[string]string{
		"{REPO_URL}":    repoURL,
		"{REPO_BRANCH}": firstBranch,
		"{TASK_NAME}":   taskName,
		"{RULE_SETS}":   string(ruleSetsJSON),
	})

	postData := json.RawMessage(bodyStr)

	log.Printf("[SyncCreatePlan] Step 1: Creating Checker Task. URL: %s, Body: %s", apiURL, bodyStr)

	body, err := utils.SendHTTPRequest(ctx, "POST", apiURL, postData, utils.HTTPOptions{
		Headers: headers,
	}, []int{http.StatusOK, http.StatusCreated}, "CreateCheckerTaskStep")
	if err != nil {
		return "", err
	}

	var statusResp struct {
		Status  string `json:"status"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(body, &statusResp); err != nil {
		log.Printf("[SyncCreatePlan] Step 1: Failed to parse response status: %v, Body: %s", err, string(body))
		return "", fmt.Errorf("failed to parse checker task status response JSON: %w", err)
	}
	if statusResp.Status != "success" {
		return "", fmt.Errorf("failed to create checker task: status is %s, message: %s", statusResp.Status, statusResp.Message)
	}

	queryURL := models.AppConfig.PipelineSystem.QueryCheckerTaskURL
	if queryURL == "" {
		return "", fmt.Errorf("query_checker_task_url not configured")
	}

	queryBody, err := utils.SendHTTPRequest(ctx, "GET", queryURL, nil, utils.HTTPOptions{
		Headers: headers,
		QueryParams: map[string]string{
			"name": taskName,
		},
	}, []int{http.StatusOK}, "QueryCheckerTaskStep")
	if err != nil {
		return "", fmt.Errorf("failed to query checker task ID by name: %w", err)
	}

	var queryResp struct {
		Status   string `json:"status"`
		Entities []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"entities"`
	}
	if err := json.Unmarshal(queryBody, &queryResp); err != nil {
		log.Printf("[SyncCreatePlan] Step 1: Failed to parse query response: %v, Body: %s", err, string(queryBody))
		return "", fmt.Errorf("failed to parse query checker task response JSON: %w", err)
	}
	if queryResp.Status != "success" {
		return "", fmt.Errorf("failed to query checker task: status is %s", queryResp.Status)
	}
	if len(queryResp.Entities) == 0 {
		return "", fmt.Errorf("no checker task found with name %s", taskName)
	}

	taskID := queryResp.Entities[0].ID
	if taskID == "" {
		return "", fmt.Errorf("checker task ID is empty for task name %s", taskName)
	}

	return taskID, nil
}

// createExecutionPlanStep 步骤二：创建执行方案（关联代码检查任务）
func createExecutionPlanStep(ctx context.Context, pipelineBusinessID string, plan *models.ExecutionPlan, taskID string, repoURL string, headers map[string]string) (string, error) {
	apiURLStr := models.AppConfig.PipelineSystem.GetExecutionPlanURL
	if apiURLStr == "" {
		return "", fmt.Errorf("get_execution_plan_url not configured")
	}

	var langs []string
	if plan.Languages != "" {
		langs = strings.Split(plan.Languages, ",")
	}

	payload := map[string]interface{}{
		"pipeline_id":          pipelineBusinessID,
		"repository":           repoURL,
		"branch":               plan.Branch,
		"username":             plan.Username,
		"password":             plan.Password,
		"code_checker_task_id": taskID,
		"languages":            langs,
		"custom_attributes":    plan.CustomAttributes,
	}

	log.Printf("[SyncCreatePlan] Step 2: Creating Execution Plan. URL: %s, Body: %v", apiURLStr, payload)

	body, err := utils.SendHTTPRequest(ctx, "POST", apiURLStr, payload, utils.HTTPOptions{
		Headers: headers,
	}, []int{http.StatusOK, http.StatusCreated}, "CreateExecutionPlanStep")
	if err != nil {
		return "", err
	}

	var responseData map[string]interface{}
	if err := json.Unmarshal(body, &responseData); err != nil {
		log.Printf("[SyncCreatePlan] Step 2: Failed to parse JSON: %v, Body: %s", err, string(body))
		mockPlanID := fmt.Sprintf("ext_plan_%d", time.Now().UnixNano())
		return mockPlanID, nil
	}

	extID, ok := responseData["id"].(string)
	if !ok || extID == "" {
		if val, exist := responseData["execution_plan_id"].(string); exist && val != "" {
			extID = val
		} else {
			extID = fmt.Sprintf("ext_plan_%d", time.Now().UnixNano())
			log.Printf("[SyncCreatePlan] Step 2: No ID found in response, fallback to mock plan ID: %s", extID)
		}
	}

	return extID, nil
}

// createMRBindingStep 步骤三：创建 MR 触发关联
func createMRBindingStep(ctx context.Context, pipelineBusinessID string, plan *models.ExecutionPlan, schemeID string, repoURL string, headers map[string]string) (string, error) {
	apiURLStr := models.AppConfig.PipelineSystem.CreateMRBindingURL
	if apiURLStr == "" {
		apiURLStr = models.AppConfig.PipelineSystem.GetMRBindingsURL
	}
	if apiURLStr == "" {
		return "", fmt.Errorf("create_mr_binding_url and get_mr_bindings_url not configured")
	}

	payload := map[string]interface{}{
		"pipeline_id":       pipelineBusinessID,
		"scheme_id":         schemeID,
		"code_url":          repoURL,
		"branches":          plan.Branch,
		"mr_binding_id":     plan.MRBindingID,
		"custom_attributes": plan.CustomAttributes,
	}

	log.Printf("[SyncCreatePlan] Step 3: Creating MR Binding. URL: %s, Body: %v", apiURLStr, payload)

	body, err := utils.SendHTTPRequest(ctx, "POST", apiURLStr, payload, utils.HTTPOptions{
		Headers: headers,
	}, []int{http.StatusOK, http.StatusCreated, http.StatusNoContent}, "CreateMRBindingStep")
	if err != nil {
		return "", err
	}

	var responseData map[string]interface{}
	_ = json.Unmarshal(body, &responseData)

	var mrBindingID string
	if responseData != nil {
		if id, ok := responseData["id"].(string); ok && id != "" {
			mrBindingID = id
		} else if id, ok := responseData["mr_binding_id"].(string); ok && id != "" {
			mrBindingID = id
		}
	}

	if mrBindingID == "" {
		mrBindingID = fmt.Sprintf("mr_bind_%d", time.Now().UnixNano())
		log.Printf("[SyncCreatePlan] Step 3: No ID found in response, fallback to mock MR binding ID: %s", mrBindingID)
	}

	return mrBindingID, nil
}

// SyncCreateExecutionPlanRemote 在三方系统中同步创建执行方案（依次执行三个步骤）
func SyncCreateExecutionPlanRemote(ctx context.Context, pipelineBusinessID string, plan *models.ExecutionPlan, headers map[string]string) (string, error) {
	var repo models.Repository
	database.DB.First(&repo, plan.RepositoryID)
	repoURL := repo.URL
	if repoURL == "" {
		repoURL = plan.Repository.URL
	}

	// 1. 创建代码检查执行任务
	taskID, err := createCheckerTaskStep(ctx, repoURL, plan.Branch, plan.Languages, headers)
	if err != nil {
		log.Printf("[Pipeline] Remote sync Step 1 failed: %v\n", err)
		return "", err
	}
	plan.CodeCheckerTaskID = taskID

	// 2. 创建执行方案（并关联代码检查任务）
	extID, err := createExecutionPlanStep(ctx, pipelineBusinessID, plan, taskID, repoURL, headers)
	if err != nil {
		log.Printf("[Pipeline] Remote sync Step 2 failed: %v\n", err)
		return "", err
	}
	plan.ExecutionPlanID = extID

	// 3. 创建 MR 触发关联（关联该方案）
	mrBindingID, err := createMRBindingStep(ctx, pipelineBusinessID, plan, extID, repoURL, headers)
	if err != nil {
		log.Printf("[Pipeline] Remote sync Step 3 failed (non-fatal): %v\n", err)
	}
	plan.MRBindingID = mrBindingID

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

	_, err := utils.SendHTTPRequest(context.Background(), "PUT", targetURL, payload, utils.HTTPOptions{}, []int{http.StatusOK, http.StatusNoContent}, "SyncUpdatePlan")
	return err
}

// SyncDeleteExecutionPlanRemote 在三方系统中删除执行方案
func SyncDeleteExecutionPlanRemote(executionPlanID string) error {
	apiURLStr := models.AppConfig.PipelineSystem.GetExecutionPlanURL
	if apiURLStr == "" {
		return fmt.Errorf("get_execution_plan_url not configured")
	}

	targetURL := fmt.Sprintf("%s/%s", strings.TrimSuffix(apiURLStr, "/"), executionPlanID)

	_, err := utils.SendHTTPRequest(context.Background(), "DELETE", targetURL, nil, utils.HTTPOptions{}, []int{http.StatusOK, http.StatusNoContent, http.StatusAccepted}, "SyncDeletePlan")
	return err
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
	randomSuffix := "0000"
	randBytes := make([]byte, 2)
	if _, err := rand.Read(randBytes); err == nil {
		randomSuffix = hex.EncodeToString(randBytes)
	}
	taskName := fmt.Sprintf("%s-%s-CodeShield-%s", repoName, branch, randomSuffix)
	taskName = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-' || r == '.' {
			return r
		}
		return '-'
	}, taskName)

	tmpl := models.AppConfig.PipelineSystem.CopyCheckerTaskBody
	if tmpl == "" {
		tmpl = `{
			"id": "{TEMPLATE_ID}",
			"name": "{NAME}",
			"copyIgnoreGroup": "false",
			"isCopyCategory": "false"
		}`
	}

	bodyStr := utils.ReplacePlaceholders(tmpl, map[string]string{
		"{TEMPLATE_ID}": templateTaskID,
		"{NAME}":        taskName,
	})

	postData := json.RawMessage(bodyStr)

	log.Printf("[UpdateCheckerTaskRemote_CopyTask] Request URL: %s, Headers: %v, Body: %s", apiURL, headers, bodyStr)

	respBody, err := utils.SendHTTPRequest(ctx, "POST", apiURL, postData, utils.HTTPOptions{
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
	authID, err := CheckRepoAuthorized(ctx, repository, headers)
	if err != nil {
		return "", "", fmt.Errorf("repo auth check failed: %w", err)
	}
	if authID == "" {
		return "", "", fmt.Errorf("repository %s is unauthorized", repository)
	}

	//2. 需要检查代码仓是否关联到“关联凭证”里面了。
	// 关联凭证检查需要 API URL， 查询参数 authorized=true, uri=代码仓地址
	// 返回的响应体为： { "success": true,  "result"：{"content":[]}}， 如果 content 的 size 大于0， 则已经关联凭证了。
	associated, err := checkRepoCredentialAssociated(ctx, repository, headers)
	if err != nil {
		return "", "", fmt.Errorf("repo credential check failed: %w", err)
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

// CheckRepoAuthorized 检查代码仓是否授权
// 返回的数据结构： {"status":"success",  "count": 3, "entities": [ {"id"} ]}
// 所以本函数会检查返回状态是否成功， count 是否大于0， 如果大于0， 则返回第一个 entity 的 id（授权ID）， 否则返回 ""， 表明未授权
func CheckRepoAuthorized(ctx context.Context, repository string, headers map[string]string) (string, error) {
	apiURLStr := models.AppConfig.PipelineSystem.RepoAuthCheckURL
	if apiURLStr == "" {
		return "", fmt.Errorf("repo_auth_check_url not configured")
	}

	body, err := utils.SendHTTPRequest(ctx, "GET", apiURLStr, nil, utils.HTTPOptions{
		Headers: headers,
		QueryParams: map[string]string{
			"fuzzyMatch": utils.ExtractRepoPath(repository),
			"filterType": "allTeam",
			"page-size":  "10",
			"page-no":    "1"},
	}, []int{http.StatusOK}, "checkRepoAuthorized")
	if err != nil {
		return "", err
	}

	var responseData map[string]interface{}
	if err := json.Unmarshal(body, &responseData); err != nil {
		log.Printf("[checkRepoAuthorized] Failed to parse JSON: %v, Body: %s", err, string(body))
		return "", fmt.Errorf("failed to parse auth check response JSON: %v", err)
	}

	status, _ := responseData["status"].(string)
	if status != "success" {
		return "", fmt.Errorf("auth check failed with status: %s", status)
	}

	entitiesVal, exists := responseData["entities"]
	if !exists {
		return "", fmt.Errorf("auth check response does not contain entities")
	}

	entities, ok := entitiesVal.([]interface{})
	if !ok {
		return "", fmt.Errorf("entities in auth check response is not an array")
	}

	if len(entities) == 0 {
		return "", nil // 未授权，返回空字符串
	}

	firstEntity, ok := entities[0].(map[string]interface{})
	if !ok {
		return "", fmt.Errorf("first entity in auth check response is not an object")
	}

	idVal, exists := firstEntity["id"]
	if !exists {
		return "", fmt.Errorf("first entity does not contain id")
	}

	// TODO： firstEntity["repositoryUrl"] 是代码仓的真实URL， 后续考虑是否回填回去？

	authID, ok := idVal.(string)
	if !ok {
		return "", fmt.Errorf("first entity id is not a string")
	}

	return authID, nil
}

// checkRepoCredentialAssociated 检查代码仓是否关联到凭证
func checkRepoCredentialAssociated(ctx context.Context, repository string, headers map[string]string) (bool, error) {
	apiURLStr := models.AppConfig.PipelineSystem.RepoCredentialCheckURL
	if apiURLStr == "" {
		return false, fmt.Errorf("repo_credential_check_url not configured")
	}

	body, err := utils.SendHTTPRequest(ctx, "GET", apiURLStr, nil, utils.HTTPOptions{
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

// FetchRemoteMRBindings 从三方系统获取指定流水线的 MR 绑定列表
func FetchRemoteMRBindings(ctx context.Context, pipelineBusinessID string, headers map[string]string) ([]models.MRBinding, error) {
	apiURLStr := models.AppConfig.PipelineSystem.GetMRBindingsURL
	if apiURLStr == "" {
		return nil, fmt.Errorf("get_mr_bindings_url not configured")
	}

	body, err := utils.SendHTTPRequest(ctx, "GET", apiURLStr, nil, utils.HTTPOptions{
		Headers:     headers,
		QueryParams: map[string]string{"pipelineId": pipelineBusinessID},
	}, []int{http.StatusOK}, "FetchMRBindings")
	if err != nil {
		return nil, err
	}

	var remoteResp struct {
		Status string             `json:"status"`
		Result []models.MRBinding `json:"result"`
	}

	if err := json.Unmarshal(body, &remoteResp); err != nil {
		log.Printf("[FetchMRBindings] Failed to parse JSON: %v, Body: %s", err, string(body))
		return nil, fmt.Errorf("failed to parse remote response JSON: %v", err)
	}

	if remoteResp.Status != "success" {
		return nil, fmt.Errorf("remote API returned status: %s", remoteResp.Status)
	}

	return remoteResp.Result, nil
}

// GetRepoBranchesRemote 调用三方系统获取分支列表
func GetRepoBranchesRemote(ctx context.Context, repository string, authID string, headers map[string]string) ([]string, error) {
	apiURLStr := models.AppConfig.PipelineSystem.GetBranchesURL
	if apiURLStr == "" {
		return nil, fmt.Errorf("get_branches_url not configured")
	}

	queryParams := map[string]string{
		"queryType":        "new",
		"credentialId":     authID,
		"codeUrl":          repository,
		"repositorySystem": "CodeHubGreen",
	}

	body, err := utils.SendHTTPRequest(ctx, "GET", apiURLStr, nil, utils.HTTPOptions{
		Headers:     headers,
		QueryParams: queryParams,
	}, []int{http.StatusOK}, "GetRepoBranchesRemote")
	if err != nil {
		return nil, err
	}

	var responseData struct {
		Status string   `json:"status"`
		Result []string `json:"result"`
	}
	if err := json.Unmarshal(body, &responseData); err != nil {
		log.Printf("[GetRepoBranchesRemote] Failed to parse JSON: %v, Body: %s", err, string(body))
		return nil, fmt.Errorf("failed to parse branches response JSON: %v", err)
	}

	if responseData.Status != "success" {
		return nil, fmt.Errorf("fetch branches failed with status: %s", responseData.Status)
	}

	return responseData.Result, nil
}
