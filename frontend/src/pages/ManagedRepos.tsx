import React, { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { 
  GitBranch, Folder, Plus, Search, Users, AlertCircle, RefreshCw, Send, CheckCircle2, ChevronRight, ChevronDown, Eye, EyeOff, Trash2, Zap, X, Archive
} from 'lucide-react'

interface ManagedGroup {
  id: number
  name: string
  path: string
  full_path: string
  parent_id?: number
  synced_at?: string
  is_hidden?: boolean
}

interface ManagedRepository {
  id: number
  managed_group_id: number
  group?: ManagedGroup
  name: string
  ssh_url: string
  http_url: string
  owner_id: number
  owner?: { id: number; name?: string; username?: string; email?: string }
  department_id?: number
  department?: { id: number; name: string }
  subsystem_id?: number
  subsystem?: { id: number; name: string }
  language?: string
  machine_type?: string
  tags?: string
  description?: string
  default_branch?: string
  is_active: boolean
  is_archived?: boolean
  is_hidden?: boolean
  webhook_registered: boolean
  branch_count?: number
  active_count?: number
  stale_unmerged_count?: number
  stale_merged_count?: number
  last_commit_time?: string
  created_at: string
}

interface BranchMonitor {
  id: number
  managed_repository_id: number
  branch_name: string
  last_commit_hash: string
  last_commit_time: string
  last_author: string
  is_merged: boolean
  is_protected: boolean
  status: 'active' | 'merged_stale' | 'unmerged_stale'
}

interface TreeNode {
  group: ManagedGroup
  children: TreeNode[]
}

const sortGroupsAsTree = (flatGroups: ManagedGroup[]): ManagedGroup[] => {
  const groupMap: Record<number, TreeNode> = {}
  flatGroups.forEach(g => {
    groupMap[g.id] = { group: g, children: [] }
  })

  const roots: TreeNode[] = []
  
  flatGroups.forEach(g => {
    const node = groupMap[g.id]
    if (g.parent_id && groupMap[g.parent_id]) {
      groupMap[g.parent_id].children.push(node)
    } else {
      roots.push(node)
    }
  })

  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.group.name.localeCompare(b.group.name))
    nodes.forEach(n => sortNodes(n.children))
  }
  sortNodes(roots)

  const result: ManagedGroup[] = []
  const dfs = (node: TreeNode) => {
    result.push(node.group)
    node.children.forEach(dfs)
  }
  roots.forEach(dfs)

  return result
}

const isAnyAncestorHidden = (group: ManagedGroup, allGroups: ManagedGroup[]): boolean => {
  let current: ManagedGroup | undefined = group
  while (current && current.parent_id) {
    const parent: ManagedGroup | undefined = allGroups.find(g => g.id === current?.parent_id)
    if (parent && parent.is_hidden) {
      return true
    }
    current = parent
  }
  return false
}

interface ManagedReposProps {
  isAdmin?: boolean
  apiBase: string
  token: string
}

export const ManagedRepos: React.FC<ManagedReposProps> = ({ isAdmin = true, apiBase, token }) => {
  const formatLastCommitTime = (timeStr?: string) => {
    if (!timeStr || timeStr.startsWith('0001-01-01')) return '-'
    try {
      const date = new Date(timeStr)
      if (date.getFullYear() <= 1970) return '-'
      return date.toLocaleString('zh-CN', { hour12: false }).replace(/:\d{2}$/, '')
    } catch {
      return '-'
    }
  }

  // Lists
  const [groups, setGroups] = useState<ManagedGroup[]>([])
  const [repos, setRepos] = useState<ManagedRepository[]>([])
  const [selectedGroup, setSelectedGroup] = useState<ManagedGroup | null>(null)
  
  // Audits state for active repo
  const [activeRepo, setActiveRepo] = useState<ManagedRepository | null>(null)
  const [branches, setBranches] = useState<BranchMonitor[]>([])
  const [branchStatusFilter, setBranchStatusFilter] = useState<string>('all')
  const [isAuditing, setIsAuditing] = useState(false)
  const [selectedBranchNames, setSelectedBranchNames] = useState<string[]>([])
  const [isCleaningBranches, setIsCleaningBranches] = useState(false)
  const [activeTab, setActiveTab] = useState<'branches' | 'acl'>('branches')
  
  // ACL state for active target
  const [acls, setAcls] = useState<any[]>([])
  const [showAddAclModal, setShowAddAclModal] = useState(false)
  const [aclTargetType, setAclTargetType] = useState<'group' | 'repository'>('repository')
  const [aclTargetID, setAclTargetID] = useState<number>(0)
  
  // Search
  const [repoSearchQuery, setRepoSearchQuery] = useState('')
  const [groupSearchQuery, setGroupSearchQuery] = useState('')
  const [showHidden, setShowHidden] = useState(false)

  // Sort & Pagination states
  const [searchParams, setSearchParams] = useSearchParams()
  const [sortField, setSortField] = useState<'name' | 'branch_count' | 'last_commit_time' | null>(null)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(15)
  const [hasInitialized, setHasInitialized] = useState(false)

  const handleSort = (field: 'name' | 'branch_count' | 'last_commit_time') => {
    if (sortField === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortOrder('asc')
    }
    const newParams = new URLSearchParams(searchParams)
    newParams.set('page', '1')
    setSearchParams(newParams)
  }

  const handlePageChange = (newPage: number) => {
    const newParams = new URLSearchParams(searchParams)
    newParams.set('page', newPage.toString())
    setSearchParams(newParams)
  }

  const handlePageSizeChange = (newSize: number) => {
    const newParams = new URLSearchParams(searchParams)
    newParams.set('page_size', newSize.toString())
    newParams.set('page', '1')
    setSearchParams(newParams)
  }

  // 监听并同步 URL 参数变化到组件 State（Single Source of Truth 还原）
  useEffect(() => {
    const paramGroupId = searchParams.get('group_id')
    const paramPage = searchParams.get('page')
    const paramPageSize = searchParams.get('page_size')

    // 1. 同步 page_size
    const size = paramPageSize ? Number(paramPageSize) : 15
    if ([15, 25, 50, 100].includes(size)) {
      setPageSize(size)
    } else {
      setPageSize(15)
    }

    // 2. 同步 page
    const page = paramPage ? Number(paramPage) : 1
    if (!isNaN(page) && page > 0) {
      setCurrentPage(page)
    } else {
      setCurrentPage(1)
    }

    // 3. 同步 selectedGroup 与数据拉取
    if (paramGroupId) {
      const groupId = Number(paramGroupId)
      if (!isNaN(groupId)) {
        if (groups.length > 0) {
          const found = groups.find(g => g.id === groupId)
          if (found) {
            if (selectedGroup?.id !== found.id) {
              setSelectedGroup(found)
              fetchRepos(found.id)
            }
          } else {
            setSelectedGroup(null)
            fetchRepos(undefined)
          }
        }
      }
    } else {
      if (selectedGroup !== null || !hasInitialized) {
        setSelectedGroup(null)
        fetchRepos(undefined)
        setHasInitialized(true)
      }
    }
  }, [searchParams, groups, hasInitialized])

  // 在搜索词改变时，重置 URL 页码为 1
  useEffect(() => {
    if (searchParams.get('page') !== '1' && repoSearchQuery !== '') {
      const newParams = new URLSearchParams(searchParams)
      newParams.set('page', '1')
      setSearchParams(newParams)
    }
  }, [repoSearchQuery])

  // Modals visibility
  const [showGroupModal, setShowGroupModal] = useState(false)
  const [showRepoModal, setShowRepoModal] = useState(false)
  const [showBranchModal, setShowBranchModal] = useState(false)

  // Form states
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupPath, setNewGroupPath] = useState('')


  const [newRepoName, setNewRepoName] = useState('')
  const [newRepoGroup, setNewRepoGroup] = useState<number>(0)
  const [newRepoOwnerID, setNewRepoOwnerID] = useState<number | ''>('')
  const [newRepoSubsystemID, setNewRepoSubsystemID] = useState<number | ''>('')
  const [newRepoDepartmentID, setNewRepoDepartmentID] = useState<number | ''>('')
  const [newRepoLanguage, setNewRepoLanguage] = useState('C')
  const [newRepoMachineTypes, setNewRepoMachineTypes] = useState<string[]>(['上位机'])
  const [newRepoTags, setNewRepoTags] = useState('')
  const [newRepoDescription, setNewRepoDescription] = useState('')
  const [newRepoDefaultBranch, setNewRepoDefaultBranch] = useState('master')

  // System linked options (Users, Departments, Subsystems)
  interface SystemUserOption {
    id: number
    name: string
    username: string
    email: string
  }
  interface SystemNamedOption {
    id: number
    name: string
  }
  const [systemUsers, setSystemUsers] = useState<SystemUserOption[]>([])
  const [systemDepartments, setSystemDepartments] = useState<SystemNamedOption[]>([])
  const [systemSubsystems, setSystemSubsystems] = useState<SystemNamedOption[]>([])

  const fetchSystemOptions = () => {
    fetch(`${apiBase}/system-options`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(data => {
      if (data.users && Array.isArray(data.users)) setSystemUsers(data.users)
      if (data.departments && Array.isArray(data.departments)) setSystemDepartments(data.departments)
      if (data.subsystems && Array.isArray(data.subsystems)) setSystemSubsystems(data.subsystems)
    })
    .catch(err => console.error('Failed to fetch system options:', err))
  }

  const resetRepoForm = () => {
    setShowRepoModal(false)
    setNewRepoName('')
    setNewRepoGroup(0)
    setNewRepoOwnerID('')
    setNewRepoSubsystemID('')
    setNewRepoDepartmentID('')
    setNewRepoLanguage('C')
    setNewRepoMachineTypes(['上位机'])
    setNewRepoTags('')
    setNewRepoDescription('')
    setNewRepoDefaultBranch('master')
  }

  const [newBranchName, setNewBranchName] = useState('')
  const [newBranchSource, setNewBranchSource] = useState('master')
  const [branchNameError, setBranchNameError] = useState('')
  const [isCreatingBranch, setIsCreatingBranch] = useState(false)

  const [newAclPrincipalType, setNewAclPrincipalType] = useState<'user' | 'user_group'>('user')
  const [newAclPrincipalID, setNewAclPrincipalID] = useState<number>(0)
  const [newAclPrincipalName, setNewAclPrincipalName] = useState('')
  const [newAclLevel, setNewAclLevel] = useState<number>(30) // Default Developer

  const [isSyncingGroup, setIsSyncingGroup] = useState(false)

  // Toast message
  const [toastMsg, setToastMsg] = useState<{ type: 'success' | 'error' | 'warning', text: string } | null>(null)

  const showToast = (type: 'success' | 'error' | 'warning', text: string) => {
    setToastMsg({ type, text })
    setTimeout(() => setToastMsg(null), 4000)
  }

  const [expandedGroups, setExpandedGroups] = useState<Record<number, boolean>>({})

  const isGroupVisible = (g: ManagedGroup) => {
    let parentId = g.parent_id
    while (parentId) {
      const parent = groups.find(x => x.id === parentId)
      if (!parent) break
      if (!expandedGroups[parentId]) {
        return false
      }
      parentId = parent.parent_id
    }
    return true
  }

  const toggleGroupExpand = (groupId: number, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpandedGroups(prev => ({
      ...prev,
      [groupId]: !prev[groupId]
    }))
  }

  useEffect(() => {
    fetchGroups()
    fetchSystemOptions()
  }, [])

  const fetchGroups = () => {
    fetch(`${apiBase}/managed-groups`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(data => {
      setGroups(Array.isArray(data) ? data : [])
    })
    .catch(err => showToast('error', `获取 Group 失败: ${err.message}`))
  }

  const [showArchived, setShowArchived] = useState(false)

  const fetchRepos = (groupId?: number, includeArchivedOverride?: boolean) => {
    const incArchived = includeArchivedOverride !== undefined ? includeArchivedOverride : showArchived
    let url = `${apiBase}/managed-repos?include_archived=${incArchived}`
    if (groupId) {
      url += `&group_id=${groupId}`
    }
    fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(data => setRepos(Array.isArray(data) ? data : []))
    .catch(err => showToast('error', `获取 Repo 失败: ${err.message}`))
  }

  const handleGroupSelect = (group: ManagedGroup | null) => {
    const newParams = new URLSearchParams(searchParams)
    if (group) {
      newParams.set('group_id', group.id.toString())
    } else {
      newParams.delete('group_id')
    }
    newParams.set('page', '1')
    setSearchParams(newParams)
  }

  // Branch Audits Fetch
  const fetchBranchAudits = (repoId: number, status = 'all') => {
    setSelectedBranchNames([])
    fetch(`${apiBase}/managed-repos/${repoId}/branches_audit?status=${status}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(data => setBranches(Array.isArray(data) ? data : []))
    .catch(err => showToast('error', `获取分支审计列表失败: ${err.message}`))
  }

  const handleTriggerAudit = (repoId: number) => {
    setIsAuditing(true)
    fetch(`${apiBase}/managed-repos/${repoId}/branches_audit/trigger`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => {
      if (!res.ok) throw new Error('审计分析请求失败')
      return res.json()
    })
    .then(() => {
      showToast('success', '分支活跃度增量分析审计成功！')
      fetchBranchAudits(repoId, branchStatusFilter)
    })
    .catch(err => showToast('error', `启动审计失败: ${err.message}`))
    .finally(() => setIsAuditing(false))
  }

  // Notify Owner to Cleanup
  const handleNotifyOwner = (repoId: number, branchName: string, author: string) => {
    fetch(`${apiBase}/managed-repos/${repoId}/branches_audit/notify`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        branch_name: branchName,
        owner_name: author
      })
    })
    .then(res => {
      if (!res.ok) throw new Error('发送通知失败')
      return res.json()
    })
    .then(() => {
      showToast('success', `清理通知已成功送达负责人: ${author}`)
    })
    .catch(err => showToast('error', `发送通知失败: ${err.message}`))
  }

  // Cleanup Branches (Physical Delete)
  const handleCleanupBranches = (branchNames: string[]) => {
    if (!activeRepo || branchNames.length === 0) return

    const targetBranches = branches.filter(b => branchNames.includes(b.branch_name))
    const hasUnmerged = targetBranches.some(b => b.status === 'unmerged_stale')

    if (hasUnmerged) {
      const confirmInput = window.prompt(
        `⚠️ 警告：要清理的分支中包含【未合并的僵尸分支】！物理删除会导致未合并的代码提交永久丢失！\n\n请输入 "DELETE" 以确认进行物理删除：\n\n待删除分支:\n${branchNames.slice(0, 5).join('\n')}${branchNames.length > 5 ? '\n...' : ''}`
      )
      if (confirmInput !== 'DELETE') {
        if (confirmInput !== null) {
          showToast('error', '二次确认输入不匹配，已取消物理删除')
        }
        return
      }
    } else {
      const confirmMsg = `确定要在远程平台物理删除以下 ${branchNames.length} 个分支吗？\n\n${branchNames.slice(0, 8).join('\n')}${branchNames.length > 8 ? '\n...' : ''}\n\n注意：物理删除后无法撤销，但代码已安全合入主干。`
      const isConfirmed = window.confirm(confirmMsg)
      if (!isConfirmed) return
    }

    setIsCleaningBranches(true)
    fetch(`${apiBase}/managed-repos/${activeRepo.id}/branches/cleanup`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ branch_names: branchNames })
    })
    .then(res => {
      if (!res.ok) return res.json().then(data => { throw new Error(data.error || '物理删除失败') })
      return res.json()
    })
    .then(data => {
      showToast('success', data.message || '物理删除分支成功！')
      setSelectedBranchNames([])
      fetchBranchAudits(activeRepo.id, branchStatusFilter)
      fetchRepos(selectedGroup?.id)
    })
    .catch(err => showToast('error', `物理删除分支失败: ${err.message}`))
    .finally(() => setIsCleaningBranches(false))
  }


  const handleToggleRepoArchive = (repo: ManagedRepository) => {
    fetch(`${apiBase}/managed-repos/${repo.id}/toggle-archive`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(data => {
      if (data.error) {
        showToast('error', data.error)
      } else {
        showToast('success', repo.is_archived ? '已成功解档代码仓' : '已成功归档代码仓（自动置为非活跃与隐藏）')
        fetchRepos(selectedGroup?.id)
      }
    })
    .catch(err => showToast('error', `更新归档状态失败: ${err.message}`))
  }

  // Sync Group subgroups & repos from remote CodeHub
  const handleSyncGroup = () => {
    if (!selectedGroup) return

    const confirmSync = window.confirm(
      `确定要同步组 "${selectedGroup.name}" 吗？\n系统将在后台进行递归同步，差量更新所有子组和代码仓，并更新其对应的分支数据。`
    )
    if (!confirmSync) return

    setIsSyncingGroup(true)
    fetch(`${apiBase}/managed-groups/${selectedGroup.id}/sync`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => {
      if (!res.ok) throw new Error('同步请求失败')
      return res.json()
    })
    .then(data => {
      showToast('success', data.message || '同步任务已成功提交到后台处理队列，系统正在同步中...')
      fetchGroups()
    })
    .catch(err => showToast('error', `同步组失败: ${err.message}`))
    .finally(() => setIsSyncingGroup(false))
  }

  const handleToggleGroupHide = (group: ManagedGroup) => {
    fetch(`${apiBase}/managed-groups/${group.id}/toggle-hide`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => {
      if (!res.ok) throw new Error('操作失败')
      return res.json()
    })
    .then((data) => {
      const nextHide = !!data.is_hidden
      showToast('success', nextHide ? `已隐藏组 "${group.name}"` : `已取消隐藏组 "${group.name}"`)
      if (selectedGroup?.id === group.id) {
        setSelectedGroup({
          ...selectedGroup,
          is_hidden: nextHide
        })
      }
      setGroups(prev => prev.map(g => g.id === group.id ? { ...g, is_hidden: nextHide } : g))
      fetchGroups()
    })
    .catch(err => showToast('error', `操作失败: ${err.message}`))
  }

  // Create Group
  const handleCreateGroup = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newGroupName || !newGroupPath) return

    fetch(`${apiBase}/managed-groups`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: newGroupName,
        path: newGroupPath,
        parent_id: null
      })
    })
    .then(res => {
      if (!res.ok) throw new Error('创建组失败')
      return res.json()
    })
    .then(() => {
      showToast('success', `嵌套组 "${newGroupName}" 创建成功！`)
      setShowGroupModal(false)
      setNewGroupName('')
      setNewGroupPath('')
      fetchGroups()
    })
    .catch(err => showToast('error', err.message))
  }

  // Create Repository Approval Request
  const handleCreateRepo = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newRepoName || !newRepoGroup) return

    const payload = {
      type: 'repo_create',
      managed_group_id: newRepoGroup,
      repo_name: newRepoName,
      name: newRepoName,
      owner_id: newRepoOwnerID || undefined,
      department_id: newRepoDepartmentID || undefined,
      subsystem_id: newRepoSubsystemID || undefined,
      language: newRepoLanguage,
      machine_type: newRepoMachineTypes.join(', '),
      tags: newRepoTags,
      description: newRepoDescription,
      default_branch: newRepoDefaultBranch,
      target_branch: newRepoDefaultBranch,
      reason: newRepoDescription || '申请新建被管代码仓'
    }


    // 所有角色（即便是管理员）统一提交审批申请单
    fetch(`${apiBase}/managed-approvals`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })
    .then(async res => {
      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.error || '提交申请单失败')
      }
      return res.json()
    })
    .then(() => {
      showToast('success', `代码仓 "${newRepoName}" 创建申请单已成功提交！等待审批核准。`)
      resetRepoForm()
    })
    .catch(err => showToast('error', err.message))
  }

  // Create Feature Branch
  const handleCreateBranch = (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeRepo || !newBranchName) return

    // 前置命名校验：强制限制以 feature 开头
    if (!newBranchName.startsWith('feature')) {
      setBranchNameError('警告：受保护开发分支必须以 "feature" 前缀开头 (例如 feature-auth 或 feature/auth)')
      return
    }
    setBranchNameError('')
    setIsCreatingBranch(true)

    fetch(`${apiBase}/managed-repos/${activeRepo.id}/branches`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        branch_name: newBranchName,
        source_branch: newBranchSource
      })
    })
    .then(async res => {
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || '分支拉取失败')
      }
      if (data.warning) {
        showToast('warning', `分支已拉取，但分支保护规则自动下发失败: ${data.warning}`)
      } else {
        showToast('success', `分支 "${newBranchName}" 创建并锁定保护规则成功！`)
      }
      setShowBranchModal(false)
      setNewBranchName('')
      fetchBranchAudits(activeRepo.id, branchStatusFilter)
    })
    .catch(err => showToast('error', err.message))
    .finally(() => setIsCreatingBranch(false))
  }

  // Configure ACL
  const handleAddAcl = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newAclPrincipalID || !newAclPrincipalName) return

    fetch(`${apiBase}/managed-acl`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        target_type: aclTargetType,
        target_id: aclTargetID,
        principal_type: newAclPrincipalType,
        principal_id: newAclPrincipalID,
        principal_name: newAclPrincipalName,
        access_level: newAclLevel
      })
    })
    .then(async res => {
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || '授权同步失败')
      }
      showToast('success', `授权成功！已将角色配置下发至 Git 平台。`)
      setShowAddAclModal(false)
      setNewAclPrincipalID(0)
      setNewAclPrincipalName('')
      // 重新加载本地 ACL 缓存以供展示
      fetchAcls(aclTargetType, aclTargetID)
    })
    .catch(err => showToast('error', err.message))
  }

  // Load ACL local configuration
  const fetchAcls = (_targetType: 'group' | 'repository', _targetId: number) => {
    // 模拟从 ManagedMemberAccess 中拉取列表并缓存展现
    // 在真实应用中，这会对应 GET /api/managed-acl?target_type=...&target_id=...
    // 这里做基础 Mock 展示
    setAcls([
      { id: 1, principal_type: 'user', principal_name: '架构师B (arch-b)', access_level: 50, sync_status: 'synced', updated_at: '2026-07-17 12:00' },
      { id: 2, principal_type: 'user_group', principal_name: '研发一部前端组 (fe-group)', access_level: 30, sync_status: 'synced', updated_at: '2026-07-17 14:30' },
      { id: 3, principal_type: 'user', principal_name: '开发者C (dev-c)', access_level: 30, sync_status: 'synced', updated_at: '2026-07-17 15:10' }
    ])
  }

  const handleOpenAclManager = (type: 'group' | 'repository', targetId: number) => {
    setAclTargetType(type)
    setAclTargetID(targetId)
    fetchAcls(type, targetId)
  }

  // Filters group list based on search and sort as a tree DFS
  const filteredGroups = sortGroupsAsTree(
    groups.filter(g => 
      g.name.toLowerCase().includes(groupSearchQuery.toLowerCase()) ||
      g.full_path.toLowerCase().includes(groupSearchQuery.toLowerCase()) ||
      g.id.toString().includes(groupSearchQuery)
    )
  )

  // Filters repos list based on search
  const filteredRepos = repos.filter(r => 
    r.name.toLowerCase().includes(repoSearchQuery.toLowerCase()) ||
    r.ssh_url.toLowerCase().includes(repoSearchQuery.toLowerCase())
  )

  // Sort repos based on sortField
  const sortedRepos = [...filteredRepos].sort((a, b) => {
    if (!sortField) return 0

    if (sortField === 'name') {
      const valA = a.name || ''
      const valB = b.name || ''
      return sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA)
    }

    if (sortField === 'branch_count') {
      const valA = a.branch_count || 0
      const valB = b.branch_count || 0
      if (valA !== valB) {
        return sortOrder === 'asc' ? valA - valB : valB - valA
      }
      return 0
    }

    if (sortField === 'last_commit_time') {
      const parseTime = (timeStr?: string): number => {
        if (!timeStr || timeStr.startsWith('0001-01-01')) return 0
        const t = Date.parse(timeStr)
        return isNaN(t) ? 0 : t
      }
      const valA = parseTime(a.last_commit_time)
      const valB = parseTime(b.last_commit_time)
      if (valA !== valB) {
        return sortOrder === 'asc' ? valA - valB : valB - valA
      }
      return 0
    }

    return 0
  })

  // Paginate repos
  const totalItems = sortedRepos.length
  const totalPages = Math.ceil(totalItems / pageSize) || 1
  const paginatedRepos = sortedRepos.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const mergedStale = branches.filter(b => b.status === 'merged_stale').length
  const unmergedStale = branches.filter(b => b.status === 'unmerged_stale').length

  return (
    <div style={{ display: 'flex', gap: 24, height: 'calc(100vh - 120px)' }}>
      {/* Toast Alert */}
      {toastMsg && (
        <div style={{
          position: 'fixed', top: 24, right: 24, zIndex: 1000,
          padding: '12px 24px', borderRadius: 8,
          background: toastMsg.type === 'success' ? '#10b981' : toastMsg.type === 'error' ? '#ef4444' : '#f59e0b',
          color: '#ffffff', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.3)',
          display: 'flex', alignItems: 'center', gap: 8,
          animation: 'slideIn 0.2s ease-out'
        }}>
          {toastMsg.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span style={{ fontWeight: 600 }}>{toastMsg.text}</span>
        </div>
      )}

      {/* Group Sidebar */}
      <div className="glass-card" style={{ width: 280, display: 'flex', flexDirection: 'column', padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Groups</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input 
              type="checkbox" 
              id="checkbox-show-hidden" 
              checked={showHidden} 
              onChange={(e) => setShowHidden(e.target.checked)} 
              style={{ cursor: 'pointer', width: 15, height: 15, margin: 0 }}
              title="显示已隐藏嵌套组"
            />
            {isAdmin && (
              <button onClick={() => setShowGroupModal(true)} className="btn btn-secondary btn-small" style={{ padding: '4px 8px' }}>
                <Plus size={14} /> 新建组
              </button>
            )}
          </div>
        </div>
        
        <div style={{ position: 'relative', marginBottom: 16 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-secondary)' }} />
          <input 
            type="text" 
            placeholder="搜索组..." 
            value={groupSearchQuery}
            onChange={(e) => setGroupSearchQuery(e.target.value)}
            style={{ width: '100%', padding: '6px 12px 6px 30px', fontSize: 13, background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 6, color: 'var(--text-main)' }}
          />
        </div>

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <button 
            onClick={() => handleGroupSelect(null)} 
            className={`group-tree-node ${selectedGroup === null ? 'active' : ''}`}
            style={{ paddingLeft: 26 }}
          >
            <Folder size={14} color={selectedGroup === null ? 'var(--border-active)' : 'var(--text-muted)'} /> 
            <span>[全部仓库]</span>
          </button>
          
          {filteredGroups.filter(g => {
            if (!isGroupVisible(g)) return false
            if (!showHidden && (g.is_hidden || isAnyAncestorHidden(g, groups))) {
              return false
            }
            return true
          }).map(g => {
            const isExpanded = !!expandedGroups[g.id]
            const depth = g.full_path.split('/').length - 1
            const hasChildren = groups.some(x => x.parent_id === g.id)
            const isSelfOrParentHidden = g.is_hidden || isAnyAncestorHidden(g, groups)
            return (
              <button 
                key={g.id}
                onClick={() => handleGroupSelect(g)} 
                className={`group-tree-node ${selectedGroup?.id === g.id ? 'active' : ''}`}
                style={{ 
                  paddingLeft: 8 + depth * 14,
                  opacity: isSelfOrParentHidden ? 0.4 : (g.synced_at ? 1 : 0.65)
                }}
                title={
                  isSelfOrParentHidden 
                    ? '该组（或其父组）已被标记隐藏，默认不参与展示' 
                    : (g.synced_at ? `已同步，最近同步时间: ${new Date(g.synced_at).toLocaleString('zh-CN', { hour12: false })}` : '尚未进行同步，请点击右上角同步按钮进行同步')
                }
              >
                {/* 展开/折叠三角图标 */}
                {hasChildren ? (
                  <span 
                    onClick={(e) => toggleGroupExpand(g.id, e)}
                    style={{ 
                      display: 'inline-flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      width: 16, 
                      height: 16, 
                      cursor: 'pointer',
                      color: 'var(--text-muted)',
                      marginRight: 2
                    }}
                  >
                    {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </span>
                ) : (
                  <span style={{ width: 16, marginRight: 2 }} />
                )}
                
                <Folder size={14} color={selectedGroup?.id === g.id ? 'var(--border-active)' : 'var(--text-muted)'} /> 
                <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', textDecoration: isSelfOrParentHidden ? 'line-through' : 'none' }}>
                  {g.name}
                  {isSelfOrParentHidden ? (
                    <span style={{ fontSize: 10, color: 'var(--text-secondary)', marginLeft: 4, fontStyle: 'italic' }}>(已隐藏)</span>
                  ) : (
                    !g.synced_at && <span style={{ fontSize: 10, color: 'var(--text-secondary)', marginLeft: 4, fontStyle: 'italic' }}>(未同步)</span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Main Panel */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 20, overflow: 'hidden' }}>
        
        {/* Statistics & Quick Actions */}
        <div className="glass-card" style={{ padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
              {selectedGroup ? `当前组：${selectedGroup.full_path}` : '全部辖区被管代码仓'}
              {selectedGroup && (
                <span style={{ 
                  fontSize: 12, 
                  fontWeight: 500, 
                  padding: '2px 8px', 
                  borderRadius: 12, 
                  background: selectedGroup.synced_at ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', 
                  color: selectedGroup.synced_at ? '#10b981' : '#ef4444',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4
                }}>
                  {selectedGroup.synced_at ? `已同步 (${new Date(selectedGroup.synced_at).toLocaleString('zh-CN', { hour12: false }).replace(/:\d{2}$/, '')})` : '未同步'}
                </span>
              )}
            </h2>
            <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: 13 }}>
              所有的代码仓创建与保护分支拉取，均受到统一策略校验和标准化下发。
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {isAdmin && selectedGroup && (
              <>
                <button 
                  onClick={() => handleToggleGroupHide(selectedGroup)} 
                  className="btn btn-secondary"
                  title={selectedGroup.is_hidden ? '取消屏蔽隐藏，使此组重新在大盘和树节点中展示' : '将该组屏蔽隐藏，默认不参与展示'}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  {selectedGroup.is_hidden ? <Eye size={15} /> : <EyeOff size={15} />}
                  {selectedGroup.is_hidden ? '显示此组' : '隐藏此组'}
                </button>
                <button 
                  onClick={handleSyncGroup} 
                  className="btn btn-secondary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  title="同步当前组子树"
                  disabled={isSyncingGroup}
                >
                  <RefreshCw size={15} className={isSyncingGroup ? 'animate-spin' : ''} />
                  同步此组
                </button>
              </>
            )}
            <button onClick={() => {
              if (groups.length === 0) {
                showToast('error', '系统中暂无嵌套组，请先联系管理员创建顶层组！')
                return
              }
              setNewRepoGroup(selectedGroup?.id || groups[0]?.id || 0)
              setShowRepoModal(true)
            }} className="btn btn-primary">
              <Plus size={16} /> 申请新建代码仓
            </button>
          </div>
        </div>

        {/* Repository Table */}
        <div className="glass-card" style={{ flex: 1, padding: 24, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>被管仓明细</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none' }}>
                <input 
                  type="checkbox" 
                  checked={showArchived}
                  onChange={(e) => {
                    setShowArchived(e.target.checked)
                    fetchRepos(selectedGroup?.id, e.target.checked)
                  }}
                />
                显示已归档代码仓
              </label>
              <div style={{ position: 'relative', width: 260 }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-secondary)' }} />
                <input 
                  type="text" 
                  placeholder="检索仓库名称或 SSHURL..." 
                  value={repoSearchQuery}
                  onChange={(e) => setRepoSearchQuery(e.target.value)}
                  style={{ width: '100%', padding: '6px 12px 6px 30px', fontSize: 13, background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 6, color: 'var(--text-main)' }}
                />
              </div>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontSize: 13 }}>
                  <th style={{ padding: '12px 8px' }}>仓库 ID</th>
                  <th 
                    onClick={() => handleSort('name')} 
                    style={{ padding: '12px 8px', cursor: 'pointer', userSelect: 'none' }}
                    title="点击按仓库名称排序"
                  >
                    仓库名称 {sortField === 'name' ? (sortOrder === 'asc' ? '↑' : '↓') : '↕'}
                  </th>
                  <th style={{ padding: '12px 8px' }}>所属嵌套组</th>
                  <th 
                    onClick={() => handleSort('branch_count')} 
                    style={{ padding: '12px 8px', cursor: 'pointer', userSelect: 'none' }}
                    title="点击按分支总数排序"
                  >
                    分支数 (活/僵/已合并) {sortField === 'branch_count' ? (sortOrder === 'asc' ? '↑' : '↓') : '↕'}
                  </th>
                  <th 
                    onClick={() => handleSort('last_commit_time')} 
                    style={{ padding: '12px 8px', cursor: 'pointer', userSelect: 'none' }}
                    title="点击按最新提交时间排序"
                  >
                    最新提交时间 {sortField === 'last_commit_time' ? (sortOrder === 'asc' ? '↑' : '↓') : '↕'}
                  </th>
                  <th style={{ padding: '12px 8px', textAlign: 'right' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {paginatedRepos.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: 48, color: 'var(--text-secondary)' }}>
                      <AlertCircle size={32} style={{ margin: '0 auto 12px auto', opacity: 0.5 }} />
                      <p>未发现符合条件的被管代码仓。</p>
                    </td>
                  </tr>
                ) : (
                  paginatedRepos.map(r => (
                    <tr key={r.id} style={{ borderBottom: '1px solid var(--border-color)', fontSize: 13, opacity: r.is_archived ? 0.65 : 1 }}>
                      <td style={{ padding: '14px 8px', color: 'var(--text-secondary)' }}>{r.id}</td>
                      <td style={{ padding: '14px 8px', fontWeight: 600 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span>{r.name}</span>
                            {r.is_archived && (
                              <span className="badge" style={{ padding: '1px 6px', borderRadius: 4, background: 'rgba(148, 163, 184, 0.2)', color: '#94a3b8', fontSize: 11, fontWeight: 500 }}>
                                已归档
                              </span>
                            )}
                            {r.language && (
                              <span className="badge" style={{ padding: '1px 6px', borderRadius: 4, background: 'rgba(59, 130, 246, 0.12)', color: '#60a5fa', fontSize: 11, fontWeight: 500 }}>
                                {r.language}
                              </span>
                            )}
                            {r.machine_type && r.machine_type.split(',').map((item, idx) => {
                              const trimmed = item.trim()
                              if (!trimmed) return null
                              return (
                                <span key={idx} className="badge" style={{ padding: '1px 6px', borderRadius: 4, background: 'rgba(168, 85, 247, 0.12)', color: '#c084fc', fontSize: 11, fontWeight: 500 }}>
                                  {trimmed}
                                </span>
                              )
                            })}
                          </div>
                          {(r.owner || r.subsystem || r.department) && (
                            <div style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                              {r.owner && <span>责任人: {r.owner.name || r.owner.username}</span>}
                              {r.subsystem && <span>子系统: {r.subsystem.name}</span>}
                              {r.department && <span>部门: {r.department.name}</span>}
                            </div>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '14px 8px' }}>
                        <span className="badge badge-secondary" style={{ background: 'rgba(129, 138, 248, 0.1)', color: '#818cf8' }}>
                          {r.group?.full_path || 'Default'}
                        </span>
                      </td>
                      <td style={{ padding: '14px 8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span className="badge badge-secondary" title="分支总数" style={{ padding: '2px 6px', borderRadius: 4, background: 'rgba(255, 255, 255, 0.08)', color: 'var(--text-main)', fontWeight: 600 }}>
                            共 {r.branch_count || 0}
                          </span>
                          {(r.branch_count || 0) > 0 && (
                            <>
                              <span className="badge" title="活跃分支" style={{ padding: '2px 6px', borderRadius: 4, background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', fontSize: 11 }}>
                                活 {r.active_count || 0}
                              </span>
                              <span className="badge" title="未合并僵尸" style={{ padding: '2px 6px', borderRadius: 4, background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', fontSize: 11 }}>
                                僵 {r.stale_unmerged_count || 0}
                              </span>
                              <span className="badge" title="已合并待清理" style={{ padding: '2px 6px', borderRadius: 4, background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', fontSize: 11 }}>
                                合 {r.stale_merged_count || 0}
                              </span>
                            </>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '14px 8px', color: 'var(--text-secondary)' }}>
                        {formatLastCommitTime(r.last_commit_time)}
                      </td>

                      <td style={{ padding: '14px 8px', textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: 8 }}>
                          <button onClick={() => {
                            setActiveRepo(r)
                            fetchBranchAudits(r.id)
                            handleOpenAclManager('repository', r.id)
                            setActiveTab('branches')
                          }} className="btn btn-secondary btn-small" title="查看仓库管控大盘与分支审计看板">
                            <GitBranch size={13} /> 管控
                          </button>
                          <button 
                            disabled={isAuditing || r.is_archived}
                            onClick={() => handleTriggerAudit(r.id)} 
                            className="btn btn-secondary btn-small"
                            title={r.is_archived ? '已归档仓库无法审计分析' : '手动即时触发该代码仓的分支审计分析'}
                          >
                            <RefreshCw size={13} className={isAuditing ? 'animate-spin' : ''} />
                          </button>
                          {isAdmin && (
                            <button
                              onClick={() => handleToggleRepoArchive(r)}
                              className="btn btn-secondary btn-small"
                              title={r.is_archived ? '解除归档，恢复活跃管控' : '将代码仓归档（自动置为非活跃与隐藏）'}
                              style={{ color: r.is_archived ? '#10b981' : '#64748b' }}
                            >
                              <Archive size={13} /> {r.is_archived ? '解档' : '归档'}
                            </button>
                          )}
                        </div>
                      </td>

                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 16,
            paddingTop: 16,
            borderTop: '1px solid var(--border-color)',
            fontSize: 13,
            color: 'var(--text-secondary)'
          }}>
            <div>
              共 <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{totalItems}</span> 个仓库
              {totalItems > 0 && `，显示第 ${(currentPage - 1) * pageSize + 1} - ${Math.min(currentPage * pageSize, totalItems)} 个`}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>每页:</span>
                <select 
                  value={pageSize} 
                  onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                  style={{
                    padding: '4px 8px',
                    fontSize: 12,
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 4,
                    color: 'var(--text-main)',
                    cursor: 'pointer'
                  }}
                >
                  <option value={15}>15</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button 
                  disabled={currentPage === 1}
                  onClick={() => handlePageChange(Math.max(currentPage - 1, 1))}
                  className="btn btn-secondary btn-small"
                  style={{ padding: '4px 8px', minWidth: 60 }}
                >
                  上一页
                </button>
                <span style={{ margin: '0 8px' }}>
                  第 {currentPage} / {totalPages} 页
                </span>
                <button 
                  disabled={currentPage === totalPages}
                  onClick={() => handlePageChange(Math.min(currentPage + 1, totalPages))}
                  className="btn btn-secondary btn-small"
                  style={{ padding: '4px 8px', minWidth: 60 }}
                >
                  下一页
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Branch Audit & ACL Sidebar Modal/Drawer */}
      {activeRepo && (
        <>
          {/* Backdrop Overlay to auto-close drawer when clicking outside */}
          <div 
            onClick={() => setActiveRepo(null)}
            style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(0, 0, 0, 0.45)',
              backdropFilter: 'blur(2px)',
              zIndex: 99
            }}
            title="点击背景区域自动关闭"
          />

          <div style={{
            position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(1040px, 94vw)',
            background: 'var(--bg-secondary)', borderLeft: '1px solid var(--border-color)',
            boxShadow: '-10px 0 30px rgba(0,0,0,0.2)', zIndex: 100, padding: 32,
            display: 'flex', flexDirection: 'column', gap: 24,
            animation: 'slideLeft 0.2s ease-out'
          }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="badge badge-secondary" style={{ fontSize: 11 }}>Project ID: {activeRepo.id}</span>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{activeRepo.group?.full_path}</span>
                </div>
                <h2 style={{ fontSize: 22, fontWeight: 700, margin: '6px 0 0 0' }}>仓库管控大盘: {activeRepo.name}</h2>
              </div>
              <button 
                onClick={() => setActiveRepo(null)} 
                className="btn btn-secondary btn-small" 
                style={{ padding: '6px', borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                title="关闭管控大盘 (或点击背景区域)"
              >
                <X size={16} />
              </button>
            </div>

            {/* Stale branch summaries */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
              <div className="glass-card" style={{ padding: '14px 20px', borderLeft: '4px solid #ef4444' }}>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>未合并僵尸分支</div>
                <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{unmergedStale} 个</div>
              </div>
              <div className="glass-card" style={{ padding: '14px 20px', borderLeft: '4px solid #f59e0b' }}>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>已合并待清理</div>
                <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{mergedStale} 个</div>
              </div>
              <div className="glass-card" style={{ padding: '14px 20px', borderLeft: '4px solid #10b981' }}>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>分支总存量</div>
                <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{branches.length} 个</div>
              </div>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 12, borderBottom: '1px solid var(--border-color)', paddingBottom: 8 }}>
              <button 
                onClick={() => setActiveTab('branches')}
                style={{
                  padding: '6px 14px',
                  borderRadius: 6,
                  border: '1px solid',
                  borderColor: activeTab === 'branches' ? 'var(--border-color)' : 'transparent',
                  background: activeTab === 'branches' ? 'var(--bg-primary)' : 'transparent',
                  color: activeTab === 'branches' ? 'var(--text-main)' : 'var(--text-secondary)',
                  fontWeight: activeTab === 'branches' ? 600 : 400,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 13
                }}
              >
                <GitBranch size={14} /> 分支审计 (Audits)
              </button>
              <button 
                onClick={() => setActiveTab('acl')}
                style={{
                  padding: '6px 14px',
                  borderRadius: 6,
                  border: '1px solid',
                  borderColor: activeTab === 'acl' ? 'var(--border-color)' : 'transparent',
                  background: activeTab === 'acl' ? 'var(--bg-primary)' : 'transparent',
                  color: activeTab === 'acl' ? 'var(--text-main)' : 'var(--text-secondary)',
                  fontWeight: activeTab === 'acl' ? 600 : 400,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 13
                }}
              >
                <Users size={14} /> 权限同步 (ACLs)
              </button>
            </div>

            {/* TAB 1: Branch Auditing */}
            {activeTab === 'branches' && (() => {
              const selectableBranches = branches.filter(b => b.status !== 'active')
              const allSelectableNames = selectableBranches.map(b => b.branch_name)
              const isAllSelected = allSelectableNames.length > 0 && allSelectableNames.every(name => selectedBranchNames.includes(name))
              
              const mergedStaleBranches = branches.filter(b => b.status === 'merged_stale')
              const unmergedStaleBranches = branches.filter(b => b.status === 'unmerged_stale')
              const activeBranches = branches.filter(b => b.status === 'active')

              const handleToggleSelectAll = () => {
                if (isAllSelected) {
                  setSelectedBranchNames([])
                } else {
                  setSelectedBranchNames(allSelectableNames)
                }
              }

              const handleToggleSelectBranch = (branchName: string) => {
                setSelectedBranchNames(prev => 
                  prev.includes(branchName) 
                    ? prev.filter(name => name !== branchName)
                    : [...prev, branchName]
                )
              }

              return (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, overflow: 'hidden' }}>
                  {/* Visual Stats Overview Cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                    <div style={{ background: 'var(--bg-primary)', padding: '10px 14px', borderRadius: 6, border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>已合并待清理 (Merged)</span>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <span style={{ fontSize: 20, fontWeight: 700, color: '#f59e0b' }}>{mergedStaleBranches.length}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>个分支</span>
                      </div>
                    </div>
                    <div style={{ background: 'var(--bg-primary)', padding: '10px 14px', borderRadius: 6, border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>未合并僵尸 (Zombie)</span>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <span style={{ fontSize: 20, fontWeight: 700, color: '#ef4444' }}>{unmergedStaleBranches.length}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>个分支</span>
                      </div>
                    </div>
                    <div style={{ background: 'var(--bg-primary)', padding: '10px 14px', borderRadius: 6, border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>安全活跃分支 (Active)</span>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <span style={{ fontSize: 20, fontWeight: 700, color: '#10b981' }}>{activeBranches.length}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>个分支</span>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>分支状态过滤:</span>
                      <select 
                        value={branchStatusFilter} 
                        onChange={(e) => {
                          setBranchStatusFilter(e.target.value)
                          fetchBranchAudits(activeRepo.id, e.target.value)
                        }}
                        style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', color: 'var(--text-main)', borderRadius: 4, padding: '4px 8px', fontSize: 13 }}
                      >
                        <option value="all">[全部存量分支]</option>
                        <option value="active">🟢 活跃分支 (Active)</option>
                        <option value="merged_stale">🟡 已合并待清理 (Merged)</option>
                        <option value="unmerged_stale">🔴 未合并僵尸 (Zombie)</option>
                      </select>
                    </div>

                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {/* Quick One-Click Clean for Merged Branches */}
                      <button 
                        disabled={isCleaningBranches || mergedStaleBranches.length === 0} 
                        onClick={() => handleCleanupBranches(mergedStaleBranches.map(b => b.branch_name))}
                        style={{
                          background: mergedStaleBranches.length > 0 ? 'rgba(245, 158, 11, 0.12)' : 'var(--bg-primary)',
                          color: mergedStaleBranches.length > 0 ? '#d97706' : 'var(--text-secondary)',
                          border: mergedStaleBranches.length > 0 ? '1px solid rgba(245, 158, 11, 0.3)' : '1px solid var(--border-color)',
                          padding: '5px 10px', fontSize: 12, borderRadius: 4, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4
                        }}
                        title="一键物理删除所有已合入 master 的安全分支"
                      >
                        <Zap size={13} /> 
                        一键清理 ({mergedStaleBranches.length})
                      </button>

                      {/* Batch Physical Delete */}
                      <button 
                        disabled={isCleaningBranches || selectedBranchNames.length === 0} 
                        onClick={() => handleCleanupBranches(selectedBranchNames)}
                        style={{
                          background: selectedBranchNames.length > 0 ? 'rgba(239, 68, 68, 0.12)' : 'var(--bg-primary)',
                          color: selectedBranchNames.length > 0 ? '#dc2626' : 'var(--text-secondary)',
                          border: selectedBranchNames.length > 0 ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid var(--border-color)',
                          padding: '5px 10px', fontSize: 12, borderRadius: 4, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4
                        }}
                        title="批量物理删除已选中的非活动分支"
                      >
                        <Trash2 size={13} /> 
                        批量删除 ({selectedBranchNames.length})
                      </button>

                      <button onClick={() => setShowBranchModal(true)} className="btn btn-secondary btn-small" title="新建保护 feature 分支">
                        <Plus size={13} /> 新建分支
                      </button>
                      <button 
                        disabled={isAuditing} 
                        onClick={() => handleTriggerAudit(activeRepo.id)} 
                        className="btn btn-secondary btn-small"
                        title="手动即时触发该代码仓的分支审计分析"
                      >
                        <RefreshCw size={13} className={isAuditing ? 'animate-spin' : ''} /> 审计
                      </button>
                    </div>
                  </div>

                  {/* Table list */}
                  <div style={{ flex: 1, overflowY: 'auto' }}>
                    <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontSize: 12 }}>
                          <th style={{ padding: '8px 4px', width: 32, textAlign: 'center' }}>
                            <input 
                              type="checkbox" 
                              checked={isAllSelected} 
                              disabled={allSelectableNames.length === 0}
                              onChange={handleToggleSelectAll}
                            />
                          </th>
                          <th style={{ padding: '8px 4px' }}>分支名称</th>
                          <th style={{ padding: '8px 4px' }}>最后提交人</th>
                          <th style={{ padding: '8px 4px' }}>更新时间</th>
                          <th style={{ padding: '8px 4px' }}>状态</th>
                          <th style={{ padding: '8px 4px', textAlign: 'right' }}>建议操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {branches.length === 0 ? (
                          <tr>
                            <td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--text-secondary)', fontSize: 13 }}>
                              无匹配的分支审计结果。
                            </td>
                          </tr>
                        ) : (
                          branches.map(b => (
                            <tr key={b.id} style={{ borderBottom: '1px solid var(--border-color)', fontSize: 12 }}>
                              <td style={{ padding: '10px 4px', textAlign: 'center' }}>
                                {b.status !== 'active' ? (
                                  <input 
                                    type="checkbox" 
                                    checked={selectedBranchNames.includes(b.branch_name)} 
                                    onChange={() => handleToggleSelectBranch(b.branch_name)}
                                  />
                                ) : null}
                              </td>
                              <td style={{ padding: '10px 4px', fontFamily: 'monospace', fontWeight: 600 }}>{b.branch_name}</td>
                              <td style={{ padding: '10px 4px' }}>{b.last_author || 'unknown'}</td>
                              <td style={{ padding: '10px 4px', color: 'var(--text-secondary)' }}>
                                {new Date(b.last_commit_time).toLocaleDateString()}
                              </td>
                              <td style={{ padding: '10px 4px' }}>
                                {b.status === 'active' && <span style={{ color: '#10b981' }}>🟢 Active</span>}
                                {b.status === 'merged_stale' && <span style={{ color: '#f59e0b', fontWeight: 600 }}>🟡 已合并待删</span>}
                                {b.status === 'unmerged_stale' && <span style={{ color: '#ef4444', fontWeight: 600 }}>🔴 僵尸分支</span>}
                              </td>
                              <td style={{ padding: '10px 4px', textAlign: 'right' }}>
                                {b.status !== 'active' ? (
                                  <div style={{ display: 'inline-flex', gap: 6 }}>
                                    <button 
                                      onClick={() => handleNotifyOwner(activeRepo.id, b.branch_name, b.last_author)}
                                      className="btn btn-secondary btn-small" 
                                      style={{ padding: '2px 6px', fontSize: 11 }}
                                      title="提醒分支负责人清理"
                                    >
                                      <Send size={10} />
                                    </button>
                                    <button 
                                      onClick={() => handleCleanupBranches([b.branch_name])}
                                      disabled={isCleaningBranches}
                                      className="btn btn-secondary btn-small" 
                                      style={{ padding: '2px 6px', fontSize: 11, color: '#ef4444', borderColor: 'var(--border-color)' }}
                                      title="在远程 Git 平台物理删除该分支"
                                    >
                                      <Trash2 size={10} />
                                    </button>
                                  </div>
                                ) : (
                                  <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>已安全保护</span>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', background: 'var(--bg-primary)', padding: 12, borderRadius: 6, border: '1px solid var(--border-color)' }}>
                    💡 <b>安全清理原则说明：</b>系统支持【一键清理已合并分支】与在线【批量物理删除】。未合并的僵尸分支强行物理删除时须输入 <code>DELETE</code> 二次确认。删除后会自动同步清空远程 Git 平台及本地审计数据。
                  </div>
                </div>
              )
            })()}

            {/* TAB 2: ACL Configuration Cache */}
            {activeTab === 'acl' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, overflow: 'hidden' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    以下记录了本系统成功配置并下发至 Git 托管平台的成员与群组授权明细：
                  </span>
                  <button onClick={() => setShowAddAclModal(true)} className="btn btn-secondary btn-small" title="添加成员/群组授权记录">
                    <Plus size={13} /> 添加授权
                  </button>
                </div>

                <div style={{ flex: 1, overflowY: 'auto' }}>
                  <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontSize: 12 }}>
                        <th style={{ padding: '8px 4px' }}>主体类型</th>
                        <th style={{ padding: '8px 4px' }}>成员/群组名称</th>
                        <th style={{ padding: '8px 4px' }}>本地角色/权限</th>
                        <th style={{ padding: '8px 4px' }}>同步状态</th>
                        <th style={{ padding: '8px 4px' }}>最后变更时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {acls.map(a => (
                        <tr key={a.id} style={{ borderBottom: '1px solid var(--border-color)', fontSize: 12 }}>
                          <td style={{ padding: '10px 4px' }}>
                            <span className="badge badge-secondary" style={{ fontSize: 10 }}>
                              {a.principal_type === 'user' ? '👤 个人' : '👥 用户组'}
                            </span>
                          </td>
                          <td style={{ padding: '10px 4px', fontWeight: 600 }}>{a.principal_name}</td>
                          <td style={{ padding: '10px 4px' }}>
                            {a.access_level === 50 ? '👑 Owner' : a.access_level === 30 ? '🛠️ Developer' : '📖 Reporter'}
                          </td>
                          <td style={{ padding: '10px 4px' }}>
                            <span style={{ color: '#10b981', fontWeight: 600 }}>🟢 已同步</span>
                          </td>
                          <td style={{ padding: '10px 4px', color: 'var(--text-secondary)' }}>{a.updated_at}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </>
      )}


      {/* MODAL 1: Create Group */}
      {showGroupModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex',
          justifyContent: 'center', alignItems: 'center'
        }}>
          <form onSubmit={handleCreateGroup} className="glass-card" style={{ width: 480, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>新建嵌套 Group</h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600 }}>组名称</label>
              <input 
                type="text" 
                required
                placeholder="例如：后端开发组" 
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                style={{ padding: '8px 12px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 6, color: 'var(--text-main)' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600 }}>路径标识 (Path)</label>
              <input 
                type="text" 
                required
                placeholder="例如：backend" 
                value={newGroupPath}
                onChange={(e) => setNewGroupPath(e.target.value)}
                style={{ padding: '8px 12px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 6, color: 'var(--text-main)' }}
              />
            </div>



            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" onClick={() => setShowGroupModal(false)} className="btn btn-secondary">
                取消
              </button>
              <button type="submit" className="btn btn-primary">
                提交创建
              </button>
            </div>
          </form>
        </div>
      )}

      {/* SIDEBAR DRAWER: Create Repo */}
      {showRepoModal && (
        <div className="drawer-overlay" onClick={resetRepoForm}>
          <div className="drawer-panel" onClick={e => e.stopPropagation()}>
            {/* Drawer Header */}
            <div style={{
              padding: '20px 24px',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'rgba(255, 255, 255, 0.02)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: 'rgba(99, 102, 241, 0.12)',
                  color: '#6366f1',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <Plus size={20} />
                </div>
                <div>
                  <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>
                    申请新建被管代码仓
                  </h3>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    标准化远程仓库配置与安全监控注册
                  </span>
                </div>
              </div>
              <button 
                type="button" 
                onClick={resetRepoForm}
                style={{
                  background: 'transparent', border: 'none', color: 'var(--text-secondary)',
                  cursor: 'pointer', padding: 6, borderRadius: 6, display: 'flex', alignItems: 'center'
                }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Approval Notice Banner */}
            <div style={{ padding: '14px 24px 0 24px' }}>
              <div style={{
                background: 'rgba(99, 102, 241, 0.08)',
                border: '1px solid rgba(99, 102, 241, 0.25)',
                borderRadius: 8,
                padding: '12px 14px',
                fontSize: 12,
                color: 'var(--text-main)',
                lineHeight: '1.5'
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <AlertCircle size={16} style={{ color: '#6366f1', flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <strong style={{ color: '#818cf8' }}>代码仓创建审批说明：</strong>
                    <div style={{ marginTop: 2, color: 'var(--text-secondary)' }}>
                      代码仓创建一律实行审批制。提交创建申请后，系统将自动生成审批单并转交给团队管理员/审批人。审批核准通过后，系统才会自动在远程 Git 平台拉起物理仓库、初始化主分支（master/main）并配置标准化门禁看护。
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Form Container */}
            <form onSubmit={handleCreateRepo} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
                {/* 1. 基础配置 */}
                <div style={{ fontSize: 13, fontWeight: 700, color: '#818cf8', borderBottom: '1px solid var(--border-color)', paddingBottom: 6 }}>
                  1. 基础配置
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>仓库名称 <span style={{ color: '#ef4444' }}>*</span></label>
                  <input 
                    type="text" 
                    required
                    placeholder="例如：auth-service" 
                    value={newRepoName}
                    onChange={(e) => setNewRepoName(e.target.value)}
                    style={{ padding: '8px 12px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 6, color: 'var(--text-main)' }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>归属嵌套组 <span style={{ color: '#ef4444' }}>*</span></label>
                  <select 
                    required
                    value={newRepoGroup} 
                    onChange={(e) => setNewRepoGroup(Number(e.target.value))}
                    style={{ padding: '8px 12px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 6, color: 'var(--text-main)' }}
                  >
                    <option value={0}>请选择归属组织 Group...</option>
                    {groups.map(g => (
                      <option key={g.id} value={g.id}>{g.full_path}</option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>主分支名称 (Default Main Branch)</label>
                  <div style={{ display: 'flex', gap: 20, alignItems: 'center', marginTop: 4 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                      <input 
                        type="radio" 
                        name="defaultBranch" 
                        value="master" 
                        checked={newRepoDefaultBranch === 'master'} 
                        onChange={e => setNewRepoDefaultBranch(e.target.value)} 
                      />
                      <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>master</span>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>(经典主干)</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                      <input 
                        type="radio" 
                        name="defaultBranch" 
                        value="main" 
                        checked={newRepoDefaultBranch === 'main'} 
                        onChange={e => setNewRepoDefaultBranch(e.target.value)} 
                      />
                      <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>main</span>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>(标准主干)</span>
                    </label>
                  </div>
                </div>

                {/* 2. 归属与责任人 */}
                <div style={{ fontSize: 13, fontWeight: 700, color: '#818cf8', borderBottom: '1px solid var(--border-color)', paddingBottom: 6, marginTop: 8 }}>
                  2. 归属与责任人
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ fontSize: 12, fontWeight: 600 }}>责任人 <span style={{ color: '#ef4444' }}>*</span></label>
                    <select 
                      required
                      value={newRepoOwnerID} 
                      onChange={(e) => setNewRepoOwnerID(e.target.value ? Number(e.target.value) : '')}
                      style={{ padding: '8px 12px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 6, color: 'var(--text-main)' }}
                    >
                      <option value="">请选择系统责任人...</option>
                      {systemUsers.map(u => (
                        <option key={u.id} value={u.id}>{u.name} {u.email ? `(${u.email})` : ''}</option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ fontSize: 12, fontWeight: 600 }}>所属部门 <span style={{ color: '#ef4444' }}>*</span></label>
                    <select 
                      required
                      value={newRepoDepartmentID} 
                      onChange={(e) => setNewRepoDepartmentID(e.target.value ? Number(e.target.value) : '')}
                      style={{ padding: '8px 12px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 6, color: 'var(--text-main)' }}
                    >
                      <option value="">请选择所属部门...</option>
                      {systemDepartments.map(d => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>归属子系统 <span style={{ color: '#ef4444' }}>*</span></label>
                  <select 
                    required
                    value={newRepoSubsystemID} 
                    onChange={(e) => setNewRepoSubsystemID(e.target.value ? Number(e.target.value) : '')}
                    style={{ padding: '8px 12px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 6, color: 'var(--text-main)' }}
                  >
                    <option value="">请选择归属子系统...</option>
                    {systemSubsystems.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>

                {/* 3. 技术规格与分类 */}
                <div style={{ fontSize: 13, fontWeight: 700, color: '#818cf8', borderBottom: '1px solid var(--border-color)', paddingBottom: 6, marginTop: 8 }}>
                  3. 技术规格与分类
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ fontSize: 12, fontWeight: 600 }}>主要编程语言</label>
                    <select 
                      value={newRepoLanguage} 
                      onChange={(e) => setNewRepoLanguage(e.target.value)}
                      style={{ padding: '8px 12px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 6, color: 'var(--text-main)' }}
                    >
                      <option value="C">C</option>
                      <option value="C++">C++</option>
                      <option value="Python">Python</option>
                      <option value="Java">Java</option>
                      <option value="Shell/Bash">Shell / Bash</option>
                      <option value="Go">Go</option>
                      <option value="Rust">Rust</option>
                      <option value="其它">其它 (Other)</option>
                    </select>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ fontSize: 12, fontWeight: 600 }}>设备 / 架构分类 <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>(多选)</span></label>
                    <div style={{
                      display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center',
                      padding: '8px 12px', background: 'var(--bg-primary)',
                      border: '1px solid var(--border-color)', borderRadius: 6, minHeight: 38
                    }}>
                      {[
                        { code: '上位机', label: '上位机' },
                        { code: '下位机', label: '下位机' },
                        { code: '数据机', label: '数据机' },
                        { code: '其它', label: '其它' }
                      ].map(({ code, label }) => {
                        const checked = newRepoMachineTypes.includes(code)
                        return (
                          <label key={code} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: 'var(--text-main)', userSelect: 'none', margin: 0 }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setNewRepoMachineTypes(prev => [...prev, code])
                                } else {
                                  setNewRepoMachineTypes(prev => prev.filter(t => t !== code))
                                }
                              }}
                              style={{ width: 'auto', cursor: 'pointer' }}
                            />
                            <span>{label}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>TAG (标签)</label>
                  <input 
                    type="text" 
                    placeholder="多个标签英文逗号隔开，例如: core, auth, microservice" 
                    value={newRepoTags}
                    onChange={(e) => setNewRepoTags(e.target.value)}
                    style={{ padding: '8px 12px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 6, color: 'var(--text-main)' }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>详细描述</label>
                  <textarea 
                    rows={3}
                    placeholder="请输入代码仓业务背景、核心职责与维护说明..." 
                    value={newRepoDescription}
                    onChange={(e) => setNewRepoDescription(e.target.value)}
                    style={{ padding: '8px 12px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 6, color: 'var(--text-main)', resize: 'vertical' }}
                  />
                </div>
              </div>

              {/* Drawer Footer */}
              <div style={{
                padding: '16px 24px',
                borderTop: '1px solid var(--border-color)',
                display: 'flex',
                gap: 12,
                justifyContent: 'flex-end',
                background: 'rgba(0, 0, 0, 0.2)'
              }}>
                <button type="button" onClick={resetRepoForm} className="btn btn-secondary">
                  取消
                </button>
                <button type="submit" className="btn btn-primary">
                  提交创建申请
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Create Branch */}
      {showBranchModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)', zIndex: 210, display: 'flex',
          justifyContent: 'center', alignItems: 'center'
        }}>
          <form onSubmit={handleCreateBranch} className="glass-card" style={{ width: 480, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>新建保护 feature 开发分支</h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600 }}>分支名称</label>
              <input 
                type="text" 
                required
                placeholder="必须以 'feature' 开头，例如 feature/payment" 
                value={newBranchName}
                onChange={(e) => {
                  setNewBranchName(e.target.value)
                  if (e.target.value && !e.target.value.startsWith('feature')) {
                    setBranchNameError('警告：必须以 "feature" 前缀开头')
                  } else {
                    setBranchNameError('')
                  }
                }}
                style={{ padding: '8px 12px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 6, color: 'var(--text-main)' }}
              />
              {branchNameError && <span style={{ color: '#ef4444', fontSize: 11, fontWeight: 600 }}>{branchNameError}</span>}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600 }}>拉取源基线 (Source Ref)</label>
              <input 
                type="text" 
                required
                placeholder="例如 master 或 main" 
                value={newBranchSource}
                onChange={(e) => setNewBranchSource(e.target.value)}
                style={{ padding: '8px 12px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 6, color: 'var(--text-main)' }}
              />
            </div>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" onClick={() => setShowBranchModal(false)} className="btn btn-secondary">
                取消
              </button>
              <button type="submit" disabled={isCreatingBranch || !!branchNameError} className="btn btn-primary">
                {isCreatingBranch ? '拉取并锁定中...' : '提交创建'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 4: Add ACL Member */}
      {showAddAclModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)', zIndex: 210, display: 'flex',
          justifyContent: 'center', alignItems: 'center'
        }}>
          <form onSubmit={handleAddAcl} className="glass-card" style={{ width: 480, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>为被管仓新增成员/群组授权</h3>
            
            <div style={{ display: 'flex', gap: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <input 
                  type="radio" 
                  name="principal_type" 
                  checked={newAclPrincipalType === 'user'} 
                  onChange={() => setNewAclPrincipalType('user')} 
                /> 👤 授权给个人
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <input 
                  type="radio" 
                  name="principal_type" 
                  checked={newAclPrincipalType === 'user_group'} 
                  onChange={() => setNewAclPrincipalType('user_group')} 
                /> 👥 授权给外部群组
              </label>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600 }}>主体系统唯一 ID (Principal ID)</label>
              <input 
                type="number" 
                required
                placeholder="例如用户或外部群组在系统中的自增 ID" 
                value={newAclPrincipalID || ''}
                onChange={(e) => setNewAclPrincipalID(Number(e.target.value))}
                style={{ padding: '8px 12px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 6, color: 'var(--text-main)' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600 }}>主体名称 (Principal Name)</label>
              <input 
                type="text" 
                required
                placeholder="缓存用于看板展示的名称" 
                value={newAclPrincipalName}
                onChange={(e) => setNewAclPrincipalName(e.target.value)}
                style={{ padding: '8px 12px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 6, color: 'var(--text-main)' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600 }}>Git平台授权级别</label>
              <select 
                value={newAclLevel} 
                onChange={(e) => setNewAclLevel(Number(e.target.value))}
                style={{ padding: '8px 12px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 6, color: 'var(--text-main)' }}
              >
                <option value={10}>📖 Reporter (只读查看)</option>
                <option value={30}>🛠️ Developer (开发者，允许在受限范围内通过MR提交)</option>
                <option value={50}>👑 Owner (拥有者，拥有最高修改及删除权)</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" onClick={() => setShowAddAclModal(false)} className="btn btn-secondary">
                取消
              </button>
              <button type="submit" className="btn btn-primary">
                提交授权并同步
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
