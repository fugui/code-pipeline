package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strings"
	"time"

	commonAuth "code-common/backend/auth"
	"code-pipeline/database"
	"code-pipeline/models"
	"code-pipeline/utils"
)

// ResolveOperatorIdentifier 解析当前操作者的工号/身份标识：
// 1. 优先从 Context ("employeeID" 或 auth.ContextEmployeeID) 获取
// 2. 若 Context 中工号为空，尝试通过 Context 中的 UserID / Email / Username 从数据库 users 表查询
// 3. 若用户数据库中无 EmployeeID，则回退为 Username 或 Email 前缀
// 4. 对工号进行 FormatEmployeeID 格式化
// 5. 若上述全为空，最后回退为 "system"
func ResolveOperatorIdentifier(ctx context.Context) string {
	if ctx == nil {
		return "system"
	}

	var rawEmpID string
	// 1. 尝试从 Context 读取工号
	if v, ok := ctx.Value("employeeID").(string); ok && strings.TrimSpace(v) != "" {
		rawEmpID = strings.TrimSpace(v)
	} else if v, ok := ctx.Value(commonAuth.ContextEmployeeID).(string); ok && strings.TrimSpace(v) != "" {
		rawEmpID = strings.TrimSpace(v)
	}

	// 2. 若 Context 中工号为空，尝试从数据库回源查询
	if rawEmpID == "" && database.DB != nil {
		var uid uint
		if idVal, ok := ctx.Value("userID").(uint); ok && idVal > 0 {
			uid = idVal
		} else if idVal, ok := ctx.Value(commonAuth.ContextUserID).(uint); ok && idVal > 0 {
			uid = idVal
		}

		var email string
		if eVal, ok := ctx.Value("email").(string); ok && strings.TrimSpace(eVal) != "" {
			email = strings.TrimSpace(eVal)
		} else if eVal, ok := ctx.Value(commonAuth.ContextEmail).(string); ok && strings.TrimSpace(eVal) != "" {
			email = strings.TrimSpace(eVal)
		}

		var username string
		if uVal, ok := ctx.Value("username").(string); ok && strings.TrimSpace(uVal) != "" {
			username = strings.TrimSpace(uVal)
		} else if uVal, ok := ctx.Value(commonAuth.ContextUsername).(string); ok && strings.TrimSpace(uVal) != "" {
			username = strings.TrimSpace(uVal)
		}

		if uid > 0 || email != "" || username != "" {
			var user models.User
			query := database.DB.Select("id", "employee_id", "email", "username", "name")
			if uid > 0 {
				query = query.Where("id = ?", uid)
			} else if email != "" {
				query = query.Where("LOWER(email) = LOWER(?)", email)
			} else if username != "" {
				query = query.Where("LOWER(username) = LOWER(?)", username)
			}

			if err := query.First(&user).Error; err == nil {
				if strings.TrimSpace(user.EmployeeID) != "" {
					rawEmpID = strings.TrimSpace(user.EmployeeID)
				} else if strings.TrimSpace(user.Username) != "" {
					rawEmpID = strings.TrimSpace(user.Username)
				} else if strings.TrimSpace(user.Email) != "" {
					rawEmpID = strings.Split(strings.TrimSpace(user.Email), "@")[0]
				}
			}
		}
	}

	// 3. 若数据库中仍未查到，尝试从 Context 携带的 email/username 兜底
	if rawEmpID == "" {
		if uVal, ok := ctx.Value("username").(string); ok && strings.TrimSpace(uVal) != "" {
			rawEmpID = strings.TrimSpace(uVal)
		} else if eVal, ok := ctx.Value("email").(string); ok && strings.TrimSpace(eVal) != "" {
			rawEmpID = strings.Split(strings.TrimSpace(eVal), "@")[0]
		}
	}

	// 4. 执行工号统一格式化
	formatted := utils.FormatEmployeeID(rawEmpID)
	if formatted == "" {
		return "system"
	}
	return formatted
}

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

// buildCheckerTaskPayloadMap 渲染代码检查任务的基础 Body Payload Map
func buildCheckerTaskPayloadMap(repoURL string, branch string, languages string, taskName string) (map[string]interface{}, error) {
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
		for _, l := range strings.Split(languages, ",") {
			trimmed := strings.TrimSpace(l)
			if trimmed != "" {
				langs = append(langs, trimmed)
			}
		}
	}

	langsJSON, err := json.Marshal(langs)
	if err != nil {
		langsJSON = []byte("[]")
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
		log.Printf("[buildCheckerTaskPayloadMap] Failed to marshal ruleSets: %v", err)
		return nil, fmt.Errorf("failed to marshal ruleSets to JSON: %w", err)
	}

	tmpl := models.AppConfig.PipelineSystem.CreateCheckerTaskBody
	if tmpl == "" {
		return nil, fmt.Errorf("create_checker_task_body not configured")
	}

	finalTaskName := strings.TrimSpace(taskName)
	if finalTaskName == "" {
		finalTaskName = utils.ExtractRepoName(repoURL)
	}
	if finalTaskName == "" {
		finalTaskName = "checker_task"
	}

	payloadObj, err := utils.RenderJSONTemplate(tmpl, map[string]string{
		"REPO_URL":          repoURL,
		"REPO_BRANCH":       firstBranch,
		"TASK_NAME":         finalTaskName,
		"NAME":              finalTaskName,
		"TASKNAME":          finalTaskName,
		"CHECKER_TASK_NAME": finalTaskName,
		"RULE_SETS":         string(ruleSetsJSON),
		"LANGUAGES":         string(langsJSON),
		"TEMPLATE_ID":       "",
	})
	if err != nil {
		return nil, fmt.Errorf("failed to render create_checker_task_body template: %w", err)
	}

	// RenderJSONTemplate 已返回解析后的 JSON 值，直接断言为对象根即可。
	// 不再做 marshal→unmarshal 往返：array-root/标量根模板应显式报错，
	// 避免静默退化成空 map 上送，导致创建空任务或覆盖远程任务配置。
	resultMap, ok := payloadObj.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("create_checker_task_body template root must be a JSON object, got %T", payloadObj)
	}

	return resultMap, nil
}

// createCheckerTaskStep 步骤一：创建代码检查执行任务
func createCheckerTaskStep(ctx context.Context, repoURL string, branch string, languages string, taskName string, headers map[string]string) (string, error) {
	apiURL := models.AppConfig.PipelineSystem.CreateCheckerTaskURL
	if apiURL == "" {
		return "", fmt.Errorf("create_checker_task_url not configured")
	}

	payloadMap, err := buildCheckerTaskPayloadMap(repoURL, branch, languages, taskName)
	if err != nil {
		return "", err
	}

	log.Printf("[SyncCreatePlan] Step 1: Creating Checker Task. URL: %s", apiURL)

	body, err := utils.SendHTTPRequest(ctx, "POST", apiURL, payloadMap, utils.HTTPOptions{
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
	if statusResp.Status != "" && !strings.EqualFold(statusResp.Status, "success") && !strings.EqualFold(statusResp.Status, "ok") {
		return "", fmt.Errorf("failed to create checker task: status is %s, message: %s", statusResp.Status, statusResp.Message)
	}

	infos, err := QueryCheckerTaskInfo(ctx, taskName, headers)
	if err != nil {
		return "", err
	}
	if len(infos) == 0 {
		return "", fmt.Errorf("no checker task found with name %s", taskName)
	}

	taskID := infos[0].ID
	if taskID == "" {
		return "", fmt.Errorf("checker task ID is empty for task name %s", taskName)
	}

	return taskID, nil
}

// SyncUpdateCheckerTaskRemote 在三方系统中修改/更新代码检查任务（PUT 方法）。
// 返回本次实际使用（或回退新建）的远程任务 ID，供调用方回写本地 DB，自愈失配的缓存 ID。
func SyncUpdateCheckerTaskRemote(ctx context.Context, taskID string, taskName string, repoURL string, branch string, languages string, headers map[string]string) (string, error) {
	apiURL := models.AppConfig.PipelineSystem.CreateCheckerTaskURL
	if apiURL == "" {
		return "", fmt.Errorf("create_checker_task_url not configured")
	}

	// 1. 事前查询，获取已存在的 taskID 和 configTemplateId
	infos, err := QueryCheckerTaskInfo(ctx, taskName, headers)
	if err != nil {
		return "", fmt.Errorf("failed to query existing checker task info for update: %w", err)
	}

	// 远程未查询到对应 Task 时：
	// - 本地无缓存 taskID（如历史方案从未创建过检查任务）→ 回退 POST 新建并返回新 ID；
	// - 本地已有缓存 taskID 但按名称查不到 → 任务可能已被改名/删除，此时回退新建会
	//   制造重复任务，宁可失败告警等待人工处理。
	if len(infos) == 0 {
		if taskID != "" {
			return "", fmt.Errorf("remote query returned no checker task for name %q while local DB has cached task ID %q (task may have been renamed or deleted remotely); abort to avoid creating a duplicate task", taskName, taskID)
		}
		log.Printf("[SyncUpdateCheckerTask] Remote checker task %q not found, falling back to create dynamic task", taskName)
		createdID, createErr := createCheckerTaskStep(ctx, repoURL, branch, languages, taskName, headers)
		if createErr != nil {
			return "", fmt.Errorf("checker task not found remotely and fallback creation failed: %w", createErr)
		}
		return createdID, nil
	}

	// 匹配策略：
	// 1. DB 保存的 taskID 精确匹配（最高优先级）；
	// 2. 名称精确匹配——若 DB taskID 失配，说明远程任务可能被删除重建（同名新 ID），
	//    按名称继续更新属于有意的 upsert 续接，并返回实际 ID 供调用方回写；
	// 3. 仅当查询结果唯一且 ID/名称均未匹配时降级取第一项；
	//    多条结果且 ID/名称均未精确匹配时中止，避免模糊搜索误更新无关任务。
	var targetInfo *models.CheckerTaskInfo
	if taskID != "" {
		for i := range infos {
			if infos[i].ID == taskID {
				targetInfo = &infos[i]
				break
			}
		}
	}
	if targetInfo == nil && taskName != "" {
		for i := range infos {
			if infos[i].Name == taskName {
				targetInfo = &infos[i]
				break
			}
		}
	}
	if targetInfo == nil {
		if len(infos) == 1 {
			targetInfo = &infos[0]
		} else {
			return "", fmt.Errorf("remote query returned %d checker tasks but none exactly matches taskID %q / taskName %q, abort update to avoid modifying an unrelated task", len(infos), taskID, taskName)
		}
	}

	// 校验 ID 是否非空
	if targetInfo.ID == "" {
		return "", fmt.Errorf("checker task ID is empty for task name %s, cannot execute update", taskName)
	}

	usedTaskID := targetInfo.ID
	if taskID != "" && usedTaskID != taskID {
		log.Printf("[SyncUpdateCheckerTask] Warning: DB saved task ID (%s) differs from remote task ID (%s), continuing with name-matched task (remote task may have been deleted and recreated)", taskID, usedTaskID)
	}

	// 2. 渲染基础 Payload 结构
	payloadMap, err := buildCheckerTaskPayloadMap(repoURL, branch, languages, taskName)
	if err != nil {
		return "", err
	}

	// 3. 修饰修改专用的 JSON 节点：
	// 3.1 根对象增加 id
	payloadMap["id"] = targetInfo.ID

	// 3.2 替换/设置 configTemplateId 及其子对象 id
	if targetInfo.ConfigTemplateID != "" {
		payloadMap["configTemplateId"] = targetInfo.ConfigTemplateID

		var cfgTmpl map[string]interface{}
		if existingCfg, ok := payloadMap["configTemplate"].(map[string]interface{}); ok && existingCfg != nil {
			cfgTmpl = existingCfg
		} else {
			cfgTmpl = make(map[string]interface{})
		}
		cfgTmpl["id"] = targetInfo.ConfigTemplateID
		payloadMap["configTemplate"] = cfgTmpl
	}

	log.Printf("[SyncUpdateCheckerTask] Updating Checker Task (PUT). URL: %s, TaskID: %s, ConfigTemplateID: %s", apiURL, targetInfo.ID, targetInfo.ConfigTemplateID)

	body, err := utils.SendHTTPRequest(ctx, "PUT", apiURL, payloadMap, utils.HTTPOptions{
		Headers: headers,
	}, []int{http.StatusOK, http.StatusCreated, http.StatusNoContent}, "SyncUpdateCheckerTaskRemote")
	if err != nil {
		return "", fmt.Errorf("failed to update remote checker task: %w", err)
	}

	// 防止 Response 校验静默失败：非空 Body 强制严格解析，大小写不敏感判断 status
	if len(body) > 0 {
		var statusResp struct {
			Status  string `json:"status"`
			Message string `json:"result"`
		}
		if err := json.Unmarshal(body, &statusResp); err != nil {
			log.Printf("[SyncUpdateCheckerTask] Failed to parse response status: %v, Body: %s", err, string(body))
			return "", fmt.Errorf("failed to parse checker task status response JSON: %w", err)
		}
		if statusResp.Status != "" && !strings.EqualFold(statusResp.Status, "success") && !strings.EqualFold(statusResp.Status, "ok") {
			return "", fmt.Errorf("failed to update checker task: status is %s, message: %s", statusResp.Status, statusResp.Message)
		}
	}

	return usedTaskID, nil
}

// QueryCheckerTaskInfo 根据任务名称在三方系统查询代码检查任务信息列表
func QueryCheckerTaskInfo(ctx context.Context, taskName string, headers map[string]string) ([]models.CheckerTaskInfo, error) {
	queryURL := models.AppConfig.PipelineSystem.QueryCheckerTaskURL
	if queryURL == "" {
		return nil, fmt.Errorf("query_checker_task_url not configured")
	}

	queryBody, err := utils.SendHTTPRequest(ctx, "GET", queryURL, nil, utils.HTTPOptions{
		Headers: headers,
		QueryParams: map[string]string{
			"search": taskName,
		},
	}, []int{http.StatusOK}, "QueryCheckerTaskInfo")
	if err != nil {
		return nil, fmt.Errorf("failed to query checker task ID by name: %w", err)
	}

	var queryResp struct {
		Status string `json:"status"`
		Result struct {
			Info []models.CheckerTaskInfo `json:"info"`
		} `json:"result"`
	}
	if err := json.Unmarshal(queryBody, &queryResp); err != nil {
		log.Printf("[QueryCheckerTaskInfo] Failed to parse query response: %v, Body: %s", err, string(queryBody))
		return nil, fmt.Errorf("failed to parse query checker task response JSON: %w", err)
	}
	if queryResp.Status != "success" {
		return nil, fmt.Errorf("failed to query checker task: status is %s", queryResp.Status)
	}

	return queryResp.Result.Info, nil
}

// GetCheckerTaskName 根据任务ID和搜索名称在三方系统查找并获取任务的真实名称
func GetCheckerTaskName(ctx context.Context, searchName string, taskID string, headers map[string]string) (string, error) {
	infos, err := QueryCheckerTaskInfo(ctx, searchName, headers)
	if err != nil {
		return "", err
	}

	for _, info := range infos {
		if info.ID == taskID {
			return info.Name, nil
		}
	}

	// fallback
	if len(infos) > 0 {
		return infos[0].Name, nil
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

	formattedEmpID := ResolveOperatorIdentifier(ctx)

	payload, err := utils.RenderJSONTemplate(tmpl, map[string]string{
		"SCHEME_NAME":       schemeName,
		"NAME":              schemeName,
		"PIPELINE_ID":       pipelineBusinessID,
		"USER_EMAIL":        formattedEmpID,
		"CUSTOM_ATTRIBUTES": escapedCustomAttributes,
	})
	if err != nil {
		return "", fmt.Errorf("failed to render create_execution_scheme_body template: %w", err)
	}

	log.Printf("[SyncCreateScheme] Step 2: Creating Execution Scheme. URL: %s", apiURLStr)

	body, err := utils.SendHTTPRequest(ctx, "POST", apiURLStr, payload, utils.HTTPOptions{
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

// CreateMRBindingStep 步骤三：创建 MR 触发关联
func CreateMRBindingStep(ctx context.Context, pipelineBusinessID string, scheme *models.ExecutionScheme, schemeID string, repoURL string, headers map[string]string) (string, error) {
	log.Printf("[SyncCreateScheme] Enter createMRBindingStep: pipelineBusinessID=%s, scheme=%+v, schemeID=%s, repoURL=%s, headers=%v", pipelineBusinessID, scheme, schemeID, repoURL, headers)

	if models.AppConfig.PipelineSystem.EnableAPIGAuth {
		log.Println("[SyncCreateScheme] Using APIG Token Authentication for createMRBindingStep")
		return CreateMRBindingAPIG(ctx, pipelineBusinessID, scheme, schemeID, repoURL, headers)
	}

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

	branchFuzzy := "false"
	if strings.ContainsAny(scheme.Branch, "*?") {
		branchFuzzy = "true"
	}

	mrPayload, err := utils.RenderJSONTemplate(tmpl, map[string]string{
		"NAME":              scheme.Name,
		"REPO_URL":          repoURL,
		"BRANCHES":          scheme.Branch,
		"BRANCH_FUZZY":      branchFuzzy,
		"PIPELINE_ID":       pipelineBusinessID,
		"SCHEME_ID":         schemeID,
		"CREDENTIAL_ID":     credentialID,
		"CUSTOM_ATTRIBUTES": escapedCustomAttributes,
	})
	if err != nil {
		return "", fmt.Errorf("failed to render create_mr_binding_body template: %w", err)
	}

	log.Printf("[SyncCreateScheme] Step 3: Creating MR Binding. URL: %s", apiURLStr)

	body, err := utils.SendHTTPRequest(ctx, "POST", apiURLStr, mrPayload, utils.HTTPOptions{
		Headers: headers,
	}, []int{http.StatusOK, http.StatusCreated, http.StatusNoContent}, "CreateMRBindingStep")
	if err != nil {
		return "", err
	}

	var respStruct struct {
		Status  string `json:"status"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(body, &respStruct); err == nil {
		if respStruct.Status != "" && strings.ToLower(respStruct.Status) != "success" && strings.ToLower(respStruct.Status) != "ok" {
			log.Printf("[SyncCreateScheme] Step 3: Create MR binding failed: status=%s, message=%s", respStruct.Status, respStruct.Message)
			if respStruct.Message != "" {
				return "", fmt.Errorf("create MR binding failed: %s", respStruct.Message)
			}
			return "", fmt.Errorf("create MR binding failed: status %s", respStruct.Status)
		}
	}

	mrBindingID := ParseMRBindingID(body)
	if mrBindingID == "" {
		if respStruct.Message != "" {
			return "", fmt.Errorf("create MR binding failed: %s", respStruct.Message)
		}
		return "", fmt.Errorf("failed to fetch created mr binding ID, response: %s", string(body))
	}

	return mrBindingID, nil
}

// SyncUpdateMRBindingRemote 同步调用三方系统 /modify 接口更新 MR 触发关联的分支及配置
func SyncUpdateMRBindingRemote(ctx context.Context, scheme *models.ExecutionScheme, repoURL string, headers map[string]string) error {
	if scheme == nil {
		return fmt.Errorf("execution scheme is nil")
	}

	var pipeline models.Pipeline
	var pipelineBusinessID string
	if err := database.DB.First(&pipeline, scheme.LocalPipelineID).Error; err == nil {
		pipelineBusinessID = pipeline.PipelineID
	}

	if models.AppConfig.PipelineSystem.EnableAPIGAuth {
		log.Println("[SyncUpdateMRBinding] Using APIG Token Authentication for SyncUpdateMRBindingRemote")
		return SyncUpdateMRBindingRemoteAPIG(ctx, pipelineBusinessID, scheme, repoURL, headers)
	}

	// 优先实时查询三方系统是否存在该 MR 绑定
	existsOnRemote := false
	if pipelineBusinessID != "" {
		remoteBindings, err := FetchRemoteMRBindings(ctx, pipelineBusinessID, headers)
		if err == nil {
			for _, b := range remoteBindings {
				if (scheme.MRBindingID != "" && b.ID == scheme.MRBindingID) || (scheme.ExecutionSchemeID != "" && b.SchemeID == scheme.ExecutionSchemeID) {
					existsOnRemote = true
					scheme.MRBindingID = b.ID
					break
				}
			}
		}
	}

	// 如果三方系统查询不存在该 MR 绑定，直接使用 POST 创建，避免发送 PUT
	if !existsOnRemote {
		log.Printf("[SyncUpdateMRBinding] Remote MR binding not found on remote (MRBindingID=%s, SchemeID=%s), performing CreateMRBindingStep (POST)", scheme.MRBindingID, scheme.ExecutionSchemeID)
		newBindingID, err := CreateMRBindingStep(ctx, pipelineBusinessID, scheme, scheme.ExecutionSchemeID, repoURL, headers)
		if err != nil {
			return fmt.Errorf("failed to create remote MR binding (POST): %w", err)
		}
		scheme.MRBindingID = newBindingID
		if database.DB != nil && scheme.ID != 0 {
			database.DB.Model(scheme).Updates(map[string]interface{}{
				"mr_trigger":      true,
				"mr_binding_id":   newBindingID,
				"mr_binding_name": scheme.Name,
			})
		}
		return nil
	}

	apiURLStr := models.AppConfig.PipelineSystem.CreateMRBindingURL
	if apiURLStr == "" {
		apiURLStr = models.AppConfig.PipelineSystem.GetMRBindingsURL
	}
	if apiURLStr == "" {
		return fmt.Errorf("create_mr_binding_url not configured")
	}

	modifyURL := apiURLStr
	if strings.HasSuffix(modifyURL, "/add") {
		modifyURL = strings.TrimSuffix(modifyURL, "/add") + "/modify"
	} else if !strings.HasSuffix(modifyURL, "/modify") {
		modifyURL = strings.TrimSuffix(modifyURL, "/") + "/modify"
	}

	tmpl := models.AppConfig.PipelineSystem.CreateMRBindingBody
	if tmpl == "" {
		return fmt.Errorf("create_mr_binding_body not configured")
	}

	credentialID, err := CheckRepoAuthorized(ctx, repoURL, headers)
	if err != nil {
		log.Printf("[SyncUpdateMRBinding] Failed to check repo authorized: %v", err)
		return fmt.Errorf("failed to check repo authorized: %w", err)
	}

	customAttributesJSON, err := json.Marshal(scheme.CustomAttributes)
	if err != nil {
		log.Printf("[SyncUpdateMRBinding] Failed to escape custom_attributes: %v", err)
		return fmt.Errorf("failed to escape custom_attributes to JSON: %w", err)
	}

	escapedCustomAttributes := string(customAttributesJSON)
	if len(escapedCustomAttributes) >= 2 && escapedCustomAttributes[0] == '"' && escapedCustomAttributes[len(escapedCustomAttributes)-1] == '"' {
		escapedCustomAttributes = escapedCustomAttributes[1 : len(escapedCustomAttributes)-1]
	}

	branchFuzzy := "false"
	if strings.ContainsAny(scheme.Branch, "*?") {
		branchFuzzy = "true"
	}

	payload, err := utils.RenderJSONTemplate(tmpl, map[string]string{
		"NAME":              scheme.Name,
		"REPO_URL":          repoURL,
		"BRANCHES":          scheme.Branch,
		"BRANCH_FUZZY":      branchFuzzy,
		"PIPELINE_ID":       pipelineBusinessID,
		"SCHEME_ID":         scheme.ExecutionSchemeID,
		"CREDENTIAL_ID":     credentialID,
		"CUSTOM_ATTRIBUTES": escapedCustomAttributes,
	})
	if err != nil {
		return fmt.Errorf("failed to render template: %w", err)
	}

	if m, ok := payload.(map[string]interface{}); ok {
		m["id"] = scheme.MRBindingID
	} else if arr, ok := payload.([]interface{}); ok {
		for _, item := range arr {
			if m, ok := item.(map[string]interface{}); ok {
				m["id"] = scheme.MRBindingID
			}
		}
	}

	log.Printf("[SyncUpdateMRBinding] Calling Modify MR Binding. URL: %s", modifyURL)

	_, err = utils.SendHTTPRequest(ctx, "PUT", modifyURL, payload, utils.HTTPOptions{
		Headers: headers,
		QueryParams: map[string]string{
			"isSingle": "true",
		},
	}, []int{http.StatusOK, http.StatusCreated, http.StatusNoContent}, "SyncUpdateMRBindingRemote")
	if err != nil {
		log.Printf("[SyncUpdateMRBinding] Remote modify failed: %v", err)
		return err
	}

	return nil
}

// SyncUpdateExecutionSchemeRemote 同步调用三方系统接口修改 ExecutionScheme（构建参数更新）
func SyncUpdateExecutionSchemeRemote(ctx context.Context, scheme *models.ExecutionScheme, repoURL string, headers map[string]string) error {
	if scheme == nil {
		return fmt.Errorf("execution scheme is nil")
	}

	var pipeline models.Pipeline
	var pipelineBusinessID string
	if err := database.DB.First(&pipeline, scheme.LocalPipelineID).Error; err == nil {
		pipelineBusinessID = pipeline.PipelineID
	}

	apiURLStr := models.AppConfig.PipelineSystem.CreateExecutionSchemeURL
	if apiURLStr == "" {
		return fmt.Errorf("create_execution_scheme_url not configured")
	}

	modifyURL := apiURLStr
	if strings.HasSuffix(modifyURL, "/post") {
		modifyURL = strings.TrimSuffix(modifyURL, "/post") + "/put"
	} else if strings.HasSuffix(modifyURL, "/add") {
		modifyURL = strings.TrimSuffix(modifyURL, "/add") + "/put"
	} else if !strings.HasSuffix(modifyURL, "/put") {
		modifyURL = strings.TrimSuffix(modifyURL, "/") + "/put"
	}

	tmpl := models.AppConfig.PipelineSystem.CreateExecutionSchemeBody
	if tmpl == "" {
		return fmt.Errorf("create_execution_scheme_body not configured")
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
			log.Printf("[SyncUpdateExecutionScheme] Failed to unmarshal custom_attributes: %v", err)
			return fmt.Errorf("failed to parse custom_attributes JSON: %w", err)
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

	customAttrMap["code_checker_task_id"] = scheme.CodeCheckerTaskID
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
		return fmt.Errorf("failed to marshal custom_attributes to JSON: %w", err)
	}

	customAttributesJSON, err := json.Marshal(string(mergedBytes))
	if err != nil {
		return fmt.Errorf("failed to escape custom_attributes to JSON: %w", err)
	}

	escapedCustomAttributes := string(customAttributesJSON)
	if len(escapedCustomAttributes) >= 2 && escapedCustomAttributes[0] == '"' && escapedCustomAttributes[len(escapedCustomAttributes)-1] == '"' {
		escapedCustomAttributes = escapedCustomAttributes[1 : len(escapedCustomAttributes)-1]
	}

	formattedEmpID := ResolveOperatorIdentifier(ctx)

	payload, err := utils.RenderJSONTemplate(tmpl, map[string]string{
		"SCHEME_NAME":       schemeName,
		"NAME":              schemeName,
		"PIPELINE_ID":       pipelineBusinessID,
		"USER_EMAIL":        formattedEmpID,
		"CUSTOM_ATTRIBUTES": escapedCustomAttributes,
	})
	if err != nil {
		return fmt.Errorf("failed to render template: %w", err)
	}

	if scheme.ExecutionSchemeID != "" {
		if m, ok := payload.(map[string]interface{}); ok {
			m["id"] = scheme.ExecutionSchemeID
		} else if arr, ok := payload.([]interface{}); ok {
			for _, item := range arr {
				if m, ok := item.(map[string]interface{}); ok {
					m["id"] = scheme.ExecutionSchemeID
				}
			}
		}
	}

	log.Printf("[SyncUpdateExecutionScheme] Calling Modify Execution Scheme. URL: %s", modifyURL)

	_, err = utils.SendHTTPRequest(ctx, "PUT", modifyURL, payload, utils.HTTPOptions{
		Headers: headers,
	}, []int{http.StatusOK, http.StatusCreated, http.StatusNoContent}, "SyncUpdateExecutionSchemeRemote")
	if err != nil {
		log.Printf("[SyncUpdateExecutionScheme] Remote modify failed: %v", err)
		return err
	}

	return nil
}

// CreateExecutionPlanStep 步骤四：创建每日构建的执行计划
func CreateExecutionPlanStep(ctx context.Context, pipelineBusinessID string, scheme *models.ExecutionScheme, schemeID string, headers map[string]string) (string, error) {
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

	formattedEmpID := ResolveOperatorIdentifier(ctx)

	dailyTimeStr := scheme.DailyBuildTime
	if dailyTimeStr == "" {
		dailyTimeStr = utils.GetRandomDailyBuildTime()
	}
	stopTime := dailyTimeStr
	if t, err := time.Parse("15:04", dailyTimeStr); err == nil {
		stopTime = t.Add(2 * time.Hour).Format("15:04")
	} else if t, err := time.Parse("15:04:05", dailyTimeStr); err == nil {
		stopTime = t.Add(2 * time.Hour).Format("15:04")
	}

	payload, err := utils.RenderJSONTemplate(tmpl, map[string]string{
		"NAME":             scheme.Name,
		"PIPELINE_ID":      pipelineBusinessID,
		"SCHEME_ID":        schemeID,
		"DAILY_BUILD_TIME": scheme.DailyBuildTime,
		"STOP_TIME":        stopTime,
		"EMPLOYEE_ID":      formattedEmpID,
		"PIPELINE_NAME":    pipeline.Name,
		"SERVICE_ID":       pipeline.ServiceID,
		"WORKSPACE_ID":     pipeline.WorkspaceID,
	})
	if err != nil {
		return "", fmt.Errorf("failed to render create_execution_plan_body template: %w", err)
	}

	log.Printf("[SyncCreateScheme] Step 4: Creating Execution Plan. URL: %s", apiURLStr)

	body, err := utils.SendHTTPRequest(ctx, "POST", apiURLStr, payload, utils.HTTPOptions{
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

	schemeName := strings.TrimSpace(scheme.Name)
	if schemeName == "" {
		return "", fmt.Errorf("execution scheme name cannot be empty")
	}
	scheme.Name = schemeName
	log.Printf("[SyncCreateScheme] Using scheme name: %s", scheme.Name)

	// 1. 获取或创建代码检查执行任务
	var taskID string
	var taskName string

	// 1.1 若 Repository 记录中已有 CodeCheckerTaskID，直接复用
	if repo.CodeCheckerTaskID != "" {
		taskID = repo.CodeCheckerTaskID
		taskName = repo.CodeCheckerTaskName
		log.Printf("[SyncCreateScheme] Reusing existing code checker task ID: %s, Name: %s for repo ID: %d", taskID, taskName, repo.ID)
	} else {
		// 1.2 向上关联复用：如果仓记录中没有，检查该 RepositoryID 下其他已有方案中是否已存在 CodeCheckerTaskID
		var existingWithChecker models.ExecutionScheme
		if err := database.DB.Where("repository_id = ? AND code_checker_task_id != ''", scheme.RepositoryID).First(&existingWithChecker).Error; err == nil && existingWithChecker.CodeCheckerTaskID != "" {
			taskID = existingWithChecker.CodeCheckerTaskID
			taskName = existingWithChecker.CodeCheckerTaskName
			log.Printf("[SyncCreateScheme] Reusing code checker task from existing scheme (ID: %s, Name: %s) for repo ID: %d", taskID, taskName, repo.ID)
		}
	}

	// 1.3 若找到了已有的 taskID，进行名称自愈并持久化回写 Repository 表
	if taskID != "" {
		if strings.TrimSpace(taskName) == "" {
			if scheme.Name != "" {
				taskName = scheme.Name
			} else if repo.Name != "" {
				taskName = repo.Name
			} else {
				taskName = utils.ExtractRepoName(repoURL)
			}
		}
		// 若 repo 记录中此前无 ID 或 Name，补全回写自愈
		if repo.CodeCheckerTaskID != taskID || repo.CodeCheckerTaskName != taskName {
			repo.CodeCheckerTaskID = taskID
			repo.CodeCheckerTaskName = taskName
			if err := database.DB.Model(&repo).Updates(map[string]interface{}{
				"code_checker_task_id":   taskID,
				"code_checker_task_name": taskName,
			}).Error; err != nil {
				log.Printf("[Pipeline] Warning: failed to update CodeCheckerTask info to Repository %d: %v\n", repo.ID, err)
			}
		}
	} else {
		// 1.4 确实无已有任务，按需创建新任务
		if scheme.Languages == "" {
			log.Printf("[SyncCreateScheme] No languages selected, skipping checker task creation for repo ID: %d", repo.ID)
		} else {
			targetTaskName := strings.TrimSpace(scheme.Name)
			if targetTaskName == "" {
				targetTaskName = strings.TrimSpace(repo.Name)
			}
			if targetTaskName == "" {
				targetTaskName = utils.ExtractRepoName(repoURL)
			}

			createdTaskID, err := createCheckerTaskStep(ctx, repoURL, scheme.Branch, scheme.Languages, targetTaskName, headers)
			if err != nil {
				log.Printf("[Pipeline] Remote sync Step 1 failed: %v\n", err)
				return "", err
			}
			taskID = createdTaskID
			taskName = targetTaskName

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
		mrBindingID, err := CreateMRBindingStep(ctx, pipelineBusinessID, scheme, extID, repoURL, headers)
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
		planID, err := CreateExecutionPlanStep(ctx, pipelineBusinessID, scheme, extID, headers)
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

// SyncDeleteExecutionPlanRemote 单独删除三方系统中的执行计划（每日构建）
func SyncDeleteExecutionPlanRemote(planID string, headers map[string]string) error {
	if planID == "" {
		return nil
	}
	apiURLStr := models.AppConfig.PipelineSystem.GetExecutionPlanURL
	if apiURLStr == "" {
		return fmt.Errorf("get_execution_plan_url not configured")
	}
	deleteURL := apiURLStr
	if strings.HasSuffix(deleteURL, "/get") {
		deleteURL = deleteURL[:len(deleteURL)-3] + "delete"
	}
	_, err := utils.SendHTTPRequest(context.Background(), "DELETE", deleteURL, nil, utils.HTTPOptions{
		Headers: headers,
		QueryParams: map[string]string{
			"scheduleId": planID,
		},
	}, []int{http.StatusOK, http.StatusNoContent, http.StatusAccepted}, "SyncDeleteExecutionPlanRemote")
	if err != nil {
		log.Printf("[SyncDeleteExecutionPlan] Failed to delete execution plan %s: %v\n", planID, err)
		return err
	}
	return nil
}

// SyncDeleteCheckerTaskRemote 在三方系统中删除代码检查任务
func SyncDeleteCheckerTaskRemote(taskID string, headers map[string]string) error {
	if taskID == "" {
		return nil
	}
	apiURLStr := models.AppConfig.PipelineSystem.DeleteCheckerTaskURL
	if apiURLStr == "" {
		log.Printf("[SyncDeleteCheckerTask] Warning: delete_checker_task_url is not configured, cannot delete remote task %s\n", taskID)
		return fmt.Errorf("三方代码检查任务删除接口 URL (delete_checker_task_url) 未配置")
	}
	payload := map[string]interface{}{
		"taskIds": []string{taskID},
	}
	// 允许 200, 204, 202 及 404 (404 视为已删除，保障幂等性)
	_, err := utils.SendHTTPRequest(context.Background(), "DELETE", apiURLStr, payload, utils.HTTPOptions{
		Headers: headers,
	}, []int{http.StatusOK, http.StatusNoContent, http.StatusAccepted, http.StatusNotFound}, "SyncDeleteCheckerTask")
	if err != nil {
		log.Printf("[SyncDeleteCheckerTask] Failed to delete checker task %s: %v\n", taskID, err)
		return err
	}
	return nil
}

// SyncDeleteExecutionSchemeRemote 在三方系统中删除执行方案及其关联的所有对象（方案、计划、MR触发、检查任务）
func SyncDeleteExecutionSchemeRemote(scheme models.ExecutionScheme, headers map[string]string) error {
	// 1. 删除执行计划（每日构建）；未配置 get_execution_plan_url 时跳过，避免中断整个删除流程
	if scheme.ExecutionPlanID != "" && models.AppConfig.PipelineSystem.GetExecutionPlanURL != "" {
		if err := SyncDeleteExecutionPlanRemote(scheme.ExecutionPlanID, headers); err != nil {
			return fmt.Errorf("删除三方执行计划失败: %w", err)
		}
		if scheme.ID != 0 && database.DB != nil {
			database.DB.Model(&models.ExecutionScheme{}).Where("id = ?", scheme.ID).Updates(map[string]interface{}{
				"daily_build":         false,
				"execution_plan_id":   "",
				"execution_plan_name": "",
			})
		}
	}

	// 2. 删除 MR 触发 (失败则中止，保留本地记录与 mr_binding_id，便于重试或事后清理)
	if err := SyncDeleteMRBindingRemote(context.Background(), &scheme, headers); err != nil {
		log.Printf("[SyncDelete] Failed to delete mr binding %s: %v\n", scheme.MRBindingID, err)
		return fmt.Errorf("删除三方 MR 触发关联失败: %w", err)
	}

	// 3. 删除执行方案
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
			}, []int{http.StatusOK, http.StatusNoContent, http.StatusAccepted, http.StatusNotFound}, "SyncDeleteScheme")
			if err != nil {
				log.Printf("[SyncDelete] Failed to delete execution scheme %s: %v\n", scheme.ExecutionSchemeID, err)
				return fmt.Errorf("删除三方执行方案失败: %w", err)
			}
			if scheme.ID != 0 && database.DB != nil {
				database.DB.Model(&models.ExecutionScheme{}).Where("id = ?", scheme.ID).Updates(map[string]interface{}{
					"execution_scheme_id": "",
				})
			}
		}
	}

	// 4. 代码检查任务删除判定：全局检查该 CodeCheckerTaskID 是否仍被系统中的其他执行方案引用
	taskID := scheme.CodeCheckerTaskID
	if taskID == "" && scheme.RepositoryID != 0 && database.DB != nil {
		var repo models.Repository
		if err := database.DB.First(&repo, scheme.RepositoryID).Error; err == nil {
			taskID = repo.CodeCheckerTaskID
		}
	}

	if taskID != "" && database.DB != nil {
		var remainingCount int64
		query := database.DB.Model(&models.ExecutionScheme{}).Where("code_checker_task_id = ?", taskID)
		if scheme.ID != 0 {
			query = query.Where("id != ?", scheme.ID)
		}
		if err := query.Count(&remainingCount).Error; err != nil {
			log.Printf("[SyncDelete] DB error counting remaining schemes for task %s: %v\n", taskID, err)
			return fmt.Errorf("查询代码检查任务关联方案失败: %w", err)
		}

		if remainingCount == 0 {
			if err := SyncDeleteCheckerTaskRemote(taskID, headers); err != nil {
				log.Printf("[SyncDelete] Failed to delete checker task %s: %v\n", taskID, err)
				return fmt.Errorf("删除三方代码检查任务失败: %w", err)
			}

			if err := database.DB.Model(&models.Repository{}).Where("code_checker_task_id = ?", taskID).Updates(map[string]interface{}{
				"code_checker_task_id":   "",
				"code_checker_task_name": "",
			}).Error; err != nil {
				log.Printf("[SyncDelete] Warning: failed to reset repository checker task cache for task %s: %v\n", taskID, err)
				return fmt.Errorf("更新代码仓检查任务缓存失败: %w", err)
			}
		}
	}

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
				return fmt.Errorf("删除三方执行方案失败: %w", err)
			}
			if scheme.ID != 0 {
				database.DB.Model(&models.ExecutionScheme{}).Where("id = ?", scheme.ID).Updates(map[string]interface{}{
					"execution_scheme_id": "",
				})
			}
		}
	}

	return nil
}

// SyncDeleteMRBindingRemote 在三方系统中删除 MR 触发关联
func SyncDeleteMRBindingRemote(ctx context.Context, scheme *models.ExecutionScheme, headers map[string]string) error {
	if scheme == nil || scheme.MRBindingID == "" {
		return nil
	}

	var pipeline models.Pipeline
	var pipelineBusinessID string
	if err := database.DB.First(&pipeline, scheme.LocalPipelineID).Error; err == nil {
		pipelineBusinessID = pipeline.PipelineID
	} else if scheme.LocalPipelineID != 0 {
		// 若主线程软删除了数据库记录，使用 Unscoped 恢复读取 PipelineID
		if err := database.DB.Unscoped().First(&pipeline, scheme.LocalPipelineID).Error; err == nil {
			pipelineBusinessID = pipeline.PipelineID
		}
	}

	if models.AppConfig.PipelineSystem.EnableAPIGAuth {
		log.Printf("[SyncDeleteMRBinding] Using APIG Token Authentication to delete MR binding %s", scheme.MRBindingID)
		if err := SyncDeleteMRBindingAPIG(ctx, pipelineBusinessID, scheme.MRBindingID); err != nil {
			log.Printf("[SyncDeleteMRBinding] Failed to delete mr binding %s via APIG: %v\n", scheme.MRBindingID, err)
			return fmt.Errorf("删除三方 MR 触发关联失败: %w", err)
		}
	} else {
		apiURLStr := models.AppConfig.PipelineSystem.GetMRBindingsURL
		if apiURLStr != "" {
			deleteURL := strings.TrimSuffix(apiURLStr, "/") + "/delete"
			_, err := utils.SendHTTPRequest(ctx, "DELETE", deleteURL, nil, utils.HTTPOptions{
				Headers: headers,
				QueryParams: map[string]string{
					"pipelineId": pipelineBusinessID,
					"configId":   scheme.MRBindingID,
					"isSingle":   "true",
				},
			}, []int{http.StatusOK, http.StatusNoContent, http.StatusAccepted}, "SyncDeleteMRBinding")
			if err != nil {
				log.Printf("[SyncDeleteMRBinding] Failed to delete mr binding %s: %v\n", scheme.MRBindingID, err)
				return fmt.Errorf("删除三方 MR 触发关联失败: %w", err)
			}
		}
	}

	if database.DB != nil && scheme.ID != 0 {
		database.DB.Model(&models.ExecutionScheme{}).Where("id = ?", scheme.ID).Updates(map[string]interface{}{
			"mr_trigger":      false,
			"mr_binding_id":   "",
			"mr_binding_name": "",
		})
	}
	scheme.MRBindingID = ""
	scheme.MRBindingName = ""
	scheme.MRTrigger = false
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

	fuzzyPath := utils.ExtractRepoPath(repository)
	log.Printf("[checkRepoAuthorized] Checking repo auth for repository=%s (fuzzyMatch=%s), headersCount=%d", repository, fuzzyPath, len(headers))

	body, err := utils.SendHTTPRequest(ctx, "GET", apiURLStr, nil, utils.HTTPOptions{
		Headers: headers,
		QueryParams: map[string]string{
			"fuzzyMatch": fuzzyPath,
			"filterType": "allTeam",
			"page-size":  "10",
			"page-no":    "1"},
	}, []int{http.StatusOK}, "checkRepoAuthorized")
	if err != nil {
		log.Printf("[checkRepoAuthorized] HTTP request failed for repository=%s: %v", repository, err)
		return "", err
	}

	type RepoAuthCheckResp struct {
		Status   string `json:"status"`
		Count    int    `json:"count"`
		Entities []struct {
			ID            string `json:"id"`
			Name          string `json:"name"`
			RepositoryURL string `json:"repositoryUrl"`
		} `json:"entities"`
	}

	var resp RepoAuthCheckResp
	if err := json.Unmarshal(body, &resp); err != nil {
		log.Printf("[checkRepoAuthorized] Failed to parse JSON: %v, Body: %s", err, string(body))
		return "", fmt.Errorf("failed to parse auth check response JSON: %v", err)
	}

	if resp.Status != "success" {
		return "", fmt.Errorf("auth check failed with status: %s", resp.Status)
	}

	if len(resp.Entities) == 0 || resp.Entities[0].ID == "" {
		log.Printf("[checkRepoAuthorized] Authorized entity or credential ID is empty for repository=%s", repository)
		return "", nil // 未授权或凭证 ID 为空，返回空字符串
	}

	return resp.Entities[0].ID, nil
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
	payload, err := utils.RenderJSONTemplate(tmpl, map[string]string{
		"WEBHOOK_URL": callbackURL,
		"PROJECT_ID":  projectID,
		"REPO_ID":     projectID,
	})
	if err != nil {
		return fmt.Errorf("failed to render create_webhook_body template: %w", err)
	}

	_, err = utils.SendHTTPRequest(ctx, "POST", apiURLStr, payload, utils.HTTPOptions{
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
	payload, err := utils.RenderJSONTemplate(tmpl, map[string]string{
		"PROJECT_ID": projectID,
		"REPO_ID":    projectID,
	})
	if err != nil {
		return fmt.Errorf("failed to render update_repo_settings_body template: %w", err)
	}

	_, err = utils.SendHTTPRequest(ctx, "PUT", apiURLStr, payload, utils.HTTPOptions{
		Headers: headers,
	}, []int{http.StatusOK, http.StatusAccepted, http.StatusNoContent}, "UpdateRepoSettings")
	if err != nil {
		return err
	}

	return nil
}
