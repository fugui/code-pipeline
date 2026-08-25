import React, { useState, useMemo, useEffect } from 'react'
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
  Filter,
  ChevronRight,
  ChevronDown,
  FolderPlus,
  LogOut,
  AlertCircle,
  CheckCircle2,
  FolderTree,
  Unlink
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
  onRefreshPipelines?: () => void
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
  onRefreshPipelines,
  loading = false,
  searchQuery,
  setSearchQuery,
  onAddPipeline,
  onEditPipeline,
  onDeletePipeline
}) => {
  const [selectedType, setSelectedType] = useState<string>('ALL')
  const [allSchemes, setAllSchemes] = useState<ExecutionScheme[]>([])

  // 展开折叠状态管理
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<number>>(new Set())
  const [unassignedExpanded, setUnassignedExpanded] = useState<boolean>(true)

  // 流水线组新建 / 编辑弹窗
  const [showGroupModal, setShowGroupModal] = useState<boolean>(false)
  const [activeGroup, setActiveGroup] = useState<Partial<PipelineGroup> | null>(null)
  const [savingGroup, setSavingGroup] = useState<boolean>(false)

  // 批量关联流水线到组弹窗 (从组发起)
  const [attachModalGroup, setAttachModalGroup] = useState<PipelineGroup | null>(null)
  const [selectedPipelineIdsToAttach, setSelectedPipelineIdsToAttach] = useState<number[]>([])
  const [attaching, setAttaching] = useState<boolean>(false)

  // 单条流水线加入组弹窗 (从未纳入分组发起)
  const [joinModalPipeline, setJoinModalPipeline] = useState<Pipeline | null>(null)
  const [targetGroupIdToJoin, setTargetGroupIdToJoin] = useState<number | ''>('')
  const [joining, setJoining] = useState<boolean>(false)

  // Diff Modal States
  const [diffModalVisible, setDiffModalVisible] = useState<boolean>(false)
  const [diffLoading, setDiffLoading] = useState<boolean>(false)
  const [diffResult, setDiffResult] = useState<CalculateDiffResponse | null>(null)
  const [syncTargetPipeline, setSyncTargetPipeline] = useState<Pipeline | null>(null)

  // 获取所有执行方案
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

  // 初始化展开所有有数据的流水线组
  useEffect(() => {
    if (pipelineGroups.length > 0) {
      setExpandedGroupIds(new Set(pipelineGroups.map(g => g.id)))
    }
  }, [pipelineGroups.length])

  // 方案映射
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

  const getSchemesForPipeline = (p: Pipeline): ExecutionScheme[] => {
    if (p.id && schemesByPipelineId.map.has(p.id)) {
      return schemesByPipelineId.map.get(p.id) || []
    }
    if (p.pipeline_id && schemesByPipelineId.strMap.has(p.pipeline_id)) {
      return schemesByPipelineId.strMap.get(p.pipeline_id) || []
    }
    return []
  }

  const getPipelineWebURL = (p: Pipeline): string => {
    if (p.web_url) return p.web_url
    const pSchemes = getSchemesForPipeline(p)
    const schemeWithUrl = pSchemes.find(s => s.pipeline?.web_url)
    return schemeWithUrl?.pipeline?.web_url || ''
  }

  // 触发类型选项
  const availableTypes = useMemo(() => {
    const types = new Set<string>()
    pipelineGroups.forEach(g => { if (g.type) types.add(g.type) })
    pipelines.forEach(p => { if (p.type) types.add(p.type) })
    return Array.from(types)
  }, [pipelineGroups, pipelines])

  // 汇总统计指标
  const stats = useMemo(() => {
    const totalPipelines = pipelines.length
    const totalGroups = pipelineGroups.length
    const assignedCount = pipelines.filter(p => p.group_id && p.group_id > 0).length
    const unassignedCount = totalPipelines - assignedCount
    const totalSchemes = allSchemes.length

    return {
      totalPipelines,
      totalGroups,
      assignedCount,
      unassignedCount,
      totalSchemes
    }
  }, [pipelines, pipelineGroups, allSchemes])

  // 流水线匹配过滤判断函数
  const isPipelineMatched = (p: Pipeline, query: string, typeFilter: string) => {
    if (typeFilter !== 'ALL' && p.type !== typeFilter) return false
    if (!query) return true

    const q = query.toLowerCase()
    const matchId = p.pipeline_id?.toLowerCase().includes(q)
    const matchName = p.name?.toLowerCase().includes(q)
    const matchService = p.service_name?.toLowerCase().includes(q)
    const matchDesc = p.description?.toLowerCase().includes(q)
    const matchOwner = p.owner_name?.toLowerCase().includes(q)

    const pSchemes = getSchemesForPipeline(p)
    const matchScheme = pSchemes.some(s => 
      s.repository?.name?.toLowerCase().includes(q) || 
      s.branchs?.toLowerCase().includes(q)
    )

    return matchId || matchName || matchService || matchDesc || matchOwner || matchScheme
  }

  // 计算每个组及其过滤后的流水线
  const groupedData = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()

    return pipelineGroups.map(g => {
      // 组内所有流水线
      const groupPipelines = pipelines.filter(p => p.group_id === g.id)
      
      // 过滤后的流水线
      const matchedPipelines = groupPipelines.filter(p => isPipelineMatched(p, q, selectedType))

      // 组自身是否匹配搜索与类型
      const matchType = selectedType === 'ALL' || g.type === selectedType
      const matchGroupSelf = !q || g.name?.toLowerCase().includes(q) || g.group_key?.toLowerCase().includes(q) || g.description?.toLowerCase().includes(q)

      const isGroupVisible = (matchType && matchGroupSelf) || matchedPipelines.length > 0

      // 计算该组挂载的方案总数
      const totalSchemesInGroup = groupPipelines.reduce((acc, p) => acc + getSchemesForPipeline(p).length, 0)

      return {
        group: g,
        allPipelines: groupPipelines,
        matchedPipelines,
        totalSchemesInGroup,
        isVisible: isGroupVisible,
        hasChildMatch: matchedPipelines.length > 0
      }
    })
  }, [pipelineGroups, pipelines, searchQuery, selectedType, schemesByPipelineId])

  // 当搜索框输入时，自动展开有匹配子项的组
  useEffect(() => {
    if (searchQuery.trim()) {
      const newExpanded = new Set(expandedGroupIds)
      groupedData.forEach(item => {
        if (item.hasChildMatch) {
          newExpanded.add(item.group.id)
        }
      })
      setExpandedGroupIds(newExpanded)
    }
  }, [searchQuery, groupedData])

  // 未纳入分组的流水线列表
  const unassignedPipelinesData = useMemo(() => {
    const unassigned = pipelines.filter(p => !p.group_id || p.group_id === 0)
    const q = searchQuery.trim().toLowerCase()
    const matched = unassigned.filter(p => isPipelineMatched(p, q, selectedType))
    return {
      all: unassigned,
      matched,
      isVisible: matched.length > 0 || (!q && selectedType === 'ALL' && unassigned.length > 0)
    }
  }, [pipelines, searchQuery, selectedType, schemesByPipelineId])

  // 切换组展开折叠
  const toggleGroupExpand = (groupId: number) => {
    setExpandedGroupIds(prev => {
      const next = new Set(prev)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }

  // 保存流水线组 (新建 / 编辑)
  const handleSaveGroup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeGroup || !activeGroup.group_key || !activeGroup.name) return
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
          group_key: activeGroup.group_key,
          name: activeGroup.name,
          is_active: activeGroup.is_active ?? true,
          description: activeGroup.description || ''
        })
      })
      if (res.ok) {
        setShowGroupModal(false)
        setActiveGroup(null)
        onRefreshGroups && onRefreshGroups()
        onRefreshPipelines && onRefreshPipelines()
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

  // 删除流水线组
  const handleDeleteGroup = async (group: PipelineGroup) => {
    const pipelinesInThisGroup = pipelines.filter(p => p.group_id === group.id)
    if (pipelinesInThisGroup.length > 0) {
      alert(`无法删除流水线组 "${group.name}": 组内仍有 ${pipelinesInThisGroup.length} 条物理流水线，请先将流水线移出组后再删除。`)
      return
    }

    if (!confirm(`确定要删除流水线组 "${group.name}" 吗？此操作不可撤销。`)) {
      return
    }

    try {
      const res = await fetch(`${apiBase}/pipeline-groups/${group.id}`, {
        method: 'DELETE',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      })
      if (res.ok) {
        onRefreshGroups && onRefreshGroups()
        onRefreshPipelines && onRefreshPipelines()
      } else {
        const err = await res.json().catch(() => ({}))
        alert(`删除流水线组失败: ${err.error || res.statusText}`)
      }
    } catch (err) {
      console.error(err)
      alert('删除流水线组请求异常')
    }
  }

  // 打开从组发起的关联流水线弹窗
  const handleOpenAttachModal = (group: PipelineGroup) => {
    setAttachModalGroup(group)
    setSelectedPipelineIdsToAttach([])
  }

  // 提交关联流水线入组
  const handleConfirmAttach = async () => {
    if (!attachModalGroup || selectedPipelineIdsToAttach.length === 0) return
    setAttaching(true)
    try {
      const res = await fetch(`${apiBase}/pipeline-groups/${attachModalGroup.id}/pipelines`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          pipeline_ids: selectedPipelineIdsToAttach,
          action: 'attach'
        })
      })

      if (res.ok) {
        setAttachModalGroup(null)
        setSelectedPipelineIdsToAttach([])
        onRefreshGroups && onRefreshGroups()
        onRefreshPipelines && onRefreshPipelines()
      } else {
        const err = await res.json().catch(() => ({}))
        alert(`关联流水线入组失败: ${err.error || res.statusText}`)
      }
    } catch (err) {
      console.error(err)
      alert('关联流水线请求异常')
    } finally {
      setAttaching(false)
    }
  }

  // 移出流水线出组
  const handleDetachPipeline = async (pipeline: Pipeline) => {
    if (!pipeline.group_id) return
    if (!confirm(`确定要将流水线 "${pipeline.name}" 移出当前流水线组吗？移出后它将变为未纳入分组状态。`)) {
      return
    }

    try {
      const res = await fetch(`${apiBase}/pipeline-groups/${pipeline.group_id}/pipelines`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          pipeline_ids: [pipeline.id],
          action: 'detach'
        })
      })

      if (res.ok) {
        onRefreshGroups && onRefreshGroups()
        onRefreshPipelines && onRefreshPipelines()
      } else {
        const err = await res.json().catch(() => ({}))
        alert(`移出流水线失败: ${err.error || res.statusText}`)
      }
    } catch (err) {
      console.error(err)
      alert('移出流水线请求异常')
    }
  }

  // 单条流水线加入组 (从未纳入分组发起)
  const handleOpenJoinModal = (pipeline: Pipeline) => {
    setJoinModalPipeline(pipeline)
    setTargetGroupIdToJoin(pipelineGroups.length > 0 ? pipelineGroups[0].id : '')
  }

  const handleConfirmJoin = async () => {
    if (!joinModalPipeline || !targetGroupIdToJoin) return
    setJoining(true)
    try {
      const res = await fetch(`${apiBase}/pipeline-groups/${targetGroupIdToJoin}/pipelines`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          pipeline_ids: [joinModalPipeline.id],
          action: 'attach'
        })
      })

      if (res.ok) {
        setJoinModalPipeline(null)
        setTargetGroupIdToJoin('')
        onRefreshGroups && onRefreshGroups()
        onRefreshPipelines && onRefreshPipelines()
      } else {
        const err = await res.json().catch(() => ({}))
        alert(`加入流水线组失败: ${err.error || res.statusText}`)
      }
    } catch (err) {
      console.error(err)
      alert('加入流水线组请求异常')
    } finally {
      setJoining(false)
    }
  }

  // 触发三方差异对比
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

  // 提交同步确认
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

  // 类型 Badge 样式
  const getTypeBadgeStyle = (type: string) => {
    switch (type) {
      case '每日构建':
        return { background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8', border: '1px solid rgba(99, 102, 241, 0.3)' }
      case 'MR':
      case 'MR触发':
        return { background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.3)' }
      case '手动触发':
        return { background: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', border: '1px solid rgba(245, 158, 11, 0.3)' }
      default:
        return { background: 'rgba(148, 163, 184, 0.15)', color: '#cbd5e1', border: '1px solid rgba(148, 163, 184, 0.3)' }
    }
  }

  const visibleGroups = groupedData.filter(g => g.isVisible)

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%' }}>
      {/* 顶部标题与操作栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>构建与流水线管理</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            自主创建流水线组并组织物理流水线，实时查看节点方案负载，支持按容量最小方案数智能调度。
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

      {/* 极简概览统计胶囊栏 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
        <div className="glass-card" style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ padding: 10, borderRadius: 8, background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8' }}>
            <FolderTree size={20} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>流水线组</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{stats.totalGroups} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)' }}>个组</span></div>
          </div>
        </div>

        <div className="glass-card" style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ padding: 10, borderRadius: 8, background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8' }}>
            <Layers size={20} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>物理流水线总数</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{stats.totalPipelines} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)' }}>条节点</span></div>
          </div>
        </div>

        <div className="glass-card" style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ padding: 10, borderRadius: 8, background: 'rgba(16, 185, 129, 0.15)', color: '#34d399' }}>
            <CheckCircle2 size={20} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>分组归属分布</div>
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4, display: 'flex', gap: 8 }}>
              <span style={{ color: '#34d399' }}>已纳入 {stats.assignedCount}</span>
              <span style={{ color: 'var(--text-muted)' }}>/</span>
              <span style={{ color: stats.unassignedCount > 0 ? '#f59e0b' : 'var(--text-muted)' }}>
                未分组 {stats.unassignedCount}
              </span>
            </div>
          </div>
        </div>

        <div className="glass-card" style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ padding: 10, borderRadius: 8, background: 'rgba(244, 63, 94, 0.15)', color: '#fb7185' }}>
            <GitBranch size={20} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>绑定执行方案</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{stats.totalSchemes} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)' }}>个方案</span></div>
          </div>
        </div>
      </div>

      {/* 搜索与类型过滤工具栏 */}
      <div className="glass-card" style={{ padding: 14, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 12, flex: 1, minWidth: 280, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
            <Search style={{ position: 'absolute', left: 12, top: 10, color: 'var(--text-muted)' }} size={16} />
            <input 
              type="text" 
              placeholder="搜索流水线组名称、标识、物理流水线 ID 或关联方案..." 
              style={{ paddingLeft: 38, width: '100%', height: 36, fontSize: 13, borderRadius: 8 }}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Filter size={14} style={{ color: 'var(--text-muted)' }} />
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              style={{ 
                height: 36, 
                padding: '0 12px', 
                fontSize: 13, 
                borderRadius: 8, 
                background: 'var(--bg-secondary, rgba(255, 255, 255, 0.05))',
                color: 'var(--text-main)',
                border: '1px solid var(--border-color)',
                cursor: 'pointer'
              }}
            >
              <option value="ALL">全部物理流水线类型</option>
              {availableTypes.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>

        {(selectedType !== 'ALL' || searchQuery.trim()) && (
          <button 
            className="btn btn-secondary btn-small"
            onClick={() => {
              setSelectedType('ALL')
              setSearchQuery('')
            }}
            style={{ fontSize: 12, height: 36 }}
          >
            重置筛选
          </button>
        )}
      </div>

      {/* 主双层折叠表格 (Master-Detail Table) */}
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 450, overflow: 'hidden' }}>
        <div style={{ flex: 1, overflowX: 'auto', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', background: 'rgba(255, 255, 255, 0.02)', color: 'var(--text-secondary)' }}>
                <th style={{ padding: '12px 14px', width: 44, textAlign: 'center' }}></th>
                <th style={{ padding: '12px 16px', fontWeight: 600, minWidth: 220 }}>流水线组名称 / 标识 (Key)</th>
                <th style={{ padding: '12px 16px', fontWeight: 600, width: 140 }}>组内物理节点</th>
                <th style={{ padding: '12px 16px', fontWeight: 600, width: 140 }}>挂载方案数</th>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>组功能描述</th>
                <th style={{ padding: '12px 16px', fontWeight: 600, textAlign: 'right', width: 180 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-secondary)' }}>
                    <RefreshCw size={24} className="spin" style={{ marginBottom: 12, opacity: 0.7 }} />
                    <div>正在读取流水线配置数据...</div>
                  </td>
                </tr>
              ) : visibleGroups.length > 0 || unassignedPipelinesData.isVisible ? (
                <>
                  {/* 自建流水线组列表 */}
                  {visibleGroups.map(({ group: g, matchedPipelines, allPipelines, totalSchemesInGroup }) => {
                    const isExpanded = expandedGroupIds.has(g.id)

                    return (
                      <React.Fragment key={`group-${g.id}`}>
                        {/* 顶层父行 (流水线组) */}
                        <tr 
                          style={{ 
                            borderBottom: isExpanded ? 'none' : '1px solid rgba(255, 255, 255, 0.05)',
                            background: isExpanded ? 'rgba(99, 102, 241, 0.04)' : 'transparent',
                            cursor: 'pointer',
                            transition: 'background-color 0.15s ease'
                          }}
                          onClick={() => toggleGroupExpand(g.id)}
                          onMouseEnter={(e) => {
                            if (!isExpanded) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.025)'
                          }}
                          onMouseLeave={(e) => {
                            if (!isExpanded) e.currentTarget.style.background = 'transparent'
                          }}
                        >
                          {/* 展开/收起箭头 */}
                          <td style={{ padding: '14px 10px 14px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 4, background: 'rgba(255, 255, 255, 0.04)' }}>
                              {isExpanded ? <ChevronDown size={15} style={{ color: 'var(--accent-primary, #6366f1)' }} /> : <ChevronRight size={15} />}
                            </div>
                          </td>

                          {/* 组名称 / Key */}
                          <td style={{ padding: '14px 16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-main)' }}>{g.name}</span>
                              <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', padding: '1px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)' }}>
                                {g.group_key}
                              </span>
                            </div>
                          </td>

                          {/* 组内物理流水线数 */}
                          <td style={{ padding: '14px 16px' }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: allPipelines.length > 0 ? 'var(--text-main)' : 'var(--text-muted)' }}>
                              {allPipelines.length} 条物理节点
                            </span>
                          </td>

                          {/* 挂载执行方案数 */}
                          <td style={{ padding: '14px 16px' }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: totalSchemesInGroup > 0 ? '#38bdf8' : 'var(--text-muted)' }}>
                              {totalSchemesInGroup} 个方案
                            </span>
                          </td>

                          {/* 组功能描述 */}
                          <td style={{ padding: '14px 16px', color: 'var(--text-secondary)', fontSize: 13 }}>
                            {g.description || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>暂无描述</span>}
                          </td>

                          {/* 操作列 */}
                          <td style={{ padding: '14px 16px', textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                              {isAdmin && (
                                <>
                                  <button
                                    className="btn btn-secondary btn-small"
                                    onClick={() => handleOpenAttachModal(g)}
                                    title="关联物理流水线入组"
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', fontSize: 12, color: 'var(--accent-primary, #6366f1)' }}
                                  >
                                    <FolderPlus size={13} />
                                    <span>关联流水线</span>
                                  </button>
                                  <button
                                    className="btn btn-secondary btn-small"
                                    onClick={() => {
                                      setActiveGroup(g)
                                      setShowGroupModal(true)
                                    }}
                                    title="编辑流水线组"
                                    style={{ padding: '4px 8px', fontSize: 12 }}
                                  >
                                    <Edit size={13} />
                                  </button>
                                  <button
                                    className="btn btn-danger btn-small"
                                    onClick={() => handleDeleteGroup(g)}
                                    title={allPipelines.length > 0 ? '组内仍有流水线，不可直接删除' : '删除流水线组'}
                                    disabled={allPipelines.length > 0}
                                    style={{ padding: '4px 8px', fontSize: 12, opacity: allPipelines.length > 0 ? 0.35 : 1 }}
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>

                        {/* 嵌套子表格 (组内物理流水线节点) */}
                        {isExpanded && (
                          <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(0, 0, 0, 0.2)' }}>
                            <td colSpan={6} style={{ padding: '0 0 16px 44px' }}>
                              <div style={{ 
                                margin: '8px 16px 8px 0', 
                                padding: 14, 
                                borderRadius: 10, 
                                background: 'var(--bg-secondary, rgba(255, 255, 255, 0.03))', 
                                border: '1px solid rgba(255, 255, 255, 0.06)' 
                              }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <Layers size={13} style={{ color: 'var(--accent-primary, #6366f1)' }} />
                                    <span>组内物理流水线节点 ({matchedPipelines.length} 条)</span>
                                  </div>
                                  {allPipelines.length === 0 && (
                                    <span style={{ color: '#f59e0b' }}>提示：当前组暂无物理流水线，无法接收智能调度，请点击右上方“关联流水线”添加</span>
                                  )}
                                </div>

                                {matchedPipelines.length > 0 ? (
                                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                    <thead>
                                      <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.06)', color: 'var(--text-muted)' }}>
                                        <th style={{ padding: '8px 10px', fontWeight: 500, width: 140 }}>物理流水线 ID</th>
                                        <th style={{ padding: '8px 10px', fontWeight: 500, minWidth: 180 }}>流水线名称</th>
                                        <th style={{ padding: '8px 10px', fontWeight: 500, width: 100 }}>类型</th>
                                        <th style={{ padding: '8px 10px', fontWeight: 500, width: 90 }}>节点状态</th>
                                        <th style={{ padding: '8px 10px', fontWeight: 500, width: 110 }}>绑定方案数</th>
                                        <th style={{ padding: '8px 10px', fontWeight: 500, width: 110 }}>负责人</th>
                                        <th style={{ padding: '8px 10px', fontWeight: 500 }}>描述</th>
                                        <th style={{ padding: '8px 10px', fontWeight: 500, textAlign: 'right', width: 160 }}>操作</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {matchedPipelines.map((p) => {
                                        const pSchemes = getSchemesForPipeline(p)
                                        const webURL = getPipelineWebURL(p)

                                        return (
                                          <tr 
                                            key={p.id || p.pipeline_id}
                                            style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.03)' }}
                                          >
                                            <td style={{ padding: '10px', fontFamily: 'var(--font-mono)', fontSize: 12, color: '#a5b4fc' }}>
                                              <span style={{ background: 'rgba(99, 102, 241, 0.1)', padding: '2px 6px', borderRadius: 4 }}>
                                                {p.pipeline_id}
                                              </span>
                                            </td>
                                            <td style={{ padding: '10px', fontWeight: 600 }}>
                                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                {webURL ? (
                                                  <a 
                                                    href={webURL} 
                                                    target="_blank" 
                                                    rel="noopener noreferrer" 
                                                    style={{ color: 'var(--text-main)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                                                    title="跳转至三方控制台"
                                                  >
                                                    <span>{p.name}</span>
                                                    <ExternalLink size={12} style={{ color: '#6366f1' }} />
                                                  </a>
                                                ) : (
                                                  <span>{p.name}</span>
                                                )}
                                              </div>
                                            </td>
                                            <td style={{ padding: '10px' }}>
                                              <span style={{ ...getTypeBadgeStyle(p.type), fontSize: 11, padding: '1px 6px', borderRadius: 10 }}>
                                                {p.type}
                                              </span>
                                            </td>
                                            <td style={{ padding: '10px' }}>
                                              <span style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', fontSize: 11, padding: '1px 6px', borderRadius: 10 }}>
                                                活跃中
                                              </span>
                                            </td>
                                            <td style={{ padding: '10px' }}>
                                              <span style={{ 
                                                fontSize: 12, 
                                                fontWeight: 600,
                                                color: pSchemes.length > 0 ? '#38bdf8' : 'var(--text-muted)' 
                                              }}>
                                                {pSchemes.length} 个方案
                                              </span>
                                            </td>
                                            <td style={{ padding: '10px', color: 'var(--text-secondary)' }}>
                                              {p.owner_name || <span style={{ color: 'var(--text-muted)' }}>-</span>}
                                            </td>
                                            <td style={{ padding: '10px', color: 'var(--text-muted)', fontSize: 12 }}>
                                              {p.description || '-'}
                                            </td>
                                            <td style={{ padding: '10px', textAlign: 'right' }}>
                                              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                                {isAdmin && (
                                                  <>
                                                    <button
                                                      className="btn btn-secondary btn-small"
                                                      onClick={() => handleDetachPipeline(p)}
                                                      title="移出流水线组"
                                                      style={{ padding: '3px 6px', fontSize: 11, color: '#f59e0b', display: 'inline-flex', alignItems: 'center', gap: 2 }}
                                                    >
                                                      <LogOut size={11} /> 移出组
                                                    </button>
                                                    <button
                                                      className="btn btn-secondary btn-small"
                                                      onClick={() => handleTriggerSync(p)}
                                                      title="同步三方执行方案"
                                                      style={{ padding: '3px 6px', fontSize: 11 }}
                                                    >
                                                      <RefreshCw size={11} />
                                                    </button>
                                                    <button
                                                      className="btn btn-secondary btn-small"
                                                      onClick={() => onEditPipeline(p)}
                                                      title="编辑物理流水线"
                                                      style={{ padding: '3px 6px', fontSize: 11 }}
                                                    >
                                                      <Edit size={11} />
                                                    </button>
                                                    {p.id && (
                                                      <button
                                                        className="btn btn-danger btn-small"
                                                        onClick={() => onDeletePipeline(p.id!)}
                                                        title="删除物理流水线"
                                                        style={{ padding: '3px 6px', fontSize: 11 }}
                                                      >
                                                        <Trash2 size={11} />
                                                      </button>
                                                    )}
                                                  </>
                                                )}
                                              </div>
                                            </td>
                                          </tr>
                                        )
                                      })}
                                    </tbody>
                                  </table>
                                ) : (
                                  <div style={{ textAlign: 'center', padding: '18px 0', color: 'var(--text-muted)', fontSize: 12 }}>
                                    {allPipelines.length === 0 ? '该组下尚未添加任何物理流水线节点' : '没有匹配筛选条件的物理流水线'}
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}

                  {/* 底部独立特殊区域：未纳入分组的物理流水线 (Unassigned Pipelines) */}
                  {unassignedPipelinesData.isVisible && (
                    <React.Fragment key="unassigned-group">
                      <tr 
                        style={{ 
                          borderTop: '2px dashed var(--border-color)',
                          borderBottom: unassignedExpanded ? 'none' : '1px solid var(--border-color)',
                          background: unassignedExpanded ? 'rgba(245, 158, 11, 0.04)' : 'rgba(255, 255, 255, 0.01)',
                          cursor: 'pointer',
                          transition: 'background-color 0.15s ease'
                        }}
                        onClick={() => setUnassignedExpanded(!unassignedExpanded)}
                      >
                        <td style={{ padding: '14px 10px 14px 16px', textAlign: 'center', color: '#f59e0b' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 4, background: 'rgba(245, 158, 11, 0.1)' }}>
                            {unassignedExpanded ? <ChevronDown size={15} style={{ color: '#f59e0b' }} /> : <ChevronRight size={15} />}
                          </div>
                        </td>
                        <td style={{ padding: '14px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Unlink size={16} style={{ color: '#f59e0b' }} />
                            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-main)' }}>未纳入分组</span>
                            <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24' }}>
                              独立物理流水线
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: '14px 16px' }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: unassignedPipelinesData.all.length > 0 ? '#f59e0b' : 'var(--text-muted)' }}>
                            {unassignedPipelinesData.all.length} 条未归组
                          </span>
                        </td>
                        <td style={{ padding: '14px 16px' }}>
                          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>-</span>
                        </td>
                        <td style={{ padding: '14px 16px', color: 'var(--text-muted)', fontSize: 12 }}>
                          尚未加入任何流水线组，不会参与组智能负载均衡调度，可点击“加入组”快速分配。
                        </td>
                        <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                          <span style={{ fontSize: 12, color: '#f59e0b' }}>
                            {unassignedExpanded ? '点击收起' : '点击展开'}
                          </span>
                        </td>
                      </tr>

                      {/* 未纳入分组流水线子表格 */}
                      {unassignedExpanded && (
                        <tr style={{ borderBottom: '1px solid var(--border-color)', background: 'rgba(0, 0, 0, 0.15)' }}>
                          <td colSpan={6} style={{ padding: '0 0 16px 44px' }}>
                            <div style={{ 
                              margin: '8px 16px 8px 0', 
                              padding: 14, 
                              borderRadius: 10, 
                              background: 'var(--bg-secondary, rgba(255, 255, 255, 0.02))', 
                              border: '1px solid rgba(245, 158, 11, 0.2)' 
                            }}>
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                <thead>
                                  <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.06)', color: 'var(--text-muted)' }}>
                                    <th style={{ padding: '8px 10px', fontWeight: 500, width: 140 }}>物理流水线 ID</th>
                                    <th style={{ padding: '8px 10px', fontWeight: 500, minWidth: 180 }}>流水线名称</th>
                                    <th style={{ padding: '8px 10px', fontWeight: 500, width: 100 }}>类型</th>
                                    <th style={{ padding: '8px 10px', fontWeight: 500, width: 90 }}>节点状态</th>
                                    <th style={{ padding: '8px 10px', fontWeight: 500, width: 110 }}>绑定方案数</th>
                                    <th style={{ padding: '8px 10px', fontWeight: 500, width: 110 }}>负责人</th>
                                    <th style={{ padding: '8px 10px', fontWeight: 500 }}>描述</th>
                                    <th style={{ padding: '8px 10px', fontWeight: 500, textAlign: 'right', width: 200 }}>操作</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {unassignedPipelinesData.matched.map((p) => {
                                    const pSchemes = getSchemesForPipeline(p)
                                    const webURL = getPipelineWebURL(p)

                                    return (
                                      <tr 
                                        key={p.id || p.pipeline_id}
                                        style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.03)' }}
                                      >
                                        <td style={{ padding: '10px', fontFamily: 'var(--font-mono)', fontSize: 12, color: '#a5b4fc' }}>
                                          <span style={{ background: 'rgba(99, 102, 241, 0.1)', padding: '2px 6px', borderRadius: 4 }}>
                                            {p.pipeline_id}
                                          </span>
                                        </td>
                                        <td style={{ padding: '10px', fontWeight: 600 }}>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            {webURL ? (
                                              <a 
                                                href={webURL} 
                                                target="_blank" 
                                                rel="noopener noreferrer" 
                                                style={{ color: 'var(--text-main)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                                                title="跳转至三方控制台"
                                              >
                                                <span>{p.name}</span>
                                                <ExternalLink size={12} style={{ color: '#6366f1' }} />
                                              </a>
                                            ) : (
                                              <span>{p.name}</span>
                                            )}
                                          </div>
                                        </td>
                                        <td style={{ padding: '10px' }}>
                                          <span style={{ ...getTypeBadgeStyle(p.type), fontSize: 11, padding: '1px 6px', borderRadius: 10 }}>
                                            {p.type}
                                          </span>
                                        </td>
                                        <td style={{ padding: '10px' }}>
                                          <span style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', fontSize: 11, padding: '1px 6px', borderRadius: 10 }}>
                                            活跃中
                                          </span>
                                        </td>
                                        <td style={{ padding: '10px' }}>
                                          <span style={{ fontSize: 12, fontWeight: 600, color: pSchemes.length > 0 ? '#38bdf8' : 'var(--text-muted)' }}>
                                            {pSchemes.length} 个方案
                                          </span>
                                        </td>
                                        <td style={{ padding: '10px', color: 'var(--text-secondary)' }}>
                                          {p.owner_name || <span style={{ color: 'var(--text-muted)' }}>-</span>}
                                        </td>
                                        <td style={{ padding: '10px', color: 'var(--text-muted)', fontSize: 12 }}>
                                          {p.description || '-'}
                                        </td>
                                        <td style={{ padding: '10px', textAlign: 'right' }}>
                                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                            {isAdmin && (
                                              <>
                                                <button
                                                  className="btn btn-primary btn-small"
                                                  onClick={() => handleOpenJoinModal(p)}
                                                  title="将该物理流水线加入指定组"
                                                  style={{ padding: '3px 8px', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 3 }}
                                                >
                                                  <FolderPlus size={12} /> 加入组
                                                </button>
                                                <button
                                                  className="btn btn-secondary btn-small"
                                                  onClick={() => handleTriggerSync(p)}
                                                  title="同步三方执行方案"
                                                  style={{ padding: '3px 6px', fontSize: 11 }}
                                                >
                                                  <RefreshCw size={11} />
                                                </button>
                                                <button
                                                  className="btn btn-secondary btn-small"
                                                  onClick={() => onEditPipeline(p)}
                                                  title="编辑物理流水线"
                                                  style={{ padding: '3px 6px', fontSize: 11 }}
                                                >
                                                  <Edit size={11} />
                                                </button>
                                                {p.id && (
                                                  <button
                                                    className="btn btn-danger btn-small"
                                                    onClick={() => onDeletePipeline(p.id!)}
                                                    title="删除物理流水线"
                                                    style={{ padding: '3px 6px', fontSize: 11 }}
                                                  >
                                                    <Trash2 size={11} />
                                                  </button>
                                                )}
                                              </>
                                            )}
                                          </div>
                                        </td>
                                      </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )}
                </>
              ) : (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-secondary)' }}>
                    <Box size={24} style={{ marginBottom: 12, opacity: 0.5 }} />
                    <div>未找到匹配的流水线组或流水线记录</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 流水线组新建 / 编辑 Modal (去除了触发类型与容量) */}
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
          padding: 24
        }}>
          <div className="glass-card" style={{ width: '100%', maxWidth: 560, padding: 28, borderRadius: 14 }}>
            <h3 style={{ fontSize: 19, fontWeight: 700, marginBottom: 18 }}>
              {activeGroup.id ? '编辑流水线组' : '新建流水线组 (资源池)'}
            </h3>
            <form onSubmit={handleSaveGroup} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  组唯一标识 (Group Key) <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="text"
                  placeholder="例如: backend-group"
                  value={activeGroup.group_key || ''}
                  onChange={(e) => setActiveGroup({ ...activeGroup, group_key: e.target.value })}
                  disabled={!!activeGroup.id}
                  style={{ width: '100%', padding: '10px 12px', fontSize: 14 }}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  流水线组展示名称 <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="text"
                  placeholder="例如: 后端流水线组"
                  value={activeGroup.name || ''}
                  onChange={(e) => setActiveGroup({ ...activeGroup, name: e.target.value })}
                  style={{ width: '100%', padding: '10px 12px', fontSize: 14 }}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  描述说明
                </label>
                <textarea
                  rows={3}
                  placeholder="请输入该流水线组的功能用途与承载说明..."
                  value={activeGroup.description || ''}
                  onChange={(e) => setActiveGroup({ ...activeGroup, description: e.target.value })}
                  style={{ width: '100%', padding: '10px 12px', fontSize: 14, resize: 'vertical' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 10 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowGroupModal(false)}
                  disabled={savingGroup}
                  style={{ padding: '8px 16px', fontSize: 13 }}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={savingGroup}
                  style={{ padding: '8px 20px', fontSize: 13 }}
                >
                  {savingGroup ? '正在保存...' : '确认保存'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 批量关联物理流水线入组 Modal (从组发起，无类型限制) */}
      {attachModalGroup && (
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
          padding: 24
        }}>
          <div className="glass-card" style={{ width: '100%', maxWidth: 620, padding: 28, borderRadius: 14 }}>
            <h3 style={{ fontSize: 19, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <FolderPlus size={22} style={{ color: 'var(--accent-primary, #6366f1)' }} />
              <span>关联物理流水线至 [{attachModalGroup.name}]</span>
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 18 }}>
              请勾选尚未归组的物理流水线节点加入该组：
            </p>

            {(() => {
              const eligiblePipelines = pipelines.filter(p => !p.group_id || p.group_id === 0)

              if (eligiblePipelines.length === 0) {
                return (
                  <div style={{ padding: '32px 16px', textAlign: 'center', background: 'rgba(255, 255, 255, 0.02)', borderRadius: 10, color: 'var(--text-muted)' }}>
                    <AlertCircle size={22} style={{ margin: '0 auto 10px', opacity: 0.6 }} />
                    <div>当前没有可加入该组的未归组物理流水线</div>
                  </div>
                )
              }

              return (
                <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20, paddingRight: 4 }}>
                  {eligiblePipelines.map(p => {
                    const isChecked = p.id ? selectedPipelineIdsToAttach.includes(p.id) : false
                    return (
                      <label 
                        key={p.id || p.pipeline_id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          padding: '12px 14px',
                          borderRadius: 8,
                          background: isChecked ? 'rgba(99, 102, 241, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                          border: isChecked ? '1px solid var(--accent-primary, #6366f1)' : '1px solid rgba(255, 255, 255, 0.06)',
                          cursor: 'pointer',
                          transition: 'all 0.15s'
                        }}
                      >
                        <input 
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (!p.id) return
                            if (e.target.checked) {
                              setSelectedPipelineIdsToAttach([...selectedPipelineIdsToAttach, p.id])
                            } else {
                              setSelectedPipelineIdsToAttach(selectedPipelineIdsToAttach.filter(id => id !== p.id))
                            }
                          }}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span>{p.name}</span>
                            <span style={{ ...getTypeBadgeStyle(p.type), fontSize: 11, padding: '1px 6px', borderRadius: 10 }}>{p.type}</span>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>ID: {p.pipeline_id} - 负责人: {p.owner_name || '未分配'}</div>
                        </div>
                      </label>
                    )
                  })}
                </div>
              )
            })()}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 10 }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setAttachModalGroup(null)}
                disabled={attaching}
                style={{ padding: '8px 16px', fontSize: 13 }}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleConfirmAttach}
                disabled={attaching || selectedPipelineIdsToAttach.length === 0}
                style={{ padding: '8px 20px', fontSize: 13 }}
              >
                {attaching ? '正在关联...' : `确认添加 (${selectedPipelineIdsToAttach.length})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 单条流水线加入指定组 Modal (从未纳入分组发起，下拉框模式) */}
      {joinModalPipeline && (
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
          padding: 24
        }}>
          <div className="glass-card" style={{ width: '100%', maxWidth: 580, padding: 28, borderRadius: 14 }}>
            <h3 style={{ fontSize: 19, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <FolderPlus size={22} style={{ color: 'var(--accent-primary, #6366f1)' }} />
              <span>将流水线加入流水线组</span>
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 18 }}>
              请选择要将物理流水线 <strong>{joinModalPipeline.name}</strong> {joinModalPipeline.type ? `(${joinModalPipeline.type})` : ''} 归入的目标组：
            </p>

            {(() => {
              if (pipelineGroups.length === 0) {
                return (
                  <div style={{ padding: '32px 16px', textAlign: 'center', background: 'rgba(255, 255, 255, 0.02)', borderRadius: 10, color: 'var(--text-muted)' }}>
                    <AlertCircle size={22} style={{ margin: '0 auto 10px', opacity: 0.6 }} />
                    <div>当前系统中暂无流水线组，请先在上方点击“新建流水线组”。</div>
                  </div>
                )
              }

              const selectedGroup = pipelineGroups.find(g => g.id === Number(targetGroupIdToJoin))

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 8 }}>
                      目标流水线组 (资源池) <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <select
                      value={targetGroupIdToJoin || ''}
                      onChange={(e) => setTargetGroupIdToJoin(e.target.value ? Number(e.target.value) : '')}
                      style={{
                        width: '100%',
                        padding: '11px 14px',
                        fontSize: 14,
                        borderRadius: 8,
                        background: 'var(--bg-secondary, rgba(255, 255, 255, 0.05))',
                        color: 'var(--text-main)',
                        border: '1px solid var(--border-color)',
                        cursor: 'pointer'
                      }}
                    >
                      <option value="">-- 请选择目标流水线组 --</option>
                      {pipelineGroups.map(g => (
                        <option key={g.id} value={g.id}>
                          {g.name} ({g.group_key}) - 已挂载方案: {g.used_schemes || 0} 个 | 组内节点: {g.pipeline_count || 0} 条
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* 选中组的详情提示卡片 */}
                  {selectedGroup && (
                    <div style={{
                      padding: '14px 16px',
                      borderRadius: 10,
                      background: 'rgba(99, 102, 241, 0.06)',
                      border: '1px solid rgba(99, 102, 241, 0.2)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-main)' }}>{selectedGroup.name}</span>
                        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: '#a5b4fc', background: 'rgba(99, 102, 241, 0.15)', padding: '2px 8px', borderRadius: 4 }}>
                          {selectedGroup.group_key}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', gap: 16 }}>
                        <span>组内节点: <strong style={{ color: 'var(--text-main)' }}>{selectedGroup.pipeline_count || 0}</strong> 条</span>
                        <span>已挂载方案: <strong style={{ color: '#38bdf8' }}>{selectedGroup.used_schemes || 0}</strong> 个</span>
                      </div>
                      {selectedGroup.description && (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                          {selectedGroup.description}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })()}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 22 }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setJoinModalPipeline(null)}
                disabled={joining}
                style={{ padding: '8px 16px', fontSize: 13 }}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleConfirmJoin}
                disabled={joining || !targetGroupIdToJoin}
                style={{ padding: '8px 20px', fontSize: 13 }}
              >
                {joining ? '正在加入...' : '确认加入'}
              </button>
            </div>
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
