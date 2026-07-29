import React, { useState, useEffect } from 'react'
import { 
  X, 
  PlusCircle, 
  AlertTriangle, 
  CheckCircle2, 
  RefreshCw, 
  ArrowRight
} from 'lucide-react'
import { Pipeline } from '../types'

export interface DiffItemChange {
  category: 'scheme' | 'mr_binding' | 'execution_plan'
  field_name: string
  old_value: string
  new_value: string
}

export interface AddDiffItem {
  remote_scheme_id: string
  name: string
  repository_id: number
  repository_name: string
  branchs: string
  mr_trigger: boolean
  daily_build: boolean
  scheme_data: any
}

export interface UpdateDiffItem {
  local_id: number
  remote_scheme_id: string
  name: string
  repository_name: string
  branchs: string
  changes: DiffItemChange[]
  new_scheme_data: any
}

export interface DeleteDiffItem {
  local_id: number
  remote_scheme_id: string
  name: string
  repository_name: string
  branchs: string
  had_mr_trigger: boolean
  had_daily_build: boolean
}

export interface UnchangedDiffItem {
  local_id: number
  remote_scheme_id: string
  name: string
  repository_name: string
  branchs: string
}

export interface CalculateDiffResponse {
  pipeline_id: number
  pipeline_code: string
  pipeline_name: string
  summary: {
    add_count: number
    update_count: number
    delete_count: number
    unchanged_count: number
  }
  diff_details: {
    add_list: AddDiffItem[]
    update_list: UpdateDiffItem[]
    delete_list: DeleteDiffItem[]
    unchanged_list: UnchangedDiffItem[]
  }
}

interface SyncDiffModalProps {
  visible: boolean
  pipeline: Pipeline | null
  loading: boolean
  diffResult: CalculateDiffResponse | null
  onClose: () => void
  onConfirmSync: (payload: {
    pipeline_id: number
    add_schemes: any[]
    update_schemes: any[]
    delete_local_ids: number[]
  }) => Promise<void>
}

export const SyncDiffModal: React.FC<SyncDiffModalProps> = ({
  visible,
  pipeline,
  loading,
  diffResult,
  onClose,
  onConfirmSync
}) => {
  const [selectedAddIndex, setSelectedAddIndex] = useState<Set<number>>(new Set())
  const [selectedUpdateIndex, setSelectedUpdateIndex] = useState<Set<number>>(new Set())
  const [selectedDeleteIndex, setSelectedDeleteIndex] = useState<Set<number>>(new Set())
  const [submitting, setSubmitting] = useState<boolean>(false)
  const [activeTab, setActiveTab] = useState<'add' | 'update' | 'delete' | 'unchanged'>('update')

  // Auto initialize selection when diffResult arrives
  useEffect(() => {
    if (diffResult?.diff_details) {
      const { add_list, update_list, delete_list } = diffResult.diff_details
      setSelectedAddIndex(new Set(add_list.map((_, i) => i)))
      setSelectedUpdateIndex(new Set(update_list.map((_, i) => i)))
      setSelectedDeleteIndex(new Set(delete_list.map((_, i) => i)))

      // Pick default tab with changes
      if (update_list.length > 0) {
        setActiveTab('update')
      } else if (add_list.length > 0) {
        setActiveTab('add')
      } else if (delete_list.length > 0) {
        setActiveTab('delete')
      } else {
        setActiveTab('unchanged')
      }
    }
  }, [diffResult])

  if (!visible) return null

  const details = diffResult?.diff_details
  const summary = diffResult?.summary

  // Selection Toggles
  const toggleAdd = (index: number) => {
    const next = new Set(selectedAddIndex)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    setSelectedAddIndex(next)
  }

  const toggleUpdate = (index: number) => {
    const next = new Set(selectedUpdateIndex)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    setSelectedUpdateIndex(next)
  }

  const toggleDelete = (index: number) => {
    const next = new Set(selectedDeleteIndex)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    setSelectedDeleteIndex(next)
  }

  // Handle Confirm Submission
  const handleConfirm = async () => {
    if (!diffResult || !pipeline) return
    setSubmitting(true)

    try {
      const add_schemes = Array.from(selectedAddIndex)
        .map(i => details?.add_list[i]?.scheme_data)
        .filter(Boolean)

      const update_schemes = Array.from(selectedUpdateIndex)
        .map(i => details?.update_list[i]?.new_scheme_data)
        .filter(Boolean)

      const delete_local_ids: number[] = Array.from(selectedDeleteIndex)
        .map(i => details?.delete_list[i]?.local_id)
        .filter((id): id is number => typeof id === 'number')

      await onConfirmSync({
        pipeline_id: diffResult.pipeline_id || pipeline.id || 0,
        add_schemes,
        update_schemes,
        delete_local_ids
      })

      onClose()
    } catch (err) {
      console.error('Failed to apply sync changes', err)
    } finally {
      setSubmitting(false)
    }
  }

  const totalSelectedChanges = selectedAddIndex.size + selectedUpdateIndex.size + selectedDeleteIndex.size

  const getCategoryBadge = (category: string) => {
    switch (category) {
      case 'mr_binding':
        return <span style={{ background: 'rgba(168, 85, 247, 0.15)', color: '#c084fc', border: '1px solid rgba(168, 85, 247, 0.3)', fontSize: 10, padding: '1px 6px', borderRadius: 4 }}>MR 触发变动</span>
      case 'execution_plan':
        return <span style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.3)', fontSize: 10, padding: '1px 6px', borderRadius: 4 }}>执行计划变动</span>
      default:
        return <span style={{ background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8', border: '1px solid rgba(99, 102, 241, 0.3)', fontSize: 10, padding: '1px 6px', borderRadius: 4 }}>方案配置变动</span>
    }
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(6px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: 20
    }}>
      <div className="glass-card animate-fade-in" style={{
        width: '100%',
        maxWidth: 820,
        maxHeight: '88vh',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 14,
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
        overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{ 
          padding: '18px 24px', 
          borderBottom: '1px solid var(--border-color)', 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          background: 'rgba(255, 255, 255, 0.02)'
        }}>
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              <RefreshCw size={18} className={loading ? 'spin' : ''} style={{ color: '#818cf8' }} />
              流水线同步差异比对与二次确认
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 4 }}>
              对应流水线：<strong>{pipeline?.name}</strong> (ID: {pipeline?.pipeline_id})
            </p>
          </div>
          <button 
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 4 }}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ flex: 1, padding: 24, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, gap: 12, color: 'var(--text-secondary)' }}>
              <RefreshCw size={32} className="spin" style={{ color: '#818cf8' }} />
              <div>正在对比第三方控制台与本地数据库的全量差异 (Schemes + MR + Plans)...</div>
            </div>
          ) : diffResult ? (
            <>
              {/* Summary Badges */}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div 
                  onClick={() => setActiveTab('add')}
                  style={{ 
                    flex: 1, 
                    minWidth: 120,
                    padding: '10px 14px', 
                    borderRadius: 8, 
                    cursor: 'pointer',
                    background: activeTab === 'add' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255,255,255,0.03)',
                    border: activeTab === 'add' ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid var(--border-color)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10
                  }}
                >
                  <PlusCircle size={20} style={{ color: '#34d399' }} />
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>拟新增方案</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#34d399' }}>+{summary?.add_count || 0}</div>
                  </div>
                </div>

                <div 
                  onClick={() => setActiveTab('update')}
                  style={{ 
                    flex: 1, 
                    minWidth: 120,
                    padding: '10px 14px', 
                    borderRadius: 8, 
                    cursor: 'pointer',
                    background: activeTab === 'update' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255,255,255,0.03)',
                    border: activeTab === 'update' ? '1px solid rgba(245, 158, 11, 0.4)' : '1px solid var(--border-color)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10
                  }}
                >
                  <RefreshCw size={20} style={{ color: '#fbbf24' }} />
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>属性与配置变动</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#fbbf24' }}>{summary?.update_count || 0}</div>
                  </div>
                </div>

                <div 
                  onClick={() => setActiveTab('delete')}
                  style={{ 
                    flex: 1, 
                    minWidth: 120,
                    padding: '10px 14px', 
                    borderRadius: 8, 
                    cursor: 'pointer',
                    background: activeTab === 'delete' ? 'rgba(244, 63, 94, 0.15)' : 'rgba(255,255,255,0.03)',
                    border: activeTab === 'delete' ? '1px solid rgba(244, 63, 94, 0.4)' : '1px solid var(--border-color)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10
                  }}
                >
                  <AlertTriangle size={20} style={{ color: '#fb7185' }} />
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>本地拟移除方案</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#fb7185' }}>-{summary?.delete_count || 0}</div>
                  </div>
                </div>

                <div 
                  onClick={() => setActiveTab('unchanged')}
                  style={{ 
                    flex: 1, 
                    minWidth: 120,
                    padding: '10px 14px', 
                    borderRadius: 8, 
                    cursor: 'pointer',
                    background: activeTab === 'unchanged' ? 'rgba(148, 163, 184, 0.15)' : 'rgba(255,255,255,0.03)',
                    border: activeTab === 'unchanged' ? '1px solid rgba(148, 163, 184, 0.4)' : '1px solid var(--border-color)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10
                  }}
                >
                  <CheckCircle2 size={20} style={{ color: '#94a3b8' }} />
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>无变化一致项</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#94a3b8' }}>{summary?.unchanged_count || 0}</div>
                  </div>
                </div>
              </div>

              {/* Tab Content List */}
              <div style={{ minHeight: 240, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* 1. UPDATE TAB */}
                {activeTab === 'update' && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>属性与配置更替列表 ({details?.update_list.length || 0})</span>
                      <button 
                        style={{ background: 'none', border: 'none', color: '#818cf8', fontSize: 12, cursor: 'pointer' }}
                        onClick={() => {
                          if (selectedUpdateIndex.size === details?.update_list.length) {
                            setSelectedUpdateIndex(new Set())
                          } else {
                            setSelectedUpdateIndex(new Set(details?.update_list.map((_, i) => i)))
                          }
                        }}
                      >
                        {selectedUpdateIndex.size === details?.update_list.length ? '取消全选' : '全选变动项'}
                      </button>
                    </div>
                    {details && details.update_list.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {details.update_list.map((item, idx) => (
                          <div 
                            key={item.local_id || idx}
                            style={{ 
                              padding: 14, 
                              borderRadius: 8, 
                              background: 'rgba(255, 255, 255, 0.02)', 
                              border: '1px solid rgba(245, 158, 11, 0.25)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 8
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
                                <input 
                                  type="checkbox" 
                                  checked={selectedUpdateIndex.has(idx)} 
                                  onChange={() => toggleUpdate(idx)} 
                                />
                                <span>{item.repository_name} <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>({item.branchs})</span></span>
                              </label>
                              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>ID: {item.remote_scheme_id}</span>
                            </div>

                            {/* Changes diff list */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 24 }}>
                              {item.changes.map((change, cIdx) => (
                                <div key={cIdx} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
                                  {getCategoryBadge(change.category)}
                                  <span style={{ color: 'var(--text-secondary)', minWidth: 90 }}>{change.field_name}:</span>
                                  <span style={{ color: '#fb7185', background: 'rgba(244, 63, 94, 0.1)', padding: '1px 6px', borderRadius: 4 }}>{change.old_value}</span>
                                  <ArrowRight size={12} style={{ color: 'var(--text-muted)' }} />
                                  <span style={{ color: '#34d399', background: 'rgba(16, 185, 129, 0.1)', padding: '1px 6px', borderRadius: 4 }}>{change.new_value}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                        暂无属性或配置发生更替的执行方案
                      </div>
                    )}
                  </div>
                )}

                {/* 2. ADD TAB */}
                {activeTab === 'add' && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>三方控制台拟新增执行方案 ({details?.add_list.length || 0})</span>
                      <button 
                        style={{ background: 'none', border: 'none', color: '#818cf8', fontSize: 12, cursor: 'pointer' }}
                        onClick={() => {
                          if (selectedAddIndex.size === details?.add_list.length) {
                            setSelectedAddIndex(new Set())
                          } else {
                            setSelectedAddIndex(new Set(details?.add_list.map((_, i) => i)))
                          }
                        }}
                      >
                        {selectedAddIndex.size === details?.add_list.length ? '取消全选' : '全选新增项'}
                      </button>
                    </div>
                    {details && details.add_list.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {details.add_list.map((item, idx) => (
                          <div 
                            key={item.remote_scheme_id || idx}
                            style={{ 
                              padding: 14, 
                              borderRadius: 8, 
                              background: 'rgba(255, 255, 255, 0.02)', 
                              border: '1px solid rgba(16, 185, 129, 0.25)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between'
                            }}
                          >
                            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
                              <input 
                                type="checkbox" 
                                checked={selectedAddIndex.has(idx)} 
                                onChange={() => toggleAdd(idx)} 
                              />
                              <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <span>{item.repository_name}</span>
                                  <span style={{ fontSize: 12, color: '#818cf8' }}>({item.branchs})</span>
                                </div>
                                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                                  {item.mr_trigger && <span style={{ background: 'rgba(168, 85, 247, 0.15)', color: '#c084fc', fontSize: 10, padding: '1px 6px', borderRadius: 4 }}>含 MR 触发</span>}
                                  {item.daily_build && <span style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', fontSize: 10, padding: '1px 6px', borderRadius: 4 }}>含 每日构建</span>}
                                </div>
                              </div>
                            </label>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>ID: {item.remote_scheme_id}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                        未发现需要新增的执行方案
                      </div>
                    )}
                  </div>
                )}

                {/* 3. DELETE TAB */}
                {activeTab === 'delete' && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>本地拟废弃/移除的执行方案 ({details?.delete_list.length || 0})</span>
                      <button 
                        style={{ background: 'none', border: 'none', color: '#818cf8', fontSize: 12, cursor: 'pointer' }}
                        onClick={() => {
                          if (selectedDeleteIndex.size === details?.delete_list.length) {
                            setSelectedDeleteIndex(new Set())
                          } else {
                            setSelectedDeleteIndex(new Set(details?.delete_list.map((_, i) => i)))
                          }
                        }}
                      >
                        {selectedDeleteIndex.size === details?.delete_list.length ? '取消全选' : '全选移除项'}
                      </button>
                    </div>
                    {details && details.delete_list.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {details.delete_list.map((item, idx) => (
                          <div 
                            key={item.local_id || idx}
                            style={{ 
                              padding: 14, 
                              borderRadius: 8, 
                              background: 'rgba(244, 63, 94, 0.05)', 
                              border: '1px solid rgba(244, 63, 94, 0.25)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between'
                            }}
                          >
                            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
                              <input 
                                type="checkbox" 
                                checked={selectedDeleteIndex.has(idx)} 
                                onChange={() => toggleDelete(idx)} 
                              />
                              <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#fb7185' }}>
                                  <span>{item.repository_name}</span>
                                  <span style={{ fontSize: 12 }}>({item.branchs})</span>
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                                  警告：三方系统已不存在此方案，应用后本地对应记录将被物理删除
                                </div>
                              </div>
                            </label>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>本地 ID: {item.local_id}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                        未发现需要废弃或移除的本地方案记录
                      </div>
                    )}
                  </div>
                )}

                {/* 4. UNCHANGED TAB */}
                {activeTab === 'unchanged' && (
                  <div>
                    <div style={{ marginBottom: 10, fontSize: 13, fontWeight: 600 }}>两端保持完全一致的方案 ({details?.unchanged_list.length || 0})</div>
                    {details && details.unchanged_list.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {details.unchanged_list.map((item, idx) => (
                          <div 
                            key={item.local_id || idx}
                            style={{ 
                              padding: '10px 14px', 
                              borderRadius: 6, 
                              background: 'rgba(255, 255, 255, 0.015)', 
                              border: '1px solid rgba(255, 255, 255, 0.04)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              fontSize: 13,
                              color: 'var(--text-secondary)'
                            }}
                          >
                            <div>
                              <span>{item.repository_name}</span>
                              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>({item.branchs})</span>
                            </div>
                            <span style={{ fontSize: 11, color: '#34d399' }}>✓ 数据一致</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                        无完全一致的方案
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>未检索到差异数据</div>
          )}
        </div>

        {/* Modal Footer */}
        <div style={{ 
          padding: '16px 24px', 
          borderTop: '1px solid var(--border-color)', 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          background: 'rgba(255, 255, 255, 0.02)'
        }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            拟应用变更：已勾选 <strong>{totalSelectedChanges}</strong> 项变动操作
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-secondary" onClick={onClose} disabled={submitting}>
              取消
            </button>
            <button 
              className="btn btn-primary" 
              onClick={handleConfirm}
              disabled={submitting || loading || totalSelectedChanges === 0}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              {submitting ? <RefreshCw size={14} className="spin" /> : null}
              {submitting ? '正在应用变更...' : `确认应用同步变更 (${totalSelectedChanges})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
