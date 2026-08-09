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

const severityLabel: Record<string, { text: string; color: string }> = {
  critical: { text: '严重', color: '#ef4444' },
  important: { text: '重要', color: '#f97316' },
  suggestion: { text: '建议', color: '#6366f1' },
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
    <div style={{ padding: '0 0 40px 0' }}>
      {/* 页头 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, color: '#f0f0f0', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Shield size={22} />
            合规基线配置
          </h2>
          <p style={{ margin: '4px 0 0', color: 'rgba(255,255,255,0.45)', fontSize: 13 }}>
            定义"合格代码仓"标准，绑定到组后自动适用
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isAdmin && (
            <>
              <button onClick={triggerAudit} disabled={auditing} style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 6, color: '#ccc', cursor: 'pointer', fontSize: 13
              }}>
                <RefreshCw size={14} style={auditing ? { animation: 'spin 1s linear infinite' } : undefined} />
                {auditing ? '巡检中...' : '全量合规巡检'}
              </button>
              <button onClick={startCreate} disabled={isEditing} style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', border: 'none',
                borderRadius: 6, color: '#fff', cursor: isEditing ? 'not-allowed' : 'pointer', fontSize: 13,
                opacity: isEditing ? 0.5 : 1
              }}>
                <Plus size={14} />
                新建模板
              </button>
            </>
          )}
        </div>
      </div>

      {/* 编辑/创建表单 */}
      {isEditing && (
        <div style={{
          background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)',
          borderRadius: 10, padding: '20px 24px', marginBottom: 20
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 16, color: '#e0e0e0' }}>
              {editingId ? '编辑合规基线' : '新建合规基线'}
            </h3>
            <button onClick={cancelEdit} style={{
              background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer'
            }}>
              <X size={18} />
            </button>
          </div>

          {/* 基本信息 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 4, display: 'block' }}>模板名称 *</label>
              <input value={formName} onChange={e => setFormName(e.target.value)} placeholder="如：核心业务仓标准"
                style={{
                  width: '100%', padding: '8px 12px', background: 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#e0e0e0',
                  fontSize: 14, outline: 'none', boxSizing: 'border-box'
                }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 4, display: 'block' }}>描述</label>
              <input value={formDesc} onChange={e => setFormDesc(e.target.value)} placeholder="模板用途说明"
                style={{
                  width: '100%', padding: '8px 12px', background: 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#e0e0e0',
                  fontSize: 14, outline: 'none', boxSizing: 'border-box'
                }} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 24, marginBottom: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'rgba(255,255,255,0.6)', cursor: 'pointer' }}>
              <input type="checkbox" checked={formIsDefault} onChange={e => setFormIsDefault(e.target.checked)} />
              设为默认模板（新纳管仓库自动应用）
            </label>
          </div>

          {/* 绑定 Group */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 6, display: 'block' }}>
              绑定组（不绑定则仅在设为默认时全局生效）
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {groups.map(g => (
                <button key={g.id} onClick={() => toggleGroupID(g.id)}
                  style={{
                    padding: '4px 10px', borderRadius: 4, fontSize: 12, cursor: 'pointer',
                    background: formGroupIDs.includes(g.id) ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.04)',
                    border: formGroupIDs.includes(g.id) ? '1px solid rgba(99,102,241,0.5)' : '1px solid rgba(255,255,255,0.08)',
                    color: formGroupIDs.includes(g.id) ? '#a5b4fc' : 'rgba(255,255,255,0.5)',
                    transition: 'all 0.15s'
                  }}>{g.full_path || g.name}</button>
              ))}
              {groups.length === 0 && <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>暂无可绑定的组</span>}
            </div>
          </div>

          {/* 检查规则 */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 8, display: 'block' }}>检查规则</label>
            {Object.entries(groupRulesByDimension(formRules)).map(([dim, rules]) => (
              <div key={dim} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 6, fontWeight: 500 }}>
                  {dimensionLabel[dim] || dim}
                </div>
                {rules.map((rule) => {
                  const globalIdx = formRules.findIndex(r => r.check_key === rule.check_key)
                  const sev = severityLabel[rule.severity]
                  return (
                    <div key={rule.check_key} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px',
                      background: 'rgba(0,0,0,0.2)', borderRadius: 5, marginBottom: 4
                    }}>
                      <input type="checkbox" checked={rule.enabled} onChange={() => toggleRule(globalIdx)} />
                      <span style={{
                        fontSize: 11, padding: '1px 6px', borderRadius: 3,
                        background: `${sev?.color}22`, color: sev?.color, fontWeight: 500
                      }}>{sev?.text}</span>
                      <span style={{ flex: 1, fontSize: 13, color: rule.enabled ? '#e0e0e0' : 'rgba(255,255,255,0.3)' }}>
                        {rule.label}
                      </span>
                      {rule.threshold > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>阈值:</span>
                          <input type="number" value={rule.threshold} onChange={e => updateThreshold(globalIdx, parseInt(e.target.value) || 0)}
                            style={{
                              width: 50, padding: '2px 6px', background: 'rgba(0,0,0,0.3)',
                              border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, color: '#e0e0e0',
                              fontSize: 12, outline: 'none', textAlign: 'center'
                            }} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={cancelEdit} style={{
              padding: '7px 16px', background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#aaa',
              cursor: 'pointer', fontSize: 13
            }}>取消</button>
            <button onClick={handleSubmit} disabled={submitting} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '7px 16px',
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', border: 'none',
              borderRadius: 6, color: '#fff', cursor: 'pointer', fontSize: 13
            }}>
              <Save size={14} />
              {submitting ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      )}

      {/* 基线列表 */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'rgba(255,255,255,0.4)' }}>
          <RefreshCw size={18} style={{ animation: 'spin 1s linear infinite', marginBottom: 8 }} />
          <div>加载中...</div>
        </div>
      ) : baselines.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '60px 0', color: 'rgba(255,255,255,0.3)',
          background: 'rgba(255,255,255,0.02)', borderRadius: 10
        }}>
          <Layers size={32} style={{ marginBottom: 8 }} />
          <div>暂无合规基线模板</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {baselines.map(bl => {
            const isExpanded = expandedBaseline === bl.id
            const rules: ComplianceRule[] = bl.rules || []
            const enabledCount = rules.filter(r => r.enabled).length
            const groupIDs: number[] = bl.group_ids || []
            const boundGroups = groups.filter(g => groupIDs.includes(g.id))

            return (
              <div key={bl.id} style={{
                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 10, overflow: 'hidden',
                borderLeft: bl.is_default ? '3px solid #6366f1' : '3px solid transparent'
              }}>
                {/* 头部 */}
                <div
                  onClick={() => setExpandedBaseline(isExpanded ? null : bl.id)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '14px 18px', cursor: 'pointer'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {isExpanded ? <ChevronDown size={16} style={{ color: 'rgba(255,255,255,0.4)' }} /> : <ChevronRight size={16} style={{ color: 'rgba(255,255,255,0.4)' }} />}
                    <Shield size={16} style={{ color: '#6366f1' }} />
                    <span style={{ fontSize: 15, fontWeight: 500, color: '#e0e0e0' }}>{bl.name}</span>
                    {bl.is_default && (
                      <span style={{
                        fontSize: 11, padding: '1px 8px', borderRadius: 3,
                        background: 'rgba(99,102,241,0.15)', color: '#a5b4fc'
                      }}>默认</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                      {enabledCount}/{rules.length} 项启用
                    </span>
                    {boundGroups.length > 0 && (
                      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                        绑定 {boundGroups.length} 组
                      </span>
                    )}
                    {isAdmin && (
                      <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                        <button onClick={() => startEdit(bl)} style={{
                          background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)',
                          cursor: 'pointer', padding: 4
                        }}><Edit3 size={14} /></button>
                        {!bl.is_default && (
                          <button onClick={() => handleDelete(bl.id)} style={{
                            background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)',
                            cursor: 'pointer', padding: 4
                          }}><Trash2 size={14} /></button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* 展开详情 */}
                {isExpanded && (
                  <div style={{ padding: '0 18px 16px', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                    {bl.description && (
                      <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', margin: '12px 0 8px', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                        <Info size={14} style={{ marginTop: 1, flexShrink: 0 }} />
                        {bl.description}
                      </p>
                    )}

                    {boundGroups.length > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>绑定的组：</span>
                        {boundGroups.map(g => (
                          <span key={g.id} style={{
                            fontSize: 11, padding: '2px 8px', borderRadius: 3, marginLeft: 6,
                            background: 'rgba(99,102,241,0.1)', color: '#a5b4fc'
                          }}>{g.full_path || g.name}</span>
                        ))}
                      </div>
                    )}

                    {Object.entries(groupRulesByDimension(rules)).map(([dim, dimRules]) => (
                      <div key={dim} style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 4, fontWeight: 500 }}>
                          {dimensionLabel[dim] || dim}
                        </div>
                        {dimRules.map(rule => {
                          const sev = severityLabel[rule.severity]
                          return (
                            <div key={rule.check_key} style={{
                              display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px',
                              fontSize: 13, color: rule.enabled ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.25)'
                            }}>
                              {rule.enabled ? <CheckCircle2 size={13} style={{ color: '#22c55e' }} /> : <AlertTriangle size={13} style={{ color: 'rgba(255,255,255,0.2)' }} />}
                              <span style={{
                                fontSize: 10, padding: '0px 5px', borderRadius: 3,
                                background: `${sev?.color}15`, color: rule.enabled ? sev?.color : 'rgba(255,255,255,0.25)'
                              }}>{sev?.text}</span>
                              {rule.label}
                              {rule.threshold > 0 && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>(阈值: {rule.threshold})</span>}
                            </div>
                          )
                        })}
                      </div>
                    ))}
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
