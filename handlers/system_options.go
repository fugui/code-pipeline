package handlers

import (
	"net/http"

	"code-pipeline/database"
	"code-pipeline/models"

	"github.com/gin-gonic/gin"
)

// GetSystemOptions 返回系统关联的用户、部门、子系统等下拉候选项实体
func GetSystemOptions(c *gin.Context) {
	// 1. 获取系统全量用户
	var users []models.User
	_ = database.DB.Select("id, name, username, email").Order("name ASC, username ASC").Find(&users)

	type UserOption struct {
		ID       uint   `json:"id"`
		Name     string `json:"name"`
		Username string `json:"username"`
		Email    string `json:"email"`
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
		userList = append(userList, UserOption{
			ID:       u.ID,
			Name:     displayName,
			Username: u.Username,
			Email:    u.Email,
		})
	}

	// 2. 获取系统部门
	var departments []models.Department
	_ = database.DB.Order("name ASC").Find(&departments)

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

	// 3. 获取系统子系统
	var subsystems []models.Subsystem
	_ = database.DB.Order("name ASC").Find(&subsystems)

	subList := make([]OptionItem, 0)
	for _, s := range subsystems {
		if s.Name != "" {
			subList = append(subList, OptionItem{ID: s.ID, Name: s.Name})
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"users":       userList,
		"departments": deptList,
		"subsystems":  subList,
	})
}
