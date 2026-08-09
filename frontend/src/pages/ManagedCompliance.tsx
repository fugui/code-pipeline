import React, { useState, useEffect } from 'react'
import {
  Shield, RefreshCw, Save, Info, RotateCcw
} from 'lucide-react'
import { ComplianceBaseline, ComplianceRule } from '../types'
import { useToast } from '../components/Toast'

interface ManagedComplianceProps {
  isAdmin?: boolean
  apiBase: string
  token: string
}

const severityLabel: Record<string, { text: string; color: string; bg: string }> = {
  critical: { text: '严重', color: '#f43f5e', bg: 'rgba(244, 63, 94, 0.15)' },
  important: { text: '重要', color: '#f97316', bg: 'rgba(249, 115, 22, 0.15)' },
  suggestion: { text: '建议', color: '#6366f1', bg: 'rgba(99, 102, 241, 0.15)' },
}

const dimensionLabel: Record<string, string> = {
  branch_protection: '🛡️ 分支保护',
  engineering: '🔗 工程接入',
  ownership: '👤 归属治理',
  branch_hygiene: '🌿 分支卫生',
  metadata: '📝 元数据完整性',
  permission: '🔐 权限安全',
}

export const ManagedCompliance: React.FC<ManagedComplianceProps> = ({ isAdmin = true, apiBase, token }) => {
  const { showToast } = useToast()

  const [baseline, setBaseline] = useState<ComplianceBaseline | null>(null)
  const [rules, setRules] = useState<ComplianceRule[]>([])
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [auditing, setAuditing] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }

  const fetchBaseline = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${apiBase}/managed-repos/compliance/baseline`, { headers })
      if (res.ok) {
        const data: ComplianceBaseline = await res.json()
        setBaseline(data)
        setRules(data.rules || [])
        setDescription(data.description || '')
        setIsDirty(false)
      }
    } catch (err) {
      console.error('获取全局合规基线失败:', err)
      showToast('获取全局合规基线失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchBaseline()
  }, [])

  const handleSave = async () => {
    setSubmitting(true)
    try {
      const body = JSON.stringify({
        name: baseline?.name || '全局合规基线',
        description,
        rules,
      })

      const res = await fetch(`${apiBase}/managed-repos/compliance/baseline`, {
        method: 'PUT',
        headers,
        body,
      })

      if (res.ok) {
        showToast('全局合规基线配置已保存', 'success')
        setIsDirty(false)
        fetchBaseline()
      } else {
        const data = await res.json()
        showToast(data.error || '保存失败', 'error')
      }
    } catch (err) {
      showToast('网络错误', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const resetToDefault = async () => {
    try {
      const res = await fetch(`${apiBase}/managed-repos/compliance/default-rules`, { headers })
      if (res.ok) {
        const defaultRules = await res.json()
        setRules(defaultRules)
        setIsDirty(true)
        showToast('已重置为系统内置默认规则（点击保存后生效）', 'info')
      }
    } catch (err) {
      showToast('重置失败', 'error')
    }
  }

  const triggerAudit = async () => {
    setAuditing(true)
    try {
      const res = await fetch(`${apiBase}/managed-repos/compliance/audit`, {
        method: 'POST',
        headers,
      })
      if (res.ok) {
        const data = await res.json()
        showToast(`全量合规巡检完成：成功 ${data.success} 仓，失败 ${data.fail} 仓`, 'success')
      } else {
        showToast('巡检失败', 'error')
      }
    } catch (err) {
      showToast('网络错误', 'error')
    } finally {
      setAuditing(false)
    }
  }

  const toggleRule = (checkKey: string) => {
    setRules(prev => prev.map(r => r.check_key === checkKey ? { ...r, enabled: !r.enabled } : r))
    setIsDirty(true)
  }

  const updateThreshold = (checkKey: string, val: number) => {
    setRules(prev => prev.map(r => r.check_key === checkKey ? { ...r, threshold: val } : r))
    setIsDirty(true)
  }

  // 按维度分组
  const groupRulesByDimension = (ruleList: ComplianceRule[]) => {
    const map: Record<string, ComplianceRule[]> = {}
    for (const r of ruleList) {
      if (!map[r.dimension]) map[r.dimension] = []
      map[r.dimension].push(r)
    }
    return map
  }

  const enabledCount = rules.filter(r => r.enabled).length
  const criticalCount = rules.filter(r => r.enabled && r.severity === 'critical').length
  const importantCount = rules.filter(r => r.enabled && r.severity === 'important').length
  const suggestionCount = rules.filter(r => r.enabled && r.severity === 'suggestion').length

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 40 }}>
      {/* 页头 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <Shield size={24} style={{ color: '#6366f1' }} />
            全局合规基线配置
          </h2>
          <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>
            全公司/全域代码仓统一适用的合规检查基准规范
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={triggerAudit} disabled={auditing} className="btn btn-secondary btn-small">
            <RefreshCw size={14} className={auditing ? 'animate-spin' : ''} />
            {auditing ? '巡检中...' : '全量合规巡检'}
          </button>
          {isAdmin && (
            <>
              <button onClick={resetToDefault} className="btn btn-secondary btn-small" title="重置为系统默认配置">
                <RotateCcw size={14} />
                恢复默认
              </button>
              <button onClick={handleSave} disabled={submitting || !isDirty} className="btn btn-primary btn-small" style={{ opacity: (!isDirty && !submitting) ? 0.6 : 1 }}>
                <Save size={14} />
                {submitting ? '保存中...' : (isDirty ? '保存全局配置 *' : '已保存')}
              </button>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-secondary)' }}>
          <RefreshCw size={20} className="animate-spin" style={{ marginBottom: 8 }} />
          <div>加载合规基线中...</div>
        </div>
      ) : (
        <>
          {/* 概览卡片 */}
          <div className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>生效规则数</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-main)' }}>
                  {enabledCount} <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-secondary)' }}>/ {rules.length} 项</span>
                </div>
              </div>
              <div style={{ height: 32, width: 1, background: 'var(--border-color)' }} />
              <div style={{ display: 'flex', gap: 12 }}>
                <div className="status-badge" style={{ background: severityLabel.critical.bg, color: severityLabel.critical.color }}>
                  严重 (Critical): {criticalCount}
                </div>
                <div className="status-badge" style={{ background: severityLabel.important.bg, color: severityLabel.important.color }}>
                  重要 (Important): {importantCount}
                </div>
                <div className="status-badge" style={{ background: severityLabel.suggestion.bg, color: severityLabel.suggestion.color }}>
                  建议 (Suggestion): {suggestionCount}
                </div>
              </div>
            </div>
            {baseline?.updated_at && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                最近更新时间: {new Date(baseline.updated_at).toLocaleString('zh-CN')}
              </div>
            )}
          </div>

          {/* 说明信息 */}
          {isAdmin && (
            <div className="glass-card" style={{ padding: '14px 18px' }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Info size={14} style={{ color: '#6366f1' }} />
                基线描述说明
              </label>
              <input
                value={description}
                onChange={e => { setDescription(e.target.value); setIsDirty(true) }}
                placeholder="说明本全局合规基线的制定原则与管控要求..."
              />
            </div>
          )}

          {/* 6 大维度规则配置列表 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {Object.entries(groupRulesByDimension(rules)).map(([dim, dimRules]) => (
              <div key={dim} className="glass-card" style={{ padding: '18px 22px' }}>
                <h3 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  {dimensionLabel[dim] || dim}
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {dimRules.map(rule => {
                    const sev = severityLabel[rule.severity]
                    return (
                      <div key={rule.check_key} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '10px 14px', background: 'var(--portal-bg-color, rgba(255,255,255,0.02))',
                        borderRadius: 8, border: '1px solid var(--border-color)',
                        opacity: rule.enabled ? 1 : 0.6, transition: 'var(--transition)'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
                          <input
                            type="checkbox"
                            disabled={!isAdmin}
                            checked={rule.enabled}
                            onChange={() => toggleRule(rule.check_key)}
                            style={{ width: 'auto', cursor: isAdmin ? 'pointer' : 'default' }}
                          />
                          <span style={{
                            fontSize: 11, padding: '2px 8px', borderRadius: 4,
                            background: rule.enabled ? sev?.bg : 'var(--border-color)',
                            color: rule.enabled ? sev?.color : 'var(--text-muted)', fontWeight: 600
                          }}>
                            {sev?.text}
                          </span>
                          <span style={{ fontSize: 14, fontWeight: 500, color: rule.enabled ? 'var(--text-main)' : 'var(--text-muted)' }}>
                            {rule.label}
                          </span>
                        </div>

                        {/* 阈值修改 */}
                        {rule.threshold > 0 && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>上限阈值:</span>
                            <input
                              type="number"
                              disabled={!isAdmin || !rule.enabled}
                              value={rule.threshold}
                              onChange={e => updateThreshold(rule.check_key, parseInt(e.target.value) || 0)}
                              style={{
                                width: 70, padding: '4px 8px', textAlign: 'center', fontSize: 13
                              }}
                            />
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>个</span>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
