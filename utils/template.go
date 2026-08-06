package utils

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"
)

// ReplacePlaceholders 通用字符串占位符替换函数，将 {KEY} 或 KEY 替换为对应的值
func ReplacePlaceholders(templateStr string, vars map[string]string) string {
	mergedVars := make(map[string]string)
	mergedVars["CURRENT_TIME"] = time.Now().Format("2006-01-02 15:04:05")
	for k, v := range vars {
		mergedVars[k] = v
	}

	rendered := templateStr
	for k, v := range mergedVars {
		placeholder := k
		if !strings.HasPrefix(k, "{") {
			placeholder = "{" + k + "}"
		}
		rendered = strings.ReplaceAll(rendered, placeholder, v)
	}
	return rendered
}

// RenderJSONTemplate 统一将包含 {VAR} 占位符的配置模板解析校验，并反序列化为标准的 Go map[string]interface{}
func RenderJSONTemplate(templateStr string, vars map[string]string) (map[string]interface{}, error) {
	rendered := ReplacePlaceholders(templateStr, vars)

	var resultMap map[string]interface{}
	if err := json.Unmarshal([]byte(rendered), &resultMap); err != nil {
		log.Printf("[RenderJSONTemplate] Failed to unmarshal json config template: %v | Rendered Body: %s\n", err, rendered)
		return nil, fmt.Errorf("请求模板配置格式异常，请联系系统管理员检查处理")
	}

	return resultMap, nil
}
