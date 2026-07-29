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
