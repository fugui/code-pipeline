package main

import (
	"context"
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os/signal"
	"strings"
	"syscall"
	"time"

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

	// 初始化 Git 平台基准地址配置
	services.InitGitPlatform()

	// 启动优雅关闭 context 与拉取同步任务
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// 启动被管仓历史非活动分支定时巡检任务
	services.StartBranchAuditTimer(ctx)

	// 启动嵌套组同步队列工作线程
	services.StartGroupSyncQueue(ctx)

	// 4. 初始化 Gin 引擎
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())

	if models.AppConfig.Server.GinLog {
		r.Use(gin.Logger())
		log.Println("[Server] Gin logger enabled")
	}

	// API 路由注册
	api := r.Group("/api")
	{
		// 免密路由
		api.POST("/login", handlers.Login)
		api.POST("/webhook", handlers.HandleWebhook)

		// 受保护路由
		api.Use(handlers.AuthMiddleware())
		{
			api.GET("/me", handlers.GetMe)

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
			api.POST("/repos/:id/webhook", handlers.RegisterRepoWebhook)

			// 独立被管代码仓与嵌套组管理路由
			api.POST("/managed-groups", handlers.CreateManagedGroup)
			api.GET("/managed-groups", handlers.GetManagedGroups)
			api.POST("/managed-groups/:id/sync", handlers.SyncManagedGroup)
			api.POST("/managed-groups/:id/toggle-hide", handlers.ToggleGroupHide)
			api.POST("/managed-repos", handlers.CreateManagedRepo)
			api.GET("/managed-repos", handlers.GetManagedRepos)
			api.POST("/managed-repos/:id/branches", handlers.CreateManagedBranch)
			api.POST("/managed-acl", handlers.ConfigureManagedACL)
			api.GET("/managed-repos/:id/branches_audit", handlers.GetManagedRepoBranchAudit)
			api.POST("/managed-repos/:id/branches_audit/trigger", handlers.TriggerManagedRepoBranchAudit)
			api.POST("/managed-repos/:id/branches_audit/notify", handlers.NotifyBranchOwner)
			api.POST("/managed-repos/:id/branches/cleanup", handlers.CleanupManagedBranches)

			// 流水线配置相关接口
			api.GET("/pipelines", handlers.GetPipelines)
			api.POST("/pipelines", handlers.CreatePipeline)
			api.PUT("/pipelines/:id", handlers.UpdatePipeline)
			api.DELETE("/pipelines/:id", handlers.DeletePipeline)
			api.GET("/pipelines/fetch-info", handlers.FetchPipelineInfoFromRemote)

			// 执行方案相关接口
			api.GET("/execution-schemes", handlers.GetExecutionSchemes)
			api.POST("/execution-schemes", handlers.CreateExecutionScheme)
			api.DELETE("/execution-schemes/:id", handlers.DeleteExecutionScheme)
			api.POST("/execution-schemes/:id/run", handlers.RunExecutionScheme)
			api.POST("/execution-schemes/sync", handlers.SyncExecutionSchemes)

			// 看板状态大屏接口
			api.GET("/dashboard/stats", handlers.GetDashboardStats)
		}
	}

	// 6. 前端静态文件托管
	distFS, err := fs.Sub(frontendFS, "frontend/dist")
	if err != nil {
		log.Println("[Server] Warning: frontend dist directory not found. Skipping embedded UI.")
	} else {
		httpFS := http.FS(distFS)
		r.NoRoute(func(c *gin.Context) {
			path := c.Request.URL.Path

			// API 路由未匹配，直接返回 404
			if len(path) >= 4 && path[:4] == "/api" {
				c.JSON(http.StatusNotFound, gin.H{"error": "API endpoint not found"})
				return
			}

			// 支持前缀跳转与代理
			if path == "/" || path == "/pipeline" {
				c.Redirect(http.StatusFound, "/pipeline/")
				return
			}

			cleanPath := path
			if strings.HasPrefix(path, "/pipeline") {
				cleanPath = strings.TrimPrefix(path, "/pipeline")
			}

			if cleanPath != "" && cleanPath != "/" {
				// 尝试在 dist 目录寻找该文件
				f, err := distFS.Open(cleanPath[1:])
				if err == nil {
					f.Close()
					c.FileFromFS(cleanPath, httpFS)
					return
				}
			}

			// SPA 单页应用回退到 index.html
			indexBytes, err := fs.ReadFile(distFS, "index.html")
			if err != nil {
				c.String(http.StatusNotFound, "UI index.html not found")
				return
			}
			c.Data(http.StatusOK, "text/html; charset=utf-8", indexBytes)
		})
	}

	// 7. 配置端口与超时限制
	port := models.AppConfig.Server.Port
	if port == "" {
		port = ":8082"
	}

	// 支持从 /pipeline/api 剥离前缀，确保能代理统一入口
	var httpHandler http.Handler = http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if strings.HasPrefix(req.URL.Path, "/pipeline/api") {
			req.URL.Path = strings.TrimPrefix(req.URL.Path, "/pipeline")
		}
		r.ServeHTTP(w, req)
	})

	srv := &http.Server{
		Addr:         port,
		Handler:      httpHandler,
		ReadTimeout:  models.AppConfig.Server.ReadTimeout,
		WriteTimeout: models.AppConfig.Server.WriteTimeout,
	}

	go func() {
		log.Printf("[Server] Starting server on %s ...\n", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[Server] Fail to listen: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("[Server] Shutting down code-pipeline server...")

	// 优雅终止：限时 10 秒关闭 HTTP 连接
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Fatalf("[Server] Server forced to shutdown: %v", err)
	}

	log.Println("[Server] Gracefully exited")
}
