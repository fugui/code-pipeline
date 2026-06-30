package utils

import (
	"regexp"
	"strings"
)

// SSHToHTTPS 将 SSH/SCP git URL 转换为浏览器可访问或 API 使用的 HTTPS URL。
// 转换规则参考自 code-shield/frontend/src/utils/urlUtils.ts：
//
//	git@host:path/repo.git            →  https://host/path/repo
//	git@host:PORT/path/repo.git       →  https://host/path/repo  (port dropped)
//	ssh://git@host/path.git           →  https://host/path
//	ssh://git@host:PORT/path.git      →  https://host/path       (port dropped)
//	ssh:git@host:PORT/path.git        →  https://host/path       (non-standard prefix)
//	https://...                       →  unchanged
//
// 域名后处理：
//   - 将域名中的 "-git-" 替换为 "-"
func SSHToHTTPS(rawURL string) string {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return ""
	}

	if strings.HasPrefix(rawURL, "http://") || strings.HasPrefix(rawURL, "https://") {
		return rawURL
	}

	var host, repoPath string

	// 1. 尝试匹配 ssh:// 协议前缀格式
	// 匹配正则： ^ssh:/{0,2}(?:[^@]+@)?([^/:]+)(?::\d+)?/(.+?)(?:\.git)?$
	protoRegex := regexp.MustCompile(`^ssh:/{0,2}(?:[^@]+@)?([^/:]+)(?::\d+)?/(.+?)(?:\.git)?$`)
	if matches := protoRegex.FindStringSubmatch(rawURL); len(matches) > 0 {
		host = matches[1]
		repoPath = matches[2]
	} else {
		// 2. 尝试匹配 SCP 格式： [user@]host:path 或者 [user@]host:PORT/path
		// 匹配正则： ^(?:[^@]+@)?([^:]+):(?:\d+/)?(.+?)(?:\.git)?$
		scpRegex := regexp.MustCompile(`^(?:[^@]+@)?([^:]+):(?:\d+/)?(.+?)(?:\.git)?$`)
		if matches := scpRegex.FindStringSubmatch(rawURL); len(matches) > 0 {
			host = matches[1]
			repoPath = matches[2]
		} else {
			// 无法识别，直接返回原 URL
			return rawURL
		}
	}

	// 3. 后置处理：将 host 中的 "-git-" 替换为 "-"
	host = strings.ReplaceAll(host, "-git-", "-")

	return "https://" + host + "/" + repoPath
}

// NormalizeGitURL 规范化 Git 仓库地址，消除协议（ssh/http/https）、端口、用户名及 .git 后缀的差异，返回标准的 host/path
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
