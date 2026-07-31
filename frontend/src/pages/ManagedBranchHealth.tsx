import React, { useState, useEffect } from 'react'
import { Activity, RefreshCw, Send, Trash2, AlertTriangle, CheckCircle2, Server, GitBranch } from 'lucide-react'
import { ManagedRepository } from '../types'
import { useToast } from '../components/Toast'

interface ManagedBranchHealthProps {
  isAdmin?: boolean
  apiBase: string
  token: string
}

export const ManagedBranchHealth: React.FC<ManagedBranchHealthProps> = ({ isAdmin = true, apiBase, token }) => {
  const { showToast } = useToast()
  
  const [repos, setRepos] = useState<ManagedRepository[]>([])
  const [loading, setLoading] = useState(false)

  // Active Audit Details
  const [activeRepoID, setActiveRepoID] = useState<number | null>(null)
  const [branches, setBranches] = useState<any[]>([])
  const [loadingBranches, setLoadingBranches] = useState(false)
  const [selectedBranchNames, setSelectedBranchNames] = useState<string[]>([])
  const [isCleaning, setIsCleaning] = useState(false)

  const fetchRepos = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${apiBase}/managed-repos?include_hidden=false`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setRepos(data)
        if (data.length > 0 && !activeRepoID) {
          setActiveRepoID(data[0].id)
        }
      }
    } catch (err) {
      console.error('Failed to fetch repos:', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchBranchAudit = async (repoID: number) => {
    setLoadingBranches(true)
    try {
      const res = await fetch(`${apiBase}/managed-repos/${repoID}/branches_audit`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setBranches(data)
      }
    } catch (err) {
      console.error('Failed to fetch branch audit:', err)
    } finally {
      setLoadingBranches(false)
    }
  }

  useEffect(() => {
    fetchRepos()
  }, [apiBase, token])

  useEffect(() => {
    if (activeRepoID) {
      fetchBranchAudit(activeRepoID)
    }
  }, [activeRepoID])

  const handleNotifyOwner = async (repoID: number) => {
    try {
      const res = await fetch(`${apiBase}/managed-repos/${repoID}/branches_audit/notify`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (res.ok) {
        showToast('已向代码仓负责人发送沉淀分支清理催办通知', 'success')
      } else {
        showToast('催办通知发送失败', 'error')
      }
    } catch (err) {
      showToast('网络请求失败', 'error')
    }
  }

  const handleCleanupSelected = async () => {
    if (!activeRepoID || selectedBranchNames.length === 0) return

    if (!window.confirm(`确定要物理清理这 ${selectedBranchNames.length} 个已合并分支吗？此操作不可逆！`)) return

    setIsCleaning(true)
    try {
      const res = await fetch(`${apiBase}/managed-repos/${activeRepoID}/branches/cleanup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ branch_names: selectedBranchNames })
      })

      if (res.ok) {
        showToast(`成功清理 ${selectedBranchNames.length} 个分支`, 'success')
        setSelectedBranchNames([])
        fetchBranchAudit(activeRepoID)
        fetchRepos()
      } else {
        const errData = await res.json()
        showToast(`清理失败: ${errData.error || '未知错误'}`, 'error')
      }
    } catch (err) {
      showToast('网络请求失败', 'error')
    } finally {
      setIsCleaning(false)
    }
  }

  const toggleSelectBranch = (bName: string) => {
    if (selectedBranchNames.includes(bName)) {
      setSelectedBranchNames(selectedBranchNames.filter(b => b !== bName))
    } else {
      setSelectedBranchNames([...selectedBranchNames, bName])
    }
  }

  const selectedRepo = repos.find(r => r.id === activeRepoID)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header Banner */}
      <div className="glass-card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Activity size={22} />
          </div>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>分支健康度诊断与沉淀清理</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
              全仓监控未合并僵尸分支 (`unmerged_stale`) 和已合并待清理分支 (`merged_stale`)，支持一键催办田主或物理批量清理。
            </p>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 24 }}>
        {/* Left Column: Repository Selection List */}
        <div className="glass-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>被管代码仓列表</h3>
            <button onClick={fetchRepos} className="btn btn-secondary btn-small" title="刷新">
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 600, overflowY: 'auto' }}>
            {repos.map(repo => {
              const isActive = repo.id === activeRepoID
              const totalStale = (repo.stale_unmerged_count || 0) + (repo.stale_merged_count || 0)
              return (
                <div 
                  key={repo.id}
                  onClick={() => { setActiveRepoID(repo.id); setSelectedBranchNames([]) }}
                  style={{
                    padding: '12px 14px',
                    borderRadius: 8,
                    border: isActive ? '1px solid #6366f1' : '1px solid var(--border-color)',
                    background: isActive ? 'rgba(99, 102, 241, 0.05)' : 'var(--bg-color)',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {repo.name}
                    </span>
                    {totalStale > 0 && (
                      <span className="badge badge-danger" style={{ fontSize: 10, padding: '2px 6px' }}>
                        {totalStale} 待处理
                      </span>
                    )}
                  </div>

                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', gap: 12 }}>
                    <span>分支: {repo.branch_count || 0}</span>
                    <span>已合并沉淀: {repo.stale_merged_count || 0}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Right Column: Branch Audit Details for Selected Repo */}
        <div className="glass-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {selectedRepo ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: 16 }}>
                <div>
                  <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Server size={18} color="#6366f1" /> {selectedRepo.name} 分支健康诊断表
                  </h3>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                    归属组: {selectedRepo.group?.full_path || '根组'} | 主干: <code>master</code>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 10 }}>
                  <button 
                    onClick={() => handleNotifyOwner(selectedRepo.id)} 
                    className="btn btn-secondary btn-small"
                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    <Send size={14} /> 催办代码仓田主
                  </button>

                  {isAdmin && selectedBranchNames.length > 0 && (
                    <button 
                      onClick={handleCleanupSelected}
                      className="btn btn-danger btn-small"
                      disabled={isCleaning}
                      style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      <Trash2 size={14} /> 物理清理已选 ({selectedBranchNames.length})
                    </button>
                  )}
                </div>
              </div>

              {/* Branch List Table */}
              {loadingBranches ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>
                  <RefreshCw className="animate-spin" size={24} style={{ marginBottom: 8 }} />
                  <p style={{ margin: 0 }}>正在诊断仓库分支健康状态...</p>
                </div>
              ) : branches.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>
                  <CheckCircle2 size={32} color="#10b981" style={{ marginBottom: 8 }} />
                  <p style={{ margin: 0, fontSize: 14 }}>该仓库分支非常健康，暂无沉淀僵尸分支！</p>
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="table" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        {isAdmin && <th style={{ width: 40 }}>勾选</th>}
                        <th>分支名称</th>
                        <th>最后提交 Hash</th>
                        <th>最后提交时间</th>
                        <th>最后提交人</th>
                        <th>状态标记</th>
                      </tr>
                    </thead>
                    <tbody>
                      {branches.map((b: any) => {
                        const isChecked = selectedBranchNames.includes(b.branch_name)
                        return (
                          <tr key={b.id}>
                            {isAdmin && (
                              <td>
                                <input 
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => toggleSelectBranch(b.branch_name)}
                                  disabled={!b.is_merged}
                                />
                              </td>
                            )}
                            <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <GitBranch size={14} color="#6366f1" />
                                {b.branch_name}
                              </div>
                            </td>
                            <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-secondary)' }}>
                              {b.last_commit_hash ? b.last_commit_hash.substring(0, 8) : '-'}
                            </td>
                            <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                              {b.last_commit_time ? new Date(b.last_commit_time).toLocaleString('zh-CN', { hour12: false }) : '-'}
                            </td>
                            <td style={{ fontSize: 12 }}>{b.last_author || '-'}</td>
                            <td>
                              {b.status === 'merged_stale' && (
                                <span className="badge badge-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  <AlertTriangle size={12} /> 已合并待清理
                                </span>
                              )}
                              {b.status === 'unmerged_stale' && (
                                <span className="badge badge-danger" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  <AlertTriangle size={12} /> 僵尸未合并
                                </span>
                              )}
                              {b.status === 'active' && (
                                <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  <CheckCircle2 size={12} /> 活跃分支
                                </span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-secondary)' }}>
              请在左侧选择代码仓查看分支健康度诊断
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
