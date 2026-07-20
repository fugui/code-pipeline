package models

import (
	"time"
)

type User struct {
	ID         uint       `gorm:"primaryKey" json:"id"`
	Email      string     `gorm:"uniqueIndex;not null" json:"email"`
	Name       string     `gorm:"not null;default:''" json:"name"`
	EmployeeID string     `gorm:"index;default:''" json:"employee_id"`
	Password   string     `gorm:"not null" json:"-"`
	IsActive   bool       `gorm:"default:true" json:"is_active"`
	IsAdmin    bool       `gorm:"default:false" json:"is_admin"`
	LastLogin  *time.Time `json:"last_login"`
	LastIP     string     `gorm:"default:''" json:"last_ip"`
	CreatedAt  time.Time  `json:"created_at"`
}

type Repository struct {
	ID                uint              `gorm:"primaryKey;autoIncrement:false" json:"id"` // 对应 code-bench 中的仓库 ID
	Name              string            `gorm:"uniqueIndex;not null" json:"name"`         // 仓库名称
	URL               string            `gorm:"default:''" json:"url"`                    // Git 克隆地址
	OwnerID           uint              `json:"owner_id"`                                 // 负责人 ID
	IsActive          bool              `gorm:"default:true" json:"is_active"`            // 是否在宿主端被冻结
	ProjectID         string            `gorm:"default:''" json:"project_id"`
	HTTPURL           string            `gorm:"default:''" json:"http_url"`
	ServiceGroup      string            `gorm:"default:''" json:"service_group"` // 归属子系统
	OwnerName         string            `gorm:"default:''" json:"owner_name"`    // 负责人姓名
	CreatedAt         time.Time         `json:"created_at"`
	WebhookRegistered   bool              `gorm:"default:false" json:"webhook_registered"` // Webhook 是否已在托管平台注册
	CodeCheckerTaskID   string            `gorm:"default:''" json:"code_checker_task_id"`   // 绑定的代码检查任务 ID
	CodeCheckerTaskName string            `gorm:"default:''" json:"code_checker_task_name"` // 绑定的代码检查任务名称
	Schemes             []ExecutionScheme `gorm:"foreignKey:RepositoryID" json:"schemes"`
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
	ExecutionSchemeID     string    `json:"execution_scheme_id"`    // 执行方案ID (从真正流水线系统同步回来)
	ExecutionSchemeName   string    `json:"execution_scheme_name"`  // 执行方案名称
	CodeCheckerTaskID     string    `json:"code_checker_task_id"`   // 代码检查任务 ID
	CodeCheckerTaskName   string    `json:"code_checker_task_name"` // 代码检查任务名称
	CodeCheckerTaskWebURL string    `gorm:"-" json:"code_checker_task_web_url"`
	MRBindingID           string    `json:"mr_binding_id"`          // 绑定的 MR 绑定 ID
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

// MrEvent 合并请求推送事件记录
type MrEvent struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	MrID           int64     `gorm:"index" json:"mr_id"` // 来自托管平台的 MR 内部 ID
	MrNum          int64     `json:"mr_num"`             // MR 的序号
	RepoName       string    `gorm:"size:255" json:"repo_name"`
	RepoURL        string    `gorm:"size:1024" json:"repo_url"`
	Title          string    `gorm:"size:512" json:"title"`
	SourceBranch   string    `gorm:"size:255" json:"source_branch"`
	TargetBranch   string    `gorm:"size:255" json:"target_branch"`
	Author         string    `gorm:"size:255" json:"author"`
	Action         string    `gorm:"size:50" json:"action"`                      // open, close, merge, update 等
	MrURL          string    `gorm:"size:1024" json:"mr_url"`                    // 跳转到托管平台的页面 URL
	Payload        string    `gorm:"type:text" json:"payload"`                   // 原始 json 字符串
	IsProtoChange  bool      `gorm:"default:false;index" json:"is_proto_change"` // 是否包含接口相关修改
	InterfaceFiles string    `gorm:"type:text" json:"interface_files"`           // 接口相关修改的文件列表 (JSON string 数组)
	CreatedAt      time.Time `json:"created_at"`
}

// ManagedGroup 新系统独立的嵌套组表
type ManagedGroup struct {
	ID        uint          `gorm:"primaryKey" json:"id"`                           // 对应托管平台的 Group ID
	Name      string        `gorm:"size:100;not null" json:"name"`                  // 组名称
	Path      string        `gorm:"size:100;index;not null" json:"path"`            // 组相对路径
	FullPath  string        `gorm:"size:255;uniqueIndex;not null" json:"full_path"`  // 组完整路径，如 "tech/infra"
	ParentID  *uint         `gorm:"index" json:"parent_id"`                         // 父组 ID (空代表根组)
	Parent    *ManagedGroup `gorm:"foreignKey:ParentID" json:"-"`
	CreatedAt time.Time     `json:"created_at"`
}

// ManagedRepository 新系统独立的被管代码仓表
type ManagedRepository struct {
	ID                uint              `gorm:"primaryKey" json:"id"`                  // 对应托管平台的 Project ID
	ManagedGroupID    uint              `gorm:"index;not null" json:"managed_group_id"`// 关联被管组
	ManagedGroup      ManagedGroup      `gorm:"foreignKey:ManagedGroupID" json:"group"`
	Name              string            `gorm:"uniqueIndex:idx_mg_repo;not null" json:"name"`
	SSHURL            string            `gorm:"not null" json:"ssh_url"`               // SSH 克隆地址
	HTTPURL           string            `gorm:"default:''" json:"http_url"`            // HTTP 访问地址
	OwnerID           uint              `json:"owner_id"`                              // 负责人 ID (系统 User)
	IsActive          bool              `gorm:"default:true" json:"is_active"`
	WebhookRegistered bool              `gorm:"default:false" json:"webhook_registered"`
	CreatedAt         time.Time         `json:"created_at"`
}

// ManagedMemberAccess 本地存储的成员/群组权限设置记录表
type ManagedMemberAccess struct {
	ID            uint      `gorm:"primaryKey" json:"id"`
	SourceType    string    `gorm:"size:20;index:idx_mma_source"`    // "group" 或 "repository"
	SourceID      uint      `gorm:"index:idx_mma_source"`            // 对应 ManagedGroupID 或 ManagedRepositoryID
	PrincipalType string    `gorm:"size:20;not null" json:"principal_type"` // 授权主体类型: "user" 或 "user_group"
	PrincipalID   uint      `gorm:"index;not null" json:"principal_id"`     // 对应的 User ID 或 外部 UserGroup ID
	PrincipalName string    `gorm:"size:100;default:''" json:"principal_name"` // 展示名缓存
	AccessLevel   int       `gorm:"not null" json:"access_level"`    // 权限等级: 10(Reporter), 30(Developer), 50(Owner)
	SyncStatus    string    `gorm:"size:20;default:'pending'" json:"sync_status"` // "pending" | "synced" | "failed"
	SyncError     string    `gorm:"type:text" json:"sync_error,omitempty"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// ManagedBranchMonitor 本地非活动分支监控表
type ManagedBranchMonitor struct {
	ID                  uint      `gorm:"primaryKey" json:"id"`
	ManagedRepositoryID uint      `gorm:"index;not null" json:"managed_repository_id"`
	BranchName          string    `gorm:"size:120;index;not null" json:"branch_name"`
	LastCommitHash      string    `gorm:"size:60" json:"last_commit_hash"`
	LastCommitTime      time.Time `gorm:"index" json:"last_commit_time"`
	LastAuthor          string    `gorm:"size:100" json:"last_author"`
	IsMerged            bool      `gorm:"index" json:"is_merged"`
	IsProtected         bool      `gorm:"index" json:"is_protected"`
	Status              string    `gorm:"size:20" json:"status"` // "active" | "merged_stale" | "unmerged_stale"
	UpdatedAt           time.Time `json:"updated_at"`
}

