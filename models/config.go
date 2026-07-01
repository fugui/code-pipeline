package models

import (
	"crypto/rand"
	"encoding/hex"
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
		GetPipelineURL         string `yaml:"get_pipeline_url"`
		GetExecutionPlanURL    string `yaml:"get_execution_plan_url"`
		GetMRBindingsURL       string `yaml:"get_mr_bindings_url"`
		CopyCheckerTaskURL     string `yaml:"copy_checker_task_url"`
		CreateCheckerTaskURL   string `yaml:"create_checker_task_url"`
		CreateCheckerTaskBody  string `yaml:"create_checker_task_body"`
		CopyCheckerTaskBody    string `yaml:"copy_checker_task_body"`
		CheckerTaskTemplateID  string `yaml:"checker_task_template_id"`
		RepoAuthCheckURL       string `yaml:"repo_auth_check_url"`
		RepoCredentialCheckURL string `yaml:"repo_credential_check_url"`
		GetBranchesURL         string              `yaml:"get_branches_url"`
		CreateMRBindingURL     string              `yaml:"create_mr_binding_url"`
		QueryCheckerTaskURL    string              `yaml:"query_checker_task_url"`
		RuleSets               map[string][]string `yaml:"rule_sets"`
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
	if AppConfig.PipelineSystem.CreateMRBindingURL == "" {
		AppConfig.PipelineSystem.CreateMRBindingURL = AppConfig.PipelineSystem.GetMRBindingsURL
	}
}
