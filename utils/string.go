package utils

import (
	"strings"
)

// FormatEmployeeID 格式化工号数据：例如将 "fugui 008163" 格式化为 "f008163"
// 规则：ID由两个部分组成，中间空格分割，取第一部分的第一个字符与第二部分拼接
func FormatEmployeeID(raw string) string {
	parts := strings.Fields(raw)
	if len(parts) < 2 {
		return raw
	}
	firstPart := parts[0]
	secondPart := parts[1]
	if len(firstPart) == 0 {
		return secondPart
	}
	firstChar := string([]rune(firstPart)[0])
	return firstChar + secondPart
}
