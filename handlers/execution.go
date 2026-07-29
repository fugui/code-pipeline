package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
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
	rawData, err := c.GetRawData()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":  4001,
			"error": fmt.Sprintf("Failed to read request body: %v", err),
		})
		return
	}

	var req ExecutionReportRequest
	if err := json.Unmarshal(rawData, &req); err != nil {
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

	// 校验通过，将三方系统上报的完整信息持久化保存至本地 log 文件
	saveExecutionReportToFile(rawData, &req)

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
	err = database.DB.Where("task_id = ?", req.TaskID).First(&report).Error
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

// sanitizeFilename 净化文件名中的非法字符
func sanitizeFilename(name string) string {
	name = strings.ReplaceAll(name, "/", "_")
	name = strings.ReplaceAll(name, "\\", "_")
	name = strings.ReplaceAll(name, "..", "_")
	if name == "" {
		return "unknown_task"
	}
	return name
}

// saveExecutionReportToFile 将第三方系统上报的完整信息保存到本地 log 文件中
func saveExecutionReportToFile(rawData []byte, req *ExecutionReportRequest) {
	logDir := "logs/build_logs"
	if err := os.MkdirAll(logDir, 0755); err != nil {
		log.Printf("[ExecutionReport] Failed to create log directory %s: %v", logDir, err)
		return
	}

	// 格式化 JSON 数据，保证格式整齐易读
	var prettyJSON bytes.Buffer
	if err := json.Indent(&prettyJSON, rawData, "", "  "); err != nil {
		prettyJSON.Write(rawData)
	}

	// 按 TaskID 独立存储 log 文件
	filename := path.Join(logDir, fmt.Sprintf("%s.log", sanitizeFilename(req.TaskID)))
	f, err := os.OpenFile(filename, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		log.Printf("[ExecutionReport] Failed to open log file %s: %v", filename, err)
		return
	}
	defer f.Close()

	timestamp := time.Now().Format("2006-01-02 15:04:05")
	entry := fmt.Sprintf("\n=================== Execution Report [%s] ===================\n"+
		"Report Time : %s\n"+
		"Task ID     : %s\n"+
		"Task Type   : %s\n"+
		"Status      : %s\n"+
		"Repo URL    : %s\n"+
		"Branch      : %s\n"+
		"Commit ID   : %s\n"+
		"------------------- Raw Request Payload (JSON) -------------------\n"+
		"%s\n"+
		"=================================================================\n",
		timestamp, timestamp, req.TaskID, req.TaskType, req.Status, req.RepoURL, req.Branch, req.CommitID, prettyJSON.String())

	if _, err := f.WriteString(entry); err != nil {
		log.Printf("[ExecutionReport] Failed to write log to %s: %v", filename, err)
	}

	// 同时追加写到汇总日志 logs/execution_reports.log 中
	summaryLogPath := "logs/execution_reports.log"
	sf, err := os.OpenFile(summaryLogPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err == nil {
		defer sf.Close()
		summaryEntry := fmt.Sprintf("[%s] TaskID=%s Type=%s Status=%s Repo=%s Branch=%s LogFile=%s\n",
			timestamp, req.TaskID, req.TaskType, req.Status, req.RepoURL, req.Branch, filename)
		_, _ = sf.WriteString(summaryEntry)
	}
}

// FailedRepoStat 高频失败仓库统计结构
type FailedRepoStat struct {
	RepoName    string `json:"repo_name"`
	FailedCount int64  `json:"failed_count"`
}

// GetDashboardStats 获取 Dashboard 看板数据与最新执行轨迹
func GetDashboardStats(c *gin.Context) {
	var totalRepos int64
	database.DB.Model(&models.ManagedRepository{}).Count(&totalRepos)
	if totalRepos == 0 {
		database.DB.Model(&models.Repository{}).Count(&totalRepos)
	}

	// 真实查询活跃定时任务数 (已勾选 daily_build 或绑定了 execution_plan_id 的执行方案)
	var activeSchedulers int64
	database.DB.Model(&models.ExecutionScheme{}).
		Where("daily_build = ? OR (execution_plan_id IS NOT NULL AND execution_plan_id != '')", true).
		Count(&activeSchedulers)

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

	var buildCount int64
	database.DB.Model(&models.ExecutionReport{}).Where("task_type = ? OR task_type = '' OR task_type IS NULL", "build").Count(&buildCount)

	var codeCheckCount int64
	database.DB.Model(&models.ExecutionReport{}).Where("task_type = ?", "code_check").Count(&codeCheckCount)

	// 计算平均运行耗时 (仅针对已结束任务)
	var avgDuration float64
	database.DB.Model(&models.ExecutionReport{}).
		Where("duration_sec > 0 AND status IN (?)", []string{"success", "failed"}).
		Select("COALESCE(AVG(duration_sec), 0)").
		Scan(&avgDuration)

	// 计算代码检查质量门禁通过率
	var totalGateChecks int64
	var gatePassedCount int64
	var codeCheckReports []models.ExecutionReport
	database.DB.Where("task_type = ? AND code_check_details IS NOT NULL", "code_check").Find(&codeCheckReports)
	for _, r := range codeCheckReports {
		if len(r.CodeCheckDetails) > 0 {
			var details map[string]interface{}
			if err := json.Unmarshal(r.CodeCheckDetails, &details); err == nil {
				if gs, ok := details["gate_status"].(string); ok && gs != "" {
					totalGateChecks++
					gsLower := strings.ToLower(gs)
					if gsLower == "passed" || gsLower == "success" || gsLower == "ok" || gsLower == "pass" || gsLower == "true" {
						gatePassedCount++
					}
				}
			}
		}
	}

	gatePassRate := 1.0
	if totalGateChecks > 0 {
		gatePassRate = float64(gatePassedCount) / float64(totalGateChecks)
	}

	// 统计高频失败仓库 Top 5
	var topFailedRepos []FailedRepoStat
	database.DB.Model(&models.ExecutionReport{}).
		Select("repo_name, COUNT(*) as failed_count").
		Where("status = ?", "failed").
		Group("repo_name").
		Order("failed_count DESC").
		Limit(5).
		Scan(&topFailedRepos)
	if topFailedRepos == nil {
		topFailedRepos = []FailedRepoStat{}
	}

	reports := make([]models.ExecutionReport, 0)
	database.DB.Order("created_at DESC").Limit(50).Find(&reports)

	successRate := 0.0
	if totalRuns > 0 {
		successRate = float64(successfulRuns) / float64(totalRuns)
	}

	c.JSON(http.StatusOK, gin.H{
		"total_repos":       totalRepos,
		"active_schedulers": activeSchedulers,
		"total_runs":        totalRuns,
		"failed_runs":       failedRuns,
		"success_rate":      successRate,
		"running_count":     runningCount,
		"pending_count":     pendingCount,
		"build_count":       buildCount,
		"code_check_count":  codeCheckCount,
		"avg_duration_sec":  int64(avgDuration),
		"gate_pass_rate":    gatePassRate,
		"top_failed_repos":  topFailedRepos,
		"recent_runs":       reports,
	})
}

