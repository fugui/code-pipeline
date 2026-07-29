package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"code-pipeline/database"
	"code-pipeline/models"
	"code-pipeline/services"
	"code-pipeline/utils"

	"github.com/gin-gonic/gin"
)

// FetchPipelineInfoFromRemote 根据 pipeline_id 调用配置接口获取三方流水线系统中的名称等信息
func FetchPipelineInfoFromRemote(c *gin.Context) {
	pipelineID := c.Query("pipeline_id")
	if pipelineID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "pipeline_id is required"})
		return
	}

	// 1. 获取要透传的 HTTP Headers
	headers := prepareRequestHeaders(c)

	// 2. 调用 service 获取数据
	pipelineInfo, err := services.FetchRemotePipelineInfo(c.Request.Context(), pipelineID, headers)
	if err != nil {
		if HandleSSOExpired(c, err) {
			return
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"pipeline_id":  pipelineInfo.PipelineID,
		"name":         pipelineInfo.Name,
		"type":         pipelineInfo.Type,
		"group_name":   pipelineInfo.GroupName,
		"description":  pipelineInfo.Description,
		"service_id":   pipelineInfo.ServiceID,
		"workspace_id": pipelineInfo.WorkspaceID,
		"owner_id":     pipelineInfo.OwnerID,
		"owner_name":   pipelineInfo.OwnerName,
		"service_name": pipelineInfo.ServiceName,
		"is_mock":      false,
	})
}

// SyncExecutionSchemes 从三方系统同步指定流水线的执行方案，并保存至本地数据库
func SyncExecutionSchemes(c *gin.Context) {
	pipelineIDStr := c.Query("pipeline_id")
	if pipelineIDStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "pipeline_id is required"})
		return
	}

	var pipeline models.Pipeline
	if err := database.DB.Where("pipeline_id = ?", pipelineIDStr).First(&pipeline).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Pipeline not found"})
		return
	}

	// 1. 获取要透传的 HTTP Headers
	headers := prepareRequestHeaders(c)

	// 2.1 先获取 MR 绑定的列表
	mrBindings, err := services.FetchRemoteMRBindings(c.Request.Context(), pipeline.PipelineID, headers)
	if err != nil {
		if HandleSSOExpired(c, err) {
			return
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("Failed to fetch MR bindings: %v", err)})
		return
	}
	log.Printf("[SyncExecutionSchemes] Fetched %d MR bindings from remote\n", len(mrBindings))

	// 2.2 调用 service 抓取执行方案列表
	schemes, err := services.FetchRemoteExecutionSchemes(c.Request.Context(), pipeline.PipelineID, headers)
	if err != nil {
		if HandleSSOExpired(c, err) {
			return
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	// 2.3 调用 service 抓取执行计划列表
	plans, err := services.FetchRemoteExecutionPlans(c.Request.Context(), pipeline.PipelineID, headers)
	if err != nil {
		if HandleSSOExpired(c, err) {
			return
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("Failed to fetch execution plans: %v", err)})
		return
	}
	log.Printf("[SyncExecutionSchemes] Fetched %d execution plans from remote\n", len(plans))

	// 3.1 根据获取的方案数据、MR 绑定数据、执行计划数据，更新本地数据
	var allRepos []models.Repository
	repoMap := make(map[string]models.Repository)
	if err := database.DB.Find(&allRepos).Error; err == nil {
		for _, r := range allRepos {
			normalizedURL := utils.NormalizeGitURL(r.URL)
			if normalizedURL != "" {
				repoMap[normalizedURL] = r
			}
		}
	} else {
		log.Printf("[SyncExecutionSchemes] Error pre-loading repositories from DB: %v\n", err)
	}

	var finalSchemes []models.ExecutionScheme
	for _, remoteScheme := range schemes {
		// 根据 Scheme 的原始数据组装 ExecutionScheme 实例
		scheme := models.ExecutionScheme{
			ExecutionSchemeID:   remoteScheme.ID,
			ExecutionSchemeName: remoteScheme.Name,
			Name:                remoteScheme.Name,
			LocalPipelineID:     pipeline.ID,
			CustomAttributes:    remoteScheme.CustomParameter,
			MRTrigger:           false,
			DailyBuild:          false,
		}

		var codeURL string
		var branch string

		// 从 Scheme 的 CustomParameter 中解析 Username, Password, CodeCheckerTaskID 极其代码仓与分支属性
		if remoteScheme.CustomParameter != "" {
			var cp struct {
				BuildParameters []struct {
					Name  string `json:"name"`
					Value string `json:"value"`
				} `json:"buildParameters"`
			}
			if err := json.Unmarshal([]byte(remoteScheme.CustomParameter), &cp); err == nil {
				for _, param := range cp.BuildParameters {
					switch param.Name {
					case "cmc_username":
						scheme.Username = param.Value
					case "cmc_password":
						scheme.Password = param.Value
					case "code_checker_task_id":
						scheme.CodeCheckerTaskID = param.Value
						if param.Value != "" {
							if taskName, err := services.GetCheckerTaskName(c.Request.Context(), remoteScheme.Name, param.Value, headers); err == nil {
								scheme.CodeCheckerTaskName = taskName
							} else {
								log.Printf("[SyncExecutionSchemes] Warning: failed to fetch checker task name for %s: %v\n", param.Value, err)
								scheme.CodeCheckerTaskName = remoteScheme.Name
							}
						}
					case "repository":
						codeURL = param.Value
					case "branch":
						branch = param.Value
					}
				}
			} else {
				log.Printf("[SyncExecutionSchemes] Warning: failed to parse customParameter JSON for scheme %s: %v\n", remoteScheme.ID, err)
			}
		}

		// 匹配 MR 绑定
		var matchedMRBinding *models.MRBinding
		for i := range mrBindings {
			if mrBindings[i].SchemeID == remoteScheme.ID {
				matchedMRBinding = &mrBindings[i]
				break
			}
		}

		if matchedMRBinding != nil {
			scheme.MRBindingID = matchedMRBinding.ID
			scheme.MRBindingName = matchedMRBinding.SchemeName
			scheme.MRTrigger = true
			if matchedMRBinding.Branches != "" {
				branch = matchedMRBinding.Branches
			}
			if matchedMRBinding.CodeURL != "" {
				codeURL = matchedMRBinding.CodeURL
			}
		}

		// 匹配执行计划
		var matchedPlan *models.RemoteExecutionPlan
		for i := range plans {
			if plans[i].PfkSchemeID == remoteScheme.ID {
				matchedPlan = &plans[i]
				break
			}
		}

		if matchedPlan != nil {
			scheme.ExecutionPlanID = matchedPlan.ID
			scheme.ExecutionPlanName = matchedPlan.ScheduleName
			scheme.DailyBuild = true
		}

		scheme.Branch = branch

		// 合并代码仓数据，并利用规格化逻辑在本地仓库中匹配关联
		if codeURL != "" {
			normalizedCodeURL := utils.NormalizeGitURL(codeURL)
			if r, found := repoMap[normalizedCodeURL]; found {
				scheme.RepositoryID = r.ID
				scheme.Repository = &r
			} else {
				log.Printf("[SyncExecutionSchemes] Warning: CodeURL %s (normalized: %s) not found in local mirrors\n", codeURL, normalizedCodeURL)
			}
		}

		// 如果 RepositoryID 是 0（没有在本地同步此镜像），则跳过该执行方案以保证运行安全性
		if scheme.RepositoryID == 0 {
			log.Printf("[SyncExecutionSchemes] Warning: skipped execution scheme %s because repository ID is 0\n", scheme.ExecutionSchemeID)
			continue
		}

		finalSchemes = append(finalSchemes, scheme)
	}

	tx := database.DB.Begin()
	if err := tx.Where("pipeline_id = ?", pipeline.ID).Delete(&models.ExecutionScheme{}).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to clear old execution schemes"})
		return
	}

	for i := range finalSchemes {
		if err := tx.Omit("Repository", "PipelineInfo").Create(&finalSchemes[i]).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save synced execution schemes"})
			return
		}
	}

	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Transaction commit failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": fmt.Sprintf("Successfully synced %d execution schemes", len(finalSchemes))})
}

// -----------------------------------------------------------------------------
// 差异比对与二次确认同步数据结构与处理函数
// -----------------------------------------------------------------------------

type DiffItemChange struct {
	Category  string `json:"category"`   // "scheme", "mr_binding", "execution_plan"
	FieldName string `json:"field_name"` // e.g. "生效分支", "MR触发绑定", "每日构建计划"
	OldValue  string `json:"old_value"`
	NewValue  string `json:"new_value"`
}

type AddDiffItem struct {
	RemoteSchemeID string                 `json:"remote_scheme_id"`
	Name           string                 `json:"name"`
	RepositoryID   uint                   `json:"repository_id"`
	RepositoryName string                 `json:"repository_name"`
	Branch         string                 `json:"branchs"`
	MRTrigger      bool                   `json:"mr_trigger"`
	DailyBuild     bool                   `json:"daily_build"`
	SchemeData     models.ExecutionScheme `json:"scheme_data"`
}

type UpdateDiffItem struct {
	LocalID        uint                   `json:"local_id"`
	RemoteSchemeID string                 `json:"remote_scheme_id"`
	Name           string                 `json:"name"`
	RepositoryName string                 `json:"repository_name"`
	Branch         string                 `json:"branchs"`
	Changes        []DiffItemChange       `json:"changes"`
	NewSchemeData  models.ExecutionScheme `json:"new_scheme_data"`
}

type DeleteDiffItem struct {
	LocalID        uint   `json:"local_id"`
	RemoteSchemeID string `json:"remote_scheme_id"`
	Name           string `json:"name"`
	RepositoryName string `json:"repository_name"`
	Branch         string `json:"branchs"`
	HadMRTrigger   bool   `json:"had_mr_trigger"`
	HadDailyBuild  bool   `json:"had_daily_build"`
}

type UnchangedDiffItem struct {
	LocalID        uint   `json:"local_id"`
	RemoteSchemeID string `json:"remote_scheme_id"`
	Name           string `json:"name"`
	RepositoryName string `json:"repository_name"`
	Branch         string `json:"branchs"`
}

type CalculateDiffResponse struct {
	PipelineID   uint   `json:"pipeline_id"`
	PipelineCode string `json:"pipeline_code"`
	PipelineName string `json:"pipeline_name"`
	Summary      struct {
		AddCount       int `json:"add_count"`
		UpdateCount    int `json:"update_count"`
		DeleteCount    int `json:"delete_count"`
		UnchangedCount int `json:"unchanged_count"`
	} `json:"summary"`
	DiffDetails struct {
		AddList       []AddDiffItem       `json:"add_list"`
		UpdateList    []UpdateDiffItem    `json:"update_list"`
		DeleteList    []DeleteDiffItem    `json:"delete_list"`
		UnchangedList []UnchangedDiffItem `json:"unchanged_list"`
	} `json:"diff_details"`
}

// CalculateExecutionSchemeDiff 计算三方控制台数据与本地数据库之间的全维度差异 (Schemes + MR + Plans)
func CalculateExecutionSchemeDiff(c *gin.Context) {
	pipelineIDStr := c.Query("pipeline_id")
	if pipelineIDStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "pipeline_id query parameter is required"})
		return
	}

	var pipeline models.Pipeline
	if err := database.DB.Where("pipeline_id = ? OR id = ?", pipelineIDStr, pipelineIDStr).First(&pipeline).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Pipeline not found"})
		return
	}

	// 1. 读取本地数据库中已有的执行方案
	var localSchemes []models.ExecutionScheme
	database.DB.Where("pipeline_id = ?", pipeline.ID).Preload("Repository").Find(&localSchemes)

	// 2. 获取透传 Headers 并抓取远程三方数据
	headers := prepareRequestHeaders(c)

	mrBindings, err := services.FetchRemoteMRBindings(c.Request.Context(), pipeline.PipelineID, headers)
	if err != nil {
		if HandleSSOExpired(c, err) {
			return
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("Failed to fetch remote MR bindings: %v", err)})
		return
	}

	remoteSchemesData, err := services.FetchRemoteExecutionSchemes(c.Request.Context(), pipeline.PipelineID, headers)
	if err != nil {
		if HandleSSOExpired(c, err) {
			return
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("Failed to fetch remote schemes: %v", err)})
		return
	}

	plans, err := services.FetchRemoteExecutionPlans(c.Request.Context(), pipeline.PipelineID, headers)
	if err != nil {
		if HandleSSOExpired(c, err) {
			return
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("Failed to fetch remote plans: %v", err)})
		return
	}

	// 3. 预加载代码仓 Map
	var allRepos []models.Repository
	repoMap := make(map[string]models.Repository)
	if err := database.DB.Find(&allRepos).Error; err == nil {
		for _, r := range allRepos {
			normalizedURL := utils.NormalizeGitURL(r.URL)
			if normalizedURL != "" {
				repoMap[normalizedURL] = r
			}
		}
	}

	// 4. 组装远程全量 ExecutionScheme 列表
	var remoteSchemes []models.ExecutionScheme
	for _, remoteScheme := range remoteSchemesData {
		scheme := models.ExecutionScheme{
			ExecutionSchemeID:   remoteScheme.ID,
			ExecutionSchemeName: remoteScheme.Name,
			Name:                remoteScheme.Name,
			LocalPipelineID:     pipeline.ID,
			CustomAttributes:    remoteScheme.CustomParameter,
			MRTrigger:           false,
			DailyBuild:          false,
		}

		var codeURL string
		var branch string

		if remoteScheme.CustomParameter != "" {
			var cp struct {
				BuildParameters []struct {
					Name  string `json:"name"`
					Value string `json:"value"`
				} `json:"buildParameters"`
			}
			if err := json.Unmarshal([]byte(remoteScheme.CustomParameter), &cp); err == nil {
				for _, param := range cp.BuildParameters {
					switch param.Name {
					case "cmc_username":
						scheme.Username = param.Value
					case "cmc_password":
						scheme.Password = param.Value
					case "code_checker_task_id":
						scheme.CodeCheckerTaskID = param.Value
						if param.Value != "" {
							if taskName, err := services.GetCheckerTaskName(c.Request.Context(), remoteScheme.Name, param.Value, headers); err == nil {
								scheme.CodeCheckerTaskName = taskName
							} else {
								scheme.CodeCheckerTaskName = remoteScheme.Name
							}
						}
					case "repository":
						codeURL = param.Value
					case "branch":
						branch = param.Value
					}
				}
			}
		}

		// 匹配 MR 绑定
		for i := range mrBindings {
			if mrBindings[i].SchemeID == remoteScheme.ID {
				scheme.MRBindingID = mrBindings[i].ID
				scheme.MRBindingName = mrBindings[i].SchemeName
				scheme.MRTrigger = true
				if mrBindings[i].Branches != "" {
					branch = mrBindings[i].Branches
				}
				if mrBindings[i].CodeURL != "" {
					codeURL = mrBindings[i].CodeURL
				}
				break
			}
		}

		// 匹配执行计划
		for i := range plans {
			if plans[i].PfkSchemeID == remoteScheme.ID {
				scheme.ExecutionPlanID = plans[i].ID
				scheme.ExecutionPlanName = plans[i].ScheduleName
				scheme.DailyBuild = true
				break
			}
		}

		scheme.Branch = branch

		if codeURL != "" {
			normalizedCodeURL := utils.NormalizeGitURL(codeURL)
			if r, found := repoMap[normalizedCodeURL]; found {
				scheme.RepositoryID = r.ID
				scheme.Repository = &r
			}
		}

		if scheme.RepositoryID != 0 {
			remoteSchemes = append(remoteSchemes, scheme)
		}
	}

	// 5. 比对计算 (Diff Computation)
	localBySchemeID := make(map[string]models.ExecutionScheme)
	localByRepoBranch := make(map[string]models.ExecutionScheme)
	for _, l := range localSchemes {
		if l.ExecutionSchemeID != "" {
			localBySchemeID[l.ExecutionSchemeID] = l
		}
		key := fmt.Sprintf("%d_%s", l.RepositoryID, l.Branch)
		localByRepoBranch[key] = l
	}

	matchedLocalIDs := make(map[uint]bool)

	var resp CalculateDiffResponse
	resp.PipelineID = pipeline.ID
	resp.PipelineCode = pipeline.PipelineID
	resp.PipelineName = pipeline.Name

	for _, r := range remoteSchemes {
		var matchedLocal *models.ExecutionScheme

		if l, found := localBySchemeID[r.ExecutionSchemeID]; found {
			matchedLocal = &l
		} else {
			key := fmt.Sprintf("%d_%s", r.RepositoryID, r.Branch)
			if l, found := localByRepoBranch[key]; found {
				matchedLocal = &l
			}
		}

		repoName := fmt.Sprintf("仓 ID: %d", r.RepositoryID)
		if r.Repository != nil && r.Repository.Name != "" {
			repoName = r.Repository.Name
		}

		if matchedLocal == nil {
			// 新增项 (Add)
			resp.DiffDetails.AddList = append(resp.DiffDetails.AddList, AddDiffItem{
				RemoteSchemeID: r.ExecutionSchemeID,
				Name:           r.Name,
				RepositoryID:   r.RepositoryID,
				RepositoryName: repoName,
				Branch:         r.Branch,
				MRTrigger:      r.MRTrigger,
				DailyBuild:     r.DailyBuild,
				SchemeData:     r,
			})
		} else {
			// 已存在，计算属性差异 (Update or Unchanged)
			matchedLocalIDs[matchedLocal.ID] = true
			var changes []DiffItemChange

			// 方案配置属性比对
			if matchedLocal.Branch != r.Branch {
				changes = append(changes, DiffItemChange{
					Category:  "scheme",
					FieldName: "生效分支",
					OldValue:  matchedLocal.Branch,
					NewValue:  r.Branch,
				})
			}
			if matchedLocal.Languages != r.Languages && r.Languages != "" {
				changes = append(changes, DiffItemChange{
					Category:  "scheme",
					FieldName: "编程语言",
					OldValue:  matchedLocal.Languages,
					NewValue:  r.Languages,
				})
			}

			// MR 触发绑定比对
			if matchedLocal.MRTrigger != r.MRTrigger {
				oldState := "未开启"
				if matchedLocal.MRTrigger {
					oldState = fmt.Sprintf("开启 (%s)", matchedLocal.MRBindingName)
				}
				newState := "未开启"
				if r.MRTrigger {
					newState = fmt.Sprintf("开启 (%s)", r.MRBindingName)
				}
				changes = append(changes, DiffItemChange{
					Category:  "mr_binding",
					FieldName: "MR 触发绑定",
					OldValue:  oldState,
					NewValue:  newState,
				})
			}

			// 执行计划比对
			if matchedLocal.DailyBuild != r.DailyBuild {
				oldPlan := "未开启"
				if matchedLocal.DailyBuild {
					oldPlan = fmt.Sprintf("开启 (%s)", matchedLocal.ExecutionPlanName)
				}
				newPlan := "未开启"
				if r.DailyBuild {
					newPlan = fmt.Sprintf("开启 (%s)", r.ExecutionPlanName)
				}
				changes = append(changes, DiffItemChange{
					Category:  "execution_plan",
					FieldName: "每日构建计划",
					OldValue:  oldPlan,
					NewValue:  newPlan,
				})
			} else if matchedLocal.DailyBuild && matchedLocal.ExecutionPlanName != r.ExecutionPlanName {
				changes = append(changes, DiffItemChange{
					Category:  "execution_plan",
					FieldName: "执行计划名称",
					OldValue:  matchedLocal.ExecutionPlanName,
					NewValue:  r.ExecutionPlanName,
				})
			}

			newSchemeData := r
			newSchemeData.ID = matchedLocal.ID

			if len(changes) > 0 {
				resp.DiffDetails.UpdateList = append(resp.DiffDetails.UpdateList, UpdateDiffItem{
					LocalID:        matchedLocal.ID,
					RemoteSchemeID: r.ExecutionSchemeID,
					Name:           r.Name,
					RepositoryName: repoName,
					Branch:         r.Branch,
					Changes:        changes,
					NewSchemeData:  newSchemeData,
				})
			} else {
				resp.DiffDetails.UnchangedList = append(resp.DiffDetails.UnchangedList, UnchangedDiffItem{
					LocalID:        matchedLocal.ID,
					RemoteSchemeID: r.ExecutionSchemeID,
					Name:           matchedLocal.Name,
					RepositoryName: repoName,
					Branch:         matchedLocal.Branch,
				})
			}
		}
	}

	// 找出本地多余项 (Delete)
	for _, l := range localSchemes {
		if !matchedLocalIDs[l.ID] {
			repoName := fmt.Sprintf("仓 ID: %d", l.RepositoryID)
			if l.Repository != nil && l.Repository.Name != "" {
				repoName = l.Repository.Name
			}
			resp.DiffDetails.DeleteList = append(resp.DiffDetails.DeleteList, DeleteDiffItem{
				LocalID:        l.ID,
				RemoteSchemeID: l.ExecutionSchemeID,
				Name:           l.Name,
				RepositoryName: repoName,
				Branch:         l.Branch,
				HadMRTrigger:   l.MRTrigger,
				HadDailyBuild:  l.DailyBuild,
			})
		}
	}

	// 汇总计数
	resp.Summary.AddCount = len(resp.DiffDetails.AddList)
	resp.Summary.UpdateCount = len(resp.DiffDetails.UpdateList)
	resp.Summary.DeleteCount = len(resp.DiffDetails.DeleteList)
	resp.Summary.UnchangedCount = len(resp.DiffDetails.UnchangedList)

	c.JSON(http.StatusOK, resp)
}

// ConfirmSyncRequest 确认同步提交 Payload
type ConfirmSyncRequest struct {
	PipelineID     uint                     `json:"pipeline_id" binding:"required"`
	AddSchemes     []models.ExecutionScheme `json:"add_schemes"`
	UpdateSchemes  []models.ExecutionScheme `json:"update_schemes"`
	DeleteLocalIDs []uint                   `json:"delete_local_ids"`
}

// ConfirmSyncExecutionSchemes 确认并应用选择的差异变更项到本地数据库
func ConfirmSyncExecutionSchemes(c *gin.Context) {
	var req ConfirmSyncRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	tx := database.DB.Begin()

	// 1. 删除用户确认废弃的本地记录
	if len(req.DeleteLocalIDs) > 0 {
		if err := tx.Where("id IN ? AND pipeline_id = ?", req.DeleteLocalIDs, req.PipelineID).Delete(&models.ExecutionScheme{}).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "删除废弃方案失败"})
			return
		}
	}

	// 2. 插入用户确认新增的方案
	for i := range req.AddSchemes {
		req.AddSchemes[i].LocalPipelineID = req.PipelineID
		req.AddSchemes[i].ID = 0
		if err := tx.Omit("Repository", "PipelineInfo").Create(&req.AddSchemes[i]).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "新增执行方案失败"})
			return
		}
	}

	// 3. 更新用户确认变动的方案
	for i := range req.UpdateSchemes {
		req.UpdateSchemes[i].LocalPipelineID = req.PipelineID
		if err := tx.Omit("Repository", "PipelineInfo").Save(&req.UpdateSchemes[i]).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "更新执行方案失败"})
			return
		}
	}

	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "事务提交失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": fmt.Sprintf("成功同步更新：新增 %d 项，更新 %d 项，移除 %d 项", len(req.AddSchemes), len(req.UpdateSchemes), len(req.DeleteLocalIDs)),
	})
}

