package utils

import (
	"encoding/json"
	"fmt"
	"strings"
)

// RenderJSONTemplate 统一将包含 {VAR} 占位符的配置模板解析校验，并反序列化为标准的 Go map[string]interface{}
func RenderJSONTemplate(templateStr string, vars map[string]string) (map[string]interface{}, error) {
	rendered := templateStr
	for k, v := range vars {
		placeholder := "{" + k + "}"
		rendered = strings.ReplaceAll(rendered, placeholder, v)
	}

	var resultMap map[string]interface{}
	if err := json.Unmarshal([]byte(rendered), &resultMap); err != nil {
		return nil, fmt.Errorf("invalid json config template after substitution: %w (rendered: %s)", err, rendered)
	}

	return resultMap, nil
}
