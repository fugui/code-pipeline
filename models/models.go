package models

import (
	"time"
)

type User struct {
	ID        uint       `gorm:"primaryKey" json:"id"`
	Email     string     `gorm:"uniqueIndex;not null" json:"email"`
	Name      string     `gorm:"not null;default:''" json:"name"`
	Password  string     `gorm:"not null" json:"-"`
	IsActive  bool       `gorm:"default:true" json:"is_active"`
	IsAdmin   bool       `gorm:"default:false" json:"is_admin"`
	LastLogin *time.Time `json:"last_login"`
	LastIP    string     `gorm:"default:''" json:"last_ip"`
	CreatedAt time.Time  `json:"created_at"`
}

type Repository struct {
	ID            uint       `gorm:"primaryKey" json:"id"`
	Name          string     `gorm:"uniqueIndex;not null" json:"name"`      // 仓库名称
	GitURL        string     `gorm:"not null" json:"git_url"`               // Git 克隆或本地路径地址
	Branch        string     `gorm:"default:'master'" json:"branch"`        // 默认分支
	BuildCmd      string     `gorm:"type:text" json:"build_cmd"`            // 构建命令
	CheckCmd      string     `gorm:"type:text" json:"check_cmd"`            // 检查命令
	CronExpr      string     `gorm:"default:''" json:"cron_expr"`           // 定时调度 Cron 表达式
	IsActive      bool       `gorm:"default:true" json:"is_active"`         // 是否开启定时调度
	LastRunStatus string     `gorm:"default:'idle'" json:"last_run_status"` // "idle", "running", "success", "failed", "cancelled"
	LastRunTime   *time.Time `json:"last_run_time"`                         // 上次运行时间
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

type ExecutionLog struct {
	ID          uint       `gorm:"primaryKey" json:"id"`
	RepoID      uint       `gorm:"index" json:"repo_id"`
	RepoName    string     `json:"repo_name"`
	Branch      string     `json:"branch"`
	TriggerType string     `json:"trigger_type"` // "manual", "schedule", "webhook"
	Status      string     `json:"status"`       // "pending", "running", "success", "failed", "cancelled"
	BuildLog    string     `gorm:"type:mediumtext" json:"build_log"`
	CheckLog    string     `gorm:"type:mediumtext" json:"check_log"`
	ErrorMsg    string     `json:"error_msg"`
	StartTime   time.Time  `json:"start_time"`
	EndTime     *time.Time `json:"end_time"`
	DurationSec int64      `json:"duration_sec"`
}

type Pipeline struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	PipelineID  string    `gorm:"uniqueIndex;not null" json:"pipeline_id"` // 流水线 ID
	Name        string    `gorm:"not null" json:"name"`                    // 名称
	Type        string    `gorm:"not null" json:"type"`                    // 类型 (MR, 每日构建)
	GroupName   string    `json:"group_name"`                              // 组名称
	Description string    `json:"description"`                             // 描述
	ServiceID   string    `json:"service_id"`                              // 第三方服务 ID
	WorkspaceID string    `json:"workspace_id"`                            // 第三方工作区 ID
	Owner       string    `json:"owner"`                                   // 第三方负责人
	ServiceName string    `json:"service_name"`                            // 第三方服务名称
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type ExecutionPlan struct {
	ID               uint      `gorm:"primaryKey" json:"id"`
	ExecutionPlanID  string    `json:"execution_plan_id"`                  // 执行方案ID (从真正流水线系统同步回来)
	PipelineID       uint      `gorm:"index;not null" json:"pipeline_id"`  // 关联的 Pipeline ID
	Repository       string    `gorm:"not null" json:"repository"`         // 代码仓
	Branch           string    `gorm:"not null" json:"branch"`             // 分支
	Username         string    `json:"username"`                           // 用户名
	Password          string    `json:"password"`                           // 密码
	CodeCheckerTaskID string    `json:"code_checker_task_id"`               // 代码检查任务 ID
	Languages        string    `json:"languages"`                          // 编程语言 (如: "C/C++,Python,Java")	
	CustomAttributes string    `gorm:"type:text" json:"custom_attributes"` // 自定义属性 (JSON)
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}
