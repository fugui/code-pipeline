package services

import (
	"context"
	"fmt"
	"log"

	"code-pipeline/database"
	"code-pipeline/models"

	"gorm.io/gorm"
)

// SelectPipelineInGroup 在指定流水线组中，通过实时负载统计选出当前挂载方案数最少且未满载的物理流水线
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

	capacityLimit := group.MaxSchemesPerPipeline
	if capacityLimit <= 0 {
		capacityLimit = 200 // 默认单流水线最大方案容量为 200
	}

	type candidate struct {
		models.Pipeline
		SchemeCount int64 `gorm:"column:scheme_count"`
	}

	var candidates []candidate
	// 实时联表统计组内 active 节点挂载的方案数，按方案数升序排列
	err := tx.Raw(`
		SELECT p.*, COALESCE(c.cnt, 0) AS scheme_count
		FROM pipelines p
		LEFT JOIN (
			SELECT pipeline_id, COUNT(*) AS cnt
			FROM execution_schemes
			GROUP BY pipeline_id
		) c ON c.pipeline_id = p.id
		WHERE p.group_id = ? AND p.status = 'active'
		ORDER BY scheme_count ASC, p.id ASC
	`, groupID).Scan(&candidates).Error

	if err != nil {
		return nil, fmt.Errorf("查询流水线组节点负载失败: %w", err)
	}

	if len(candidates) == 0 {
		return nil, fmt.Errorf("流水线组 [%s] 下暂无处于活跃状态的可用物理流水线，请联系管理员添加或激活流水线", group.Name)
	}

	// 遍历候选节点，选择第一个方案数未达上限的节点
	for i := range candidates {
		c := &candidates[i]
		if c.SchemeCount < int64(capacityLimit) {
			log.Printf("[PipelineGroup] Selected pipeline %s (ID: %d) in group %s: current schemes=%d, limit=%d\n",
				c.Name, c.ID, group.Name, c.SchemeCount, capacityLimit)
			return &c.Pipeline, nil
		}

		// 该节点已达上限，自愈标记为 full
		log.Printf("[PipelineGroup] Pipeline %s (ID: %d) reached capacity limit (%d/%d), marking as full\n",
			c.Name, c.ID, c.SchemeCount, capacityLimit)
		tx.Model(&models.Pipeline{}).Where("id = ?", c.ID).Update("status", "full")
	}

	return nil, fmt.Errorf("流水线组 [%s] 内所有物理流水线均已满载 (共 %d 个节点，单节点上限 %d)，请联系管理员扩容添加新流水线",
		group.Name, len(candidates), capacityLimit)
}

// HealPipelineStatus 当方案被删除或下架后，检查关联的物理流水线是否从满载状态恢复为 active
func HealPipelineStatus(pipelineID uint) {
	if pipelineID == 0 {
		return
	}

	var pipeline models.Pipeline
	if err := database.DB.Preload("Group").First(&pipeline, pipelineID).Error; err != nil {
		return
	}

	// 如果非 full 状态或未加入任何组，无需自愈
	if pipeline.Status != "full" || pipeline.GroupID == nil || *pipeline.GroupID == 0 {
		return
	}

	capacityLimit := 200
	if pipeline.Group != nil && pipeline.Group.MaxSchemesPerPipeline > 0 {
		capacityLimit = pipeline.Group.MaxSchemesPerPipeline
	}

	var currentCount int64
	if err := database.DB.Model(&models.ExecutionScheme{}).Where("pipeline_id = ?", pipelineID).Count(&currentCount).Error; err != nil {
		return
	}

	if currentCount < int64(capacityLimit) {
		if err := database.DB.Model(&pipeline).Update("status", "active").Error; err == nil {
			log.Printf("[PipelineGroup] Pipeline %s (ID: %d) healed from 'full' to 'active' (schemes: %d/%d)\n",
				pipeline.Name, pipeline.ID, currentCount, capacityLimit)
		}
	}
}
