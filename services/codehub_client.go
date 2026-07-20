package services

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"code-pipeline/models"
	"code-pipeline/utils"
)

type GitMrAuthor struct {
	Name     string `json:"name"`
	Username string `json:"username"`
}

type GitMr struct {
	ID           interface{} `json:"id"`
	Iid          int64       `json:"iid"`
	Title        string      `json:"title"`
	State        string      `json:"state"`
	Description  string      `json:"description"`
	TargetBranch string      `json:"target_branch"`
	SourceBranch string      `json:"source_branch"`
	WebURL       string      `json:"web_url"`
	RepoName     string      `json:"repo_name"`
	Author       GitMrAuthor `json:"author"`
	CreatedAt    string      `json:"created_at"`
	UpdatedAt    string      `json:"updated_at"`
}

// GetMrListFromGitRemote 从托管平台实时获取指定仓库的 Merge Requests 列表
func GetMrListFromGitRemote(ctx context.Context, projectID string, repoName string, contextHeaders map[string]string) ([]GitMr, error) {
	apiURLStr := models.AppConfig.CodeHub.GetMRsURL
	if apiURLStr == "" {
		return nil, fmt.Errorf("CodeHub GetMRsURL is not configured")
	}

	apiURLStr = strings.ReplaceAll(apiURLStr, "{REPO_ID}", projectID)
	apiURLStr = strings.ReplaceAll(apiURLStr, "{PROJECT_ID}", projectID)

	// 融合 Header 配置
	reqHeaders := make(map[string]string)
	for k, v := range models.AppConfig.CodeHub.Headers {
		reqHeaders[k] = v
	}
	for k, v := range contextHeaders {
		reqHeaders[k] = v
	}

	body, err := utils.SendHTTPRequest(ctx, "GET", apiURLStr, nil, utils.HTTPOptions{
		Headers: reqHeaders,
	}, []int{http.StatusOK}, "GetMrListFromGitRemote")
	if err != nil {
		return nil, fmt.Errorf("failed to fetch merge requests from remote CodeHub: %w", err)
	}

	type rawGitMr struct {
		ID                 interface{} `json:"id"`
		Iid                int64       `json:"iid"`
		Title              string      `json:"title"`
		State              string      `json:"state"`
		Description        string      `json:"description"`
		TargetBranch       string      `json:"target_branch"`
		TargetBranchCamel  string      `json:"targetBranch"`
		SourceBranch       string      `json:"source_branch"`
		SourceBranchCamel  string      `json:"sourceBranch"`
		WebURL             string      `json:"web_url"`
		WebURLCamel        string      `json:"webUrl"`
		Author             GitMrAuthor `json:"author"`
		CreatedAt          string      `json:"created_at"`
		UpdatedAt          string      `json:"updated_at"`
	}

	var rawList []rawGitMr
	if err := json.Unmarshal(body, &rawList); err != nil {
		// 容错机制：尝试解析 {"status": "success", "result": [...] }
		var wrapped struct {
			Status string     `json:"status"`
			Result []rawGitMr `json:"result"`
		}
		if err2 := json.Unmarshal(body, &wrapped); err2 == nil && wrapped.Status == "success" {
			rawList = wrapped.Result
		} else {
			log.Printf("[GetMrListFromGitRemote] Unmarshal failed: %v. Body: %s", err, string(body))
			return nil, fmt.Errorf("failed to parse merge requests response: %w", err)
		}
	}

	mrs := make([]GitMr, 0, len(rawList))
	for _, r := range rawList {
		tb := r.TargetBranch
		if tb == "" {
			tb = r.TargetBranchCamel
		}
		sb := r.SourceBranch
		if sb == "" {
			sb = r.SourceBranchCamel
		}
		wu := r.WebURL
		if wu == "" {
			wu = r.WebURLCamel
		}
		mrs = append(mrs, GitMr{
			ID:           r.ID,
			Iid:          r.Iid,
			Title:        r.Title,
			State:        r.State,
			Description:  r.Description,
			TargetBranch: tb,
			SourceBranch: sb,
			WebURL:       wu,
			RepoName:     repoName,
			Author:       r.Author,
			CreatedAt:    r.CreatedAt,
			UpdatedAt:    r.UpdatedAt,
		})
	}

	return mrs, nil
}

// RemoteBranchDetail 用于历史僵尸/非活动分支大盘审计的分支详情
type RemoteBranchDetail struct {
	Name           string    `json:"name"`
	LastCommitHash string    `json:"last_commit_hash"`
	LastCommitTime time.Time `json:"last_commit_time"`
	LastAuthor     string    `json:"last_author"`
	IsMerged       bool      `json:"is_merged"`
	IsProtected    bool      `json:"is_protected"`
}

// GitPlatformBaseURL 远程 Git 平台接口的 BaseURL，由配置解析并填充，可由单元测试重定向 Mock
var GitPlatformBaseURL string

// InitGitPlatform 根据全局配置初始化远程 Git 平台地址
func InitGitPlatform() {
	if models.AppConfig.CodeHub.BaseURL != "" {
		GitPlatformBaseURL = models.AppConfig.CodeHub.BaseURL
	}
}

// CreateRemoteRepo 使用超级管理员权限在远程 Git 平台创建代码仓，并融合鉴权 Header
func CreateRemoteRepo(ctx context.Context, name string, groupPath string) (uint, string, string, error) {
	apiURL := GitPlatformBaseURL + "/projects"

	reqHeaders := make(map[string]string)
	for k, v := range models.AppConfig.CodeHub.Headers {
		reqHeaders[k] = v
	}
	reqHeaders["Accept"] = "application/json"
	reqHeaders["Content-Type"] = "application/json"

	bodyStr := models.AppConfig.CodeHub.CreateRepoBody
	bodyStr = strings.ReplaceAll(bodyStr, "{REPO_NAME}", name)
	bodyStr = strings.ReplaceAll(bodyStr, "{GROUP_PATH}", groupPath)

	body, err := utils.SendHTTPRequest(ctx, "POST", apiURL, json.RawMessage([]byte(bodyStr)), utils.HTTPOptions{
		Headers: reqHeaders,
	}, []int{http.StatusOK, http.StatusCreated}, "CreateRemoteRepo")
	if err != nil {
		return 0, "", "", fmt.Errorf("failed to create remote repo: %w", err)
	}

	var resp struct {
		ID      uint   `json:"id"`
		SSHURL  string `json:"ssh_url"`
		HTTPURL string `json:"http_url"`
	}

	if err := json.Unmarshal(body, &resp); err != nil {
		var wrapped struct {
			Status string `json:"status"`
			Result struct {
				ID      uint   `json:"id"`
				SSHURL  string `json:"ssh_url"`
				HTTPURL string `json:"http_url"`
			} `json:"result"`
		}
		if err2 := json.Unmarshal(body, &wrapped); err2 == nil && wrapped.Status == "success" {
			resp.ID = wrapped.Result.ID
			resp.SSHURL = wrapped.Result.SSHURL
			resp.HTTPURL = wrapped.Result.HTTPURL
		} else {
			return 0, "", "", fmt.Errorf("failed to parse create repo response: %w", err)
		}
	}

	return resp.ID, resp.SSHURL, resp.HTTPURL, nil
}

// CreateRemoteBranch 使用超级管理员权限在远程 Git 平台创建分支，并融合鉴权 Header
func CreateRemoteBranch(ctx context.Context, projectID string, branchName string, ref string) error {
	apiURL := fmt.Sprintf("%s/projects/%s/branches", GitPlatformBaseURL, projectID)

	reqHeaders := make(map[string]string)
	for k, v := range models.AppConfig.CodeHub.Headers {
		reqHeaders[k] = v
	}
	reqHeaders["Accept"] = "application/json"
	reqHeaders["Content-Type"] = "application/json"

	bodyStr := models.AppConfig.CodeHub.CreateBranchBody
	bodyStr = strings.ReplaceAll(bodyStr, "{BRANCH_NAME}", branchName)
	bodyStr = strings.ReplaceAll(bodyStr, "{SOURCE_REF}", ref)

	_, err := utils.SendHTTPRequest(ctx, "POST", apiURL, json.RawMessage([]byte(bodyStr)), utils.HTTPOptions{
		Headers: reqHeaders,
	}, []int{http.StatusOK, http.StatusCreated, http.StatusAccepted}, "CreateRemoteBranch")
	if err != nil {
		return fmt.Errorf("failed to create remote branch: %w", err)
	}
	return nil
}

// ConfigureBranchProtection 使用超级管理员权限在远程 Git 平台设置保护分支规则，并融合鉴权 Header
func ConfigureBranchProtection(ctx context.Context, projectID string, branchPattern string) error {
	apiURL := fmt.Sprintf("%s/projects/%s/protected_branches", GitPlatformBaseURL, projectID)

	reqHeaders := make(map[string]string)
	for k, v := range models.AppConfig.CodeHub.Headers {
		reqHeaders[k] = v
	}
	reqHeaders["Accept"] = "application/json"
	reqHeaders["Content-Type"] = "application/json"

	bodyStr := models.AppConfig.CodeHub.ConfigureProtectionBody
	bodyStr = strings.ReplaceAll(bodyStr, "{BRANCH_PATTERN}", branchPattern)

	_, err := utils.SendHTTPRequest(ctx, "POST", apiURL, json.RawMessage([]byte(bodyStr)), utils.HTTPOptions{
		Headers: reqHeaders,
	}, []int{http.StatusOK, http.StatusCreated, http.StatusAccepted, http.StatusNoContent}, "ConfigureBranchProtection")
	if err != nil {
		return fmt.Errorf("failed to configure branch protection: %w", err)
	}
	return nil
}

// ConfigureRemoteACL 使用超级管理员权限在远程 Git 平台授权成员/用户组，并融合鉴权 Header
func ConfigureRemoteACL(ctx context.Context, targetType string, targetID string, principalType string, principalID string, accessLevel int) error {
	var apiURL string
	if targetType == "repository" {
		apiURL = fmt.Sprintf("%s/projects/%s/members", GitPlatformBaseURL, targetID)
	} else if targetType == "group" {
		apiURL = fmt.Sprintf("%s/groups/%s/members", GitPlatformBaseURL, targetID)
	} else {
		return fmt.Errorf("invalid target type: %s", targetType)
	}

	reqHeaders := make(map[string]string)
	for k, v := range models.AppConfig.CodeHub.Headers {
		reqHeaders[k] = v
	}
	reqHeaders["Accept"] = "application/json"
	reqHeaders["Content-Type"] = "application/json"

	bodyStr := models.AppConfig.CodeHub.ConfigureACLBody
	bodyStr = strings.ReplaceAll(bodyStr, "{PRINCIPAL_TYPE}", principalType)
	bodyStr = strings.ReplaceAll(bodyStr, "{PRINCIPAL_ID}", principalID)
	bodyStr = strings.ReplaceAll(bodyStr, "{ACCESS_LEVEL}", strconv.Itoa(accessLevel))

	_, err := utils.SendHTTPRequest(ctx, "POST", apiURL, json.RawMessage([]byte(bodyStr)), utils.HTTPOptions{
		Headers: reqHeaders,
	}, []int{http.StatusOK, http.StatusCreated, http.StatusAccepted, http.StatusNoContent}, "ConfigureRemoteACL")
	if err != nil {
		return fmt.Errorf("failed to configure remote ACL: %w", err)
	}
	return nil
}

// GetRemoteBranchesDetail 调用托管平台超级管理员接口获取包含最后Commit信息的全量分支明细，并融合鉴权 Header
func GetRemoteBranchesDetail(ctx context.Context, projectID string) ([]RemoteBranchDetail, error) {
	apiURL := fmt.Sprintf("%s/projects/%s/branches_detail", GitPlatformBaseURL, projectID)

	reqHeaders := make(map[string]string)
	for k, v := range models.AppConfig.CodeHub.Headers {
		reqHeaders[k] = v
	}
	reqHeaders["Accept"] = "application/json"
	reqHeaders["Content-Type"] = "application/json"

	body, err := utils.SendHTTPRequest(ctx, "GET", apiURL, nil, utils.HTTPOptions{
		Headers: reqHeaders,
	}, []int{http.StatusOK}, "GetRemoteBranchesDetail")
	if err != nil {
		return nil, err
	}

	type RemoteResp struct {
		Status string               `json:"status"`
		Result []RemoteBranchDetail `json:"result"`
	}

	var resp RemoteResp
	if err := json.Unmarshal(body, &resp); err == nil && resp.Status == "success" {
		return resp.Result, nil
	}

	// 容错处理：若没有 status 包装，直接解析为数组
	var list []RemoteBranchDetail
	if err := json.Unmarshal(body, &list); err != nil {
		return nil, fmt.Errorf("failed to parse branches detail JSON: %w", err)
	}

	return list, nil
}

// RemoteSubgroup 远程子群组
type RemoteSubgroup struct {
	ID       uint   `json:"id"`
	Name     string `json:"name"`
	Path     string `json:"path"`
	FullPath string `json:"full_path"`
}

// RemoteProject 远程项目
type RemoteProject struct {
	ID            uint   `json:"id"`
	Name          string `json:"name"`
	SSHURL        string `json:"ssh_url"`
	HTTPURL       string `json:"http_url"`
	SSHURLToRepo  string `json:"ssh_url_to_repo"`
	HTTPURLToRepo string `json:"http_url_to_repo"`
}

// GetRemoteGroupDetails 获取远程 Group 详情，用于转换本地自增 ID 为 Codehub 真实 ID
func GetRemoteGroupDetails(ctx context.Context, fullPath string) (uint, error) {
	apiURL := fmt.Sprintf("%s/groups?search=%s", GitPlatformBaseURL, url.QueryEscape(fullPath))

	reqHeaders := make(map[string]string)
	for k, v := range models.AppConfig.CodeHub.Headers {
		reqHeaders[k] = v
	}

	body, err := utils.SendHTTPRequest(ctx, "GET", apiURL, nil, utils.HTTPOptions{
		Headers: reqHeaders,
	}, []int{http.StatusOK}, "GetRemoteGroupDetails")
	if err != nil {
		return 0, fmt.Errorf("failed to fetch group details: %w", err)
	}

	type GroupDetail struct {
		ID       uint   `json:"id"`
		FullPath string `json:"full_path"`
	}

	type WrappedResp struct {
		Status string        `json:"status"`
		Result []GroupDetail `json:"result"`
	}

	var resp WrappedResp
	if err := json.Unmarshal(body, &resp); err == nil && resp.Status == "success" {
		for _, g := range resp.Result {
			if g.FullPath == fullPath {
				return g.ID, nil
			}
		}
		if len(resp.Result) > 0 {
			return resp.Result[0].ID, nil
		}
		return 0, fmt.Errorf("group not found with full_path: %s", fullPath)
	}

	var list []GroupDetail
	if err := json.Unmarshal(body, &list); err != nil {
		return 0, fmt.Errorf("failed to parse group details list JSON: %w", err)
	}

	for _, g := range list {
		if g.FullPath == fullPath {
			return g.ID, nil
		}
	}
	if len(list) > 0 {
		return list[0].ID, nil
	}

	return 0, fmt.Errorf("group not found with full_path: %s", fullPath)
}

// GetRemoteSubgroups 获取远程子群组列表
func GetRemoteSubgroups(ctx context.Context, groupID uint) ([]RemoteSubgroup, error) {
	apiURL := fmt.Sprintf("%s/groups/%d/subgroups", GitPlatformBaseURL, groupID)

	reqHeaders := make(map[string]string)
	for k, v := range models.AppConfig.CodeHub.Headers {
		reqHeaders[k] = v
	}

	body, err := utils.SendHTTPRequest(ctx, "GET", apiURL, nil, utils.HTTPOptions{
		Headers: reqHeaders,
	}, []int{http.StatusOK}, "GetRemoteSubgroups")
	if err != nil {
		return nil, fmt.Errorf("failed to fetch remote subgroups: %w", err)
	}

	type WrappedResp struct {
		Status string           `json:"status"`
		Result []RemoteSubgroup `json:"result"`
	}

	var resp WrappedResp
	if err := json.Unmarshal(body, &resp); err == nil && resp.Status == "success" {
		return resp.Result, nil
	}

	var list []RemoteSubgroup
	if err := json.Unmarshal(body, &list); err != nil {
		return nil, fmt.Errorf("failed to parse subgroups JSON: %w", err)
	}

	return list, nil
}

// GetRemoteProjects 获取群组下的远程项目列表
func GetRemoteProjects(ctx context.Context, groupID uint) ([]RemoteProject, error) {
	apiURL := fmt.Sprintf("%s/groups/%d/projects", GitPlatformBaseURL, groupID)

	reqHeaders := make(map[string]string)
	for k, v := range models.AppConfig.CodeHub.Headers {
		reqHeaders[k] = v
	}

	body, err := utils.SendHTTPRequest(ctx, "GET", apiURL, nil, utils.HTTPOptions{
		Headers: reqHeaders,
	}, []int{http.StatusOK}, "GetRemoteProjects")
	if err != nil {
		return nil, fmt.Errorf("failed to fetch remote projects: %w", err)
	}

	type WrappedResp struct {
		Status string          `json:"status"`
		Result []RemoteProject `json:"result"`
	}

	var resp WrappedResp
	if err := json.Unmarshal(body, &resp); err == nil && resp.Status == "success" {
		return resp.Result, nil
	}

	var list []RemoteProject
	if err := json.Unmarshal(body, &list); err != nil {
		return nil, fmt.Errorf("failed to parse projects JSON: %w", err)
	}

	return list, nil
}
