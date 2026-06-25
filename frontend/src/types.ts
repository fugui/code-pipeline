export interface User {
  id: number
  email: string
  name: string
  is_admin: boolean
}

export interface Repository {
  id: number
  name: string
  git_url: string
  branch: string
  build_cmd: string
  check_cmd: string
  cron_expr: string
  is_active: boolean
  last_run_status: string
  last_run_time: string | null
  created_at: string
}

export interface ExecutionLog {
  id: number
  repo_id: number
  repo_name: string
  branch: string
  trigger_type: string
  status: string
  build_log: string
  check_log: string
  error_msg: string
  start_time: string
  end_time: string | null
  duration_sec: number
}

export interface DashboardStats {
  total_repos: number
  active_schedulers: number
  total_runs: number
  success_rate: number
  running_count: number
  pending_count: number
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
  owner?: string
  service_name?: string
}

export interface ExecutionPlan {
  id?: number
  pipeline_id: number
  pipeline_name?: string
  repository_id?: number
  repository?: string
  branch: string
  cron_expr?: string
  is_active: boolean
  execution_plan_id?: string
  username?: string
  password?: string
  code_checker_task_id?: string
  languages?: string
  custom_attributes?: string
}
