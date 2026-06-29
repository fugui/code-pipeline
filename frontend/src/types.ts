export interface User {
  id: number
  email: string
  name: string
  is_admin: boolean
}

export interface Repository {
  id: number
  name: string
  url: string
  owner_id: number
  is_active: boolean
  created_at: string
}

export interface ExecutionLog {
  id: number
  plan_id: string
  pipeline_id: string
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
  failed_runs?: number
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
  repository_id: number
  repository?: Repository
  branch: string
  execution_plan_id?: string
  username?: string
  password?: string
  code_checker_task_id?: string
  languages?: string
  custom_attributes?: string
}
