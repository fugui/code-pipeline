import React, { useState, useEffect } from 'react'
import { GitBranch, Layers, CheckCircle2, AlertCircle, RefreshCw, Send, Clock, Server } from 'lucide-react'
import { ManagedRepository, ManagedGroup, ManagedBatchBranchLog, BatchRepoResult } from '../types'
import { useToast } from '../components/Toast'

interface ManagedSyncBranchProps {
  isAdmin?: boolean
  apiBase: string
  token: string
}

export const ManagedSyncBranch: React.FC<ManagedSyncBranchProps> = ({ apiBase, token }) => {
  const { showToast } = useToast()
  
  const [repos, setRepos] = useState<ManagedRepository[]>([])
  const [groups, setGroups] = useState<ManagedGroup[]>([])
  const [selectedRepoIDs, setSelectedRepoIDs] = useState<number[]>([])
  const [featureName, setFeatureName] = useState('')
  const [baseBranch, setBaseBranch] = useState('master')
  const [description, setDescription] = useState('')
  
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<number | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [lastResults, setLastResults] = useState<BatchRepoResult[] | null>(null)

  const [logs, setLogs] = useState<ManagedBatchBranchLog[]>([])
  const [loadingLogs, setLoadingLogs] = useState(false)

  // Fetch Repos and Groups
  const fetchMetadata = async () => {
    try {
      const headers = { 'Authorization': `Bearer ${token}` }
      const [reposRes, groupsRes] = await Promise.all([
        fetch(`${apiBase}/managed-repos?include_hidden=false`, { headers }),
        fetch(`${apiBase}/managed-groups`, { headers })
      ])

      if (reposRes.ok) {
        const reposData = await reposRes.json()
        setRepos(reposData)
      }
      if (groupsRes.ok) {
        const groupsData = await groupsRes.json()
        setGroups(groupsData)
      }
    } catch (err) {
      console.error('Failed to fetch metadata:', err)
    }
  }

  // Fetch Batch Branch Logs
  const fetchLogs = async () => {
    setLoadingLogs(true)
    try {
      const res = await fetch(`${apiBase}/managed-repos/batch-branch-logs`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setLogs(data)
      }
    } catch (err) {
      console.error('Failed to fetch logs:', err)
    } finally {
      setLoadingLogs(false)
    }
  }

  useEffect(() => {
    fetchMetadata()
    fetchLogs()
  }, [apiBase, token])

  const filteredRepos = repos.filter(r => {
    if (selectedGroupFilter !== 'all' && r.managed_group_id !== selectedGroupFilter) {
      return false
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      return r.name.toLowerCase().includes(q) || (r.group?.name || '').toLowerCase().includes(q)
    }
    return true
  })

  const handleSelectAll = () => {
    const ids = filteredRepos.map(r => r.id)
    setSelectedRepoIDs(ids)
  }

  const handleDeselectAll = () => {
    setSelectedRepoIDs([])
  }

  const toggleRepoSelection = (id: number) => {
    if (selectedRepoIDs.includes(id)) {
      setSelectedRepoIDs(selectedRepoIDs.filter(i => i !== id))
    } else {
      setSelectedRepoIDs([...selectedRepoIDs, id])
    }
  }

  const handleSubmitBatchBranch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!featureName.trim()) {
      showToast('请输入特性分支名称', 'error')
      return
    }
    if (selectedRepoIDs.length === 0) {
      showToast('请至少勾选一个代码仓', 'error')
      return
    }

    setIsSubmitting(true)
    setLastResults(null)

    try {
      const res = await fetch(`${apiBase}/managed-repos/batch-create-branch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          feature_name: featureName.trim(),
          base_branch: baseBranch.trim() || 'master',
          repo_ids: selectedRepoIDs,
          description: description.trim()
        })
      })

      if (res.ok) {
        const data = await res.json()
        setLastResults(data.results || [])
        showToast(`成功对 ${selectedRepoIDs.length} 个代码仓同步拉起特性分支`, 'success')
        fetchLogs()
      } else {
        const errData = await res.json()
        showToast(`批量拉起特性分支失败: ${errData.error || '未知错误'}`, 'error')
      }
    } catch (err) {
      showToast('网络请求失败', 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header Banner */}
      <div className="glass-card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(99, 102, 241, 0.1)', color: '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Layers size={22} />
          </div>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>跨仓特性分支同步拉起</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
              面向大型跨微服务特性协同，一键在选定的多个代码仓中批量同步拉起同名特性分支。
            </p>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 24 }}>
        {/* Left Column: Config Form & Repo Selection */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <form onSubmit={handleSubmitBatchBranch} className="glass-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0, borderBottom: '1px solid var(--border-color)', paddingBottom: 12 }}>
              1. 特性分支参数配置
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label className="form-label" style={{ fontWeight: 600, display: 'block', marginBottom: 6 }}>
                  特性分支名称 <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input 
                  type="text"
                  className="input"
                  placeholder="例如: feature/202608-payment-upgrade"
                  value={featureName}
                  onChange={e => setFeatureName(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="form-label" style={{ fontWeight: 600, display: 'block', marginBottom: 6 }}>
                  基线分支 (Base Branch)
                </label>
                <input 
                  type="text"
                  className="input"
                  placeholder="例如: master 或 main"
                  value={baseBranch}
                  onChange={e => setBaseBranch(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="form-label" style={{ fontWeight: 600, display: 'block', marginBottom: 6 }}>
                特性关联需求与用途说明 (选填)
              </label>
              <textarea 
                className="input"
                style={{ height: 60, resize: 'vertical' }}
                placeholder="例如: 配合 2026 8 月份统一支付通道升级需求..."
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 600, margin: '10px 0 0', borderBottom: '1px solid var(--border-color)', paddingBottom: 12 }}>
              2. 勾选关联代码仓 ({selectedRepoIDs.length} / {repos.length})
            </h3>

            {/* Filter Bar */}
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <select 
                className="input" 
                style={{ width: 180 }}
                value={selectedGroupFilter}
                onChange={e => setSelectedGroupFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              >
                <option value="all">全部分组 ({groups.length})</option>
                {groups.map(g => (
                  <option key={g.id} value={g.id}>{g.full_path}</option>
                ))}
              </select>

              <input 
                type="text"
                className="input"
                style={{ flex: 1 }}
                placeholder="搜索代码仓名称..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />

              <button type="button" onClick={handleSelectAll} className="btn btn-secondary btn-small">全选当前</button>
              <button type="button" onClick={handleDeselectAll} className="btn btn-secondary btn-small">取消勾选</button>
            </div>

            {/* Repos Grid Selection */}
            <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 8, padding: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
              {filteredRepos.length === 0 ? (
                <div style={{ gridColumn: '1 / -1', padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
                  暂无匹配的代码仓
                </div>
              ) : (
                filteredRepos.map(r => {
                  const isChecked = selectedRepoIDs.includes(r.id)
                  return (
                    <div 
                      key={r.id}
                      onClick={() => toggleRepoSelection(r.id)}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 6,
                        border: isChecked ? '1px solid #6366f1' : '1px solid var(--border-color)',
                        background: isChecked ? 'rgba(99, 102, 241, 0.05)' : 'var(--card-bg)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <input 
                        type="checkbox" 
                        checked={isChecked} 
                        onChange={() => {}}
                        style={{ width: 16, height: 16, cursor: 'pointer' }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.name}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.group?.full_path || '根目录'}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 8 }}>
              <button 
                type="submit" 
                className="btn btn-primary"
                disabled={isSubmitting || selectedRepoIDs.length === 0}
                style={{ padding: '10px 24px', fontSize: 14 }}
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="animate-spin" size={16} /> 正在同步拉起分支...
                  </>
                ) : (
                  <>
                    <Send size={16} /> 一键同步拉起特性分支 ({selectedRepoIDs.length} 个仓)
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Results Panel */}
          {lastResults && (
            <div className="glass-card" style={{ padding: 24 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <CheckCircle2 color="#10b981" size={18} /> 本次拉起结果概览
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {lastResults.map(res => (
                  <div key={res.repo_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 6, background: 'var(--bg-color)', border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Server size={16} color="var(--text-secondary)" />
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{res.repo_name}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {res.status === 'success' ? (
                        <span className="badge badge-success" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <CheckCircle2 size={12} /> 成功
                        </span>
                      ) : (
                        <span className="badge badge-danger" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <AlertCircle size={12} /> {res.message}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Historical Logs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="glass-card" style={{ padding: 20, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Clock size={16} color="#6366f1" /> 历史批量拉起日志
              </h3>
              <button onClick={fetchLogs} className="btn btn-secondary btn-small" title="刷新日志">
                <RefreshCw size={12} className={loadingLogs ? 'animate-spin' : ''} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 600, overflowY: 'auto' }}>
              {logs.length === 0 ? (
                <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
                  暂无批次记录
                </div>
              ) : (
                logs.map(log => {
                  let resultsArr: BatchRepoResult[] = []
                  try {
                    if (log.results) {
                      resultsArr = typeof log.results === 'string' ? JSON.parse(log.results) : (log.results as any)
                    }
                  } catch {}

                  const successCount = resultsArr.filter(r => r.status === 'success').length
                  return (
                    <div key={log.id} style={{ padding: 14, borderRadius: 8, background: 'var(--bg-color)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontWeight: 700, fontSize: 13, color: '#6366f1', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <GitBranch size={14} /> {log.feature_name}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                          {new Date(log.created_at).toLocaleString('zh-CN', { hour12: false })}
                        </span>
                      </div>

                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 12 }}>
                        <span>基线: <code>{log.base_branch || 'master'}</code></span>
                        <span>包含仓: {resultsArr.length} 个 ({successCount} 成功)</span>
                      </div>

                      {log.description && (
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                          "{log.description}"
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
