import React, { useState, useEffect, useMemo } from 'react'
import { FileText, CheckCircle2, XCircle, Clock, RefreshCw, Server, GitBranch, Eye, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, X } from 'lucide-react'
import { ManagedRepoApproval } from '../types'
import { useToast } from '../components/Toast'

interface ManagedApprovalsProps {
  isAdmin?: boolean
  apiBase: string
  token: string
}

export const ManagedApprovals: React.FC<ManagedApprovalsProps> = ({ isAdmin = true, apiBase, token }) => {
  const { showToast } = useToast()
  
  const [approvals, setApprovals] = useState<ManagedRepoApproval[]>([])
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending')
  const [typeFilter, setTypeFilter] = useState<'repo_create' | 'protected_branch' | 'batch_branch' | 'all'>('all')
  const [loading, setLoading] = useState(false)

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  // Consolidated modal state
  const [selectedApproval, setSelectedApproval] = useState<ManagedRepoApproval | null>(null)
  const [actionType, setActionType] = useState<'view' | 'approve' | 'reject'>('view')
  const [comment, setComment] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)

  const fetchApprovals = async () => {
    setLoading(true)
    try {
      const queryParams = new URLSearchParams()
      if (statusFilter !== 'all') queryParams.append('status', statusFilter)
      if (typeFilter !== 'all') queryParams.append('type', typeFilter)

      const res = await fetch(`${apiBase}/managed-approvals?${queryParams.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setApprovals(data)
      }
    } catch (err) {
      console.error('Failed to fetch approvals:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setCurrentPage(1)
    fetchApprovals()
  }, [apiBase, token, statusFilter, typeFilter])

  // Pagination slice
  const totalPages = Math.ceil(approvals.length / pageSize) || 1
  const paginatedApprovals = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return approvals.slice(start, start + pageSize)
  }, [approvals, currentPage, pageSize])

  const openModal = (app: ManagedRepoApproval, mode: 'view' | 'approve' | 'reject' = 'view') => {
    setSelectedApproval(app)
    setActionType(mode)
    setComment('')
  }

  const closeModal = () => {
    setSelectedApproval(null)
    setActionType('view')
    setComment('')
  }

  const handleActionSubmit = async (targetAction: 'approve' | 'reject') => {
    if (!selectedApproval) return

    if (targetAction === 'reject' && !comment.trim()) {
      showToast('驳回时必须填写驳回理由', 'error')
      return
    }

    setIsProcessing(true)
    try {
      const endpoint = `${apiBase}/managed-approvals/${selectedApproval.id}/${targetAction}`
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ comment: comment.trim() })
      })

      if (res.ok) {
        showToast(targetAction === 'approve' ? '已核准通过，自动触发物理创建' : '已成功驳回申请单', 'success')
        closeModal()
        fetchApprovals()
      } else {
        const errData = await res.json()
        showToast(`操作失败: ${errData.error || '未知错误'}`, 'error')
      }
    } catch (err) {
      showToast('网络请求失败', 'error')
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header Banner */}
      <div className="glass-card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <FileText size={22} />
          </div>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>审批管理中心</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
              提供代码仓与保护分支双轨审批机制。普通用户提单、管理员核准通过后自动触发后端远程建仓/建分支与 Webhook 注册。
            </p>
          </div>
        </div>
      </div>

      {/* Filter & List Card */}
      <div className="glass-card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>单据状态:</span>
            <select 
              className="input" 
              style={{ width: 140 }}
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as any)}
            >
              <option value="pending">待审批 (Pending)</option>
              <option value="approved">已通过 (Approved)</option>
              <option value="rejected">已驳回 (Rejected)</option>
              <option value="all">全部状态</option>
            </select>

            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginLeft: 8 }}>类型:</span>
            <select 
              className="input" 
              style={{ width: 160 }}
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value as any)}
            >
              <option value="all">全部类型</option>
              <option value="repo_create">新建代码仓申请</option>
              <option value="protected_branch">保护分支申请</option>
            </select>
          </div>

          <button onClick={fetchApprovals} className="btn btn-secondary btn-small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> 刷新
          </button>
        </div>

        {/* Approvals Table */}
        {approvals.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>
            <FileText size={32} style={{ opacity: 0.4, marginBottom: 8 }} />
            <p style={{ margin: 0, fontSize: 14 }}>暂无相关审批单据记录</p>
          </div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>单据 ID</th>
                    <th>类型</th>
                    <th>目标名称 / 描述</th>
                    <th>申请人</th>
                    <th>申请原因</th>
                    <th>状态</th>
                    <th>申请时间</th>
                    <th style={{ textAlign: 'right' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedApprovals.map(app => (
                    <tr key={app.id}>
                      <td style={{ fontWeight: 700, color: '#6366f1' }}>#{app.id}</td>
                      <td>
                        {app.type === 'repo_create' ? (
                          <span className="badge badge-info" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Server size={12} /> 新建代码仓
                          </span>
                        ) : (
                          <span className="badge badge-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <GitBranch size={12} /> 保护分支
                          </span>
                        )}
                      </td>
                      <td>
                        <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span>{app.type === 'repo_create' ? app.repo_name : `${app.repo?.name || '仓库'} (${app.target_branch})`}</span>
                          {app.type === 'repo_create' && (app.default_branch || app.target_branch) && (
                            <span className="badge" style={{ padding: '1px 6px', borderRadius: 4, background: 'rgba(99, 102, 241, 0.1)', color: '#818cf8', fontSize: 11 }}>
                              默认分支: {app.default_branch || app.target_branch || 'master'}
                            </span>
                          )}
                          {app.language && (
                            <span className="badge" style={{ padding: '1px 6px', borderRadius: 4, background: 'rgba(59, 130, 246, 0.1)', color: '#60a5fa', fontSize: 11 }}>
                              {app.language}
                            </span>
                          )}
                          {app.machine_type && app.machine_type.split(',').map((item, idx) => {
                            const trimmed = item.trim()
                            if (!trimmed) return null
                            return (
                              <span key={idx} className="badge" style={{ padding: '1px 6px', borderRadius: 4, background: 'rgba(168, 85, 247, 0.1)', color: '#c084fc', fontSize: 11, marginRight: 4 }}>
                                {trimmed}
                              </span>
                            )
                          })}
                        </div>
                        {app.group && (
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                            归属组: {app.group.full_path} {app.owner ? ` | 责任人: ${app.owner.name || app.owner.username}` : ''}
                          </div>
                        )}
                      </td>
                      <td>
                        <div>{app.applicant?.name || `User #${app.applicant_id}`}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{app.applicant?.email}</div>
                      </td>
                      <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={app.reason}>
                        {app.reason || '-'}
                      </td>
                      <td>
                        {app.status === 'pending' && (
                          <span className="badge badge-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Clock size={12} /> 待审批
                          </span>
                        )}
                        {app.status === 'approved' && (
                          <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <CheckCircle2 size={12} /> 已通过
                          </span>
                        )}
                        {app.status === 'rejected' && (
                          <span className="badge badge-danger" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <XCircle size={12} /> 已驳回
                          </span>
                        )}
                        {app.approval_comment && (
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }} title={app.approval_comment}>
                            意见: {app.approval_comment}
                          </div>
                        )}
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                        {new Date(app.created_at).toLocaleString('zh-CN', { hour12: false })}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                          <button
                            onClick={() => openModal(app, 'view')}
                            className="btn btn-primary btn-small"
                            style={{ padding: '4px 12px', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                          >
                            <Eye size={13} /> 查看 / 审批
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-color, rgba(255,255,255,0.08))', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                显示第 <strong style={{ color: 'var(--text-primary)' }}>{(currentPage - 1) * pageSize + 1}</strong> 至 <strong style={{ color: 'var(--text-primary)' }}>{Math.min(currentPage * pageSize, approvals.length)}</strong> 条，共 <strong style={{ color: 'var(--text-primary)' }}>{approvals.length}</strong> 条记录
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
                  <span>每页显示:</span>
                  <select
                    className="input"
                    style={{ width: 80, padding: '4px 8px', height: 32 }}
                    value={pageSize}
                    onChange={e => {
                      setPageSize(Number(e.target.value))
                      setCurrentPage(1)
                    }}
                  >
                    <option value={10}>10 条</option>
                    <option value={20}>20 条</option>
                    <option value={50}>50 条</option>
                  </select>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button
                    className="btn btn-secondary btn-small"
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(1)}
                    title="首页"
                    style={{ padding: '4px 8px', opacity: currentPage === 1 ? 0.5 : 1, cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}
                  >
                    <ChevronsLeft size={14} />
                  </button>
                  <button
                    className="btn btn-secondary btn-small"
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    title="上一页"
                    style={{ padding: '4px 8px', opacity: currentPage === 1 ? 0.5 : 1, cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span style={{ fontSize: 13, margin: '0 8px', color: 'var(--text-primary)', fontWeight: 600 }}>
                    {currentPage} / {totalPages}
                  </span>
                  <button
                    className="btn btn-secondary btn-small"
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    title="下一页"
                    style={{ padding: '4px 8px', opacity: currentPage >= totalPages ? 0.5 : 1, cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer' }}
                  >
                    <ChevronRight size={14} />
                  </button>
                  <button
                    className="btn btn-secondary btn-small"
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage(totalPages)}
                    title="末页"
                    style={{ padding: '4px 8px', opacity: currentPage >= totalPages ? 0.5 : 1, cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer' }}
                  >
                    <ChevronsRight size={14} />
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Unified Right Drawer (768px Width, Compact Single-Screen View) */}
      {selectedApproval && (
        <div 
          className="drawer-overlay" 
          onClick={closeModal}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(3px)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }}
        >
          <div 
            className="drawer-card" 
            onClick={e => e.stopPropagation()}
            style={{ 
              width: 768, 
              maxWidth: '100%', 
              height: '100vh', 
              background: 'var(--bg-card, #181825)', 
              display: 'flex', 
              flexDirection: 'column', 
              borderLeft: '1px solid var(--border-color, rgba(255,255,255,0.12))', 
              boxShadow: '-10px 0 35px rgba(0, 0, 0, 0.6)' 
            }}
          >
            {/* Drawer Header */}
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-color, rgba(255,255,255,0.1))', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.02)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  单据详情与审批 <span style={{ color: '#6366f1' }}>#{selectedApproval.id}</span>
                </h3>
                {selectedApproval.type === 'repo_create' ? (
                  <span className="badge badge-info" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                    <Server size={12} /> 新建代码仓
                  </span>
                ) : (
                  <span className="badge badge-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                    <GitBranch size={12} /> 保护分支
                  </span>
                )}
                {selectedApproval.status === 'pending' && <span className="badge badge-warning" style={{ fontSize: 11 }}>待审批</span>}
                {selectedApproval.status === 'approved' && <span className="badge badge-success" style={{ fontSize: 11 }}>已通过</span>}
                {selectedApproval.status === 'rejected' && <span className="badge badge-danger" style={{ fontSize: 11 }}>已驳回</span>}
              </div>
              <button 
                onClick={closeModal} 
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                title="关闭抽屉"
              >
                <X size={20} />
              </button>
            </div>

            {/* Drawer Body (Compact Layout for One-Screen View) */}
            <div style={{ padding: '16px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
              {/* Grid Layout Section 1: 核心元数据 & 组织人员 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {/* 核心参数 (按类型隔离) */}
                <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 12, border: '1px solid var(--border-color, rgba(255,255,255,0.06))', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {selectedApproval.type === 'repo_create' ? '代码仓核心元数据' : '分支与仓库配置'}
                  </div>

                  {selectedApproval.type === 'repo_create' ? (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                        <span style={{ color: 'var(--text-secondary)' }}>代码仓名称:</span>
                        <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{selectedApproval.repo_name}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                        <span style={{ color: 'var(--text-secondary)' }}>默认主分支:</span>
                        <span style={{ fontWeight: 600, color: '#818cf8', background: 'rgba(99, 102, 241, 0.1)', padding: '1px 6px', borderRadius: 4 }}>
                          {selectedApproval.default_branch || selectedApproval.target_branch || 'master'}
                        </span>
                      </div>
                      {selectedApproval.group && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                          <span style={{ color: 'var(--text-secondary)' }}>归属代码组:</span>
                          <span style={{ fontWeight: 600 }}>{selectedApproval.group.full_path}</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                        <span style={{ color: 'var(--text-secondary)' }}>目标代码仓:</span>
                        <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{selectedApproval.repo?.name || '代码仓'}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                        <span style={{ color: 'var(--text-secondary)' }}>目标保护分支:</span>
                        <span style={{ fontWeight: 600, color: '#818cf8', background: 'rgba(99, 102, 241, 0.1)', padding: '1px 6px', borderRadius: 4 }}>
                          {selectedApproval.target_branch}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                        <span style={{ color: 'var(--text-secondary)' }}>基准来源分支:</span>
                        <span style={{ fontWeight: 600, color: '#34d399', background: 'rgba(52, 211, 153, 0.1)', padding: '1px 6px', borderRadius: 4 }}>
                          {selectedApproval.base_branch || 'master'}
                        </span>
                      </div>
                    </>
                  )}
                </div>

                {/* 人员与组织信息 (工号优先，严禁展示邮件) */}
                <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 12, border: '1px solid var(--border-color, rgba(255,255,255,0.06))', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    申请人及责任人 (工号)
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>申请人:</span>
                    <span style={{ fontWeight: 600 }}>
                      {selectedApproval.applicant?.name || `User #${selectedApproval.applicant_id}`} 
                      {selectedApproval.applicant?.username ? ` (工号: ${selectedApproval.applicant.username})` : ''}
                    </span>
                  </div>

                  {selectedApproval.type === 'repo_create' && selectedApproval.owner && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>仓库责任人:</span>
                      <span style={{ fontWeight: 600 }}>
                        {selectedApproval.owner.name || selectedApproval.owner.username} 
                        {selectedApproval.owner.username ? ` (工号: ${selectedApproval.owner.username})` : ''}
                      </span>
                    </div>
                  )}

                  {selectedApproval.department && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>归属部门:</span>
                      <span>{selectedApproval.department.name}</span>
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>提交时间:</span>
                    <span>{new Date(selectedApproval.created_at).toLocaleString('zh-CN', { hour12: false })}</span>
                  </div>
                </div>
              </div>

              {/* Section 2: 拓展配置 (语言/机型) - 仅 repo_create 有具体配置时呈现 */}
              {selectedApproval.type === 'repo_create' && (selectedApproval.language || selectedApproval.machine_type || selectedApproval.tags) && (
                <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 10, border: '1px solid var(--border-color, rgba(255,255,255,0.06))', display: 'flex', gap: 16, alignItems: 'center', fontSize: 12 }}>
                  {selectedApproval.language && (
                    <div>
                      <span style={{ color: 'var(--text-secondary)', marginRight: 6 }}>编程语言:</span>
                      <span style={{ color: '#60a5fa', fontWeight: 600 }}>{selectedApproval.language}</span>
                    </div>
                  )}
                  {selectedApproval.machine_type && (
                    <div>
                      <span style={{ color: 'var(--text-secondary)', marginRight: 6 }}>编译机型:</span>
                      <span style={{ color: '#c084fc', fontWeight: 600 }}>{selectedApproval.machine_type}</span>
                    </div>
                  )}
                  {selectedApproval.tags && (
                    <div>
                      <span style={{ color: 'var(--text-secondary)', marginRight: 6 }}>标签:</span>
                      <span>{selectedApproval.tags}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Section 3: 申请原因说明 (紧凑展示) */}
              <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 12, border: '1px solid var(--border-color, rgba(255,255,255,0.06))' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                  申请原因说明
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {selectedApproval.reason || '无申请原因说明'}
                </div>
              </div>

              {/* Section 4: 历史核准结果 (若已处理) */}
              {(selectedApproval.approver || selectedApproval.approval_comment || selectedApproval.status !== 'pending') && (
                <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 12, border: '1px solid var(--border-color, rgba(255,255,255,0.06))', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    审批处理记录
                  </div>
                  {selectedApproval.approver && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>审批核准人:</span>
                      <span style={{ fontWeight: 600 }}>
                        {selectedApproval.approver.name || selectedApproval.approver.username}
                        {selectedApproval.approver.username ? ` (工号: ${selectedApproval.approver.username})` : ''}
                      </span>
                    </div>
                  )}
                  {selectedApproval.approval_comment && (
                    <div style={{ marginTop: 2 }}>
                      <span style={{ color: 'var(--text-secondary)', display: 'block', marginBottom: 2 }}>审批意见:</span>
                      <div style={{ background: 'rgba(0,0,0,0.2)', padding: 8, borderRadius: 6, color: 'var(--text-primary)' }}>
                        {selectedApproval.approval_comment}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Section 5: 管理员在线审批控制台 (仅 pending 状态 & isAdmin) */}
              {isAdmin && selectedApproval.status === 'pending' && (
                <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: 14, border: '1px solid var(--border-color, rgba(255,255,255,0.1))', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span>审批决议控制台</span>
                    <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-secondary)' }}>请选择决议动作并输入意见</span>
                  </div>

                  {/* 决议动作切换按钮 */}
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      type="button"
                      onClick={() => setActionType('approve')}
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        borderRadius: 6,
                        border: actionType === 'approve' ? '2px solid #10b981' : '1px solid rgba(255,255,255,0.1)',
                        background: actionType === 'approve' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255,255,255,0.02)',
                        color: actionType === 'approve' ? '#34d399' : 'var(--text-secondary)',
                        fontWeight: 600,
                        fontSize: 12,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6
                      }}
                    >
                      <CheckCircle2 size={14} /> 核准通过 (Approve)
                    </button>

                    <button
                      type="button"
                      onClick={() => setActionType('reject')}
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        borderRadius: 6,
                        border: actionType === 'reject' ? '2px solid #ef4444' : '1px solid rgba(255,255,255,0.1)',
                        background: actionType === 'reject' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255,255,255,0.02)',
                        color: actionType === 'reject' ? '#f87171' : 'var(--text-secondary)',
                        fontWeight: 600,
                        fontSize: 12,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6
                      }}
                    >
                      <XCircle size={14} /> 驳回申请 (Reject)
                    </button>
                  </div>

                  {/* 审批意见文本框 & 提交按钮 */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <textarea 
                      className="input"
                      style={{ height: 54, resize: 'none', width: '100%', fontSize: 12, padding: '6px 10px' }}
                      placeholder={actionType === 'approve' ? '可选填写通过说明与备注...' : '必须填写具体的驳回原因... *'}
                      value={comment}
                      onChange={e => setComment(e.target.value)}
                      required={actionType === 'reject'}
                      autoFocus
                    />

                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        onClick={() => handleActionSubmit(actionType === 'reject' ? 'reject' : 'approve')}
                        disabled={isProcessing}
                        className={`btn ${actionType === 'reject' ? 'btn-danger' : 'btn-success'}`}
                        style={{ padding: '6px 24px', fontWeight: 600, fontSize: 13, background: actionType === 'reject' ? '#ef4444' : '#10b981', color: '#fff' }}
                      >
                        {isProcessing ? '正在处理中...' : actionType === 'reject' ? '确认驳回申请' : '确认核准通过'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

