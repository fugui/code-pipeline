package main

import (
	"context"
	"embed"
	"log"

	commonAudit "code-common/backend/audit"
	commonAuth "code-common/backend/auth"
	commonServer "code-common/backend/server"
	"code-pipeline/database"
	"code-pipeline/handlers"
	"code-pipeline/models"
	"code-pipeline/services"

	"github.com/gin-gonic/gin"
)

//go:embed all:frontend/dist
var frontendFS embed.FS

func main() {
	log.Println("[Server] Initializing code-pipeline...")

	// 1. 加载配置文件
	if err := models.LoadConfig("config.yaml"); err != nil {
		log.Fatalf("[Server] Failed to load config.yaml: %v", err)
	}

	// 2. 初始化数据库
	database.InitDB()

	// 初始化系统全局操作审计引擎
	commonAudit.Init(database.DB)

	// 确保至少存在默认管理员账号（用于独立部署模式）
	if err := commonAuth.EnsureSeedAdmin(database.DB, "pipeline_admin"); err != nil {
		log.Printf("[Server] Warning: Failed to ensure seed admin: %v", err)
	}

	// 初始化默认合规基线模板
	services.EnsureDefaultBaseline()

	// 初始化 Git 平台基准地址配置
	services.InitGitPlatform()

	// 启动后台定时巡检与队列任务
	services.StartBranchAuditTimer(context.Background())
	services.StartGroupSyncQueue(context.Background())

	// 3. 启动统一服务器
	err := commonServer.Run(commonServer.Options{
		ServiceName:  "code-pipeline",
		Prefix:       "pipeline",
		Port:         models.AppConfig.Server.Port,
		GinLog:       models.AppConfig.Server.GinLog,
		ReadTimeout:  models.AppConfig.Server.ReadTimeout,
		WriteTimeout: models.AppConfig.Server.WriteTimeout,
		FrontendFS:   &frontendFS,
		CustomMiddlewares: []gin.HandlerFunc{
			commonAudit.Middleware("pipeline"),
		},
		OnShutdown: func(ctx context.Context) {
			_ = commonAudit.Close(ctx)
		},
		RegisterRoutes: func(r *gin.Engine) {
			// API 路由注册
			api := r.Group("/api")
			{
				// 免密路由
				api.POST("/login", handlers.Login)
				api.GET("/auth/config", handlers.GetAuthConfig)
				api.GET("/oauth2/authorize", handlers.StartOAuth2Flow)
				api.GET("/oauth2/callback", handlers.OAuth2Callback)
				api.POST("/webhook", handlers.HandleWebhook)

				// 第三方任务日志上报免密端点
				api.POST("/report/execution-log", handlers.ReportExecutionLog)
				api.POST("/report/build-log", handlers.ReportExecutionLog)
				api.POST("/report/code-check-log", handlers.ReportExecutionLog)
				api.POST("/v1/report/execution-log", handlers.ReportExecutionLog)
				api.POST("/v1/report/build-log", handlers.ReportExecutionLog)
				api.POST("/v1/report/code-check-log", handlers.ReportExecutionLog)

				// 受保护路由 (全员登录可访问)
				api.Use(commonAuth.AuthMiddleware(commonAuth.AuthConfig{
					JWTSecretGetter: func() string { return models.AppConfig.Auth.JWTSecret },
					DB:              database.DB,
					MergeDBRoles:    true,
					OnUserNotFound:  handlers.ProvisionPipelineUser,
					OnUserSynced:    handlers.SyncPipelineUser,
				}))
				{
					api.GET("/me", handlers.GetMe)
					api.PATCH("/password", handlers.UpdatePassword)
					api.GET("/system-options", handlers.GetSystemOptions)

					// Merge Request 实时看护与全览相关接口
					api.GET("/mr/hook", handlers.GetMrEvents)
					api.GET("/mr/hook/:id", handlers.GetMrEventDetail)
					api.GET("/mr/list", handlers.GetMrListFromGit)

					// 仓库配置路由
					api.GET("/repos", handlers.GetRepos)
					api.GET("/repos/filter-options", handlers.GetRepoFilterOptions)
					api.GET("/repos/:id", handlers.GetRepoDetails)
					api.POST("/repos/:id/trigger", handlers.TriggerRepo)
					api.GET("/repos/:id/latest-log", handlers.GetRepoLatestLog)
					api.GET("/repos/:id/branches", handlers.GetRepoBranches)
					api.GET("/repos/:id/webhook", handlers.CheckRepoWebhook)

					// 独立被管代码仓与嵌套组管理路由 (只读与全员接口)
					api.GET("/managed-groups", handlers.GetManagedGroups)
					api.GET("/managed-repos", handlers.GetManagedRepos)
					api.GET("/managed-repos/:id/branches_audit", handlers.GetManagedRepoBranchAudit)
					api.POST("/managed-repos/:id/branches_audit/notify", handlers.NotifyBranchOwner)

					// 审批单据与跨仓特性分支全员接口
					api.GET("/managed-approvals", handlers.GetManagedApprovals)
					api.POST("/managed-approvals", handlers.CreateManagedApproval)
					api.POST("/managed-repos/batch-create-branch", handlers.BatchCreateManagedBranches)
					api.GET("/managed-repos/batch-branch-logs", handlers.GetManagedBatchBranchLogs)
					api.GET("/managed-repos/protected-rules", handlers.GetProtectedBranchRules)

					// 合规管控只读接口
					api.GET("/managed-repos/compliance/baseline", handlers.GetGlobalComplianceBaseline)
					api.GET("/managed-repos/compliance/baselines", handlers.GetComplianceBaselines)
					api.GET("/managed-repos/compliance/baselines/:id", handlers.GetComplianceBaseline)
					api.GET("/managed-repos/compliance/default-rules", handlers.GetDefaultComplianceRules)
					api.GET("/managed-repos/:id/compliance/report", handlers.GetRepoComplianceReport)
					api.GET("/managed-repos/dashboard/stats", handlers.GetManagedDashboardStats)

					// 流水线配置与方案只读/触发接口
					api.GET("/pipelines", handlers.GetPipelines)
					api.GET("/execution-schemes", handlers.GetExecutionSchemes)
					api.POST("/execution-schemes/:id/run", handlers.RunExecutionScheme)

					// 看板状态大屏接口
					api.GET("/dashboard/stats", handlers.GetDashboardStats)

					// 管理员专属路由 (需要超级管理员或 pipeline_admin 权限)
					admin := api.Group("")
					admin.Use(commonAuth.RequireAdmin(commonAuth.RolePipelineAdmin))
					{
						// 审批单据核准与驳回
						admin.POST("/managed-approvals/:id/approve", handlers.ApproveManagedApproval)
						admin.POST("/managed-approvals/:id/reject", handlers.RejectManagedApproval)
						admin.POST("/managed-repos/protected-rules", handlers.CreateProtectedBranchRule)

						// 仓库 Webhook 注册
						admin.POST("/repos/:id/webhook", handlers.RegisterRepoWebhook)

						// 独立被管代码仓与嵌套组写/管控路由
						admin.POST("/managed-groups", handlers.CreateManagedGroup)
						admin.POST("/managed-groups/:id/sync", handlers.SyncManagedGroup)
						admin.POST("/managed-groups/:id/toggle-hide", handlers.ToggleGroupHide)
						admin.DELETE("/managed-groups/:id", handlers.DeleteManagedGroup)
						admin.POST("/managed-repos", handlers.CreateManagedRepo)
						admin.POST("/managed-repos/:id/branches", handlers.CreateManagedBranch)
						admin.POST("/managed-repos/:id/toggle-archive", handlers.ToggleRepoArchive)
						admin.POST("/managed-repos/:id/toggle-hide", handlers.ToggleRepoHide)
						admin.POST("/managed-acl", handlers.ConfigureManagedACL)
						admin.POST("/managed-repos/:id/branches_audit/trigger", handlers.TriggerManagedRepoBranchAudit)
						admin.POST("/managed-repos/:id/branches/cleanup", handlers.CleanupManagedBranches)

						// 合规基线管理与巡检路由
						admin.PUT("/managed-repos/compliance/baseline", handlers.UpdateGlobalComplianceBaseline)
						admin.POST("/managed-repos/compliance/baselines", handlers.CreateComplianceBaseline)
						admin.PUT("/managed-repos/compliance/baselines/:id", handlers.UpdateComplianceBaseline)
						admin.DELETE("/managed-repos/compliance/baselines/:id", handlers.DeleteComplianceBaseline)
						admin.POST("/managed-repos/compliance/audit", handlers.TriggerComplianceAudit)
						admin.POST("/managed-repos/:id/compliance/audit", handlers.TriggerSingleRepoComplianceAudit)
						admin.POST("/managed-repos/:id/compliance/remote-check", handlers.TriggerRepoRemoteProtectionCheck)

						// 流水线配置写/管控接口
						admin.POST("/pipelines", handlers.CreatePipeline)
						admin.PUT("/pipelines/:id", handlers.UpdatePipeline)
						admin.DELETE("/pipelines/:id", handlers.DeletePipeline)
						admin.GET("/pipelines/fetch-info", handlers.FetchPipelineInfoFromRemote)

						// 执行方案写/管控接口
						admin.POST("/execution-schemes", handlers.CreateExecutionScheme)
						admin.PUT("/execution-schemes/:id", handlers.UpdateExecutionScheme)
						admin.DELETE("/execution-schemes/:id", handlers.DeleteExecutionScheme)
						admin.POST("/execution-schemes/sync", handlers.SyncExecutionSchemes)
						admin.POST("/execution-schemes/diff", handlers.CalculateExecutionSchemeDiff)
						admin.POST("/execution-schemes/sync-confirm", handlers.ConfirmSyncExecutionSchemes)
						admin.POST("/execution-schemes/sync-item", handlers.SyncSingleExecutionSchemeItem)
					}
				}
			}
		},
	})
	if err != nil {
		log.Fatalf("[Server] Server error: %v", err)
	}
}
