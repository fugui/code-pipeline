package utils

import (
	commonUtils "code-common/backend/utils"
	"strings"
)

// SSHToHTTPS 将 SSH/SCP git URL 转换为浏览器可访问或 API 使用的 HTTPS URL
func SSHToHTTPS(rawURL string) string {
	return commonUtils.SSHToHTTPS(rawURL)
}

// ExtractRepoPath 提取不含协议、host 与末尾 .git 的仓库路径
func ExtractRepoPath(repoURL string) string {
	return commonUtils.ExtractRepoPath(repoURL)
}

// NormalizeGitURL 规范化 Git 仓库地址，消除协议、端口、用户名及 .git 后缀的差异
func NormalizeGitURL(u string) string {
	u = strings.TrimSpace(u)
	u = strings.ToLower(u)

	// 1. 去除协议前缀
	if strings.HasPrefix(u, "ssh://") {
		u = u[6:]
	} else if strings.HasPrefix(u, "http://") {
		u = u[7:]
	} else if strings.HasPrefix(u, "https://") {
		u = u[8:]
	}

	// 2. 去除用户名
	if idx := strings.Index(u, "@"); idx != -1 {
		u = u[idx+1:]
	}

	// 3. 去除末尾的 .git 和 /
	u = strings.TrimSuffix(u, ".git")
	u = strings.TrimSuffix(u, "/")

	// 4. 分离 host 和 path
	var hostPart, pathPart string
	if idx := strings.Index(u, "/"); idx != -1 {
		hostPart = u[:idx]
		pathPart = u[idx+1:]
	} else {
		hostPart = u
	}

	// 5. 处理 hostPart 中的冒号端口与 SSH 路径区分
	if idx := strings.Index(hostPart, ":"); idx != -1 {
		portOrPath := hostPart[idx+1:]
		hostOnly := hostPart[:idx]

		isPort := true
		if len(portOrPath) == 0 {
			isPort = false
		}
		for _, r := range portOrPath {
			if r < '0' || r > '9' {
				isPort = false
				break
			}
		}

		if isPort {
			hostPart = hostOnly
		} else {
			hostPart = hostOnly
			if pathPart != "" {
				pathPart = portOrPath + "/" + pathPart
			} else {
				pathPart = portOrPath
			}
		}
	}

	if pathPart != "" {
		return hostPart + "/" + pathPart
	}
	return hostPart
}

// ExtractRepoName 从 Git 仓库 URL 或路径中提取代码仓的 basename 名称
func ExtractRepoName(repoURL string) string {
	u := strings.TrimSuffix(repoURL, "/")
	u = strings.TrimSuffix(u, ".git")

	if idx := strings.LastIndex(u, "/"); idx != -1 {
		u = u[idx+1:]
	}
	if idx := strings.LastIndex(u, ":"); idx != -1 {
		u = u[idx+1:]
	}

	if u == "" {
		return "repo"
	}
	return u
}
