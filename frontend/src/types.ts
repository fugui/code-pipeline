export interface User {
  id: number
  email: string
  name: string
  username?: string
  roles: string[]
}

export interface Repository {
  id: number
  name: string
  url: string
  http_url?: string
  owner_id: number
  is_active: boolean
  created_at: string
  service_group?: string
  owner_name?: string
}

export interface CodeCheckDetails {
  gate_status?: string
  lines_scanned?: number
  files_scanned?: number
  total_issues?: number
  fatal_issues?: number
  critical_issues?: number
  major_issues?: number
  minor_issues?: number
  code_duplication_rate?: string
  cyclomatic_complexity?: number
  checker_report_url?: string
}

export interface ExecutionLog {
  id: number
  task_id?: string
  task_type?: string
  code_checker_task_id?: string
  plan_id?: string
  pipeline_id?: string
  repo_id?: number
  repo_name: string
  repo_url?: string
  branch: string
  commit_id?: string
  execution_scheme_id?: string
  trigger_type: string
  trigger_user?: string
  status: string
  start_time: string
  end_time?: string | null
  duration_sec: number
  code_check_details?: CodeCheckDetails | string
  build_details?: any
  log_content?: string
  external_log_url?: string
  build_log?: string
  check_log?: string
  error_msg?: string
}


export interface FailedRepoStat {
  repo_name: string
  failed_count: number
}

export interface DashboardStats {
  total_schemes?: number
  total_repos: number
  active_schedulers: number
  total_runs: number
  failed_runs?: number
  success_rate: number
  running_count: number
  pending_count: number
  build_count?: number
  code_check_count?: number
  avg_duration_sec?: number
  gate_pass_rate?: number
  top_failed_repos?: FailedRepoStat[]
  recent_runs: ExecutionLog[]
}

export interface Pipeline {
  id?: number
  pipeline_id: string
  name: string
  type: string
  group_name?: string
  description?: string
  service_id?: string
  workspace_id?: string
  owner_id?: string
  owner_name?: string
  service_name?: string
  web_url?: string
}

export interface ExecutionScheme {
  id?: number
  pipeline_id: number
  pipeline_name?: string
  pipeline?: Pipeline
  repository_id: number
  repository?: Repository
  branchs: string
  execution_scheme_id?: string
  execution_scheme_name?: string
  execution_plan_id?: string
  execution_plan_name?: string
  mr_binding_id?: string
  mr_binding_name?: string
  username?: string
  password?: string
  code_checker_task_id?: string
  code_checker_task_name?: string
  code_checker_task_web_url?: string
  languages?: string
  custom_attributes?: string
  mr_trigger?: boolean
  daily_build?: boolean
  daily_build_time?: string
}

export interface ManagedGroup {
  id: number
  name: string
  path: string
  full_path: string
  parent_id?: number
  synced_at?: string
  is_hidden?: boolean
}

export interface Department {
  id: number
  name: string
  code?: string
  created_at?: string
}

export interface Subsystem {
  id: number
  name: string
  identifier?: string
  name_cn?: string
  name_en?: string
  type?: string
  description?: string
  created_at?: string
}

export interface ManagedRepository {
  id: number
  managed_group_id: number
  group?: ManagedGroup
  name: string
  ssh_url: string
  http_url: string
  owner_id: number
  owner?: User
  department_id?: number
  department?: Department
  subsystem_id?: number
  subsystem?: Subsystem
  language?: string
  machine_type?: string
  tags?: string
  description?: string
  default_branch?: string
  is_active: boolean
  is_archived?: boolean
  is_hidden?: boolean
  webhook_registered: boolean
  branch_count?: number
  active_count?: number
  stale_unmerged_count?: number
  stale_merged_count?: number
  last_commit_time?: string
  created_at: string
}

export interface ManagedRepoApproval {
  id: number
  type: 'repo_create' | 'protected_branch' | 'batch_branch'
  applicant_id: number
  applicant?: User
  managed_group_id?: number
  group?: ManagedGroup
  repo_name?: string
  repo_id?: number
  repo?: ManagedRepository
  target_branch?: string
  base_branch?: string
  multi_repo_ids?: number[]
  reason?: string
  owner_id?: number
  owner?: User
  department_id?: number
  department?: Department
  subsystem_id?: number
  subsystem?: Subsystem
  language?: string
  machine_type?: string
  tags?: string
  description?: string
  default_branch?: string
  status: 'pending' | 'approved' | 'rejected'
  approver_id?: number
  approver?: User
  approval_comment?: string
  created_at: string
  updated_at: string
}

export interface BatchRepoResult {
  repo_id: number
  repo_name: string
  status: 'success' | 'skipped' | 'failed'
  message: string
}

export interface ManagedBatchBranchLog {
  id: number
  batch_id: string
  feature_name: string
  base_branch: string
  creator_id: number
  creator?: User
  repo_ids: number[]
  results: BatchRepoResult[]
  description?: string
  created_at: string
}

export interface ManagedProtectedBranchRule {
  id: number
  managed_repository_id: number
  repo?: ManagedRepository
  branch_pattern: string
  allow_force_push: boolean
  require_mr_audit: boolean
  creator_id: number
  created_at: string
}

// 合规检查规则
export interface ComplianceRule {
  dimension: string
  check_key: string
  label: string
  severity: 'critical' | 'important' | 'suggestion'
  enabled: boolean
  threshold: number
}

// 合规基线模板
export interface ComplianceBaseline {
  id: number
  name: string
  description: string
  is_default: boolean
  rules: ComplianceRule[]
  group_ids: number[]
  creator_id: number
  created_at: string
  updated_at: string
}

// 合规检查结果详情
export interface ComplianceCheckResult {
  check_key: string
  dimension: string
  label: string
  severity: string
  passed: boolean
  current_value: string
  expected_value: string
}

// 仓库合规报告
export interface RepoComplianceReport {
  id: number
  managed_repository_id: number
  baseline_id: number
  baseline?: ComplianceBaseline
  score: number
  grade: 'A' | 'B' | 'C' | 'D'
  total_checks: number
  passed_checks: number
  failed_checks: number
  details: ComplianceCheckResult[]
  audited_at: string
  created_at: string
}

// 管控 Dashboard 统计数据
export interface ManagedDashboardStats {
  total_repos: number
  active_repos: number
  archived_repos: number
  hidden_repos: number
  total_groups: number
  repos_with_owner: number
  webhook_registered: number
  repos_with_protection: number
  pending_approvals: number
  total_stale_unmerged: number
  total_stale_merged: number
  compliance_total_reports: number
  compliance_avg_score: number
  compliance_rate: number
  compliance_grade_a: number
  compliance_grade_b: number
  compliance_grade_c: number
  compliance_grade_d: number
  stale_top5: Array<{ repo_id: number; repo_name: string; stale_unmerged_count: number }>
  compliance_bottom5: Array<{ repo_id: number; repo_name: string; score: number; grade: string }>
}

