package models

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"time"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Server struct {
		Port           string        `yaml:"port"`
		GinLog         bool          `yaml:"gin_log"`
		ReadTimeout    time.Duration `yaml:"read_timeout"`
		WriteTimeout   time.Duration `yaml:"write_timeout"`
		WorkerCount    int           `yaml:"worker_count"`
		SandboxDir     string        `yaml:"sandbox_dir"`
		RepoSyncServer string        `yaml:"repo_sync_server"`
	} `yaml:"server"`
	Auth struct {
		JWTSecret            string `yaml:"jwt_secret"`
		PasswordLoginEnabled bool   `yaml:"password_login_enabled"`
		SystemUserID         uint   `yaml:"system_user_id"`
	} `yaml:"auth"`
	PipelineSystem struct {
		GetPipelineURL            string            `yaml:"get_pipeline_url"`
		GetExecutionSchemeURL     string            `yaml:"get_execution_scheme_url"`
		CreateExecutionSchemeURL  string            `yaml:"create_execution_scheme_url"`
		CreateExecutionSchemeBody string            `yaml:"create_execution_scheme_body"`
		GetMRBindingsURL          string            `yaml:"get_mr_bindings_url"`
		CreateCheckerTaskURL      string            `yaml:"create_checker_task_url"`
		CreateCheckerTaskBody     string            `yaml:"create_checker_task_body"`
		RepoAuthCheckURL          string            `yaml:"repo_auth_check_url"`
		GetBranchesURL            string            `yaml:"get_branches_url"`
		CreateMRBindingURL        string            `yaml:"create_mr_binding_url"`
		CreateMRBindingBody       string            `yaml:"create_mr_binding_body"`
		QueryCheckerTaskURL       string            `yaml:"query_checker_task_url"`
		DeleteCheckerTaskURL      string            `yaml:"delete_checker_task_url"`
		RunExecutionSchemeURL     string            `yaml:"run_execution_scheme_url"`
		CreateExecutionPlanURL    string            `yaml:"create_execution_plan_url"`
		CreateExecutionPlanBody   string            `yaml:"create_execution_plan_body"`
		GetExecutionPlanURL       string            `yaml:"get_execution_plan_url"`
		RuleSets                  map[string]string `yaml:"rule_sets"`
		PipelineLinkTemplate      string            `yaml:"pipeline_link_template"`
		GetWebhooksURL            string            `yaml:"get_webhooks_url"`     // 查询仓库 Webhook 列表的托管平台 API
		CreateWebhookURL          string            `yaml:"create_webhook_url"`   // 创建 Webhook 的托管平台 API
		CreateWebhookBody         string            `yaml:"create_webhook_body"`  // 创建 Webhook 的请求 Body 模板
		WebhookCallbackURL        string            `yaml:"webhook_callback_url"` // 托管平台配置的完整 Webhook 回调 URL
		UpdateRepoSettingsURL     string            `yaml:"update_repo_settings_url"`
		UpdateRepoSettingsBody    string            `yaml:"update_repo_settings_body"`
	} `yaml:"pipeline_system"`
}

var AppConfig Config

func LoadConfig(filename string) error {
	data, err := os.ReadFile(filename)
	if err != nil {
		return err
	}
	if err := yaml.Unmarshal(data, &AppConfig); err != nil {
		return err
	}

	applyDefaults()

	if AppConfig.PipelineSystem.CreateMRBindingURL == "" {
		return fmt.Errorf("pipeline_system.create_mr_binding_url is required")
	}
	if AppConfig.PipelineSystem.CreateMRBindingBody == "" {
		return fmt.Errorf("pipeline_system.create_mr_binding_body is required")
	}
	if AppConfig.PipelineSystem.CreateExecutionSchemeURL == "" {
		return fmt.Errorf("pipeline_system.create_execution_scheme_url is required")
	}
	if AppConfig.PipelineSystem.CreateExecutionSchemeBody == "" {
		return fmt.Errorf("pipeline_system.create_execution_scheme_body is required")
	}
	if AppConfig.PipelineSystem.CreateExecutionPlanURL == "" {
		return fmt.Errorf("pipeline_system.create_execution_plan_url is required")
	}
	if AppConfig.PipelineSystem.CreateExecutionPlanBody == "" {
		return fmt.Errorf("pipeline_system.create_execution_plan_body is required")
	}
	if AppConfig.PipelineSystem.GetExecutionPlanURL == "" {
		return fmt.Errorf("pipeline_system.get_execution_plan_url is required")
	}
	if AppConfig.PipelineSystem.CreateWebhookBody == "" {
		return fmt.Errorf("pipeline_system.create_webhook_body is required")
	}
	if AppConfig.PipelineSystem.UpdateRepoSettingsURL == "" {
		return fmt.Errorf("pipeline_system.update_repo_settings_url is required")
	}
	if AppConfig.PipelineSystem.UpdateRepoSettingsBody == "" {
		return fmt.Errorf("pipeline_system.update_repo_settings_body is required")
	}

	return nil
}

func applyDefaults() {
	if AppConfig.Server.Port == "" {
		AppConfig.Server.Port = ":8082"
	}
	if AppConfig.Server.ReadTimeout == 0 {
		AppConfig.Server.ReadTimeout = 15 * time.Second
	}
	if AppConfig.Server.WriteTimeout == 0 {
		AppConfig.Server.WriteTimeout = 15 * time.Second
	}
	if AppConfig.Server.WorkerCount <= 0 {
		AppConfig.Server.WorkerCount = 4
	}
	if AppConfig.Server.SandboxDir == "" {
		AppConfig.Server.SandboxDir = "./workspace"
	}
	if AppConfig.Server.RepoSyncServer == "" {
		AppConfig.Server.RepoSyncServer = "http://localhost:8000"
	}
	if AppConfig.Auth.SystemUserID == 0 {
		AppConfig.Auth.SystemUserID = 1
	}
	if AppConfig.Auth.JWTSecret == "" {
		randomBytes := make([]byte, 32)
		if _, err := rand.Read(randomBytes); err != nil {
			log.Fatalf("Failed to generate random JWT secret: %v", err)
		}
		AppConfig.Auth.JWTSecret = hex.EncodeToString(randomBytes)
		log.Println("[Auth] WARNING: jwt_secret not configured. Using ephemeral random secret.")
	}
}
