import React, { useState, useEffect } from 'react'
import { Shield, Plus, Lock, CheckCircle2, RefreshCw, Server } from 'lucide-react'
import { ManagedProtectedBranchRule, ManagedRepository } from '../types'
import { useToast } from '../components/Toast'
import { Modal } from '@code/common'

interface ManagedProtectedRulesProps {
  isAdmin?: boolean
  apiBase: string
  token: string
}

export const ManagedProtectedRules: React.FC<ManagedProtectedRulesProps> = ({ apiBase, token }) => {
  const { showToast } = useToast()
  
  const [rules, setRules] = useState<ManagedProtectedBranchRule[]>([])
  const [repos, setRepos] = useState<ManagedRepository[]>([])
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)

  // Form states
  const [selectedRepoID, setSelectedRepoID] = useState<number>(0)
  const [branchPattern, setBranchPattern] = useState('master')
  const [allowForcePush, setAllowForcePush] = useState(false)
  const [requireMrAudit, setRequireMrAudit] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const fetchRules = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${apiBase}/managed-repos/protected-rules`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setRules(data)
      }
    } catch (err) {
      console.error('Failed to fetch protected rules:', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchRepos = async () => {
    try {
      const res = await fetch(`${apiBase}/managed-repos?include_hidden=false`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setRepos(data)
        if (data.length > 0) {
          setSelectedRepoID(data[0].id)
        }
      }
    } catch (err) {
      console.error('Failed to fetch repos:', err)
    }
  }

  useEffect(() => {
    fetchRules()
    fetchRepos()
  }, [apiBase, token])

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedRepoID) {
      showToast('请选择代码仓', 'error')
      return
    }
    if (!branchPattern.trim()) {
      showToast('请输入分支匹配表达式', 'error')
      return
    }

    setIsSubmitting(true)
    try {
      const res = await fetch(`${apiBase}/managed-repos/protected-rules`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          managed_repository_id: selectedRepoID,
          branch_pattern: branchPattern.trim(),
          allow_force_push: allowForcePush,
          require_mr_audit: requireMrAudit
        })
      })

      if (res.ok) {
        showToast('成功添加保护分支规则', 'success')
        setShowModal(false)
        fetchRules()
      } else {
        const errData = await res.json()
        showToast(`添加失败: ${errData.error || '未知错误'}`, 'error')
      }
    } catch (err) {
      showToast('网络请求失败', 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header */}
      <div className="glass-card" style={{ padding: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Shield size={22} />
          </div>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>保护分支策略配置</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
              管控受保护分支（如 master, release/*）的强推限制、MR 必须经过看护等高阶安全策略。
            </p>
          </div>
        </div>

        <button onClick={() => setShowModal(true)} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Plus size={16} /> 配置保护分支规则
        </button>
      </div>

      {/* Rules Table */}
      <div className="glass-card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>全仓受保护分支规则总览</h3>
          <button onClick={fetchRules} className="btn btn-secondary btn-small" title="刷新列表">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> 刷新
          </button>
        </div>

        {rules.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>
            <Lock size={32} style={{ opacity: 0.4, marginBottom: 8 }} />
            <p style={{ margin: 0, fontSize: 14 }}>暂无受保护分支规则记录</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>代码仓</th>
                  <th>受保护分支 Pattern</th>
                  <th>强推限制 (Force Push)</th>
                  <th>MR 必审看护 (Require Audit)</th>
                  <th>创建时间</th>
                </tr>
              </thead>
              <tbody>
                {rules.map(rule => (
                  <tr key={rule.id}>
                    <td style={{ fontWeight: 600 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Server size={14} color="#6366f1" />
                        {rule.repo?.name || `Repo #${rule.managed_repository_id}`}
                      </div>
                    </td>
                    <td>
                      <span className="badge badge-info" style={{ fontFamily: 'monospace' }}>
                        {rule.branch_pattern}
                      </span>
                    </td>
                    <td>
                      {rule.allow_force_push ? (
                        <span className="badge badge-warning">允许强推</span>
                      ) : (
                        <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <CheckCircle2 size={12} /> 禁止强推 (已保护)
                        </span>
                      )}
                    </td>
                    <td>
                      {rule.require_mr_audit ? (
                        <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <CheckCircle2 size={12} /> 强制 MR 看护
                        </span>
                      ) : (
                        <span className="badge badge-secondary">未启用</span>
                      )}
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                      {new Date(rule.created_at).toLocaleString('zh-CN', { hour12: false })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Create Protected Rule */}
      <Modal
        open={showModal}
        title="配置保护分支规则"
        subtitle="设置目标代码仓受保护分支的强推限制与门禁看护策略"
        onClose={() => setShowModal(false)}
        width="md"
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
            <button type="button" onClick={() => setShowModal(false)} className="btn btn-secondary">取消</button>
            <button type="submit" form="protected-rule-form" className="btn btn-primary" disabled={isSubmitting}>
              {isSubmitting ? '正在提交...' : '确认生效'}
            </button>
          </div>
        }
      >
        <form id="protected-rule-form" onSubmit={handleCreateRule} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label className="form-label" style={{ fontWeight: 600, display: 'block', marginBottom: 6, color: 'var(--color-text-primary)' }}>
              目标代码仓 <span style={{ color: 'var(--color-danger)' }}>*</span>
            </label>
            <select 
              className="code-select" 
              style={{ width: '100%' }}
              value={selectedRepoID}
              onChange={e => setSelectedRepoID(Number(e.target.value))}
              required
            >
              {repos.map(r => (
                <option key={r.id} value={r.id}>{r.name} ({r.group?.full_path || '根目录'})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="form-label" style={{ fontWeight: 600, display: 'block', marginBottom: 6, color: 'var(--color-text-primary)' }}>
              受保护分支表达式 <span style={{ color: 'var(--color-danger)' }}>*</span>
            </label>
            <input 
              type="text" 
              className="code-input" 
              placeholder="例如: master 或 release/*"
              value={branchPattern}
              onChange={e => setBranchPattern(e.target.value)}
              style={{ width: '100%' }}
              required
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14, borderRadius: 8, background: 'var(--color-bg-muted)', border: '1px solid var(--color-border-subtle)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--color-text-primary)' }}>
              <input 
                type="checkbox" 
                checked={!allowForcePush}
                onChange={e => setAllowForcePush(!e.target.checked)}
              />
              <span>禁止强推 (No Force Push)</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--color-text-primary)' }}>
              <input 
                type="checkbox" 
                checked={requireMrAudit}
                onChange={e => setRequireMrAudit(e.target.checked)}
              />
              <span>开启 Merge Request 必审与流水线门禁看护</span>
            </label>
          </div>
        </form>
      </Modal>
    </div>
  )
}
