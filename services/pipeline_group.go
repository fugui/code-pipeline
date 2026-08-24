package services

import (
	"context"
	"fmt"
	"log"

	"code-pipeline/database"
	"code-pipeline/models"

	"gorm.io/gorm"
)

// SelectPipelineInGroup 在指定流水线组中，通过实时方案统计选出当前负载最低 (方案数最少) 的物理流水线
func SelectPipelineInGroup(ctx context.Context, tx *gorm.DB, groupID uint) (*models.Pipeline, error) {
	if tx == nil {
		tx = database.DB
	}

	var group models.PipelineGroup
	if err := tx.First(&group, groupID).Error; err != nil {
		return nil, fmt.Errorf("流水线组 (ID: %d) 不存在: %w", groupID, err)
	}

	if !group.IsActive {
		return nil, fmt.Errorf("流水线组 [%s] 当前处于禁用状态", group.Name)
	}

	type candidate struct {
		models.Pipeline
		SchemeCount int64 `gorm:"column:scheme_count"`
	}

	var candidates []candidate
	// 实时联表统计组内节点挂载的方案数，按方案数升序排列，方案数相同按节点 ID 升序
	err := tx.Raw(`
		SELECT p.*, COALESCE(c.cnt, 0) AS scheme_count
		FROM pipelines p
		LEFT JOIN (
			SELECT pipeline_id, COUNT(*) AS cnt
			FROM execution_schemes
			GROUP BY pipeline_id
		) c ON c.pipeline_id = p.id
		WHERE p.group_id = ?
		ORDER BY scheme_count ASC, p.id ASC
	`, groupID).Scan(&candidates).Error

	if err != nil {
		return nil, fmt.Errorf("查询流水线组节点负载失败: %w", err)
	}

	if len(candidates) == 0 {
		return nil, fmt.Errorf("流水线组 [%s] 下暂无可用物理流水线，请联系管理员添加流水线", group.Name)
	}

	// 选出当前方案数最少的节点
	selected := &candidates[0]
	log.Printf("[PipelineGroup] Selected pipeline %s (ID: %d) in group %s (current schemes: %d)\n",
		selected.Name, selected.ID, group.Name, selected.SchemeCount)

	return &selected.Pipeline, nil
}
