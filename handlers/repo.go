package handlers

import (
	"net/http"

	"code-pipeline/database"
	"code-pipeline/models"
	"code-pipeline/services"

	"github.com/gin-gonic/gin"
)

type RepositoryRequest struct {
	Name     string `json:"name" binding:"required"`
	GitURL   string `json:"git_url" binding:"required"`
	Branch   string `json:"branch"`
	BuildCmd string `json:"build_cmd"`
	CheckCmd string `json:"check_cmd"`
	CronExpr string `json:"cron_expr"`
	IsActive bool   `json:"is_active"`
}

func GetRepos(c *gin.Context) {
	var repos []models.Repository
	query := database.DB.Model(&models.Repository{})

	search := c.Query("search")
	if search != "" {
		query = query.Where("name LIKE ?", "%"+search+"%")
	}

	if err := query.Find(&repos).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch repositories"})
		return
	}

	c.JSON(http.StatusOK, repos)
}

func GetRepoDetails(c *gin.Context) {
	id := c.Param("id")
	var repo models.Repository
	if err := database.DB.First(&repo, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Repository not found"})
		return
	}
	c.JSON(http.StatusOK, repo)
}

func CreateRepo(c *gin.Context) {
	var req RepositoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	branch := req.Branch
	if branch == "" {
		branch = "master"
	}

	repo := models.Repository{
		Name:     req.Name,
		GitURL:   req.GitURL,
		Branch:   branch,
		BuildCmd: req.BuildCmd,
		CheckCmd: req.CheckCmd,
		CronExpr: req.CronExpr,
		IsActive: req.IsActive,
	}

	// 写入数据库
	if err := database.DB.Create(&repo).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create repository. Name might already exist."})
		return
	}

	// 注册定时任务
	services.UpdateRepoSchedule(repo)

	c.JSON(http.StatusCreated, repo)
}

func UpdateRepo(c *gin.Context) {
	id := c.Param("id")
	var repo models.Repository
	if err := database.DB.First(&repo, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Repository not found"})
		return
	}

	var req RepositoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	branch := req.Branch
	if branch == "" {
		branch = "master"
	}

	repo.Name = req.Name
	repo.GitURL = req.GitURL
	repo.Branch = branch
	repo.BuildCmd = req.BuildCmd
	repo.CheckCmd = req.CheckCmd
	repo.CronExpr = req.CronExpr
	repo.IsActive = req.IsActive

	if err := database.DB.Save(&repo).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update repository"})
		return
	}

	// 更新定时任务
	services.UpdateRepoSchedule(repo)

	c.JSON(http.StatusOK, repo)
}

func DeleteRepo(c *gin.Context) {
	id := c.Param("id")
	var repo models.Repository
	if err := database.DB.First(&repo, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Repository not found"})
		return
	}

	if err := database.DB.Delete(&repo).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete repository"})
		return
	}

	// 移除定时任务
	services.RemoveRepoSchedule(repo.ID)

	c.JSON(http.StatusOK, gin.H{"message": "Repository deleted successfully"})
}

func TriggerRepo(c *gin.Context) {
	id := c.Param("id")
	var repo models.Repository
	if err := database.DB.First(&repo, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Repository not found"})
		return
	}

	logID, err := services.TriggerPipeline(repo.ID, "manual")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to trigger pipeline: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":      "Pipeline triggered successfully",
		"execution_id": logID,
	})
}
