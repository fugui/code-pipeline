export interface User {
  id: number
  email: string
  name: string
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

export interface ManagedRepository {
  id: number
  managed_group_id: number
  group?: ManagedGroup
  name: string
  ssh_url: string
  http_url: string
  owner_id: number
  owner_name?: string
  department_id?: number
  department?: string
  subsystem_id?: number
  subsystem?: string
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
  owner_name?: string
  department_id?: number
  department?: string
  subsystem_id?: number
  subsystem?: string
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

