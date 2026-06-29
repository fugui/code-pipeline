import React, { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { 
  Activity, ShieldAlert, Loader2, LayoutDashboard, GitBranch, LogOut
} from 'lucide-react'

// Import types
import { User, Repository, ExecutionLog, DashboardStats, Pipeline, ExecutionPlan } from './types'

// Import page components
import { Dashboard } from './pages/Dashboard'
import { Repos } from './pages/Repos'
import { PipelineConfig } from './pages/PipelineConfig'

// Import modals
import { PipelineModal } from './components/PipelineModal'
import { ExecutionPlanModal } from './components/ExecutionPlanModal'
import { ExecutionLogModal } from './components/ExecutionLogModal'

const AUTH_TOKEN_KEY = 'code_pipeline_token'

interface AppProps {
  isEmbedded?: boolean
}

const App: React.FC<AppProps> = ({ isEmbedded = false }) => {
  const apiBase = isEmbedded ? '/pipeline/api' : '/api'
  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem('code_shield_token') || localStorage.getItem(AUTH_TOKEN_KEY);
  })
  const [user, setUser] = useState<User | null>(null)
  const [currentView, setCurrentView] = useState<'dashboard' | 'repos' | 'pipeline-config'>('dashboard')
  
  // Data lists
  const [repos, setRepos] = useState<Repository[]>([])
  
  // Pipelines and plans states
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [showPipelineModal, setShowPipelineModal] = useState(false)
  const [activePipeline, setActivePipeline] = useState<Pipeline | null>(null)
  const [pipelineFetchError, setPipelineFetchError] = useState('')
  const [isFetchingPipeline, setIsFetchingPipeline] = useState(false)
  const [selectedPipeline, setSelectedPipeline] = useState<Pipeline | null>(null)
  const [plans, setPlans] = useState<ExecutionPlan[]>([])
  const [showPlanModal, setShowPlanModal] = useState(false)
  const [activePlan, setActivePlan] = useState<ExecutionPlan | null>(null)

  const [stats, setStats] = useState<DashboardStats | null>(null)
  
  // Searching & Filtering
  const [searchQuery, setSearchQuery] = useState('')
  
  // Loading states
  const [loading, setLoading] = useState(false)
  const [meLoading, setMeLoading] = useState(true)
  
  // Modals / Details
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
    } else if (path.endsWith('/dashboard')) {
      setCurrentView('dashboard')
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
    } else if (currentView === 'pipeline-config') {
      fetchPipelines()
      fetchRepos("")
    }
  }, [token, user, currentView, searchQuery])

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
          fetchStats()
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

  const fetchRepos = (search?: string) => {
    const q = search !== undefined ? search : searchQuery
    fetch(`${apiBase}/repos?search=${encodeURIComponent(q)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(data => setRepos(data || []))
    .catch(err => console.error('Failed to fetch repos', err))
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
      if (selectedPipeline && selectedPipeline.id) {
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
      if (selectedPipeline && selectedPipeline.id) {
        fetchPlans(selectedPipeline.id)
      }
    })
    .catch(err => alert(err.message))
  }

  const handleSelectPipeline = (pipeline: Pipeline) => {
    setSelectedPipeline(pipeline)
    if (pipeline.id) {
      fetchPlans(pipeline.id)
    }
  }

  const handleFetchRemotePipelineInfo = (pipelineID: string) => {
    if (!pipelineID) return
    setIsFetchingPipeline(true)
    setPipelineFetchError('')
    fetch(`${apiBase}/pipelines/fetch-info?pipeline_id=${encodeURIComponent(pipelineID)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(async res => {
      if (!res.ok) {
        let errMsg = `HTTP 错误 ${res.status}`
        try {
          const errData = await res.json()
          if (errData && errData.error) {
            errMsg = errData.error
          }
        } catch (e) {
          // 忽略解析错误
        }
        throw new Error(errMsg)
      }
      return res.json()
    })
    .then(data => {
      if (data.is_mock) {
        setPipelineFetchError('提示：未连接 to 真实外部流水线系统，已自动填充 Mock 数据进行兜底。')
      } else {
        setPipelineFetchError('')
      }
      setActivePipeline((prev: any) => ({
        ...prev,
        name: data.name || '',
        type: data.type || '每日构建',
        group_name: data.group_name || '',
        description: data.description || '',
        service_id: data.service_id || '',
        workspace_id: data.workspace_id || '',
        owner: data.owner || '',
        service_name: data.service_name || '',
      }))
    })
    .catch((err) => {
      setPipelineFetchError(`同步外部数据失败: ${err.message || '网络请求错误'}。请确保您已正常登录并具备相关权限，可能需要重新登录 SSO 获取凭证。`)
    })
    .finally(() => {
      setIsFetchingPipeline(false)
    })
  }

  const handleSyncPipeline = (pipeline: Pipeline) => {
    if (!pipeline || !pipeline.pipeline_id) return
    setLoading(true)
    fetch(`${apiBase}/execution-plans/sync?pipeline_id=${encodeURIComponent(pipeline.pipeline_id)}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(async res => {
      if (!res.ok) {
        let errMsg = `HTTP 错误 ${res.status}`
        try {
          const errData = await res.json()
          if (errData && errData.error) errMsg = errData.error
        } catch (e) {}
        throw new Error(errMsg)
      }
      return res.json()
    })
    .then(() => {
      if (pipeline.id) {
        fetchPlans(pipeline.id)
      }
      alert('执行方案同步成功！')
    })
    .catch(err => {
      alert(`同步失败: ${err.message}`)
    })
    .finally(() => {
      setLoading(false)
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
  }

  const handleTriggerRepoPlan = (id: number, branch: string) => {
    fetch(`${apiBase}/repos/${id}/trigger?branch=${encodeURIComponent(branch)}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => {
      if (!res.ok) throw new Error('一键构建触发失败')
      return res.json()
    })
    .then(() => {
      alert('一键构建已成功向第三方系统触发！')
    })
    .catch(err => alert(err.message))
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
      fetchStats()
    })
    .catch(err => alert(err.message))
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
        {currentView === 'dashboard' && (
          <Dashboard 
            stats={stats} 
            onViewExecDetails={setActiveExec} 
            onCancelExecution={handleCancelExecution}
            onRefresh={fetchStats}
          />
        )}

        {/* VIEW 2: REPOS LIST */}
        {currentView === 'repos' && (
          <Repos 
            repos={repos}
            loading={loading}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            onTrigger={handleTriggerRepoPlan}
            onAddPlan={(repoId) => { setActivePlan({ pipeline_id: pipelines[0]?.id || 0, repository_id: repoId, branch: 'master' }); setShowPlanModal(true); }}
            onEditPlan={(plan) => { setActivePlan(plan); setShowPlanModal(true); }}
            onDeletePlan={handleDeletePlan}
            token={token}
            apiBase={apiBase}
          />
        )}



        {/* VIEW 4: PIPELINE CONFIG */}
        {currentView === 'pipeline-config' && (
          <PipelineConfig 
            pipelines={pipelines}
            selectedPipeline={selectedPipeline}
            plans={plans}
            loading={loading}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            onSelectPipeline={handleSelectPipeline}
            onAddPipeline={() => { setActivePipeline({ pipeline_id: '', name: '', type: '每日构建' }); setShowPipelineModal(true); setPipelineFetchError(''); }}
            onEditPipeline={(p) => { setActivePipeline(p); setShowPipelineModal(true); setPipelineFetchError(''); }}
            onDeletePipeline={handleDeletePipeline}
            onAddPlan={() => {
              if (selectedPipeline && selectedPipeline.id) {
                setActivePlan({ pipeline_id: selectedPipeline.id, repository_id: repos[0]?.id || 0, branch: 'master', languages: '' });
                setShowPlanModal(true);
              }
            }}
            onEditPlan={(plan) => { setActivePlan(plan); setShowPlanModal(true); }}
            onDeletePlan={handleDeletePlan}
            onSyncPipeline={handleSyncPipeline}
          />
        )}

      </main>

      {/* Pipeline metadata Modal */}
      <PipelineModal 
        visible={showPipelineModal}
        activePipeline={activePipeline}
        onChange={setActivePipeline}
        onSave={handleSavePipeline}
        onClose={() => { setShowPipelineModal(false); setActivePipeline(null); setPipelineFetchError(''); }}
        isFetchingPipeline={isFetchingPipeline}
        pipelineFetchError={pipelineFetchError}
        onFetchRemoteInfo={handleFetchRemotePipelineInfo}
      />

      {/* Execution Plan Modal */}
      <ExecutionPlanModal 
        visible={showPlanModal}
        activePlan={activePlan}
        onChange={setActivePlan}
        onSave={handleSavePlan}
        onClose={() => { setShowPlanModal(false); setActivePlan(null); }}
        apiBase={apiBase}
        repos={repos}
      />

      {/* Terminal log Console Drawer */}
      <ExecutionLogModal 
        activeExec={activeExec}
        onClose={() => setActiveExec(null)}
        onCancel={handleCancelExecution}
      />
    </div>
  )
}

export default App
