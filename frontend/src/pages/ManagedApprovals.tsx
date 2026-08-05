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
  const [decisionAction, setDecisionAction] = useState<'approve' | 'reject' | null>(null)
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

  const openDrawer = (app: ManagedRepoApproval) => {
    setSelectedApproval(app)
    setDecisionAction(null)
    setComment('')
  }

  const closeModal = () => {
    setSelectedApproval(null)
    setDecisionAction(null)
    setComment('')
  }

  const handleActionSubmit = async (targetAction: 'approve' | 'reject') => {
    if (!selectedApproval) return

    if (targetAction === 'reject' && !comment.trim()) {
      showToast('驳回时必须填写驳回理由说明', 'error')
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
                            归属组: {app.group.full_path} {app.owner ? ` | 责任人: ${app.owner.name || app.owner.username}${app.owner.username ? ` (工号: ${app.owner.username})` : ''}` : ''}
                          </div>
                        )}
                      </td>
                      <td>
                        <div>{app.applicant?.name || `User #${app.applicant_id}`}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                          {app.applicant?.username ? `工号: ${app.applicant.username}` : `ID: #${app.applicant_id}`}
                        </div>
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
                            onClick={() => openDrawer(app)}
                            className="btn btn-primary btn-small"
                            style={{ padding: '5px 14px', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}
                          >
                            <Eye size={14} /> 查看 / 审批
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

      {/* Unified Right Drawer (768px Width, Balanced Vertical Layout & Larger Fonts) */}
      {selectedApproval && (
        <div 
          className="drawer-overlay" 
          onClick={closeModal}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }}
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
              boxShadow: '-12px 0 40px rgba(0, 0, 0, 0.75)' 
            }}
          >
            {/* Drawer Header */}
            <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-color, rgba(255,255,255,0.1))', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.02)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  单据详情与审批 <span style={{ color: '#6366f1' }}>#{selectedApproval.id}</span>
                </h3>
                {selectedApproval.type === 'repo_create' ? (
                  <span className="badge badge-info" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, padding: '3px 8px' }}>
                    <Server size={13} /> 新建代码仓
                  </span>
                ) : (
                  <span className="badge badge-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, padding: '3px 8px' }}>
                    <GitBranch size={13} /> 保护分支
                  </span>
                )}
                {selectedApproval.status === 'pending' && <span className="badge badge-warning" style={{ fontSize: 12, padding: '3px 8px' }}>待审批</span>}
                {selectedApproval.status === 'approved' && <span className="badge badge-success" style={{ fontSize: 12, padding: '3px 8px' }}>已通过</span>}
                {selectedApproval.status === 'rejected' && <span className="badge badge-danger" style={{ fontSize: 12, padding: '3px 8px' }}>已驳回</span>}
              </div>
              <button 
                onClick={closeModal} 
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6 }}
                title="关闭抽屉"
              >
                <X size={22} />
              </button>
            </div>

            {/* Drawer Body (Balanced One-Screen View with 14px Font Sizes) */}
            <div style={{ padding: '20px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
              {/* Grid Layout Section 1: 核心元数据 (顺次：组 -> 名称 -> 分支) & 人员 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {/* 核心参数 (严格按【组 ➔ 名称 ➔ 分支】从上到下排列) */}
                <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '14px 16px', border: '1px solid var(--border-color, rgba(255,255,255,0.06))', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
                    {selectedApproval.type === 'repo_create' ? '代码仓核心元数据' : '分支与仓库配置'}
                  </div>

                  {selectedApproval.type === 'repo_create' ? (
                    <>
                      {/* 1. 归属代码组 */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, alignItems: 'center' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>1. 归属代码组:</span>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{selectedApproval.group?.full_path || '-'}</span>
                      </div>

                      {/* 2. 拟建代码仓名称 */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, alignItems: 'center' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>2. 代码仓名称:</span>
                        <span style={{ fontWeight: 700, color: '#60a5fa', fontSize: 14 }}>{selectedApproval.repo_name}</span>
                      </div>

                      {/* 3. 默认主分支 */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, alignItems: 'center' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>3. 默认主分支:</span>
                        <span style={{ fontWeight: 600, color: '#818cf8', background: 'rgba(99, 102, 241, 0.12)', padding: '2px 8px', borderRadius: 4 }}>
                          {selectedApproval.default_branch || selectedApproval.target_branch || 'master'}
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      {/* 1. 归属代码组 */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, alignItems: 'center' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>1. 归属代码组:</span>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{selectedApproval.group?.full_path || '-'}</span>
                      </div>

                      {/* 2. 目标代码仓名称 */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, alignItems: 'center' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>2. 目标代码仓:</span>
                        <span style={{ fontWeight: 700, color: '#60a5fa', fontSize: 14 }}>{selectedApproval.repo?.name || '代码仓'}</span>
                      </div>

                      {/* 3. 目标保护分支 & 基准来源分支 */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, alignItems: 'center' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>3. 目标保护分支:</span>
                        <span style={{ fontWeight: 600, color: '#818cf8', background: 'rgba(99, 102, 241, 0.12)', padding: '2px 8px', borderRadius: 4 }}>
                          {selectedApproval.target_branch}
                        </span>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, alignItems: 'center' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>   来源基准分支:</span>
                        <span style={{ fontWeight: 600, color: '#34d399', background: 'rgba(52, 211, 153, 0.12)', padding: '2px 8px', borderRadius: 4 }}>
                          {selectedApproval.base_branch || 'master'}
                        </span>
                      </div>
                    </>
                  )}
                </div>

                {/* 人员与组织架构 (工号标识展示) */}
                <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '14px 16px', border: '1px solid var(--border-color, rgba(255,255,255,0.06))', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
                    申请人及责任人 (员工工号)
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>申请人:</span>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                      {selectedApproval.applicant?.name || `User #${selectedApproval.applicant_id}`} 
                      {selectedApproval.applicant?.username ? ` (工号: ${selectedApproval.applicant.username})` : ''}
                    </span>
                  </div>

                  {selectedApproval.type === 'repo_create' && selectedApproval.owner && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>仓库责任人:</span>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                        {selectedApproval.owner.name || selectedApproval.owner.username} 
                        {selectedApproval.owner.username ? ` (工号: ${selectedApproval.owner.username})` : ''}
                      </span>
                    </div>
                  )}

                  {selectedApproval.department && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>归属部门:</span>
                      <span>{selectedApproval.department.name}</span>
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>提交申请时间:</span>
                    <span>{new Date(selectedApproval.created_at).toLocaleString('zh-CN', { hour12: false })}</span>
                  </div>
                </div>
              </div>

              {/* Section 2: 拓展配置 (2x2 网格) */}
              {selectedApproval.type === 'repo_create' && (selectedApproval.language || selectedApproval.machine_type || selectedApproval.tags || selectedApproval.description) && (
                <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '14px 16px', border: '1px solid var(--border-color, rgba(255,255,255,0.06))', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    环境与构架拓展元数据
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px', fontSize: 13 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>编程语言:</span>
                      <span style={{ color: '#60a5fa', fontWeight: 600, background: 'rgba(96, 165, 250, 0.1)', padding: '2px 8px', borderRadius: 4 }}>
                        {selectedApproval.language || '-'}
                      </span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>编译机型:</span>
                      <span style={{ color: '#c084fc', fontWeight: 600, background: 'rgba(192, 132, 252, 0.1)', padding: '2px 8px', borderRadius: 4 }}>
                        {selectedApproval.machine_type || '-'}
                      </span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>仓库标签:</span>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                        {selectedApproval.tags || '-'}
                      </span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>描述说明:</span>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={selectedApproval.description}>
                        {selectedApproval.description || '-'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Section 3: 申请原因说明 (弹性自适应填充中段全量剩余空间) */}
              <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '14px 16px', border: '1px solid var(--border-color, rgba(255,255,255,0.06))', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 120 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                  申请原因说明
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', flex: 1, overflowY: 'auto', background: 'rgba(0,0,0,0.15)', padding: '10px 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.03)' }}>
                  {selectedApproval.reason || '无申请原因说明'}
                </div>
              </div>

              {/* Section 4: 历史处理记录 */}
              {(selectedApproval.approver || selectedApproval.approval_comment || selectedApproval.status !== 'pending') && (
                <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '14px 16px', border: '1px solid var(--border-color, rgba(255,255,255,0.06))', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    审批处理结果
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
                    <div style={{ marginTop: 4 }}>
                      <span style={{ color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>审批意见 / 驳回理由:</span>
                      <div style={{ background: 'rgba(0,0,0,0.25)', padding: '10px 12px', borderRadius: 6, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                        {selectedApproval.approval_comment}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Section 5: 在线审批决议控制台 (明确化决策, 初始未选择时禁用提交按钮) */}
              {isAdmin && selectedApproval.status === 'pending' && (
                <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: '16px 18px', border: '1px solid var(--border-color, rgba(255,255,255,0.12))', display: 'flex', flexDirection: 'column', gap: 12, marginTop: 'auto' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <FileText size={16} color="#6366f1" /> 审批决议控制台
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 400, color: decisionAction ? 'var(--text-secondary)' : '#f59e0b' }}>
                      {decisionAction === 'approve' ? '已选择：核准通过' : decisionAction === 'reject' ? '已选择：驳回申请' : '请先选择决议动作（通过/驳回）'}
                    </span>
                  </div>

                  {/* 决议动作 Toggle 按钮组 */}
                  <div style={{ display: 'flex', gap: 12 }}>
                    <button
                      type="button"
                      onClick={() => setDecisionAction('approve')}
                      style={{
                        flex: 1,
                        padding: '10px 16px',
                        borderRadius: 8,
                        border: decisionAction === 'approve' ? '2px solid #10b981' : '1px solid rgba(255,255,255,0.12)',
                        background: decisionAction === 'approve' ? 'rgba(16, 185, 129, 0.18)' : 'rgba(255,255,255,0.02)',
                        color: decisionAction === 'approve' ? '#34d399' : 'var(--text-secondary)',
                        fontWeight: 700,
                        fontSize: 13,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        transition: 'all 0.2s ease'
                      }}
                    >
                      <CheckCircle2 size={16} /> 核准通过 (Approve)
                    </button>

                    <button
                      type="button"
                      onClick={() => setDecisionAction('reject')}
                      style={{
                        flex: 1,
                        padding: '10px 16px',
                        borderRadius: 8,
                        border: decisionAction === 'reject' ? '2px solid #ef4444' : '1px solid rgba(255,255,255,0.12)',
                        background: decisionAction === 'reject' ? 'rgba(239, 68, 68, 0.18)' : 'rgba(255,255,255,0.02)',
                        color: decisionAction === 'reject' ? '#f87171' : 'var(--text-secondary)',
                        fontWeight: 700,
                        fontSize: 13,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        transition: 'all 0.2s ease'
                      }}
                    >
                      <XCircle size={16} /> 驳回申请 (Reject)
                    </button>
                  </div>

                  {/* 审批意见文本框 & 严格按需可用的提交按钮 */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <textarea 
                      className="input"
                      style={{ height: 72, resize: 'none', width: '100%', fontSize: 13, padding: '8px 12px', lineHeight: 1.5 }}
                      placeholder={
                        decisionAction === 'approve'
                          ? '可选填写通过说明与备注...'
                          : decisionAction === 'reject'
                          ? '必须填写具体的驳回原因说明... *'
                          : '请先点击上方【核准通过】或【驳回申请】按钮选择决议动作...'
                      }
                      value={comment}
                      onChange={e => setComment(e.target.value)}
                    />

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, alignItems: 'center' }}>
                      {decisionAction === 'reject' && !comment.trim() && (
                        <span style={{ fontSize: 12, color: '#ef4444' }}>驳回必须填写原因说明</span>
                      )}

                      <button
                        onClick={() => decisionAction && handleActionSubmit(decisionAction)}
                        disabled={!decisionAction || isProcessing || (decisionAction === 'reject' && !comment.trim())}
                        className={`btn ${decisionAction === 'reject' ? 'btn-danger' : 'btn-success'}`}
                        style={{
                          padding: '8px 28px',
                          fontWeight: 700,
                          fontSize: 13,
                          opacity: (!decisionAction || isProcessing || (decisionAction === 'reject' && !comment.trim())) ? 0.45 : 1,
                          cursor: (!decisionAction || isProcessing || (decisionAction === 'reject' && !comment.trim())) ? 'not-allowed' : 'pointer',
                          background: decisionAction === 'reject' ? '#ef4444' : decisionAction === 'approve' ? '#10b981' : 'var(--bg-card, #333)',
                          color: '#fff'
                        }}
                      >
                        {isProcessing
                          ? '正在处理中...'
                          : decisionAction === 'approve'
                          ? '确认核准通过'
                          : decisionAction === 'reject'
                          ? '确认驳回申请'
                          : '请先选择决议动作'}
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

