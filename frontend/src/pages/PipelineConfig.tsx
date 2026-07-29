import React, { useState, useMemo, useEffect } from 'react'
import { 
  Plus, 
  Search, 
  Edit, 
  Trash2, 
  RefreshCw, 
  ChevronLeft, 
  ChevronRight, 
  ExternalLink,
  Layers,
  Box,
  GitBranch,
  Filter,
  Code
} from 'lucide-react'
import { Pipeline, ExecutionScheme } from '../types'

export interface PipelineConfigProps {
  isAdmin?: boolean
  apiBase?: string
  token?: string
  pipelines: Pipeline[]
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
  loading = false,
  searchQuery,
  setSearchQuery,
  onAddPipeline,
  onEditPipeline,
  onDeletePipeline,
  onSyncPipeline
}) => {
  const [selectedType, setSelectedType] = useState<string>('ALL')
  const [selectedGroup, setSelectedGroup] = useState<string>('ALL')
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [pageSize, setPageSize] = useState<number>(10)
  const [syncingId, setSyncingId] = useState<number | null>(null)
  const [allSchemes, setAllSchemes] = useState<ExecutionScheme[]>([])

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

  // Get schemes for a specific pipeline
  const getSchemesForPipeline = (p: Pipeline): ExecutionScheme[] => {
    if (p.id && schemesByPipelineId.map.has(p.id)) {
      return schemesByPipelineId.map.get(p.id) || []
    }
    if (p.pipeline_id && schemesByPipelineId.strMap.has(p.pipeline_id)) {
      return schemesByPipelineId.strMap.get(p.pipeline_id) || []
    }
    return []
  }

  // Distinct groups & types for filter dropdowns
  const availableTypes = useMemo(() => {
    const types = new Set<string>()
    pipelines.forEach(p => { if (p.type) types.add(p.type) })
    return Array.from(types)
  }, [pipelines])

  const availableGroups = useMemo(() => {
    const groups = new Set<string>()
    pipelines.forEach(p => { if (p.group_name) groups.add(p.group_name) })
    return Array.from(groups)
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
      totalSchemesBound,
      groupCount: availableGroups.length
    }
  }, [pipelines, availableGroups, allSchemes])

  // Filtered Pipelines
  const filteredPipelines = useMemo(() => {
    return pipelines.filter(p => {
      // Keyword search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const matchId = p.pipeline_id?.toLowerCase().includes(q)
        const matchName = p.name?.toLowerCase().includes(q)
        const matchGroup = p.group_name?.toLowerCase().includes(q)
        const matchService = p.service_name?.toLowerCase().includes(q)
        const matchDesc = p.description?.toLowerCase().includes(q)
        
        // Also match scheme repo or branch
        const pSchemes = getSchemesForPipeline(p)
        const matchScheme = pSchemes.some(s => 
          s.repository?.name?.toLowerCase().includes(q) || 
          s.branchs?.toLowerCase().includes(q)
        )

        if (!matchId && !matchName && !matchGroup && !matchService && !matchDesc && !matchScheme) {
          return false
        }
      }

      // Type filter
      if (selectedType !== 'ALL' && p.type !== selectedType) {
        return false
      }

      // Group filter
      if (selectedGroup !== 'ALL' && (p.group_name || '默认组') !== selectedGroup) {
        return false
      }

      return true
    })
  }, [pipelines, searchQuery, selectedType, selectedGroup, schemesByPipelineId])

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, selectedType, selectedGroup, pageSize])

  // Pagination calculation
  const totalPages = Math.ceil(filteredPipelines.length / pageSize) || 1
  const paginatedPipelines = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return filteredPipelines.slice(start, start + pageSize)
  }, [filteredPipelines, currentPage, pageSize])

  // Handle single sync trigger
  const handleSync = async (p: Pipeline) => {
    if (!onSyncPipeline || !p.id) return
    setSyncingId(p.id)
    try {
      await onSyncPipeline(p)
      await fetchAllSchemes()
    } finally {
      setTimeout(() => setSyncingId(null), 600)
    }
  }

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
          <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>系统配置</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            集中管理持续集成流水线系统参数与基础配置，支持查看、导入、编辑及同步三方流水线控制台。
          </p>
        </div>
        {isAdmin && (
          <button className="btn btn-primary" onClick={onAddPipeline} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Plus size={16} /> 导入流水线
          </button>
        )}
      </div>

      {/* Top Overview Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
        <div className="glass-card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ padding: 12, borderRadius: 10, background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8' }}>
            <Layers size={22} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>流水线总数</div>
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
              {stats.totalSchemesBound} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)' }}>个方案 / {stats.groupCount} 分组</span>
            </div>
          </div>
        </div>
      </div>

      {/* Toolbar & Filters */}
      <div className="glass-card" style={{ padding: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 12, flex: 1, minWidth: 300 }}>
          {/* Keyword search input */}
          <div style={{ position: 'relative', flex: 1 }}>
            <Search style={{ position: 'absolute', left: 12, top: 11, color: 'var(--text-muted)' }} size={16} />
            <input 
              type="text" 
              placeholder="搜索流水线 ID、名称、分组、关联仓库或分支..." 
              style={{ paddingLeft: 40, width: '100%', height: 38, fontSize: 13, borderRadius: 8 }}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

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

          {/* Group dropdown */}
          {availableGroups.length > 0 && (
            <select
              value={selectedGroup}
              onChange={(e) => setSelectedGroup(e.target.value)}
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
              <option value="ALL">全部分组</option>
              {availableGroups.map(g => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          )}
        </div>

        {/* Reset filter button */}
        {(selectedType !== 'ALL' || selectedGroup !== 'ALL' || searchQuery.trim()) && (
          <button 
            className="btn btn-secondary btn-small"
            onClick={() => {
              setSelectedType('ALL')
              setSelectedGroup('ALL')
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
                <th style={{ padding: '14px 16px', fontWeight: 600, width: 130 }}>所属分组</th>
                <th style={{ padding: '14px 16px', fontWeight: 600, minWidth: 200 }}>包含执行方案</th>
                <th style={{ padding: '14px 16px', fontWeight: 600 }}>详细描述</th>
                <th style={{ padding: '14px 16px', fontWeight: 600, textAlign: 'right', width: 140 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-secondary)' }}>
                    <RefreshCw size={24} className="spin" style={{ marginBottom: 12, opacity: 0.7 }} />
                    <div>正在读取流水线配置数据...</div>
                  </td>
                </tr>
              ) : paginatedPipelines.length > 0 ? (
                paginatedPipelines.map((p) => {
                  const badgeStyle = getTypeBadgeStyle(p.type)
                  const isSyncing = syncingId === p.id
                  const pSchemes = getSchemesForPipeline(p)

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
                      <td style={{ padding: '14px 16px', fontWeight: 600, color: 'var(--text-main)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>{p.name}</span>
                          {p.web_url && (
                            <a 
                              href={p.web_url} 
                              target="_blank" 
                              rel="noopener noreferrer" 
                              style={{ color: '#818cf8', display: 'inline-flex', alignItems: 'center', transition: 'color 0.2s' }}
                              title="打开三方流水线控制台"
                            >
                              <ExternalLink size={13} />
                            </a>
                          )}
                        </div>
                      </td>

                      {/* Type */}
                      <td style={{ padding: '14px 16px' }}>
                        <span style={{ ...badgeStyle, fontSize: 11, padding: '2px 8px', borderRadius: 12, fontWeight: 500, display: 'inline-block' }}>
                          {p.type}
                        </span>
                      </td>

                      {/* Group Name */}
                      <td style={{ padding: '14px 16px' }}>
                        <span style={{ background: 'rgba(255, 255, 255, 0.06)', color: 'var(--text-secondary)', fontSize: 12, padding: '2px 8px', borderRadius: 6 }}>
                          {p.group_name || '默认组'}
                        </span>
                      </td>

                      {/* Execution Schemes Column */}
                      <td style={{ padding: '14px 16px', fontSize: 13 }}>
                        {pSchemes.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ 
                                background: 'rgba(56, 189, 248, 0.15)', 
                                color: '#38bdf8', 
                                border: '1px solid rgba(56, 189, 248, 0.3)',
                                fontSize: 11, 
                                fontWeight: 600,
                                padding: '1px 7px', 
                                borderRadius: 10,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4
                              }}>
                                <Code size={11} /> {pSchemes.length} 个执行方案
                              </span>
                            </div>
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                              {pSchemes.slice(0, 2).map((scheme, idx) => (
                                <span key={scheme.id || idx} style={{ fontSize: 11, color: 'var(--text-secondary)', background: 'rgba(255, 255, 255, 0.04)', padding: '1px 6px', borderRadius: 4 }} title={`仓库: ${scheme.repository?.name || scheme.repository_id}, 分支: ${scheme.branchs}`}>
                                  {scheme.repository?.name ? `${scheme.repository.name}` : `仓:${scheme.repository_id}`}
                                  {scheme.branchs ? ` (${scheme.branchs.length > 12 ? scheme.branchs.substring(0, 12) + '...' : scheme.branchs})` : ''}
                                </span>
                              ))}
                              {pSchemes.length > 2 && (
                                <span style={{ fontSize: 11, color: 'var(--text-muted)', padding: '1px 4px' }}>
                                  +{pSchemes.length - 2}
                                </span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>暂无关联方案</span>
                        )}
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
                          {onSyncPipeline && (
                            <button 
                              className="btn btn-secondary btn-small"
                              style={{ padding: '5px 8px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                              onClick={() => handleSync(p)}
                              title="从控制台同步最新数据"
                              disabled={isSyncing}
                            >
                              <RefreshCw size={13} className={isSyncing ? 'spin' : ''} />
                              {isSyncing ? '同步中' : '同步'}
                            </button>
                          )}
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
                                className="btn btn-secondary btn-small" 
                                style={{ padding: '5px 8px', color: '#fb7185' }}
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
                  <td colSpan={7} style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-secondary)' }}>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>未匹配到任何流水线数据</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                      {searchQuery || selectedType !== 'ALL' || selectedGroup !== 'ALL' 
                        ? '请尝试调整筛选条件或重置搜索关键字' 
                        : '暂未录入流水线，请点击右上角【导入流水线】新增配置'}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {filteredPipelines.length > 0 && (
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center', 
            padding: '12px 16px', 
            borderTop: '1px solid var(--border-color)',
            background: 'rgba(255, 255, 255, 0.01)',
            flexWrap: 'wrap',
            gap: 12
          }}>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span>
                显示第 <strong>{(currentPage - 1) * pageSize + 1}</strong> 至 <strong>{Math.min(currentPage * pageSize, filteredPipelines.length)}</strong> 条，共 <strong>{filteredPipelines.length}</strong> 条记录
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>每页显示:</span>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  style={{
                    height: 28,
                    padding: '0 6px',
                    fontSize: 12,
                    borderRadius: 4,
                    background: 'var(--bg-secondary, rgba(255, 255, 255, 0.05))',
                    color: 'var(--text-main)',
                    border: '1px solid var(--border-color)',
                    cursor: 'pointer'
                  }}
                >
                  <option value={10}>10 条</option>
                  <option value={20}>20 条</option>
                  <option value={50}>50 条</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button 
                className="btn btn-secondary btn-small"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                style={{ 
                  padding: '4px 10px', 
                  display: 'inline-flex', 
                  alignItems: 'center', 
                  gap: 4, 
                  fontSize: 12,
                  cursor: currentPage === 1 ? 'not-allowed' : 'pointer', 
                  opacity: currentPage === 1 ? 0.5 : 1 
                }}
              >
                <ChevronLeft size={14} /> 上一页
              </button>
              
              <span style={{ fontSize: 13, color: 'var(--text-secondary)', padding: '0 8px' }}>
                {currentPage} / {totalPages}
              </span>

              <button 
                className="btn btn-secondary btn-small"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                style={{ 
                  padding: '4px 10px', 
                  display: 'inline-flex', 
                  alignItems: 'center', 
                  gap: 4, 
                  fontSize: 12,
                  cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer', 
                  opacity: currentPage >= totalPages ? 0.5 : 1 
                }}
              >
                下一页 <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}


