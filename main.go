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

	// 1. 初始化数据库
	database.InitDB()

	// 2. 加载配置文件
	if err := models.LoadConfig("config.yaml"); err != nil {
		log.Fatalf("[Server] Failed to load config.yaml: %v", err)
	}

	// 3. 启动流水线并发引擎 Worker Pool
	services.StartWorkerPool(models.AppConfig.Server.WorkerCount)

	// 4. 启动定时任务调度器 Scheduler
	services.InitScheduler()

	// 5. 初始化 Gin 引擎
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

		// 受保护路由
		api.Use(handlers.AuthMiddleware())
		{
			api.GET("/me", handlers.GetMe)

			// 仓库配置路由
			api.GET("/repos", handlers.GetRepos)
			api.GET("/repos/:id", handlers.GetRepoDetails)
			api.POST("/repos", handlers.CreateRepo)
			api.PUT("/repos/:id", handlers.UpdateRepo)
			api.DELETE("/repos/:id", handlers.DeleteRepo)
			api.POST("/repos/:id/trigger", handlers.TriggerRepo)

			// 流水线执行日志路由
			api.GET("/executions", handlers.GetExecutions)
			api.GET("/executions/:id", handlers.GetExecutionDetails)
			api.POST("/executions/:id/cancel", handlers.CancelExecution)

			// 流水线配置相关接口
			api.GET("/pipelines", handlers.GetPipelines)
			api.POST("/pipelines", handlers.CreatePipeline)
			api.PUT("/pipelines/:id", handlers.UpdatePipeline)
			api.DELETE("/pipelines/:id", handlers.DeletePipeline)
			api.GET("/pipelines/fetch-info", handlers.FetchPipelineInfoFromRemote)

			// 执行方案相关接口
			api.GET("/execution-plans", handlers.GetExecutionPlans)
			api.POST("/execution-plans", handlers.CreateExecutionPlan)
			api.PUT("/execution-plans/:id", handlers.UpdateExecutionPlan)
			api.DELETE("/execution-plans/:id", handlers.DeleteExecutionPlan)

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

	// 8. 优雅关闭逻辑
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

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
