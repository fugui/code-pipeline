package services

import (
	"context"
	"fmt"
	"testing"
	"time"

	"code-pipeline/database"
	"code-pipeline/models"
)

func TestSelectPipelineInGroup_And_HealStatus(t *testing.T) {
	setupTestDB(t)

	// 1. 创建一个独立的测试流水线组 (容量上限为 2)
	groupKey := fmt.Sprintf("test-group-%d", time.Now().UnixNano())
	group := models.PipelineGroup{
		GroupKey:              groupKey,
		Name:                  "单元测试流水线组",
		Type:                  "MR",
		MaxSchemesPerPipeline: 2,
		IsActive:              true,
	}
	if err := database.DB.Create(&group).Error; err != nil {
		t.Fatalf("创建测试流水线组失败: %v", err)
	}
	defer database.DB.Delete(&group)

	// 2. 创建两条属于该组的物理流水线
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
	database.DB.Create(&p1)
	database.DB.Create(&p2)
	defer database.DB.Delete(&p1)
	defer database.DB.Delete(&p2)

	ctx := context.Background()

	// 此时 Node-1 (0 schemes), Node-2 (0 schemes) -> 应该选择 Node-1 (按 id 升序)
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

	// 再次调度：Node-1 (1 scheme), Node-2 (0 schemes) -> 应该选择 Node-2
	selected2, err := SelectPipelineInGroup(ctx, database.DB, group.ID)
	if err != nil {
		t.Fatalf("第二次调度失败: %v", err)
	}
	if selected2.ID != p2.ID {
		t.Fatalf("预期选择 Node-2, 实际选择了: %s (ID: %d)", selected2.Name, selected2.ID)
	}

	// 给 Node-1 挂载第 2 个方案 (达到容量上限 2)
	scheme2 := models.ExecutionScheme{
		Name:            "scheme-2",
		RepositoryID:    1,
		LocalPipelineID: p1.ID,
		Branch:          "develop",
	}
	database.DB.Create(&scheme2)
	defer database.DB.Delete(&scheme2)

	// 给 Node-2 挂载 2 个方案 (达到容量上限 2)
	scheme3 := models.ExecutionScheme{
		Name:            "scheme-3",
		RepositoryID:    1,
		LocalPipelineID: p2.ID,
		Branch:          "master",
	}
	scheme4 := models.ExecutionScheme{
		Name:            "scheme-4",
		RepositoryID:    1,
		LocalPipelineID: p2.ID,
		Branch:          "develop",
	}
	database.DB.Create(&scheme3)
	database.DB.Create(&scheme4)
	defer database.DB.Delete(&scheme3)
	defer database.DB.Delete(&scheme4)

	// 此时组内全部满载 -> 应该返回满载错误并标记节点为 full
	_, err = SelectPipelineInGroup(ctx, database.DB, group.ID)
	if err == nil {
		t.Fatalf("预期返回组满载错误，但未报错")
	}

	// 校验 p1 和 p2 是否已被自愈标记为 full
	var checkP1 models.Pipeline
	database.DB.First(&checkP1, p1.ID)
	if checkP1.Status != "full" {
		t.Fatalf("预期 Node-1 状态被更新为 'full', 实际为: %s", checkP1.Status)
	}

	// 3. 测试状态自愈：删除 scheme2 (使 Node-1 方案数回落到 1 < 2)
	database.DB.Delete(&scheme2)
	HealPipelineStatus(p1.ID)

	database.DB.First(&checkP1, p1.ID)
	if checkP1.Status != "active" {
		t.Fatalf("预期 Node-1 状态自愈恢复为 'active', 实际为: %s", checkP1.Status)
	}

	// 此时再次调度，应该成功选出恢复健康的 Node-1
	selected3, err := SelectPipelineInGroup(ctx, database.DB, group.ID)
	if err != nil {
		t.Fatalf("自愈后调度失败: %v", err)
	}
	if selected3.ID != p1.ID {
		t.Fatalf("预期自愈后选择 Node-1, 实际选择了: %s", selected3.Name)
	}
}
