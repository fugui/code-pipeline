package services

import (
	"context"
	"fmt"
	"testing"
	"time"

	"code-pipeline/database"
	"code-pipeline/models"
)

func TestSelectPipelineInGroup_LoadBalancing(t *testing.T) {
	setupTestDB(t)

	// 1. 创建一个独立的测试流水线组
	groupKey := fmt.Sprintf("test-group-%d", time.Now().UnixNano())
	group := models.PipelineGroup{
		GroupKey: groupKey,
		Name:     "单元测试负载均衡组",
		Type:     "MR",
		IsActive: true,
	}
	if err := database.DB.Create(&group).Error; err != nil {
		t.Fatalf("创建测试流水线组失败: %v", err)
	}
	defer database.DB.Delete(&group)

	// 2. 创建三条属于该组的物理流水线
	p1 := models.Pipeline{
		PipelineID: fmt.Sprintf("pipe-node-1-%d", time.Now().UnixNano()),
		Name:       "Node-1",
		Type:       "MR",
		GroupID:    &group.ID,
		Status:     "active",
	}
	p2 := models.Pipeline{
		PipelineID: fmt.Sprintf("pipe-node-2-%d", time.Now().UnixNano()),
		Name:       "Node-2",
		Type:       "MR",
		GroupID:    &group.ID,
		Status:     "active",
	}
	p3 := models.Pipeline{
		PipelineID: fmt.Sprintf("pipe-node-3-%d", time.Now().UnixNano()),
		Name:       "Node-3",
		Type:       "MR",
		GroupID:    &group.ID,
		Status:     "active",
	}
	database.DB.Create(&p1)
	database.DB.Create(&p2)
	database.DB.Create(&p3)
	defer database.DB.Delete(&p1)
	defer database.DB.Delete(&p2)
	defer database.DB.Delete(&p3)

	ctx := context.Background()

	// 此时 Node-1 (0), Node-2 (0), Node-3 (0) -> 应该选择 Node-1 (按 id 升序)
	selected1, err := SelectPipelineInGroup(ctx, database.DB, group.ID)
	if err != nil {
		t.Fatalf("首次调度失败: %v", err)
	}
	if selected1.ID != p1.ID {
		t.Fatalf("预期选择 Node-1, 实际选择了: %s (ID: %d)", selected1.Name, selected1.ID)
	}

	// 给 Node-1 挂载 1 个方案
	scheme1 := models.ExecutionScheme{
		Name:            "scheme-1",
		RepositoryID:    1,
		LocalPipelineID: p1.ID,
		Branch:          "master",
	}
	database.DB.Create(&scheme1)
	defer database.DB.Delete(&scheme1)

	// 此时 Node-1 (1), Node-2 (0), Node-3 (0) -> 应该选择 Node-2 (方案数最少且 ID 靠前)
	selected2, err := SelectPipelineInGroup(ctx, database.DB, group.ID)
	if err != nil {
		t.Fatalf("第二次调度失败: %v", err)
	}
	if selected2.ID != p2.ID {
		t.Fatalf("预期选择 Node-2, 实际选择了: %s (ID: %d)", selected2.Name, selected2.ID)
	}

	// 给 Node-2 挂载 2 个方案，Node-1 挂载 1 个方案，Node-3 挂载 0 个方案
	scheme2 := models.ExecutionScheme{
		Name:            "scheme-2",
		RepositoryID:    1,
		LocalPipelineID: p2.ID,
		Branch:          "master",
	}
	scheme3 := models.ExecutionScheme{
		Name:            "scheme-3",
		RepositoryID:    1,
		LocalPipelineID: p2.ID,
		Branch:          "develop",
	}
	database.DB.Create(&scheme2)
	database.DB.Create(&scheme3)
	defer database.DB.Delete(&scheme2)
	defer database.DB.Delete(&scheme3)

	// 此时调度：应该选择方案数最少的 Node-3 (0 个方案)
	selected3, err := SelectPipelineInGroup(ctx, database.DB, group.ID)
	if err != nil {
		t.Fatalf("第三次调度失败: %v", err)
	}
	if selected3.ID != p3.ID {
		t.Fatalf("预期选择 Node-3, 实际选择了: %s (ID: %d)", selected3.Name, selected3.ID)
	}

	// 给 Node-3 挂载 1 个方案
	scheme4 := models.ExecutionScheme{
		Name:            "scheme-4",
		RepositoryID:    1,
		LocalPipelineID: p3.ID,
		Branch:          "master",
	}
	database.DB.Create(&scheme4)
	defer database.DB.Delete(&scheme4)

	// 此时 Node-1 (1), Node-2 (2), Node-3 (1) -> 方案数最少的是 Node-1 和 Node-3，按 ID 升序应选中 Node-1
	selected4, err := SelectPipelineInGroup(ctx, database.DB, group.ID)
	if err != nil {
		t.Fatalf("第四次调度失败: %v", err)
	}
	if selected4.ID != p1.ID {
		t.Fatalf("预期选择 Node-1, 实际选择了: %s (ID: %d)", selected4.Name, selected4.ID)
	}
}
