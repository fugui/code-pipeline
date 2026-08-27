package handlers

import (
	"net/http"
	"strconv"
	"strings"

	"code-pipeline/database"
	"code-pipeline/models"

	"github.com/gin-gonic/gin"
)

// GetSystemOptions 返回系统关联的用户、部门、子系统等下拉候选项实体
func GetSystemOptions(c *gin.Context) {
	// 1. 获取系统全量用户（含部门关联）
	var users []models.User
	_ = database.DB.Select("id, name, username, email, employee_id, department_id").Order("name ASC, username ASC").Find(&users)

	// 构建部门 ID -> 名称映射
	var departments []models.Department
	_ = database.DB.Select("id, name").Find(&departments)
	deptMap := make(map[uint]string)
	for _, d := range departments {
		deptMap[d.ID] = d.Name
	}

	type UserOption struct {
		ID             uint   `json:"id"`
		Name           string `json:"name"`
		Username       string `json:"username"`
		Email          string `json:"email"`
		EmployeeID     string `json:"employee_id"`
		DepartmentID   *uint  `json:"department_id,omitempty"`
		DepartmentName string `json:"department_name,omitempty"`
	}

	userList := make([]UserOption, 0)
	for _, u := range users {
		displayName := u.Name
		if displayName == "" {
			displayName = u.Username
		}
		if displayName == "" {
			displayName = u.Email
		}
		deptName := ""
		if u.DepartmentID != nil {
			deptName = deptMap[*u.DepartmentID]
		}
		userList = append(userList, UserOption{
			ID:             u.ID,
			Name:           displayName,
			Username:       u.Username,
			Email:          u.Email,
			EmployeeID:     u.EmployeeID,
			DepartmentID:   u.DepartmentID,
			DepartmentName: deptName,
		})
	}

	// 2. 构建部门下拉选项（复用前面已查询的 departments）

	type OptionItem struct {
		ID   uint   `json:"id"`
		Name string `json:"name"`
	}

	deptList := make([]OptionItem, 0)
	for _, d := range departments {
		if d.Name != "" {
			deptList = append(deptList, OptionItem{ID: d.ID, Name: d.Name})
		}
	}

	// 3. 获取 code-bench 架构元素中的第一层级 (Subsystems)
	var subsystems []models.Subsystem
	_ = database.DB.Where("parent_id IS NULL OR type = ?", "subsystem").Order("name_cn ASC, identifier ASC").Find(&subsystems)

	subList := make([]OptionItem, 0)
	for _, s := range subsystems {
		displayName := s.NameCn
		if displayName == "" {
			displayName = s.NameEn
		}
		if displayName == "" {
			displayName = s.Identifier
		}
		if displayName != "" {
			subList = append(subList, OptionItem{ID: s.ID, Name: displayName})
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"users":       userList,
		"departments": deptList,
		"subsystems":  subList,
	})
}

// GetUsers 分页与关键字模糊搜索用户列表，支持 MultiMemberSearchSelect 统一组件调用
func GetUsers(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", "20"))
	search := strings.TrimSpace(c.Query("search"))

	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 1000 {
		pageSize = 1000
	}

	query := database.DB.Model(&models.User{}).Preload("Department")

	if search != "" {
		searchPattern := "%" + search + "%"
		query = query.Where("name ILIKE ? OR username ILIKE ? OR email ILIKE ? OR employee_id ILIKE ?",
			searchPattern, searchPattern, searchPattern, searchPattern)
	}

	deptIDStr := c.Query("department_id")
	if deptIDStr != "" {
		if deptID, err := strconv.Atoi(deptIDStr); err == nil && deptID > 0 {
			query = query.Where("department_id = ?", deptID)
		}
	}

	idStr := c.Query("id")
	if idStr != "" {
		if id, err := strconv.Atoi(idStr); err == nil && id > 0 {
			query = query.Where("id = ?", id)
		}
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取用户总数失败"})
		return
	}

	var users []models.User
	offset := (page - 1) * pageSize
	if err := query.Order("id ASC").Offset(offset).Limit(pageSize).Find(&users).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "查询用户列表失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"items":     users,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

