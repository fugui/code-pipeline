package services

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"code-pipeline/database"
	"code-pipeline/models"
)

// SyncTask 表示同步任务
type SyncTask struct {
	GroupID uint
	UserID  uint
}

var syncQueue = make(chan SyncTask, 100)

// EnqueueSyncGroup 将嵌套组的同步任务推入后台队列
func EnqueueSyncGroup(groupID uint, userID uint) error {
	select {
	case syncQueue <- SyncTask{GroupID: groupID, UserID: userID}:
		log.Printf("[SyncQueue] Enqueued sync task for group ID %d (UserID: %d)", groupID, userID)
		return nil
	default:
		return errors.New("queue is full")
	}
}

// StartGroupSyncQueue 启动同步队列 Worker 协程
func StartGroupSyncQueue(ctx context.Context) {
	log.Println("[SyncQueue] Starting group sync queue worker...")
	go func() {
		for {
			select {
			case task := <-syncQueue:
				log.Printf("[SyncQueue] Starting sync task for group %d", task.GroupID)

				// 查找并备份根组对象，标记开始同步
				var startGroup models.ManagedGroup
				if err := database.DB.First(&startGroup, task.GroupID).Error; err == nil {
					// 递归同步整棵子树并审计分支
					if err := syncGroupRecursive(ctx, task.GroupID, task.UserID); err != nil {
						log.Printf("[SyncQueue] Error syncing group %d recursively: %v", task.GroupID, err)
					}

					// 任务完成后更新根同步时间
					now := time.Now()
					if err := database.DB.Model(&startGroup).Update("synced_at", &now).Error; err != nil {
						log.Printf("[SyncQueue] Failed to update synced_at for root group %d: %v", task.GroupID, err)
					}
					log.Printf("[SyncQueue] Completed sync task for group %d", task.GroupID)
				} else {
					log.Printf("[SyncQueue] Error loading root group %d for sync: %v", task.GroupID, err)
				}

			case <-ctx.Done():
				log.Println("[SyncQueue] Worker stopped")
				return
			}
		}
	}()
}

// syncGroupRecursive 递归同步组、子组和项目分支数据
func syncGroupRecursive(ctx context.Context, groupID uint, userID uint) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(500 * time.Millisecond): // 每次递归平滑等待，防止触发 CodeHub 429
	}

	// 检查当前分组是否已经被隐藏。如果是已隐藏分组，不再同步其自身及下面的任何数据
	var group models.ManagedGroup
	if err := database.DB.First(&group, groupID).Error; err == nil {
		if group.IsHidden {
			log.Printf("[SyncQueue] Skipping sync for group %d (%s) because it is hidden.", groupID, group.FullPath)
			return nil
		}
	} else {
		return fmt.Errorf("failed to load group %d from database: %w", groupID, err)
	}

	// 1. 同步当前组的直属子组和直属仓库 (使用对比更新)
	if err := syncSingleGroupDirect(ctx, groupID, userID); err != nil {
		return fmt.Errorf("failed to sync direct structure for group %d: %w", groupID, err)
	}

	// 2. 查出当前组直属的所有仓库，并同步分支数据
	var repos []models.ManagedRepository
	if err := database.DB.Where("managed_group_id = ?", groupID).Find(&repos).Error; err == nil {
		for _, repo := range repos {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(500 * time.Millisecond): // 同步每个仓库的分支之间平滑等待
			}

			// 同步项目分支及活跃分支数据统计
			if err := AuditSingleRepoBranches(ctx, repo.ID); err != nil {
				log.Printf("[SyncQueue] Error auditing branch for repo %s (ID: %d): %v", repo.Name, repo.ID, err)
			}
		}
	}

	// 3. 递归查询当前组底下的直属子组，并逐一递归调用
	var subGroups []models.ManagedGroup
	if err := database.DB.Where("parent_id = ?", groupID).Find(&subGroups).Error; err == nil {
		for _, sg := range subGroups {
			if err := syncGroupRecursive(ctx, sg.ID, userID); err != nil {
				log.Printf("[SyncQueue] Recursive sync failed for sub-group %s (ID: %d): %v", sg.FullPath, sg.ID, err)
			}
		}
	}

	// 4. 更新当前嵌套组（自身及子组节点）的同步状态
	now := time.Now()
	if err := database.DB.Model(&group).Update("synced_at", &now).Error; err != nil {
		log.Printf("[SyncQueue] Failed to update synced_at for group %d: %v", groupID, err)
	}

	return nil
}

// syncSingleGroupDirect 同步单个嵌套组的直属子组和仓库 (核心差集比对与更新)
func syncSingleGroupDirect(ctx context.Context, groupID uint, userID uint) error {
	var startGroup models.ManagedGroup
	if err := database.DB.First(&startGroup, groupID).Error; err != nil {
		return err
	}

	// 1. 从远程拉取直属项目和直属子群组
	remotes, err := GetRemoteProjects(ctx, startGroup.ID)
	if err != nil {
		return fmt.Errorf("failed to fetch remote projects: %w", err)
	}

	subgroups, err := GetRemoteSubgroups(ctx, startGroup.ID)
	if err != nil {
		return fmt.Errorf("failed to fetch remote subgroups: %w", err)
	}

	// 2. 开启事务进行比对更新与删除
	tx := database.DB.Begin()
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// 2.1 直属仓库比对
	remoteRepoIDs := make([]uint, 0, len(remotes))
	for _, rp := range remotes {
		remoteRepoIDs = append(remoteRepoIDs, rp.ID)
	}

	var localRepos []models.ManagedRepository
	if err := tx.Where("managed_group_id = ?", startGroup.ID).Find(&localRepos).Error; err != nil {
		tx.Rollback()
		return err
	}

	remoteRepoIDMap := make(map[uint]bool)
	for _, rid := range remoteRepoIDs {
		remoteRepoIDMap[rid] = true
	}

	var deletedRepoIDs []uint
	for _, lr := range localRepos {
		if !remoteRepoIDMap[lr.ID] {
			deletedRepoIDs = append(deletedRepoIDs, lr.ID)
		}
	}

	if len(deletedRepoIDs) > 0 {
		if err := tx.Where("managed_repository_id IN ?", deletedRepoIDs).Delete(&models.ManagedBranchMonitor{}).Error; err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Where("source_type = 'repository' AND source_id IN ?", deletedRepoIDs).Delete(&models.ManagedMemberAccess{}).Error; err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Where("id IN ?", deletedRepoIDs).Delete(&models.ManagedRepository{}).Error; err != nil {
			tx.Rollback()
			return err
		}
	}

	for _, rp := range remotes {
		sshURL := rp.SSHURL
		if sshURL == "" {
			sshURL = rp.SSHURLToRepo
		}
		httpURL := rp.HTTPURL
		if httpURL == "" {
			httpURL = rp.HTTPURLToRepo
		}

		var existing models.ManagedRepository
		errDb := tx.Where("id = ?", rp.ID).First(&existing).Error
		if errDb == nil {
			if err := tx.Model(&existing).Updates(models.ManagedRepository{
				Name:           rp.Name,
				SSHURL:         sshURL,
				HTTPURL:        httpURL,
				ManagedGroupID: startGroup.ID,
			}).Error; err != nil {
				tx.Rollback()
				return err
			}
		} else {
			newRepo := models.ManagedRepository{
				ID:             rp.ID,
				ManagedGroupID: startGroup.ID,
				Name:           rp.Name,
				SSHURL:         sshURL,
				HTTPURL:        httpURL,
				OwnerID:        userID,
				IsActive:       true,
				CreatedAt:      time.Now(),
			}
			if err := tx.Create(&newRepo).Error; err != nil {
				tx.Rollback()
				return err
			}
		}
	}

	// 2.2 直属子组比对
	remoteSubgroupIDs := make([]uint, 0, len(subgroups))
	for _, sub := range subgroups {
		remoteSubgroupIDs = append(remoteSubgroupIDs, sub.ID)
	}

	var localSubgroups []models.ManagedGroup
	if err := tx.Where("parent_id = ?", startGroup.ID).Find(&localSubgroups).Error; err != nil {
		tx.Rollback()
		return err
	}

	remoteSubgroupIDMap := make(map[uint]bool)
	for _, sgid := range remoteSubgroupIDs {
		remoteSubgroupIDMap[sgid] = true
	}

	var deletedSubgroupIDs []uint
	for _, lsg := range localSubgroups {
		if !remoteSubgroupIDMap[lsg.ID] {
			deletedSubgroupIDs = append(deletedSubgroupIDs, lsg.ID)
		}
	}

	if len(deletedSubgroupIDs) > 0 {
		var allDeletedGroupIDs []uint
		allDeletedGroupIDs = append(allDeletedGroupIDs, deletedSubgroupIDs...)

		for _, dsgID := range deletedSubgroupIDs {
			var dsg models.ManagedGroup
			if err := tx.First(&dsg, dsgID).Error; err == nil {
				var descGroupIDs []uint
				likePattern := dsg.FullPath + "/%"
				if err := tx.Model(&models.ManagedGroup{}).
					Where("full_path LIKE ?", likePattern).
					Pluck("id", &descGroupIDs).Error; err == nil {
					allDeletedGroupIDs = append(allDeletedGroupIDs, descGroupIDs...)
				}
			}
		}

		if len(allDeletedGroupIDs) > 0 {
			var subRepoIDs []uint
			if err := tx.Model(&models.ManagedRepository{}).
				Where("managed_group_id IN ?", allDeletedGroupIDs).
				Pluck("id", &subRepoIDs).Error; err != nil {
				tx.Rollback()
				return err
			}

			if len(subRepoIDs) > 0 {
				if err := tx.Where("managed_repository_id IN ?", subRepoIDs).Delete(&models.ManagedBranchMonitor{}).Error; err != nil {
					tx.Rollback()
					return err
				}
				if err := tx.Where("source_type = 'repository' AND source_id IN ?", subRepoIDs).Delete(&models.ManagedMemberAccess{}).Error; err != nil {
					tx.Rollback()
					return err
				}
				if err := tx.Where("id IN ?", subRepoIDs).Delete(&models.ManagedRepository{}).Error; err != nil {
					tx.Rollback()
					return err
				}
			}

			if err := tx.Where("source_type = 'group' AND source_id IN ?", allDeletedGroupIDs).Delete(&models.ManagedMemberAccess{}).Error; err != nil {
				tx.Rollback()
				return err
			}
			if err := tx.Where("id IN ?", allDeletedGroupIDs).Delete(&models.ManagedGroup{}).Error; err != nil {
				tx.Rollback()
				return err
			}
		}
	}

	for _, sub := range subgroups {
		var fullPath string
		if startGroup.FullPath != "" {
			fullPath = startGroup.FullPath + "/" + sub.Path
		} else {
			fullPath = sub.Path
		}

		var existingGroup models.ManagedGroup
		errDb := tx.Where("id = ?", sub.ID).First(&existingGroup).Error
		if errDb == nil {
			pID := startGroup.ID
			if err := tx.Model(&existingGroup).Updates(models.ManagedGroup{
				Name:     sub.Name,
				Path:     sub.Path,
				FullPath: fullPath,
				ParentID: &pID,
			}).Error; err != nil {
				tx.Rollback()
				return err
			}
		} else {
			pID := startGroup.ID
			newGroup := models.ManagedGroup{
				ID:        sub.ID,
				Name:      sub.Name,
				Path:      sub.Path,
				FullPath:  fullPath,
				ParentID:  &pID,
				CreatedAt: time.Now(),
			}
			if err := tx.Create(&newGroup).Error; err != nil {
				tx.Rollback()
				return err
			}
		}
	}

	return tx.Commit().Error
}
