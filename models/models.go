package models

import (
	"time"
)

type User struct {
	ID        uint       `gorm:"primaryKey" json:"id"`
	Email     string     `gorm:"uniqueIndex;not null" json:"email"`
	Name      string     `gorm:"not null;default:''" json:"name"`
	EmployeeID string     `gorm:"index;default:''" json:"employee_id"`
	Password  string     `gorm:"not null" json:"-"`
	IsActive  bool       `gorm:"default:true" json:"is_active"`
	IsAdmin   bool       `gorm:"default:false" json:"is_admin"`
	LastLogin *time.Time `json:"last_login"`
	LastIP    string     `gorm:"default:''" json:"last_ip"`
	CreatedAt time.Time  `json:"created_at"`
}

type Repository struct {
	ID           uint              `gorm:"primaryKey;autoIncrement:false" json:"id"` // 对应 code-bench 中的仓库 ID
	Name         string            `gorm:"uniqueIndex;not null" json:"name"`         // 仓库名称
	URL          string            `gorm:"default:''" json:"url"`                    // Git 克隆地址
	OwnerID      uint              `json:"owner_id"`                                 // 负责人 ID
	IsActive     bool              `gorm:"default:true" json:"is_active"`            // 是否在宿主端被冻结
	ProjectID    string            `gorm:"default:''" json:"project_id"`
	HTTPURL      string            `gorm:"default:''" json:"http_url"`
	ServiceGroup string            `gorm:"default:''" json:"service_group"` // 归属子系统
	OwnerName    string            `gorm:"default:''" json:"owner_name"`    // 负责人姓名
	CreatedAt    time.Time         `json:"created_at"`
	Schemes      []ExecutionScheme `gorm:"foreignKey:RepositoryID" json:"schemes"`
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
	OwnerID     string    `json:"owner_id"`                                // 三方项目 ID
	OwnerName   string    `json:"owner_name"`                              // 三方项目名称
	ServiceName string    `json:"service_name"`                            // 第三方服务名称
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
	WebURL      string    `gorm:"-" json:"web_url"` // 排除字段，仅在 JSON 序列化中返回
}

type ExecutionScheme struct {
	ID           uint        `gorm:"primaryKey" json:"id"`
	Name         string      `json:"name"`                       // 统一关联对象的全局唯一名称
	RepositoryID uint        `gorm:"index" json:"repository_id"` // 关联本地只读 Repository 镜像表 ID
	Repository   *Repository `gorm:"foreignKey:RepositoryID" json:"repository,omitempty"`
	Branch       string      `gorm:"not null" json:"branchs"` // 分支
	Languages    string      `json:"languages"`               // 编程语言 (如: "C/C++,Python,Java")

	LocalPipelineID     uint      `gorm:"column:pipeline_id;index;not null" json:"pipeline_id"` // 关联的 Pipeline ID
	PipelineInfo        *Pipeline `gorm:"foreignKey:LocalPipelineID;references:ID" json:"pipeline,omitempty"`
	Username            string    `json:"username"`               // 用户名
	Password            string    `json:"password"`               // 密码
	ExecutionSchemeID   string    `json:"execution_scheme_id"`    // 执行方案ID (从真正流水线系统同步回来)
	ExecutionSchemeName string    `json:"execution_scheme_name"`  // 执行方案名称
	CodeCheckerTaskID   string    `json:"code_checker_task_id"`   // 代码检查任务 ID
	CodeCheckerTaskName string    `json:"code_checker_task_name"` // 代码检查任务名称
	MRBindingID         string    `json:"mr_binding_id"`          // 绑定的 MR 绑定 ID
	MRBindingName       string    `json:"mr_binding_name"`        // 绑定的 MR 绑定名称
	ExecutionPlanID     string    `json:"execution_plan_id"`      // 绑定的每日构建/定时执行计划 ID
	ExecutionPlanName   string    `json:"execution_plan_name"`    // 绑定的每日构建/定时执行计划名称
	MRTrigger           bool      `gorm:"default:true" json:"mr_trigger"`
	DailyBuild          bool      `gorm:"default:true" json:"daily_build"`
	DailyBuildTime      string    `gorm:"type:varchar(50);default:'00:30'" json:"daily_build_time"`
	CustomAttributes    string    `gorm:"type:text" json:"custom_attributes"` // 自定义属性 (JSON)
	CreatedAt           time.Time `json:"created_at"`
	UpdatedAt           time.Time `json:"updated_at"`
}

type MRBinding struct {
	ID         string `json:"id"`
	CodeURL    string `json:"codeUrl"`
	Branches   string `json:"branches"`
	SchemeID   string `json:"schemeId"`
	SchemeName string `json:"schemeName"`
}

type RemoteExecutionScheme struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	CustomParameter string `json:"customParameter"`
}

type RemoteExecutionPlan struct {
	ID           string `json:"id"`
	ScheduleName string `json:"scheduleName"`
	PfkSchemeID  string `json:"pfkSchemeId"`
}
