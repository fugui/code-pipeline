package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	commonAudit "code-common/backend/audit"
	"code-pipeline/database"
	"code-pipeline/models"

	"github.com/gin-gonic/gin"
)

// PipelineGroupRequest 流水线组请求结构体
type PipelineGroupRequest struct {
	GroupKey              string `json:"group_key" binding:"required"`
	Name                  string `json:"name" binding:"required"`
	Type                  string `json:"type" binding:"required"`
	MaxSchemesPerPipeline int    `json:"max_schemes_per_pipeline"`
	IsActive              *bool  `json:"is_active"`
	Description           string `json:"description"`
}

// PipelineGroupResponse 流水线组响应结构体 (包含聚合容量与负载统计)
type PipelineGroupResponse struct {
	models.PipelineGroup
	PipelineCount int     `json:"pipeline_count"`
	TotalCapacity int     `json:"total_capacity"`
	UsedSchemes   int     `json:"used_schemes"`
	UsageRate     float64 `json:"usage_rate"`
}

// AttachDetachPipelinesRequest 批量关联/解绑流水线请求结构体
type AttachDetachPipelinesRequest struct {
	PipelineIDs []uint `json:"pipeline_ids" binding:"required"`
	Action      string `json:"action" binding:"required"` // "attach" | "detach"
}

// GetPipelineGroups 获取流水线组列表 (包含实时方案数与容量统计)
func GetPipelineGroups(c *gin.Context) {
	groupType := c.Query("type")
	search := c.Query("search")

	query := database.DB.Model(&models.PipelineGroup{}).Preload("Pipelines")

	if groupType != "" && groupType != "ALL" {
		query = query.Where("type = ?", groupType)
	}

	if search != "" {
		query = query.Where("name LIKE ? OR group_key LIKE ?", "%"+search+"%", "%"+search+"%")
	}

	var groups []models.PipelineGroup
	if err := query.Order("id ASC").Find(&groups).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取流水线组列表失败"})
		return
	}

	// 实时聚合查询所有流水线的方案数量
	type PipelineCountRow struct {
		PipelineID uint  `gorm:"column:pipeline_id"`
		Count      int64 `gorm:"column:count"`
	}
	var countRows []PipelineCountRow
	database.DB.Raw(`
		SELECT pipeline_id, COUNT(*) AS count
		FROM execution_schemes
		GROUP BY pipeline_id
	`).Scan(&countRows)

	pipelineSchemeCountMap := make(map[uint]int)
	for _, row := range countRows {
		pipelineSchemeCountMap[row.PipelineID] = int(row.Count)
	}

	responses := make([]PipelineGroupResponse, 0, len(groups))
	for _, g := range groups {
		pCount := len(g.Pipelines)
		maxCapPerNode := g.MaxSchemesPerPipeline
		if maxCapPerNode <= 0 {
			maxCapPerNode = 200
		}
		totalCap := pCount * maxCapPerNode

		used := 0
		for _, p := range g.Pipelines {
			used += pipelineSchemeCountMap[p.ID]
		}

		usageRate := 0.0
		if totalCap > 0 {
			usageRate = float64(used) / float64(totalCap) * 100.0
		}

		responses = append(responses, PipelineGroupResponse{
			PipelineGroup: g,
			PipelineCount: pCount,
			TotalCapacity: totalCap,
			UsedSchemes:   used,
			UsageRate:     usageRate,
		})
	}

	c.JSON(http.StatusOK, responses)
}

// CreatePipelineGroup 创建流水线组
func CreatePipelineGroup(c *gin.Context) {
	var req PipelineGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	groupKey := strings.TrimSpace(req.GroupKey)
	name := strings.TrimSpace(req.Name)
	if groupKey == "" || name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "流水线组唯一标识 (group_key) 和展示名称 (name) 不能为空"})
		return
	}

	maxCap := req.MaxSchemesPerPipeline
	if maxCap <= 0 {
		maxCap = 200
	}

	isActive := true
	if req.IsActive != nil {
		isActive = *req.IsActive
	}

	group := models.PipelineGroup{
		GroupKey:              groupKey,
		Name:                  name,
		Type:                  req.Type,
		MaxSchemesPerPipeline: maxCap,
		IsActive:              isActive,
		Description:           req.Description,
	}

	if err := database.DB.Create(&group).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("创建流水线组失败 (标识可能已存在): %v", err)})
		return
	}

	commonAudit.SetAuditContext(c, "pipeline_group", "create", models.AuditLevelP1,
		fmt.Sprintf("创建了流水线组: %s (%s)", group.Name, group.GroupKey),
		"pipeline_group", fmt.Sprintf("%d", group.ID), group.Name,
		nil, group)

	c.JSON(http.StatusCreated, group)
}

// UpdatePipelineGroup 更新流水线组
func UpdatePipelineGroup(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的组 ID"})
		return
	}

	var group models.PipelineGroup
	if err := database.DB.First(&group, uint(id)).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "流水线组不存在"})
		return
	}

	oldGroup := group

	var req PipelineGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Name != "" {
		group.Name = strings.TrimSpace(req.Name)
	}
	if req.GroupKey != "" {
		group.GroupKey = strings.TrimSpace(req.GroupKey)
	}
	if req.Type != "" {
		group.Type = req.Type
	}
	if req.MaxSchemesPerPipeline > 0 {
		group.MaxSchemesPerPipeline = req.MaxSchemesPerPipeline
	}
	if req.IsActive != nil {
		group.IsActive = *req.IsActive
	}
	group.Description = req.Description

	if err := database.DB.Save(&group).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("更新流水线组失败: %v", err)})
		return
	}

	commonAudit.SetAuditContext(c, "pipeline_group", "update", models.AuditLevelP1,
		fmt.Sprintf("修改了流水线组: %s (%s)", group.Name, group.GroupKey),
		"pipeline_group", fmt.Sprintf("%d", group.ID), group.Name,
		oldGroup, group)

	c.JSON(http.StatusOK, group)
}

// DeletePipelineGroup 删除流水线组
func DeletePipelineGroup(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的组 ID"})
		return
	}

	var group models.PipelineGroup
	if err := database.DB.First(&group, uint(id)).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "流水线组不存在"})
		return
	}

	// 检查组内是否还有关联的物理流水线
	var pipelineCount int64
	database.DB.Model(&models.Pipeline{}).Where("group_id = ?", group.ID).Count(&pipelineCount)
	if pipelineCount > 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("无法删除该流水线组: 组内仍有 %d 条关联的物理流水线，请先将流水线移出或解绑", pipelineCount),
		})
		return
	}

	if err := database.DB.Delete(&group).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除流水线组失败"})
		return
	}

	commonAudit.SetAuditContext(c, "pipeline_group", "delete", models.AuditLevelP1,
		fmt.Sprintf("删除了流水线组: %s (%s)", group.Name, group.GroupKey),
		"pipeline_group", fmt.Sprintf("%d", group.ID), group.Name,
		group, nil)

	c.JSON(http.StatusOK, gin.H{"message": "流水线组删除成功"})
}

// AttachDetachPipelinesToGroup 批量将物理流水线加入或移出指定流水线组
func AttachDetachPipelinesToGroup(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的组 ID"})
		return
	}

	var group models.PipelineGroup
	if err := database.DB.First(&group, uint(id)).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "流水线组不存在"})
		return
	}

	var req AttachDetachPipelinesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if len(req.PipelineIDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "未选择任何流水线"})
		return
	}

	if req.Action == "attach" {
		// 校验流水线类型是否与流水线组类型一致 (保证组内同质性)
		var mismatched []models.Pipeline
		if err := database.DB.Where("id IN ? AND type != ?", req.PipelineIDs, group.Type).Find(&mismatched).Error; err == nil && len(mismatched) > 0 {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": fmt.Sprintf("流水线类型不匹配: 流水线组类型为 [%s]，但物理流水线 [%s] 的类型为 [%s]，无法加入该组",
					group.Type, mismatched[0].Name, mismatched[0].Type),
			})
			return
		}

		if err := database.DB.Model(&models.Pipeline{}).
			Where("id IN ?", req.PipelineIDs).
			Updates(map[string]interface{}{
				"group_id": group.ID,
			}).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "批量加入流水线组失败"})
			return
		}
	} else if req.Action == "detach" {
		if err := database.DB.Model(&models.Pipeline{}).
			Where("id IN ? AND group_id = ?", req.PipelineIDs, group.ID).
			Updates(map[string]interface{}{
				"group_id": nil,
			}).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "批量移出流水线组失败"})
			return
		}
	} else {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的操作类型 (仅支持 attach 或 detach)"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "流水线分组调整成功"})
}
