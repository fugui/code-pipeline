package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"

	commonAudit "code-common/backend/audit"
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
					case "repository", "codehubTargetRepoHttpUrl":
						codeURL = param.Value
					case "branch", "selectedBranchs":
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

	// 同步回写更新关联代码仓的 CodeCheckerTaskID / Name，保证双表一致性
	for _, s := range finalSchemes {
		if s.RepositoryID > 0 && s.CodeCheckerTaskID != "" {
			var r models.Repository
			if err := database.DB.First(&r, s.RepositoryID).Error; err == nil {
				if r.CodeCheckerTaskID != s.CodeCheckerTaskID || r.CodeCheckerTaskName != s.CodeCheckerTaskName {
					database.DB.Model(&r).Updates(map[string]interface{}{
						"code_checker_task_id":   s.CodeCheckerTaskID,
						"code_checker_task_name": s.CodeCheckerTaskName,
					})
				}
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{"message": fmt.Sprintf("Successfully synced %d execution schemes", len(finalSchemes))})
}

// -----------------------------------------------------------------------------
// 差异比对与二次确认同步数据结构与处理函数
// -----------------------------------------------------------------------------

type DiffItemChange struct {
	Category  string `json:"category"`   // "scheme", "mr_binding", "execution_plan"
	FieldName string `json:"field_name"` // e.g. "MR触发生效分支", "MR触发绑定", "每日构建计划"
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
	query := database.DB.Model(&models.Pipeline{})
	if numID, err := strconv.ParseUint(pipelineIDStr, 10, 64); err == nil {
		query = query.Where("pipeline_id = ? OR id = ?", pipelineIDStr, uint(numID))
	} else {
		query = query.Where("pipeline_id = ?", pipelineIDStr)
	}
	if err := query.First(&pipeline).Error; err != nil {
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
					case "repository", "codehubTargetRepoHttpUrl":
						codeURL = param.Value
					case "branch", "selectedBranchs":
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

		// 保留所有远程方案（即便 RepositoryID 暂未关联到本地镜像仓，也不能直接丢弃，以便后续多维度匹配）
		remoteSchemes = append(remoteSchemes, scheme)
	}

	// 5. 比对计算 (Diff Computation)
	localBySchemeID := make(map[string]*models.ExecutionScheme)
	localByRepoBranch := make(map[string]*models.ExecutionScheme)
	localByRepoURLBranch := make(map[string]*models.ExecutionScheme)
	localByName := make(map[string]*models.ExecutionScheme)

	for i := range localSchemes {
		l := &localSchemes[i]
		if l.ExecutionSchemeID != "" {
			localBySchemeID[l.ExecutionSchemeID] = l
		}
		if l.RepositoryID != 0 && l.Branch != "" {
			key := fmt.Sprintf("%d_%s", l.RepositoryID, l.Branch)
			localByRepoBranch[key] = l
		}
		if l.Repository != nil && l.Repository.URL != "" && l.Branch != "" {
			normURL := utils.NormalizeGitURL(l.Repository.URL)
			if normURL != "" {
				localByRepoURLBranch[fmt.Sprintf("%s_%s", normURL, l.Branch)] = l
			}
		}
		if l.Name != "" {
			localByName[l.Name] = l
		}
	}

	matchedLocalIDs := make(map[uint]bool)

	var resp CalculateDiffResponse
	resp.PipelineID = pipeline.ID
	resp.PipelineCode = pipeline.PipelineID
	resp.PipelineName = pipeline.Name
	resp.DiffDetails.AddList = make([]AddDiffItem, 0)
	resp.DiffDetails.UpdateList = make([]UpdateDiffItem, 0)
	resp.DiffDetails.DeleteList = make([]DeleteDiffItem, 0)
	resp.DiffDetails.UnchangedList = make([]UnchangedDiffItem, 0)

	for _, r := range remoteSchemes {
		var matchedLocal *models.ExecutionScheme

		// 多级匹配策略：
		// 1. 优先按 Remote ExecutionSchemeID 匹配
		if r.ExecutionSchemeID != "" {
			if l, found := localBySchemeID[r.ExecutionSchemeID]; found {
				matchedLocal = l
			}
		}

		// 2. 次优先按 (RepositoryID, Branch) 匹配
		if matchedLocal == nil && r.RepositoryID != 0 && r.Branch != "" {
			key := fmt.Sprintf("%d_%s", r.RepositoryID, r.Branch)
			if l, found := localByRepoBranch[key]; found {
				matchedLocal = l
			}
		}

		// 3. 按 (Normalized Git URL, Branch) 匹配
		if matchedLocal == nil && r.Branch != "" {
			codeURL := ""
			if r.MRBindingID != "" {
				for _, mb := range mrBindings {
					if mb.ID == r.MRBindingID {
						codeURL = mb.CodeURL
						break
					}
				}
			}
			if codeURL != "" {
				normURL := utils.NormalizeGitURL(codeURL)
				if normURL != "" {
					key := fmt.Sprintf("%s_%s", normURL, r.Branch)
					if l, found := localByRepoURLBranch[key]; found {
						matchedLocal = l
					}
				}
			}
		}

		// 4. 按方案名称匹配
		if matchedLocal == nil && r.Name != "" {
			if l, found := localByName[r.Name]; found {
				matchedLocal = l
			}
		}

		// 若匹配到本地方案，且远程未查到 Repository 关联，则继承本地方案的代码仓配置信息
		if matchedLocal != nil {
			matchedLocalIDs[matchedLocal.ID] = true
			if r.RepositoryID == 0 && matchedLocal.RepositoryID != 0 {
				r.RepositoryID = matchedLocal.RepositoryID
				r.Repository = matchedLocal.Repository
			}
		}

		repoName := "未知代码仓"
		if r.Repository != nil && r.Repository.Name != "" {
			repoName = r.Repository.Name
		} else if r.RepositoryID != 0 {
			repoName = fmt.Sprintf("仓 ID: %d", r.RepositoryID)
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
					FieldName: "MR触发生效分支",
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

	commonAudit.SetAuditContext(c, "pipeline", "sync_diff", models.AuditLevelP0,
		fmt.Sprintf("批量同步并覆盖流水线执行方案 (流水线 ID: %d): 新增 %d 项, 更新 %d 项, 移除 %d 项", req.PipelineID, len(req.AddSchemes), len(req.UpdateSchemes), len(req.DeleteLocalIDs)),
		"pipeline", fmt.Sprintf("%d", req.PipelineID), fmt.Sprintf("流水线-%d方案同步", req.PipelineID),
		req.DeleteLocalIDs, map[string]interface{}{"added": len(req.AddSchemes), "updated": len(req.UpdateSchemes)})

	c.JSON(http.StatusOK, gin.H{
		"message": fmt.Sprintf("成功同步更新：新增 %d 项，更新 %d 项，移除 %d 项", len(req.AddSchemes), len(req.UpdateSchemes), len(req.DeleteLocalIDs)),
	})
}

// SyncSingleItemRequest 单条/分项定向同步请求
type SyncSingleItemRequest struct {
	PipelineID     uint                   `json:"pipeline_id" binding:"required"`
	Direction      string                 `json:"direction" binding:"required"` // "pull_to_local" | "push_to_remote"
	Category       string                 `json:"category"`                     // "full", "scheme", "mr_binding", "execution_plan"
	Action         string                 `json:"action"`                       // "upsert", "delete", "create_remote", "update_remote", "delete_remote"
	LocalID        uint                   `json:"local_id"`
	RemoteSchemeID string                 `json:"remote_scheme_id"`
	SchemeData     models.ExecutionScheme `json:"scheme_data"`
}

// SyncSingleExecutionSchemeItem 支持对单个执行方案或分项模块（如 MR 触发绑定）进行双向定向同步
func SyncSingleExecutionSchemeItem(c *gin.Context) {
	var req SyncSingleItemRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var pipeline models.Pipeline
	if err := database.DB.First(&pipeline, req.PipelineID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "流水线记录不存在"})
		return
	}

	headers := prepareRequestHeaders(c)

	if req.Direction == "pull_to_local" {
		// ==========================================
		// 方向 A：拉取至本地 (修正本地数据库)
		// ==========================================
		if req.Action == "delete" {
			// 下架清理本地记录
			if req.LocalID != 0 {
				if err := database.DB.Where("id = ? AND pipeline_id = ?", req.LocalID, req.PipelineID).Delete(&models.ExecutionScheme{}).Error; err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": "清理本地记录失败"})
					return
				}
			}
			c.JSON(http.StatusOK, gin.H{"message": "已成功下架清理本地方案记录"})
			return
		}

		if req.LocalID == 0 {
			// 本地新建（如将 add_list 项拉取导入本地）
			req.SchemeData.LocalPipelineID = req.PipelineID
			req.SchemeData.ID = 0
			if err := database.DB.Omit("Repository", "PipelineInfo").Create(&req.SchemeData).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "导入新增方案至本地失败"})
				return
			}
			if req.SchemeData.RepositoryID > 0 && req.SchemeData.CodeCheckerTaskID != "" {
				var r models.Repository
				if err := database.DB.First(&r, req.SchemeData.RepositoryID).Error; err == nil {
					if r.CodeCheckerTaskID != req.SchemeData.CodeCheckerTaskID || r.CodeCheckerTaskName != req.SchemeData.CodeCheckerTaskName {
						database.DB.Model(&r).Updates(map[string]interface{}{
							"code_checker_task_id":   req.SchemeData.CodeCheckerTaskID,
							"code_checker_task_name": req.SchemeData.CodeCheckerTaskName,
						})
					}
				}
			}
			c.JSON(http.StatusOK, gin.H{"message": "已成功导入方案至本地数据库"})
			return
		}

		// 本地更新 (全量或分项更新)
		var existing models.ExecutionScheme
		if err := database.DB.Where("id = ? AND pipeline_id = ?", req.LocalID, req.PipelineID).First(&existing).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "本地方案记录不存在"})
			return
		}

		switch req.Category {
		case "mr_binding":
			existing.MRTrigger = req.SchemeData.MRTrigger
			existing.MRBindingID = req.SchemeData.MRBindingID
			existing.MRBindingName = req.SchemeData.MRBindingName
			if req.SchemeData.Branch != "" {
				existing.Branch = req.SchemeData.Branch
			}
		case "execution_plan":
			existing.DailyBuild = req.SchemeData.DailyBuild
			existing.ExecutionPlanID = req.SchemeData.ExecutionPlanID
			existing.ExecutionPlanName = req.SchemeData.ExecutionPlanName
		case "scheme", "full":
			existing.Branch = req.SchemeData.Branch
			if req.SchemeData.Languages != "" {
				existing.Languages = req.SchemeData.Languages
			}
			if req.SchemeData.ExecutionSchemeID != "" {
				existing.ExecutionSchemeID = req.SchemeData.ExecutionSchemeID
			}
			existing.ExecutionSchemeName = req.SchemeData.Name
			existing.Name = req.SchemeData.Name
			existing.CustomAttributes = req.SchemeData.CustomAttributes
			existing.Username = req.SchemeData.Username
			existing.Password = req.SchemeData.Password
			existing.CodeCheckerTaskID = req.SchemeData.CodeCheckerTaskID
			existing.CodeCheckerTaskName = req.SchemeData.CodeCheckerTaskName
			if req.Category == "full" {
				existing.MRTrigger = req.SchemeData.MRTrigger
				existing.MRBindingID = req.SchemeData.MRBindingID
				existing.MRBindingName = req.SchemeData.MRBindingName
				existing.DailyBuild = req.SchemeData.DailyBuild
				existing.ExecutionPlanID = req.SchemeData.ExecutionPlanID
				existing.ExecutionPlanName = req.SchemeData.ExecutionPlanName
			}
		default:
			existing.Branch = req.SchemeData.Branch
			existing.MRTrigger = req.SchemeData.MRTrigger
			existing.DailyBuild = req.SchemeData.DailyBuild
		}

		if err := database.DB.Omit("Repository", "PipelineInfo").Save(&existing).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "更新本地数据库失败"})
			return
		}
		if existing.RepositoryID > 0 && existing.CodeCheckerTaskID != "" {
			var r models.Repository
			if err := database.DB.First(&r, existing.RepositoryID).Error; err == nil {
				if r.CodeCheckerTaskID != existing.CodeCheckerTaskID || r.CodeCheckerTaskName != existing.CodeCheckerTaskName {
					database.DB.Model(&r).Updates(map[string]interface{}{
						"code_checker_task_id":   existing.CodeCheckerTaskID,
						"code_checker_task_name": existing.CodeCheckerTaskName,
					})
				}
			}
		}
		c.JSON(http.StatusOK, gin.H{"message": "已成功更新同步至本地数据库"})
		return

	} else if req.Direction == "push_to_remote" {
		// ==========================================
		// 方向 B：推送至三方 (修改/新建/删除三方控制台)
		// ==========================================
		if req.Action == "delete_remote" {
			// 清理三方远程方案
			if err := services.SyncDeleteExecutionSchemeRemote(req.SchemeData, headers); err != nil {
				if HandleSSOExpired(c, err) {
					return
				}
				c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("清理三方远程方案失败: %v", err)})
				return
			}
			c.JSON(http.StatusOK, gin.H{"message": "已成功在三方系统中物理下架该方案"})
			return
		}

		if req.Action == "create_remote" || (req.LocalID != 0 && req.RemoteSchemeID == "") {
			// 在三方新建整套方案 (Scheme + MR + Plan)
			var localScheme models.ExecutionScheme
			if req.LocalID != 0 {
				if err := database.DB.Preload("Repository").Where("id = ?", req.LocalID).First(&localScheme).Error; err != nil {
					localScheme = req.SchemeData
				}
			} else {
				localScheme = req.SchemeData
			}

			newExtID, err := services.SyncCreateExecutionSchemeRemote(c.Request.Context(), pipeline.PipelineID, &localScheme, headers)
			if err != nil {
				if HandleSSOExpired(c, err) {
					return
				}
				c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("在三方系统中创建方案失败: %v", err)})
				return
			}

			// 将产生的外部 ID 写回本地数据库
			if req.LocalID != 0 {
				database.DB.Model(&models.ExecutionScheme{}).Where("id = ?", req.LocalID).Updates(map[string]interface{}{
					"execution_scheme_id":    newExtID,
					"execution_scheme_name":  localScheme.Name,
					"mr_binding_id":          localScheme.MRBindingID,
					"mr_binding_name":        localScheme.MRBindingName,
					"execution_plan_id":      localScheme.ExecutionPlanID,
					"execution_plan_name":    localScheme.ExecutionPlanName,
					"code_checker_task_id":   localScheme.CodeCheckerTaskID,
					"code_checker_task_name": localScheme.CodeCheckerTaskName,
				})
			}
			if localScheme.RepositoryID > 0 && localScheme.CodeCheckerTaskID != "" {
				var r models.Repository
				if err := database.DB.First(&r, localScheme.RepositoryID).Error; err == nil {
					if r.CodeCheckerTaskID != localScheme.CodeCheckerTaskID || r.CodeCheckerTaskName != localScheme.CodeCheckerTaskName {
						database.DB.Model(&r).Updates(map[string]interface{}{
							"code_checker_task_id":   localScheme.CodeCheckerTaskID,
							"code_checker_task_name": localScheme.CodeCheckerTaskName,
						})
					}
				}
			}
			c.JSON(http.StatusOK, gin.H{"message": "已成功推送并在三方系统中新建该方案"})
			return
		}

		// 针对既有远程方案进行分项/全量推送
		var schemeTarget models.ExecutionScheme
		if req.LocalID != 0 {
			if err := database.DB.Preload("Repository").Where("id = ?", req.LocalID).First(&schemeTarget).Error; err != nil {
				schemeTarget = req.SchemeData
			}
		} else {
			schemeTarget = req.SchemeData
		}
		if schemeTarget.ExecutionSchemeID == "" {
			schemeTarget.ExecutionSchemeID = req.RemoteSchemeID
		}

		repoURL := ""
		if schemeTarget.Repository != nil {
			repoURL = schemeTarget.Repository.HTTPURL
			if repoURL == "" {
				repoURL = schemeTarget.Repository.URL
			}
		}
		if repoURL == "" && schemeTarget.RepositoryID != 0 {
			var r models.Repository
			if err := database.DB.First(&r, schemeTarget.RepositoryID).Error; err == nil {
				repoURL = r.HTTPURL
				if repoURL == "" {
					repoURL = r.URL
				}
			}
		}

		switch req.Category {
		case "mr_binding":
			if schemeTarget.MRTrigger {
				// 推送/新建三方 MR 绑定
				if schemeTarget.MRBindingID == "" {
					newBindingID, err := services.CreateMRBindingStep(c.Request.Context(), pipeline.PipelineID, &schemeTarget, schemeTarget.ExecutionSchemeID, repoURL, headers)
					if err != nil {
						if HandleSSOExpired(c, err) {
							return
						}
						c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("在三方创建 MR 绑定失败: %v", err)})
						return
					}
					schemeTarget.MRBindingID = newBindingID
					if req.LocalID != 0 {
						database.DB.Model(&models.ExecutionScheme{}).Where("id = ?", req.LocalID).Updates(map[string]interface{}{
							"mr_trigger":      true,
							"mr_binding_id":   newBindingID,
							"mr_binding_name": schemeTarget.Name,
						})
					}
				} else {
					if err := services.SyncUpdateMRBindingRemote(c.Request.Context(), &schemeTarget, repoURL, headers); err != nil {
						if HandleSSOExpired(c, err) {
							return
						}
						c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("更新三方 MR 绑定失败: %v", err)})
						return
					}
				}
			} else {
				// 三方解绑/删除 MR 绑定
				if schemeTarget.MRBindingID != "" {
					dummyScheme := models.ExecutionScheme{
						LocalPipelineID: req.PipelineID,
						MRBindingID:     schemeTarget.MRBindingID,
					}
					if err := services.SyncDeleteExecutionSchemeRemote(dummyScheme, headers); err != nil {
						if HandleSSOExpired(c, err) {
							return
						}
						c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("解绑三方 MR 触发失败: %v", err)})
						return
					}
					if req.LocalID != 0 {
						database.DB.Model(&models.ExecutionScheme{}).Where("id = ?", req.LocalID).Updates(map[string]interface{}{
							"mr_trigger":      false,
							"mr_binding_id":   "",
							"mr_binding_name": "",
						})
					}
				}
			}
			c.JSON(http.StatusOK, gin.H{"message": "已成功将 MR 触发配置推送同步至三方系统"})
			return

		case "execution_plan":
			if schemeTarget.DailyBuild {
				newPlanID, err := services.CreateExecutionPlanStep(c.Request.Context(), pipeline.PipelineID, &schemeTarget, schemeTarget.ExecutionSchemeID, headers)
				if err != nil {
					if HandleSSOExpired(c, err) {
						return
					}
					c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("在三方创建执行计划失败: %v", err)})
					return
				}
				schemeTarget.ExecutionPlanID = newPlanID
				if req.LocalID != 0 {
					database.DB.Model(&models.ExecutionScheme{}).Where("id = ?", req.LocalID).Updates(map[string]interface{}{
						"daily_build":         true,
						"execution_plan_id":   newPlanID,
						"execution_plan_name": schemeTarget.Name,
					})
				}
			} else {
				if schemeTarget.ExecutionPlanID != "" {
					dummyScheme := models.ExecutionScheme{
						ExecutionPlanID: schemeTarget.ExecutionPlanID,
					}
					if err := services.SyncDeleteExecutionSchemeRemote(dummyScheme, headers); err != nil {
						if HandleSSOExpired(c, err) {
							return
						}
						c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("删除三方每日构建计划失败: %v", err)})
						return
					}
					if req.LocalID != 0 {
						database.DB.Model(&models.ExecutionScheme{}).Where("id = ?", req.LocalID).Updates(map[string]interface{}{
							"daily_build":         false,
							"execution_plan_id":   "",
							"execution_plan_name": "",
						})
					}
				}
			}
			c.JSON(http.StatusOK, gin.H{"message": "已成功将每日构建计划推送同步至三方系统"})
			return

		default: // "scheme" 或 "full"
			if err := services.SyncUpdateExecutionSchemeRemote(c.Request.Context(), &schemeTarget, repoURL, headers); err != nil {
				if HandleSSOExpired(c, err) {
					return
				}
				c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("推送修改三方方案失败: %v", err)})
				return
			}
			c.JSON(http.StatusOK, gin.H{"message": "已成功将执行方案配置推送修改至三方系统"})
			return
		}
	}

	c.JSON(http.StatusBadRequest, gin.H{"error": "无效的同步方向参数"})
}
