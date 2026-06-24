package handlers

import (
	"net/http"
	"strconv"

	"code-pipeline/database"
	"code-pipeline/models"
	"code-pipeline/services"

	"github.com/gin-gonic/gin"
)

func GetExecutions(c *gin.Context) {
	var logs []models.ExecutionLog
	query := database.DB.Order("start_time DESC")

	repoIDStr := c.Query("repo_id")
	if repoIDStr != "" {
		if repoID, err := strconv.Atoi(repoIDStr); err == nil {
			query = query.Where("repo_id = ?", repoID)
		}
	}

	status := c.Query("status")
	if status != "" {
		query = query.Where("status = ?", status)
	}

	// 分页
	pageStr := c.DefaultQuery("page", "1")
	limitStr := c.DefaultQuery("limit", "10")
	page, _ := strconv.Atoi(pageStr)
	limit, _ := strconv.Atoi(limitStr)
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 100 {
		limit = 10
	}
	offset := (page - 1) * limit

	var total int64
	query.Model(&models.ExecutionLog{}).Count(&total)

	if err := query.Offset(offset).Limit(limit).Find(&logs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch execution logs"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data":  logs,
		"total": total,
		"page":  page,
		"limit": limit,
	})
}

func GetExecutionDetails(c *gin.Context) {
	id := c.Param("id")
	var logRecord models.ExecutionLog
	if err := database.DB.First(&logRecord, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Execution log not found"})
		return
	}
	c.JSON(http.StatusOK, logRecord)
}

func CancelExecution(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid execution ID"})
		return
	}

	// 尝试取消活动任务
	cancelled := services.CancelTask(uint(id))
	if !cancelled {
		// 可能是 pending 或者已经结束了
		var execLog models.ExecutionLog
		if err := database.DB.First(&execLog, id).Error; err == nil {
			if execLog.Status == "pending" {
				// 如果只是排队，则直接更新其状态为 cancelled
				execLog.Status = "cancelled"
				database.DB.Save(&execLog)
				c.JSON(http.StatusOK, gin.H{"message": "Pending execution cancelled successfully"})
				return
			}
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "Execution is not active or already completed"})
		return
	}

	// 更新日志状态
	var execLog models.ExecutionLog
	if err := database.DB.First(&execLog, id).Error; err == nil {
		execLog.Status = "cancelled"
		database.DB.Save(&execLog)

		// 更新仓库状态
		var repo models.Repository
		if errDb := database.DB.First(&repo, execLog.RepoID).Error; errDb == nil {
			repo.LastRunStatus = "cancelled"
			database.DB.Save(&repo)
		}
	}

	c.JSON(http.StatusOK, gin.H{"message": "Execution cancelled successfully"})
}

func GetDashboardStats(c *gin.Context) {
	var totalRepos int64
	var activeSchedulers int64
	var totalRuns int64
	var successfulRuns int64
	var failedRuns int64

	database.DB.Model(&models.Repository{}).Count(&totalRepos)
	database.DB.Model(&models.Repository{}).Where("is_active = ? AND cron_expr != ''", true).Count(&activeSchedulers)
	database.DB.Model(&models.ExecutionLog{}).Count(&totalRuns)
	database.DB.Model(&models.ExecutionLog{}).Where("status = ?", "success").Count(&successfulRuns)
	database.DB.Model(&models.ExecutionLog{}).Where("status = ?", "failed").Count(&failedRuns)

	// 计算当前并发池队列状态
	pendingCount, runningIDs := services.GetTaskQueueState()

	// 成功率
	successRate := 0.0
	completedRuns := successfulRuns + failedRuns
	if completedRuns > 0 {
		successRate = float64(successfulRuns) / float64(completedRuns)
	}

	// 最近 5 次执行历史
	var recentExecutions []models.ExecutionLog
	database.DB.Order("start_time DESC").Limit(5).Find(&recentExecutions)

	c.JSON(http.StatusOK, gin.H{
		"total_repos":       totalRepos,
		"active_schedulers": activeSchedulers,
		"total_runs":        totalRuns,
		"success_rate":      successRate,
		"running_count":     len(runningIDs),
		"pending_count":     pendingCount,
		"recent_runs":       recentExecutions,
	})
}
