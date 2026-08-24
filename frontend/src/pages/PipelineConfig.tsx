import React, { useState, useMemo, useEffect } from 'react'
import { Pagination, usePagination } from '@code/common'
import { 
  Plus, 
  Search, 
  Edit, 
  Trash2, 
  RefreshCw, 
  ExternalLink,
  Layers,
  Box,
  GitBranch,
  Filter
} from 'lucide-react'
import { Pipeline, ExecutionScheme, PipelineGroup } from '../types'
import { SyncDiffModal, CalculateDiffResponse } from '../components/SyncDiffModal'

export interface PipelineConfigProps {
  isAdmin?: boolean
  apiBase?: string
  token?: string
  pipelines: Pipeline[]
  pipelineGroups?: PipelineGroup[]
  onRefreshGroups?: () => void
  selectedPipeline?: Pipeline | null
  schemes?: ExecutionScheme[]
  loading?: boolean
  searchQuery: string
  setSearchQuery: (query: string) => void
  onSelectPipeline?: (pipeline: Pipeline) => void
  onAddPipeline: () => void
  onEditPipeline: (pipeline: Pipeline) => void
  onDeletePipeline: (id: number) => void
  onEditScheme?: (scheme: ExecutionScheme) => void
  onDeleteScheme?: (id: number) => void
  onSyncPipeline?: (pipeline: Pipeline) => void
}

export const PipelineConfig: React.FC<PipelineConfigProps> = ({
  isAdmin = true,
  apiBase = '/api',
  token = '',
  pipelines = [],
  pipelineGroups = [],
  onRefreshGroups,
  loading = false,
  searchQuery,
  setSearchQuery,
  onAddPipeline,
  onEditPipeline,
  onDeletePipeline
}) => {
  const [selectedType, setSelectedType] = useState<string>('ALL')
  const [selectedPipelineGroup, setSelectedPipelineGroup] = useState<string>('ALL')
  const { page: currentPage, pageSize, setPage: setCurrentPage } = usePagination({ defaultPageSize: 15 })
  const [allSchemes, setAllSchemes] = useState<ExecutionScheme[]>([])

  // Pipeline Group Modal State
  const [showGroupModal, setShowGroupModal] = useState<boolean>(false)
  const [activeGroup, setActiveGroup] = useState<Partial<PipelineGroup> | null>(null)
  const [savingGroup, setSavingGroup] = useState<boolean>(false)

  // Diff Modal States
  const [diffModalVisible, setDiffModalVisible] = useState<boolean>(false)
  const [diffLoading, setDiffLoading] = useState<boolean>(false)
  const [diffResult, setDiffResult] = useState<CalculateDiffResponse | null>(null)
  const [syncTargetPipeline, setSyncTargetPipeline] = useState<Pipeline | null>(null)

  // Fetch all execution schemes
  const fetchAllSchemes = async () => {
    try {
      const res = await fetch(`${apiBase}/execution-schemes`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      })
      if (res.ok) {
        const data = await res.json()
        setAllSchemes(Array.isArray(data) ? data : [])
      }
    } catch (err) {
      console.error('Failed to fetch all execution schemes', err)
    }
  }

  useEffect(() => {
    fetchAllSchemes()
  }, [apiBase, token])

  // Save Pipeline Group
  const handleSaveGroup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeGroup || !activeGroup.group_key || !activeGroup.name || !activeGroup.type) return
    setSavingGroup(true)
    try {
      const method = activeGroup.id ? 'PUT' : 'POST'
      const url = activeGroup.id ? `${apiBase}/pipeline-groups/${activeGroup.id}` : `${apiBase}/pipeline-groups`
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          ...activeGroup,
          max_schemes_per_pipeline: Number(activeGroup.max_schemes_per_pipeline) || 200
        })
      })
      if (res.ok) {
        setShowGroupModal(false)
        setActiveGroup(null)
        onRefreshGroups && onRefreshGroups()
      } else {
        const err = await res.json().catch(() => ({}))
        alert(`保存流水线组失败: ${err.error || res.statusText}`)
      }
    } catch (err) {
      console.error(err)
      alert('保存流水线组请求异常')
    } finally {
      setSavingGroup(false)
    }
  }

  // Trigger Diff calculation modal
  const handleTriggerSync = async (p: Pipeline) => {
    setSyncTargetPipeline(p)
    setDiffModalVisible(true)
    setDiffLoading(true)
    setDiffResult(null)

    try {
      const res = await fetch(`${apiBase}/execution-schemes/diff?pipeline_id=${encodeURIComponent(p.pipeline_id || p.id || '')}`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      })

      if (res.ok) {
        const data = await res.json()
        setDiffResult(data)
      } else {
        const errData = await res.json().catch(() => ({}))
        alert(`差异计算失败: ${errData.error || res.statusText}`)
        setDiffModalVisible(false)
      }
    } catch (err) {
      console.error('Failed to calculate diff', err)
      alert('计算流水线同步差异失败')
      setDiffModalVisible(false)
    } finally {
      setDiffLoading(false)
    }
  }

  // Confirm Sync Submit
  const handleConfirmSync = async (payload: {
    pipeline_id: number
    add_schemes: any[]
    update_schemes: any[]
    delete_local_ids: number[]
  }) => {
    const res = await fetch(`${apiBase}/execution-schemes/sync-confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify(payload)
    })

    if (res.ok) {
      const data = await res.json()
      alert(data.message || '同步更新已成功应用！')
      await fetchAllSchemes()
    } else {
      const errData = await res.json().catch(() => ({}))
      throw new Error(errData.error || '同步应用失败')
    }
  }

  // Group schemes by pipeline ID
  const schemesByPipelineId = useMemo(() => {
    const map = new Map<number, ExecutionScheme[]>()
    const strMap = new Map<string, ExecutionScheme[]>()

    allSchemes.forEach(s => {
      if (s.pipeline_id) {
        const existing = map.get(s.pipeline_id) || []
        existing.push(s)
        map.set(s.pipeline_id, existing)
      }
      if (s.pipeline?.pipeline_id) {
        const existing = strMap.get(s.pipeline.pipeline_id) || []
        existing.push(s)
        strMap.set(s.pipeline.pipeline_id, existing)
      }
    })

    return { map, strMap }
  }, [allSchemes])

  // Get schemes for a single pipeline
  const getSchemesForPipeline = (p: Pipeline): ExecutionScheme[] => {
    if (p.id && schemesByPipelineId.map.has(p.id)) {
      return schemesByPipelineId.map.get(p.id) || []
    }
    if (p.pipeline_id && schemesByPipelineId.strMap.has(p.pipeline_id)) {
      return schemesByPipelineId.strMap.get(p.pipeline_id) || []
    }
    return []
  }

  // Extract third-party URL
  const getPipelineWebURL = (p: Pipeline): string => {
    if (p.web_url) return p.web_url
    const pSchemes = getSchemesForPipeline(p)
    const schemeWithUrl = pSchemes.find(s => s.pipeline?.web_url)
    return schemeWithUrl?.pipeline?.web_url || ''
  }

  // Distinct groups & types for filter dropdowns
  const availableTypes = useMemo(() => {
    const types = new Set<string>()
    pipelines.forEach(p => { if (p.type) types.add(p.type) })
    return Array.from(types)
  }, [pipelines])

  // Overview Statistics
  const stats = useMemo(() => {
    const total = pipelines.length
    const dailyCount = pipelines.filter(p => p.type === '每日构建').length
    const mrCount = pipelines.filter(p => p.type === 'MR触发' || p.type?.toLowerCase().includes('mr')).length
    const manualCount = pipelines.filter(p => p.type === '手动触发').length
    const totalSchemesBound = allSchemes.length

    return {
      total,
      dailyCount,
      mrCount,
      manualCount,
      totalSchemesBound
    }
  }, [pipelines, allSchemes])

  // Filtered Pipelines
  const filteredPipelines = useMemo(() => {
    return pipelines.filter(p => {
      // Keyword search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const matchId = p.pipeline_id?.toLowerCase().includes(q)
        const matchName = p.name?.toLowerCase().includes(q)
        const matchGroup = p.group_name?.toLowerCase().includes(q)
        const matchGroupName = p.group?.name?.toLowerCase().includes(q)
        const matchService = p.service_name?.toLowerCase().includes(q)
        const matchDesc = p.description?.toLowerCase().includes(q)
        
        // Also match scheme repo or branch
        const pSchemes = getSchemesForPipeline(p)
        const matchScheme = pSchemes.some(s => 
          s.repository?.name?.toLowerCase().includes(q) || 
          s.branchs?.toLowerCase().includes(q)
        )

        if (!matchId && !matchName && !matchGroup && !matchGroupName && !matchService && !matchDesc && !matchScheme) {
          return false
        }
      }

      // Type filter
      if (selectedType !== 'ALL' && p.type !== selectedType) {
        return false
      }

      // Pipeline Group filter
      if (selectedPipelineGroup !== 'ALL') {
        if (selectedPipelineGroup === 'NONE') {
          if (p.group_id) return false
        } else {
          if (String(p.group_id) !== selectedPipelineGroup) return false
        }
      }

      return true
    })
  }, [pipelines, searchQuery, selectedType, selectedPipelineGroup, schemesByPipelineId])

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, selectedType, selectedPipelineGroup, pageSize])

  // Pagination calculation
  const paginatedPipelines = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return filteredPipelines.slice(start, start + pageSize)
  }, [filteredPipelines, currentPage, pageSize])

  // Type badge styling helper
  const getTypeBadgeStyle = (type: string) => {
    switch (type) {
      case '每日构建':
        return { background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8', border: '1px solid rgba(99, 102, 241, 0.3)' }
      case 'MR触发':
        return { background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.3)' }
      case '手动触发':
        return { background: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', border: '1px solid rgba(245, 158, 11, 0.3)' }
      default:
        return { background: 'rgba(148, 163, 184, 0.15)', color: '#cbd5e1', border: '1px solid rgba(148, 163, 184, 0.3)' }
    }
  }

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>构建与流水线管理</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            集中管理流水线组（资源池）与底层物理流水线节点，支持按容量智能调度与负载均衡。
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {isAdmin && (
            <button 
              className="btn btn-secondary" 
              onClick={() => {
                setActiveGroup({
                  group_key: '',
                  name: '',
                  type: 'MR',
                  max_schemes_per_pipeline: 200,
                  is_active: true,
                  description: ''
                })
                setShowGroupModal(true)
              }} 
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Plus size={16} /> 新建流水线组
            </button>
          )}
          {isAdmin && (
            <button className="btn btn-primary" onClick={onAddPipeline} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Plus size={16} /> 导入物理流水线
            </button>
          )}
        </div>
      </div>

      {/* 流水线组 (资源池) 总览卡片 */}
      {pipelineGroups.length > 0 && (
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Layers size={16} style={{ color: 'var(--accent-primary, #6366f1)' }} />
            <span>流水线组资源池容量概览 (Pipeline Groups)</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
            {pipelineGroups.map(g => {

              return (
                <div 
                  key={g.id} 
                  className="glass-card" 
                  style={{ 
                    padding: '16px 20px', 
                    display: 'flex', 
                    flexDirection: 'column', 
                    gap: 12,
                    border: selectedPipelineGroup === String(g.id) ? '1px solid var(--accent-primary, #6366f1)' : '1px solid var(--border-color)',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onClick={() => setSelectedPipelineGroup(selectedPipelineGroup === String(g.id) ? 'ALL' : String(g.id))}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-main)' }}>{g.name}</span>
                        <span style={{ 
                          fontSize: 11, 
                          padding: '2px 6px', 
                          borderRadius: 4, 
                          background: g.type === 'MR' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(99, 102, 241, 0.15)',
                          color: g.type === 'MR' ? '#34d399' : '#818cf8',
                          fontWeight: 500
                        }}>
                          {g.type}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                        {g.group_key}
                      </div>
                    </div>
                    {isAdmin && (
                      <button
                        className="btn btn-secondary btn-small"
                        style={{ padding: '4px 8px', fontSize: 12 }}
                        onClick={(e) => {
                          e.stopPropagation()
                          setActiveGroup(g)
                          setShowGroupModal(true)
                        }}
                      >
                        <Edit size={13} />
                      </button>
                    )}
                  </div>

                  {/* 方案占用概览 */}
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    已挂载方案: <strong style={{ color: 'var(--text-main)', fontSize: 15 }}>{g.used_schemes || 0}</strong> 个
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
                    <span>组内物理节点: <strong>{g.pipeline_count || 0}</strong> 条</span>
                    {selectedPipelineGroup === String(g.id) && (
                      <span style={{ color: 'var(--accent-primary, #6366f1)', fontWeight: 600 }}>已筛选</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Top Overview Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
        <div className="glass-card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ padding: 12, borderRadius: 10, background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8' }}>
            <Layers size={22} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>物理流水线总数</div>
            <div style={{ fontSize: 24, fontWeight: 700, marginTop: 2 }}>{stats.total} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)' }}>条配置</span></div>
          </div>
        </div>

        <div className="glass-card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ padding: 12, borderRadius: 10, background: 'rgba(16, 185, 129, 0.15)', color: '#34d399' }}>
            <Box size={22} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>构建类型分布</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              <span style={{ background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8', fontSize: 11, padding: '2px 6px', borderRadius: 4 }}>
                每日 {stats.dailyCount}
              </span>
              <span style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', fontSize: 11, padding: '2px 6px', borderRadius: 4 }}>
                MR {stats.mrCount}
              </span>
              {stats.manualCount > 0 && (
                <span style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', fontSize: 11, padding: '2px 6px', borderRadius: 4 }}>
                  手动 {stats.manualCount}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="glass-card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ padding: 12, borderRadius: 10, background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8' }}>
            <GitBranch size={22} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>绑定执行方案数</div>
            <div style={{ fontSize: 24, fontWeight: 700, marginTop: 2 }}>
              {stats.totalSchemesBound} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)' }}>个方案</span>
            </div>
          </div>
        </div>
      </div>

      {/* Toolbar & Filters */}
      <div className="glass-card" style={{ padding: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 12, flex: 1, minWidth: 300, flexWrap: 'wrap' }}>
          {/* Keyword search input */}
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search style={{ position: 'absolute', left: 12, top: 11, color: 'var(--text-muted)' }} size={16} />
            <input 
              type="text" 
              placeholder="搜索流水线 ID、名称、所属组或关联方案..." 
              style={{ paddingLeft: 40, width: '100%', height: 38, fontSize: 13, borderRadius: 8 }}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Pipeline Group dropdown filter */}
          {pipelineGroups.length > 0 && (
            <select
              value={selectedPipelineGroup}
              onChange={(e) => setSelectedPipelineGroup(e.target.value)}
              style={{ 
                height: 38, 
                padding: '0 12px', 
                fontSize: 13, 
                borderRadius: 8, 
                background: 'var(--bg-secondary, rgba(255, 255, 255, 0.05))',
                color: 'var(--text-main)',
                border: '1px solid var(--border-color)',
                cursor: 'pointer'
              }}
            >
              <option value="ALL">全部流水线组</option>
              {pipelineGroups.map(g => (
                <option key={g.id} value={String(g.id)}>{g.name} [{g.type}]</option>
              ))}
              <option value="NONE">未归组流水线</option>
            </select>
          )}

          {/* Type dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Filter size={14} style={{ color: 'var(--text-muted)' }} />
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              style={{ 
                height: 38, 
                padding: '0 12px', 
                fontSize: 13, 
                borderRadius: 8, 
                background: 'var(--bg-secondary, rgba(255, 255, 255, 0.05))',
                color: 'var(--text-main)',
                border: '1px solid var(--border-color)',
                cursor: 'pointer'
              }}
            >
              <option value="ALL">全部触发类型</option>
              {availableTypes.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Reset filter button */}
        {(selectedType !== 'ALL' || selectedPipelineGroup !== 'ALL' || searchQuery.trim()) && (
          <button 
            className="btn btn-secondary btn-small"
            onClick={() => {
              setSelectedType('ALL')
              setSelectedPipelineGroup('ALL')
              setSearchQuery('')
            }}
            style={{ fontSize: 12, height: 38 }}
          >
            重置筛选
          </button>
        )}
      </div>

      {/* Main Full-Width Data Table */}
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 400, overflow: 'hidden' }}>
        <div style={{ flex: 1, overflowX: 'auto', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', background: 'rgba(255, 255, 255, 0.02)', color: 'var(--text-secondary)' }}>
                <th style={{ padding: '14px 16px', fontWeight: 600, width: 130 }}>流水线 ID</th>
                <th style={{ padding: '14px 16px', fontWeight: 600, minWidth: 200 }}>流水线名称</th>
                <th style={{ padding: '14px 16px', fontWeight: 600, width: 120 }}>触发类型</th>
                <th style={{ padding: '14px 16px', fontWeight: 600, width: 150 }}>所属流水线组</th>
                <th style={{ padding: '14px 16px', fontWeight: 600, width: 100 }}>节点状态</th>
                <th style={{ padding: '14px 16px', fontWeight: 600, width: 110 }}>执行方案数</th>
                <th style={{ padding: '14px 16px', fontWeight: 600 }}>详细描述</th>
                <th style={{ padding: '14px 16px', fontWeight: 600, textAlign: 'right', width: 140 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-secondary)' }}>
                    <RefreshCw size={24} className="spin" style={{ marginBottom: 12, opacity: 0.7 }} />
                    <div>正在读取流水线配置数据...</div>
                  </td>
                </tr>
              ) : paginatedPipelines.length > 0 ? (
                paginatedPipelines.map((p) => {
                  const badgeStyle = getTypeBadgeStyle(p.type)
                  const pSchemes = getSchemesForPipeline(p)
                  const webURL = getPipelineWebURL(p)
                  const groupObj = p.group || pipelineGroups.find(g => g.id === p.group_id)

                  return (
                    <tr 
                      key={p.id || p.pipeline_id} 
                      style={{ 
                        borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                        transition: 'background-color 0.15s ease'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.025)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      {/* Pipeline ID */}
                      <td style={{ padding: '14px 16px', fontFamily: 'var(--font-mono)', fontSize: 13, color: '#a5b4fc', fontWeight: 500 }}>
                        <span style={{ background: 'rgba(99, 102, 241, 0.1)', padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(99, 102, 241, 0.2)' }}>
                          {p.pipeline_id}
                        </span>
                      </td>

                      {/* Name */}
                      <td style={{ padding: '14px 16px', fontWeight: 600 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {webURL ? (
                            <a 
                              href={webURL} 
                              target="_blank" 
                              rel="noopener noreferrer" 
                              style={{ 
                                color: 'var(--text-main)', 
                                textDecoration: 'none', 
                                transition: 'color 0.2s', 
                                display: 'inline-flex', 
                                alignItems: 'center', 
                                gap: 6 
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.color = '#6366f1'
                                e.currentTarget.style.textDecoration = 'underline'
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.color = 'var(--text-main)'
                                e.currentTarget.style.textDecoration = 'none'
                              }}
                              title="点击快速跳转至三方流水线控制台"
                            >
                              <span>{p.name}</span>
                              <ExternalLink size={13} style={{ color: '#6366f1', opacity: 0.8, flexShrink: 0 }} />
                            </a>
                          ) : (
                            <span style={{ color: 'var(--text-main)' }}>{p.name}</span>
                          )}
                        </div>
                      </td>

                      {/* Type */}
                      <td style={{ padding: '14px 16px' }}>
                        <span style={{ ...badgeStyle, fontSize: 11, padding: '2px 8px', borderRadius: 12, fontWeight: 500, display: 'inline-block' }}>
                          {p.type}
                        </span>
                      </td>

                      {/* Pipeline Group */}
                      <td style={{ padding: '14px 16px' }}>
                        {groupObj ? (
                          <span style={{ background: 'rgba(99, 102, 241, 0.12)', color: '#818cf8', fontSize: 12, padding: '3px 8px', borderRadius: 6, fontWeight: 500 }}>
                            {groupObj.name}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>未归组</span>
                        )}
                      </td>

                      {/* Status */}
                      <td style={{ padding: '14px 16px' }}>
                        <span style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', fontSize: 11, padding: '2px 8px', borderRadius: 12, fontWeight: 500 }}>
                          活跃中
                        </span>
                      </td>

                      {/* Execution Schemes Column */}
                      <td style={{ padding: '14px 16px', fontSize: 14, fontWeight: 500, color: pSchemes.length > 0 ? 'var(--text-main)' : 'var(--text-muted)' }}>
                        {pSchemes.length}
                      </td>

                      {/* Description */}
                      <td style={{ padding: '14px 16px', color: 'var(--text-secondary)', fontSize: 13, maxWidth: 260 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.description}>
                          {p.description || '暂无描述信息'}
                        </div>
                      </td>

                      {/* Actions */}
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                          <button 
                            className="btn btn-secondary btn-small"
                            style={{ padding: '5px 8px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                            onClick={() => handleTriggerSync(p)}
                            title="比对并同步最新三方配置"
                          >
                            <RefreshCw size={13} />
                            同步
                          </button>
                          {isAdmin && (
                            <>
                              <button 
                                className="btn btn-secondary btn-small" 
                                style={{ padding: '5px 8px' }}
                                onClick={() => onEditPipeline(p)}
                                title="编辑流水线"
                              >
                                <Edit size={13} />
                              </button>
                              <button 
                                className="btn btn-danger btn-small" 
                                style={{ padding: '5px 8px' }}
                                onClick={() => p.id && onDeletePipeline(p.id)}
                                title="删除流水线"
                              >
                                <Trash2 size={13} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-secondary)' }}>
                    <Box size={24} style={{ marginBottom: 12, opacity: 0.5 }} />
                    <div>未找到匹配的流水线配置记录</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {filteredPipelines.length > 0 && (
          <div style={{ padding: '0 1rem 1rem 1rem' }}>
            <Pagination 
              totalItems={filteredPipelines.length} 
              defaultPageSize={15} 
            />
          </div>
        )}
      </div>

      {/* Pipeline Group Create / Edit Modal */}
      {showGroupModal && activeGroup && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.65)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: 20
        }}>
          <div className="glass-card" style={{ width: '100%', maxWidth: 500, padding: 24, borderRadius: 12 }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>
              {activeGroup.id ? '编辑流水线组' : '新建流水线组 (资源池)'}
            </h3>
            <form onSubmit={handleSaveGroup} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  组唯一标识 (Group Key) <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="text"
                  placeholder="例如: mr-gate-default"
                  value={activeGroup.group_key || ''}
                  onChange={(e) => setActiveGroup({ ...activeGroup, group_key: e.target.value })}
                  disabled={!!activeGroup.id}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  流水线组展示名称 <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="text"
                  placeholder="例如: 默认 MR 门禁流水线组"
                  value={activeGroup.name || ''}
                  onChange={(e) => setActiveGroup({ ...activeGroup, name: e.target.value })}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    触发类型
                  </label>
                  <select
                    value={activeGroup.type || 'MR'}
                    onChange={(e) => setActiveGroup({ ...activeGroup, type: e.target.value })}
                  >
                    <option value="MR">MR 门禁</option>
                    <option value="每日构建">每日构建</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    单节点方案容量上限
                  </label>
                  <input
                    type="number"
                    min={10}
                    max={1000}
                    value={activeGroup.max_schemes_per_pipeline || 200}
                    onChange={(e) => setActiveGroup({ ...activeGroup, max_schemes_per_pipeline: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  描述说明
                </label>
                <textarea
                  rows={3}
                  placeholder="请输入该流水线组的功能用途与承载说明..."
                  value={activeGroup.description || ''}
                  onChange={(e) => setActiveGroup({ ...activeGroup, description: e.target.value })}
                  style={{ resize: 'vertical' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowGroupModal(false)}
                  disabled={savingGroup}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={savingGroup}
                >
                  {savingGroup ? '正在保存...' : '确认保存'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Sync Diff Modal */}
      <SyncDiffModal 
        visible={diffModalVisible}
        pipeline={syncTargetPipeline}
        loading={diffLoading}
        diffResult={diffResult}
        apiBase={apiBase}
        onClose={() => setDiffModalVisible(false)}
        onRefreshDiff={() => { if (syncTargetPipeline) return handleTriggerSync(syncTargetPipeline) }}
        onConfirmSync={handleConfirmSync}
      />
    </div>
  )
}


