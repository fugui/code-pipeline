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
  global_config: '🌐 代码仓全局配置',
  branch_protection: '🛡️ 分支保护',
  engineering: '🔗 工程接入',
  ownership: '👤 归属治理',
  branch_hygiene: '🌿 分支卫生',
  metadata: '📝 元数据完整性',
  permission: '🔐 权限安全',
}

const dimensionOrder = [
  'global_config',
  'branch_protection',
  'engineering',
  'ownership',
  'branch_hygiene',
  'metadata',
  'permission',
]

const ruleDescriptions: Record<string, string> = {
  private_repo_required: '强制所有被管代码仓设为私有访问控制，严禁公开暴露，确保代码仓访问范围受限。',
  non_open_source_required: '强制限制代码仓为企业内部资产，禁止对外开源与全网公开访问。',
  has_description: '仓库包含明确的作用、架构职责与维护说明信息。',
  has_language: '仓库具备明确的主要编程语言类型标识。',
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
            代码仓合规基线配置
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
          {/* 概览统计行 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
            {[
              { label: '生效规则数', value: enabledCount, sub: `共 ${rules.length} 项`, color: '#6366f1', bg: 'rgba(99,102,241,0.12)' },
              { label: '严重 (Critical)', value: criticalCount, sub: '项已启用', color: severityLabel.critical.color, bg: severityLabel.critical.bg },
              { label: '重要 (Important)', value: importantCount, sub: '项已启用', color: severityLabel.important.color, bg: severityLabel.important.bg },
              { label: '建议 (Suggestion)', value: suggestionCount, sub: '项已启用', color: severityLabel.suggestion.color, bg: severityLabel.suggestion.bg },
            ].map(kpi => (
              <div key={kpi.label} className="glass-card" style={{ padding: '16px 20px' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>{kpi.label}</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: kpi.color }}>{kpi.value}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{kpi.sub}</div>
              </div>
            ))}
          </div>

          {/* 基线描述 + 更新时间 */}
          {isAdmin && (
            <div className="glass-card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                <Info size={14} style={{ color: '#6366f1' }} />
                基线描述说明
              </label>
              <input
                value={description}
                onChange={e => { setDescription(e.target.value); setIsDirty(true) }}
                placeholder="说明本全局合规基线的制定原则与管控要求..."
                style={{ flex: 1 }}
              />
              {baseline?.updated_at && (
                <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  最近更新: {new Date(baseline.updated_at).toLocaleString('zh-CN')}
                </span>
              )}
            </div>
          )}

          {/* 维度规则配置区域 */}
          {(() => {
            const sorted = Object.entries(groupRulesByDimension(rules))
              .sort(([a], [b]) => {
                const ia = dimensionOrder.indexOf(a)
                const ib = dimensionOrder.indexOf(b)
                return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
              })

            const globalEntry = sorted.find(([dim]) => dim === 'global_config')
            const otherEntries = sorted.filter(([dim]) => dim !== 'global_config')

            const renderRule = (rule: ComplianceRule) => {
              const sev = severityLabel[rule.severity]
              return (
                <div key={rule.check_key} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '11px 14px',
                  background: 'var(--portal-bg-color, rgba(255,255,255,0.02))',
                  borderRadius: 8, border: '1px solid var(--border-color)',
                  opacity: rule.enabled ? 1 : 0.55, transition: 'var(--transition)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                    <input
                      type="checkbox"
                      disabled={!isAdmin}
                      checked={rule.enabled}
                      onChange={() => toggleRule(rule.check_key)}
                      style={{ width: 'auto', flexShrink: 0, cursor: isAdmin ? 'pointer' : 'default' }}
                    />
                    <span style={{
                      fontSize: 11, padding: '2px 7px', borderRadius: 4, flexShrink: 0,
                      background: rule.enabled ? sev?.bg : 'var(--border-color)',
                      color: rule.enabled ? sev?.color : 'var(--text-muted)', fontWeight: 600,
                    }}>
                      {sev?.text}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: rule.enabled ? 'var(--text-main)' : 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {rule.label}
                      </div>
                      {ruleDescriptions[rule.check_key] && (
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>
                          {ruleDescriptions[rule.check_key]}
                        </div>
                      )}
                    </div>
                  </div>
                  {rule.threshold > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 10, flexShrink: 0 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>上限:</span>
                      <input
                        type="number"
                        disabled={!isAdmin || !rule.enabled}
                        value={rule.threshold}
                        onChange={e => updateThreshold(rule.check_key, parseInt(e.target.value) || 0)}
                        style={{ width: 58, padding: '3px 6px', textAlign: 'center', fontSize: 12 }}
                      />
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>个</span>
                    </div>
                  )}
                </div>
              )
            }

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* 全局配置 - 全宽展示，规则横向两列 */}
                {globalEntry && (
                  <div className="glass-card" style={{ padding: '18px 22px', border: '1px solid rgba(99,102,241,0.3)', background: 'rgba(99,102,241,0.04)' }}>
                    <h3 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      {dimensionLabel['global_config']}
                    </h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                      {globalEntry[1].map(renderRule)}
                    </div>
                  </div>
                )}

                {/* 其余维度 - 两列网格布局 */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, alignItems: 'start' }}>
                  {otherEntries.map(([dim, dimRules]) => (
                    <div key={dim} className="glass-card" style={{ padding: '18px 22px' }}>
                      <h3 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        {dimensionLabel[dim] || dim}
                      </h3>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {dimRules.map(renderRule)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}
        </>
      )}
    </div>
  )
}
