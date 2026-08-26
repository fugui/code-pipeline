import React, { useState, useEffect, useMemo } from 'react'
import { Pagination, usePagination, Drawer } from '@code/common'
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
  FileText
} from 'lucide-react'
import { ManagedCommitterGroup, Department } from '../types'
import { useToast } from '../components/Toast'

interface ManagedCommittersProps {
  isAdmin?: boolean
  apiBase: string
  token: string
}

interface SystemOptionItem {
  id: number
  name: string
  username?: string
  email?: string
  department_name?: string
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

  // System Dropdown Options (Users & Departments)
  const [departments, setDepartments] = useState<Department[]>([])
  const [users, setUsers] = useState<SystemOptionItem[]>([])

  // Pagination standard
  const { page: currentPage, pageSize, setPage: setCurrentPage } = usePagination({ defaultPageSize: 25 })

  // Drawer States
  const [viewGroup, setViewGroup] = useState<ManagedCommitterGroup | null>(null)
  const [isFormDrawerOpen, setIsFormDrawerOpen] = useState<boolean>(false)
  const [editingGroup, setEditingGroup] = useState<ManagedCommitterGroup | null>(null)
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false)
  const [copiedUUID, setCopiedUUID] = useState<string | null>(null)

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

  // Fetch System Options (Users & Departments)
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
        if (Array.isArray(data.users)) {
          setUsers(data.users)
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
      is_active: group.is_active,
      description: group.description || ''
    })
    setIsFormDrawerOpen(true)
  }

  // Submit Form (Create / Edit)
  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name.trim()) {
      showToast('请输入 Committer Group 名称', 'error')
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
        iright_group_name: formData.iright_group_name.trim(),
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
    const l1Count = committerGroups.filter(g => g.level?.startsWith('L1')).length
    const l2Count = committerGroups.filter(g => g.level?.startsWith('L2')).length
    const l3Count = committerGroups.filter(g => g.level?.startsWith('L3')).length

    return { total, active, boundIRight, l1Count, l2Count, l3Count }
  }, [totalCount, committerGroups])

  // Get level badge color
  const getLevelBadgeStyle = (level: string) => {
    if (level?.startsWith('L1')) {
      return { background: 'rgba(168, 85, 247, 0.12)', color: '#c084fc', border: '1px solid rgba(168, 85, 247, 0.25)' }
    }
    if (level?.startsWith('L2')) {
      return { background: 'rgba(59, 130, 246, 0.12)', color: '#60a5fa', border: '1px solid rgba(59, 130, 246, 0.25)' }
    }
    if (level?.startsWith('L3')) {
      return { background: 'rgba(16, 185, 129, 0.12)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.25)' }
    }
    return { background: 'rgba(100, 116, 139, 0.12)', color: '#94a3b8', border: '1px solid rgba(100, 116, 139, 0.25)' }
  }

  return (
    <div style={{ padding: '24px 32px', minHeight: '100%', color: 'var(--text-color, #e2e8f0)' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
              <Users size={26} color="#6366f1" />
              Committer 管理
            </h1>
            <span
              style={{
                fontSize: 12,
                padding: '3px 10px',
                borderRadius: 20,
                background: 'rgba(99, 102, 241, 0.15)',
                color: '#818cf8',
                fontWeight: 600,
                border: '1px solid rgba(99, 102, 241, 0.3)'
              }}
            >
              权限与治理
            </span>
          </div>
          <p style={{ color: 'var(--text-secondary, #94a3b8)', marginTop: 6, marginBottom: 0, fontSize: 13 }}>
            集中维护各层级受控 Committer Group、关联组织部门、管理负责人及 iRight 第三方鉴权标识，保障代码仓合并审批合法合规。
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
                background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                color: '#fff',
                fontWeight: 600,
                boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)'
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
            background: 'var(--card-bg, rgba(30, 41, 59, 0.6))',
            padding: '16px 20px',
            borderRadius: 12,
            border: '1px solid rgba(255, 255, 255, 0.08)',
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
              background: 'rgba(99, 102, 241, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#818cf8'
            }}
          >
            <Users size={22} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary, #94a3b8)' }}>Committer 组总数</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-color, #fff)', marginTop: 2 }}>
              {stats.total}
            </div>
          </div>
        </div>

        <div
          style={{
            background: 'var(--card-bg, rgba(30, 41, 59, 0.6))',
            padding: '16px 20px',
            borderRadius: 12,
            border: '1px solid rgba(255, 255, 255, 0.08)',
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
              color: '#c084fc'
            }}
          >
            <Layers size={22} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary, #94a3b8)' }}>层级分布 (L1 / L2 / L3)</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-color, #fff)', marginTop: 2 }}>
              <span style={{ color: '#c084fc' }}>{stats.l1Count}</span>
              <span style={{ color: 'rgba(255,255,255,0.3)', margin: '0 4px' }}>/</span>
              <span style={{ color: '#60a5fa' }}>{stats.l2Count}</span>
              <span style={{ color: 'rgba(255,255,255,0.3)', margin: '0 4px' }}>/</span>
              <span style={{ color: '#34d399' }}>{stats.l3Count}</span>
            </div>
          </div>
        </div>

        <div
          style={{
            background: 'var(--card-bg, rgba(30, 41, 59, 0.6))',
            padding: '16px 20px',
            borderRadius: 12,
            border: '1px solid rgba(255, 255, 255, 0.08)',
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
              background: 'rgba(16, 185, 129, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#34d399'
            }}
          >
            <CheckCircle2 size={22} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary, #94a3b8)' }}>正常启用状态</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#34d399', marginTop: 2 }}>
              {stats.active} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-secondary)' }}>/ {stats.total}</span>
            </div>
          </div>
        </div>

        <div
          style={{
            background: 'var(--card-bg, rgba(30, 41, 59, 0.6))',
            padding: '16px 20px',
            borderRadius: 12,
            border: '1px solid rgba(255, 255, 255, 0.08)',
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
              background: 'rgba(245, 158, 11, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fbbf24'
            }}
          >
            <Link size={22} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary, #94a3b8)' }}>关联 iRight 绑定</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#fbbf24', marginTop: 2 }}>
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
          background: 'var(--card-bg, rgba(30, 41, 59, 0.6))',
          padding: '14px 18px',
          borderRadius: 12,
          border: '1px solid rgba(255, 255, 255, 0.08)',
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
            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <input
              type="text"
              className="input-field"
              placeholder="搜索组名、iRight 名称或 UUID..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                paddingLeft: 36,
                paddingRight: 12,
                height: 36,
                borderRadius: 8,
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#fff',
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
            <span style={{ fontSize: 13, color: 'var(--text-secondary, #94a3b8)' }}>所属层级:</span>
            <select
              value={levelFilter}
              onChange={e => {
                setLevelFilter(e.target.value)
                setCurrentPage(1)
              }}
              style={{
                height: 36,
                borderRadius: 8,
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#fff',
                padding: '0 10px',
                fontSize: 13
              }}
            >
              <option value="all">全部层级</option>
              <option value="L1-公司级">L1-公司级</option>
              <option value="L2-产品线/域级">L2-产品线/域级</option>
              <option value="L3-项目/模块级">L3-项目/模块级</option>
              <option value="L4-其他">L4-其他</option>
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary, #94a3b8)' }}>归属部门:</span>
            <select
              value={deptFilter}
              onChange={e => {
                setDeptFilter(e.target.value)
                setCurrentPage(1)
              }}
              style={{
                height: 36,
                borderRadius: 8,
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#fff',
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
          background: 'var(--card-bg, rgba(30, 41, 59, 0.6))',
          borderRadius: 12,
          border: '1px solid rgba(255, 255, 255, 0.08)',
          overflow: 'hidden'
        }}
      >
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'rgba(15, 23, 42, 0.8)', borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
                <th style={{ padding: '14px 16px', fontWeight: 600, color: 'var(--text-secondary, #94a3b8)', width: 60 }}>#</th>
                <th style={{ padding: '14px 16px', fontWeight: 600, color: 'var(--text-secondary, #94a3b8)' }}>Committer Group 名称</th>
                <th style={{ padding: '14px 16px', fontWeight: 600, color: 'var(--text-secondary, #94a3b8)' }}>所属层级</th>
                <th style={{ padding: '14px 16px', fontWeight: 600, color: 'var(--text-secondary, #94a3b8)' }}>归属部门</th>
                <th style={{ padding: '14px 16px', fontWeight: 600, color: 'var(--text-secondary, #94a3b8)' }}>管理员</th>
                <th style={{ padding: '14px 16px', fontWeight: 600, color: 'var(--text-secondary, #94a3b8)' }}>iRight 关联群组</th>
                <th style={{ padding: '14px 16px', fontWeight: 600, color: 'var(--text-secondary, #94a3b8)' }}>状态 / 规模</th>
                <th style={{ padding: '14px 16px', fontWeight: 600, color: 'var(--text-secondary, #94a3b8)' }}>创建时间</th>
                <th style={{ padding: '14px 16px', fontWeight: 600, color: 'var(--text-secondary, #94a3b8)', textAlign: 'right' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} style={{ padding: 48, textAlign: 'center', color: 'var(--text-secondary, #94a3b8)' }}>
                    <RefreshCw size={24} className="spin" style={{ margin: '0 auto 10px' }} />
                    正在加载 Committer Group 列表...
                  </td>
                </tr>
              ) : committerGroups.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: 56, textAlign: 'center', color: 'var(--text-secondary, #94a3b8)' }}>
                    <Users size={36} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
                    <div style={{ fontSize: 15, fontWeight: 500 }}>未找到匹配的 Committer Group</div>
                    <div style={{ fontSize: 13, marginTop: 4 }}>可调整筛选项或点击右上角新增 Committer 组</div>
                  </td>
                </tr>
              ) : (
                committerGroups.map((group, idx) => (
                  <tr
                    key={group.id}
                    style={{
                      borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                      transition: 'background 0.2s',
                      cursor: 'pointer'
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    onClick={() => setViewGroup(group)}
                  >
                    <td style={{ padding: '14px 16px', color: 'var(--text-secondary, #64748b)', fontSize: 12 }}>
                      {(currentPage - 1) * pageSize + idx + 1}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ fontWeight: 600, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>{group.name}</span>
                        {group.is_active ? (
                          <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: 'rgba(16, 185, 129, 0.1)', color: '#34d399' }}>
                            启用
                          </span>
                        ) : (
                          <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: 'rgba(239, 68, 68, 0.1)', color: '#f87171' }}>
                            停用
                          </span>
                        )}
                      </div>
                      {group.description && (
                        <div style={{ fontSize: 11, color: 'var(--text-secondary, #94a3b8)', marginTop: 2, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                    <td style={{ padding: '14px 16px', color: 'var(--text-color, #e2e8f0)' }}>
                      {group.department?.name ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <Building2 size={13} color="#94a3b8" />
                          <span>{group.department.name}</span>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-secondary, #64748b)' }}>-</span>
                      )}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      {group.admin ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div
                            style={{
                              width: 22,
                              height: 22,
                              borderRadius: '50%',
                              background: 'rgba(99, 102, 241, 0.2)',
                              color: '#818cf8',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 10,
                              fontWeight: 700
                            }}
                          >
                            {(group.admin.name || group.admin.username || 'A')[0].toUpperCase()}
                          </div>
                          <div>
                            <div style={{ fontSize: 12, color: '#fff' }}>{group.admin.name || group.admin.username}</div>
                            {group.admin.username && group.admin.name && (
                              <div style={{ fontSize: 10, color: 'var(--text-secondary, #94a3b8)' }}>{group.admin.username}</div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-secondary, #64748b)' }}>-</span>
                      )}
                    </td>
                    <td style={{ padding: '14px 16px' }} onClick={e => e.stopPropagation()}>
                      {group.iright_group_id ? (
                        <div>
                          <div style={{ fontWeight: 500, color: '#60a5fa', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Link size={12} />
                            <span>{group.iright_group_name || '已关联 iRight'}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                            <code
                              style={{
                                fontSize: 11,
                                padding: '1px 5px',
                                borderRadius: 4,
                                background: 'rgba(0,0,0,0.3)',
                                color: '#94a3b8',
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
                                color: copiedUUID === group.iright_group_id ? '#34d399' : '#94a3b8'
                              }}
                              title="复制 UUID"
                            >
                              {copiedUUID === group.iright_group_id ? <Check size={12} /> : <Copy size={12} />}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-secondary, #64748b)', fontSize: 12 }}>未绑定</span>
                      )}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span
                        style={{
                          fontSize: 12,
                          padding: '2px 8px',
                          borderRadius: 12,
                          background: 'rgba(255, 255, 255, 0.05)',
                          color: '#e2e8f0'
                        }}
                      >
                        {group.member_count || 0} 人
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px', color: 'var(--text-secondary, #94a3b8)', fontSize: 12 }}>
                      {group.created_at ? new Date(group.created_at).toLocaleDateString('zh-CN') : '-'}
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                        <button
                          onClick={() => setViewGroup(group)}
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
                                background: 'rgba(239, 68, 68, 0.15)',
                                color: '#f87171',
                                border: '1px solid rgba(239, 68, 68, 0.25)'
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
          <div style={{ padding: '16px 20px', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
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
              <Users size={20} color="#818cf8" />
              <span style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>{viewGroup.name}</span>
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
                background: 'rgba(15, 23, 42, 0.6)',
                padding: 18,
                borderRadius: 10,
                border: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 16
              }}
            >
              <div>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>组 ID 编号</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginTop: 3 }}>#{viewGroup.id}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>运行状态</div>
                <div style={{ marginTop: 3 }}>
                  {viewGroup.is_active ? (
                    <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 4, background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', fontWeight: 600 }}>
                      正常启用中
                    </span>
                  ) : (
                    <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 4, background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', fontWeight: 600 }}>
                      已停用
                    </span>
                  )}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>归属部门</div>
                <div style={{ fontSize: 14, color: '#fff', marginTop: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Building2 size={14} color="#818cf8" />
                  {viewGroup.department?.name || '未指定部门'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>组内成员数</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginTop: 3 }}>{viewGroup.member_count || 0} 位 Committer</div>
              </div>
            </div>

            {/* 管理员卡片 */}
            <div
              style={{
                background: 'rgba(15, 23, 42, 0.6)',
                padding: 18,
                borderRadius: 10,
                border: '1px solid rgba(255, 255, 255, 0.08)'
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: '#cbd5e1', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <UserCheck size={16} color="#6366f1" />
                群组管理员信息
              </div>
              {viewGroup.admin ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: '50%',
                      background: 'rgba(99, 102, 241, 0.2)',
                      color: '#818cf8',
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
                    <div style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>{viewGroup.admin.name || viewGroup.admin.username}</div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                      工号/账号: {viewGroup.admin.username} {viewGroup.admin.email ? ` | 邮箱: ${viewGroup.admin.email}` : ''}
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ color: '#94a3b8', fontSize: 13 }}>暂未指定群组管理员</div>
              )}
            </div>

            {/* 第三方 iRight 绑定卡片 */}
            <div
              style={{
                background: 'rgba(15, 23, 42, 0.6)',
                padding: 18,
                borderRadius: 10,
                border: '1px solid rgba(59, 130, 246, 0.2)'
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: '#60a5fa', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Link size={16} />
                第三方 iRight 群组关联映射
              </div>
              {viewGroup.iright_group_id ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>iRight 群组名称</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginTop: 2 }}>
                      {viewGroup.iright_group_name || '未填名称 (已提供 UUID)'}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>iRight 鉴权 ID (UUID)</div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        background: 'rgba(0, 0, 0, 0.4)',
                        padding: '8px 12px',
                        borderRadius: 6,
                        marginTop: 4
                      }}
                    >
                      <code style={{ fontSize: 12, color: '#93c5fd', wordBreak: 'break-all' }}>{viewGroup.iright_group_id}</code>
                      <button
                        onClick={() => handleCopyUUID(viewGroup.iright_group_id || '')}
                        className="btn btn-secondary"
                        style={{ padding: '3px 8px', borderRadius: 4, fontSize: 11, marginLeft: 8 }}
                      >
                        {copiedUUID === viewGroup.iright_group_id ? <Check size={13} color="#34d399" /> : <Copy size={13} />}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ color: '#94a3b8', fontSize: 13 }}>未关联 iRight 第三方群组标识</div>
              )}
            </div>

            {/* 描述与备注 */}
            <div
              style={{
                background: 'rgba(15, 23, 42, 0.6)',
                padding: 18,
                borderRadius: 10,
                border: '1px solid rgba(255, 255, 255, 0.08)'
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: '#cbd5e1', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <FileText size={16} color="#818cf8" />
                职责描述与备注说明
              </div>
              <div style={{ fontSize: 13, color: viewGroup.description ? '#e2e8f0' : '#64748b', lineHeight: 1.6 }}>
                {viewGroup.description || '暂无描述信息'}
              </div>
            </div>

            {/* 时间审计戳 */}
            <div style={{ fontSize: 12, color: '#64748b', display: 'flex', justifyContent: 'space-between', padding: '0 4px' }}>
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
        width="620px"
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {editingGroup ? <Edit3 size={18} color="#818cf8" /> : <Plus size={18} color="#818cf8" />}
            <span style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>
              {editingGroup ? `编辑 Committer Group #${editingGroup.id}` : '新增 Committer Group'}
            </span>
          </div>
        }
      >
        <form onSubmit={handleFormSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Committer Group 名称 */}
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 6 }}>
              Committer Group 名称 <span style={{ color: '#f87171' }}>*</span>
            </label>
            <input
              type="text"
              className="input-field"
              placeholder="例如：CORE-ENGINE-COMMITTERS / GROUP-FINANCE"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              required
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: 8,
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#fff',
                fontSize: 13
              }}
            />
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
              对应托管平台中成员的群组标识（如 list_member 中的 domain_group），代码仓合规巡检将依此核验。
            </div>
          </div>

          {/* 所属层级 */}
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 6 }}>
              所属层级 <span style={{ color: '#f87171' }}>*</span>
            </label>
            <select
              value={formData.level}
              onChange={e => setFormData({ ...formData, level: e.target.value })}
              required
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: 8,
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#fff',
                fontSize: 13
              }}
            >
              <option value="L1-公司级">L1-公司级（最高权限管辖范围）</option>
              <option value="L2-产品线/域级">L2-产品线/域级（产品线或业务域）</option>
              <option value="L3-项目/模块级">L3-项目/模块级（具体子系统或微服务模块）</option>
              <option value="L4-其他">L4-其他（跨组或专项小组）</option>
            </select>
          </div>

          {/* 归属部门 & 管理员 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 6 }}>归属部门</label>
              <select
                value={formData.department_id || ''}
                onChange={e => setFormData({ ...formData, department_id: e.target.value ? Number(e.target.value) : undefined })}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: 8,
                  background: 'rgba(15, 23, 42, 0.6)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  color: '#fff',
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
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 6 }}>群组管理员</label>
              <select
                value={formData.admin_id || ''}
                onChange={e => setFormData({ ...formData, admin_id: e.target.value ? Number(e.target.value) : undefined })}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: 8,
                  background: 'rgba(15, 23, 42, 0.6)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  color: '#fff',
                  fontSize: 13
                }}
              >
                <option value="">-- 请选择管理员 --</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.name || u.username} {u.department_name ? `(${u.department_name})` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* iRight 关联群组名称 & ID (UUID) */}
          <div
            style={{
              background: 'rgba(59, 130, 246, 0.05)',
              padding: 16,
              borderRadius: 10,
              border: '1px solid rgba(59, 130, 246, 0.15)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: '#60a5fa', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Link size={15} />
              第三方 iRight 鉴权关联配置
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, color: '#cbd5e1', marginBottom: 4 }}>iRight 群组名称</label>
              <input
                type="text"
                placeholder="例如：IRIGHT-SEC-DEV-GROUP"
                value={formData.iright_group_name}
                onChange={e => setFormData({ ...formData, iright_group_name: e.target.value })}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 6,
                  background: 'rgba(15, 23, 42, 0.7)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#fff',
                  fontSize: 13
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, color: '#cbd5e1', marginBottom: 4 }}>iRight 群组 ID (UUID 字符串)</label>
              <input
                type="text"
                placeholder="例如：3fa85f64-5717-4562-b3fc-2c963f66afa6"
                value={formData.iright_group_id}
                onChange={e => setFormData({ ...formData, iright_group_id: e.target.value })}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 6,
                  background: 'rgba(15, 23, 42, 0.7)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#93c5fd',
                  fontFamily: 'monospace',
                  fontSize: 12
                }}
              />
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>用于在第三方权限系统对齐并自动拉取群组成员凭证。</div>
            </div>
          </div>

          {/* 成员规模 & 启用开关 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, alignItems: 'center' }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 6 }}>成员规模 (预估/当前人数)</label>
              <input
                type="number"
                min={0}
                value={formData.member_count}
                onChange={e => setFormData({ ...formData, member_count: Number(e.target.value) || 0 })}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: 8,
                  background: 'rgba(15, 23, 42, 0.6)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  color: '#fff',
                  fontSize: 13
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 8 }}>启用状态</label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={formData.is_active}
                  onChange={e => setFormData({ ...formData, is_active: e.target.checked })}
                  style={{ width: 16, height: 16, accentColor: '#6366f1' }}
                />
                <span style={{ color: formData.is_active ? '#34d399' : '#94a3b8' }}>
                  {formData.is_active ? '正常启用' : '已停用'}
                </span>
              </label>
            </div>
          </div>

          {/* 备注/说明 */}
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 6 }}>备注说明 / 管辖范围</label>
            <textarea
              rows={3}
              placeholder="请输入该 Committer Group 的管辖范围、评审职责要求或说明..."
              value={formData.description}
              onChange={e => setFormData({ ...formData, description: e.target.value })}
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: 8,
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#fff',
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
                background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                color: '#fff'
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
