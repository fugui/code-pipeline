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

  // Authenticated fetchFn for MultiMemberSearchSelect
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
        if (Array.isArray(data.departments)) {
          setDepartments(data.departments)
        }
      }
    } catch (err) {
      console.error('Failed to load system options:', err)
    }
  }

  // Fetch Committer Groups list with pagination & filters
  const fetchCommitterGroups = async () => {
    setLoading(true)
    try {
      const queryParams = new URLSearchParams()
      queryParams.append('page', String(currentPage))
      queryParams.append('page_size', String(pageSize))
      if (searchQuery.trim()) queryParams.append('q', searchQuery.trim())
      if (levelFilter !== 'all') queryParams.append('level', levelFilter)
      if (deptFilter !== 'all') queryParams.append('department_id', deptFilter)

      const res = await fetch(`${apiBase}/managed-repos/committer-groups?${queryParams.toString()}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setCommitterGroups(data.items || [])
        setTotalCount(data.total || 0)
      } else {
        showToast('获取 Committer 组列表失败', 'error')
      }
    } catch (err) {
      console.error('Failed to fetch committer groups:', err)
      showToast('网络请求异常', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSystemOptions()
  }, [apiBase, token])

  useEffect(() => {
    fetchCommitterGroups()
  }, [apiBase, token, currentPage, pageSize, levelFilter, deptFilter])

  // Handle Search submit
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setCurrentPage(1)
    fetchCommitterGroups()
  }

  // Live Query & Verify iRight Group ID
  const handleVerifyIRightGroup = async (customGroupId?: string) => {
    const targetId = (customGroupId !== undefined ? customGroupId : formData.iright_group_id).trim()
    if (!targetId) {
      showToast('请输入 iRight 群组 ID (UUID)', 'error')
      return
    }

    setQueryingIRight(true)
    setIRightError(null)
    try {
      const res = await fetch(`${apiBase}/managed-repos/iright/groups/${encodeURIComponent(targetId)}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const result = await res.json()
      if (res.ok && result.data) {
        const data: IRightGroupData = result.data
        setIRightVerifiedData(data)
        setIRightError(null)
        showToast(`成功核验 iRight 群组：${data.groupNameCn} (${data.memberCount} 人)`, 'success')

        // 统一自动带入群组名称与成员人数
        const finalName = data.groupNameCn || data.groupNameEn || ''
        setFormData(prev => ({
          ...prev,
          name: finalName,
          iright_group_name: finalName,
          member_count: data.memberCount !== undefined ? data.memberCount : prev.member_count
        }))
      } else {
        const errMsg = result.error || result.message || '未在 iRight 系统中查询到该群组 ID'
        setIRightError(errMsg)
        setIRightVerifiedData(null)
        showToast(errMsg, 'error')
      }
    } catch (err: any) {
      const errMsg = '请求 iRight 查询接口失败，请检查网络或后端配置'
      setIRightError(errMsg)
      setIRightVerifiedData(null)
      showToast(errMsg, 'error')
    } finally {
      setQueryingIRight(false)
    }
  }

  // Detail Drawer live lookup
  const handleFetchDetailIRight = async (groupId: string) => {
    if (!groupId) return
    setDetailQueryingIRight(true)
    try {
      const res = await fetch(`${apiBase}/managed-repos/iright/groups/${encodeURIComponent(groupId)}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const result = await res.json()
        if (result.data) {
          setDetailIRightData(result.data)
        }
      }
    } catch (err) {
      console.error('Failed to fetch detail iRight info:', err)
    } finally {
      setDetailQueryingIRight(false)
    }
  }

  // Open Create Drawer
  const handleOpenCreateDrawer = () => {
    setEditingGroup(null)
    setIRightVerifiedData(null)
    setIRightError(null)
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
    setIsFormDrawerOpen(true)
  }

  // Open Edit Drawer
  const handleOpenEditDrawer = (group: ManagedCommitterGroup) => {
    setEditingGroup(group)
    setIRightVerifiedData(null)
    setIRightError(null)
    setFormData({
      name: group.name,
      level: group.level || 'L1-公司级',
      department_id: group.department_id,
      admin_id: group.admin_id,
      iright_group_name: group.iright_group_name || group.name,
      iright_group_id: group.iright_group_id || '',
      member_count: group.member_count || 0,
      is_active: group.is_active,
      description: group.description || ''
    })
    setIsFormDrawerOpen(true)
    if (group.iright_group_id) {
      handleVerifyIRightGroup(group.iright_group_id)
    }
  }

  // Open Detail Drawer
  const handleOpenDetailDrawer = (group: ManagedCommitterGroup) => {
    setViewGroup(group)
    setDetailIRightData(null)
    if (group.iright_group_id) {
      handleFetchDetailIRight(group.iright_group_id)
    }
  }

  // Submit Form (Create / Edit)
  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name.trim()) {
      showToast('请先输入 iRight 群组 ID 并校验以自动获取组名', 'error')
      return
    }

    setIsSubmitting(true)
    try {
      const isEdit = !!editingGroup
      const url = isEdit
        ? `${apiBase}/managed-repos/committer-groups/${editingGroup.id}`
        : `${apiBase}/managed-repos/committer-groups`
      const method = isEdit ? 'PUT' : 'POST'

      const payload = {
        name: formData.name.trim(),
        level: formData.level,
        department_id: formData.department_id || null,
        admin_id: formData.admin_id || null,
        iright_group_name: formData.name.trim(),
        iright_group_id: formData.iright_group_id.trim(),
        member_count: Number(formData.member_count) || 0,
        is_active: formData.is_active,
        description: formData.description.trim()
      }

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      })

      if (res.ok) {
        showToast(isEdit ? 'Committer 组已成功更新' : 'Committer 组创建成功', 'success')
        setIsFormDrawerOpen(false)
        if (viewGroup && editingGroup && viewGroup.id === editingGroup.id) {
          const updated = await res.json()
          setViewGroup(updated)
        }
        fetchCommitterGroups()
      } else {
        const data = await res.json()
        showToast(data.error || '保存失败', 'error')
      }
    } catch (err) {
      console.error('Failed to submit form:', err)
      showToast('网络请求失败', 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Delete Committer Group
  const handleDeleteGroup = async (group: ManagedCommitterGroup) => {
    if (!window.confirm(`确定要删除 Committer 组【${group.name}】吗？此操作将移除该组的管辖定义。`)) {
      return
    }

    try {
      const res = await fetch(`${apiBase}/managed-repos/committer-groups/${group.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })

      if (res.ok) {
        showToast('已成功删除 Committer 组', 'success')
        if (viewGroup?.id === group.id) {
          setViewGroup(null)
        }
        fetchCommitterGroups()
      } else {
        const data = await res.json()
        showToast(data.error || '删除失败', 'error')
      }
    } catch (err) {
      showToast('删除请求失败', 'error')
    }
  }

  // Copy UUID
  const handleCopyUUID = (uuid: string) => {
    if (!uuid) return
    navigator.clipboard.writeText(uuid)
    setCopiedUUID(uuid)
    showToast('已复制 iRight 群组 ID 到剪贴板', 'success')
    setTimeout(() => {
      setCopiedUUID(null)
    }, 2000)
  }

  // Stats calculation
  const stats = useMemo(() => {
    const total = totalCount || committerGroups.length
    const active = committerGroups.filter(g => g.is_active).length
    const boundIRight = committerGroups.filter(g => !!g.iright_group_id).length
    const l0Count = committerGroups.filter(g => g.level?.startsWith('L0')).length
    const l1Count = committerGroups.filter(g => g.level?.startsWith('L1')).length
    const l2Count = committerGroups.filter(g => g.level?.startsWith('L2')).length
    const l3Count = committerGroups.filter(g => g.level?.startsWith('L3')).length

    return { total, active, boundIRight, l0Count, l1Count, l2Count, l3Count }
  }, [totalCount, committerGroups])

  // Get level badge color with proper contrast in both light and dark themes
  const getLevelBadgeStyle = (level: string) => {
    if (level?.startsWith('L0')) {
      return {
        background: 'rgba(244, 63, 94, 0.12)',
        color: '#e11d48',
        border: '1px solid rgba(244, 63, 94, 0.3)'
      }
    }
    if (level?.startsWith('L1')) {
      return {
        background: 'rgba(168, 85, 247, 0.12)',
        color: '#9333ea',
        border: '1px solid rgba(168, 85, 247, 0.3)'
      }
    }
    if (level?.startsWith('L2')) {
      return {
        background: 'rgba(59, 130, 246, 0.12)',
        color: '#2563eb',
        border: '1px solid rgba(59, 130, 246, 0.3)'
      }
    }
    if (level?.startsWith('L3')) {
      return {
        background: 'rgba(16, 185, 129, 0.12)',
        color: '#059669',
        border: '1px solid rgba(16, 185, 129, 0.3)'
      }
    }
    return {
      background: 'var(--color-bg-muted)',
      color: 'var(--text-secondary)',
      border: '1px solid var(--border-color)'
    }
  }

  return (
    <div style={{ padding: '24px 32px', minHeight: '100%', color: 'var(--text-main)' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-main)' }}>
              <Users size={26} color="var(--color-primary, #6366f1)" />
              Committer 管理
            </h1>
            <span
              style={{
                fontSize: 12,
                padding: '3px 10px',
                borderRadius: 20,
                background: 'var(--color-primary-subtle)',
                color: 'var(--color-primary)',
                fontWeight: 600,
                border: '1px solid var(--color-primary-border)'
              }}
            >
              权限与治理
            </span>
          </div>
          <p style={{ color: 'var(--text-secondary)', marginTop: 6, marginBottom: 0, fontSize: 13 }}>
            集中维护各层级受控 Committer Group、关联组织部门、管理负责人及 iRight 群组管理系统鉴权标识，保障代码仓合并审批合法合规。
          </p>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={() => fetchCommitterGroups()}
            className="btn btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8 }}
            disabled={loading}
            title="刷新数据"
          >
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
            刷新
          </button>
          {isAdmin && (
            <button
              onClick={handleOpenCreateDrawer}
              className="btn btn-primary"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 18px',
                borderRadius: 8,
                fontWeight: 600,
                boxShadow: 'var(--shadow-sm)'
              }}
            >
              <Plus size={16} />
              新增 Committer Group
            </button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16,
          marginBottom: 24
        }}
      >
        <div
          style={{
            background: 'var(--card-bg)',
            padding: '16px 20px',
            borderRadius: 12,
            border: '1px solid var(--border-color)',
            boxShadow: 'var(--shadow-sm)',
            display: 'flex',
            alignItems: 'center',
            gap: 16
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              background: 'var(--color-primary-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-primary)'
            }}
          >
            <Users size={22} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Committer 组总数</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-main)', marginTop: 2 }}>
              {stats.total}
            </div>
          </div>
        </div>

        <div
          style={{
            background: 'var(--card-bg)',
            padding: '16px 20px',
            borderRadius: 12,
            border: '1px solid var(--border-color)',
            boxShadow: 'var(--shadow-sm)',
            display: 'flex',
            alignItems: 'center',
            gap: 16
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              background: 'rgba(168, 85, 247, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#a855f7'
            }}
          >
            <Layers size={22} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>层级分布 (L0 / L1 / L2 / L3)</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-main)', marginTop: 2 }}>
              <span style={{ color: '#e11d48' }} title="L0-集团级">{stats.l0Count}</span>
              <span style={{ color: 'var(--text-muted)', margin: '0 3px' }}>/</span>
              <span style={{ color: '#a855f7' }} title="L1-公司级">{stats.l1Count}</span>
              <span style={{ color: 'var(--text-muted)', margin: '0 3px' }}>/</span>
              <span style={{ color: '#3b82f6' }} title="L2-一层部门级">{stats.l2Count}</span>
              <span style={{ color: 'var(--text-muted)', margin: '0 3px' }}>/</span>
              <span style={{ color: '#10b981' }} title="L3-项目组级">{stats.l3Count}</span>
            </div>
          </div>
        </div>

        <div
          style={{
            background: 'var(--card-bg)',
            padding: '16px 20px',
            borderRadius: 12,
            border: '1px solid var(--border-color)',
            boxShadow: 'var(--shadow-sm)',
            display: 'flex',
            alignItems: 'center',
            gap: 16
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              background: 'var(--color-success-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-success)'
            }}
          >
            <CheckCircle2 size={22} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>正常启用状态</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-success)', marginTop: 2 }}>
              {stats.active} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-secondary)' }}>/ {stats.total}</span>
            </div>
          </div>
        </div>

        <div
          style={{
            background: 'var(--card-bg)',
            padding: '16px 20px',
            borderRadius: 12,
            border: '1px solid var(--border-color)',
            boxShadow: 'var(--shadow-sm)',
            display: 'flex',
            alignItems: 'center',
            gap: 16
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              background: 'var(--color-warning-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-warning)'
            }}
          >
            <Link size={22} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>关联 iRight 绑定</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-warning)', marginTop: 2 }}>
              {stats.boundIRight}{' '}
              <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-secondary)' }}>
                ({stats.total > 0 ? Math.round((stats.boundIRight / stats.total) * 100) : 0}%)
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div
        style={{
          background: 'var(--card-bg)',
          padding: '14px 18px',
          borderRadius: 12,
          border: '1px solid var(--border-color)',
          boxShadow: 'var(--shadow-sm)',
          marginBottom: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12
        }}
      >
        <form onSubmit={handleSearchSubmit} style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 260 }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: 360 }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
            <input
              type="text"
              placeholder="搜索组名、iRight 名称或 UUID..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                paddingLeft: 36,
                paddingRight: 12,
                height: 36,
                borderRadius: 8,
                background: 'var(--color-bg-input)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-main)',
                fontSize: 13
              }}
            />
          </div>
          <button type="submit" className="btn btn-secondary" style={{ height: 36, padding: '0 14px', borderRadius: 8, fontSize: 13 }}>
            搜索
          </button>
        </form>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>所属层级:</span>
            <select
              value={levelFilter}
              onChange={e => {
                setLevelFilter(e.target.value)
                setCurrentPage(1)
              }}
              style={{
                height: 36,
                borderRadius: 8,
                background: 'var(--color-bg-input)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-main)',
                padding: '0 10px',
                fontSize: 13
              }}
            >
              <option value="all">全部层级</option>
              <option value="L0-集团级">L0-集团级</option>
              <option value="L1-公司级">L1-公司级</option>
              <option value="L2-一层部门级（SW为二层资源部门级）">L2-一层部门级（SW为二层资源部门级）</option>
              <option value="L3-项目组级">L3-项目组级</option>
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>归属部门:</span>
            <select
              value={deptFilter}
              onChange={e => {
                setDeptFilter(e.target.value)
                setCurrentPage(1)
              }}
              style={{
                height: 36,
                borderRadius: 8,
                background: 'var(--color-bg-input)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-main)',
                padding: '0 10px',
                fontSize: 13,
                maxWidth: 160
              }}
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
      <div
        style={{
          background: 'var(--card-bg)',
          borderRadius: 12,
          border: '1px solid var(--border-color)',
          boxShadow: 'var(--shadow-sm)',
          overflow: 'hidden'
        }}
      >
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--color-bg-muted)', borderBottom: '1px solid var(--border-color)' }}>
                <th style={{ padding: '14px 16px', fontWeight: 600, color: 'var(--text-secondary)', width: 60 }}>#</th>
                <th style={{ padding: '14px 16px', fontWeight: 600, color: 'var(--text-secondary)' }}>Committer Group 名称</th>
                <th style={{ padding: '14px 16px', fontWeight: 600, color: 'var(--text-secondary)' }}>所属层级</th>
                <th style={{ padding: '14px 16px', fontWeight: 600, color: 'var(--text-secondary)' }}>归属部门</th>
                <th style={{ padding: '14px 16px', fontWeight: 600, color: 'var(--text-secondary)' }}>管理员</th>
                <th style={{ padding: '14px 16px', fontWeight: 600, color: 'var(--text-secondary)' }}>iRight 关联群组</th>
                <th style={{ padding: '14px 16px', fontWeight: 600, color: 'var(--text-secondary)' }}>状态 / 规模</th>
                <th style={{ padding: '14px 16px', fontWeight: 600, color: 'var(--text-secondary)' }}>创建时间</th>
                <th style={{ padding: '14px 16px', fontWeight: 600, color: 'var(--text-secondary)', textAlign: 'right' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} style={{ padding: 48, textAlign: 'center', color: 'var(--text-secondary)' }}>
                    <RefreshCw size={24} className="spin" style={{ margin: '0 auto 10px' }} />
                    正在加载 Committer Group 列表...
                  </td>
                </tr>
              ) : committerGroups.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: 56, textAlign: 'center', color: 'var(--text-secondary)' }}>
                    <Users size={36} style={{ margin: '0 auto 12px', opacity: 0.35 }} />
                    <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-main)' }}>未找到匹配的 Committer Group</div>
                    <div style={{ fontSize: 13, marginTop: 4, color: 'var(--text-secondary)' }}>可调整筛选项或点击右上角新增 Committer 组</div>
                  </td>
                </tr>
              ) : (
                committerGroups.map((group, idx) => (
                  <tr
                    key={group.id}
                    style={{
                      borderBottom: '1px solid var(--border-color)',
                      transition: 'background 0.2s',
                      cursor: 'pointer'
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-hover)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    onClick={() => handleOpenDetailDrawer(group)}
                  >
                    <td style={{ padding: '14px 16px', color: 'var(--text-secondary)', fontSize: 12 }}>
                      {(currentPage - 1) * pageSize + idx + 1}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>{group.name}</span>
                        {group.is_active ? (
                          <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: 'var(--color-success-subtle)', color: 'var(--color-success)', border: '1px solid var(--color-success-border)' }}>
                            启用
                          </span>
                        ) : (
                          <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: 'var(--color-danger-subtle)', color: 'var(--color-danger)', border: '1px solid var(--color-danger-border)' }}>
                            停用
                          </span>
                        )}
                      </div>
                      {group.description && (
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {group.description}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span
                        style={{
                          fontSize: 12,
                          padding: '3px 8px',
                          borderRadius: 6,
                          fontWeight: 500,
                          ...getLevelBadgeStyle(group.level)
                        }}
                      >
                        {group.level || 'L1-公司级'}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px', color: 'var(--text-main)' }}>
                      {group.department?.name ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <Building2 size={13} color="var(--text-secondary)" />
                          <span>{group.department.name}</span>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>-</span>
                      )}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      {group.admin ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div
                            style={{
                              width: 24,
                              height: 24,
                              borderRadius: '50%',
                              background: 'var(--color-primary-subtle)',
                              color: 'var(--color-primary)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 11,
                              fontWeight: 700
                            }}
                          >
                            {(group.admin.name || group.admin.username || 'A')[0].toUpperCase()}
                          </div>
                          <div>
                            <div style={{ fontSize: 12, color: 'var(--text-main)', fontWeight: 500 }}>{group.admin.name || group.admin.username}</div>
                            {group.admin.username && group.admin.name && (
                              <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{group.admin.username}</div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>-</span>
                      )}
                    </td>
                    <td style={{ padding: '14px 16px' }} onClick={e => e.stopPropagation()}>
                      {group.iright_group_id ? (
                        <div>
                          <div style={{ fontWeight: 500, color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Link size={12} />
                            <span>{group.iright_group_name || group.name || '已关联 iRight'}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                            <code
                              style={{
                                fontSize: 11,
                                padding: '2px 6px',
                                borderRadius: 4,
                                background: 'var(--color-bg-muted)',
                                color: 'var(--text-secondary)',
                                border: '1px solid var(--border-color)',
                                maxWidth: 160,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                              }}
                              title={group.iright_group_id}
                            >
                              {group.iright_group_id}
                            </code>
                            <button
                              onClick={() => handleCopyUUID(group.iright_group_id || '')}
                              style={{
                                background: 'none',
                                border: 'none',
                                padding: 2,
                                cursor: 'pointer',
                                color: copiedUUID === group.iright_group_id ? 'var(--color-success)' : 'var(--text-secondary)'
                              }}
                              title="复制 UUID"
                            >
                              {copiedUUID === group.iright_group_id ? <Check size={12} /> : <Copy size={12} />}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>未绑定</span>
                      )}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span
                        style={{
                          fontSize: 12,
                          padding: '2px 8px',
                          borderRadius: 12,
                          background: 'var(--color-bg-muted)',
                          color: 'var(--text-main)',
                          border: '1px solid var(--border-color)'
                        }}
                      >
                        {group.member_count || 0} 人
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px', color: 'var(--text-secondary)', fontSize: 12 }}>
                      {group.created_at ? new Date(group.created_at).toLocaleDateString('zh-CN') : '-'}
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                        <button
                          onClick={() => handleOpenDetailDrawer(group)}
                          className="btn btn-secondary"
                          style={{ padding: '5px 8px', borderRadius: 6, fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          title="查看详情"
                        >
                          <Eye size={13} />
                          详情
                        </button>
                        {isAdmin && (
                          <>
                            <button
                              onClick={() => handleOpenEditDrawer(group)}
                              className="btn btn-secondary"
                              style={{ padding: '5px 8px', borderRadius: 6, fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                              title="编辑"
                            >
                              <Edit3 size={13} />
                              编辑
                            </button>
                            <button
                              onClick={() => handleDeleteGroup(group)}
                              className="btn btn-danger"
                              style={{
                                padding: '5px 8px',
                                borderRadius: 6,
                                fontSize: 12,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                background: 'var(--color-danger-subtle)',
                                color: 'var(--color-danger)',
                                border: '1px solid var(--color-danger-border)'
                              }}
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
          <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border-color)' }}>
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
              <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-main)' }}>{viewGroup.name}</span>
              <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 6, ...getLevelBadgeStyle(viewGroup.level) }}>
                {viewGroup.level || 'L1-公司级'}
              </span>
            </div>
          ) : (
            'Committer 组详情'
          )
        }
      >
        {viewGroup && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* 基础概览卡片 */}
            <div
              style={{
                background: 'var(--color-bg-muted)',
                padding: 18,
                borderRadius: 10,
                border: '1px solid var(--border-color)',
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 16
              }}
            >
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>组 ID 编号</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-main)', marginTop: 3 }}>#{viewGroup.id}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>运行状态</div>
                <div style={{ marginTop: 3 }}>
                  {viewGroup.is_active ? (
                    <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 4, background: 'var(--color-success-subtle)', color: 'var(--color-success)', border: '1px solid var(--color-success-border)', fontWeight: 600 }}>
                      正常启用中
                    </span>
                  ) : (
                    <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 4, background: 'var(--color-danger-subtle)', color: 'var(--color-danger)', border: '1px solid var(--color-danger-border)', fontWeight: 600 }}>
                      已停用
                    </span>
                  )}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>归属部门</div>
                <div style={{ fontSize: 14, color: 'var(--text-main)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Building2 size={14} color="var(--color-primary)" />
                  {viewGroup.department?.name || '未指定部门'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>组内成员数</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-main)', marginTop: 3 }}>{viewGroup.member_count || 0} 位 Committer</div>
              </div>
            </div>

            {/* 管理员卡片 */}
            <div
              style={{
                background: 'var(--color-bg-muted)',
                padding: 18,
                borderRadius: 10,
                border: '1px solid var(--border-color)'
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-main)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <UserCheck size={16} color="var(--color-primary)" />
                群组管理员信息
              </div>
              {viewGroup.admin ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: '50%',
                      background: 'var(--color-primary-subtle)',
                      color: 'var(--color-primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 16,
                      fontWeight: 700
                    }}
                  >
                    {(viewGroup.admin.name || viewGroup.admin.username || 'A')[0].toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-main)' }}>{viewGroup.admin.name || viewGroup.admin.username}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                      工号/账号: {viewGroup.admin.username} {viewGroup.admin.email ? ` | 邮箱: ${viewGroup.admin.email}` : ''}
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>暂未指定群组管理员</div>
              )}
            </div>

            {/* iRight 群组管理系统 绑定卡片 */}
            <div
              style={{
                background: 'var(--color-primary-subtle)',
                padding: 18,
                borderRadius: 10,
                border: '1px solid var(--color-primary-border)'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Link size={16} />
                  iRight 群组管理系统关联映射
                </div>
                {viewGroup.iright_group_id && (
                  <button
                    onClick={() => handleFetchDetailIRight(viewGroup.iright_group_id || '')}
                    className="btn btn-secondary"
                    style={{ padding: '2px 8px', fontSize: 11, borderRadius: 4, height: 24, display: 'inline-flex', alignItems: 'center', gap: 4 }}
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
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>iRight 群组名称</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-main)', marginTop: 2 }}>
                      {viewGroup.name || viewGroup.iright_group_name || '已提供 UUID'}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>iRight 鉴权 ID (UUID)</div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        background: 'var(--card-bg)',
                        border: '1px solid var(--border-color)',
                        padding: '8px 12px',
                        borderRadius: 6,
                        marginTop: 4
                      }}
                    >
                      <code style={{ fontSize: 12, color: 'var(--color-primary)', wordBreak: 'break-all' }}>{viewGroup.iright_group_id}</code>
                      <button
                        onClick={() => handleCopyUUID(viewGroup.iright_group_id || '')}
                        className="btn btn-secondary"
                        style={{ padding: '3px 8px', borderRadius: 4, fontSize: 11, marginLeft: 8 }}
                      >
                        {copiedUUID === viewGroup.iright_group_id ? <Check size={13} color="var(--color-success)" /> : <Copy size={13} />}
                      </button>
                    </div>
                  </div>

                  {/* 实时核验详情卡片 */}
                  {detailIRightData && (
                    <div
                      style={{
                        background: 'var(--card-bg)',
                        border: '1px solid var(--color-success-border)',
                        borderRadius: 6,
                        padding: 10,
                        marginTop: 4,
                        fontSize: 12,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6
                      }}
                    >
                      <div style={{ fontWeight: 600, color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: 5 }}>
                        <ShieldCheck size={14} /> 远程系统实时状态 (已通过验证)
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                        <div><span style={{ color: 'var(--text-secondary)' }}>当前人数:</span> <span style={{ fontWeight: 600, color: 'var(--color-success)' }}>{detailIRightData.memberCount} 人</span></div>
                        <div><span style={{ color: 'var(--text-secondary)' }}>所属部门:</span> <span style={{ color: 'var(--text-main)' }}>{detailIRightData.fullName || '-'}</span></div>
                        <div><span style={{ color: 'var(--text-secondary)' }}>群组管理员:</span> <span style={{ color: 'var(--text-main)' }}>{detailIRightData.groupAdmin || '-'}</span></div>
                        <div><span style={{ color: 'var(--text-secondary)' }}>群组Owner:</span> <span style={{ color: 'var(--text-main)' }}>{detailIRightData.groupOwner || '-'}</span></div>
                      </div>
                      {detailIRightData.remark && (
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                          备注说明: {detailIRightData.remark}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>未关联 iRight 群组管理系统标识</div>
              )}
            </div>

            {/* 描述与备注 */}
            <div
              style={{
                background: 'var(--color-bg-muted)',
                padding: 18,
                borderRadius: 10,
                border: '1px solid var(--border-color)'
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-main)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <FileText size={16} color="var(--color-primary)" />
                职责描述与备注说明
              </div>
              <div style={{ fontSize: 13, color: viewGroup.description ? 'var(--text-main)' : 'var(--text-muted)', lineHeight: 1.6 }}>
                {viewGroup.description || '暂无描述信息'}
              </div>
            </div>

            {/* 时间审计戳 */}
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', padding: '0 4px' }}>
              <span>创建时间: {viewGroup.created_at ? new Date(viewGroup.created_at).toLocaleString('zh-CN', { hour12: false }) : '-'}</span>
              <span>最后更新: {viewGroup.updated_at ? new Date(viewGroup.updated_at).toLocaleString('zh-CN', { hour12: false }) : '-'}</span>
            </div>

            {/* 底部按钮 */}
            {isAdmin && (
              <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
                <button
                  onClick={() => {
                    const target = viewGroup
                    setViewGroup(null)
                    handleOpenEditDrawer(target)
                  }}
                  className="btn btn-primary"
                  style={{ flex: 1, padding: '10px 0', borderRadius: 8, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                >
                  <Edit3 size={15} />
                  编辑此 Committer Group
                </button>
                <button
                  onClick={() => handleDeleteGroup(viewGroup)}
                  className="btn btn-danger"
                  style={{ padding: '10px 18px', borderRadius: 8, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}
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
            <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-main)' }}>
              {editingGroup ? `编辑 Committer Group #${editingGroup.id}` : '新增 Committer Group'}
            </span>
          </div>
        }
      >
        <form onSubmit={handleFormSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* 1. iRight 群组管理系统配置与实时核验 (置顶核心) */}
          <div
            style={{
              background: 'var(--color-primary-subtle)',
              padding: 16,
              borderRadius: 10,
              border: '1px solid var(--color-primary-border)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
                iRight 群组 ID (UUID 字符串) <span style={{ color: 'var(--text-muted)' }}>- 输入后后台立即查询核验真实性并自动带出名称</span>
              </label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="例如：B95D36E3-7CB0-4B50-901C-C2A1982241B3"
                  value={formData.iright_group_id}
                  onChange={e => {
                    setFormData({ ...formData, iright_group_id: e.target.value })
                    setIRightError(null)
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleVerifyIRightGroup()
                    }
                  }}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: 6,
                    background: 'var(--color-bg-input)',
                    border: iRightError
                      ? '1px solid var(--color-danger)'
                      : iRightVerifiedData
                      ? '1px solid var(--color-success)'
                      : '1px solid var(--border-color)',
                    color: 'var(--color-primary)',
                    fontFamily: 'monospace',
                    fontSize: 12
                  }}
                />
                <button
                  type="button"
                  onClick={() => handleVerifyIRightGroup()}
                  disabled={queryingIRight || !formData.iright_group_id.trim()}
                  className="btn btn-secondary"
                  style={{
                    padding: '8px 14px',
                    borderRadius: 6,
                    fontSize: 12,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    whiteSpace: 'nowrap',
                    background: 'var(--card-bg)'
                  }}
                >
                  <RefreshCw size={13} className={queryingIRight ? 'spin' : ''} />
                  {queryingIRight ? '查询校验中...' : '校验并获取'}
                </button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                系统将通过后台配置的 API 实时查询该 ID 的名称、组织归属与成员规模并自动校验同步。
              </div>
            </div>

            {/* 核验成功展示卡片 */}
            {iRightVerifiedData && (
              <div
                style={{
                  background: 'var(--card-bg)',
                  border: '1px solid var(--color-success-border)',
                  borderRadius: 8,
                  padding: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderBottom: '1px solid var(--border-color)',
                    paddingBottom: 6
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <CheckCircle2 size={14} />
                    已成功匹配 iRight 真实群组
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>群组名称：</span>
                    <span style={{ color: 'var(--text-main)', fontWeight: 600 }}>{iRightVerifiedData.groupNameCn}</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>有效成员数：</span>
                    <span style={{ color: 'var(--color-success)', fontWeight: 700 }}>{iRightVerifiedData.memberCount} 人</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>组织全称：</span>
                    <span style={{ color: 'var(--text-main)' }}>{iRightVerifiedData.fullName || iRightVerifiedData.fullEnglishName || '-'}</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>群组负责人：</span>
                    <span style={{ color: 'var(--text-main)' }}>{iRightVerifiedData.groupOwner || iRightVerifiedData.groupAdmin || '-'}</span>
                  </div>
                </div>
                {iRightVerifiedData.remark && (
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', background: 'var(--color-bg-muted)', padding: '4px 8px', borderRadius: 4 }}>
                    备注说明：{iRightVerifiedData.remark}
                  </div>
                )}
              </div>
            )}

            {/* 核验失败/异常警告 */}
            {iRightError && (
              <div
                style={{
                  background: 'var(--color-danger-subtle)',
                  border: '1px solid var(--color-danger-border)',
                  borderRadius: 6,
                  padding: '8px 12px',
                  fontSize: 12,
                  color: 'var(--color-danger)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                <AlertCircle size={14} />
                <span>{iRightError}</span>
              </div>
            )}
          </div>

          {/* 2. Committer Group 名称 (唯一且 Readonly，保持与三方系统高度一致) */}
          <div>
            <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, fontWeight: 600, color: 'var(--text-main)', marginBottom: 6 }}>
              <span>
                Committer Group 名称 <span style={{ color: 'var(--color-danger)' }}>*</span>
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 400 }}>
                <Lock size={12} /> 由 iRight 系统自动导入 (只读)
              </span>
            </label>
            <input
              type="text"
              placeholder="请先在上方输入 iRight 群组 ID 并校验，系统将自动填充名称..."
              value={formData.name}
              readOnly
              required
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: 8,
                background: 'var(--color-bg-muted)',
                border: '1px solid var(--border-color)',
                color: formData.name ? 'var(--text-main)' : 'var(--text-muted)',
                fontSize: 13,
                fontWeight: formData.name ? 600 : 400,
                cursor: 'not-allowed'
              }}
            />
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
              名称与 iRight 远程群组管理系统保持严格一致，代码仓合规巡检将依此与托管平台的 domain_group 对齐。
            </div>
          </div>

          {/* 3. 所属层级 */}
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-main)', marginBottom: 6 }}>
              所属层级 <span style={{ color: 'var(--color-danger)' }}>*</span>
            </label>
            <select
              value={formData.level}
              onChange={e => setFormData({ ...formData, level: e.target.value })}
              required
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: 8,
                background: 'var(--color-bg-input)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-main)',
                fontSize: 13
              }}
            >
              <option value="L0-集团级">L0-集团级</option>
              <option value="L1-公司级">L1-公司级</option>
              <option value="L2-一层部门级（SW为二层资源部门级）">L2-一层部门级（SW为二层资源部门级）</option>
              <option value="L3-项目组级">L3-项目组级</option>
            </select>
          </div>

          {/* 4. 归属部门 & 群组管理员 (管理员使用 MultiMemberSearchSelect 满足 600+ 用户搜索) */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, alignItems: 'start' }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-main)', marginBottom: 6 }}>归属部门</label>
              <select
                value={formData.department_id || ''}
                onChange={e => setFormData({ ...formData, department_id: e.target.value ? Number(e.target.value) : undefined })}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: 8,
                  background: 'var(--color-bg-input)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-main)',
                  fontSize: 13
                }}
              >
                <option value="">-- 请选择部门 --</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-main)', marginBottom: 6 }}>
                群组管理员 <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-secondary)' }}>(支持姓名/工号搜索)</span>
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
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-main)', marginBottom: 6 }}>
                成员规模 (人) <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-secondary)' }}>- 由 iRight 自动拉取</span>
              </label>
              <input
                type="number"
                min={0}
                value={formData.member_count}
                onChange={e => setFormData({ ...formData, member_count: Number(e.target.value) || 0 })}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: 8,
                  background: 'var(--color-bg-input)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-main)',
                  fontSize: 13
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-main)', marginBottom: 8 }}>启用状态</label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={formData.is_active}
                  onChange={e => setFormData({ ...formData, is_active: e.target.checked })}
                  style={{ width: 16, height: 16, accentColor: 'var(--color-primary)' }}
                />
                <span style={{ color: formData.is_active ? 'var(--color-success)' : 'var(--text-secondary)', fontWeight: 500 }}>
                  {formData.is_active ? '正常启用' : '已停用'}
                </span>
              </label>
            </div>
          </div>

          {/* 6. 备注/说明 */}
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-main)', marginBottom: 6 }}>备注说明 / 管辖范围</label>
            <textarea
              rows={3}
              placeholder="请输入该 Committer Group 的管辖范围、评审职责要求或说明..."
              value={formData.description}
              onChange={e => setFormData({ ...formData, description: e.target.value })}
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: 8,
                background: 'var(--color-bg-input)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-main)',
                fontSize: 13,
                resize: 'vertical'
              }}
            />
          </div>

          {/* 操作按钮 */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 12 }}>
            <button
              type="button"
              onClick={() => setIsFormDrawerOpen(false)}
              className="btn btn-secondary"
              style={{ padding: '9px 18px', borderRadius: 8 }}
              disabled={isSubmitting}
            >
              取消
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              style={{
                padding: '9px 24px',
                borderRadius: 8,
                fontWeight: 600,
                boxShadow: 'var(--shadow-sm)'
              }}
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
