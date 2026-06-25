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
		Port         string        `yaml:"port"`
		GinLog       bool          `yaml:"gin_log"`
		ReadTimeout  time.Duration `yaml:"read_timeout"`
		WriteTimeout time.Duration `yaml:"write_timeout"`
		WorkerCount  int           `yaml:"worker_count"`
		SandboxDir   string        `yaml:"sandbox_dir"`
	} `yaml:"server"`
	Auth struct {
		JWTSecret            string `yaml:"jwt_secret"`
		PasswordLoginEnabled bool   `yaml:"password_login_enabled"`
	} `yaml:"auth"`
	PipelineSystem struct {
		GetPipelineURL      string `yaml:"get_pipeline_url"`
		GetExecutionPlanURL string `yaml:"get_execution_plan_url"`
	} `yaml:"pipeline_system"`
}

var AppConfig Config

func LoadConfig(filename string) error {
	data, err := os.ReadFile(filename)
	if err != nil {
		if os.IsNotExist(err) {
			log.Println("[Config] config.yaml not found. Using defaults.")
			applyDefaults()
			return nil
		}
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
	if AppConfig.Auth.JWTSecret == "" {
		randomBytes := make([]byte, 32)
		if _, err := rand.Read(randomBytes); err != nil {
			log.Fatalf("Failed to generate random JWT secret: %v", err)
		}
		AppConfig.Auth.JWTSecret = hex.EncodeToString(randomBytes)
		log.Println("[Auth] WARNING: jwt_secret not configured. Using ephemeral random secret.")
	}
}
