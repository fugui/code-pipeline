import React, { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { 
  Play, Square, Trash2, Edit, Plus, Search, 
  RefreshCw, CheckCircle, XCircle, AlertCircle, Loader2, 
  Terminal, LayoutDashboard, GitBranch, Calendar, LogOut, 
  Clock, Activity, ShieldAlert
} from 'lucide-react'

// TODO(security): 在生产部署中，应放弃 localStorage 存储 Auth Token 的方式，
// 建议采用后端 HttpOnly Cookie 存储，并在前后端均配置 CSRF Token，以防御 XSS 和 CSRF 攻击。
const AUTH_TOKEN_KEY = 'code_pipeline_token'

interface User {
  id: number
  email: string
  name: string
  is_admin: boolean
}

interface Repository {
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

interface ExecutionLog {
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

interface DashboardStats {
  total_repos: number
  active_schedulers: number
  total_runs: number
  success_rate: number
  running_count: number
  pending_count: number
  recent_runs: ExecutionLog[]
}

interface AppProps {
  isEmbedded?: boolean
}

const App: React.FC<AppProps> = ({ isEmbedded = false }) => {
  const apiBase = isEmbedded ? '/pipeline/api' : '/api'
  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem('code_shield_token') || localStorage.getItem(AUTH_TOKEN_KEY);
  })
  const [user, setUser] = useState<User | null>(null)
  const [currentView, setCurrentView] = useState<'dashboard' | 'repos' | 'history' | 'pipeline-config'>('dashboard')
  
  // Data lists
  const [repos, setRepos] = useState<Repository[]>([])
  
  // Pipelines and plans states
  const [pipelines, setPipelines] = useState<any[]>([])
  const [showPipelineModal, setShowPipelineModal] = useState(false)
  const [activePipeline, setActivePipeline] = useState<any | null>(null)
  const [pipelineFetchError, setPipelineFetchError] = useState('')
  const [isFetchingPipeline, setIsFetchingPipeline] = useState(false)
  const [selectedPipeline, setSelectedPipeline] = useState<any | null>(null)
  const [plans, setPlans] = useState<any[]>([])
  const [showPlanModal, setShowPlanModal] = useState(false)
  const [activePlan, setActivePlan] = useState<any | null>(null)
  const [executions, setExecutions] = useState<ExecutionLog[]>([])
  const [totalExecutions, setTotalExecutions] = useState(0)
  const [execPage, setExecPage] = useState(1)
  const [stats, setStats] = useState<DashboardStats | null>(null)
  
  // Searching & Filtering
  const [searchQuery, setSearchQuery] = useState('')
  const [historyStatusFilter, setHistoryStatusFilter] = useState('')
  const [historyRepoFilter, setHistoryRepoFilter] = useState('')
  
  // Loading states
  const [loading, setLoading] = useState(false)
  const [meLoading, setMeLoading] = useState(true)
  
  // Modals / Details
  const [showRepoModal, setShowRepoModal] = useState(false)
  const [activeRepo, setActiveRepo] = useState<Partial<Repository> | null>(null)
  const [activeExec, setActiveExec] = useState<ExecutionLog | null>(null)
  
  // Login Form
  const [loginEmail, setLoginEmail] = useState('admin@code-shield.com')
  const [loginPassword, setLoginPassword] = useState('admin123')
  const [loginError, setLoginError] = useState('')

  const activeExecInterval = useRef<any>(null)
  const location = useLocation()

  // 同步微前端路由
  useEffect(() => {
    const path = location.pathname
    if (path.endsWith('/repos')) {
      setCurrentView('repos')
    } else if (path.endsWith('/pipeline-config')) {
      setCurrentView('pipeline-config')
    } else if (path.endsWith('/history')) {
      setCurrentView('history')
    } else {
      setCurrentView('dashboard')
    }
  }, [location.pathname])

  // Fetch current user
  useEffect(() => {
    if (token) {
      setMeLoading(true)
      fetch(`${apiBase}/me`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      .then(res => {
        if (!res.ok) throw new Error('Unauthorized')
        return res.json()
      })
      .then(data => {
        setUser(data)
      })
      .catch(() => {
        handleLogout()
      })
      .finally(() => {
        setMeLoading(false)
      })
    } else {
      setMeLoading(false)
    }
  }, [token])

  // Fetch view-specific data
  useEffect(() => {
    if (!token || !user) return

    if (currentView === 'dashboard') {
      fetchStats()
    } else if (currentView === 'repos') {
      fetchRepos()
    } else if (currentView === 'history') {
      fetchExecutions()
    }
  }, [token, user, currentView, searchQuery, execPage, historyStatusFilter, historyRepoFilter])

  // Auto-refresh Dashboard Stats
  useEffect(() => {
    if (!token || !user || currentView !== 'dashboard') return
    const interval = setInterval(fetchStats, 5000)
    return () => clearInterval(interval)
  }, [token, user, currentView])

  // Auto-refresh Active Execution Details (if running)
  useEffect(() => {
    if (!token || !activeExec || (activeExec.status !== 'running' && activeExec.status !== 'pending')) {
      if (activeExecInterval.current) {
        clearInterval(activeExecInterval.current)
      }
      return
    }

    activeExecInterval.current = setInterval(() => {
      fetch(`${apiBase}/executions/${activeExec.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      .then(res => res.json())
      .then(data => {
        setActiveExec(data)
        if (data.status !== 'running' && data.status !== 'pending') {
          clearInterval(activeExecInterval.current)
          // 刷新列表数据
          if (currentView === 'history') fetchExecutions()
          else if (currentView === 'dashboard') fetchStats()
        }
      })
    }, 2000)

    return () => {
      if (activeExecInterval.current) {
        clearInterval(activeExecInterval.current)
      }
    }
  }, [token, activeExec])

  const fetchStats = () => {
    fetch(`${apiBase}/dashboard/stats`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(data => setStats(data))
    .catch(err => console.error('Failed to fetch stats', err))
  }

  const fetchRepos = () => {
    fetch(`${apiBase}/repos?search=${encodeURIComponent(searchQuery)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(data => setRepos(data))
    .catch(err => console.error('Failed to fetch repos', err))
  }

  const fetchExecutions = () => {
    let url = `${apiBase}/executions?page=${execPage}&limit=10`
    if (historyStatusFilter) url += `&status=${historyStatusFilter}`
    if (historyRepoFilter) url += `&repo_id=${historyRepoFilter}`

    fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(data => {
      setExecutions(data.data || [])
      setTotalExecutions(data.total || 0)
    })
    .catch(err => console.error('Failed to fetch executions', err))
  }

  const fetchPipelines = () => {
    fetch(`${apiBase}/pipelines?search=${encodeURIComponent(searchQuery)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(data => {
      const list = data || []
      setPipelines(list)
      // 如果当前选中了某流水线，在此处同步其最新值
      if (selectedPipeline) {
        const updated = list.find((p: any) => p.id === selectedPipeline.id)
        if (updated) {
          setSelectedPipeline(updated)
        } else {
          setSelectedPipeline(null)
          setPlans([])
        }
      }
    })
    .catch(err => console.error('Failed to fetch pipelines', err))
  }

  const fetchPlans = (pipelineId: number) => {
    fetch(`${apiBase}/execution-plans?pipeline_id=${pipelineId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(data => setPlans(data || []))
    .catch(err => console.error('Failed to fetch execution plans', err))
  }

  const handleSavePipeline = (e: React.FormEvent) => {
    e.preventDefault()
    if (!activePipeline || !activePipeline.pipeline_id || !activePipeline.name || !activePipeline.type) return

    const method = activePipeline.id ? 'PUT' : 'POST'
    const url = activePipeline.id ? `${apiBase}/pipelines/${activePipeline.id}` : `${apiBase}/pipelines`

    fetch(url, {
      method,
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(activePipeline)
    })
    .then(res => {
      if (!res.ok) throw new Error('保存流水线失败，该流水线 ID 可能已存在')
      return res.json()
    })
    .then(() => {
      setShowPipelineModal(false)
      setActivePipeline(null)
      fetchPipelines()
    })
    .catch(err => alert(err.message))
  }

  const handleDeletePipeline = (id: number) => {
    if (!window.confirm('您确定要删除此流水线吗？其关联的所有执行方案在本地及三方系统上均将被同步物理删除！')) return

    fetch(`${apiBase}/pipelines/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => {
      if (!res.ok) throw new Error('删除流水线失败')
      fetchPipelines()
    })
    .catch(err => alert(err.message))
  }

  const handleSavePlan = (e: React.FormEvent) => {
    e.preventDefault()
    if (!activePlan || !activePlan.repository || !activePlan.branch) return

    const method = activePlan.id ? 'PUT' : 'POST'
    const url = activePlan.id ? `${apiBase}/execution-plans/${activePlan.id}` : `${apiBase}/execution-plans`

    fetch(url, {
      method,
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(activePlan)
    })
    .then(res => {
      if (!res.ok) throw new Error('保存执行方案失败')
      return res.json()
    })
    .then(() => {
      setShowPlanModal(false)
      setActivePlan(null)
      if (selectedPipeline) {
        fetchPlans(selectedPipeline.id)
      }
    })
    .catch(err => alert(err.message))
  }

  const handleDeletePlan = (id: number) => {
    if (!window.confirm('您确定要删除此执行方案吗？将同步通知外部系统进行删除。')) return

    fetch(`${apiBase}/execution-plans/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => {
      if (!res.ok) throw new Error('删除执行方案失败')
      if (selectedPipeline) {
        fetchPlans(selectedPipeline.id)
      }
    })
    .catch(err => alert(err.message))
  }

  const handleSelectPipeline = (pipeline: any) => {
    setSelectedPipeline(pipeline)
    fetchPlans(pipeline.id)
  }

  const handleFetchRemotePipelineInfo = (pipelineID: string) => {
    if (!pipelineID) return
    setIsFetchingPipeline(true)
    setPipelineFetchError('')
    fetch(`${apiBase}/pipelines/fetch-info?pipeline_id=${encodeURIComponent(pipelineID)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => {
      if (!res.ok) throw new Error('HTTP status error')
      return res.json()
    })
    .then(data => {
      if (data.is_mock) {
        setPipelineFetchError('提示：未连接到真实外部流水线系统，已自动填充 Mock 数据进行兜底。')
      } else {
        setPipelineFetchError('')
      }
      setActivePipeline((prev: any) => ({
        ...prev,
        name: data.name || '',
        type: data.type || '每日构建',
        group_name: data.group_name || '',
        description: data.description || '',
      }))
    })
    .catch(() => {
      setPipelineFetchError('同步外部数据失败，已切换为本地 Mock 数据自动回填。')
      setActivePipeline((prev: any) => ({
        ...prev,
        name: `Mock流水线_${pipelineID}`,
        type: '每日构建',
        group_name: 'DefaultGroup',
        description: '同步远程流水线信息失败，已自动回填本地 Mock 数据。',
      }))
    })
    .finally(() => {
      setIsFetchingPipeline(false)
    })
  }

  const handleLogin = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    setLoginError('')
    setLoading(true)

    fetch(`${apiBase}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: loginEmail, password: loginPassword })
    })
    .then(res => {
      if (!res.ok) throw new Error('邮箱或密码不正确')
      return res.json()
    })
    .then(data => {
      localStorage.setItem(AUTH_TOKEN_KEY, data.token)
      setToken(data.token)
      setUser(data.user)
    })
    .catch(err => {
      setLoginError(err.message)
    })
    .finally(() => {
      setLoading(false)
    })
  }

  const handleLogout = () => {
    localStorage.removeItem(AUTH_TOKEN_KEY)
    setToken(null)
    setUser(null)
    setStats(null)
    setRepos([])
    setExecutions([])
  }

  const handleSaveRepo = (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeRepo || !activeRepo.name || !activeRepo.git_url) return

    const method = activeRepo.id ? 'PUT' : 'POST'
    const url = activeRepo.id ? `${apiBase}/repos/${activeRepo.id}` : `${apiBase}/repos`

    fetch(url, {
      method,
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(activeRepo)
    })
    .then(res => {
      if (!res.ok) throw new Error('Failed to save repository')
      return res.json()
    })
    .then(() => {
      setShowRepoModal(false)
      setActiveRepo(null)
      fetchRepos()
    })
    .catch(err => alert(err.message))
  }

  const handleDeleteRepo = (id: number) => {
    if (!window.confirm('您确定要删除此仓库配置吗？相关的定时任务将一并移除。')) return

    fetch(`${apiBase}/repos/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => {
      if (!res.ok) throw new Error('Failed to delete repository')
      fetchRepos()
    })
    .catch(err => alert(err.message))
  }

  const handleTriggerRepo = (id: number) => {
    fetch(`${apiBase}/repos/${id}/trigger`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(data => {
      // 成功触发后跳转到日志或者弹窗
      fetchRepos()
      // 自动获取最新运行任务，展示终端
      fetch(`${apiBase}/executions/${data.execution_id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      .then(r => r.json())
      .then(exec => setActiveExec(exec))
    })
    .catch(err => alert('触发流水线失败: ' + err.message))
  }

  const handleCancelExecution = (id: number) => {
    if (!window.confirm('确定要取消此流水线的执行任务吗？')) return

    fetch(`${apiBase}/executions/${id}/cancel`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => {
      if (!res.ok) throw new Error('取消失败')
      return res.json()
    })
    .then(() => {
      if (activeExec && activeExec.id === id) {
        // 刷新当前查看的日志状态
        fetch(`${apiBase}/executions/${id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
        .then(r => r.json())
        .then(d => setActiveExec(d))
      }
      if (currentView === 'history') fetchExecutions()
      else if (currentView === 'dashboard') fetchStats()
    })
    .catch(err => alert(err.message))
  }

  // Formatting utilities
  const formatTime = (isoString: string | null) => {
    if (!isoString) return '-'
    const date = new Date(isoString)
    return date.toLocaleString('zh-CN', { hour12: false })
  }

  if (meLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Loader2 className="animate-spin" size={48} color="#6366f1" />
        <p style={{ color: 'var(--text-secondary)' }}>正在校验用户身份，请稍后...</p>
      </div>
    )
  }

  if (!token || !user) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', padding: 20 }}>
        <div className="glass-card animate-slide-in" style={{ width: '100%', maxWidth: 440, padding: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, justifyContent: 'center' }}>
            <Activity color="#6366f1" size={32} />
            <h2 style={{ fontSize: 24, fontWeight: 700, background: 'var(--accent-primary)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Code-Pipeline
            </h2>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, textAlign: 'center', marginBottom: 24 }}>
            持续集成与代码流水线大屏管理系统
          </p>

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>邮箱地址</label>
              <input 
                type="email" 
                value={loginEmail} 
                onChange={(e) => setLoginEmail(e.target.value)} 
                required 
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>系统密码</label>
              <input 
                type="password" 
                value={loginPassword} 
                onChange={(e) => setLoginPassword(e.target.value)} 
                required 
              />
            </div>

            {loginError && (
              <div style={{ background: 'rgba(244, 63, 94, 0.1)', color: '#fb7185', padding: '10px 14px', borderRadius: 8, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                <ShieldAlert size={16} />
                <span>{loginError}</span>
              </div>
            )}

            <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '12px 16px', marginTop: 10 }}>
              {loading ? <Loader2 className="animate-spin" size={18} /> : '立即登入'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Sidebar */}
      {!isEmbedded && (
        <aside className="glass-card" style={{ width: 260, borderRadius: 0, borderTop: 'none', borderBottom: 'none', borderLeft: 'none', padding: 24, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Activity color="#6366f1" size={24} />
              <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '0.5px' }}>Code-Pipeline</span>
            </div>

            <nav style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button 
                onClick={() => { setCurrentView('dashboard'); setActiveExec(null); }} 
                className={`btn ${currentView === 'dashboard' ? 'btn-primary' : 'btn-secondary'}`} 
                style={{ justifyContent: 'flex-start', width: '100%' }}
              >
                <LayoutDashboard size={16} /> 仪表盘大屏
              </button>
              <button 
                onClick={() => { setCurrentView('repos'); setActiveExec(null); }} 
                className={`btn ${currentView === 'repos' ? 'btn-primary' : 'btn-secondary'}`} 
                style={{ justifyContent: 'flex-start', width: '100%' }}
              >
                <GitBranch size={16} /> 仓库流配置
              </button>
              <button 
                onClick={() => { setCurrentView('pipeline-config'); setActiveExec(null); }} 
                className={`btn ${currentView === 'pipeline-config' ? 'btn-primary' : 'btn-secondary'}`} 
                style={{ justifyContent: 'flex-start', width: '100%' }}
              >
                <Activity size={16} /> 流水线配置
              </button>
              <button 
                onClick={() => { setCurrentView('history'); setActiveExec(null); }} 
                className={`btn ${currentView === 'history' ? 'btn-primary' : 'btn-secondary'}`} 
                style={{ justifyContent: 'flex-start', width: '100%' }}
              >
                <Clock size={16} /> 执行历史
              </button>
            </nav>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, borderTop: '1px solid var(--border-color)', paddingTop: 20 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{user.name}</span>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{user.email}</span>
            </div>
            <button onClick={handleLogout} className="btn btn-secondary btn-small" style={{ width: '100%' }}>
              <LogOut size={14} /> 退出系统
            </button>
          </div>
        </aside>
      )}

      {/* Main Content Area */}
      <main style={{ flex: 1, padding: '32px 40px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
        
        {/* VIEW 1: DASHBOARD */}
        {currentView === 'dashboard' && stats && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
            <div>
              <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>流水线控制中心</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>实时观测 300+ 个应用服务的持续集成运行现状</p>
            </div>

            {/* Metrics cards grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
              <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>接入项目数</span>
                <span style={{ fontSize: 32, fontWeight: 700 }}>{stats.total_repos}</span>
              </div>
              <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>活跃定时任务</span>
                <span style={{ fontSize: 32, fontWeight: 700, color: '#3b82f6' }}>{stats.active_schedulers}</span>
              </div>
              <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>流水线运行总数</span>
                <span style={{ fontSize: 32, fontWeight: 700 }}>{stats.total_runs}</span>
              </div>
              <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>构建成功率</span>
                <span style={{ fontSize: 32, fontWeight: 700, color: '#10b981' }}>
                  {(stats.success_rate * 100).toFixed(1)}%
                </span>
              </div>
              <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>并发任务 / 排队等待</span>
                <span style={{ fontSize: 32, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: '#60a5fa' }}>{stats.running_count}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 20 }}>/</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{stats.pending_count}</span>
                </span>
              </div>
            </div>

            {/* Concurrent load and queues */}
            {(stats.running_count > 0 || stats.pending_count > 0) && (
              <div className="glass-card" style={{ background: 'rgba(99, 102, 241, 0.05)', borderColor: 'rgba(99, 102, 241, 0.2)', display: 'flex', alignItems: 'center', gap: 16 }}>
                <Loader2 className="animate-spin" color="#6366f1" />
                <div>
                  <span style={{ fontWeight: 600, fontSize: 14, display: 'block' }}>流水线引擎执行中</span>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    正在并发处理 {stats.running_count} 个任务，剩余 {stats.pending_count} 个任务在排队等待队列中。
                  </span>
                </div>
              </div>
            )}

            {/* Recent executions table */}
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: 16, fontWeight: 600 }}>最近执行轨迹</h3>
                <button className="btn btn-secondary btn-small" onClick={fetchStats}>
                  <RefreshCw size={12} /> 刷新
                </button>
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                    <th style={{ padding: '12px 8px' }}>流水线 ID</th>
                    <th style={{ padding: '12px 8px' }}>项目名称</th>
                    <th style={{ padding: '12px 8px' }}>分支</th>
                    <th style={{ padding: '12px 8px' }}>触发源</th>
                    <th style={{ padding: '12px 8px' }}>状态</th>
                    <th style={{ padding: '12px 8px' }}>启动时间</th>
                    <th style={{ padding: '12px 8px', textAlign: 'right' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recent_runs && stats.recent_runs.length > 0 ? (
                    stats.recent_runs.map((run) => (
                      <tr key={run.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.03)' }}>
                        <td style={{ padding: '12px 8px' }}>#{run.id}</td>
                        <td style={{ padding: '12px 8px', fontWeight: 500 }}>{run.repo_name}</td>
                        <td style={{ padding: '12px 8px' }}>{run.branch}</td>
                        <td style={{ padding: '12px 8px' }}>
                          {run.trigger_type === 'manual' ? '手动' : run.trigger_type === 'schedule' ? '定时' : 'Webhook'}
                        </td>
                        <td style={{ padding: '12px 8px' }}>
                          <span className={`status-badge ${run.status}`}>
                            {run.status === 'running' && <Loader2 className="animate-spin" size={10} />}
                            {run.status === 'success' && <CheckCircle size={10} />}
                            {run.status === 'failed' && <XCircle size={10} />}
                            {run.status}
                          </span>
                        </td>
                        <td style={{ padding: '12px 8px' }}>{formatTime(run.start_time)}</td>
                        <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            <button className="btn btn-secondary btn-small" onClick={() => setActiveExec(run)}>
                              <Terminal size={12} /> 日志
                            </button>
                            {(run.status === 'running' || run.status === 'pending') && (
                              <button className="btn btn-danger btn-small" onClick={() => handleCancelExecution(run.id)}>
                                <Square size={12} /> 停止
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--text-secondary)' }}>
                        暂无任何执行日志记录
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* VIEW 2: REPOS LIST */}
        {currentView === 'repos' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>应用仓库流水线配置</h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>配置单个代码仓的编译脚本、质量门禁检查与定时扫描计划</p>
              </div>
              <button className="btn btn-primary" onClick={() => { setActiveRepo({ branch: 'master', is_active: true }); setShowRepoModal(true); }}>
                <Plus size={16} /> 添加应用仓库
              </button>
            </div>

            {/* Search Box */}
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1, position: 'relative' }}>
                <Search style={{ position: 'absolute', left: 12, top: 12, color: 'var(--text-muted)' }} size={16} />
                <input 
                  type="text" 
                  placeholder="按照项目名称快速模糊搜索..." 
                  style={{ paddingLeft: 40 }}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            {/* Repos Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 20 }}>
              {repos.length > 0 ? (
                repos.map((repo) => (
                  <div key={repo.id} className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <h4 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{repo.name}</h4>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                          {repo.git_url}
                        </span>
                      </div>
                      <span className={`status-badge ${repo.last_run_status}`}>
                        {repo.last_run_status}
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--border-color)', paddingTop: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
                        <GitBranch size={14} />
                        <span>默认构建分支: <strong>{repo.branch}</strong></span>
                      </div>
                      
                      {repo.cron_expr ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
                          <Calendar size={14} />
                          <span>定时计划: <code>{repo.cron_expr}</code> {repo.is_active ? '✅' : '❌'}</span>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-muted)' }}>
                          <Calendar size={14} />
                          <span>未配置定时触发</span>
                        </div>
                      )}

                      {repo.last_run_time && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
                          <Clock size={14} />
                          <span>上次构建时间: {formatTime(repo.last_run_time)}</span>
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: 8, marginTop: 'auto', borderTop: '1px solid var(--border-color)', paddingTop: 12 }}>
                      <button 
                        className="btn btn-primary btn-small" 
                        style={{ flex: 1 }}
                        onClick={() => handleTriggerRepo(repo.id)}
                        disabled={repo.last_run_status === 'running'}
                      >
                        <Play size={12} /> 一键构建
                      </button>
                      <button 
                        className="btn btn-secondary btn-small" 
                        onClick={() => { setActiveRepo(repo); setShowRepoModal(true); }}
                      >
                        <Edit size={12} /> 编辑
                      </button>
                      <button 
                        className="btn btn-secondary btn-small"
                        style={{ color: '#fb7185' }}
                        onClick={() => handleDeleteRepo(repo.id)}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 48, color: 'var(--text-secondary)' }} className="glass-card">
                  没有找到对应的代码仓流水线，请点击“添加应用仓库”
                </div>
              )}
            </div>
          </div>
        )}

        {/* VIEW 3: HISTORY */}
        {currentView === 'history' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>流水线执行历史轨迹</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>全局追溯所有项目代码的编译构建和质量检查输出日志</p>
            </div>

            {/* Filter controls */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ width: 160 }}>
                <select value={historyStatusFilter} onChange={(e) => setHistoryStatusFilter(e.target.value)}>
                  <option value="">所有状态</option>
                  <option value="success">成功 (success)</option>
                  <option value="failed">失败 (failed)</option>
                  <option value="running">执行中 (running)</option>
                  <option value="pending">排队中 (pending)</option>
                  <option value="cancelled">已取消 (cancelled)</option>
                </select>
              </div>

              <div style={{ width: 220 }}>
                <input 
                  type="text" 
                  placeholder="根据仓库ID过滤..." 
                  value={historyRepoFilter}
                  onChange={(e) => setHistoryRepoFilter(e.target.value)}
                />
              </div>

              <button className="btn btn-secondary btn-small" style={{ height: 40 }} onClick={fetchExecutions}>
                <RefreshCw size={14} /> 刷新数据
              </button>
            </div>

            {/* Executions Table */}
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                    <th style={{ padding: '12px 8px' }}>流水线 ID</th>
                    <th style={{ padding: '12px 8px' }}>应用仓库</th>
                    <th style={{ padding: '12px 8px' }}>分支</th>
                    <th style={{ padding: '12px 8px' }}>触发方式</th>
                    <th style={{ padding: '12px 8px' }}>状态</th>
                    <th style={{ padding: '12px 8px' }}>启动时间</th>
                    <th style={{ padding: '12px 8px' }}>持续时间</th>
                    <th style={{ padding: '12px 8px', textAlign: 'right' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {executions.length > 0 ? (
                    executions.map((run) => (
                      <tr key={run.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.03)' }}>
                        <td style={{ padding: '12px 8px' }}>#{run.id}</td>
                        <td style={{ padding: '12px 8px', fontWeight: 500 }}>{run.repo_name}</td>
                        <td style={{ padding: '12px 8px' }}>{run.branch}</td>
                        <td style={{ padding: '12px 8px' }}>
                          {run.trigger_type === 'manual' ? '手动' : run.trigger_type === 'schedule' ? '定时' : 'Webhook'}
                        </td>
                        <td style={{ padding: '12px 8px' }}>
                          <span className={`status-badge ${run.status}`}>
                            {run.status === 'running' && <Loader2 className="animate-spin" size={10} />}
                            {run.status}
                          </span>
                        </td>
                        <td style={{ padding: '12px 8px' }}>{formatTime(run.start_time)}</td>
                        <td style={{ padding: '12px 8px' }}>
                          {run.duration_sec ? `${run.duration_sec} 秒` : '-'}
                        </td>
                        <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            <button className="btn btn-secondary btn-small" onClick={() => setActiveExec(run)}>
                              <Terminal size={12} /> 控制台日志
                            </button>
                            {(run.status === 'running' || run.status === 'pending') && (
                              <button className="btn btn-danger btn-small" onClick={() => handleCancelExecution(run.id)}>
                                <Square size={12} /> 终止
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', padding: 24, color: 'var(--text-secondary)' }}>
                        未查询到符合过滤要求的构建执行记录
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {/* Pagination */}
              {totalExecutions > 10 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 10 }}>
                  <button 
                    className="btn btn-secondary btn-small" 
                    disabled={execPage === 1}
                    onClick={() => setExecPage(prev => Math.max(1, prev - 1))}
                  >
                    上一页
                  </button>
                  <span style={{ alignSelf: 'center', fontSize: 13, color: 'var(--text-secondary)' }}>
                    第 {execPage} 页，共 {Math.ceil(totalExecutions / 10)} 页
                  </span>
                  <button 
                    className="btn btn-secondary btn-small" 
                    disabled={execPage * 10 >= totalExecutions}
                    onClick={() => setExecPage(prev => prev + 1)}
                  >
                    下一页
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* VIEW 4: PIPELINE CONFIG */}
        {currentView === 'pipeline-config' && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>流水线与执行方案配置</h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>配置持续集成流水线，并绑定仓库执行方案，支持同步三方流水线控制台。</p>
              </div>
              <button className="btn btn-primary" onClick={() => { setActivePipeline({ type: '每日构建' }); setShowPipelineModal(true); setPipelineFetchError(''); }}>
                <Plus size={16} /> 新增流水线
              </button>
            </div>

            {/* Search filter */}
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1, position: 'relative' }}>
                <Search style={{ position: 'absolute', left: 12, top: 12, color: 'var(--text-muted)' }} size={16} />
                <input 
                  type="text" 
                  placeholder="按照流水线 ID、名称或分组进行检索..." 
                  style={{ paddingLeft: 40 }}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            {/* Split layout */}
            <div style={{ display: 'flex', gap: 24, flex: 1, minHeight: 480 }}>
              {/* Left Column: Pipelines list */}
              <div style={{ width: '40%', display: 'flex', flexDirection: 'column', gap: 16 }}>
                <h3 style={{ fontSize: 16, fontWeight: 600 }}>流水线配置列表 ({pipelines.length})</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', maxHeight: 'calc(100vh - 280px)', paddingRight: 4 }}>
                  {pipelines.length > 0 ? (
                    pipelines.map((p) => {
                      const isSelected = selectedPipeline && selectedPipeline.id === p.id;
                      return (
                        <div 
                          key={p.id} 
                          className="glass-card" 
                          style={{ 
                            padding: 16, 
                            cursor: 'pointer', 
                            borderLeft: isSelected ? '4px solid #6366f1' : '1px solid var(--border-color)',
                            background: isSelected ? 'rgba(99, 102, 241, 0.08)' : '',
                            transition: 'all 0.2s ease'
                          }}
                          onClick={() => handleSelectPipeline(p)}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>ID: {p.pipeline_id}</span>
                                <span style={{ background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8', fontSize: 10, padding: '1px 5px', borderRadius: 4 }}>{p.type}</span>
                              </div>
                              <h4 style={{ fontSize: 15, fontWeight: 600, marginTop: 4 }}>{p.name}</h4>
                            </div>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button 
                                className="btn btn-secondary btn-small" 
                                style={{ padding: 4 }}
                                onClick={(e) => { e.stopPropagation(); setActivePipeline(p); setShowPipelineModal(true); setPipelineFetchError(''); }}
                              >
                                <Edit size={11} />
                              </button>
                              <button 
                                className="btn btn-secondary btn-small" 
                                style={{ padding: 4, color: '#fb7185' }}
                                onClick={(e) => { e.stopPropagation(); handleDeletePipeline(p.id); }}
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>
                            <span>分组: {p.group_name || '默认组'}</span>
                            <span style={{ maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.description || '暂无详细描述'}</span>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="glass-card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
                      未录入任何流水线数据，请点击右上角进行添加
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Execution Plans Detail Board */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                {selectedPipeline ? (
                  <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', minHeight: 450 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: 16 }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <h3 style={{ fontSize: 16, fontWeight: 700 }}>{selectedPipeline.name}</h3>
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>({selectedPipeline.pipeline_id})</span>
                        </div>
                        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>触发规则: {selectedPipeline.type} | 团队组名: {selectedPipeline.group_name || '默认组'}</p>
                      </div>
                      <button className="btn btn-primary btn-small" onClick={() => { setActivePlan({ pipeline_id: selectedPipeline.id, branch: 'master', languages: '' }); setShowPlanModal(true); }}>
                        <Plus size={13} /> 绑定执行方案
                      </button>
                    </div>

                    <div style={{ flex: 1, overflowY: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                        <thead>
                          <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                            <th style={{ padding: '12px 8px' }}>三方系统方案 ID</th>
                            <th style={{ padding: '12px 8px' }}>代码托管仓</th>
                            <th style={{ padding: '12px 8px' }}>默认分支</th>
                            <th style={{ padding: '12px 8px' }}>编译语言</th>
                            <th style={{ padding: '12px 8px' }}>认证用户</th>
                            <th style={{ padding: '12px 8px', textAlign: 'right' }}>操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {plans.length > 0 ? (
                            plans.map((plan) => (
                              <tr key={plan.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.03)' }}>
                                <td style={{ padding: '12px 8px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
                                  {plan.execution_plan_id || '未绑定'}
                                </td>
                                <td style={{ padding: '12px 8px', fontWeight: 500, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={plan.repository}>
                                  {plan.repository}
                                </td>
                                <td style={{ padding: '12px 8px' }}>{plan.branch}</td>
                                <td style={{ padding: '12px 8px' }}>
                                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                    {plan.languages ? plan.languages.split(',').map((l: string) => (
                                      <span key={l} style={{ background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8', fontSize: 10, padding: '1px 5px', borderRadius: 4 }}>
                                        {l}
                                      </span>
                                    )) : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>未选择</span>}
                                  </div>
                                </td>
                                <td style={{ padding: '12px 8px' }}>{plan.username || '-'}</td>
                                <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                    <button className="btn btn-secondary btn-small" onClick={() => { setActivePlan(plan); setShowPlanModal(true); }}>
                                      <Edit size={11} /> 编辑
                                    </button>
                                    <button className="btn btn-secondary btn-small" style={{ color: '#fb7185' }} onClick={() => handleDeletePlan(plan.id)}>
                                      <Trash2 size={11} />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>
                                暂无仓库绑定的执行方案，请点击右上角绑定代码仓配置
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', flex: 1, minHeight: 450, background: 'rgba(255,255,255,0.01)', borderStyle: 'dashed' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                      <Activity size={32} color="var(--text-muted)" />
                      <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>请在左侧列表中选定一条流水线，以展现和配置其关联仓库的执行方案</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

      </main>

      {/* MODAL 1: ADD/EDIT REPO CONFIG */}
      {showRepoModal && activeRepo && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100 }}>
          <div className="glass-card" style={{ width: '100%', maxWidth: 540, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <h3 style={{ fontSize: 18, fontWeight: 700 }}>
              {activeRepo.id ? '编辑流水线配置' : '添加应用仓库'}
            </h3>

            <form onSubmit={handleSaveRepo} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>项目仓库名称</label>
                <input 
                  type="text" 
                  placeholder="例如: code-shield"
                  value={activeRepo.name || ''} 
                  onChange={(e) => setActiveRepo(prev => ({ ...prev!, name: e.target.value }))}
                  required 
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>Git 远程 URL 或本地路径</label>
                <input 
                  type="text" 
                  placeholder="例如: /home/fugui/codes/code-shield"
                  value={activeRepo.git_url || ''} 
                  onChange={(e) => setActiveRepo(prev => ({ ...prev!, git_url: e.target.value }))}
                  required 
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>默认构建分支</label>
                  <input 
                    type="text" 
                    placeholder="master"
                    value={activeRepo.branch || ''} 
                    onChange={(e) => setActiveRepo(prev => ({ ...prev!, branch: e.target.value }))}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>定时调度 Cron 表达式 (可选)</label>
                  <input 
                    type="text" 
                    placeholder="e.g. 0 2 * * *"
                    value={activeRepo.cron_expr || ''} 
                    onChange={(e) => setActiveRepo(prev => ({ ...prev!, cron_expr: e.target.value }))}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>编译构建指令 (Build Command)</label>
                <input 
                  type="text" 
                  placeholder="例如: make build 或 go build"
                  value={activeRepo.build_cmd || ''} 
                  onChange={(e) => setActiveRepo(prev => ({ ...prev!, build_cmd: e.target.value }))}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>静态检查/测试指令 (Check Command)</label>
                <input 
                  type="text" 
                  placeholder="例如: make lint 或 go test ./..."
                  value={activeRepo.check_cmd || ''} 
                  onChange={(e) => setActiveRepo(prev => ({ ...prev!, check_cmd: e.target.value }))}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <input 
                  type="checkbox" 
                  id="isActive"
                  style={{ width: 'auto' }}
                  checked={activeRepo.is_active || false} 
                  onChange={(e) => setActiveRepo(prev => ({ ...prev!, is_active: e.target.checked }))}
                />
                <label htmlFor="isActive" style={{ fontSize: 14 }}>激活此项目的定时调度任务</label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
                <button type="button" className="btn btn-secondary" onClick={() => { setShowRepoModal(false); setActiveRepo(null); }}>
                  取消
                </button>
                <button type="submit" className="btn btn-primary">
                  保存配置
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: ADD/EDIT PIPELINE CONFIG */}
      {showPipelineModal && activePipeline && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100 }}>
          <div className="glass-card" style={{ width: '100%', maxWidth: 540, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <h3 style={{ fontSize: 18, fontWeight: 700 }}>
              {activePipeline.id ? '编辑流水线元数据' : '录入新流水线'}
            </h3>

            <form onSubmit={handleSavePipeline} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  流水线唯一 ID (Pipeline ID)
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input 
                    type="text" 
                    placeholder="例如: pipeline_demo_01"
                    value={activePipeline.pipeline_id || ''} 
                    onChange={(e) => setActivePipeline((prev: any) => ({ ...prev!, pipeline_id: e.target.value }))}
                    onBlur={() => !activePipeline.id && handleFetchRemotePipelineInfo(activePipeline.pipeline_id)}
                    disabled={!!activePipeline.id}
                    required 
                  />
                  {!activePipeline.id && (
                    <button 
                      type="button" 
                      className="btn btn-secondary btn-small"
                      style={{ flexShrink: 0 }}
                      onClick={() => handleFetchRemotePipelineInfo(activePipeline.pipeline_id)}
                      disabled={isFetchingPipeline || !activePipeline.pipeline_id}
                    >
                      {isFetchingPipeline ? <Loader2 className="animate-spin" size={14} /> : '同步三方名称'}
                    </button>
                  )}
                </div>
                {pipelineFetchError && (
                  <p style={{ fontSize: 12, color: pipelineFetchError.includes('提示') ? '#60a5fa' : '#f87171', marginTop: 4 }}>
                    {pipelineFetchError}
                  </p>
                )}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>流水线名称</label>
                <input 
                  type="text" 
                  placeholder="例如: 每日合并扫描流水线"
                  value={activePipeline.name || ''} 
                  onChange={(e) => setActivePipeline((prev: any) => ({ ...prev!, name: e.target.value }))}
                  required 
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>流水线类型</label>
                  <select 
                    value={activePipeline.type || '每日构建'} 
                    onChange={(e) => setActivePipeline((prev: any) => ({ ...prev!, type: e.target.value }))}
                    required
                  >
                    <option value="每日构建">每日构建</option>
                    <option value="MR">MR (Merge Request 触发)</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>组名称 (GroupName)</label>
                  <input 
                    type="text" 
                    placeholder="例如: 效能研发组"
                    value={activePipeline.group_name || ''} 
                    onChange={(e) => setActivePipeline((prev: any) => ({ ...prev!, group_name: e.target.value }))}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>描述说明</label>
                <textarea 
                  placeholder="请输入流水线的描述与用途..."
                  rows={3}
                  value={activePipeline.description || ''} 
                  onChange={(e) => setActivePipeline((prev: any) => ({ ...prev!, description: e.target.value }))}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
                <button type="button" className="btn btn-secondary" onClick={() => { setShowPipelineModal(false); setActivePipeline(null); setPipelineFetchError(''); }}>
                  取消
                </button>
                <button type="submit" className="btn btn-primary" disabled={isFetchingPipeline}>
                  保存流水线
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: ADD/EDIT EXECUTION PLAN */}
      {showPlanModal && activePlan && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100 }}>
          <div className="glass-card" style={{ width: '100%', maxWidth: 580, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <h3 style={{ fontSize: 18, fontWeight: 700 }}>
              {activePlan.id ? '编辑仓库执行方案' : '新增仓库执行方案'}
            </h3>

            <form onSubmit={handleSavePlan} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>代码托管仓 URL</label>
                <input 
                  type="text" 
                  placeholder="例如: https://github.com/example/repo.git 或本地物理路径"
                  value={activePlan.repository || ''} 
                  onChange={(e) => setActivePlan((prev: any) => ({ ...prev!, repository: e.target.value }))}
                  required 
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>执行构建分支</label>
                  <input 
                    type="text" 
                    placeholder="master / main"
                    value={activePlan.branch || ''} 
                    onChange={(e) => setActivePlan((prev: any) => ({ ...prev!, branch: e.target.value }))}
                    required 
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>三方方案唯一 ID (非必填，自动同步生成)</label>
                  <input 
                    type="text" 
                    placeholder="只读 (三方流水线ID)"
                    value={activePlan.execution_plan_id || ''} 
                    disabled 
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>访问用户名 (Username)</label>
                  <input 
                    type="text" 
                    placeholder="仓密码对应用户名"
                    value={activePlan.username || ''} 
                    onChange={(e) => setActivePlan((prev: any) => ({ ...prev!, username: e.target.value }))}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>访问凭证/密码 (Password)</label>
                  <input 
                    type="password" 
                    placeholder="令牌或账户密码"
                    value={activePlan.password || ''} 
                    onChange={(e) => setActivePlan((prev: any) => ({ ...prev!, password: e.target.value }))}
                  />
                </div>
              </div>

              {/* 多选编程语言 */}
              <div>
                <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  支持的编程语言 (多选)
                </label>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                  {['C/C++', 'Python', 'Java'].map((lang) => {
                    const activeLangs = activePlan.languages ? activePlan.languages.split(',') : [];
                    const checked = activeLangs.includes(lang);
                    return (
                      <label key={lang} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 14 }}>
                        <input 
                          type="checkbox" 
                          checked={checked}
                          style={{ width: 'auto' }}
                          onChange={(e) => {
                            let current = activePlan.languages ? activePlan.languages.split(',') : [];
                            if (e.target.checked) {
                              if (!current.includes(lang)) current.push(lang);
                            } else {
                              current = current.filter((x: string) => x !== lang);
                            }
                            setActivePlan((prev: any) => ({ ...prev!, languages: current.filter(Boolean).join(',') }));
                          }}
                        />
                        {lang}
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>自定义属性 (JSON 格式)</label>
                <textarea 
                  placeholder='例如: { "timeout": 300, "retry": 3 }'
                  rows={3}
                  value={activePlan.custom_attributes || ''} 
                  onChange={(e) => setActivePlan((prev: any) => ({ ...prev!, custom_attributes: e.target.value }))}
                  onBlur={(e) => {
                    const val = e.target.value.trim();
                    if (val && val !== '') {
                      try {
                        JSON.parse(val);
                      } catch (err) {
                        alert('自定义属性非标准 JSON 格式，请检查修改。');
                      }
                    }
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
                <button type="button" className="btn btn-secondary" onClick={() => { setShowPlanModal(false); setActivePlan(null); }}>
                  取消
                </button>
                <button type="submit" className="btn btn-primary">
                  保存方案
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DRAWER: TERMINAL LOG CONSOLE */}
      {activeExec && (
        <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: '45%', minWidth: 500, background: 'rgba(9, 13, 22, 0.95)', borderLeft: '1px solid var(--border-color)', backdropFilter: 'blur(20px)', boxShadow: '-10px 0 30px rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', flexDirection: 'column', animation: 'slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }}>
          <div style={{ padding: 24, borderBottom: '1px solid var(--border-color)', display: 'flex', justifyItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <Terminal size={18} color="#6366f1" />
                <h3 style={{ fontSize: 16, fontWeight: 700 }}>控制台执行日志 #{activeExec.id}</h3>
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>项目: <strong>{activeExec.repo_name}</strong> | 分支: <strong>{activeExec.branch}</strong></p>
            </div>
            <button className="btn btn-secondary btn-small" onClick={() => setActiveExec(null)}>关闭</button>
          </div>

          <div style={{ flex: 1, padding: 24, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Status overview */}
            <div className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>运行状态</span>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{activeExec.status}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>开始时间</span>
                <span style={{ fontSize: 13 }}>{formatTime(activeExec.start_time)}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>运行时长</span>
                <span style={{ fontSize: 13 }}>{activeExec.duration_sec ? `${activeExec.duration_sec} 秒` : '运行中'}</span>
              </div>

              {(activeExec.status === 'running' || activeExec.status === 'pending') && (
                <button className="btn btn-danger btn-small" onClick={() => handleCancelExecution(activeExec.id)}>
                  <Square size={12} /> 停止任务
                </button>
              )}
            </div>

            {/* Error Message if failed */}
            {activeExec.error_msg && (
              <div className="glass-card" style={{ borderLeft: '4px solid #f43f5e', background: 'rgba(244, 63, 94, 0.05)', padding: '12px 16px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, color: '#f43f5e', marginBottom: 4 }}>
                  <AlertCircle size={16} /> 报错中断原因
                </span>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap' }}>
                  {activeExec.error_msg}
                </p>
              </div>
            )}

            {/* Build Log Terminal */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>步骤 1: 编译构建 (Build Outputs)</h4>
              <div className="terminal">
                <div className="terminal-header">
                  <div className="terminal-dots">
                    <div className="terminal-dot dot-red"></div>
                    <div className="terminal-dot dot-yellow"></div>
                    <div className="terminal-dot dot-green"></div>
                  </div>
                  <span>bash -c "{activeExec.build_log ? 'completed' : 'waiting'}"</span>
                </div>
                {activeExec.build_log || '$ (No build logs recorded)'}
              </div>
            </div>

            {/* Check Log Terminal */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>步骤 2: 静态检查/测试 (Check Outputs)</h4>
              <div className="terminal">
                <div className="terminal-header">
                  <div className="terminal-dots">
                    <div className="terminal-dot dot-red"></div>
                    <div className="terminal-dot dot-yellow"></div>
                    <div className="terminal-dot dot-green"></div>
                  </div>
                  <span>bash -c "{activeExec.check_log ? 'completed' : 'waiting'}"</span>
                </div>
                {activeExec.check_log || '$ (No check logs recorded)'}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}



export default App
