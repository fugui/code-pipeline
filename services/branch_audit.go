package services

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"time"

	"code-pipeline/database"
	"code-pipeline/models"
)

// StartBranchAuditTimer 开启后台分支审计定时器 (按用户要求已停用后台定时器，改为用户手动按需触发)
func StartBranchAuditTimer(ctx context.Context) {
	log.Println("[BranchAudit] Background stale branch monitor timer is disabled. Manual triggers only.")
}

// AuditAllReposBranches 全量审计所有被管仓库的分支并写入本地 DB 缓存
func AuditAllReposBranches(ctx context.Context) {
	log.Println("[BranchAudit] Triggering stale branch audit for all managed repositories...")
	var repos []models.ManagedRepository
	if err := database.DB.Find(&repos).Error; err != nil {
		log.Printf("[BranchAudit] Failed to query managed repositories: %v", err)
		return
	}

	for _, repo := range repos {
		// 每次审计之间加入 400 毫秒的平滑等待，防止瞬间高频访问 CodeHub 触发 429 限流
		select {
		case <-ctx.Done():
			log.Println("[BranchAudit] Audit cancelled via context closure")
			return
		case <-time.After(400 * time.Millisecond):
		}

		if err := AuditSingleRepoBranches(ctx, repo.ID); err != nil {
			log.Printf("[BranchAudit] Error auditing repo %s (ID: %d): %v", repo.Name, repo.ID, err)
		}
	}
	log.Println("[BranchAudit] Branch audit completed successfully.")
}

// AuditSingleRepoBranches 审计单个被管仓库分支的活跃状态并缓存至本地
func AuditSingleRepoBranches(ctx context.Context, repoID uint) error {
	log.Printf("[BranchAudit] Auditing branches for repo ID %d...", repoID)

	repoStrID := strconv.Itoa(int(repoID))

	// 1. 获取远程分支总数，并保存/更新到本地 ManagedRepository 的 BranchCount 字段
	branchCount, err := GetRemoteProjectBranchCount(ctx, repoStrID)
	if err != nil {
		log.Printf("[BranchAudit] Warning: failed to fetch branch count for repo %d: %v. Defaulting to 1 page.", repoID, err)
		branchCount = 0 // 容错：默认为 0，后续拉取 1 页
	} else {
		if errDb := database.DB.Model(&models.ManagedRepository{}).Where("id = ?", repoID).Update("branch_count", branchCount).Error; errDb != nil {
			log.Printf("[BranchAudit] Failed to update BranchCount in db for repo %d: %v", repoID, errDb)
		}
	}

	// 2. 分页并合并获取远程详细分支清单
	branches, err := GetRemoteBranchesDetail(ctx, repoStrID, branchCount)
	if err != nil {
		return fmt.Errorf("failed to fetch remote branch details: %w", err)
	}

	db := database.DB
	now := time.Now()

	// 2. 取出本地已记录的分支作为对比缓存，以便找出已被物理删除的分支
	var existingMonitors []models.ManagedBranchMonitor
	if err := db.Where("managed_repository_id = ?", repoID).Find(&existingMonitors).Error; err != nil {
		return fmt.Errorf("failed to load local branch monitors: %w", err)
	}

	localMap := make(map[string]*models.ManagedBranchMonitor)
	for i := range existingMonitors {
		localMap[existingMonitors[i].BranchName] = &existingMonitors[i]
	}

	activeRemoteBranches := make(map[string]bool)

	// 3. 计算活跃度并写入本地缓存表
	for _, br := range branches {
		activeRemoteBranches[br.Name] = true

		// 活跃状态算法判定
		status := "active"
		age := now.Sub(br.LastCommitTime)

		if br.IsMerged && age > 7*24*time.Hour {
			// 分支已合入 master 且超过 7 天无改动，判为“已合并待清理”
			status = "merged_stale"
		} else if !br.IsMerged && age > 30*24*time.Hour {
			// 分支未合入 master 且超过 30 天无改动，判为“未合并僵尸分支”
			status = "unmerged_stale"
		}

		if monitor, ok := localMap[br.Name]; ok {
			// 更新
			if err := db.Model(monitor).Updates(map[string]interface{}{
				"last_commit_hash": br.LastCommitHash,
				"last_commit_time": br.LastCommitTime,
				"last_author":      br.LastAuthor,
				"is_merged":        br.IsMerged,
				"is_protected":     br.IsProtected,
				"status":           status,
				"updated_at":       now,
			}).Error; err != nil {
				log.Printf("[BranchAudit] Failed to update branch monitor %s: %v", br.Name, err)
			}
		} else {
			// 新增
			newMonitor := models.ManagedBranchMonitor{
				ManagedRepositoryID: repoID,
				BranchName:          br.Name,
				LastCommitHash:      br.LastCommitHash,
				LastCommitTime:      br.LastCommitTime,
				LastAuthor:          br.LastAuthor,
				IsMerged:            br.IsMerged,
				IsProtected:         br.IsProtected,
				Status:              status,
				UpdatedAt:           now,
			}
			if err := db.Create(&newMonitor).Error; err != nil {
				log.Printf("[BranchAudit] Failed to create branch monitor %s: %v", br.Name, err)
			}
		}
	}

	// 4. 清理在托管平台上已被物理删除、但本地 DB 缓存中仍存在的分支
	for i := range existingMonitors {
		monitor := &existingMonitors[i]
		if !activeRemoteBranches[monitor.BranchName] {
			log.Printf("[BranchAudit] Branch %s deleted in remote, cleaning local cache...", monitor.BranchName)
			if err := db.Delete(monitor).Error; err != nil {
				log.Printf("[BranchAudit] Failed to delete stale branch monitor %s: %v", monitor.BranchName, err)
			}
		}
	}

	// 5. 汇总该仓库的分支状态并更新到 ManagedRepository 表中
	var activeCount, staleUnmergedCount, staleMergedCount int64
	db.Model(&models.ManagedBranchMonitor{}).Where("managed_repository_id = ? AND status = 'active'", repoID).Count(&activeCount)
	db.Model(&models.ManagedBranchMonitor{}).Where("managed_repository_id = ? AND status = 'unmerged_stale'", repoID).Count(&staleUnmergedCount)
	db.Model(&models.ManagedBranchMonitor{}).Where("managed_repository_id = ? AND status = 'merged_stale'", repoID).Count(&staleMergedCount)

	var maxCommitTime *time.Time
	for _, br := range branches {
		if br.LastCommitTime.IsZero() {
			continue
		}
		if maxCommitTime == nil || br.LastCommitTime.After(*maxCommitTime) {
			t := br.LastCommitTime
			maxCommitTime = &t
		}
	}

	if err := db.Model(&models.ManagedRepository{}).Where("id = ?", repoID).Updates(map[string]interface{}{
		"active_count":         int(activeCount),
		"stale_unmerged_count": int(staleUnmergedCount),
		"stale_merged_count":   int(staleMergedCount),
		"last_commit_time":     maxCommitTime,
	}).Error; err != nil {
		log.Printf("[BranchAudit] Failed to update branch aggregation stats for repo %d: %v", repoID, err)
	}

	return nil
}
