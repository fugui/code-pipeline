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
		ID                interface{} `json:"id"`
		Iid               int64       `json:"iid"`
		Title             string      `json:"title"`
		State             string      `json:"state"`
		Description       string      `json:"description"`
		TargetBranch      string      `json:"target_branch"`
		TargetBranchCamel string      `json:"targetBranch"`
		SourceBranch      string      `json:"source_branch"`
		SourceBranchCamel string      `json:"sourceBranch"`
		WebURL            string      `json:"web_url"`
		WebURLCamel       string      `json:"webUrl"`
		Author            GitMrAuthor `json:"author"`
		CreatedAt         string      `json:"created_at"`
		UpdatedAt         string      `json:"updated_at"`
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

// FormatTagList 将输入的标签字符串格式化为可直接嵌入 JSON 数组的带引号字符串切片 (例如 `"A","B","CodeShield"`)
func FormatTagList(tags string) string {
	tags = strings.TrimSpace(tags)
	var rawItems []string

	if tags != "" {
		if strings.HasPrefix(tags, "[") && strings.HasSuffix(tags, "]") {
			var jsonList []string
			if err := json.Unmarshal([]byte(tags), &jsonList); err == nil {
				rawItems = jsonList
			} else {
				trimmed := strings.TrimSuffix(strings.TrimPrefix(tags, "["), "]")
				rawItems = strings.FieldsFunc(trimmed, func(r rune) bool {
					return r == ',' || r == '，' || r == '\n' || r == '\t'
				})
			}
		} else {
			rawItems = strings.FieldsFunc(tags, func(r rune) bool {
				return r == ',' || r == '，' || r == '\n' || r == '\t'
			})
		}
	}

	var items []string
	seen := make(map[string]bool)

	for _, item := range rawItems {
		trimmed := strings.TrimSpace(item)
		trimmed = strings.Trim(trimmed, "\"'`")
		if trimmed != "" && !seen[strings.ToLower(trimmed)] {
			seen[strings.ToLower(trimmed)] = true
			items = append(items, fmt.Sprintf("%q", trimmed))
		}
	}

	// 自动追加 "CodeShield" 标签说明是系统创建
	if !seen["codeshield"] {
		items = append(items, fmt.Sprintf("%q", "CodeShield"))
	}

	return strings.Join(items, ",")
}

// CreateRemoteRepo 使用超级管理员权限在远程 Git 平台创建代码仓，并融合鉴权 Header
func CreateRemoteRepo(ctx context.Context, name string, groupPath string, groupID uint, tags string, description string) (uint, string, string, error) {
	apiURL := GitPlatformBaseURL + "/projects"

	reqHeaders := make(map[string]string)
	for k, v := range models.AppConfig.CodeHub.Headers {
		reqHeaders[k] = v
	}
	reqHeaders["Accept"] = "application/json"
	reqHeaders["Content-Type"] = "application/json"

	payload, err := utils.RenderJSONTemplate(models.AppConfig.CodeHub.CreateRepoBody, map[string]string{
		"REPO_NAME":   name,
		"GROUP_PATH":  groupPath,
		"GROUP_ID":    strconv.Itoa(int(groupID)),
		"TAG_LIST":    FormatTagList(tags),
		"DESCRIPTION": description,
	})
	if err != nil {
		return 0, "", "", fmt.Errorf("failed to render create repo template: %w", err)
	}

	body, err := utils.SendHTTPRequest(ctx, "POST", apiURL, payload, utils.HTTPOptions{
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

	payload, err := utils.RenderJSONTemplate(models.AppConfig.CodeHub.CreateBranchBody, map[string]string{
		"BRANCH_NAME": branchName,
		"SOURCE_REF":  ref,
	})
	if err != nil {
		return fmt.Errorf("failed to render create branch template: %w", err)
	}

	_, err = utils.SendHTTPRequest(ctx, "POST", apiURL, payload, utils.HTTPOptions{
		Headers: reqHeaders,
	}, []int{http.StatusOK, http.StatusCreated, http.StatusAccepted}, "CreateRemoteBranch")
	if err != nil {
		return fmt.Errorf("failed to create remote branch: %w", err)
	}
	return nil
}

// DeleteRemoteBranch 使用超级管理员权限在远程 Git 平台物理删除指定分支
func DeleteRemoteBranch(ctx context.Context, projectID string, branchName string) error {
	encodedBranch := url.PathEscape(branchName)
	apiURL := fmt.Sprintf("%s/projects/%s/repository/branches/%s", GitPlatformBaseURL, projectID, encodedBranch)

	reqHeaders := make(map[string]string)
	for k, v := range models.AppConfig.CodeHub.Headers {
		reqHeaders[k] = v
	}
	reqHeaders["Accept"] = "application/json"
	reqHeaders["Content-Type"] = "application/json"

	_, err := utils.SendHTTPRequest(ctx, "DELETE", apiURL, nil, utils.HTTPOptions{
		Headers: reqHeaders,
	}, []int{http.StatusOK, http.StatusNoContent, http.StatusAccepted}, "DeleteRemoteBranch")
	if err != nil {
		return fmt.Errorf("failed to delete remote branch %s: %w", branchName, err)
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

	payload, err := utils.RenderJSONTemplate(models.AppConfig.CodeHub.ConfigureProtectionBody, map[string]string{
		"BRANCH_PATTERN": branchPattern,
	})
	if err != nil {
		return fmt.Errorf("failed to render branch protection template: %w", err)
	}

	_, err = utils.SendHTTPRequest(ctx, "POST", apiURL, payload, utils.HTTPOptions{
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

	payload, err := utils.RenderJSONTemplate(models.AppConfig.CodeHub.ConfigureACLBody, map[string]string{
		"PRINCIPAL_TYPE": principalType,
		"PRINCIPAL_ID":   principalID,
		"ACCESS_LEVEL":   strconv.Itoa(accessLevel),
	})
	if err != nil {
		return fmt.Errorf("failed to render configure ACL template: %w", err)
	}

	_, err = utils.SendHTTPRequest(ctx, "POST", apiURL, payload, utils.HTTPOptions{
		Headers: reqHeaders,
	}, []int{http.StatusOK, http.StatusCreated, http.StatusAccepted, http.StatusNoContent}, "ConfigureRemoteACL")
	if err != nil {
		return fmt.Errorf("failed to configure remote ACL: %w", err)
	}
	return nil
}

// RemoteRepoDetail 远程仓库基本信息详情 (对应 body.json)
type RemoteRepoDetail struct {
	ID                       uint     `json:"id"`
	Name                     string   `json:"name"`
	NameWithNamespace        string   `json:"name_with_namespace"`
	Path                     string   `json:"path"`
	PathWithNamespace        string   `json:"path_with_namespace"`
	Description              string   `json:"description"`
	DefaultBranch            string   `json:"default_branch"`
	MainRepositoryLanguage   *string  `json:"main_repository_language"`
	Visibility               string   `json:"visibility"`
	Security                 string   `json:"security"`
	NetworkType              string   `json:"network_type"`
	IsKIA                    bool     `json:"is_kia"`
	Archived                 bool     `json:"archived"`
	EmptyRepo                bool     `json:"empty_repo"`
	MergeRequestsEnabled     bool     `json:"merge_requests_enabled"`
	IssuesEnabled            bool     `json:"issues_enabled"`
	WikiEnabled              bool     `json:"wiki_enabled"`
	JobsEnabled              bool     `json:"jobs_enabled"`
	ContainerRegistryEnabled bool     `json:"container_registry_enabled"`
	SharedRunnersEnabled     bool     `json:"shared_runners_enabled"`
	PublicJobs               bool     `json:"public_jobs"`
	LFSEnabled               bool     `json:"lfs_enabled"`
	RequestAccessEnabled     bool     `json:"request_access_enabled"`
	MergeMethod              string   `json:"merge_method"`
	OnlyAllowMergeIfPipelineSucceeds bool `json:"only_allow_merge_if_pipeline_succeeds"`
	OnlyAllowMergeIfAllDiscussionsAreResolved bool `json:"only_allow_merge_if_all_discussions_are_resolved"`
	ResolveOutdatedDiffDiscussions bool `json:"resolve_outdated_diff_discussions"`
	BranchCount              int      `json:"branch_count"`
	TagCount                 int      `json:"tag_count"`
	MemberCount              int      `json:"member_count"`
	Statistics               struct {
		CommitCount      int     `json:"commit_count"`
		StorageSize      float64 `json:"storage_size"`
		RepositorySize   float64 `json:"repository_size"`
		LfsObjectsSize   float64 `json:"lfs_objects_size"`
		JobArtifactsSize float64 `json:"job_artifacts_size"`
	} `json:"statistics"`
	Creator struct {
		ID       uint   `json:"id"`
		Name     string `json:"name"`
		Username string `json:"username"`
		Email    string `json:"email"`
		NameCn   string `json:"name_cn"`
	} `json:"creator"`
}

// RemoteMrSetting 远程代码仓 MR 设置详情 (对应 mr_setting.json)
type RemoteMrSetting struct {
	MergeRequestSetting struct {
		ID                               uint   `json:"id"`
		ProjectID                        uint   `json:"project_id"`
		DisableMergeBySelf               bool   `json:"disable_merge_by_self"`
		CanForceMerge                    bool   `json:"can_force_merge"`
		ResetApprovalsOnPush             bool   `json:"reset_approvals_on_push"`
		ResetReviewersOnPush             bool   `json:"reset_reviewers_on_push"`
		ReviewMode                       string `json:"review_mode"`
		ApprovalRequiredReviewers        int    `json:"approval_required_reviewers"`
		ApprovalRequiredApprovers        int    `json:"approval_required_approvers"`
		OnlyCommitterCanApprove          bool   `json:"only_committer_can_approve"`
		CommitterMustCastTwoVotes        bool   `json:"committer_must_cast_two_votes"`
		OnlyAllowMergeIfVoteBiggerThan   int    `json:"only_allow_merge_if_vote_bigger_than"`
		MustPassQualityGate              bool   `json:"must_pass_quality_gate"`
		MrCodeCheck                      bool   `json:"mr_codecheck"`
		ForcedRebuildPipelineBeforeMerge  bool   `json:"forced_rebuild_pipeline_before_merge"`
		SourceBranchPipelineMustSucceeds bool   `json:"source_branch_pipeline_must_succeeds"`
		NewestPremergePipelineMustSucceeds bool `json:"newest_premerge_pipeline_must_succeeds"`
		MustRelateIssue                  bool   `json:"must_relate_issue"`
		NeedAllIssuesCheckPassed         bool   `json:"need_all_issues_check_passed"`
		DeleteSourceBranchWhenMerged     bool   `json:"delete_source_branch_when_merged"`
		AutoSquashMerge                  bool   `json:"auto_squash_merge"`
		ForbiddenGuestCreateMr           bool   `json:"forbidden_guest_create_mr"`
		CloseIssueWhenMrMerged           bool   `json:"close_issue_when_mr_merged"`
		EvaluationMergeGate              bool   `json:"evaluation_merge_gate"`
	} `json:"merge_request_setting"`
	OnlyAllowMergeIfAllDiscussionsAreResolved bool   `json:"only_allow_merge_if_all_discussions_are_resolved"`
	OnlyAllowMergeIfPipelineSucceeds          bool   `json:"only_allow_merge_if_pipeline_succeeds"`
	MergeMethod                               string `json:"merge_method"`
	OnlyAllowMergeIfVoteBiggerThan           int    `json:"only_allow_merge_if_vote_bigger_than"`
}

// GetRemoteRepoDetail 调用托管平台接口获取特定代码仓的详细信息
func GetRemoteRepoDetail(ctx context.Context, projectID string) (*RemoteRepoDetail, error) {
	apiURL := fmt.Sprintf("%s/projects/%s", GitPlatformBaseURL, projectID)

	reqHeaders := make(map[string]string)
	for k, v := range models.AppConfig.CodeHub.Headers {
		reqHeaders[k] = v
	}
	reqHeaders["Accept"] = "application/json"

	body, err := utils.SendHTTPRequest(ctx, "GET", apiURL, nil, utils.HTTPOptions{
		Headers: reqHeaders,
	}, []int{http.StatusOK}, "GetRemoteRepoDetail")
	if err != nil {
		return nil, err
	}

	type WrappedResp struct {
		Status string           `json:"status"`
		Result RemoteRepoDetail `json:"result"`
	}

	var resp WrappedResp
	if err := json.Unmarshal(body, &resp); err == nil && resp.Status == "success" && resp.Result.ID > 0 {
		return &resp.Result, nil
	}

	var detail RemoteRepoDetail
	if err := json.Unmarshal(body, &detail); err != nil {
		return nil, fmt.Errorf("failed to parse project details JSON: %w", err)
	}

	return &detail, nil
}

// GetRemoteMrSetting 调用托管平台接口获取特定代码仓的 MR 设置信息
func GetRemoteMrSetting(ctx context.Context, projectID string) (*RemoteMrSetting, error) {
	apiURL := fmt.Sprintf("%s/projects/%s/merge_requests/settings", GitPlatformBaseURL, projectID)

	reqHeaders := make(map[string]string)
	for k, v := range models.AppConfig.CodeHub.Headers {
		reqHeaders[k] = v
	}
	reqHeaders["Accept"] = "application/json"

	body, err := utils.SendHTTPRequest(ctx, "GET", apiURL, nil, utils.HTTPOptions{
		Headers: reqHeaders,
	}, []int{http.StatusOK}, "GetRemoteMrSetting")
	if err != nil {
		return nil, err
	}

	type WrappedResp struct {
		Status string          `json:"status"`
		Result RemoteMrSetting `json:"result"`
	}

	var resp WrappedResp
	if err := json.Unmarshal(body, &resp); err == nil && resp.Status == "success" {
		return &resp.Result, nil
	}

	var setting RemoteMrSetting
	if err := json.Unmarshal(body, &setting); err != nil {
		return nil, fmt.Errorf("failed to parse mr settings JSON: %w", err)
	}

	return &setting, nil
}

// GetRemoteProjectBranchCount 调用托管平台接口获取特定代码仓的分支总数
func GetRemoteProjectBranchCount(ctx context.Context, projectID string) (int, error) {
	detail, err := GetRemoteRepoDetail(ctx, projectID)
	if err != nil {
		return 0, err
	}
	return detail.BranchCount, nil
}

// GetRemoteBranchesDetail 分页调用托管平台接口获取包含最后Commit信息的全量分支明细，并进行多页数据合并
func GetRemoteBranchesDetail(ctx context.Context, projectID string, branchCount int) ([]RemoteBranchDetail, error) {
	perPage := 100
	totalPages := 1
	if branchCount > 0 {
		totalPages = (branchCount + perPage - 1) / perPage
	}

	reqHeaders := make(map[string]string)
	for k, v := range models.AppConfig.CodeHub.Headers {
		reqHeaders[k] = v
	}
	reqHeaders["Accept"] = "application/json"
	reqHeaders["Content-Type"] = "application/json"

	var allBranches []RemoteBranchDetail

	for page := 1; page <= totalPages; page++ {
		apiURL := fmt.Sprintf("%s/projects/%s/repository/branches?page=%d&per_page=%d", GitPlatformBaseURL, projectID, page, perPage)

		body, err := utils.SendHTTPRequest(ctx, "GET", apiURL, nil, utils.HTTPOptions{
			Headers: reqHeaders,
		}, []int{http.StatusOK}, "GetRemoteBranchesDetail")
		if err != nil {
			return nil, err
		}

		type CodehubBranchResp struct {
			Name      string `json:"name"`
			Merged    bool   `json:"merged"`
			Protected bool   `json:"protected"`
			Commit    struct {
				ID            string    `json:"id"`
				CommittedDate time.Time `json:"committed_date"`
				AuthorName    string    `json:"author_name"`
			} `json:"commit"`
		}

		type RemoteResp struct {
			Status string              `json:"status"`
			Result []CodehubBranchResp `json:"result"`
		}

		var pageItems []CodehubBranchResp
		var resp RemoteResp
		if err := json.Unmarshal(body, &resp); err == nil && resp.Status == "success" {
			pageItems = resp.Result
		} else {
			var list []CodehubBranchResp
			if err := json.Unmarshal(body, &list); err != nil {
				return nil, fmt.Errorf("failed to parse page %d branches JSON: %w", page, err)
			}
			pageItems = list
		}

		for _, item := range pageItems {
			allBranches = append(allBranches, RemoteBranchDetail{
				Name:           item.Name,
				LastCommitHash: item.Commit.ID,
				LastCommitTime: item.Commit.CommittedDate,
				LastAuthor:     item.Commit.AuthorName,
				IsMerged:       item.Merged,
				IsProtected:    item.Protected,
			})
		}

		if len(pageItems) < perPage {
			break
		}
	}

	return allBranches, nil
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
	Archived      bool   `json:"archived"`
}

// GetRemoteGroupDetails 获取远程 Group 详情，用于转换本地自增 ID 为 Codehub 真实 ID
func GetRemoteGroupDetails(ctx context.Context, fullPath string) (uint, error) {
	apiURL := fmt.Sprintf("%s/groups?search=%s&all_available=true", GitPlatformBaseURL, url.QueryEscape(fullPath))

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

// GetRemoteSubgroups 获取远程子群组列表 (支持多页合并)
func GetRemoteSubgroups(ctx context.Context, groupID uint) ([]RemoteSubgroup, error) {
	var allSubgroups []RemoteSubgroup
	page := 1
	perPage := 100

	for {
		apiURL := fmt.Sprintf("%s/groups/%d/subgroups?all_available=true&page=%d&per_page=%d", GitPlatformBaseURL, groupID, page, perPage)

		reqHeaders := make(map[string]string)
		for k, v := range models.AppConfig.CodeHub.Headers {
			reqHeaders[k] = v
		}

		body, err := utils.SendHTTPRequest(ctx, "GET", apiURL, nil, utils.HTTPOptions{
			Headers: reqHeaders,
		}, []int{http.StatusOK}, "GetRemoteSubgroups")
		if err != nil {
			return nil, fmt.Errorf("failed to fetch remote subgroups page %d: %w", page, err)
		}

		type WrappedResp struct {
			Status string           `json:"status"`
			Result []RemoteSubgroup `json:"result"`
		}

		var pageList []RemoteSubgroup
		var resp WrappedResp
		if err := json.Unmarshal(body, &resp); err == nil && resp.Status == "success" {
			pageList = resp.Result
		} else {
			var list []RemoteSubgroup
			if err := json.Unmarshal(body, &list); err != nil {
				return nil, fmt.Errorf("failed to parse subgroups JSON at page %d: %w", page, err)
			}
			pageList = list
		}

		if len(pageList) == 0 {
			break
		}

		allSubgroups = append(allSubgroups, pageList...)
		if len(pageList) < perPage {
			break
		}
		page++
	}

	return allSubgroups, nil
}

// GetRemoteProjects 获取群组下的远程项目列表 (支持多页合并)
func GetRemoteProjects(ctx context.Context, groupID uint) ([]RemoteProject, error) {
	var allProjects []RemoteProject
	page := 1
	perPage := 100

	for {
		apiURL := fmt.Sprintf("%s/groups/%d/projects?all_available=true&page=%d&per_page=%d", GitPlatformBaseURL, groupID, page, perPage)

		reqHeaders := make(map[string]string)
		for k, v := range models.AppConfig.CodeHub.Headers {
			reqHeaders[k] = v
		}

		body, err := utils.SendHTTPRequest(ctx, "GET", apiURL, nil, utils.HTTPOptions{
			Headers: reqHeaders,
		}, []int{http.StatusOK}, "GetRemoteProjects")
		if err != nil {
			return nil, fmt.Errorf("failed to fetch remote projects page %d: %w", page, err)
		}

		type WrappedResp struct {
			Status string          `json:"status"`
			Result []RemoteProject `json:"result"`
		}

		var pageList []RemoteProject
		var resp WrappedResp
		if err := json.Unmarshal(body, &resp); err == nil && resp.Status == "success" {
			pageList = resp.Result
		} else {
			var list []RemoteProject
			if err := json.Unmarshal(body, &list); err != nil {
				return nil, fmt.Errorf("failed to parse projects JSON at page %d: %w", page, err)
			}
			pageList = list
		}

		if len(pageList) == 0 {
			break
		}

		allProjects = append(allProjects, pageList...)
		if len(pageList) < perPage {
			break
		}
		page++
	}

	return allProjects, nil
}
