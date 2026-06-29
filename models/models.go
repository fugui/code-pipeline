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
	ID        uint      `gorm:"primaryKey;autoIncrement:false" json:"id"` // 对应 code-bench 中的仓库 ID
	Name      string    `gorm:"uniqueIndex;not null" json:"name"`         // 仓库名称
	URL       string    `gorm:"default:''" json:"url"`                    // Git 克隆地址
	OwnerID   uint      `json:"owner_id"`                                 // 负责人 ID
	IsActive  bool      `gorm:"default:true" json:"is_active"`            // 是否在宿主端被冻结
	CreatedAt time.Time `json:"created_at"`
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
	ID               uint       `gorm:"primaryKey" json:"id"`
	ExecutionPlanID  string     `json:"execution_plan_id"`                  // 执行方案ID (从真正流水线系统同步回来)
	PipelineID       uint       `gorm:"index;not null" json:"pipeline_id"`  // 关联的 Pipeline ID
	RepositoryID     uint       `gorm:"index" json:"repository_id"`// 关联本地只读 Repository 镜像表 ID
	Repository       Repository `gorm:"foreignKey:RepositoryID" json:"repository"`
	Branch           string     `gorm:"not null" json:"branch"`             // 分支
	Username         string     `json:"username"`                           // 用户名
	Password         string     `json:"password"`                           // 密码
	CodeCheckerTaskID string    `json:"code_checker_task_id"`               // 代码检查任务 ID
	Languages        string     `json:"languages"`                          // 编程语言 (如: "C/C++,Python,Java")	
	CustomAttributes string     `gorm:"type:text" json:"custom_attributes"` // 自定义属性 (JSON)
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
}

type MRBinding struct {
	ID         int    `json:"id"`
	CodeURL    string `json:"codeUrl"`
	Branches   string `json:"branches"`
	SchemeID   string `json:"schemeId"`
	SchemeName string `json:"schemeName"`
}
