package services

import (
	"context"
	"code-pipeline/database"
	"code-pipeline/models"
	"testing"
	"time"
)

func TestSyncGroupRecursiveSkipHidden(t *testing.T) {
	database.InitDB()

	// 1. 在本地数据库存入一个 is_hidden = true 的分组
	t1 := time.Now()
	// 先删除旧数据以防主键冲突
	database.DB.Exec("DELETE FROM managed_groups WHERE id = 999")

	hiddenGroup := models.ManagedGroup{
		ID:        999,
		Name:      "HiddenGroup",
		Path:      "HiddenGroup",
		FullPath:  "HiddenGroup",
		ParentID:  nil,
		SyncedAt:  &t1,
		IsHidden:  true,
		CreatedAt: t1,
	}
	database.DB.Create(&hiddenGroup)

	// 2. 尝试对其执行 syncGroupRecursive
	ctx := context.Background()
	err := syncGroupRecursive(ctx, 999, 1)

	// 3. 断言返回值应该为 nil 且没有任何网络请求或报错
	if err != nil {
		t.Fatalf("syncGroupRecursive returned error: %v", err)
	}

	// 4. 清理测试数据
	database.DB.Delete(&hiddenGroup)
	t.Log("syncGroupRecursive skipped hidden group successfully.")
}
