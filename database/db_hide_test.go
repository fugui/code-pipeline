package database

import (
	"code-pipeline/models"
	"testing"
	"time"

	"gorm.io/gorm"
)

func TestToggleGroupHideLogic(t *testing.T) {
	_ = models.LoadConfig("../config.yaml")
	InitDB()

	// 清理旧的测试数据，以防冲突
	DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&models.ManagedBranchMonitor{})
	DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&models.ManagedMemberAccess{})
	DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&models.ManagedRepository{})
	DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&models.ManagedGroup{})

	// 插入 mock 数据
	t1 := time.Now().Add(-1 * time.Hour)
	pGroup := models.ManagedGroup{
		ID:        1,
		Name:      "Parent",
		Path:      "Parent",
		FullPath:  "Parent",
		ParentID:  nil,
		SyncedAt:  &t1,
		IsHidden:  false,
		CreatedAt: t1,
	}
	DB.Create(&pGroup)

	cGroupID := uint(1)
	cGroup := models.ManagedGroup{
		ID:        2,
		Name:      "Child",
		Path:      "Child",
		FullPath:  "Parent/Child",
		ParentID:  &cGroupID,
		SyncedAt:  &t1,
		IsHidden:  false,
		CreatedAt: t1,
	}
	DB.Create(&cGroup)

	DB.Create(&models.ManagedRepository{
		ID:             101,
		ManagedGroupID: 1,
		Name:           "repo1",
		SSHURL:         "git@github.com:parent/repo1.git",
		HTTPURL:        "http://...",
		IsActive:       true,
		CreatedAt:      t1,
	})

	DB.Create(&models.ManagedRepository{
		ID:             102,
		ManagedGroupID: 2,
		Name:           "repo2",
		SSHURL:         "git@github.com:parent/child/repo2.git",
		HTTPURL:        "http://...",
		IsActive:       true,
		CreatedAt:      t1,
	})

	// 插入 monitor
	DB.Create(&models.ManagedBranchMonitor{
		ID:                  201,
		ManagedRepositoryID: 101,
		BranchName:          "main",
		LastCommitHash:      "abcdef",
		LastCommitTime:      t1,
		LastAuthor:          "author",
		IsMerged:            false,
		IsProtected:         true,
		Status:              "active",
		UpdatedAt:           t1,
	})
	DB.Create(&models.ManagedBranchMonitor{
		ID:                  202,
		ManagedRepositoryID: 102,
		BranchName:          "main",
		LastCommitHash:      "abcdef",
		LastCommitTime:      t1,
		LastAuthor:          "author",
		IsMerged:            false,
		IsProtected:         true,
		Status:              "active",
		UpdatedAt:           t1,
	})

	// 插入 ACLs
	DB.Create(&models.ManagedMemberAccess{
		ID:            301,
		SourceType:    "group",
		SourceID:      1,
		PrincipalType: "user",
		PrincipalID:   1,
		PrincipalName: "User1",
		AccessLevel:   30,
		SyncStatus:    "synced",
		UpdatedAt:     t1,
	})
	DB.Create(&models.ManagedMemberAccess{
		ID:            302,
		SourceType:    "group",
		SourceID:      2,
		PrincipalType: "user",
		PrincipalID:   1,
		PrincipalName: "User1",
		AccessLevel:   30,
		SyncStatus:    "synced",
		UpdatedAt:     t1,
	})
	DB.Create(&models.ManagedMemberAccess{
		ID:            303,
		SourceType:    "repository",
		SourceID:      101,
		PrincipalType: "user",
		PrincipalID:   1,
		PrincipalName: "User1",
		AccessLevel:   30,
		SyncStatus:    "synced",
		UpdatedAt:     t1,
	})
	DB.Create(&models.ManagedMemberAccess{
		ID:            304,
		SourceType:    "repository",
		SourceID:      102,
		PrincipalType: "user",
		PrincipalID:   1,
		PrincipalName: "User1",
		AccessLevel:   30,
		SyncStatus:    "synced",
		UpdatedAt:     t1,
	})

	// 1. 查询确认初始测试数据存在
	var parent models.ManagedGroup
	if err := DB.First(&parent, 1).Error; err != nil {
		t.Fatalf("Parent group not found: %v", err)
	}
	if parent.IsHidden {
		t.Fatal("Parent group should not be hidden initially")
	}

	var child models.ManagedGroup
	if err := DB.First(&child, 2).Error; err != nil {
		t.Fatalf("Child group not found: %v", err)
	}

	var repo1 models.ManagedRepository
	if err := DB.First(&repo1, 101).Error; err != nil {
		t.Fatalf("Repo 101 not found: %v", err)
	}

	var repo2 models.ManagedRepository
	if err := DB.First(&repo2, 102).Error; err != nil {
		t.Fatalf("Repo 102 not found: %v", err)
	}

	// 2. 模拟 ToggleGroupHide 为 Parent 组设置隐藏
	tx := DB.Begin()
	defer tx.Rollback()

	parent.IsHidden = true
	updates := map[string]interface{}{
		"is_hidden": true,
		"synced_at": nil,
	}
	if err := tx.Model(&parent).Updates(updates).Error; err != nil {
		t.Fatalf("Failed to update parent: %v", err)
	}

	// 级联清理逻辑：
	var subGroupIDs []uint
	likePattern := parent.FullPath + "/%"
	if err := tx.Model(&models.ManagedGroup{}).Where("full_path LIKE ?", likePattern).Pluck("id", &subGroupIDs).Error; err != nil {
		t.Fatalf("Failed to query sub groups: %v", err)
	}

	allGroupIDs := append([]uint{parent.ID}, subGroupIDs...)

	var repoIDs []uint
	if err := tx.Model(&models.ManagedRepository{}).Where("managed_group_id IN ?", allGroupIDs).Pluck("id", &repoIDs).Error; err != nil {
		t.Fatalf("Failed to query repos: %v", err)
	}

	if len(repoIDs) > 0 {
		if err := tx.Where("managed_repository_id IN ?", repoIDs).Delete(&models.ManagedBranchMonitor{}).Error; err != nil {
			t.Fatalf("Failed to delete monitors: %v", err)
		}
		if err := tx.Where("source_type = 'repository' AND source_id IN ?", repoIDs).Delete(&models.ManagedMemberAccess{}).Error; err != nil {
			t.Fatalf("Failed to delete repo ACLs: %v", err)
		}
		if err := tx.Where("id IN ?", repoIDs).Delete(&models.ManagedRepository{}).Error; err != nil {
			t.Fatalf("Failed to delete repos: %v", err)
		}
	}

	if len(subGroupIDs) > 0 {
		if err := tx.Where("source_type = 'group' AND source_id IN ?", subGroupIDs).Delete(&models.ManagedMemberAccess{}).Error; err != nil {
			t.Fatalf("Failed to delete group ACLs: %v", err)
		}
		if err := tx.Where("id IN ?", subGroupIDs).Delete(&models.ManagedGroup{}).Error; err != nil {
			t.Fatalf("Failed to delete child groups: %v", err)
		}
	}

	// 提交事务以便在数据库中查验
	if err := tx.Commit().Error; err != nil {
		t.Fatalf("Failed to commit: %v", err)
	}

	// 3. 校验隐藏后的数据删除状态
	var checkParent models.ManagedGroup
	if err := DB.First(&checkParent, 1).Error; err != nil {
		t.Fatalf("Parent should still exist: %v", err)
	}
	if !checkParent.IsHidden {
		t.Fatal("Parent should be hidden now")
	}
	if checkParent.SyncedAt != nil {
		t.Fatal("Parent's synced_at should be nil now")
	}

	// 子组 2 应该已经被删除
	var checkChild models.ManagedGroup
	if err := DB.First(&checkChild, 2).Error; err == nil {
		t.Fatal("Child group should have been deleted")
	}

	// 两个仓库 101, 102 均应被删除
	var checkRepo1 models.ManagedRepository
	if err := DB.First(&checkRepo1, 101).Error; err == nil {
		t.Fatal("Repo 101 should have been deleted")
	}
	var checkRepo2 models.ManagedRepository
	if err := DB.First(&checkRepo2, 102).Error; err == nil {
		t.Fatal("Repo 102 should have been deleted")
	}

	// 所有的 Monitors 和 ACL 记录应已清除
	var monitorCount int64
	DB.Model(&models.ManagedBranchMonitor{}).Where("managed_repository_id IN ?", []uint{101, 102}).Count(&monitorCount)
	if monitorCount > 0 {
		t.Fatalf("Branch monitors not cleaned: %d", monitorCount)
	}

	var accessCount int64
	DB.Model(&models.ManagedMemberAccess{}).Where("source_type = 'repository' AND source_id IN ?", []uint{101, 102}).Count(&accessCount)
	if accessCount > 0 {
		t.Fatalf("Repository ACLs not cleaned: %d", accessCount)
	}

	// 子组 2 对应的 group 级别 ACL 也应该被清掉了
	DB.Model(&models.ManagedMemberAccess{}).Where("source_type = 'group' AND source_id = 2").Count(&accessCount)
	if accessCount > 0 {
		t.Fatalf("Child group ACLs not cleaned: %d", accessCount)
	}

	// 父组 1 对应的 group 级别 ACL 1 应保留，因为它没有被物理删除
	DB.Model(&models.ManagedMemberAccess{}).Where("source_type = 'group' AND source_id = 1").Count(&accessCount)
	if accessCount == 0 {
		t.Fatal("Parent group ACLs should be preserved")
	}

	t.Log("ToggleGroupHide logic verification successfully passed.")
}

func TestDeleteManagedGroupLogic(t *testing.T) {
	_ = models.LoadConfig("../config.yaml")
	InitDB()

	// 清理旧的测试数据
	DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&models.ManagedBranchMonitor{})
	DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&models.ManagedMemberAccess{})
	DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&models.ManagedProtectedBranchRule{})
	DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&models.RepoComplianceReport{})
	DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&models.ManagedRepository{})
	DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&models.ManagedGroup{})

	t1 := time.Now().Add(-1 * time.Hour)
	pGroup := models.ManagedGroup{
		ID:        500,
		Name:      "RootGroup",
		Path:      "RootGroup",
		FullPath:  "RootGroup",
		ParentID:  nil,
		SyncedAt:  &t1,
		IsHidden:  false,
		CreatedAt: t1,
	}
	DB.Create(&pGroup)

	cGroupID := uint(500)
	cGroup := models.ManagedGroup{
		ID:        501,
		Name:      "SubGroup",
		Path:      "SubGroup",
		FullPath:  "RootGroup/SubGroup",
		ParentID:  &cGroupID,
		SyncedAt:  &t1,
		IsHidden:  false,
		CreatedAt: t1,
	}
	DB.Create(&cGroup)

	DB.Create(&models.ManagedRepository{
		ID:             601,
		ManagedGroupID: 500,
		Name:           "repoA",
		SSHURL:         "git@github.com:root/repoA.git",
		HTTPURL:        "http://...",
		IsActive:       true,
		CreatedAt:      t1,
	})

	DB.Create(&models.ManagedRepository{
		ID:             602,
		ManagedGroupID: 501,
		Name:           "repoB",
		SSHURL:         "git@github.com:root/sub/repoB.git",
		HTTPURL:        "http://...",
		IsActive:       true,
		CreatedAt:      t1,
	})

	DB.Create(&models.ManagedBranchMonitor{
		ID:                  701,
		ManagedRepositoryID: 601,
		BranchName:          "main",
		LastCommitHash:      "123456",
		LastCommitTime:      t1,
		LastAuthor:          "author",
		IsMerged:            false,
		IsProtected:         true,
		Status:              "active",
		UpdatedAt:           t1,
	})

	DB.Create(&models.ManagedMemberAccess{
		ID:            801,
		SourceType:    "group",
		SourceID:      500,
		PrincipalType: "user",
		PrincipalID:   1,
		AccessLevel:   50,
	})

	// 执行删除级联清理逻辑（与 DeleteManagedGroup 后端保持一致）
	tx := DB.Begin()
	defer tx.Rollback()

	var subGroupIDs []uint
	likePattern := pGroup.FullPath + "/%"
	if err := tx.Model(&models.ManagedGroup{}).Where("full_path LIKE ?", likePattern).Pluck("id", &subGroupIDs).Error; err != nil {
		t.Fatalf("Failed to query sub groups: %v", err)
	}

	allGroupIDs := append([]uint{pGroup.ID}, subGroupIDs...)

	var repoIDs []uint
	if err := tx.Model(&models.ManagedRepository{}).Where("managed_group_id IN ?", allGroupIDs).Pluck("id", &repoIDs).Error; err != nil {
		t.Fatalf("Failed to query repos: %v", err)
	}

	if len(repoIDs) > 0 {
		_ = tx.Where("managed_repository_id IN ?", repoIDs).Delete(&models.ManagedBranchMonitor{}).Error
		_ = tx.Where("source_type = 'repository' AND source_id IN ?", repoIDs).Delete(&models.ManagedMemberAccess{}).Error
		_ = tx.Where("id IN ?", repoIDs).Delete(&models.ManagedRepository{}).Error
	}

	_ = tx.Where("source_type = 'group' AND source_id IN ?", allGroupIDs).Delete(&models.ManagedMemberAccess{}).Error
	_ = tx.Where("id IN ?", allGroupIDs).Delete(&models.ManagedGroup{}).Error

	if err := tx.Commit().Error; err != nil {
		t.Fatalf("Failed to commit transaction: %v", err)
	}

	// 校验全量删除结果
	var checkGroup models.ManagedGroup
	if err := DB.First(&checkGroup, 500).Error; err == nil {
		t.Fatal("Root group should have been deleted physically")
	}

	if err := DB.First(&checkGroup, 501).Error; err == nil {
		t.Fatal("Sub group should have been deleted physically")
	}

	var checkRepo models.ManagedRepository
	if err := DB.First(&checkRepo, 601).Error; err == nil {
		t.Fatal("RepoA should have been deleted")
	}

	var accessCount int64
	DB.Model(&models.ManagedMemberAccess{}).Where("source_type = 'group' AND source_id = 500").Count(&accessCount)
	if accessCount > 0 {
		t.Fatalf("Root group ACL should be deleted, got count: %d", accessCount)
	}

	t.Log("DeleteManagedGroup logic verification successfully passed.")
}
