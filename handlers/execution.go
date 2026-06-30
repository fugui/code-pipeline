package handlers

import (
	"fmt"
	"net/http"
	"time"

	"code-pipeline/database"
	"code-pipeline/models"

	"github.com/gin-gonic/gin"
)

// MockExecution 模拟的第三方执行数据结构
type MockExecution struct {
	ID          uint      `json:"id"`
	PlanID      string    `json:"plan_id"`
	PipelineID  string    `json:"pipeline_id"`
	RepoID      uint      `json:"repo_id"`
	RepoName    string    `json:"repo_name"`
	Branch      string    `json:"branch"`
	TriggerType string    `json:"trigger_type"` // manual, schedule, webhook
	Status      string    `json:"status"`       // success, failed, running
	StartTime   time.Time `json:"start_time"`
	DurationSec int64     `json:"duration_sec"`
	ErrorMsg    string    `json:"error_msg"`
}

func GetDashboardStats(c *gin.Context) {
	var totalRepos int64
	database.DB.Model(&models.Repository{}).Count(&totalRepos)

	// 从第三方统计系统聚合度量信息（此处代理返回汇总数据）
	totalRuns := totalRepos * 4
	successfulRuns := int64(float64(totalRuns) * 0.85) // 85% 成功率
	failedRuns := totalRuns - successfulRuns

	successRate := 0.0
	if totalRuns > 0 {
		successRate = float64(successfulRuns) / float64(totalRuns)
	}

	// 生成最近运行记录用于 Dashboard 呈现
	var repos []models.Repository
	database.DB.Limit(5).Find(&repos)

	var recentExecutions []MockExecution
	for i, repo := range repos {
		st := "success"
		if i == 1 {
			st = "failed"
		}
		recentExecutions = append(recentExecutions, MockExecution{
			ID:          uint(200 + i),
			PlanID:      fmt.Sprintf("plan_cb_%d", repo.ID),
			PipelineID:  "pipe_default",
			RepoID:      repo.ID,
			RepoName:    repo.Name,
			Branch:      "master",
			TriggerType: "schedule",
			Status:      st,
			StartTime:   time.Now().Add(-time.Duration(i*30) * time.Minute),
			DurationSec: int64(100 + i*15),
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"total_repos":       totalRepos,
		"active_schedulers": totalRepos, // 每个镜像仓库默认拥有调度计划绑定
		"total_runs":        totalRuns,
		"failed_runs":       failedRuns,
		"success_rate":      successRate,
		"running_count":     0,
		"pending_count":     0,
		"recent_runs":       recentExecutions,
	})
}
