package services

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"code-pipeline/database"
	"code-pipeline/models"

	"github.com/golang-jwt/jwt/v5"
)

// GenerateSystemToken 生成系统间调用的 JWT 令牌
func GenerateSystemToken() (string, error) {
	secret := []byte(models.AppConfig.Auth.JWTSecret)
	claims := jwt.MapClaims{
		"user_id":  models.AppConfig.Auth.SystemUserID,
		"email":    "admin@code-shield.com",
		"name":     "SystemSync",
		"is_admin": true,
		"exp":      time.Now().Add(5 * time.Minute).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(secret)
}

// StartRepoSyncTimer 开启后台代码仓定时拉取任务
func StartRepoSyncTimer(ctx context.Context) {
	log.Println("[RepoSync] Starting repo sync timer (every 5 minutes)...")
	ticker := time.NewTicker(5 * time.Minute)

	// 启动时立即执行一次同步
	go syncReposOnce()

	go func() {
		for {
			select {
			case <-ticker.C:
				syncReposOnce()
			case <-ctx.Done():
				ticker.Stop()
				log.Println("[RepoSync] Stopped repo sync timer")
				return
			}
		}
	}()
}

func syncReposOnce() {
	log.Println("[RepoSync] Pulling repository updates from code-bench...")
	repos, err := fetchReposFromCodeBench()
	if err != nil {
		log.Printf("[RepoSync] Error fetching repositories: %v", err)
		return
	}

	log.Printf("[RepoSync] Found %d repositories. Syncing to local DB...", len(repos))
	db := database.DB

	// 增量同步
	activeIDs := make(map[uint]bool)
	for _, repo := range repos {
		activeIDs[repo.ID] = true
		var existing models.Repository
		if err := db.First(&existing, repo.ID).Error; err != nil {
			// 新增
			newRepo := models.Repository{
				ID:        repo.ID,
				Name:      repo.Name,
				URL:       repo.URL,
				OwnerID:   repo.OwnerID,
				IsActive:  repo.IsActive,
				ProjectID: repo.ProjectID,
				CreatedAt: repo.CreatedAt,
			}
			if err := db.Create(&newRepo).Error; err != nil {
				log.Printf("[RepoSync] Failed to create repo ID %d: %v", repo.ID, err)
			}
		} else {
			// 更新
			if err := db.Model(&existing).Updates(map[string]interface{}{
				"name":       repo.Name,
				"url":        repo.URL,
				"owner_id":   repo.OwnerID,
				"is_active":  repo.IsActive,
				"project_id": repo.ProjectID,
			}).Error; err != nil {
				log.Printf("[RepoSync] Failed to update repo ID %d: %v", repo.ID, err)
			}
		}
	}

	// 删除本地镜像中已被 code-bench 删除的仓库
	var allRepos []models.Repository
	if err := db.Find(&allRepos).Error; err == nil {
		for _, local := range allRepos {
			if !activeIDs[local.ID] {
				log.Printf("[RepoSync] Repository ID %d deleted from code-bench. Deleting from local mirrored db...", local.ID)
				db.Delete(&local)
			}
		}
	}
	log.Println("[RepoSync] Pull sync completed successfully.")
}

// PullRepoDetails 支持对单条数据进行 Lazy Load 拉取
func PullRepoDetails(repoID uint) (*models.Repository, error) {
	log.Printf("[RepoSync] Pulling single repository ID %d details...", repoID)
	token, err := GenerateSystemToken()
	if err != nil {
		return nil, fmt.Errorf("failed to generate auth token: %w", err)
	}

	apiURLStr := models.AppConfig.Server.RepoSyncServer
	if apiURLStr == "" {
		return nil, fmt.Errorf("repo_sync_server not configured")
	}
	apiURL := fmt.Sprintf("%s/api/repos/%d", apiURLStr, repoID)
	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("remote API returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var rawRepo struct {
		ID        uint      `json:"id"`
		Name      string    `json:"name"`
		URL       string    `json:"url"`
		OwnerID   uint      `json:"owner_id"`
		IsActive  bool      `json:"is_active"`
		ProjectID string    `json:"project_id"`
		CreatedAt time.Time `json:"created_at"`
	}

	if err := json.Unmarshal(body, &rawRepo); err != nil {
		return nil, err
	}

	repo := models.Repository{
		ID:        rawRepo.ID,
		Name:      rawRepo.Name,
		URL:       rawRepo.URL,
		OwnerID:   rawRepo.OwnerID,
		IsActive:  rawRepo.IsActive,
		ProjectID: rawRepo.ProjectID,
		CreatedAt: rawRepo.CreatedAt,
	}

	// 存入本地镜像
	database.DB.Save(&repo)
	return &repo, nil
}

type remoteRepo struct {
	ID        uint      `json:"id"`
	Name      string    `json:"name"`
	URL       string    `json:"url"`
	OwnerID   uint      `json:"owner_id"`
	IsActive  bool      `json:"is_active"`
	ProjectID string    `json:"project_id"`
	CreatedAt time.Time `json:"created_at"`
}

func fetchReposFromCodeBench() ([]remoteRepo, error) {
	token, err := GenerateSystemToken()
	if err != nil {
		return nil, fmt.Errorf("failed to generate auth token: %w", err)
	}

	apiURLStr := models.AppConfig.Server.RepoSyncServer
	if apiURLStr == "" {
		return nil, fmt.Errorf("repo_sync_server not configured")
	}
	apiURL := fmt.Sprintf("%s/api/repos?pageSize=10000", apiURLStr)
	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("remote API returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var result struct {
		Items []remoteRepo `json:"items"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, err
	}

	return result.Items, nil
}
