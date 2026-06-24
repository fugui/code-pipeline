package services

import (
	"log"
	"sync"
	"time"

	"code-pipeline/database"
	"code-pipeline/models"

	"github.com/robfig/cron/v3"
)

var (
	cronRunner *cron.Cron
	cronMu     sync.Mutex
	cronJobs   map[uint]cron.EntryID
)

func InitScheduler() {
	cronMu.Lock()
	defer cronMu.Unlock()

	cronRunner = cron.New() // 默认使用标准 5 位 Cron 表达式
	cronJobs = make(map[uint]cron.EntryID)

	cronRunner.Start()
	log.Println("[Scheduler] Cron scheduler started")

	// 从数据库加载定时任务
	var repos []models.Repository
	if err := database.DB.Where("is_active = ? AND cron_expr != ''", true).Find(&repos).Error; err != nil {
		log.Printf("[Scheduler] Failed to fetch repository schedules: %v", err)
		return
	}

	for _, repo := range repos {
		addScheduleUnderLock(repo)
	}
}

func UpdateRepoSchedule(repo models.Repository) {
	cronMu.Lock()
	defer cronMu.Unlock()

	// 清理旧的任务
	if entryID, exists := cronJobs[repo.ID]; exists {
		cronRunner.Remove(entryID)
		delete(cronJobs, repo.ID)
	}

	// 注册新的任务
	if repo.IsActive && repo.CronExpr != "" {
		addScheduleUnderLock(repo)
	}
}

func RemoveRepoSchedule(repoID uint) {
	cronMu.Lock()
	defer cronMu.Unlock()

	if entryID, exists := cronJobs[repoID]; exists {
		cronRunner.Remove(entryID)
		delete(cronJobs, repoID)
	}
}

func addScheduleUnderLock(repo models.Repository) {
	entryID, err := cronRunner.AddFunc(repo.CronExpr, func() {
		log.Printf("[Scheduler] Triggering pipeline for repo %s via cron", repo.Name)
		_, err := TriggerPipeline(repo.ID, "schedule")
		if err != nil {
			log.Printf("[Scheduler] Failed to trigger pipeline for repo %s: %v", repo.Name, err)
		}
	})
	if err != nil {
		log.Printf("[Scheduler] Failed to add cron job for repo %s (%s): %v", repo.Name, repo.CronExpr, err)
		return
	}
	cronJobs[repo.ID] = entryID
	log.Printf("[Scheduler] Registered cron job for repo %s: %s", repo.Name, repo.CronExpr)
}

func TriggerPipeline(repoID uint, triggerType string) (uint, error) {
	var repo models.Repository
	if err := database.DB.First(&repo, repoID).Error; err != nil {
		return 0, err
	}

	// 创建新的执行日志，状态为 pending
	execLog := models.ExecutionLog{
		RepoID:      repo.ID,
		RepoName:    repo.Name,
		Branch:      repo.Branch,
		TriggerType: triggerType,
		Status:      "pending",
		StartTime:   time.Now(),
	}

	if err := database.DB.Create(&execLog).Error; err != nil {
		return 0, err
	}

	// 排队进 worker
	EnqueueTask(execLog.ID)

	return execLog.ID, nil
}
