import React, { useState, useEffect } from 'react'
import {
  Shield, Plus, RefreshCw, Trash2, CheckCircle2, AlertTriangle, Edit3, Save, X,
  Layers, ChevronDown, ChevronRight, Info
} from 'lucide-react'
import { ComplianceBaseline, ComplianceRule, ManagedGroup } from '../types'
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

  const [baselines, setBaselines] = useState<ComplianceBaseline[]>([])
  const [groups, setGroups] = useState<ManagedGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [auditing, setAuditing] = useState(false)

  // 编辑/创建状态
  const [editingId, setEditingId] = useState<number | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [formName, setFormName] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formIsDefault, setFormIsDefault] = useState(false)
  const [formRules, setFormRules] = useState<ComplianceRule[]>([])
  const [formGroupIDs, setFormGroupIDs] = useState<number[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [expandedBaseline, setExpandedBaseline] = useState<number | null>(null)

  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }

  const fetchBaselines = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${apiBase}/managed-repos/compliance/baselines`, { headers })
      if (res.ok) setBaselines(await res.json())
    } catch (err) {
      console.error('获取合规基线失败:', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchGroups = async () => {
    try {
      const res = await fetch(`${apiBase}/managed-groups`, { headers })
      if (res.ok) {
        const data = await res.json()
        setGroups(data.filter((g: ManagedGroup) => !g.is_hidden))
      }
    } catch (err) {
      console.error('获取组列表失败:', err)
    }
  }

  const fetchDefaultRules = async (): Promise<ComplianceRule[]> => {
    try {
      const res = await fetch(`${apiBase}/managed-repos/compliance/default-rules`, { headers })
      if (res.ok) return await res.json()
    } catch (err) {
      console.error('获取默认规则失败:', err)
    }
    return []
  }

  useEffect(() => {
    fetchBaselines()
    fetchGroups()
  }, [])

  const startCreate = async () => {
    const defaultRules = await fetchDefaultRules()
    setFormName('')
    setFormDesc('')
    setFormIsDefault(false)
    setFormRules(defaultRules)
    setFormGroupIDs([])
    setShowCreate(true)
    setEditingId(null)
  }

  const startEdit = (bl: ComplianceBaseline) => {
    setFormName(bl.name)
    setFormDesc(bl.description)
    setFormIsDefault(bl.is_default)
    setFormRules(bl.rules || [])
    setFormGroupIDs(bl.group_ids || [])
    setEditingId(bl.id)
    setShowCreate(false)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setShowCreate(false)
  }

  const handleSubmit = async () => {
    if (!formName.trim()) {
      showToast('请输入模板名称', 'error')
      return
    }
    setSubmitting(true)
    try {
      const body = JSON.stringify({
        name: formName,
        description: formDesc,
        is_default: formIsDefault,
        rules: formRules,
        group_ids: formGroupIDs,
      })

      const url = editingId
        ? `${apiBase}/managed-repos/compliance/baselines/${editingId}`
        : `${apiBase}/managed-repos/compliance/baselines`
      const method = editingId ? 'PUT' : 'POST'

      const res = await fetch(url, { method, headers, body })
      if (res.ok) {
        showToast(editingId ? '更新成功' : '创建成功', 'success')
        cancelEdit()
        fetchBaselines()
      } else {
        const data = await res.json()
        showToast(data.error || '操作失败', 'error')
      }
    } catch (err) {
      showToast('网络错误', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除该合规基线模板？')) return
    try {
      const res = await fetch(`${apiBase}/managed-repos/compliance/baselines/${id}`, {
        method: 'DELETE', headers
      })
      if (res.ok) {
        showToast('已删除', 'success')
        fetchBaselines()
      } else {
        const data = await res.json()
        showToast(data.error || '删除失败', 'error')
      }
    } catch (err) {
      showToast('网络错误', 'error')
    }
  }

  const triggerAudit = async () => {
    setAuditing(true)
    try {
      const res = await fetch(`${apiBase}/managed-repos/compliance/audit`, {
        method: 'POST', headers
      })
      if (res.ok) {
        const data = await res.json()
        showToast(`巡检完成：成功 ${data.success}，失败 ${data.fail}`, 'success')
      } else {
        showToast('巡检失败', 'error')
      }
    } catch (err) {
      showToast('网络错误', 'error')
    } finally {
      setAuditing(false)
    }
  }

  const toggleRule = (idx: number) => {
    setFormRules(prev => prev.map((r, i) => i === idx ? { ...r, enabled: !r.enabled } : r))
  }

  const updateThreshold = (idx: number, val: number) => {
    setFormRules(prev => prev.map((r, i) => i === idx ? { ...r, threshold: val } : r))
  }

  const toggleGroupID = (gid: number) => {
    setFormGroupIDs(prev => prev.includes(gid) ? prev.filter(id => id !== gid) : [...prev, gid])
  }

  const isEditing = editingId !== null || showCreate

  // 按维度分组
  const groupRulesByDimension = (rules: ComplianceRule[]) => {
    const map: Record<string, ComplianceRule[]> = {}
    for (const r of rules) {
      if (!map[r.dimension]) map[r.dimension] = []
      map[r.dimension].push(r)
    }
    return map
  }

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 40 }}>
      {/* 页头 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <Shield size={24} style={{ color: '#6366f1' }} />
            合规基线配置
          </h2>
          <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>
            定义"合格代码仓"标准，绑定到组后自动适用
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {isAdmin && (
            <>
              <button onClick={triggerAudit} disabled={auditing} className="btn btn-secondary btn-small">
                <RefreshCw size={14} className={auditing ? 'animate-spin' : ''} />
                {auditing ? '巡检中...' : '全量合规巡检'}
              </button>
              <button onClick={startCreate} disabled={isEditing} className="btn btn-primary btn-small" style={{ opacity: isEditing ? 0.5 : 1 }}>
                <Plus size={14} />
                新建模板
              </button>
            </>
          )}
        </div>
      </div>

      {/* 编辑/创建表单 */}
      {isEditing && (
        <div className="glass-card" style={{ border: '1px solid var(--border-active)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: 'var(--text-main)' }}>
              {editingId ? '编辑合规基线模板' : '新建合规基线模板'}
            </h3>
            <button onClick={cancelEdit} className="btn btn-secondary btn-small" style={{ padding: 6 }}>
              <X size={16} />
            </button>
          </div>

          {/* 基本信息 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>模板名称 *</label>
              <input value={formName} onChange={e => setFormName(e.target.value)} placeholder="如：核心业务仓标准" />
            </div>
            <div>
              <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>描述</label>
              <input value={formDesc} onChange={e => setFormDesc(e.target.value)} placeholder="模板用途说明" />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 24, marginBottom: 18 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--text-main)', cursor: 'pointer' }}>
              <input type="checkbox" checked={formIsDefault} onChange={e => setFormIsDefault(e.target.checked)} style={{ width: 'auto' }} />
              设为默认模板（新纳管仓库自动应用）
            </label>
          </div>

          {/* 绑定 Group */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 8, display: 'block' }}>
              绑定组（不绑定则仅在设为默认时全局生效）
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {groups.map(g => (
                <button key={g.id} onClick={() => toggleGroupID(g.id)}
                  className={`btn btn-small ${formGroupIDs.includes(g.id) ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ fontSize: 12 }}
                >
                  {g.full_path || g.name}
                </button>
              ))}
              {groups.length === 0 && <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>暂无可绑定的组</span>}
            </div>
          </div>

          {/* 检查规则 */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 10, display: 'block' }}>检查规则配置</label>
            {Object.entries(groupRulesByDimension(formRules)).map(([dim, rules]) => (
              <div key={dim} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-main)', marginBottom: 8 }}>
                  {dimensionLabel[dim] || dim}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {rules.map((rule) => {
                    const globalIdx = formRules.findIndex(r => r.check_key === rule.check_key)
                    const sev = severityLabel[rule.severity]
                    return (
                      <div key={rule.check_key} style={{
                        display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px',
                        background: 'var(--portal-bg-color, rgba(255,255,255,0.02))', borderRadius: 8,
                        border: '1px solid var(--border-color)'
                      }}>
                        <input type="checkbox" checked={rule.enabled} onChange={() => toggleRule(globalIdx)} style={{ width: 'auto' }} />
                        <span style={{
                          fontSize: 11, padding: '2px 8px', borderRadius: 4,
                          background: sev?.bg, color: sev?.color, fontWeight: 600
                        }}>{sev?.text}</span>
                        <span style={{ flex: 1, fontSize: 13, color: rule.enabled ? 'var(--text-main)' : 'var(--text-muted)' }}>
                          {rule.label}
                        </span>
                        {rule.threshold > 0 && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>阈值:</span>
                            <input type="number" value={rule.threshold} onChange={e => updateThreshold(globalIdx, parseInt(e.target.value) || 0)}
                              style={{
                                width: 60, padding: '4px 8px', textAlign: 'center', fontSize: 13
                              }} />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={cancelEdit} className="btn btn-secondary">取消</button>
            <button onClick={handleSubmit} disabled={submitting} className="btn btn-primary">
              <Save size={14} />
              {submitting ? '保存中...' : '保存模板'}
            </button>
          </div>
        </div>
      )}

      {/* 基线列表 */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary)' }}>
          <RefreshCw size={20} className="animate-spin" style={{ marginBottom: 8 }} />
          <div>加载中...</div>
        </div>
      ) : baselines.length === 0 ? (
        <div className="glass-card" style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
          <Layers size={36} style={{ marginBottom: 12, color: 'var(--text-muted)' }} />
          <div style={{ fontSize: 15 }}>暂无合规基线模板</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {baselines.map(bl => {
            const isExpanded = expandedBaseline === bl.id
            const rules: ComplianceRule[] = bl.rules || []
            const enabledCount = rules.filter(r => r.enabled).length
            const groupIDs: number[] = bl.group_ids || []
            const boundGroups = groups.filter(g => groupIDs.includes(g.id))

            return (
              <div key={bl.id} className="glass-card" style={{
                padding: 0, overflow: 'hidden',
                borderLeft: bl.is_default ? '4px solid #6366f1' : '1px solid var(--border-color)'
              }}>
                {/* 头部 */}
                <div
                  onClick={() => setExpandedBaseline(isExpanded ? null : bl.id)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '16px 20px', cursor: 'pointer', background: 'transparent'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {isExpanded ? <ChevronDown size={18} style={{ color: 'var(--text-secondary)' }} /> : <ChevronRight size={18} style={{ color: 'var(--text-secondary)' }} />}
                    <Shield size={18} style={{ color: '#6366f1' }} />
                    <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-main)' }}>{bl.name}</span>
                    {bl.is_default && (
                      <span className="status-badge running" style={{ fontSize: 11, padding: '2px 8px' }}>默认模板</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                      {enabledCount}/{rules.length} 项规则生效
                    </span>
                    {boundGroups.length > 0 && (
                      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                        已绑定 {boundGroups.length} 组
                      </span>
                    )}
                    {isAdmin && (
                      <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                        <button onClick={() => startEdit(bl)} className="btn btn-secondary btn-small" style={{ padding: '4px 8px' }}>
                          <Edit3 size={14} /> 编辑
                        </button>
                        {!bl.is_default && (
                          <button onClick={() => handleDelete(bl.id)} className="btn btn-danger btn-small" style={{ padding: '4px 8px' }}>
                            <Trash2 size={14} /> 删除
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* 展开详情 */}
                {isExpanded && (
                  <div style={{ padding: '16px 20px 20px', borderTop: '1px solid var(--border-color)', background: 'var(--portal-bg-color, rgba(255,255,255,0.01))' }}>
                    {bl.description && (
                      <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 14px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                        <Info size={16} style={{ marginTop: 1, flexShrink: 0, color: '#6366f1' }} />
                        {bl.description}
                      </p>
                    )}

                    {boundGroups.length > 0 && (
                      <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>绑定的组：</span>
                        {boundGroups.map(g => (
                          <span key={g.id} className="status-badge running" style={{ fontSize: 12 }}>
                            {g.full_path || g.name}
                          </span>
                        ))}
                      </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
                      {Object.entries(groupRulesByDimension(rules)).map(([dim, dimRules]) => (
                        <div key={dim} style={{
                          padding: '12px 14px', borderRadius: 8, background: 'var(--portal-bg-color, rgba(255,255,255,0.02))',
                          border: '1px solid var(--border-color)'
                        }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-main)', marginBottom: 8 }}>
                            {dimensionLabel[dim] || dim}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {dimRules.map(rule => {
                              const sev = severityLabel[rule.severity]
                              return (
                                <div key={rule.check_key} style={{
                                  display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
                                  color: rule.enabled ? 'var(--text-main)' : 'var(--text-muted)'
                                }}>
                                  {rule.enabled ? <CheckCircle2 size={14} style={{ color: '#10b981' }} /> : <AlertTriangle size={14} style={{ color: 'var(--text-muted)' }} />}
                                  <span style={{
                                    fontSize: 10, padding: '1px 6px', borderRadius: 4,
                                    background: rule.enabled ? sev?.bg : 'var(--border-color)',
                                    color: rule.enabled ? sev?.color : 'var(--text-muted)', fontWeight: 600
                                  }}>{sev?.text}</span>
                                  <span>{rule.label}</span>
                                  {rule.threshold > 0 && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>(阈值: {rule.threshold})</span>}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
