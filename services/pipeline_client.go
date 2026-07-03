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
	"sort"
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
		if id, ok := models.AppConfig.PipelineSystem.RuleSets[langUpper]; ok {
			ruleSets = append(ruleSets, RuleSetParam{
				Language:  langUpper,
				RuleSetID: id,
			})
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
		Message string `json:"result"`
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
			"search": taskName,
		},
	}, []int{http.StatusOK}, "QueryCheckerTaskStep")
	if err != nil {
		return "", fmt.Errorf("failed to query checker task ID by name: %w", err)
	}

	var queryResp struct {
		Status string `json:"status"`
		Result struct {
			Info []struct {
				ID         string `json:"id"`
				Name       string `json:"name"`
				RepoURL    string `json:"repoURL"`
				BranchName string `json:"branchName"`
			} `json:"info"`
		} `json:"result"`
	}
	if err := json.Unmarshal(queryBody, &queryResp); err != nil {
		log.Printf("[SyncCreatePlan] Step 1: Failed to parse query response: %v, Body: %s", err, string(queryBody))
		return "", fmt.Errorf("failed to parse query checker task response JSON: %w", err)
	}
	if queryResp.Status != "success" {
		return "", fmt.Errorf("failed to query checker task: status is %s", queryResp.Status)
	}
	if len(queryResp.Result.Info) == 0 {
		return "", fmt.Errorf("no checker task found with name %s", taskName)
	}

	taskID := queryResp.Result.Info[0].ID
	if taskID == "" {
		return "", fmt.Errorf("checker task ID is empty for task name %s", taskName)
	}

	return taskID, nil
}

// createExecutionPlanStep 步骤二：创建执行方案（关联代码检查任务）
func createExecutionPlanStep(ctx context.Context, pipelineBusinessID string, plan *models.ExecutionPlan, taskID string, repoURL string, headers map[string]string) (string, error) {
	apiURLStr := models.AppConfig.PipelineSystem.CreateExecutionPlanURL
	if apiURLStr == "" {
		return "", fmt.Errorf("create_execution_plan_url not configured")
	}

	tmpl := models.AppConfig.PipelineSystem.CreateExecutionPlanBody
	if tmpl == "" {
		return "", fmt.Errorf("create_execution_plan_body not configured")
	}

	randomSuffix := "0000"
	randBytes := make([]byte, 2)
	if _, err := rand.Read(randBytes); err == nil {
		randomSuffix = hex.EncodeToString(randBytes)
	}
	repoName := extractRepoName(repoURL)
	planName := fmt.Sprintf("%s_%s_CodeShield_%s", repoName, plan.Branch, randomSuffix)
	planName = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' {
			return r
		}
		return '_'
	}, planName)

	var customAttrMap map[string]interface{}
	if plan.CustomAttributes != "" {
		if err := json.Unmarshal([]byte(plan.CustomAttributes), &customAttrMap); err != nil {
			log.Printf("[SyncCreatePlan] Step 2: Failed to unmarshal custom_attributes: %v", err)
			return "", fmt.Errorf("failed to parse custom_attributes JSON: %w", err)
		}
	}
	if customAttrMap == nil {
		customAttrMap = make(map[string]interface{})
	}

	customAttrMap["cmc_username"] = plan.Username
	customAttrMap["cmc_password"] = plan.Password
	customAttrMap["code_checker_task_id"] = taskID
	customAttrMap["repository"] = repoURL
	customAttrMap["branch"] = plan.Branch
	customAttrMap["mr_trigger"] = plan.MRTrigger
	customAttrMap["daily_build"] = plan.DailyBuild
	customAttrMap["daily_build_time"] = plan.DailyBuildTime

	type CustomAttr struct {
		Name  string      `json:"name"`
		Value interface{} `json:"value"`
	}

	var keys []string
	for k := range customAttrMap {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	customAttrList := make([]CustomAttr, 0, len(keys))
	for _, k := range keys {
		customAttrList = append(customAttrList, CustomAttr{
			Name:  k,
			Value: customAttrMap[k],
		})
	}

	mergedBytes, err := json.Marshal(customAttrList)
	if err != nil {
		log.Printf("[SyncCreatePlan] Step 2: Failed to marshal merged custom_attributes: %v", err)
		return "", fmt.Errorf("failed to marshal custom_attributes to JSON: %w", err)
	}

	customAttributesJSON, err := json.Marshal(string(mergedBytes))
	if err != nil {
		log.Printf("[SyncCreatePlan] Step 2: Failed to escape custom_attributes: %v", err)
		return "", fmt.Errorf("failed to escape custom_attributes to JSON: %w", err)
	}

	escapedCustomAttributes := string(customAttributesJSON)
	if len(escapedCustomAttributes) >= 2 && escapedCustomAttributes[0] == '"' && escapedCustomAttributes[len(escapedCustomAttributes)-1] == '"' {
		escapedCustomAttributes = escapedCustomAttributes[1 : len(escapedCustomAttributes)-1]
	}

	userEmail, _ := ctx.Value("userEmail").(string)
	if userEmail == "" {
		userEmail = "system"
	}

	bodyStr := utils.ReplacePlaceholders(tmpl, map[string]string{
		"{PLAN_NAME}":         planName,
		"{PIPELINE_ID}":       pipelineBusinessID,
		"{USER_EMAIL}":        userEmail,
		"{CUSTOM_ATTRIBUTES}": escapedCustomAttributes,
	})

	postData := json.RawMessage(bodyStr)

	log.Printf("[SyncCreatePlan] Step 2: Creating Execution Plan. URL: %s, Body: %s", apiURLStr, bodyStr)

	body, err := utils.SendHTTPRequest(ctx, "POST", apiURLStr, postData, utils.HTTPOptions{
		Headers: headers,
	}, []int{http.StatusOK, http.StatusCreated}, "CreateExecutionPlanStep")
	if err != nil {
		return "", err
	}

	var createResp struct {
		Result  string `json:"result"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(body, &createResp); err != nil {
		log.Printf("[SyncCreatePlan] Step 2: Failed to parse create response: %v, Body: %s", err, string(body))
		return "", fmt.Errorf("failed to parse create execution plan response: %w", err)
	}

	if createResp.Result != "success" {
		log.Printf("[SyncCreatePlan] Step 2: Create response result is not success: %s, Message: %s", createResp.Result, createResp.Message)
		return "", fmt.Errorf("failed to create execution plan: status %s, message %s", createResp.Result, createResp.Message)
	}

	log.Printf("[SyncCreatePlan] Step 2: Create success. Fetching plan ID for name: %s", planName)

	var extID string
	for retry := 0; retry < 3; retry++ {
		if retry > 0 {
			time.Sleep(500 * time.Millisecond)
		}

		entities, err := FetchRemoteExecutionPlans(ctx, pipelineBusinessID, headers)
		if err != nil {
			log.Printf("[SyncCreatePlan] Step 2: Failed to fetch execution plans (retry %d): %v", retry, err)
			continue
		}

		for _, entity := range entities {
			if entity.Name == planName {
				extID = entity.ID
				break
			}
		}

		if extID != "" {
			break
		}
	}

	if extID == "" {
		log.Printf("[SyncCreatePlan] Step 2: Failed to retrieve plan ID by name %s after retries", planName)
		return "", fmt.Errorf("failed to retrieve plan ID by name %s", planName)
	}

	return extID, nil
}

// createMRBindingStep 步骤三：创建 MR 触发关联
func createMRBindingStep(ctx context.Context, pipelineBusinessID string, plan *models.ExecutionPlan, schemeID string, repoURL string, headers map[string]string) (string, error) {
	log.Printf("[SyncCreatePlan] Enter createMRBindingStep: pipelineBusinessID=%s, plan=%+v, schemeID=%s, repoURL=%s, headers=%v", pipelineBusinessID, plan, schemeID, repoURL, headers)
	apiURLStr := models.AppConfig.PipelineSystem.CreateMRBindingURL
	if apiURLStr == "" {
		apiURLStr = models.AppConfig.PipelineSystem.GetMRBindingsURL
	}
	if apiURLStr == "" {
		return "", fmt.Errorf("create_mr_binding_url and get_mr_bindings_url not configured")
	}

	tmpl := models.AppConfig.PipelineSystem.CreateMRBindingBody
	if tmpl == "" {
		return "", fmt.Errorf("create_mr_binding_body not configured")
	}

	credentialID, err := CheckRepoAuthorized(ctx, repoURL, headers)
	if err != nil {
		log.Printf("[SyncCreatePlan] Step 3: Failed to check repo authorized: %v", err)
		return "", fmt.Errorf("failed to check repo authorized: %w", err)
	}

	customAttributesJSON, err := json.Marshal(plan.CustomAttributes)
	if err != nil {
		log.Printf("[SyncCreatePlan] Step 3: Failed to escape custom_attributes: %v", err)
		return "", fmt.Errorf("failed to escape custom_attributes to JSON: %w", err)
	}

	escapedCustomAttributes := string(customAttributesJSON)
	if len(escapedCustomAttributes) >= 2 && escapedCustomAttributes[0] == '"' && escapedCustomAttributes[len(escapedCustomAttributes)-1] == '"' {
		escapedCustomAttributes = escapedCustomAttributes[1 : len(escapedCustomAttributes)-1]
	}

	bodyStr := utils.ReplacePlaceholders(tmpl, map[string]string{
		"{REPO_URL}":          repoURL,
		"{BRANCHES}":          plan.Branch,
		"{PIPELINE_ID}":       pipelineBusinessID,
		"{SCHEME_ID}":         schemeID,
		"{CREDENTIAL_ID}":     credentialID,
		"{CUSTOM_ATTRIBUTES}": escapedCustomAttributes,
	})

	postData := json.RawMessage(bodyStr)

	log.Printf("[SyncCreatePlan] Step 3: Creating MR Binding. URL: %s, Body: %s", apiURLStr, bodyStr)

	body, err := utils.SendHTTPRequest(ctx, "POST", apiURLStr, postData, utils.HTTPOptions{
		Headers: headers,
	}, []int{http.StatusOK, http.StatusCreated, http.StatusNoContent}, "CreateMRBindingStep")
	if err != nil {
		return "", err
	}

	var responseData struct {
		Status string `json:"status"`
		Result []struct {
			ID      string `json:"id"`
			Creator string `json:"creator"`
		} `json:"result"`
	}
	_ = json.Unmarshal(body, &responseData)

	var mrBindingID string
	if len(responseData.Result) > 0 {
		mrBindingID = responseData.Result[0].ID
	}

	if mrBindingID == "" {
		mrBindingID = fmt.Sprintf("mr_bind_%d", time.Now().UnixNano())
		log.Printf("[SyncCreatePlan] Step 3: No ID found in response, fallback to mock MR binding ID: %s", mrBindingID)
	}

	return mrBindingID, nil
}

// SyncCreateExecutionPlanRemote 在三方系统中同步创建执行方案（依次执行三个步骤）
func SyncCreateExecutionPlanRemote(ctx context.Context, pipelineBusinessID string, plan *models.ExecutionPlan, headers map[string]string) (string, error) {
	log.Printf("[SyncCreatePlan] Start remote sync execution plan. pipelineBusinessID: %s, RepositoryID: %d", pipelineBusinessID, plan.RepositoryID)
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

	var customAttrMap map[string]interface{}
	if plan.CustomAttributes != "" {
		_ = json.Unmarshal([]byte(plan.CustomAttributes), &customAttrMap)
	}
	if customAttrMap == nil {
		customAttrMap = make(map[string]interface{})
	}

	customAttrMap["mr_trigger"] = plan.MRTrigger
	customAttrMap["daily_build"] = plan.DailyBuild
	customAttrMap["daily_build_time"] = plan.DailyBuildTime

	type CustomAttr struct {
		Name  string      `json:"name"`
		Value interface{} `json:"value"`
	}

	var keys []string
	for k := range customAttrMap {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	customAttrList := make([]CustomAttr, 0, len(keys))
	for _, k := range keys {
		customAttrList = append(customAttrList, CustomAttr{
			Name:  k,
			Value: customAttrMap[k],
		})
	}

	mergedBytes, err := json.Marshal(customAttrList)
	if err != nil {
		return fmt.Errorf("failed to marshal custom attributes: %w", err)
	}

	payload := map[string]interface{}{
		"pipeline_id":          pipelineBusinessID,
		"repository":           repoURL,
		"branch":               plan.Branch,
		"username":             plan.Username,
		"password":             plan.Password,
		"code_checker_task_id": plan.CodeCheckerTaskID,
		"languages":            strings.Split(plan.Languages, ","),
		"custom_attributes":    string(mergedBytes),
	}

	_, err = utils.SendHTTPRequest(context.Background(), "PUT", targetURL, payload, utils.HTTPOptions{}, []int{http.StatusOK, http.StatusNoContent}, "SyncUpdatePlan")
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
