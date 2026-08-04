import React, { useState, useEffect } from 'react'
import { FileText, CheckCircle2, XCircle, Clock, RefreshCw, Server, GitBranch } from 'lucide-react'
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
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('all')
  const [typeFilter, setTypeFilter] = useState<'repo_create' | 'protected_branch' | 'batch_branch' | 'all'>('all')
  const [loading, setLoading] = useState(false)

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
    fetchApprovals()
  }, [apiBase, token, statusFilter, typeFilter])

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
              <option value="all">全部状态</option>
              <option value="pending">待审批 (Pending)</option>
              <option value="approved">已通过 (Approved)</option>
              <option value="rejected">已驳回 (Rejected)</option>
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
                  {isAdmin && <th style={{ textAlign: 'right' }}>操作</th>}
                </tr>
              </thead>
              <tbody>
                {approvals.map(app => (
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
                        {app.machine_type && (
                          <span className="badge" style={{ padding: '1px 6px', borderRadius: 4, background: 'rgba(168, 85, 247, 0.1)', color: '#c084fc', fontSize: 11 }}>
                            {app.machine_type}
                          </span>
                        )}
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
                    <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={app.reason}>
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
                    {isAdmin && (
                      <td style={{ textAlign: 'right' }}>
                        {app.status === 'pending' ? (
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
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
                          </div>
                        ) : (
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>已归档</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
