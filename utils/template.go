package utils

import "strings"

// ReplacePlaceholders 将模板中的特定占位符替换为相应的值
func ReplacePlaceholders(tmpl string, placeholders map[string]string) string {
	var oldNew []string
	for k, v := range placeholders {
		oldNew = append(oldNew, k, v)
	}
	replacer := strings.NewReplacer(oldNew...)
	return replacer.Replace(tmpl)
}
