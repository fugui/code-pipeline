import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Pagination, usePagination, Drawer, MemberSearchSelect } from '@code/common'
import {
  Users,
  UserCheck,
  Plus,
  Search,
  Edit3,
  Trash2,
  Eye,
  RefreshCw,
  Layers,
  Building2,
  Link,
  Copy,
  Check,
  CheckCircle2,
  AlertCircle,
  FileText,
  ShieldCheck,
  Lock
} from 'lucide-react'
import { ManagedCommitterGroup, Department, IRightGroupData } from '../types'
import { useToast } from '../components/Toast'
import './managed-committers.css'

interface ManagedCommittersProps {
  isAdmin?: boolean
  apiBase: string
  token: string
}

export const ManagedCommitters: React.FC<ManagedCommittersProps> = ({ isAdmin = true, apiBase, token }) => {
  const { showToast } = useToast()

  const [committerGroups, setCommitterGroups] = useState<ManagedCommitterGroup[]>([])
  const [totalCount, setTotalCount] = useState<number>(0)
  const [loading, setLoading] = useState<boolean>(false)

  // Filters
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [levelFilter, setLevelFilter] = useState<string>('all')
  const [deptFilter, setDeptFilter] = useState<string>('all')

  // System Dropdown Options (Departments)
  const [departments, setDepartments] = useState<Department[]>([])

  // Pagination standard
  const { page: currentPage, pageSize, setPage: setCurrentPage } = usePagination({ defaultPageSize: 25 })

  // Drawer States
  const [viewGroup, setViewGroup] = useState<ManagedCommitterGroup | null>(null)
  const [isFormDrawerOpen, setIsFormDrawerOpen] = useState<boolean>(false)
  const [editingGroup, setEditingGroup] = useState<ManagedCommitterGroup | null>(null)
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false)
  const [copiedUUID, setCopiedUUID] = useState<string | null>(null)

  // iRight Live Query & Verification State
  const [queryingIRight, setQueryingIRight] = useState<boolean>(false)
  const [iRightVerifiedData, setIRightVerifiedData] = useState<IRightGroupData | null>(null)
  const [iRightError, setIRightError] = useState<string | null>(null)

  // Detail Drawer Live iRight lookup
  const [detailIRightData, setDetailIRightData] = useState<IRightGroupData | null>(null)
  const [detailQueryingIRight, setDetailQueryingIRight] = useState<boolean>(false)

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    level: 'L1-公司级',
    department_id: undefined as number | undefined,
    admin_id: undefined as number | undefined,
    iright_group_name: '',
    iright_group_id: '',
    member_count: 0,
    is_active: true,
    description: ''
  })

  // Authenticated fetchFn for MemberSearchSelect
  const memberSearchFetchFn = useCallback(
    (url: string, options?: RequestInit) => {
      return fetch(url, {
        ...options,
        headers: {
          ...(options?.headers || {}),
          Authorization: `Bearer ${token}`
        }
      })
    },
    [token]
  )

  // Fetch System Options (Departments)
  const fetchSystemOptions = async () => {
    try {
      const res = await fetch(`${apiBase}/system-options`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setDepartments(data.departments || [])
      }
    } catch (e) {
      console.error('Failed to fetch system options:', e)
    }
  }

  // Fetch Committer Groups list with pagination & filters
  const fetchCommitterGroups = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('page', String(currentPage))
      params.set('pageSize', String(pageSize))
      if (searchQuery.trim()) params.set('search', searchQuery.trim())
      if (levelFilter !== 'all') params.set('level', levelFilter)
      if (deptFilter !== 'all') params.set('department_id', deptFilter)

      const res = await fetch(`${apiBase}/committer-groups?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setCommitterGroups(data.data || data.items || [])
        setTotalCount(data.total || 0)
      } else {
        showToast('获取 Committer 组列表失败', 'error')
      }
    } catch (e) {
      console.error('Failed to fetch committer groups:', e)
      showToast('网络错误，无法连接服务器', 'error')
    } finally {
      setLoading(false)
    }
  }, [apiBase, token, currentPage, pageSize, searchQuery, levelFilter, deptFilter, showToast])

  useEffect(() => {
    fetchSystemOptions()
  }, [])

  useEffect(() => {
    fetchCommitterGroups()
  }, [fetchCommitterGroups])

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setCurrentPage(1)
    fetchCommitterGroups()
  }

  // Open Create Drawer
  const handleOpenCreateDrawer = () => {
    setEditingGroup(null)
    setFormData({
      name: '',
      level: 'L1-公司级',
      department_id: undefined,
      admin_id: undefined,
      iright_group_name: '',
      iright_group_id: '',
      member_count: 0,
      is_active: true,
      description: ''
    })
    setIRightVerifiedData(null)
    setIRightError(null)
    setIsFormDrawerOpen(true)
  }

  // Open Edit Drawer
  const handleOpenEditDrawer = (group: ManagedCommitterGroup) => {
    setEditingGroup(group)
    setFormData({
      name: group.name,
      level: group.level || 'L1-公司级',
      department_id: group.department_id,
      admin_id: group.admin_id,
      iright_group_name: group.iright_group_name || '',
      iright_group_id: group.iright_group_id || '',
      member_count: group.member_count || 0,
      is_active: group.is_active ?? true,
      description: group.description || ''
    })
    setIRightVerifiedData(null)
    setIRightError(null)
    setIsFormDrawerOpen(true)
  }

  // Open View Detail Drawer
  const handleOpenDetailDrawer = (group: ManagedCommitterGroup) => {
    setViewGroup(group)
    setDetailIRightData(null)
    if (group.iright_group_id) {
      handleFetchDetailIRight(group.iright_group_id)
    }
  }

  // Live Query / Verify iRight Group by UUID
  const handleVerifyIRightGroup = async (groupIdToVerify?: string) => {
    const targetId = (groupIdToVerify || formData.iright_group_id).trim()
    if (!targetId) {
      setIRightError('请输入需要核验的 iRight 群组 ID (UUID)')
      return
    }

    setQueryingIRight(true)
    setIRightError(null)
    try {
      const res = await fetch(`${apiBase}/iright/query?groupId=${encodeURIComponent(targetId)}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      if (res.ok && data.success && data.data) {
        const item: IRightGroupData = data.data
        setIRightVerifiedData(item)
        setFormData(prev => ({
          ...prev,
          name: item.groupNameCn || item.groupNameEn || prev.name,
          iright_group_name: item.groupNameCn || item.groupNameEn || '',
          member_count: item.memberCount || 0
        }))
        showToast(`已成功匹配 iRight 真实群组: ${item.groupNameCn} (${item.memberCount || 0}人)`, 'success')
      } else {
        setIRightVerifiedData(null)
        setIRightError(data.error || '未在 iRight 系统中查询到该群组 ID，请检查 UUID 是否准确有效')
      }
    } catch (e) {
      console.error('Failed to query iRight group:', e)
      setIRightError('iRight 远程查询校验服务请求失败，请稍后重试')
    } finally {
      setQueryingIRight(false)
    }
  }

  // Fetch detail iRight data for View Drawer
  const handleFetchDetailIRight = async (groupId: string) => {
    if (!groupId) return
    setDetailQueryingIRight(true)
    try {
      const res = await fetch(`${apiBase}/iright/query?groupId=${encodeURIComponent(groupId)}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      if (res.ok && data.success && data.data) {
        setDetailIRightData(data.data)
      } else {
        setDetailIRightData(null)
      }
    } catch {
      setDetailIRightData(null)
    } finally {
      setDetailQueryingIRight(false)
    }
  }

  // Handle Form Submit (Create or Update)
  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name.trim()) {
      showToast('Committer Group 名称不能为空（可输入 iRight ID 后自动校验导入）', 'error')
      return
    }

    setIsSubmitting(true)
    try {
      const url = editingGroup ? `${apiBase}/committer-groups/${editingGroup.id}` : `${apiBase}/committer-groups`
      const method = editingGroup ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      })

      const data = await res.json()
      if (res.ok) {
        showToast(editingGroup ? 'Committer 组已成功更新' : 'Committer 组创建成功', 'success')
        setIsFormDrawerOpen(false)
        fetchCommitterGroups()
      } else {
        showToast(data.error || '保存失败，请检查输入项', 'error')
      }
    } catch (e) {
      console.error('Failed to submit form:', e)
      showToast('网络提交异常，请稍后重试', 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Delete Group
  const handleDeleteGroup = async (group: ManagedCommitterGroup | null) => {
    if (!group) return
    if (!window.confirm(`确定要彻底删除 Committer 组 "${group.name}" 吗？此操作不可逆！`)) {
      return
    }

    try {
      const res = await fetch(`${apiBase}/committer-groups/${group.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        showToast('Committer 组已删除', 'success')
        if (viewGroup?.id === group.id) setViewGroup(null)
        fetchCommitterGroups()
      } else {
        const data = await res.json()
        showToast(data.error || '删除失败', 'error')
      }
    } catch (e) {
      console.error('Failed to delete group:', e)
      showToast('网络错误，删除操作失败', 'error')
    }
  }

  // Copy UUID
  const handleCopyUUID = (uuid: string) => {
    if (!uuid) return
    navigator.clipboard.writeText(uuid)
    setCopiedUUID(uuid)
    showToast('已复制 iRight UUID 至剪贴板', 'success')
    setTimeout(() => setCopiedUUID(null), 2000)
  }

  // Compute Summary Statistics
  const stats = useMemo(() => {
    const total = totalCount
    const active = committerGroups.filter(g => g.is_active).length
    const boundIRight = committerGroups.filter(g => !!g.iright_group_id).length
    const l0Count = committerGroups.filter(g => g.level?.startsWith('L0')).length
    const l1Count = committerGroups.filter(g => g.level?.startsWith('L1')).length
    const l2Count = committerGroups.filter(g => g.level?.startsWith('L2')).length
    const l3Count = committerGroups.filter(g => g.level?.startsWith('L3')).length

    return { total, active, boundIRight, l0Count, l1Count, l2Count, l3Count }
  }, [totalCount, committerGroups])

  const getLevelBadgeClass = (level?: string) => {
    if (level?.startsWith('L0')) return 'pipeline-committers-level-badge--l0'
    if (level?.startsWith('L1')) return 'pipeline-committers-level-badge--l1'
    if (level?.startsWith('L2')) return 'pipeline-committers-level-badge--l2'
    if (level?.startsWith('L3')) return 'pipeline-committers-level-badge--l3'
    return ''
  }

  return (
    <div className="pipeline-committers-page">
      {/* Top Header */}
      <div className="pipeline-committers-header">
        <div>
          <div className="pipeline-committers-header-left">
            <h1 className="pipeline-committers-title">
              <span className="pipeline-committers-title-icon-box">
                <Users size={22} />
              </span>
              Committer 管理
            </h1>
            <span className="pipeline-committers-category-tag">
              权限与治理
            </span>
          </div>
          <p className="pipeline-committers-desc">
            集中维护各层级受控 Committer Group、关联组织部门、管理负责人及 iRight 群组管理系统鉴权标识，保障代码仓合并审批合法合规。
          </p>
        </div>

        <div className="pipeline-committers-header-actions">
          <button
            type="button"
            onClick={() => fetchCommitterGroups()}
            className="btn btn-secondary"
            disabled={loading}
            title="刷新数据"
          >
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
            刷新
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={handleOpenCreateDrawer}
              className="btn btn-primary"
            >
              <Plus size={16} />
              新增 Committer Group
            </button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="pipeline-committers-stats-grid">
        <div className="pipeline-committers-stat-card">
          <div className="pipeline-committers-stat-icon-box pipeline-committers-stat-icon-box--primary">
            <Users size={22} />
          </div>
          <div>
            <div className="pipeline-committers-stat-label">Committer 组总数</div>
            <div className="pipeline-committers-stat-value">
              {stats.total}
            </div>
          </div>
        </div>

        <div className="pipeline-committers-stat-card">
          <div className="pipeline-committers-stat-icon-box pipeline-committers-stat-icon-box--purple">
            <Layers size={22} />
          </div>
          <div>
            <div className="pipeline-committers-stat-label">层级分布 (L0 / L1 / L2 / L3)</div>
            <div className="pipeline-committers-stat-value pipeline-committers-stat-value--sm">
              <span style={{ color: '#e11d48' }} title="L0-集团级">{stats.l0Count}</span>
              <span className="text-muted" style={{ margin: '0 3px' }}>/</span>
              <span style={{ color: '#a855f7' }} title="L1-公司级">{stats.l1Count}</span>
              <span className="text-muted" style={{ margin: '0 3px' }}>/</span>
              <span style={{ color: 'var(--color-primary)' }} title="L2-一层部门级">{stats.l2Count}</span>
              <span className="text-muted" style={{ margin: '0 3px' }}>/</span>
              <span style={{ color: 'var(--color-success)' }} title="L3-项目组级">{stats.l3Count}</span>
            </div>
          </div>
        </div>

        <div className="pipeline-committers-stat-card">
          <div className="pipeline-committers-stat-icon-box pipeline-committers-stat-icon-box--success">
            <CheckCircle2 size={22} />
          </div>
          <div>
            <div className="pipeline-committers-stat-label">正常启用状态</div>
            <div className="pipeline-committers-stat-value pipeline-committers-stat-value--success">
              {stats.active} <span className="pipeline-committers-stat-label">/ {stats.total}</span>
            </div>
          </div>
        </div>

        <div className="pipeline-committers-stat-card">
          <div className="pipeline-committers-stat-icon-box pipeline-committers-stat-icon-box--warning">
            <Link size={22} />
          </div>
          <div>
            <div className="pipeline-committers-stat-label">关联 iRight 绑定</div>
            <div className="pipeline-committers-stat-value pipeline-committers-stat-value--warning">
              {stats.boundIRight}{' '}
              <span className="pipeline-committers-stat-label">
                ({stats.total > 0 ? Math.round((stats.boundIRight / stats.total) * 100) : 0}%)
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="pipeline-committers-toolbar">
        <form onSubmit={handleSearchSubmit} className="pipeline-committers-search-form">
          <div className="pipeline-committers-search-input-wrapper">
            <Search size={16} className="pipeline-committers-search-icon" />
            <input
              type="text"
              placeholder="搜索组名、iRight 名称或 UUID..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pipeline-committers-search-input"
            />
          </div>
          <button type="submit" className="btn btn-secondary">
            搜索
          </button>
        </form>

        <div className="pipeline-committers-filter-group">
          <div className="pipeline-committers-filter-item">
            <span className="pipeline-committers-filter-label">所属层级:</span>
            <select
              value={levelFilter}
              onChange={e => {
                setLevelFilter(e.target.value)
                setCurrentPage(1)
              }}
              className="pipeline-committers-filter-select"
            >
              <option value="all">全部层级</option>
              <option value="L0-集团级">L0-集团级</option>
              <option value="L1-公司级">L1-公司级</option>
              <option value="L2-一层部门级">L2-一层部门级</option>
              <option value="L3-项目组级">L3-项目组级</option>
            </select>
          </div>

          <div className="pipeline-committers-filter-item">
            <span className="pipeline-committers-filter-label">归属部门:</span>
            <select
              value={deptFilter}
              onChange={e => {
                setDeptFilter(e.target.value)
                setCurrentPage(1)
              }}
              className="pipeline-committers-filter-select"
              style={{ maxWidth: 160 }}
            >
              <option value="all">全部部门</option>
              {departments.map(d => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Main Table */}
      <div className="pipeline-committers-table-card">
        <div className="pipeline-committers-table-scroll">
          <table className="pipeline-committers-table">
            <thead>
              <tr className="pipeline-committers-thead-tr">
                <th className="pipeline-committers-th" style={{ width: 60 }}>#</th>
                <th className="pipeline-committers-th">Committer Group 名称</th>
                <th className="pipeline-committers-th">所属层级</th>
                <th className="pipeline-committers-th">归属部门</th>
                <th className="pipeline-committers-th">管理员</th>
                <th className="pipeline-committers-th">iRight 关联群组</th>
                <th className="pipeline-committers-th">状态 / 规模</th>
                <th className="pipeline-committers-th">创建时间</th>
                <th className="pipeline-committers-th" style={{ textAlign: 'right' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} style={{ padding: 48, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                    <RefreshCw size={24} className="spin" style={{ margin: '0 auto 10px' }} />
                    正在加载 Committer Group 列表...
                  </td>
                </tr>
              ) : committerGroups.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: 56, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                    <Users size={36} style={{ margin: '0 auto 12px', opacity: 0.35 }} />
                    <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)' }}>未找到匹配的 Committer Group</div>
                    <div style={{ fontSize: 13, marginTop: 4, color: 'var(--color-text-secondary)' }}>可调整筛选项或点击右上角新增 Committer 组</div>
                  </td>
                </tr>
              ) : (
                committerGroups.map((group, idx) => (
                  <tr
                    key={group.id}
                    className="pipeline-committers-tbody-tr"
                    onClick={() => handleOpenDetailDrawer(group)}
                  >
                    <td className="pipeline-committers-td" style={{ color: 'var(--color-text-secondary)', fontSize: 12 }}>
                      {(currentPage - 1) * pageSize + idx + 1}
                    </td>
                    <td className="pipeline-committers-td">
                      <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>{group.name}</span>
                        <span className={`pipeline-committers-status-tag ${group.is_active ? 'pipeline-committers-status-tag--active' : 'pipeline-committers-status-tag--inactive'}`}>
                          {group.is_active ? '启用' : '停用'}
                        </span>
                      </div>
                      {group.description && (
                        <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2, maxWidth: 280 }} className="text-truncate">
                          {group.description}
                        </div>
                      )}
                    </td>
                    <td className="pipeline-committers-td">
                      <span className={`pipeline-committers-level-badge ${getLevelBadgeClass(group.level)}`}>
                        {group.level || 'L1-公司级'}
                      </span>
                    </td>
                    <td className="pipeline-committers-td" style={{ color: 'var(--color-text-primary)' }}>
                      {group.department?.name ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <Building2 size={13} color="var(--color-text-secondary)" />
                          <span>{group.department.name}</span>
                        </div>
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                    </td>
                    <td className="pipeline-committers-td">
                      {group.admin ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div className="pipeline-committers-user-avatar">
                            {(group.admin.name || group.admin.username || 'A')[0].toUpperCase()}
                          </div>
                          <div>
                            <div style={{ fontSize: 12, color: 'var(--color-text-primary)', fontWeight: 500 }}>{group.admin.name || group.admin.username}</div>
                            {group.admin.username && group.admin.name && (
                              <div style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>{group.admin.username}</div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                    </td>
                    <td className="pipeline-committers-td" onClick={e => e.stopPropagation()}>
                      {group.iright_group_id ? (
                        <div>
                          <div style={{ fontWeight: 500, color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Link size={12} />
                            <span>{group.iright_group_name || group.name || '已关联 iRight'}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                            <code
                              className="pipeline-committers-uuid-code"
                              title={group.iright_group_id}
                            >
                              {group.iright_group_id}
                            </code>
                            <button
                              type="button"
                              onClick={() => handleCopyUUID(group.iright_group_id || '')}
                              className={`pipeline-committers-copy-btn ${copiedUUID === group.iright_group_id ? 'pipeline-committers-copy-btn--copied' : ''}`}
                              title="复制 UUID"
                            >
                              {copiedUUID === group.iright_group_id ? <Check size={12} /> : <Copy size={12} />}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted" style={{ fontSize: 12 }}>未绑定</span>
                      )}
                    </td>
                    <td className="pipeline-committers-td">
                      <span className="pipeline-committers-count-badge">
                        {group.member_count || 0} 人
                      </span>
                    </td>
                    <td className="pipeline-committers-td" style={{ color: 'var(--color-text-secondary)', fontSize: 12 }}>
                      {group.created_at ? new Date(group.created_at).toLocaleDateString('zh-CN') : '-'}
                    </td>
                    <td className="pipeline-committers-td" style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                        <button
                          type="button"
                          onClick={() => handleOpenDetailDrawer(group)}
                          className="btn btn-secondary"
                          style={{ padding: '5px 8px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          title="查看详情"
                        >
                          <Eye size={13} />
                          详情
                        </button>
                        {isAdmin && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleOpenEditDrawer(group)}
                              className="btn btn-secondary"
                              style={{ padding: '5px 8px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                              title="编辑"
                            >
                              <Edit3 size={13} />
                              编辑
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteGroup(group)}
                              className="btn btn-danger"
                              style={{ padding: '5px 8px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                              title="删除"
                            >
                              <Trash2 size={13} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination bar */}
        {totalCount > 0 && (
          <div style={{ padding: '16px 20px', borderTop: '1px solid var(--color-border-subtle)' }}>
            <Pagination totalItems={totalCount} defaultPageSize={25} />
          </div>
        )}
      </div>

      {/* 侧边栏 1: 查看详情 Drawer */}
      <Drawer
        open={!!viewGroup}
        onClose={() => setViewGroup(null)}
        width="620px"
        title={
          viewGroup ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Users size={20} color="var(--color-primary)" />
              <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text-primary)' }}>{viewGroup.name}</span>
              <span className={`pipeline-committers-level-badge ${getLevelBadgeClass(viewGroup.level)}`}>
                {viewGroup.level || 'L1-公司级'}
              </span>
            </div>
          ) : (
            'Committer 组详情'
          )
        }
      >
        {viewGroup && (
          <div className="pipeline-committers-drawer-content">
            {/* 基础概览卡片 */}
            <div className="pipeline-committers-overview-card">
              <div>
                <div className="pipeline-committers-overview-item-label">组 ID 编号</div>
                <div className="pipeline-committers-overview-item-value">#{viewGroup.id}</div>
              </div>
              <div>
                <div className="pipeline-committers-overview-item-label">运行状态</div>
                <div style={{ marginTop: 3 }}>
                  <span className={`pipeline-committers-status-tag ${viewGroup.is_active ? 'pipeline-committers-status-tag--active' : 'pipeline-committers-status-tag--inactive'}`}>
                    {viewGroup.is_active ? '正常启用中' : '已停用'}
                  </span>
                </div>
              </div>
              <div>
                <div className="pipeline-committers-overview-item-label">归属部门</div>
                <div className="pipeline-committers-overview-item-value" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Building2 size={14} color="var(--color-primary)" />
                  {viewGroup.department?.name || '未指定部门'}
                </div>
              </div>
              <div>
                <div className="pipeline-committers-overview-item-label">组内成员数</div>
                <div className="pipeline-committers-overview-item-value">{viewGroup.member_count || 0} 位 Committer</div>
              </div>
            </div>

            {/* 管理员卡片 */}
            <div className="pipeline-committers-detail-section">
              <div className="pipeline-committers-detail-title">
                <UserCheck size={16} color="var(--color-primary)" />
                群组管理员信息
              </div>
              {viewGroup.admin ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div className="pipeline-committers-user-avatar" style={{ width: 40, height: 40, fontSize: 16 }}>
                    {(viewGroup.admin.name || viewGroup.admin.username || 'A')[0].toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)' }}>{viewGroup.admin.name || viewGroup.admin.username}</div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                      工号/账号: {viewGroup.admin.username} {viewGroup.admin.email ? ` | 邮箱: ${viewGroup.admin.email}` : ''}
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>暂未指定群组管理员</div>
              )}
            </div>

            {/* iRight 群组管理系统 绑定卡片 */}
            <div className="pipeline-committers-detail-section" style={{ background: 'var(--color-primary-subtle)', borderColor: 'var(--color-primary-border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Link size={16} />
                  iRight 群组管理系统关联映射
                </div>
                {viewGroup.iright_group_id && (
                  <button
                    type="button"
                    onClick={() => handleFetchDetailIRight(viewGroup.iright_group_id || '')}
                    className="btn btn-secondary"
                    style={{ padding: '2px 8px', fontSize: 11, height: 24, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    title="从远程 iRight 重新核验并拉取最新详情"
                    disabled={detailQueryingIRight}
                  >
                    <RefreshCw size={11} className={detailQueryingIRight ? 'spin' : ''} />
                    {detailQueryingIRight ? '拉取中...' : '核验详情'}
                  </button>
                )}
              </div>

              {viewGroup.iright_group_id ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    <div className="pipeline-committers-overview-item-label">iRight 群组名称</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', marginTop: 2 }}>
                      {viewGroup.name || viewGroup.iright_group_name || '已提供 UUID'}
                    </div>
                  </div>
                  <div>
                    <div className="pipeline-committers-overview-item-label">iRight 鉴权 ID (UUID)</div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        background: 'var(--color-bg-surface)',
                        border: '1px solid var(--color-border-subtle)',
                        padding: '8px 12px',
                        borderRadius: 6,
                        marginTop: 4
                      }}
                    >
                      <code style={{ fontSize: 12, color: 'var(--color-primary)', wordBreak: 'break-all' }}>{viewGroup.iright_group_id}</code>
                      <button
                        type="button"
                        onClick={() => handleCopyUUID(viewGroup.iright_group_id || '')}
                        className="btn btn-secondary"
                        style={{ padding: '3px 8px', fontSize: 11, marginLeft: 8 }}
                      >
                        {copiedUUID === viewGroup.iright_group_id ? <Check size={13} color="var(--color-success)" /> : <Copy size={13} />}
                      </button>
                    </div>
                  </div>

                  {/* 实时核验详情卡片 */}
                  {detailIRightData && (
                    <div className="pipeline-committers-iright-verify-box pipeline-committers-iright-verify-box--success">
                      <div style={{ fontWeight: 600, color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
                        <ShieldCheck size={14} /> 远程系统实时状态 (已通过验证)
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 12, marginTop: 6 }}>
                        <div><span style={{ color: 'var(--color-text-secondary)' }}>当前人数:</span> <span style={{ fontWeight: 600, color: 'var(--color-success)' }}>{detailIRightData.memberCount} 人</span></div>
                        <div><span style={{ color: 'var(--color-text-secondary)' }}>所属部门:</span> <span style={{ color: 'var(--color-text-primary)' }}>{detailIRightData.fullName || '-'}</span></div>
                        <div><span style={{ color: 'var(--color-text-secondary)' }}>群组管理员:</span> <span style={{ color: 'var(--color-text-primary)' }}>{detailIRightData.groupOwner || detailIRightData.groupAdmin || '-'}</span></div>
                        <div><span style={{ color: 'var(--color-text-secondary)' }}>系统状态:</span> <span style={{ color: 'var(--color-success)', fontWeight: 600 }}>正常 (有效)</span></div>
                      </div>
                      {detailIRightData.remark && (
                        <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 4 }}>
                          备注说明: {detailIRightData.remark}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>未关联 iRight 群组管理系统标识</div>
              )}
            </div>

            {/* 描述与备注 */}
            <div className="pipeline-committers-detail-section">
              <div className="pipeline-committers-detail-title">
                <FileText size={16} color="var(--color-primary)" />
                职责描述与备注说明
              </div>
              <div style={{ fontSize: 13, color: viewGroup.description ? 'var(--color-text-primary)' : 'var(--color-text-muted)', lineHeight: 1.6 }}>
                {viewGroup.description || '暂无描述信息'}
              </div>
            </div>

            {/* 时间审计戳 */}
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'flex', justifyContent: 'space-between', padding: '0 4px' }}>
              <span>创建时间: {viewGroup.created_at ? new Date(viewGroup.created_at).toLocaleString('zh-CN', { hour12: false }) : '-'}</span>
              <span>最后更新: {viewGroup.updated_at ? new Date(viewGroup.updated_at).toLocaleString('zh-CN', { hour12: false }) : '-'}</span>
            </div>

            {/* 底部按钮 */}
            {isAdmin && (
              <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => {
                    const target = viewGroup
                    setViewGroup(null)
                    handleOpenEditDrawer(target)
                  }}
                  className="btn btn-primary"
                  style={{ flex: 1, padding: '10px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                >
                  <Edit3 size={15} />
                  编辑此 Committer Group
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteGroup(viewGroup)}
                  className="btn btn-danger"
                  style={{ padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <Trash2 size={15} />
                  删除
                </button>
              </div>
            )}
          </div>
        )}
      </Drawer>

      {/* 侧边栏 2: 新增 / 编辑 Drawer */}
      <Drawer
        open={isFormDrawerOpen}
        onClose={() => setIsFormDrawerOpen(false)}
        width="640px"
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {editingGroup ? <Edit3 size={18} color="var(--color-primary)" /> : <Plus size={18} color="var(--color-primary)" />}
            <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text-primary)' }}>
              {editingGroup ? `编辑 Committer Group #${editingGroup.id}` : '新增 Committer Group'}
            </span>
          </div>
        }
      >
        <form onSubmit={handleFormSubmit} className="pipeline-committers-drawer-body">
          {/* 1. iRight 群组管理系统配置与实时核验 (置顶核心) */}
          <div className="pipeline-committers-detail-section" style={{ background: 'var(--color-primary-subtle)', borderColor: 'var(--color-primary-border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Link size={15} />
                iRight 群组管理系统配置与校验
              </div>
              {iRightVerifiedData && (
                <span
                  style={{
                    fontSize: 11,
                    padding: '2px 8px',
                    borderRadius: 4,
                    background: 'var(--color-success-subtle)',
                    color: 'var(--color-success)',
                    border: '1px solid var(--color-success-border)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontWeight: 600
                  }}
                >
                  <CheckCircle2 size={12} /> iRight 已核验通过
                </span>
              )}
            </div>

            {/* iRight 群组 ID (UUID) 与实时校验按钮 */}
            <div>
              <label className="pipeline-committers-overview-item-label">
                iRight 群组 ID (UUID 字符串) <span className="text-muted">- 输入后后台立即查询核验真实性并自动带出名称</span>
              </label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="例如：3FA85F64-5717-4562-B3FC-2C963F66AFA6"
                  value={formData.iright_group_id}
                  onChange={e => {
                    setFormData({ ...formData, iright_group_id: e.target.value.toUpperCase() })
                    setIRightError(null)
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleVerifyIRightGroup()
                    }
                  }}
                  className="code-input flex-1"
                  style={{
                    border: iRightError
                      ? '1px solid var(--color-danger)'
                      : iRightVerifiedData
                        ? '1px solid var(--color-success)'
                        : '1px solid var(--color-border-subtle)',
                    color: 'var(--color-primary)',
                    fontFamily: 'var(--font-family-mono, monospace)',
                    fontSize: 12
                  }}
                />
                <button
                  type="button"
                  onClick={() => handleVerifyIRightGroup()}
                  disabled={queryingIRight || !formData.iright_group_id.trim()}
                  className="btn btn-secondary"
                  style={{ padding: '8px 14px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
                >
                  <RefreshCw size={13} className={queryingIRight ? 'spin' : ''} />
                  {queryingIRight ? '查询校验中...' : '校验并获取'}
                </button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 4 }}>
                系统将通过后台配置的 API 实时查询该 ID 的名称、组织归属与成员规模并自动校验同步。
              </div>
            </div>

            {/* 核验成功展示卡片 */}
            {iRightVerifiedData && (
              <div className="pipeline-committers-iright-verify-box pipeline-committers-iright-verify-box--success" style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: 6, borderBottom: '1px solid var(--color-success-border)', paddingBottom: 6 }}>
                  <CheckCircle2 size={14} />
                  已成功匹配 iRight 真实群组
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12, marginTop: 8 }}>
                  <div>
                    <span style={{ color: 'var(--color-text-secondary)' }}>群组名称：</span>
                    <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>{iRightVerifiedData.groupNameCn}</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--color-text-secondary)' }}>有效成员数：</span>
                    <span style={{ color: 'var(--color-success)', fontWeight: 700 }}>{iRightVerifiedData.memberCount} 人</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--color-text-secondary)' }}>组织全称：</span>
                    <span style={{ color: 'var(--color-text-primary)' }}>{iRightVerifiedData.fullName || iRightVerifiedData.fullEnglishName || '-'}</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--color-text-secondary)' }}>群组管理员：</span>
                    <span style={{ color: 'var(--color-text-primary)' }}>{iRightVerifiedData.groupOwner || iRightVerifiedData.groupAdmin || '-'}</span>
                  </div>
                </div>
                {iRightVerifiedData.remark && (
                  <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', background: 'var(--color-bg-muted)', padding: '4px 8px', borderRadius: 4, marginTop: 6 }}>
                    备注说明：{iRightVerifiedData.remark}
                  </div>
                )}
              </div>
            )}

            {/* 核验失败/异常警告 */}
            {iRightError && (
              <div className="pipeline-committers-iright-verify-box pipeline-committers-iright-verify-box--error" style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-danger)' }}>
                <AlertCircle size={14} />
                <span>{iRightError}</span>
              </div>
            )}
          </div>

          {/* 2. Committer Group 名称 */}
          <div className="pipeline-committers-form-group">
            <label className="pipeline-committers-form-label">
              <span>
                Committer Group 名称 <span style={{ color: 'var(--color-danger)' }}>*</span>
              </span>
              <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 400, marginLeft: 'auto' }}>
                <Lock size={12} /> 由 iRight 系统自动导入 (只读)
              </span>
            </label>
            <input
              type="text"
              placeholder="请先在上方输入 iRight 群组 ID 并校验，系统将自动填充名称..."
              value={formData.name}
              readOnly
              required
              className="code-input"
              style={{
                cursor: 'not-allowed',
                background: 'var(--color-bg-muted)',
                fontWeight: formData.name ? 600 : 400
              }}
            />
            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>
              名称与 iRight 远程群组管理系统保持严格一致，代码仓合规巡检将依此与托管平台的 domain_group 对齐。
            </div>
          </div>

          {/* 3. 所属层级 */}
          <div className="pipeline-committers-form-group">
            <label className="pipeline-committers-form-label pipeline-committers-form-label--required">
              所属层级
            </label>
            <select
              value={formData.level}
              onChange={e => setFormData({ ...formData, level: e.target.value })}
              required
              className="code-select"
            >
              <option value="L0-集团级">L0-集团级</option>
              <option value="L1-公司级">L1-公司级</option>
              <option value="L2-一层部门级">L2-一层部门级 (SW为二层资源部门级)</option>
              <option value="L3-项目组级">L3-项目组级</option>
            </select>
            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>
              注：对于 SW（软件）组织，L2 对应各二层资源部门级。
            </div>
          </div>

          {/* 4. 归属部门 & 群组管理员 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, alignItems: 'start' }}>
            <div className="pipeline-committers-form-group">
              <label className="pipeline-committers-form-label">归属部门</label>
              <select
                value={formData.department_id || ''}
                onChange={e => setFormData({ ...formData, department_id: e.target.value ? Number(e.target.value) : undefined })}
                className="code-select"
              >
                <option value="">-- 请选择部门 --</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="pipeline-committers-form-group">
              <label className="pipeline-committers-form-label">
                群组管理员 <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-text-secondary)' }}>(支持姓名/工号搜索)</span>
              </label>
              <MemberSearchSelect
                value={formData.admin_id || ''}
                onChange={userId => {
                  setFormData(prev => ({ ...prev, admin_id: userId ? Number(userId) : undefined }))
                }}
                searchEndpoint={`${apiBase}/users`}
                meEndpoint={`${apiBase}/me`}
                fetchFn={memberSearchFetchFn}
              />
            </div>
          </div>

          {/* 5. 成员规模 & 启用开关 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, alignItems: 'center' }}>
            <div className="pipeline-committers-form-group">
              <label className="pipeline-committers-form-label">
                成员规模 (人) <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-text-secondary)' }}>- 由 iRight 自动拉取</span>
              </label>
              <input
                type="number"
                min={0}
                value={formData.member_count}
                onChange={e => setFormData({ ...formData, member_count: Number(e.target.value) || 0 })}
                className="code-input"
              />
            </div>

            <div className="pipeline-committers-form-group">
              <label className="pipeline-committers-form-label">启用状态</label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={formData.is_active}
                  onChange={e => setFormData({ ...formData, is_active: e.target.checked })}
                  style={{ width: 16, height: 16, accentColor: 'var(--color-primary)' }}
                />
                <span style={{ color: formData.is_active ? 'var(--color-success)' : 'var(--color-text-secondary)', fontWeight: 500 }}>
                  {formData.is_active ? '正常启用' : '已停用'}
                </span>
              </label>
            </div>
          </div>

          {/* 6. 备注/说明 */}
          <div className="pipeline-committers-form-group">
            <label className="pipeline-committers-form-label">备注说明 / 管辖范围</label>
            <textarea
              rows={3}
              placeholder="请输入该 Committer Group 的管辖范围、评审职责要求或说明..."
              value={formData.description}
              onChange={e => setFormData({ ...formData, description: e.target.value })}
              className="code-input"
              style={{ resize: 'vertical' }}
            />
          </div>

          {/* 操作按钮 */}
          <div className="pipeline-committers-form-footer">
            <button
              type="button"
              onClick={() => setIsFormDrawerOpen(false)}
              className="btn btn-secondary"
              disabled={isSubmitting}
            >
              取消
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isSubmitting}
            >
              {isSubmitting ? '正在保存...' : editingGroup ? '保存修改' : '确认新增'}
            </button>
          </div>
        </form>
      </Drawer>
    </div>
  )
}
