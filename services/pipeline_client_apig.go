package services

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"

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

	bodyStr := utils.ReplacePlaceholders(tmpl, map[string]string{
		"{NAME}":              scheme.Name,
		"{REPO_URL}":          repoURL,
		"{BRANCHES}":          scheme.Branch,
		"{PIPELINE_ID}":       pipelineBusinessID,
		"{SCHEME_ID}":         schemeID,
		"{CREDENTIAL_ID}":     credentialID,
		"{CUSTOM_ATTRIBUTES}": escapedCustomAttributes,
	})

	var bodyPayload interface{}
	if err := json.Unmarshal([]byte(bodyStr), &bodyPayload); err != nil {
		log.Printf("[APIG] Step 3: Failed to unmarshal json body string: %v, raw: %s", err, bodyStr)
		return "", fmt.Errorf("failed to unmarshal request body json: %w", err)
	}

	body, err := utils.SendHTTPRequest(ctx, "POST", apiURLStr, bodyPayload, utils.HTTPOptions{
		Headers: headers,
	}, []int{http.StatusOK, http.StatusCreated}, "APIGCreateMRBinding")
	if err != nil {
		return "", err
	}

	bindingID := parseMRBindingID(body)
	if bindingID == "" {
		log.Printf("[APIG] Step 3: Could not parse MR binding ID from response: %s", string(body))
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

	if scheme.MRBindingID == "" {
		newBindingID, err := CreateMRBindingAPIG(ctx, pipelineBusinessID, scheme, scheme.ExecutionSchemeID, repoURL, userHeaders)
		if err != nil {
			return fmt.Errorf("failed to create MR binding during update: %w", err)
		}
		scheme.MRBindingID = newBindingID
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

	bodyStr := utils.ReplacePlaceholders(tmpl, map[string]string{
		"{NAME}":              scheme.Name,
		"{REPO_URL}":          repoURL,
		"{BRANCHES}":          scheme.Branch,
		"{PIPELINE_ID}":       pipelineBusinessID,
		"{SCHEME_ID}":         scheme.ExecutionSchemeID,
		"{CREDENTIAL_ID}":     credentialID,
		"{CUSTOM_ATTRIBUTES}": escapedCustomAttributes,
	})

	var bodyPayload interface{}
	if err := json.Unmarshal([]byte(bodyStr), &bodyPayload); err != nil {
		return fmt.Errorf("failed to unmarshal request body json: %w", err)
	}

	// 自动注入 id 属性（适配 对象 或 数组）
	if m, ok := bodyPayload.(map[string]interface{}); ok {
		m["id"] = scheme.MRBindingID
	} else if arr, ok := bodyPayload.([]interface{}); ok && len(arr) > 0 {
		if m, ok := arr[0].(map[string]interface{}); ok {
			m["id"] = scheme.MRBindingID
		}
	}

	_, err = utils.SendHTTPRequest(ctx, "PUT", apiURLStr, bodyPayload, utils.HTTPOptions{
		Headers: headers,
	}, []int{http.StatusOK, http.StatusAccepted}, "APIGUpdateMRBinding")
	if err != nil {
		log.Printf("[APIG] Update MR Binding failed: %v", err)
		return fmt.Errorf("failed to update remote MR binding via APIG: %w", err)
	}

	log.Printf("[APIG] Successfully updated remote MR binding: %s", scheme.MRBindingID)
	return nil
}

func parseMRBindingID(body []byte) string {
	type RemoteResp struct {
		ID     string `json:"id"`
		Entity struct {
			ID string `json:"id"`
		} `json:"entity"`
		Result struct {
			ID string `json:"id"`
		} `json:"result"`
	}

	// 优先尝试按单个对象解析
	var single RemoteResp
	if err := json.Unmarshal(body, &single); err == nil {
		id := single.ID
		if id == "" {
			id = single.Entity.ID
		}
		if id == "" {
			id = single.Result.ID
		}
		if id != "" {
			return id
		}
	}

	// 尝试按数组解析
	var list []RemoteResp
	if err := json.Unmarshal(body, &list); err == nil && len(list) > 0 {
		id := list[0].ID
		if id == "" {
			id = list[0].Entity.ID
		}
		if id == "" {
			id = list[0].Result.ID
		}
		if id != "" {
			return id
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
