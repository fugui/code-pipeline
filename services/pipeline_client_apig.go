package services

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

	"code-pipeline/database"
	"code-pipeline/models"
	"code-pipeline/utils"
)

// CreateMRBindingAPIG 步骤三：在 APIG 模式下创建 MR 触发关联
func CreateMRBindingAPIG(ctx context.Context, pipelineBusinessID string, scheme *models.ExecutionScheme, schemeID string, repoURL string, userHeaders map[string]string) (string, error) {
	log.Printf("[APIG] Enter CreateMRBindingAPIG: pipelineBusinessID=%s, schemeID=%s, repoURL=%s", pipelineBusinessID, schemeID, repoURL)

	apiURLStr := models.AppConfig.PipelineSystem.APIG.MRBindingURL
	if apiURLStr == "" {
		return "", fmt.Errorf("apig.mr_binding_url not configured")
	}

	tmpl := models.AppConfig.PipelineSystem.CreateMRBindingBody
	if tmpl == "" {
		return "", fmt.Errorf("create_mr_binding_body not configured")
	}

	headers, err := GetAPIGHeaders(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to get APIG headers: %w", err)
	}

	// 仓库授权检查使用传统用户 Cookie/Session Headers
	credentialID, err := CheckRepoAuthorized(ctx, repoURL, userHeaders)
	if err != nil {
		log.Printf("[APIG] Step 3: Failed to check repo authorized: %v", err)
		return "", fmt.Errorf("failed to check repo authorized: %w", err)
	}

	customAttributesJSON, err := json.Marshal(scheme.CustomAttributes)
	if err != nil {
		log.Printf("[APIG] Step 3: Failed to escape custom_attributes: %v", err)
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

	bodyPayload, err := utils.RenderJSONTemplate(tmpl, map[string]string{
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
		return "", fmt.Errorf("failed to render template: %w", err)
	}

	body, err := utils.SendHTTPRequest(ctx, "POST", apiURLStr, bodyPayload, utils.HTTPOptions{
		Headers: headers,
		QueryParams: map[string]string{
			"isSingle": "true",
		},
	}, []int{http.StatusOK, http.StatusCreated}, "APIGCreateMRBinding")
	if err != nil {
		return "", err
	}

	var respStruct struct {
		Status  string `json:"status"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(body, &respStruct); err == nil {
		if respStruct.Status != "" && strings.ToLower(respStruct.Status) != "success" && strings.ToLower(respStruct.Status) != "ok" {
			log.Printf("[APIG] Step 3: Create MR binding failed: status=%s, message=%s", respStruct.Status, respStruct.Message)
			if respStruct.Message != "" {
				return "", fmt.Errorf("create MR binding failed: %s", respStruct.Message)
			}
			return "", fmt.Errorf("create MR binding failed: status %s", respStruct.Status)
		}
	}

	bindingID := ParseMRBindingID(body)
	if bindingID == "" {
		log.Printf("[APIG] Step 3: Could not parse MR binding ID from response: %s", string(body))
		if respStruct.Message != "" {
			return "", fmt.Errorf("create MR binding failed: %s", respStruct.Message)
		}
		return "", fmt.Errorf("failed to parse created MR binding ID from response: %s", string(body))
	}

	log.Printf("[APIG] Step 3: Successfully created MR binding, bindingID=%s", bindingID)
	return bindingID, nil
}

// SyncUpdateMRBindingRemoteAPIG 在 APIG 模式下同步更新 MR 触发关联
func SyncUpdateMRBindingRemoteAPIG(ctx context.Context, pipelineBusinessID string, scheme *models.ExecutionScheme, repoURL string, userHeaders map[string]string) error {
	log.Printf("[APIG] Enter SyncUpdateMRBindingRemoteAPIG: pipelineBusinessID=%s, schemeID=%s, bindingID=%s", pipelineBusinessID, scheme.ExecutionSchemeID, scheme.MRBindingID)

	headers, err := GetAPIGHeaders(ctx)
	if err != nil {
		return fmt.Errorf("failed to get APIG headers: %w", err)
	}

	// 优先实时查询三方系统是否存在该 MR 绑定
	existsOnRemote := false
	if pipelineBusinessID != "" {
		remoteBindings, err := FetchRemoteMRBindings(ctx, pipelineBusinessID, userHeaders)
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
		log.Printf("[APIG] Remote MR binding not found on remote (MRBindingID=%s, SchemeID=%s), performing CreateMRBindingAPIG (POST)", scheme.MRBindingID, scheme.ExecutionSchemeID)
		newBindingID, err := CreateMRBindingAPIG(ctx, pipelineBusinessID, scheme, scheme.ExecutionSchemeID, repoURL, userHeaders)
		if err != nil {
			return fmt.Errorf("failed to create MR binding during update via APIG (POST): %w", err)
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

	apiURLStr := models.AppConfig.PipelineSystem.APIG.MRBindingURL
	if apiURLStr == "" {
		return fmt.Errorf("apig.mr_binding_url not configured")
	}

	tmpl := models.AppConfig.PipelineSystem.CreateMRBindingBody
	if tmpl == "" {
		return fmt.Errorf("create_mr_binding_body not configured")
	}

	// 仓库授权检查使用传统用户 Cookie/Session Headers
	credentialID, err := CheckRepoAuthorized(ctx, repoURL, userHeaders)
	if err != nil {
		log.Printf("[APIG] Update MR Binding: Failed to check repo authorized: %v", err)
		return fmt.Errorf("failed to check repo authorized: %w", err)
	}

	customAttributesJSON, err := json.Marshal(scheme.CustomAttributes)
	if err != nil {
		return fmt.Errorf("failed to escape custom_attributes: %w", err)
	}

	escapedCustomAttributes := string(customAttributesJSON)
	if len(escapedCustomAttributes) >= 2 && escapedCustomAttributes[0] == '"' && escapedCustomAttributes[len(escapedCustomAttributes)-1] == '"' {
		escapedCustomAttributes = escapedCustomAttributes[1 : len(escapedCustomAttributes)-1]
	}

	branchFuzzy := "false"
	if strings.ContainsAny(scheme.Branch, "*?") {
		branchFuzzy = "true"
	}

	bodyPayload, err := utils.RenderJSONTemplate(tmpl, map[string]string{
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

	if m, ok := bodyPayload.(map[string]interface{}); ok {
		m["id"] = scheme.MRBindingID
	} else if arr, ok := bodyPayload.([]interface{}); ok {
		for _, item := range arr {
			if m, ok := item.(map[string]interface{}); ok {
				m["id"] = scheme.MRBindingID
			}
		}
	}

	_, err = utils.SendHTTPRequest(ctx, "PUT", apiURLStr, bodyPayload, utils.HTTPOptions{
		Headers: headers,
		QueryParams: map[string]string{
			"isSingle": "true",
		},
	}, []int{http.StatusOK, http.StatusAccepted}, "APIGUpdateMRBinding")
	if err != nil {
		log.Printf("[APIG] Update MR Binding failed: %v", err)
		return fmt.Errorf("failed to update remote MR binding via APIG: %w", err)
	}

	log.Printf("[APIG] Successfully updated remote MR binding: %s", scheme.MRBindingID)
	return nil
}

func ParseMRBindingID(body []byte) string {
	var genericData interface{}
	if err := json.Unmarshal(body, &genericData); err != nil {
		return ""
	}

	return extractIDFromValue(genericData)
}

func extractIDFromValue(val interface{}) string {
	if val == nil {
		return ""
	}

	switch v := val.(type) {
	case map[string]interface{}:
		// 1. 尝试直接取 "id"
		if id, ok := v["id"].(string); ok && id != "" {
			return id
		}

		// 2. 尝试从 "result" 嵌套节点提取（支持 对象 或 数组）
		if res, exists := v["result"]; exists {
			if id := extractIDFromValue(res); id != "" {
				return id
			}
		}

		// 3. 尝试从 "entity", "entities", "data" 嵌套节点提取
		for _, key := range []string{"entity", "entities", "data"} {
			if item, exists := v[key]; exists {
				if id := extractIDFromValue(item); id != "" {
					return id
				}
			}
		}

	case []interface{}:
		// 如果是数组，递归遍历每一个元素
		for _, item := range v {
			if id := extractIDFromValue(item); id != "" {
				return id
			}
		}
	}

	return ""
}

// SyncDeleteMRBindingAPIG 在 APIG 模式下同步删除 MR 触发关联
func SyncDeleteMRBindingAPIG(ctx context.Context, pipelineBusinessID string, mrBindingID string) error {
	if mrBindingID == "" {
		return nil
	}

	log.Printf("[APIG] Enter SyncDeleteMRBindingAPIG: pipelineBusinessID=%s, mrBindingID=%s", pipelineBusinessID, mrBindingID)

	apiURLStr := models.AppConfig.PipelineSystem.APIG.MRBindingURL
	if apiURLStr == "" {
		return fmt.Errorf("apig.mr_binding_url not configured")
	}

	headers, err := GetAPIGHeaders(ctx)
	if err != nil {
		return fmt.Errorf("failed to get APIG headers: %w", err)
	}

	_, err = utils.SendHTTPRequest(ctx, "DELETE", apiURLStr, nil, utils.HTTPOptions{
		Headers: headers,
		QueryParams: map[string]string{
			"pipelineId": pipelineBusinessID,
			"configId":   mrBindingID,
			"isSingle":   "true",
		},
	}, []int{http.StatusOK, http.StatusNoContent, http.StatusAccepted}, "APIGDeleteMRBinding")
	if err != nil {
		log.Printf("[APIG] Failed to delete mr binding %s: %v", mrBindingID, err)
		return fmt.Errorf("failed to delete mr binding via APIG: %w", err)
	}

	log.Printf("[APIG] Successfully deleted MR binding: %s", mrBindingID)
	return nil
}
