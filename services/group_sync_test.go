package services

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"code-pipeline/database"
	"code-pipeline/models"
)

func TestSyncGroupRecursiveSkipHidden(t *testing.T) {
	_ = models.LoadConfig("../config.yaml")
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

func TestSyncGroupRecursiveUpdatesSubgroupTime(t *testing.T) {
	_ = models.LoadConfig("../config.yaml")
	database.InitDB()

	// 1. 本地数据库中创建测试组
	database.DB.Exec("DELETE FROM managed_groups WHERE id IN (9001, 9002)")

	parentID := uint(9001)
	g1 := models.ManagedGroup{
		ID:        9001,
		Name:      "infra",
		Path:      "infra",
		FullPath:  "infra",
		ParentID:  nil,
		SyncedAt:  nil,
		IsHidden:  false,
		CreatedAt: time.Now(),
	}
	g2 := models.ManagedGroup{
		ID:        9002,
		Name:      "sub",
		Path:      "sub",
		FullPath:  "infra/sub",
		ParentID:  &parentID,
		SyncedAt:  nil,
		IsHidden:  false,
		CreatedAt: time.Now(),
	}
	database.DB.Create(&g1)
	database.DB.Create(&g2)

	// 2. Mock 接口返回
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if r.Method == "GET" && path == "/api/v1/groups/9001/subgroups" {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`[{"id":9002,"name":"sub","path":"sub","full_path":"infra/sub"}]`))
			return
		}
		if r.Method == "GET" && path == "/api/v1/groups/9001/projects" {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"status":"success","result":[]}`))
			return
		}
		if r.Method == "GET" && path == "/api/v1/groups/9002/subgroups" {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`[]`))
			return
		}
		if r.Method == "GET" && path == "/api/v1/groups/9002/projects" {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"status":"success","result":[]}`))
			return
		}
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer server.Close()

	origBaseURL := GitPlatformBaseURL
	GitPlatformBaseURL = server.URL + "/api/v1"
	defer func() {
		GitPlatformBaseURL = origBaseURL
	}()

	// 3. 执行同步
	ctx := context.Background()
	err := syncGroupRecursive(ctx, 9001, 1)
	if err != nil {
		t.Fatalf("syncGroupRecursive returned error: %v", err)
	}

	// 4. 断言父组和子组的 synced_at 均已被更新
	var res1 models.ManagedGroup
	var res2 models.ManagedGroup
	database.DB.First(&res1, 9001)
	database.DB.First(&res2, 9002)

	if res1.SyncedAt == nil {
		t.Error("Expected root group synced_at to be non-nil")
	}
	if res2.SyncedAt == nil {
		t.Error("Expected subgroup synced_at to be non-nil")
	}

	// 5. 清理测试数据
	database.DB.Delete(&g1)
	database.DB.Delete(&g2)
}
