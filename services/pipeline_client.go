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
				PipelineName string `json:"pipelineName"`
				ServiceID    string `json:"serviceId"`
				ServiceName  string `json:"serviceName"`
				WorkspaceID  string `json:"workspaceId"`
				OwnerID      string `json:"ownerId"`
				OwnerName    string `json:"owner"`
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
		OwnerID:     res.OwnerID,
		OwnerName:   res.OwnerName,
		ServiceName: res.ServiceName,
	}, nil
}

// FetchRemoteExecutionSchemes 从三方系统获取指定流水线的执行方案原始数据列表
func FetchRemoteExecutionSchemes(ctx context.Context, pipelineBusinessID string, headers map[string]string) ([]models.RemoteExecutionScheme, error) {
	apiURLStr := models.AppConfig.PipelineSystem.GetExecutionSchemeURL
	if apiURLStr == "" {
		return nil, fmt.Errorf("get_execution_scheme_url not configured")
	}

	body, err := utils.SendHTTPRequest(ctx, "GET", apiURLStr, nil, utils.HTTPOptions{
		Headers:     headers,
		QueryParams: map[string]string{"pipelineId": pipelineBusinessID},
	}, []int{http.StatusOK}, "SyncExecutionSchemes")
	if err != nil {
		return nil, err
	}

	var prettyJSON bytes.Buffer
	if err := json.Indent(&prettyJSON, body, "", "  "); err == nil {
		log.Printf("[PipelineClient] SyncExecutionSchemes remote response:\n%s\n", prettyJSON.String())
	} else {
		log.Printf("[PipelineClient] SyncExecutionSchemes remote response: %s\n", string(body))
	}

	var remoteResp struct {
		Entities []models.RemoteExecutionScheme `json:"entities"`
	}

	if err := json.Unmarshal(body, &remoteResp); err != nil {
		log.Printf("[SyncExecutionSchemes] Failed to parse JSON: %v, Body: %s", err, string(body))
		return nil, fmt.Errorf("failed to parse remote response JSON: %v", err)
	}

	return remoteResp.Entities, nil
}

// FetchRemoteExecutionPlans 从三方系统获取指定流水线的执行计划（定时任务）原始数据列表
func FetchRemoteExecutionPlans(ctx context.Context, pipelineBusinessID string, headers map[string]string) ([]models.RemoteExecutionPlan, error) {
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

	var remoteResp struct {
		Entities []models.RemoteExecutionPlan `json:"entities"`
	}

	if err := json.Unmarshal(body, &remoteResp); err != nil {
		log.Printf("[SyncExecutionPlans] Failed to parse JSON: %v, Body: %s", err, string(body))
		return nil, fmt.Errorf("failed to parse remote response JSON: %v", err)
	}

	return remoteResp.Entities, nil
}

// createCheckerTaskStep 步骤一：创建代码检查执行任务
func createCheckerTaskStep(ctx context.Context, repoURL string, branch string, languages string, taskName string, headers map[string]string) (string, error) {
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
		"{NAME}":        taskName,
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

// GetCheckerTaskName 根据任务ID和搜索名称在三方系统查找并获取任务的真实名称
func GetCheckerTaskName(ctx context.Context, searchName string, taskID string, headers map[string]string) (string, error) {
	queryURL := models.AppConfig.PipelineSystem.QueryCheckerTaskURL
	if queryURL == "" {
		return "", fmt.Errorf("query_checker_task_url not configured")
	}

	queryBody, err := utils.SendHTTPRequest(ctx, "GET", queryURL, nil, utils.HTTPOptions{
		Headers: headers,
		QueryParams: map[string]string{
			"search": searchName,
		},
	}, []int{http.StatusOK}, "GetCheckerTaskName")
	if err != nil {
		return "", err
	}

	var queryResp struct {
		Status string `json:"status"`
		Result struct {
			Info []struct {
				ID   string `json:"id"`
				Name string `json:"name"`
			} `json:"info"`
		} `json:"result"`
	}
	if err := json.Unmarshal(queryBody, &queryResp); err != nil {
		return "", err
	}
	if queryResp.Status != "success" {
		return "", fmt.Errorf("failed to query checker task: status is %s", queryResp.Status)
	}

	for _, info := range queryResp.Result.Info {
		if info.ID == taskID {
			return info.Name, nil
		}
	}

	// fallback
	if len(queryResp.Result.Info) > 0 {
		return queryResp.Result.Info[0].Name, nil
	}

	return "", fmt.Errorf("checker task not found with name: %s", searchName)
}

// createExecutionSchemeStep 步骤二：创建执行方案（关联代码检查任务）
func createExecutionSchemeStep(ctx context.Context, pipelineBusinessID string, scheme *models.ExecutionScheme, taskID string, repoURL string, headers map[string]string) (string, error) {
	apiURLStr := models.AppConfig.PipelineSystem.CreateExecutionSchemeURL
	if apiURLStr == "" {
		return "", fmt.Errorf("create_execution_scheme_url not configured")
	}

	tmpl := models.AppConfig.PipelineSystem.CreateExecutionSchemeBody
	if tmpl == "" {
		return "", fmt.Errorf("create_execution_scheme_body not configured")
	}

	schemeName := scheme.Name

	type CustomAttr struct {
		Name  string      `json:"name"`
		Value interface{} `json:"value"`
	}

	var cp struct {
		BuildParameters                 []CustomAttr `json:"buildParameters"`
		GateEnabled                     *bool        `json:"gateEnabled"`
		CoverChildrenPipelineParameters *bool        `json:"coverChildrenPipelineParameters"`
	}

	if scheme.CustomAttributes != "" {
		if err := json.Unmarshal([]byte(scheme.CustomAttributes), &cp); err != nil {
			log.Printf("[SyncCreateScheme] Step 2: Failed to unmarshal custom_attributes: %v", err)
			return "", fmt.Errorf("failed to parse custom_attributes JSON: %w", err)
		}
	}

	gateEnabled := true
	if cp.GateEnabled != nil {
		gateEnabled = *cp.GateEnabled
	}

	coverChildrenPipelineParameters := false
	if cp.CoverChildrenPipelineParameters != nil {
		coverChildrenPipelineParameters = *cp.CoverChildrenPipelineParameters
	}

	customAttrMap := make(map[string]interface{})
	for _, param := range cp.BuildParameters {
		if param.Name != "" {
			customAttrMap[param.Name] = param.Value
		}
	}

	customAttrMap["code_checker_task_id"] = taskID
	customAttrMap["codehubTargetRepoHttpUrl"] = repoURL
	customAttrMap["selectedBranchs"] = scheme.Branch
	customAttrMap["languages"] = scheme.Languages

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

	var finalObj struct {
		BuildParameters                 []CustomAttr `json:"buildParameters"`
		GateEnabled                     bool         `json:"gateEnabled"`
		CoverChildrenPipelineParameters bool         `json:"coverChildrenPipelineParameters"`
	}
	finalObj.BuildParameters = customAttrList
	finalObj.GateEnabled = gateEnabled
	finalObj.CoverChildrenPipelineParameters = coverChildrenPipelineParameters

	mergedBytes, err := json.Marshal(finalObj)
	if err != nil {
		log.Printf("[SyncCreateScheme] Step 2: Failed to marshal merged custom_attributes: %v", err)
		return "", fmt.Errorf("failed to marshal custom_attributes to JSON: %w", err)
	}

	customAttributesJSON, err := json.Marshal(string(mergedBytes))
	if err != nil {
		log.Printf("[SyncCreateScheme] Step 2: Failed to escape custom_attributes: %v", err)
		return "", fmt.Errorf("failed to escape custom_attributes to JSON: %w", err)
	}

	escapedCustomAttributes := string(customAttributesJSON)
	if len(escapedCustomAttributes) >= 2 && escapedCustomAttributes[0] == '"' && escapedCustomAttributes[len(escapedCustomAttributes)-1] == '"' {
		escapedCustomAttributes = escapedCustomAttributes[1 : len(escapedCustomAttributes)-1]
	}

	empID, _ := ctx.Value("employeeID").(string)
	formattedEmpID := utils.FormatEmployeeID(empID)
	if formattedEmpID == "" {
		formattedEmpID = "system"
	}

	bodyStr := utils.ReplacePlaceholders(tmpl, map[string]string{
		"{SCHEME_NAME}":       schemeName,
		"{NAME}":              schemeName,
		"{PIPELINE_ID}":       pipelineBusinessID,
		"{USER_EMAIL}":        formattedEmpID,
		"{CUSTOM_ATTRIBUTES}": escapedCustomAttributes,
	})

	postData := json.RawMessage(bodyStr)

	log.Printf("[SyncCreateScheme] Step 2: Creating Execution Scheme. URL: %s, Body: %s", apiURLStr, bodyStr)

	body, err := utils.SendHTTPRequest(ctx, "POST", apiURLStr, postData, utils.HTTPOptions{
		Headers: headers,
	}, []int{http.StatusOK, http.StatusCreated}, "CreateExecutionSchemeStep")
	if err != nil {
		return "", err
	}

	var createResp struct {
		Result  string `json:"result"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(body, &createResp); err != nil {
		log.Printf("[SyncCreateScheme] Step 2: Failed to parse create response: %v, Body: %s", err, string(body))
		return "", fmt.Errorf("failed to parse create execution scheme response: %w", err)
	}

	if createResp.Result != "success" {
		log.Printf("[SyncCreateScheme] Step 2: Create response result is not success: %s, Message: %s", createResp.Result, createResp.Message)
		return "", fmt.Errorf("failed to create execution scheme: status %s, message %s", createResp.Result, createResp.Message)
	}

	log.Printf("[SyncCreateScheme] Step 2: Create success. Fetching scheme ID for name: %s", schemeName)

	var extID string
	for retry := 0; retry < 3; retry++ {
		if retry > 0 {
			time.Sleep(500 * time.Millisecond)
		}

		entities, err := FetchRemoteExecutionSchemes(ctx, pipelineBusinessID, headers)
		if err != nil {
			log.Printf("[SyncCreateScheme] Step 2: Failed to fetch remote execution schemes (retry %d): %v", retry, err)
			continue
		}

		for _, entity := range entities {
			if entity.Name == schemeName {
				extID = entity.ID
				break
			}
		}

		if extID != "" {
			break
		}
	}

	if extID == "" {
		log.Printf("[SyncCreateScheme] Step 2: Failed to retrieve scheme ID by name %s after retries", schemeName)
		return "", fmt.Errorf("failed to retrieve scheme ID by name %s", schemeName)
	}

	return extID, nil
}

// createMRBindingStep 步骤三：创建 MR 触发关联
func createMRBindingStep(ctx context.Context, pipelineBusinessID string, scheme *models.ExecutionScheme, schemeID string, repoURL string, headers map[string]string) (string, error) {
	log.Printf("[SyncCreateScheme] Enter createMRBindingStep: pipelineBusinessID=%s, scheme=%+v, schemeID=%s, repoURL=%s, headers=%v", pipelineBusinessID, scheme, schemeID, repoURL, headers)
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
		log.Printf("[SyncCreateScheme] Step 3: Failed to check repo authorized: %v", err)
		return "", fmt.Errorf("failed to check repo authorized: %w", err)
	}

	customAttributesJSON, err := json.Marshal(scheme.CustomAttributes)
	if err != nil {
		log.Printf("[SyncCreateScheme] Step 3: Failed to escape custom_attributes: %v", err)
		return "", fmt.Errorf("failed to escape custom_attributes to JSON: %w", err)
	}

	escapedCustomAttributes := string(customAttributesJSON)
	if len(escapedCustomAttributes) >= 2 && escapedCustomAttributes[0] == '"' && escapedCustomAttributes[len(escapedCustomAttributes)-1] == '"' {
		escapedCustomAttributes = escapedCustomAttributes[1 : len(escapedCustomAttributes)-1]
	}

	bodyStr := utils.ReplacePlaceholders(tmpl, map[string]string{
		"{NAME}":              scheme.Name,
		"{REPO_URL}":          repoURL,
		"{BRANCHES}":          scheme.Branch,
		"{PIPELINE_ID}":       pipelineBusinessID,
		"{SCHEME_ID}":         schemeID,
		"{CREDENTIAL_ID}":     credentialID,
		"{CUSTOM_ATTRIBUTES}": escapedCustomAttributes,
	})

	postData := json.RawMessage(bodyStr)

	log.Printf("[SyncCreateScheme] Step 3: Creating MR Binding. URL: %s, Body: %s", apiURLStr, bodyStr)

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
		return "", fmt.Errorf("failed to fetch created mr binding ID, response: %s", string(body))
	}

	return mrBindingID, nil
}

// createExecutionPlanStep 步骤四：创建每日构建的执行计划
func createExecutionPlanStep(ctx context.Context, pipelineBusinessID string, scheme *models.ExecutionScheme, schemeID string, headers map[string]string) (string, error) {
	log.Printf("[SyncCreateScheme] Enter createExecutionPlanStep: pipelineBusinessID=%s, scheme=%+v, schemeID=%s, headers=%v", pipelineBusinessID, scheme, schemeID, headers)
	apiURLStr := models.AppConfig.PipelineSystem.CreateExecutionPlanURL
	if apiURLStr == "" {
		return "", fmt.Errorf("create_execution_plan_url not configured")
	}

	tmpl := models.AppConfig.PipelineSystem.CreateExecutionPlanBody
	if tmpl == "" {
		return "", fmt.Errorf("create_execution_plan_body not configured")
	}

	var pipeline models.Pipeline
	if database.DB == nil {
		return "", fmt.Errorf("database connection is nil")
	}
	if err := database.DB.First(&pipeline, scheme.LocalPipelineID).Error; err != nil {
		return "", fmt.Errorf("failed to fetch pipeline with ID %d: %w", scheme.LocalPipelineID, err)
	}

	bodyStr := utils.ReplacePlaceholders(tmpl, map[string]string{
		"{NAME}":             scheme.Name,
		"{PIPELINE_ID}":      pipelineBusinessID,
		"{SCHEME_ID}":        schemeID,
		"{DAILY_BUILD_TIME}": scheme.DailyBuildTime,
		"{PIPELINE_NAME}":    pipeline.Name,
		"{SERVICE_ID}":       pipeline.ServiceID,
		"{WORKSPACE_ID}":     pipeline.WorkspaceID,
	})

	postData := json.RawMessage(bodyStr)

	log.Printf("[SyncCreateScheme] Step 4: Creating Execution Plan. URL: %s, Body: %s", apiURLStr, bodyStr)

	body, err := utils.SendHTTPRequest(ctx, "POST", apiURLStr, postData, utils.HTTPOptions{
		Headers: headers,
	}, []int{http.StatusOK, http.StatusCreated}, "CreateExecutionPlanStep")
	if err != nil {
		return "", err
	}

	var createResp struct {
		Result string `json:"result"`
	}
	if err := json.Unmarshal(body, &createResp); err != nil {
		return "", fmt.Errorf("failed to parse create execution plan response JSON: %w, response: %s", err, string(body))
	}
	if createResp.Result != "success" {
		return "", fmt.Errorf("create execution plan failed: expected result='success', got result='%s', response: %s", createResp.Result, string(body))
	}

	// 创建成功后，通过查询和名字匹配，获得刚刚创建的 PlanID
	var executionPlanID string
	for retry := 0; retry < 3; retry++ {
		if retry > 0 {
			time.Sleep(500 * time.Millisecond)
		}

		entities, err := FetchRemoteExecutionPlans(ctx, pipelineBusinessID, headers)
		if err != nil {
			log.Printf("[SyncCreateScheme] Step 4: Failed to fetch remote execution plans (retry %d): %v", retry, err)
			continue
		}

		for _, entity := range entities {
			if entity.ScheduleName == scheme.Name {
				executionPlanID = entity.ID
				break
			}
		}

		if executionPlanID != "" {
			break
		}
	}

	if executionPlanID == "" {
		return "", fmt.Errorf("failed to fetch created execution plan ID for name: %s", scheme.Name)
	}

	return executionPlanID, nil
}

// SyncCreateExecutionSchemeRemote 在三方系统中同步创建执行方案（依次执行三个步骤）
func SyncCreateExecutionSchemeRemote(ctx context.Context, pipelineBusinessID string, scheme *models.ExecutionScheme, headers map[string]string) (string, error) {
	log.Printf("[SyncCreateScheme] Start remote sync execution scheme. pipelineBusinessID: %s, RepositoryID: %d", pipelineBusinessID, scheme.RepositoryID)
	var repo models.Repository
	database.DB.First(&repo, scheme.RepositoryID)
	repoURL := repo.HTTPURL
	if repoURL == "" {
		repoURL = repo.URL
	}
	if repoURL == "" && scheme.Repository != nil {
		repoURL = scheme.Repository.HTTPURL
		if repoURL == "" {
			repoURL = scheme.Repository.URL
		}
	}
	if repoURL != "" {
		repoURL = utils.SSHToHTTPS(repoURL)
	}

	// 产生全局唯一且一致的 Name 并回填
	repoName := utils.ExtractRepoName(repoURL)
	randomSuffix := "0000"
	randBytes := make([]byte, 2)
	if _, err := rand.Read(randBytes); err == nil {
		randomSuffix = hex.EncodeToString(randBytes)
	}
	unifiedName := fmt.Sprintf("%s_%s", repoName, randomSuffix)
	unifiedName = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' {
			return r
		}
		return '_'
	}, unifiedName)

	// 确保名字以字母开头
	if len(unifiedName) > 0 {
		firstChar := unifiedName[0]
		if !((firstChar >= 'a' && firstChar <= 'z') || (firstChar >= 'A' && firstChar <= 'Z')) {
			unifiedName = "s_" + unifiedName
		}
	}
	scheme.Name = unifiedName

	// 1. 获取或创建代码检查执行任务
	var taskID string
	var taskName string
	if repo.CodeCheckerTaskID != "" {
		taskID = repo.CodeCheckerTaskID
		taskName = repo.CodeCheckerTaskName
		log.Printf("[SyncCreateScheme] Reusing existing code checker task ID: %s, Name: %s for repo ID: %d", taskID, taskName, repo.ID)
	} else {
		createdTaskID, err := createCheckerTaskStep(ctx, repoURL, scheme.Branch, scheme.Languages, scheme.Name, headers)
		if err != nil {
			log.Printf("[Pipeline] Remote sync Step 1 failed: %v\n", err)
			return "", err
		}
		taskID = createdTaskID
		taskName = scheme.Name

		// 立即将任务 ID 持久化回 Repository
		repo.CodeCheckerTaskID = taskID
		repo.CodeCheckerTaskName = taskName
		if err := database.DB.Model(&repo).Updates(map[string]interface{}{
			"code_checker_task_id":   taskID,
			"code_checker_task_name": taskName,
		}).Error; err != nil {
			log.Printf("[Pipeline] Warning: failed to save CodeCheckerTaskID to Repository %d: %v\n", repo.ID, err)
		}
	}
	scheme.CodeCheckerTaskID = taskID
	scheme.CodeCheckerTaskName = taskName

	// 2. 创建执行方案（并关联代码检查任务）
	extID, err := createExecutionSchemeStep(ctx, pipelineBusinessID, scheme, taskID, repoURL, headers)
	if err != nil {
		log.Printf("[Pipeline] Remote sync Step 2 failed: %v\n", err)
		SyncDeleteExecutionSchemeRemote(*scheme, headers)
		return "", err
	}
	scheme.ExecutionSchemeID = extID
	scheme.ExecutionSchemeName = scheme.Name

	// 3. 创建 MR 触发关联（关联该方案）
	if scheme.MRTrigger {
		mrBindingID, err := createMRBindingStep(ctx, pipelineBusinessID, scheme, extID, repoURL, headers)
		if err != nil {
			log.Printf("[Pipeline] Remote sync Step 3 failed: %v\n", err)
			SyncDeleteExecutionSchemeRemote(*scheme, headers)
			return "", err
		}
		scheme.MRBindingID = mrBindingID
		scheme.MRBindingName = scheme.Name
	}

	// 4. 创建每日构建的执行计划
	if scheme.DailyBuild {
		planID, err := createExecutionPlanStep(ctx, pipelineBusinessID, scheme, extID, headers)
		if err != nil {
			log.Printf("[Pipeline] Remote sync Step 4 failed: %v\n", err)
			SyncDeleteExecutionSchemeRemote(*scheme, headers)
			return "", err
		}
		scheme.ExecutionPlanID = planID
		scheme.ExecutionPlanName = scheme.Name
	}

	return extID, nil
}

// SyncDeleteExecutionSchemeRemote 在三方系统中删除执行方案及其关联的所有对象（方案、计划、MR触发、检查任务）
func SyncDeleteExecutionSchemeRemote(scheme models.ExecutionScheme, headers map[string]string) error {
	// 1. 删除执行计划（每日构建）
	if scheme.ExecutionPlanID != "" {
		apiURLStr := models.AppConfig.PipelineSystem.GetExecutionPlanURL
		if apiURLStr != "" {
			deleteURL := apiURLStr
			if strings.HasSuffix(deleteURL, "/get") {
				deleteURL = deleteURL[:len(deleteURL)-3] + "delete"
			}
			_, err := utils.SendHTTPRequest(context.Background(), "DELETE", deleteURL, nil, utils.HTTPOptions{
				Headers: headers,
				QueryParams: map[string]string{
					"scheduleId": scheme.ExecutionPlanID,
				},
			}, []int{http.StatusOK, http.StatusNoContent, http.StatusAccepted}, "SyncDeleteExecutionPlan")
			if err != nil {
				log.Printf("[SyncDelete] Failed to delete execution plan %s: %v\n", scheme.ExecutionPlanID, err)
			}
		}
	}

	// 2. 删除 MR 触发
	if scheme.MRBindingID != "" {
		apiURLStr := models.AppConfig.PipelineSystem.GetMRBindingsURL
		if apiURLStr != "" {
			deleteURL := strings.TrimSuffix(apiURLStr, "/") + "/delete"

			var pipeline models.Pipeline
			var pipelineBusinessID string
			if err := database.DB.First(&pipeline, scheme.LocalPipelineID).Error; err == nil {
				pipelineBusinessID = pipeline.PipelineID
			}

			_, err := utils.SendHTTPRequest(context.Background(), "DELETE", deleteURL, nil, utils.HTTPOptions{
				Headers: headers,
				QueryParams: map[string]string{
					"pipelineId": pipelineBusinessID,
					"configId":   scheme.MRBindingID,
					"isSingle":   "true",
				},
			}, []int{http.StatusOK, http.StatusNoContent, http.StatusAccepted}, "SyncDeleteMRBinding")
			if err != nil {
				log.Printf("[SyncDelete] Failed to delete mr binding %s: %v\n", scheme.MRBindingID, err)
			}
		}
	}

	// 3. 不再在此处删除代码检查任务，使其能够被其他方案复用或保留

	// 4. 删除执行方案
	if scheme.ExecutionSchemeID != "" {
		apiURLStr := models.AppConfig.PipelineSystem.GetExecutionSchemeURL
		if apiURLStr != "" {
			deleteURL := apiURLStr
			if strings.HasSuffix(deleteURL, "/get") {
				deleteURL = deleteURL[:len(deleteURL)-3] + "delete"
			}
			_, err := utils.SendHTTPRequest(context.Background(), "DELETE", deleteURL, nil, utils.HTTPOptions{
				Headers: headers,
				QueryParams: map[string]string{
					"id": scheme.ExecutionSchemeID,
				},
			}, []int{http.StatusOK, http.StatusNoContent, http.StatusAccepted}, "SyncDeleteScheme")
			if err != nil {
				log.Printf("[SyncDelete] Failed to delete execution scheme %s: %v\n", scheme.ExecutionSchemeID, err)
			}
		}
	}

	return nil
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

// SyncRunExecutionSchemeRemote 在三方系统中触发运行指定的执行方案
func SyncRunExecutionSchemeRemote(scheme models.ExecutionScheme, headers map[string]string) (string, error) {
	apiURLStr := models.AppConfig.PipelineSystem.RunExecutionSchemeURL
	if apiURLStr == "" {
		return "", fmt.Errorf("run_execution_scheme_url not configured")
	}

	var pipeline models.Pipeline
	var pipelineBusinessID string
	if err := database.DB.First(&pipeline, scheme.LocalPipelineID).Error; err == nil {
		pipelineBusinessID = pipeline.PipelineID
	}

	payload := map[string]interface{}{
		"pipelineId": pipelineBusinessID,
		"schemeIds":  []string{scheme.ExecutionSchemeID},
	}

	body, err := utils.SendHTTPRequest(context.Background(), "POST", apiURLStr, payload, utils.HTTPOptions{
		Headers: headers,
	}, []int{http.StatusOK, http.StatusAccepted, http.StatusNoContent}, "SyncRunScheme")
	if err != nil {
		return "", err
	}

	if len(body) > 0 {
		var responseData struct {
			Result   string `json:"result"`
			Message  string `json:"message"`
			Entities []struct {
				JobID string `json:"jobId"`
			} `json:"entities"`
		}
		if err := json.Unmarshal(body, &responseData); err == nil {
			if responseData.Result == "failed" {
				return "", fmt.Errorf("%s", responseData.Message)
			}
			if len(responseData.Entities) > 0 {
				return responseData.Entities[0].JobID, nil
			}
		} else {
			log.Printf("[SyncRunScheme] Failed to parse response JSON: %v, Body: %s", err, string(body))
		}
	}

	return "", nil
}

// CheckWebhookRegistered 调用代码托管平台 API 检查指定仓库是否已注册指向 code-pipeline 的 Webhook
func CheckWebhookRegistered(ctx context.Context, projectID string, headers map[string]string) (bool, error) {
	apiURLStr := models.AppConfig.PipelineSystem.GetWebhooksURL
	if apiURLStr == "" {
		return false, fmt.Errorf("get_webhooks_url not configured")
	}

	// 替换 URL 中可能包含 of {REPO_ID} 或 {PROJECT_ID} 占位符
	apiURLStr = strings.ReplaceAll(apiURLStr, "{REPO_ID}", projectID)
	apiURLStr = strings.ReplaceAll(apiURLStr, "{PROJECT_ID}", projectID)

	callbackURL := models.AppConfig.PipelineSystem.WebhookCallbackURL

	body, err := utils.SendHTTPRequest(ctx, "GET", apiURLStr, nil, utils.HTTPOptions{
		Headers: headers,
	}, []int{http.StatusOK}, "CheckWebhookRegistered")
	if err != nil {
		return false, err
	}

	var responseData []struct {
		URL string `json:"url"`
	}
	if err := json.Unmarshal(body, &responseData); err != nil {
		return false, fmt.Errorf("failed to parse webhook query response: %v", err)
	}

	for _, entity := range responseData {
		if strings.Contains(entity.URL, callbackURL) {
			return true, nil
		}
	}

	return false, nil
}

// RegisterWebhook 调用代码托管平台 API 为指定仓库注册 Webhook
func RegisterWebhook(ctx context.Context, projectID string, headers map[string]string) error {
	apiURLStr := models.AppConfig.PipelineSystem.CreateWebhookURL
	if apiURLStr == "" {
		return fmt.Errorf("create_webhook_url not configured")
	}

	// 替换 URL 中可能包含 of {REPO_ID} 或 {PROJECT_ID} 占位符
	apiURLStr = strings.ReplaceAll(apiURLStr, "{REPO_ID}", projectID)
	apiURLStr = strings.ReplaceAll(apiURLStr, "{PROJECT_ID}", projectID)

	callbackURL := models.AppConfig.PipelineSystem.WebhookCallbackURL

	tmpl := models.AppConfig.PipelineSystem.CreateWebhookBody
	bodyStr := utils.ReplacePlaceholders(tmpl, map[string]string{
		"{WEBHOOK_URL}": callbackURL,
		"{PROJECT_ID}":  projectID,
		"{REPO_ID}":     projectID,
	})
	postData := json.RawMessage(bodyStr)

	_, err := utils.SendHTTPRequest(ctx, "POST", apiURLStr, postData, utils.HTTPOptions{
		Headers: headers,
	}, []int{http.StatusOK, http.StatusCreated}, "RegisterWebhook")
	if err != nil {
		return err
	}

	// 注册 Webhook 的时候，还需要调用代码仓设置
	if err := UpdateRepoSettings(ctx, projectID, headers); err != nil {
		return err
	}

	return nil
}

// UpdateRepoSettings 调用代码托管平台 API 修改代码仓设置
func UpdateRepoSettings(ctx context.Context, projectID string, headers map[string]string) error {
	apiURLStr := models.AppConfig.PipelineSystem.UpdateRepoSettingsURL
	if apiURLStr == "" {
		return fmt.Errorf("update_repo_settings_url not configured")
	}

	// 替换 URL 中可能包含的 {REPO_ID} 或 {PROJECT_ID} 占位符
	apiURLStr = strings.ReplaceAll(apiURLStr, "{REPO_ID}", projectID)
	apiURLStr = strings.ReplaceAll(apiURLStr, "{PROJECT_ID}", projectID)

	tmpl := models.AppConfig.PipelineSystem.UpdateRepoSettingsBody
	bodyStr := utils.ReplacePlaceholders(tmpl, map[string]string{
		"{PROJECT_ID}": projectID,
		"{REPO_ID}":    projectID,
	})
	putData := json.RawMessage(bodyStr)

	_, err := utils.SendHTTPRequest(ctx, "PUT", apiURLStr, putData, utils.HTTPOptions{
		Headers: headers,
	}, []int{http.StatusOK, http.StatusAccepted, http.StatusNoContent}, "UpdateRepoSettings")
	if err != nil {
		return err
	}

	return nil
}
