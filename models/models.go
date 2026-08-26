package models

import (
	commonModels "code-common/backend/models"
	"time"

	"gorm.io/datatypes"
	"gorm.io/gorm"
)

type User = commonModels.User
type SysAuditLog = commonModels.SysAuditLog
type AuditLevel = commonModels.AuditLevel

const (
	AuditLevelP0 = commonModels.AuditLevelP0
	AuditLevelP1 = commonModels.AuditLevelP1
	AuditLevelP2 = commonModels.AuditLevelP2
)

// Department 系统部门表
type Department struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Name      string    `gorm:"size:100;uniqueIndex;not null;default:''" json:"name"`
	Code      string    `gorm:"size:50;default:''" json:"code"`
	CreatedAt time.Time `json:"created_at"`
}

// Subsystem 归属子系统 (关联映射 code-bench 中的第一层级架构元素 architecture_elements)
type Subsystem struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	Identifier   string    `gorm:"not null;default:''" json:"identifier"`
	NameCn       string    `gorm:"not null;default:''" json:"name_cn"`
	NameEn       string    `gorm:"not null;default:''" json:"name_en"`
	Name         string    `gorm:"-" json:"name"`                            // 兼容显示字段
	Type         string    `gorm:"not null;default:'subsystem'" json:"type"` // "subsystem" | "group" | "module"
	ParentID     *uint     `json:"parent_id"`
	Subdirectory string    `gorm:"default:''" json:"subdirectory"`
	Description  string    `gorm:"default:''" json:"description"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (Subsystem) TableName() string {
	return "architecture_elements"
}

func (s *Subsystem) AfterFind(tx *gorm.DB) (err error) {
	if s.NameCn != "" {
		s.Name = s.NameCn
	} else if s.NameEn != "" {
		s.Name = s.NameEn
	} else {
		s.Name = s.Identifier
	}
	return
}

type Repository struct {
	ID                  uint              `gorm:"primaryKey" json:"id"`
	DepartmentID        uint              `json:"department_id"`
	Name                string            `gorm:"uniqueIndex;not null;default:''" json:"name"`
	ProjectID           string            `gorm:"default:''" json:"project_id"`
	URL                 string            `gorm:"default:''" json:"url"`
	HTTPURL             string            `gorm:"default:''" json:"http_url"`
	OwnerID             uint              `json:"owner_id"`
	OwnerName           string            `gorm:"index;default:''" json:"owner_name"`
	Branch              string            `gorm:"default:master" json:"branch"`
	ServiceGroup        string            `gorm:"index;default:''" json:"service_group"`
	IsActive            bool              `gorm:"index;default:true" json:"is_active"`
	WebhookRegistered   bool              `gorm:"default:false" json:"webhook_registered"`
	CodeCheckerTaskID   string            `gorm:"default:''" json:"code_checker_task_id"`
	CodeCheckerTaskName string            `gorm:"default:''" json:"code_checker_task_name"`
	Schemes             []ExecutionScheme `gorm:"foreignKey:RepositoryID" json:"schemes"`
	CreatedAt           time.Time         `json:"created_at"`
}

// PipelineGroup 流水线组模型 (纯逻辑物理流水线资源池)
type PipelineGroup struct {
	ID                    uint       `gorm:"primaryKey" json:"id"`
	GroupKey              string     `gorm:"size:100;uniqueIndex;not null;default:''" json:"group_key"` // 组唯一标识，如 "backend-group"
	Name                  string     `gorm:"size:150;not null;default:''" json:"name"`                  // 组展示名称
	Type                  string     `gorm:"size:50;default:''" json:"type,omitempty"`                  // 兼容保留
	MaxSchemesPerPipeline int        `gorm:"default:0" json:"max_schemes_per_pipeline,omitempty"`      // 兼容保留
	IsActive              bool       `gorm:"default:true;index" json:"is_active"`                       // 是否启用
	Description           string     `gorm:"type:text" json:"description"`                              // 描述说明
	Pipelines             []Pipeline `gorm:"foreignKey:GroupID" json:"pipelines,omitempty"`             // 组内物理流水线
	CreatedAt             time.Time  `json:"created_at"`
	UpdatedAt             time.Time  `json:"updated_at"`
}

type Pipeline struct {
	ID          uint           `gorm:"primaryKey" json:"id"`
	GroupID     *uint          `gorm:"index" json:"group_id"`                                       // 关联的流水线组 ID (空代表独立流水线)
	Group       *PipelineGroup `gorm:"foreignKey:GroupID" json:"group,omitempty"`                   // 关联流水线组对象
	PipelineID  string         `gorm:"uniqueIndex;not null;default:''" json:"pipeline_id"`           // 流水线 ID
	Name        string         `gorm:"not null;default:''" json:"name"`                              // 名称
	Type        string         `gorm:"not null;default:''" json:"type"`                              // 类型 (MR, 每日构建)
	Status      string         `gorm:"size:20;default:'active';index" json:"status"`                 // 节点状态: "active" | "full"
	GroupName   string         `json:"group_name"`                                                   // 组名称 (兼容保留)
	Description string         `json:"description"`                                                  // 描述
	ServiceID   string         `json:"service_id"`                                                   // 第三方服务 ID
	WorkspaceID string         `json:"workspace_id"`                                                 // 第三方工作区 ID
	OwnerID     string         `json:"owner_id"`                                                     // 三方项目 ID
	OwnerName   string         `json:"owner_name"`                                                   // 三方项目名称
	ServiceName string         `json:"service_name"`                                                 // 第三方服务名称
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	WebURL      string         `gorm:"-" json:"web_url"` // 排除字段，仅在 JSON 序列化中返回
}

type ExecutionScheme struct {
	ID           uint        `gorm:"primaryKey" json:"id"`
	Name         string      `json:"name"`                                                // 统一关联对象的全局唯一名称
	RepositoryID uint        `gorm:"index;index:idx_es_repo_branch" json:"repository_id"` // 关联本地只读 Repository 镜像表 ID
	Repository   *Repository `gorm:"foreignKey:RepositoryID" json:"repository,omitempty"`
	Branch       string      `gorm:"index:idx_es_repo_branch;not null;default:''" json:"branchs"` // 分支
	Languages    string      `json:"languages"`                                                   // 编程语言 (如: "C/C++,Python,Java")

	LocalPipelineID       uint      `gorm:"column:pipeline_id;index;not null;default:0" json:"pipeline_id"` // 关联的 Pipeline ID
	PipelineInfo          *Pipeline `gorm:"foreignKey:LocalPipelineID;references:ID" json:"pipeline,omitempty"`
	Username              string    `json:"username"`               // 用户名
	Password              string    `json:"password"`               // 密码
	ExecutionSchemeID     string    `json:"execution_scheme_id"`    // 执行方案ID (从真正流水线系统同步回来)
	ExecutionSchemeName   string    `json:"execution_scheme_name"`  // 执行方案名称
	CodeCheckerTaskID     string    `json:"code_checker_task_id"`   // 代码检查任务 ID
	CodeCheckerTaskName   string    `json:"code_checker_task_name"` // 代码检查任务名称
	CodeCheckerTaskWebURL string    `gorm:"-" json:"code_checker_task_web_url"`
	MRBindingID           string    `json:"mr_binding_id"`       // 绑定的 MR 绑定 ID
	MRBindingName         string    `json:"mr_binding_name"`     // 绑定的 MR 绑定名称
	ExecutionPlanID       string    `json:"execution_plan_id"`   // 绑定的每日构建/定时执行计划 ID
	ExecutionPlanName     string    `json:"execution_plan_name"` // 绑定的每日构建/定时执行计划名称
	MRTrigger             bool      `json:"mr_trigger"`
	DailyBuild            bool      `json:"daily_build"`
	DailyBuildTime        string    `gorm:"type:varchar(50);default:'00:30'" json:"daily_build_time"`
	CustomAttributes      string    `gorm:"type:text" json:"custom_attributes"` // 自定义属性 (JSON)
	CreatedAt             time.Time `json:"created_at"`
	UpdatedAt             time.Time `json:"updated_at"`
}

type MRBinding struct {
	ID         string `json:"id"`
	CodeURL    string `json:"codeUrl"`
	Branches   string `json:"branches"`
	SchemeID   string `json:"schemeId"`
	SchemeName string `json:"schemeName"`
}

type CheckerTaskInfo struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	RepoURL          string `json:"repoURL"`
	BranchName       string `json:"branchName"`
	ConfigTemplateID string `json:"configTemplateId"`
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
	ID        uint          `gorm:"primaryKey" json:"id"`                                      // 对应托管平台的 Group ID
	Name      string        `gorm:"size:100;not null;default:''" json:"name"`                  // 组名称
	Path      string        `gorm:"size:100;index;not null;default:''" json:"path"`            // 组相对路径
	FullPath  string        `gorm:"size:255;uniqueIndex;not null;default:''" json:"full_path"` // 组完整路径，如 "tech/infra"
	ParentID  *uint         `gorm:"index" json:"parent_id"`                                    // 父组 ID (空代表根组)
	Parent    *ManagedGroup `gorm:"foreignKey:ParentID" json:"-"`
	SyncedAt  *time.Time    `json:"synced_at"`                      // 最后的同步时间 (nil代表未同步)
	IsHidden  bool          `gorm:"default:false" json:"is_hidden"` // 是否被隐藏/屏蔽管理
	CreatedAt time.Time     `json:"created_at"`
}

// ManagedRepository 新系统独立的被管代码仓表
type ManagedRepository struct {
	ID                 uint         `gorm:"primaryKey" json:"id"`                                                     // 对应托管平台的 Project ID
	ManagedGroupID     uint         `gorm:"index;uniqueIndex:idx_mg_repo;not null;default:0" json:"managed_group_id"` // 关联被管组
	ManagedGroup       ManagedGroup `gorm:"foreignKey:ManagedGroupID" json:"group"`
	Name               string       `gorm:"uniqueIndex:idx_mg_repo;not null;default:''" json:"name"`
	SSHURL             string       `gorm:"not null;default:''" json:"ssh_url"` // SSH 克隆地址
	HTTPURL            string       `gorm:"default:''" json:"http_url"`         // HTTP 访问地址
	OwnerID            uint         `gorm:"index" json:"owner_id"`              // 负责人 ID (系统 User)
	Owner              *User        `gorm:"foreignKey:OwnerID" json:"owner,omitempty"`
	DepartmentID       *uint        `gorm:"index" json:"department_id,omitempty"`
	Department         *Department  `gorm:"foreignKey:DepartmentID" json:"department,omitempty"`
	SubsystemID        *uint        `gorm:"index" json:"subsystem_id,omitempty"`
	Subsystem          *Subsystem   `gorm:"foreignKey:SubsystemID" json:"subsystem,omitempty"`
	Language           string       `gorm:"size:50;default:''" json:"language"`
	MachineType        string       `gorm:"size:255;default:''" json:"machine_type"`
	Tags               string       `gorm:"size:255;default:''" json:"tags"`
	Description        string       `gorm:"type:text" json:"description"`
	DefaultBranch      string       `gorm:"size:50;default:'master'" json:"default_branch"`
	IsActive           bool         `gorm:"default:true" json:"is_active"`
	IsArchived         bool         `gorm:"default:false;index" json:"is_archived"` // 是否已被归档 (归档时 IsActive=false, IsHidden=true)
	IsHidden           bool         `gorm:"default:false;index" json:"is_hidden"`   // 是否已被隐藏
	WebhookRegistered  bool         `gorm:"default:false" json:"webhook_registered"`
	BranchCount        int          `gorm:"default:0" json:"branch_count"`         // 仓库分支总数
	ActiveCount        int          `gorm:"default:0" json:"active_count"`         // 活跃分支数
	StaleUnmergedCount int          `gorm:"default:0" json:"stale_unmerged_count"` // 未合并僵尸分支数
	StaleMergedCount   int          `gorm:"default:0" json:"stale_merged_count"`   // 已合并待清理分支数
	LastCommitTime     *time.Time   `json:"last_commit_time"`                      // 所有分支中最新的提交时间
	CreatedAt          time.Time    `json:"created_at"`
}

// ManagedMemberAccess 本地存储的成员/群组权限设置记录表
type ManagedMemberAccess struct {
	ID            uint      `gorm:"primaryKey" json:"id"`
	SourceType    string    `gorm:"size:20;index:idx_mma_source;index:idx_mma_lookup"`                      // "group" 或 "repository"
	SourceID      uint      `gorm:"index:idx_mma_source;index:idx_mma_lookup"`                              // 对应 ManagedGroupID 或 ManagedRepositoryID
	PrincipalType string    `gorm:"size:20;index:idx_mma_lookup;not null;default:''" json:"principal_type"` // 授权主体类型: "user" 或 "user_group"
	PrincipalID   uint      `gorm:"index;index:idx_mma_lookup;not null;default:0" json:"principal_id"`      // 对应的 User ID 或 外部 UserGroup ID
	PrincipalName string    `gorm:"size:100;default:''" json:"principal_name"`                              // 展示名缓存
	AccessLevel   int       `gorm:"not null;default:0" json:"access_level"`                                 // 权限等级: 10(Reporter), 30(Developer), 50(Owner)
	SyncStatus    string    `gorm:"size:20;default:'pending'" json:"sync_status"`                           // "pending" | "synced" | "failed"
	SyncError     string    `gorm:"type:text" json:"sync_error,omitempty"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// ManagedBranchMonitor 本地非活动分支监控表
type ManagedBranchMonitor struct {
	ID                  uint      `gorm:"primaryKey" json:"id"`
	ManagedRepositoryID uint      `gorm:"index;index:idx_mbm_repo_status;not null;default:0" json:"managed_repository_id"`
	BranchName          string    `gorm:"size:120;index;not null;default:''" json:"branch_name"`
	LastCommitHash      string    `gorm:"size:60" json:"last_commit_hash"`
	LastCommitTime      time.Time `gorm:"index" json:"last_commit_time"`
	LastAuthor          string    `gorm:"size:100" json:"last_author"`
	IsMerged            bool      `gorm:"index" json:"is_merged"`
	IsProtected         bool      `gorm:"index" json:"is_protected"`
	Status              string    `gorm:"size:20;index:idx_mbm_repo_status" json:"status"` // "active" | "merged_stale" | "unmerged_stale"
	UpdatedAt           time.Time `json:"updated_at"`
}

// ExecutionReport 第三方构建/代码检查任务日志上报记录表
type ExecutionReport struct {
	ID                uint           `gorm:"primaryKey" json:"id"`
	TaskID            string         `gorm:"size:120;uniqueIndex;not null;default:''" json:"task_id"`
	TaskType          string         `gorm:"size:50;index;not null;default:'build'" json:"task_type"` // build | code_check
	CodeCheckerTaskID string         `gorm:"size:100;default:''" json:"code_checker_task_id"`
	RepoURL           string         `gorm:"size:1024;not null;default:''" json:"repo_url"`
	RepoName          string         `gorm:"size:255;index;default:''" json:"repo_name"`
	Branch            string         `gorm:"size:255;not null;default:''" json:"branch"`
	CommitID          string         `gorm:"size:100;default:''" json:"commit_id"`
	ExecutionSchemeID string         `gorm:"size:100;default:''" json:"execution_scheme_id"`
	PipelineID        string         `gorm:"size:100;default:''" json:"pipeline_id"`
	Status            string         `gorm:"size:50;index;not null;default:'running'" json:"status"` // running, success, failed, cancelled, timeout
	StartTime         *time.Time     `json:"start_time"`
	EndTime           *time.Time     `json:"end_time"`
	DurationSec       int64          `gorm:"default:0" json:"duration_sec"`
	TriggerType       string         `gorm:"size:50;default:'webhook'" json:"trigger_type"` // manual, mr, daily_build, webhook
	TriggerUser       string         `gorm:"size:100;default:''" json:"trigger_user"`
	BuildDetails      datatypes.JSON `gorm:"type:text" json:"build_details,omitempty"`
	CodeCheckDetails  datatypes.JSON `gorm:"type:text" json:"code_check_details,omitempty"`
	LogContent        string         `gorm:"type:text" json:"log_content,omitempty"`
	ExternalLogURL    string         `gorm:"size:1024;default:''" json:"external_log_url,omitempty"`
	CreatedAt         time.Time      `json:"created_at"`
	UpdatedAt         time.Time      `json:"updated_at"`
}

// ManagedRepoApproval 被管代码仓与保护分支审批单
type ManagedRepoApproval struct {
	ID              uint               `gorm:"primaryKey" json:"id"`
	Type            string             `gorm:"size:30;not null" json:"type"` // "repo_create" | "protected_branch" | "batch_branch"
	ApplicantID     uint               `gorm:"not null" json:"applicant_id"`
	Applicant       User               `gorm:"foreignKey:ApplicantID" json:"applicant"`
	ManagedGroupID  uint               `json:"managed_group_id"`
	Group           *ManagedGroup      `gorm:"foreignKey:ManagedGroupID" json:"group,omitempty"`
	RepoName        string             `gorm:"size:255" json:"repo_name"`
	RepoID          *uint              `json:"repo_id"`
	Repo            *ManagedRepository `gorm:"foreignKey:RepoID" json:"repo,omitempty"`
	TargetBranch    string             `gorm:"size:120;default:'master'" json:"target_branch"`
	BaseBranch      string             `gorm:"size:120;default:'master'" json:"base_branch"`
	MultiRepoIDs    datatypes.JSON     `json:"multi_repo_ids"` // 跨仓分支时选择的 Repository ID 列表
	OwnerID         *uint              `json:"owner_id,omitempty"`
	Owner           *User              `gorm:"foreignKey:OwnerID" json:"owner,omitempty"`
	DepartmentID    *uint              `json:"department_id,omitempty"`
	Department      *Department        `gorm:"foreignKey:DepartmentID" json:"department,omitempty"`
	SubsystemID     *uint              `json:"subsystem_id,omitempty"`
	Subsystem       *Subsystem         `gorm:"foreignKey:SubsystemID" json:"subsystem,omitempty"`
	Language        string             `gorm:"size:50;default:''" json:"language"`
	MachineType     string             `gorm:"size:255;default:''" json:"machine_type"`
	Tags            string             `gorm:"size:255;default:''" json:"tags"`
	Description     string             `gorm:"type:text" json:"description"`
	DefaultBranch   string             `gorm:"size:50;default:'master'" json:"default_branch"`
	Reason          string             `gorm:"type:text" json:"reason"`
	Status          string             `gorm:"size:20;default:'pending'" json:"status"` // "pending", "approved", "rejected"
	ApproverID      *uint              `json:"approver_id"`
	Approver        *User              `gorm:"foreignKey:ApproverID" json:"approver,omitempty"`
	ApprovalComment string             `gorm:"type:text" json:"approval_comment"`
	CreatedAt       time.Time          `json:"created_at"`
	UpdatedAt       time.Time          `json:"updated_at"`
}

// ManagedBatchBranchLog 跨仓特性分支批量拉起记录表
type ManagedBatchBranchLog struct {
	ID          uint           `gorm:"primaryKey" json:"id"`
	BatchID     string         `gorm:"size:64;index" json:"batch_id"`
	FeatureName string         `gorm:"size:150;not null" json:"feature_name"`
	BaseBranch  string         `gorm:"size:100;default:'master'" json:"base_branch"`
	CreatorID   uint           `json:"creator_id"`
	Creator     User           `gorm:"foreignKey:CreatorID" json:"creator"`
	RepoIDs     datatypes.JSON `json:"repo_ids"` // 选中的仓库 ID 列表
	Results     datatypes.JSON `json:"results"`  // 各仓拉起结果 JSON 映射
	Description string         `gorm:"type:text" json:"description"`
	CreatedAt   time.Time      `json:"created_at"`
}

// ManagedProtectedBranchRule 保护分支规则配置表
type ManagedProtectedBranchRule struct {
	ID                  uint              `gorm:"primaryKey" json:"id"`
	ManagedRepositoryID uint              `gorm:"index;not null" json:"managed_repository_id"`
	Repo                ManagedRepository `gorm:"foreignKey:ManagedRepositoryID" json:"repo"`
	BranchPattern       string            `gorm:"size:120;not null" json:"branch_pattern"` // 如 "master", "release/*"
	AllowForcePush      bool              `gorm:"default:false" json:"allow_force_push"`
	RequireMrAudit      bool              `gorm:"default:true" json:"require_mr_audit"`
	CreatorID           uint              `json:"creator_id"`
	CreatedAt           time.Time         `json:"created_at"`
}

// ComplianceBaseline 合规基线模板
type ComplianceBaseline struct {
	ID          uint           `gorm:"primaryKey" json:"id"`
	Name        string         `gorm:"size:100;uniqueIndex;not null;default:''" json:"name"`
	Description string         `gorm:"type:text" json:"description"`
	IsDefault   bool           `gorm:"default:false;index" json:"is_default"` // 是否为系统默认模板，新纳管仓自动应用
	Rules       datatypes.JSON `gorm:"type:text" json:"rules"`                // 检查规则集 JSON ([]ComplianceRule)
	GroupIDs    datatypes.JSON `gorm:"type:text" json:"group_ids"`            // 绑定的 Group ID 列表 ([]uint)
	CreatorID   uint           `json:"creator_id"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
}

// ComplianceRule 合规检查规则（序列化为 JSON 存储在 ComplianceBaseline.Rules 中）
type ComplianceRule struct {
	Dimension string `json:"dimension"` // 维度: global_config / branch_protection / engineering / ownership / branch_hygiene / permission
	CheckKey  string `json:"check_key"` // 检查项标识
	Label     string `json:"label"`     // 检查项中文名
	Severity  string `json:"severity"`  // 严重度: critical / important / suggestion
	Enabled   bool   `json:"enabled"`   // 是否启用
	Threshold int    `json:"threshold"` // 阈值参数（如僵死分支数上限），0 表示不适用
}

// RepoComplianceReport 仓库合规报告快照
type RepoComplianceReport struct {
	ID                  uint                `gorm:"primaryKey" json:"id"`
	ManagedRepositoryID uint                `gorm:"index;not null" json:"managed_repository_id"`
	Repo                ManagedRepository   `gorm:"foreignKey:ManagedRepositoryID" json:"repo,omitempty"`
	BaselineID          uint                `gorm:"index;not null" json:"baseline_id"`
	Baseline            *ComplianceBaseline `gorm:"foreignKey:BaselineID" json:"baseline,omitempty"`
	Score               int                 `gorm:"default:0" json:"score"`          // 合规总分 0-100
	Grade               string              `gorm:"size:2;default:'D'" json:"grade"` // A / B / C / D
	TotalChecks         int                 `gorm:"default:0" json:"total_checks"`
	PassedChecks        int                 `gorm:"default:0" json:"passed_checks"`
	FailedChecks        int                 `gorm:"default:0" json:"failed_checks"`
	Details             datatypes.JSON      `gorm:"type:text" json:"details"` // 各检查项详细结果 ([]ComplianceCheckResult)
	AuditedAt           time.Time           `gorm:"index" json:"audited_at"`
	CreatedAt           time.Time           `json:"created_at"`
}

// ComplianceCheckResult 单个检查项的执行结果（序列化为 JSON 存储在 RepoComplianceReport.Details 中）
type ComplianceCheckResult struct {
	CheckKey      string `json:"check_key"`
	Dimension     string `json:"dimension"`
	Label         string `json:"label"`
	Severity      string `json:"severity"`
	Passed        bool   `json:"passed"`
	CurrentValue  string `json:"current_value"`  // 当前值，如 "stale_unmerged_count: 12"
	ExpectedValue string `json:"expected_value"` // 期望值，如 "≤ 5"
}

// ManagedCommitterGroup Committer 组管理模型
type ManagedCommitterGroup struct {
	ID              uint        `gorm:"primaryKey" json:"id"`
	Name            string      `gorm:"size:150;uniqueIndex;not null;default:''" json:"name"` // Committer Group 名称
	Level           string      `gorm:"size:50;not null;default:'L1'" json:"level"`           // 所属层级 (如 "L1-公司级", "L2-产品线/域级", "L3-项目/模块级")
	DepartmentID    *uint       `gorm:"index" json:"department_id,omitempty"`                 // 归属部门 ID
	Department      *Department `gorm:"foreignKey:DepartmentID" json:"department,omitempty"`  // 部门对象
	AdminID         *uint       `gorm:"index" json:"admin_id,omitempty"`                      // 管理员用户 ID
	Admin           *User       `gorm:"foreignKey:AdminID" json:"admin,omitempty"`            // 管理员对象
	IRightGroupName string      `gorm:"column:iright_group_name;size:150;default:''" json:"iright_group_name"`     // 第三方 iRight 群组名称
	IRightGroupID   string      `gorm:"column:iright_group_id;size:128;index;default:''" json:"iright_group_id"` // 第三方 iRight 群组 UUID 标识
	MemberCount     int         `gorm:"default:0" json:"member_count"`                                            // 成员数量
	Description     string      `gorm:"type:text" json:"description"`                                             // 备注/描述说明
	IsActive        bool        `gorm:"default:true;index" json:"is_active"`                                      // 是否启用
	CreatedAt       time.Time   `json:"created_at"`
	UpdatedAt       time.Time   `json:"updated_at"`
}
