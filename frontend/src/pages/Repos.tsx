import React, { useState, useEffect } from 'react'
import { Search, GitBranch, Play, Edit, Trash2, ExternalLink, Plus } from 'lucide-react'
import { Repository, ExecutionPlan } from '../types'

interface ReposProps {
  repos: Repository[]
  loading: boolean
  searchQuery: string
  setSearchQuery: (query: string) => void
  onTrigger: (id: number, branch: string) => void
  onAddPlan: (repoId: number) => void
  onEditPlan: (plan: any) => void
  onDeletePlan: (id: number) => void
  token: string | null
  apiBase: string
}

interface BranchStatus {
  has_plan: boolean
  status?: string
  duration_sec?: number
  start_time?: string
  external_log_url?: string
}

export const Repos: React.FC<ReposProps> = ({
  repos,
  loading,
  searchQuery,
  setSearchQuery,
  onTrigger,
  onAddPlan,
  onEditPlan,
  onDeletePlan,
  token,
  apiBase
}) => {
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null)
  const [plans, setPlans] = useState<ExecutionPlan[]>([])
  const [plansLoading, setPlansLoading] = useState(false)
  const [branchStatuses, setBranchStatuses] = useState<Record<string, BranchStatus>>({})

  // 当 repos 列表加载完成且未选中 repo 时，默认选中第一个
  useEffect(() => {
    if (repos.length > 0 && !selectedRepo) {
      setSelectedRepo(repos[0])
    }
  }, [repos, selectedRepo])

  // 当选中的 repo 改变时，拉取该 repo 的执行方案列表
  useEffect(() => {
    if (!selectedRepo || !token) return
    setPlansLoading(true)
    fetch(`${apiBase}/execution-plans?repository_id=${selectedRepo.id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(data => {
      setPlans(data || [])
      setBranchStatuses({}) // 清空旧状态
    })
    .catch(err => console.error('Failed to fetch repo plans', err))
    .finally(() => setPlansLoading(false))
  }, [selectedRepo, token])

  // 针对每一个绑定的方案，拉取最新运行状态
  useEffect(() => {
    if (plans.length === 0 || !selectedRepo || !token) return

    plans.forEach(plan => {
      fetch(`${apiBase}/repos/${selectedRepo.id}/latest-log?branch=${encodeURIComponent(plan.branchs)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      .then(res => res.json())
      .then(data => {
        setBranchStatuses(prev => ({
          ...prev,
          [plan.branchs]: data
        }))
      })
      .catch(err => console.error(`Failed to fetch status for branch ${plan.branchs}`, err))
    })
  }, [plans, selectedRepo, token])

  const formatTime = (isoString?: string) => {
    if (!isoString) return '-'
    const date = new Date(isoString)
    return date.toLocaleString('zh-CN', { hour12: false })
  }

  return (
    <div className="animate-fade-in" style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 20, height: 'calc(100vh - 120px)' }}>
      
      {/* 左侧：仓库卡片列表 */}
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', overflowY: 'auto', padding: 16 }}>
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>代码镜像仓库</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: 12 }}>元数据由 code-bench 只读提供</p>
        </div>

        {/* 搜索 */}
        <div style={{ position: 'relative' }}>
          <Search style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-muted)' }} size={14} />
          <input 
            type="text" 
            placeholder="过滤应用项目名称..." 
            style={{ paddingLeft: 32, fontSize: 13, height: 34 }}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* 卡片列表 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>加载镜像中...</div>
          ) : repos.length > 0 ? (
            repos.map((repo) => {
              const isSelected = selectedRepo?.id === repo.id
              return (
                <div 
                  key={repo.id}
                  className="glass-card"
                  style={{ 
                    padding: '12px 14px', 
                    cursor: 'pointer', 
                    transition: 'all 0.2s',
                    background: isSelected ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                    borderColor: isSelected ? 'var(--primary-color)' : 'var(--border-color)',
                  }}
                  onClick={() => setSelectedRepo(repo)}
                >
                  <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: isSelected ? 'var(--primary-color)' : 'var(--text-primary)' }}>{repo.name}</h4>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>
                    {repo.url}
                  </p>
                </div>
              )
            })
          ) : (
            <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 20 }}>无代码仓数据</div>
          )}
        </div>
      </div>

      {/* 右侧：分支流水线绑定详情 */}
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%', overflowY: 'auto', padding: 24 }}>
        {selectedRepo ? (
          <>
            {/* Header info */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border-color)', paddingBottom: 16 }}>
              <div>
                <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>{selectedRepo.name}</h2>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                  Git URL: {selectedRepo.url}
                </span>
              </div>
              <button 
                className="btn btn-primary btn-small"
                onClick={() => onAddPlan(selectedRepo.id)}
              >
                <Plus size={14} /> 绑定新分支流水线
              </button>
            </div>

            {/* 分支与流水线列表 */}
            <div style={{ flex: 1 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>分支流水线状态看板</h3>

              {plansLoading ? (
                <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>正在加载分支方案...</div>
              ) : plans.length > 0 ? (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid var(--border-color)', textAlign: 'left' }}>
                        <th style={{ padding: '10px 8px', fontSize: 13, color: 'var(--text-secondary)' }}>分支</th>
                        <th style={{ padding: '10px 8px', fontSize: 13, color: 'var(--text-secondary)' }}>语言支持</th>
                        <th style={{ padding: '10px 8px', fontSize: 13, color: 'var(--text-secondary)' }}>最近检查状态</th>
                        <th style={{ padding: '10px 8px', fontSize: 13, color: 'var(--text-secondary)' }}>运行耗时</th>
                        <th style={{ padding: '10px 8px', fontSize: 13, color: 'var(--text-secondary)' }}>执行时间</th>
                        <th style={{ padding: '10px 8px', fontSize: 13, color: 'var(--text-secondary)', width: 140 }}>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plans.map((plan) => {
                        const statusInfo = branchStatuses[plan.branchs] || { has_plan: true, status: 'loading...' }
                        return (
                          <tr key={plan.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                            <td style={{ padding: '12px 8px', fontSize: 14, fontWeight: 500 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <GitBranch size={14} style={{ color: 'var(--primary-color)' }} />
                                <span>{plan.branchs}</span>
                              </div>
                            </td>
                            <td style={{ padding: '12px 8px', fontSize: 13, color: 'var(--text-secondary)' }}>
                              {plan.languages || '-'}
                            </td>
                            <td style={{ padding: '12px 8px' }}>
                              {statusInfo.status === 'loading...' ? (
                                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>查询中...</span>
                              ) : (
                                <span className={`status-badge ${statusInfo.status || 'idle'}`}>
                                  {statusInfo.status || '未运行'}
                                </span>
                              )}
                            </td>
                            <td style={{ padding: '12px 8px', fontSize: 13, color: 'var(--text-secondary)' }}>
                              {statusInfo.duration_sec ? `${statusInfo.duration_sec}秒` : '-'}
                            </td>
                            <td style={{ padding: '12px 8px', fontSize: 13, color: 'var(--text-secondary)' }}>
                              {formatTime(statusInfo.start_time)}
                            </td>
                            <td style={{ padding: '12px 8px' }}>
                              <div style={{ display: 'flex', gap: 8 }}>
                                <button 
                                  className="btn btn-primary btn-small"
                                  style={{ padding: '4px 8px' }}
                                  title="一键触发构建"
                                  onClick={() => onTrigger(selectedRepo.id, plan.branchs)}
                                  disabled={statusInfo.status === 'running'}
                                >
                                  <Play size={10} />
                                </button>
                                <button 
                                  className="btn btn-secondary btn-small"
                                  style={{ padding: '4px 8px' }}
                                  title="修改绑定配置"
                                  onClick={() => onEditPlan(plan)}
                                >
                                  <Edit size={10} />
                                </button>
                                {statusInfo.external_log_url && (
                                  <a 
                                    href={statusInfo.external_log_url}
                                    target="_blank" 
                                    rel="noreferrer"
                                    className="btn btn-secondary btn-small"
                                    style={{ padding: '4px 8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                                    title="查看第三方日志"
                                  >
                                    <ExternalLink size={10} />
                                  </a>
                                )}
                                <button 
                                  className="btn btn-secondary btn-small"
                                  style={{ padding: '4px 8px', color: '#fb7185' }}
                                  title="物理删除绑定"
                                  onClick={() => plan.id && onDeletePlan(plan.id)}
                                >
                                  <Trash2 size={10} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.02)', borderRadius: 8 }}>
                  该应用项目分支下未配置任何流水线执行方案。
                </div>
              )}
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', flex: 1, justifyContent: 'center', alignItems: 'center', color: 'var(--text-secondary)' }}>
            请在左侧选择一个应用项目代码仓以查看流水线状态。
          </div>
        )}
      </div>
    </div>
  )
}
