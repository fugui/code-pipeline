package handlers

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"code-pipeline/database"
	"code-pipeline/models"
	"code-pipeline/services"

	"github.com/gin-gonic/gin"
)

// GetManagedCommitterGroups 分页查询 Committer Group 列表
func GetManagedCommitterGroups(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "25"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 25
	}

	query := database.DB.Model(&models.ManagedCommitterGroup{})

	// 搜索关键字
	q := strings.TrimSpace(c.Query("q"))
	if q != "" {
		searchPattern := "%" + q + "%"
		query = query.Where("name ILIKE ? OR iright_group_name ILIKE ? OR iright_group_id ILIKE ?", searchPattern, searchPattern, searchPattern)
	}

	// 筛选层级
	level := strings.TrimSpace(c.Query("level"))
	if level != "" {
		query = query.Where("level = ?", level)
	}

	// 筛选部门
	if deptIDStr := c.Query("department_id"); deptIDStr != "" {
		if deptID, err := strconv.Atoi(deptIDStr); err == nil && deptID > 0 {
			query = query.Where("department_id = ?", deptID)
		}
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取 Committer 组总数失败"})
		return
	}

	var groups []models.ManagedCommitterGroup
	offset := (page - 1) * pageSize
	if err := query.Preload("Department").Preload("Admin").
		Order("id DESC").
		Offset(offset).
		Limit(pageSize).
		Find(&groups).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询 Committer 组列表失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"items":     groups,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

// GetManagedCommitterGroup 获取单个 Committer Group 详情
func GetManagedCommitterGroup(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 ID"})
		return
	}

	var group models.ManagedCommitterGroup
	if err := database.DB.Preload("Department").Preload("Admin").First(&group, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Committer 组不存在"})
		return
	}

	c.JSON(http.StatusOK, group)
}

// CreateManagedCommitterGroupReq 创建请求结构
type CreateManagedCommitterGroupReq struct {
	Name            string `json:"name" binding:"required"`
	Level           string `json:"level" binding:"required"`
	DepartmentID    *uint  `json:"department_id"`
	AdminID         *uint  `json:"admin_id"`
	IRightGroupName string `json:"iright_group_name"`
	IRightGroupID   string `json:"iright_group_id"`
	MemberCount     int    `json:"member_count"`
	Description     string `json:"description"`
	IsActive        *bool  `json:"is_active"`
}

// CreateManagedCommitterGroup 创建 Committer Group
func CreateManagedCommitterGroup(c *gin.Context) {
	var req CreateManagedCommitterGroupReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数不合法: " + err.Error()})
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Committer Group 名称不能为空"})
		return
	}

	// 检查重名
	var count int64
	database.DB.Model(&models.ManagedCommitterGroup{}).Where("name = ?", req.Name).Count(&count)
	if count > 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "已存在同名的 Committer Group"})
		return
	}

	isActive := true
	if req.IsActive != nil {
		isActive = *req.IsActive
	}

	now := time.Now()
	group := models.ManagedCommitterGroup{
		Name:            req.Name,
		Level:           req.Level,
		DepartmentID:    req.DepartmentID,
		AdminID:         req.AdminID,
		IRightGroupName: strings.TrimSpace(req.IRightGroupName),
		IRightGroupID:   strings.TrimSpace(req.IRightGroupID),
		MemberCount:     req.MemberCount,
		Description:     strings.TrimSpace(req.Description),
		IsActive:        isActive,
		CreatedAt:       now,
		UpdatedAt:       now,
	}

	if err := database.DB.Create(&group).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建 Committer Group 失败: " + err.Error()})
		return
	}

	// 重新加载关联关系
	database.DB.Preload("Department").Preload("Admin").First(&group, group.ID)
	c.JSON(http.StatusCreated, group)
}

// UpdateManagedCommitterGroup 更新 Committer Group
func UpdateManagedCommitterGroup(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 ID"})
		return
	}

	var existing models.ManagedCommitterGroup
	if err := database.DB.First(&existing, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Committer Group 不存在"})
		return
	}

	var req CreateManagedCommitterGroupReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数不合法: " + err.Error()})
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	if req.Name != "" && req.Name != existing.Name {
		var count int64
		database.DB.Model(&models.ManagedCommitterGroup{}).Where("name = ? AND id != ?", req.Name, id).Count(&count)
		if count > 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "已存在同名的 Committer Group"})
			return
		}
		existing.Name = req.Name
	}

	if req.Level != "" {
		existing.Level = req.Level
	}
	existing.DepartmentID = req.DepartmentID
	existing.AdminID = req.AdminID
	existing.IRightGroupName = strings.TrimSpace(req.IRightGroupName)
	existing.IRightGroupID = strings.TrimSpace(req.IRightGroupID)
	existing.MemberCount = req.MemberCount
	existing.Description = strings.TrimSpace(req.Description)
	if req.IsActive != nil {
		existing.IsActive = *req.IsActive
	}
	existing.UpdatedAt = time.Now()

	if err := database.DB.Save(&existing).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新 Committer Group 失败: " + err.Error()})
		return
	}

	database.DB.Preload("Department").Preload("Admin").First(&existing, id)
	c.JSON(http.StatusOK, existing)
}

// DeleteManagedCommitterGroup 删除 Committer Group
func DeleteManagedCommitterGroup(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 ID"})
		return
	}

	var existing models.ManagedCommitterGroup
	if err := database.DB.First(&existing, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Committer Group 不存在"})
		return
	}

	if err := database.DB.Delete(&existing).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除 Committer Group 失败: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "已成功删除 Committer Group"})
}

// GetIRightGroup 查询 iRight 群组详情与成员人数
func GetIRightGroup(c *gin.Context) {
	groupID := strings.TrimSpace(c.Param("id"))
	if groupID == "" {
		groupID = strings.TrimSpace(c.Query("group_id"))
	}
	if groupID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "群组 ID (group_id) 不能为空"})
		return
	}

	data, err := services.GetIRightGroup(c.Request.Context(), groupID, c.Request.Header)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data":    data,
		"message": "success",
		"status":  200,
	})
}

