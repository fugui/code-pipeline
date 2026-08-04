package handlers

import (
	"net/http"

	"code-pipeline/database"
	"code-pipeline/models"

	"github.com/gin-gonic/gin"
)

// GetSystemOptions 返回系统关联的用户、部门、子系统等下拉候选项
func GetSystemOptions(c *gin.Context) {
	// 1. 获取系统全量用户
	var users []models.User
	_ = database.DB.Select("id, name, username, email").Order("name ASC, username ASC").Find(&users)

	type UserItem struct {
		ID       uint   `json:"id"`
		Name     string `json:"name"`
		Username string `json:"username"`
		Email    string `json:"email"`
	}

	userList := make([]UserItem, 0)
	for _, u := range users {
		displayName := u.Name
		if displayName == "" {
			displayName = u.Username
		}
		if displayName == "" {
			displayName = u.Email
		}
		userList = append(userList, UserItem{
			ID:       u.ID,
			Name:     displayName,
			Username: u.Username,
			Email:    u.Email,
		})
	}

	// 2. 获取系统部门
	var departments []models.Department
	_ = database.DB.Order("name ASC").Find(&departments)
	deptNames := make([]string, 0)
	for _, d := range departments {
		if d.Name != "" {
			deptNames = append(deptNames, d.Name)
		}
	}

	// 补全已存数据库中其他非空部门
	var existingDepts []string
	database.DB.Model(&models.ManagedRepository{}).Distinct("department").Where("department != ''").Pluck("department", &existingDepts)
	for _, dept := range existingDepts {
		found := false
		for _, d := range deptNames {
			if d == dept {
				found = true
				break
			}
		}
		if !found {
			deptNames = append(deptNames, dept)
		}
	}

	// 3. 获取系统子系统
	var subsystems []models.Subsystem
	_ = database.DB.Order("name ASC").Find(&subsystems)
	subsystemNames := make([]string, 0)
	for _, s := range subsystems {
		if s.Name != "" {
			subsystemNames = append(subsystemNames, s.Name)
		}
	}

	// 补全已存数据库中其他非空子系统
	var existingSubsystems []string
	database.DB.Model(&models.ManagedRepository{}).Distinct("subsystem").Where("subsystem != ''").Pluck("subsystem", &existingSubsystems)
	for _, sub := range existingSubsystems {
		found := false
		for _, s := range subsystemNames {
			if s == sub {
				found = true
				break
			}
		}
		if !found {
			subsystemNames = append(subsystemNames, sub)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"users":       userList,
		"departments": deptNames,
		"subsystems":  subsystemNames,
	})
}
