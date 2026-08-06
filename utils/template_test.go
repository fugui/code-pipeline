package utils

import (
	"reflect"
	"strings"
	"testing"
)

func TestRenderJSONTemplate(t *testing.T) {
	template := `{
		"name": "{REPO_NAME}",
		"group_id": "{GROUP_ID}",
		"tag_list": [{TAG_LIST}],
		"description": "{DESCRIPTION}"
	}`

	vars := map[string]string{
		"REPO_NAME":   "my-repo",
		"GROUP_ID":    "123",
		"TAG_LIST":    `"Go","CodeShield"`,
		"DESCRIPTION": "单元测试描述",
	}

	result, err := RenderJSONTemplate(template, vars)
	if err != nil {
		t.Fatalf("RenderJSONTemplate failed: %v", err)
	}

	if result["name"] != "my-repo" {
		t.Errorf("expected name 'my-repo', got %v", result["name"])
	}
	if result["group_id"] != "123" {
		t.Errorf("expected group_id '123', got %v", result["group_id"])
	}
	if result["description"] != "单元测试描述" {
		t.Errorf("expected description '单元测试描述', got %v", result["description"])
	}

	tagList, ok := result["tag_list"].([]interface{})
	if !ok {
		t.Fatalf("expected tag_list to be []interface{}, got %T", result["tag_list"])
	}
	expectedTags := []interface{}{"Go", "CodeShield"}
	if !reflect.DeepEqual(tagList, expectedTags) {
		t.Errorf("expected tag_list %v, got %v", expectedTags, tagList)
	}
}

func TestReplacePlaceholders_CurrentTime(t *testing.T) {
	template := `{"created_at": "{CURRENT_TIME}"}`
	rendered := ReplacePlaceholders(template, map[string]string{})
	if strings.Contains(rendered, "{CURRENT_TIME}") {
		t.Errorf("expected {CURRENT_TIME} to be replaced, got %s", rendered)
	}
}

func TestRenderJSONTemplate_InvalidJSON(t *testing.T) {
	template := `{
		"name": {INVALID_PLACEHOLDER}
	}`

	vars := map[string]string{
		"INVALID_PLACEHOLDER": "invalid_unquoted_value",
	}

	_, err := RenderJSONTemplate(template, vars)
	if err == nil {
		t.Fatal("expected error for invalid JSON template, got nil")
	}

	// 验证错误信息中不暴露具体的 invalid_unquoted_value 敏感内容
	if strings.Contains(err.Error(), "invalid_unquoted_value") {
		t.Fatalf("error message leaked raw sensitive placeholder data: %v", err)
	}
}
