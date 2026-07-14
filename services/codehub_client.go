package services

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

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
		apiURLStr = "http://192.168.56.18:9080/api/v1/projects/{REPO_ID}/merge_requests"
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
