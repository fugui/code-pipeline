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

  // Detail Modal state
  const [viewingApproval, setViewingApproval] = useState<ManagedRepoApproval | null>(null)

  // Action modal
  const [activeApproval, setActiveApproval] = useState<ManagedRepoApproval | null>(null)
  const [actionType, setActionType] = useState<'approve' | 'reject' | null>(null)
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

  const handleAction = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeApproval || !actionType) return

    if (actionType === 'reject' && !comment.trim()) {
      showToast('驳回时必须填写驳回理由', 'error')
      return
    }

    setIsProcessing(true)
    try {
      const endpoint = `${apiBase}/managed-approvals/${activeApproval.id}/${actionType}`
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ comment: comment.trim() })
      })

      if (res.ok) {
        showToast(actionType === 'approve' ? '已核准通过，自动触发物理创建' : '已成功驳回申请单', 'success')
        setActiveApproval(null)
        setActionType(null)
        setComment('')
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
                          {app.type === 'repo_create' && app.default_branch && (
                            <span className="badge" style={{ padding: '1px 6px', borderRadius: 4, background: 'rgba(99, 102, 241, 0.1)', color: '#818cf8', fontSize: 11 }}>
                              主分支: {app.default_branch}
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
                            onClick={() => setViewingApproval(app)}
                            className="btn btn-secondary btn-small"
                            style={{ padding: '4px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          >
                            <Eye size={13} /> 详情
                          </button>

                          {isAdmin && app.status === 'pending' && (
                            <>
                              <button 
                                onClick={() => { setActiveApproval(app); setActionType('approve'); setComment('') }}
                                className="btn btn-success btn-small"
                                style={{ background: '#10b981', color: '#fff', padding: '4px 10px' }}
                              >
                                通过
                              </button>
                              <button 
                                onClick={() => { setActiveApproval(app); setActionType('reject'); setComment('') }}
                                className="btn btn-danger btn-small"
                                style={{ background: '#ef4444', color: '#fff', padding: '4px 10px' }}
                              >
                                驳回
                              </button>
                            </>
                          )}
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

      {/* Detail Modal */}
      {viewingApproval && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div className="glass-card" style={{ width: 620, maxWidth: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)' }}>
            {/* Modal Header */}
            <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-color, rgba(255,255,255,0.1))', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.02)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  申请单详情 <span style={{ color: '#6366f1' }}>#{viewingApproval.id}</span>
                </h3>
                {viewingApproval.type === 'repo_create' ? (
                  <span className="badge badge-info" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                    <Server size={12} /> 新建代码仓
                  </span>
                ) : (
                  <span className="badge badge-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                    <GitBranch size={12} /> 保护分支
                  </span>
                )}
                {viewingApproval.status === 'pending' && <span className="badge badge-warning">待审批</span>}
                {viewingApproval.status === 'approved' && <span className="badge badge-success">已通过</span>}
                {viewingApproval.status === 'rejected' && <span className="badge badge-danger">已驳回</span>}
              </div>
              <button onClick={() => setViewingApproval(null)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 4 }}>
                <X size={18} />
              </button>
            </div>

            {/* Modal Content */}
            <div style={{ padding: 24, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Section 1: 核心目标与仓库 */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                  核心参数 / 仓库分支
                </div>
                <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 14, border: '1px solid var(--border-color, rgba(255,255,255,0.05))', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>目标名称:</span>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                      {viewingApproval.type === 'repo_create' ? viewingApproval.repo_name : (viewingApproval.repo?.name || '代码仓')}
                    </span>
                  </div>
                  {viewingApproval.target_branch && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>目标分支:</span>
                      <span style={{ fontWeight: 600, color: '#818cf8' }}>{viewingApproval.target_branch}</span>
                    </div>
                  )}
                  {viewingApproval.default_branch && viewingApproval.type === 'repo_create' && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>默认主分支:</span>
                      <span style={{ fontWeight: 600, color: '#818cf8' }}>{viewingApproval.default_branch}</span>
                    </div>
                  )}
                  {viewingApproval.base_branch && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>基准来源分支:</span>
                      <span style={{ fontWeight: 600 }}>{viewingApproval.base_branch}</span>
                    </div>
                  )}
                  {viewingApproval.group && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>归属代码组:</span>
                      <span>{viewingApproval.group.full_path}</span>
                    </div>
                  )}
                  {viewingApproval.owner && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>仓库责任人:</span>
                      <span>{viewingApproval.owner.name || viewingApproval.owner.username} ({viewingApproval.owner.email})</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Section 2: 拓展配置 (语言/机型/描述) */}
              {(viewingApproval.language || viewingApproval.machine_type || viewingApproval.tags || viewingApproval.description) && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                    拓展元数据与环境配置
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 14, border: '1px solid var(--border-color, rgba(255,255,255,0.05))', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {viewingApproval.language && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                        <span style={{ color: 'var(--text-secondary)' }}>编程语言:</span>
                        <span style={{ color: '#60a5fa', fontWeight: 600 }}>{viewingApproval.language}</span>
                      </div>
                    )}
                    {viewingApproval.machine_type && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                        <span style={{ color: 'var(--text-secondary)' }}>编译环境/机型:</span>
                        <span style={{ color: '#c084fc', fontWeight: 600 }}>{viewingApproval.machine_type}</span>
                      </div>
                    )}
                    {viewingApproval.tags && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                        <span style={{ color: 'var(--text-secondary)' }}>标签:</span>
                        <span>{viewingApproval.tags}</span>
                      </div>
                    )}
                    {viewingApproval.description && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                        <span style={{ color: 'var(--text-secondary)' }}>描述说明:</span>
                        <div style={{ background: 'rgba(0,0,0,0.2)', padding: 10, borderRadius: 6, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {viewingApproval.description}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Section 3: 申请原因 (无截断展示) */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                  申请原因
                </div>
                <div style={{ background: 'rgba(255,255,255,0.04)', padding: 14, borderRadius: 8, border: '1px solid var(--border-color, rgba(255,255,255,0.08))', fontSize: 13, lineHeight: 1.6, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {viewingApproval.reason || '无申请原因说明'}
                </div>
              </div>

              {/* Section 4: 申请人及组织结构 */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                  申请人及组织信息
                </div>
                <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 14, border: '1px solid var(--border-color, rgba(255,255,255,0.05))', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }}>
                  <div>
                    <span style={{ color: 'var(--text-secondary)', display: 'block', fontSize: 11 }}>申请人姓名</span>
                    <span style={{ fontWeight: 600 }}>{viewingApproval.applicant?.name || `User #${viewingApproval.applicant_id}`}</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)', display: 'block', fontSize: 11 }}>申请人邮箱</span>
                    <span>{viewingApproval.applicant?.email || '-'}</span>
                  </div>
                  {viewingApproval.department && (
                    <div>
                      <span style={{ color: 'var(--text-secondary)', display: 'block', fontSize: 11 }}>归属部门</span>
                      <span>{viewingApproval.department.name}</span>
                    </div>
                  )}
                  {viewingApproval.subsystem && (
                    <div>
                      <span style={{ color: 'var(--text-secondary)', display: 'block', fontSize: 11 }}>所属子系统</span>
                      <span>{viewingApproval.subsystem.name}</span>
                    </div>
                  )}
                  <div>
                    <span style={{ color: 'var(--text-secondary)', display: 'block', fontSize: 11 }}>提交申请时间</span>
                    <span>{new Date(viewingApproval.created_at).toLocaleString('zh-CN', { hour12: false })}</span>
                  </div>
                </div>
              </div>

              {/* Section 5: 审批流程记录 */}
              {(viewingApproval.approver || viewingApproval.approval_comment || viewingApproval.status !== 'pending') && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                    审批核准记录
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 14, border: '1px solid var(--border-color, rgba(255,255,255,0.05))', display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
                    {viewingApproval.approver && (
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>审批核准人:</span>
                        <span style={{ fontWeight: 600 }}>{viewingApproval.approver.name || viewingApproval.approver.username}</span>
                      </div>
                    )}
                    {viewingApproval.updated_at && viewingApproval.status !== 'pending' && (
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>审批处理时间:</span>
                        <span>{new Date(viewingApproval.updated_at).toLocaleString('zh-CN', { hour12: false })}</span>
                      </div>
                    )}
                    {viewingApproval.approval_comment && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ color: 'var(--text-secondary)' }}>审批意见 / 驳回理由:</span>
                        <div style={{ background: 'rgba(0,0,0,0.2)', padding: 10, borderRadius: 6, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {viewingApproval.approval_comment}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-color, rgba(255,255,255,0.1))', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)' }}>
              <button className="btn btn-secondary" onClick={() => setViewingApproval(null)}>
                关闭
              </button>
              {isAdmin && viewingApproval.status === 'pending' && (
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    onClick={() => {
                      const app = viewingApproval
                      setViewingApproval(null)
                      setActiveApproval(app)
                      setActionType('approve')
                      setComment('')
                    }}
                    className="btn btn-success"
                    style={{ background: '#10b981', color: '#fff' }}
                  >
                    核准通过
                  </button>
                  <button
                    onClick={() => {
                      const app = viewingApproval
                      setViewingApproval(null)
                      setActiveApproval(app)
                      setActionType('reject')
                      setComment('')
                    }}
                    className="btn btn-danger"
                    style={{ background: '#ef4444', color: '#fff' }}
                  >
                    驳回申请
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Action Modal */}
      {activeApproval && actionType && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="glass-card" style={{ width: 440, padding: 24 }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 12px' }}>
              {actionType === 'approve' ? '核准通过申请单' : '驳回申请单'} (#{activeApproval.id})
            </h3>
            
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
              {actionType === 'approve' ? (
                '同意后系统将自动在远程 Git 平台创建物理仓库/分支并注册标准化 Webhook。'
              ) : (
                '驳回申请单，请在下方填写具体的驳回理由说明。'
              )}
            </p>

            <form onSubmit={handleAction} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label className="form-label" style={{ fontWeight: 600, display: 'block', marginBottom: 6 }}>
                  审批意见 / 驳回理由 {actionType === 'reject' && <span style={{ color: '#ef4444' }}>*</span>}
                </label>
                <textarea 
                  className="input"
                  style={{ height: 80, resize: 'vertical' }}
                  placeholder={actionType === 'approve' ? '可选填写通过说明...' : '必须填写驳回原因...'}
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  required={actionType === 'reject'}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
                <button type="button" onClick={() => { setActiveApproval(null); setActionType(null) }} className="btn btn-secondary">
                  取消
                </button>
                <button 
                  type="submit" 
                  className={`btn ${actionType === 'approve' ? 'btn-primary' : 'btn-danger'}`}
                  disabled={isProcessing}
                >
                  {isProcessing ? '正在处理...' : actionType === 'approve' ? '确认核准通过' : '确认驳回'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

