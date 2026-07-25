package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"path"
	"strings"
	"time"

	"code-pipeline/database"
	"code-pipeline/models"

	"github.com/gin-gonic/gin"
	"gorm.io/datatypes"
)

// ExecutionReportRequest 上报请求 Body 结构体
type ExecutionReportRequest struct {
	TaskID            string          `json:"task_id"`
	TaskType          string          `json:"task_type"` // build | code_check
	CodeCheckerTaskID string          `json:"code_checker_task_id"`
	RepoURL           string          `json:"repo_url"`
	Branch            string          `json:"branch"`
	CommitID          string          `json:"commit_id"`
	ExecutionSchemeID string          `json:"execution_scheme_id"`
	PipelineID        string          `json:"pipeline_id"`
	Status            string          `json:"status"` // running, success, failed, cancelled, timeout
	StartTime         *time.Time      `json:"start_time"`
	EndTime           *time.Time      `json:"end_time"`
	DurationSec       int64           `json:"duration_sec"`
	TriggerType       string          `json:"trigger_type"`
	TriggerUser       string          `json:"trigger_user"`
	BuildDetails      json.RawMessage `json:"build_details"`
	CodeCheckDetails  json.RawMessage `json:"code_check_details"`
	LogContent        string          `json:"log_content"`
	ExternalLogURL    string          `json:"external_log_url"`
}

// ReportExecutionLog 处理第三方构建与代码检查日志上报 (POST /api/v1/report/execution-log, /build-log, /code-check-log)
func ReportExecutionLog(c *gin.Context) {
	var req ExecutionReportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":  4001,
			"error": fmt.Sprintf("Invalid request body: %v", err),
		})
		return
	}

	// 根据请求路径修正 task_type 缺省值
	urlPath := c.Request.URL.Path
	if req.TaskType == "" {
		if strings.HasSuffix(urlPath, "/build-log") {
			req.TaskType = "build"
		} else if strings.HasSuffix(urlPath, "/code-check-log") {
			req.TaskType = "code_check"
		} else {
			req.TaskType = "build"
		}
	}

	// 校验必填字段
	if req.TaskID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":  4001,
			"error": "Invalid request body: missing required field 'task_id'",
		})
		return
	}
	if req.RepoURL == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":  4001,
			"error": "Invalid request body: missing required field 'repo_url'",
		})
		return
	}
	if req.Branch == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":  4001,
			"error": "Invalid request body: missing required field 'branch'",
		})
		return
	}
	if req.Status == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":  4001,
			"error": "Invalid request body: missing required field 'status'",
		})
		return
	}

	// 从 RepoURL 中提取 RepoName
	repoName := path.Base(req.RepoURL)
	repoName = strings.TrimSuffix(repoName, ".git")

	var buildDetailsJSON datatypes.JSON
	if len(req.BuildDetails) > 0 {
		buildDetailsJSON = datatypes.JSON(req.BuildDetails)
	}

	var codeCheckDetailsJSON datatypes.JSON
	if len(req.CodeCheckDetails) > 0 {
		codeCheckDetailsJSON = datatypes.JSON(req.CodeCheckDetails)
	}

	now := time.Now()
	startTime := req.StartTime
	if startTime == nil {
		startTime = &now
	}

	// Upsert 事务/持久化逻辑
	var report models.ExecutionReport
	err := database.DB.Where("task_id = ?", req.TaskID).First(&report).Error
	if err != nil {
		// 不存在，创建新记录
		report = models.ExecutionReport{
			TaskID:            req.TaskID,
			TaskType:          req.TaskType,
			CodeCheckerTaskID: req.CodeCheckerTaskID,
			RepoURL:           req.RepoURL,
			RepoName:          repoName,
			Branch:            req.Branch,
			CommitID:          req.CommitID,
			ExecutionSchemeID: req.ExecutionSchemeID,
			PipelineID:        req.PipelineID,
			Status:            req.Status,
			StartTime:         startTime,
			EndTime:           req.EndTime,
			DurationSec:       req.DurationSec,
			TriggerType:       req.TriggerType,
			TriggerUser:       req.TriggerUser,
			BuildDetails:      buildDetailsJSON,
			CodeCheckDetails:  codeCheckDetailsJSON,
			LogContent:        req.LogContent,
			ExternalLogURL:    req.ExternalLogURL,
		}
		if err := database.DB.Create(&report).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"code":  5000,
				"error": fmt.Sprintf("Failed to save execution log report: %v", err),
			})
			return
		}
	} else {
		// 已存在，更新记录
		updates := map[string]interface{}{
			"task_type":            req.TaskType,
			"code_checker_task_id": req.CodeCheckerTaskID,
			"repo_url":             req.RepoURL,
			"repo_name":            repoName,
			"branch":               req.Branch,
			"commit_id":            req.CommitID,
			"execution_scheme_id":  req.ExecutionSchemeID,
			"pipeline_id":          req.PipelineID,
			"status":               req.Status,
			"duration_sec":         req.DurationSec,
			"trigger_type":         req.TriggerType,
			"trigger_user":         req.TriggerUser,
			"log_content":          req.LogContent,
			"external_log_url":     req.ExternalLogURL,
			"updated_at":           now,
		}
		if req.StartTime != nil {
			updates["start_time"] = req.StartTime
		}
		if req.EndTime != nil {
			updates["end_time"] = req.EndTime
		}
		if len(req.BuildDetails) > 0 {
			updates["build_details"] = buildDetailsJSON
		}
		if len(req.CodeCheckDetails) > 0 {
			updates["code_check_details"] = codeCheckDetailsJSON
		}

		if err := database.DB.Model(&report).Updates(updates).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"code":  5000,
				"error": fmt.Sprintf("Failed to update execution log report: %v", err),
			})
			return
		}
		database.DB.First(&report, report.ID)
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "Execution log report accepted successfully",
		"data": gin.H{
			"report_id":  report.ID,
			"task_id":    report.TaskID,
			"task_type":  report.TaskType,
			"status":     report.Status,
			"created_at": report.CreatedAt,
		},
	})
}

// GetDashboardStats 获取 Dashboard 看板数据与最新执行轨迹
func GetDashboardStats(c *gin.Context) {
	var totalRepos int64
	database.DB.Model(&models.ManagedRepository{}).Count(&totalRepos)
	if totalRepos == 0 {
		database.DB.Model(&models.Repository{}).Count(&totalRepos)
	}

	var totalRuns int64
	database.DB.Model(&models.ExecutionReport{}).Count(&totalRuns)

	var successfulRuns int64
	database.DB.Model(&models.ExecutionReport{}).Where("status = ?", "success").Count(&successfulRuns)

	var failedRuns int64
	database.DB.Model(&models.ExecutionReport{}).Where("status = ?", "failed").Count(&failedRuns)

	var runningCount int64
	database.DB.Model(&models.ExecutionReport{}).Where("status = ?", "running").Count(&runningCount)

	var pendingCount int64
	database.DB.Model(&models.ExecutionReport{}).Where("status = ?", "pending").Count(&pendingCount)

	var reports []models.ExecutionReport
	database.DB.Order("created_at DESC").Limit(20).Find(&reports)

	// 若无数据库上报数据，回退构造初始化示范数据
	if len(reports) == 0 {
		var repos []models.Repository
		database.DB.Limit(5).Find(&repos)

		if totalRepos == 0 {
			totalRepos = 12
		}
		totalRuns = totalRepos * 4
		successfulRuns = int64(float64(totalRuns) * 0.85)
		failedRuns = totalRuns - successfulRuns

		for i, repo := range repos {
			st := "success"
			if i == 1 {
				st = "failed"
			}
			taskType := "build"
			if i%2 == 1 {
				taskType = "code_check"
			}
			stTime := time.Now().Add(-time.Duration(i*30) * time.Minute)
			endTime := stTime.Add(time.Duration(90) * time.Second)

			ccDetails := ""
			if taskType == "code_check" {
				ccDetails = `{"gate_status":"passed","lines_scanned":15420,"files_scanned":86,"total_issues":4,"fatal_issues":0,"critical_issues":1,"major_issues":3,"minor_issues":0,"code_duplication_rate":"1.2%","checker_report_url":"http://192.168.56.18:9080/shield/public/report/checker_task_8891"}`
			}

			reports = append(reports, models.ExecutionReport{
				ID:                uint(200 + i),
				TaskID:            fmt.Sprintf("check_task_sample_%d", repo.ID),
				TaskType:          taskType,
				CodeCheckerTaskID: fmt.Sprintf("checker_task_%d", repo.ID),
				RepoURL:           repo.URL,
				RepoName:          repo.Name,
				Branch:            repo.Branch,
				Status:            st,
				StartTime:         &stTime,
				EndTime:           &endTime,
				DurationSec:       int64(90 + i*15),
				TriggerType:       "webhook",
				TriggerUser:       "ci_system",
				CodeCheckDetails:  datatypes.JSON(ccDetails),
				LogContent:        "Sample execution log content...",
				ExternalLogURL:    fmt.Sprintf("http://192.168.56.18:9080/pipelines/logs/%d", repo.ID),
			})
		}
	}

	successRate := 0.0
	if totalRuns > 0 {
		successRate = float64(successfulRuns) / float64(totalRuns)
	}

	c.JSON(http.StatusOK, gin.H{
		"total_repos":       totalRepos,
		"active_schedulers": totalRepos,
		"total_runs":        totalRuns,
		"failed_runs":       failedRuns,
		"success_rate":      successRate,
		"running_count":     runningCount,
		"pending_count":     pendingCount,
		"recent_runs":       reports,
	})
}
