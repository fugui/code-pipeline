import React, { useState, useEffect } from 'react'
import { 
  X, 
  PlusCircle, 
  AlertTriangle, 
  CheckCircle2, 
  RefreshCw, 
  Database,
  Cloud
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
  const [activeTab, setActiveTab] = useState<'update' | 'add' | 'delete' | 'unchanged'>('update')

  const details = diffResult?.diff_details

  // Helper lists with null fallback protection
  const addList = details?.add_list || []
  const updateList = details?.update_list || []
  const deleteList = details?.delete_list || []
  const unchangedList = details?.unchanged_list || []

  // Auto initialize selection when diffResult arrives
  useEffect(() => {
    if (diffResult?.diff_details) {
      const add_list = diffResult.diff_details.add_list || []
      const update_list = diffResult.diff_details.update_list || []
      const delete_list = diffResult.diff_details.delete_list || []

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
        .map(i => addList[i]?.scheme_data)
        .filter(Boolean)

      const update_schemes = Array.from(selectedUpdateIndex)
        .map(i => updateList[i]?.new_scheme_data)
        .filter(Boolean)

      const delete_local_ids: number[] = Array.from(selectedDeleteIndex)
        .map(i => deleteList[i]?.local_id)
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
        return <span style={{ background: 'rgba(168, 85, 247, 0.12)', color: '#a855f7', border: '1px solid rgba(168, 85, 247, 0.3)', fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>🔀 MR 触发</span>
      case 'execution_plan':
        return <span style={{ background: 'rgba(14, 165, 233, 0.12)', color: '#0284c7', border: '1px solid rgba(14, 165, 233, 0.3)', fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>📅 执行计划</span>
      default:
        return <span style={{ background: 'rgba(99, 102, 241, 0.12)', color: '#6366f1', border: '1px solid rgba(99, 102, 241, 0.3)', fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>⚙️ 执行方案</span>
    }
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.65)',
      backdropFilter: 'blur(5px)',
      display: 'flex',
      justifyContent: 'flex-end',
      zIndex: 99999
    }}>
      {/* Backdrop click to close */}
      <div style={{ flex: 1 }} onClick={onClose} />

      {/* Slide-in Drawer Container */}
      <div className="animate-fade-in" style={{
        width: '100%',
        maxWidth: 840,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '-12px 0 36px rgba(0, 0, 0, 0.3)',
        borderLeft: '1px solid var(--border-color)',
        overflow: 'hidden',
        background: 'var(--bg-secondary)',
        color: 'var(--text-main)'
      }}>
        {/* Header */}
        <div style={{ 
          padding: '24px 28px', 
          borderBottom: '1px solid var(--border-color)', 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          background: 'var(--bg-primary)'
        }}>
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-main)' }}>
              <RefreshCw size={20} className={loading ? 'spin' : ''} style={{ color: 'var(--border-active, #6366f1)' }} />
              流水线同步差异比对与二次确认
            </h3>
            <div style={{ display: 'flex', gap: 16, color: 'var(--text-secondary)', fontSize: 13, marginTop: 8, alignItems: 'center' }}>
              <span>流水线：<strong style={{ color: 'var(--text-main)' }}>{pipeline?.name}</strong></span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: 'rgba(99, 102, 241, 0.12)', color: '#6366f1', padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>
                ID: {pipeline?.pipeline_id}
              </span>
              {pipeline?.group_name && (
                <span style={{ fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', padding: '2px 8px', borderRadius: 4 }}>
                  分组: {pipeline.group_name}
                </span>
              )}
            </div>
          </div>
          <button 
            style={{ 
              background: 'var(--bg-card)', 
              border: '1px solid var(--border-color)', 
              color: 'var(--text-secondary)', 
              cursor: 'pointer', 
              padding: 8,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s'
            }}
            onClick={onClose}
            title="关闭抽屉"
          >
            <X size={18} />
          </button>
        </div>

        {/* Drawer Scrollable Body */}
        <div style={{ flex: 1, padding: 24, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 360, gap: 14, color: 'var(--text-secondary)' }}>
              <RefreshCw size={36} className="spin" style={{ color: 'var(--border-active, #6366f1)' }} />
              <div style={{ fontSize: 14, fontWeight: 500 }}>正在抓取第三方控制台与本地数据库，比对【执行方案 + MR触发 + 执行计划】全量差异...</div>
            </div>
          ) : diffResult ? (
            <>
              {/* Top Overview Cards / Tabs */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                <div 
                  onClick={() => setActiveTab('update')}
                  style={{ 
                    padding: '12px 14px', 
                    borderRadius: 10, 
                    cursor: 'pointer',
                    background: activeTab === 'update' ? 'rgba(245, 158, 11, 0.12)' : 'var(--bg-card)',
                    border: activeTab === 'update' ? '1px solid rgba(245, 158, 11, 0.5)' : '1px solid var(--border-color)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    transition: 'all 0.2s'
                  }}
                >
                  <RefreshCw size={20} style={{ color: '#d97706' }} />
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>属性与配置更替</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#d97706', marginTop: 2 }}>{summary?.update_count || 0} <span style={{ fontSize: 11, fontWeight: 400 }}>项</span></div>
                  </div>
                </div>

                <div 
                  onClick={() => setActiveTab('add')}
                  style={{ 
                    padding: '12px 14px', 
                    borderRadius: 10, 
                    cursor: 'pointer',
                    background: activeTab === 'add' ? 'rgba(16, 185, 129, 0.12)' : 'var(--bg-card)',
                    border: activeTab === 'add' ? '1px solid rgba(16, 185, 129, 0.5)' : '1px solid var(--border-color)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    transition: 'all 0.2s'
                  }}
                >
                  <PlusCircle size={20} style={{ color: '#059669' }} />
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>三方拟新增方案</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#059669', marginTop: 2 }}>+{summary?.add_count || 0} <span style={{ fontSize: 11, fontWeight: 400 }}>个</span></div>
                  </div>
                </div>

                <div 
                  onClick={() => setActiveTab('delete')}
                  style={{ 
                    padding: '12px 14px', 
                    borderRadius: 10, 
                    cursor: 'pointer',
                    background: activeTab === 'delete' ? 'rgba(244, 63, 94, 0.12)' : 'var(--bg-card)',
                    border: activeTab === 'delete' ? '1px solid rgba(244, 63, 94, 0.5)' : '1px solid var(--border-color)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    transition: 'all 0.2s'
                  }}
                >
                  <AlertTriangle size={20} style={{ color: '#e11d48' }} />
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>本地拟移除方案</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#e11d48', marginTop: 2 }}>-{summary?.delete_count || 0} <span style={{ fontSize: 11, fontWeight: 400 }}>个</span></div>
                  </div>
                </div>

                <div 
                  onClick={() => setActiveTab('unchanged')}
                  style={{ 
                    padding: '12px 14px', 
                    borderRadius: 10, 
                    cursor: 'pointer',
                    background: activeTab === 'unchanged' ? 'rgba(148, 163, 184, 0.15)' : 'var(--bg-card)',
                    border: activeTab === 'unchanged' ? '1px solid rgba(148, 163, 184, 0.5)' : '1px solid var(--border-color)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    transition: 'all 0.2s'
                  }}
                >
                  <CheckCircle2 size={20} style={{ color: '#64748b' }} />
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>保持一致无变化</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#64748b', marginTop: 2 }}>{summary?.unchanged_count || 0} <span style={{ fontSize: 11, fontWeight: 400 }}>个</span></div>
                  </div>
                </div>
              </div>

              {/* Tab Content List */}
              <div style={{ minHeight: 300, display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* 1. UPDATE TAB */}
                {activeTab === 'update' && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-main)' }}>
                        属性与配置更替列表 <span style={{ color: '#d97706', fontSize: 12 }}>({updateList.length} 个方案变动)</span>
                      </span>
                      <button 
                        style={{ background: 'none', border: 'none', color: '#6366f1', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
                        onClick={() => {
                          if (selectedUpdateIndex.size === updateList.length) {
                            setSelectedUpdateIndex(new Set())
                          } else {
                            setSelectedUpdateIndex(new Set(updateList.map((_, i) => i)))
                          }
                        }}
                      >
                        {selectedUpdateIndex.size === updateList.length ? '取消全选' : '全选变动项'}
                      </button>
                    </div>
                    {updateList.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        {updateList.map((item, idx) => (
                          <div 
                            key={item.local_id || idx}
                            style={{ 
                              padding: 16, 
                              borderRadius: 10, 
                              background: 'var(--bg-card)', 
                              border: '1px solid rgba(245, 158, 11, 0.4)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 12
                            }}
                          >
                            {/* Card Top Title Bar */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
                                <input 
                                  type="checkbox" 
                                  checked={selectedUpdateIndex.has(idx)} 
                                  onChange={() => toggleUpdate(idx)} 
                                  style={{ width: 16, height: 16, accentColor: '#6366f1', cursor: 'pointer' }}
                                />
                                <span style={{ color: 'var(--text-main)', fontSize: 15 }}>{item.repository_name}</span>
                                <span style={{ fontSize: 12, color: '#6366f1', fontFamily: 'var(--font-mono)', background: 'rgba(99, 102, 241, 0.12)', padding: '2px 8px', borderRadius: 4, fontWeight: 500 }}>
                                  分支: {item.branchs || '未设置'}
                                </span>
                              </label>
                              <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 12 }}>
                                <span>本地 DB ID: <strong>{item.local_id}</strong></span>
                                <span>三方 Scheme ID: <strong style={{ fontFamily: 'var(--font-mono)' }}>{item.remote_scheme_id}</strong></span>
                              </div>
                            </div>

                            {/* Detailed Tabular Diff Matrix */}
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, background: 'var(--bg-primary)', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                              <thead>
                                <tr style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>
                                  <th style={{ padding: '10px 12px', width: 120 }}>变更模块</th>
                                  <th style={{ padding: '10px 12px', width: 120 }}>对比属性/字段</th>
                                  <th style={{ padding: '10px 12px', color: '#e11d48' }}>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
                                      <Database size={13} /> 本地数据库 (Local DB)
                                    </span>
                                  </th>
                                  <th style={{ padding: '10px 12px', color: '#059669' }}>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
                                      <Cloud size={13} /> 第三方控制台 (Remote System)
                                    </span>
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {(item.changes || []).map((change, cIdx) => (
                                  <tr key={cIdx} style={{ borderBottom: cIdx < item.changes.length - 1 ? '1px solid var(--border-color)' : 'none' }}>
                                    <td style={{ padding: '10px 12px' }}>{getCategoryBadge(change.category)}</td>
                                    <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--text-main)' }}>{change.field_name}</td>
                                    <td style={{ padding: '10px 12px' }}>
                                      <span style={{ color: '#e11d48', background: 'rgba(225, 29, 72, 0.08)', border: '1px solid rgba(225, 29, 72, 0.25)', padding: '3px 8px', borderRadius: 4, display: 'inline-block', fontWeight: 500 }}>
                                        {change.old_value || '无'}
                                      </span>
                                    </td>
                                    <td style={{ padding: '10px 12px' }}>
                                      <span style={{ color: '#059669', background: 'rgba(5, 150, 105, 0.08)', border: '1px solid rgba(5, 150, 105, 0.25)', padding: '3px 8px', borderRadius: 4, display: 'inline-block', fontWeight: 500 }}>
                                        {change.new_value || '无'}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, background: 'var(--bg-card)', borderRadius: 10, border: '1px dashed var(--border-color)' }}>
                        暂无属性或配置发生更替的执行方案
                      </div>
                    )}
                  </div>
                )}

                {/* 2. ADD TAB */}
                {activeTab === 'add' && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-main)' }}>
                        三方控制台拟新增执行方案 <span style={{ color: '#059669', fontSize: 12 }}>({addList.length} 个新方案)</span>
                      </span>
                      <button 
                        style={{ background: 'none', border: 'none', color: '#6366f1', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
                        onClick={() => {
                          if (selectedAddIndex.size === addList.length) {
                            setSelectedAddIndex(new Set())
                          } else {
                            setSelectedAddIndex(new Set(addList.map((_, i) => i)))
                          }
                        }}
                      >
                        {selectedAddIndex.size === addList.length ? '取消全选' : '全选新增项'}
                      </button>
                    </div>
                    {addList.length > 0 ? (
                      <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid rgba(16, 185, 129, 0.4)', background: 'var(--bg-card)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
                          <thead>
                            <tr style={{ background: 'rgba(16, 185, 129, 0.08)', color: '#059669', borderBottom: '1px solid rgba(16, 185, 129, 0.2)' }}>
                              <th style={{ padding: '10px 14px', width: 40 }}>勾选</th>
                              <th style={{ padding: '10px 14px' }}>代码仓 / 方案名称</th>
                              <th style={{ padding: '10px 14px', width: 120 }}>生效分支</th>
                              <th style={{ padding: '10px 14px', width: 110 }}>MR 触发状态</th>
                              <th style={{ padding: '10px 14px', width: 110 }}>每日构建状态</th>
                              <th style={{ padding: '10px 14px', width: 160 }}>三方 Scheme ID</th>
                            </tr>
                          </thead>
                          <tbody>
                            {addList.map((item, idx) => (
                              <tr key={item.remote_scheme_id || idx} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                                  <input 
                                    type="checkbox" 
                                    checked={selectedAddIndex.has(idx)} 
                                    onChange={() => toggleAdd(idx)} 
                                    style={{ width: 16, height: 16, accentColor: '#059669', cursor: 'pointer' }}
                                  />
                                </td>
                                <td style={{ padding: '12px 14px', fontWeight: 600, color: 'var(--text-main)' }}>
                                  <div>{item.repository_name}</div>
                                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>{item.name}</div>
                                </td>
                                <td style={{ padding: '12px 14px', fontFamily: 'var(--font-mono)', color: '#6366f1', fontWeight: 500 }}>
                                  {item.branchs || '未指定'}
                                </td>
                                <td style={{ padding: '12px 14px' }}>
                                  {item.mr_trigger 
                                    ? <span style={{ background: 'rgba(168, 85, 247, 0.12)', color: '#a855f7', fontSize: 11, padding: '2px 6px', borderRadius: 4, fontWeight: 500 }}>含 MR 触发</span>
                                    : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>未开启</span>}
                                </td>
                                <td style={{ padding: '12px 14px' }}>
                                  {item.daily_build 
                                    ? <span style={{ background: 'rgba(14, 165, 233, 0.12)', color: '#0284c7', fontSize: 11, padding: '2px 6px', borderRadius: 4, fontWeight: 500 }}>含 每日构建</span>
                                    : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>未开启</span>}
                                </td>
                                <td style={{ padding: '12px 14px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
                                  {item.remote_scheme_id}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, background: 'var(--bg-card)', borderRadius: 10, border: '1px dashed var(--border-color)' }}>
                        未发现需要新增的三方执行方案
                      </div>
                    )}
                  </div>
                )}

                {/* 3. DELETE TAB */}
                {activeTab === 'delete' && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-main)' }}>
                        本地拟废弃/移除的执行方案 <span style={{ color: '#e11d48', fontSize: 12 }}>({deleteList.length} 个废弃方案)</span>
                      </span>
                      <button 
                        style={{ background: 'none', border: 'none', color: '#6366f1', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
                        onClick={() => {
                          if (selectedDeleteIndex.size === deleteList.length) {
                            setSelectedDeleteIndex(new Set())
                          } else {
                            setSelectedDeleteIndex(new Set(deleteList.map((_, i) => i)))
                          }
                        }}
                      >
                        {selectedDeleteIndex.size === deleteList.length ? '取消全选' : '全选移除项'}
                      </button>
                    </div>
                    {deleteList.length > 0 ? (
                      <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid rgba(244, 63, 94, 0.4)', background: 'var(--bg-card)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
                          <thead>
                            <tr style={{ background: 'rgba(244, 63, 94, 0.08)', color: '#e11d48', borderBottom: '1px solid rgba(244, 63, 94, 0.2)' }}>
                              <th style={{ padding: '10px 14px', width: 40 }}>勾选</th>
                              <th style={{ padding: '10px 14px' }}>代码仓 / 方案名称</th>
                              <th style={{ padding: '10px 14px', width: 120 }}>生效分支</th>
                              <th style={{ padding: '10px 14px', width: 110 }}>本地 DB ID</th>
                              <th style={{ padding: '10px 14px' }}>物理删除说明</th>
                            </tr>
                          </thead>
                          <tbody>
                            {deleteList.map((item, idx) => (
                              <tr key={item.local_id || idx} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                                  <input 
                                    type="checkbox" 
                                    checked={selectedDeleteIndex.has(idx)} 
                                    onChange={() => toggleDelete(idx)} 
                                    style={{ width: 16, height: 16, accentColor: '#e11d48', cursor: 'pointer' }}
                                  />
                                </td>
                                <td style={{ padding: '12px 14px', fontWeight: 600, color: '#e11d48' }}>
                                  <div>{item.repository_name}</div>
                                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>{item.name}</div>
                                </td>
                                <td style={{ padding: '12px 14px', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                                  {item.branchs || '未指定'}
                                </td>
                                <td style={{ padding: '12px 14px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                                  {item.local_id}
                                </td>
                                <td style={{ padding: '12px 14px', fontSize: 12, color: '#e11d48', fontWeight: 500 }}>
                                  ⚠️ 三方控制台已删除该方案，应用后本地数据库记录将被物理下架
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, background: 'var(--bg-card)', borderRadius: 10, border: '1px dashed var(--border-color)' }}>
                        未发现需要废弃或移除的本地方案记录
                      </div>
                    )}
                  </div>
                )}

                {/* 4. UNCHANGED TAB */}
                {activeTab === 'unchanged' && (
                  <div>
                    <div style={{ marginBottom: 12, fontSize: 14, fontWeight: 600, color: 'var(--text-main)' }}>两端保持完全一致的方案 ({unchangedList.length} 个一致项)</div>
                    {unchangedList.length > 0 ? (
                      <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
                          <thead>
                            <tr style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)' }}>
                              <th style={{ padding: '10px 14px' }}>代码仓名称</th>
                              <th style={{ padding: '10px 14px', width: 130 }}>生效分支</th>
                              <th style={{ padding: '10px 14px', width: 120 }}>本地 DB ID</th>
                              <th style={{ padding: '10px 14px', width: 160 }}>三方 Scheme ID</th>
                              <th style={{ padding: '10px 14px', width: 110, textAlign: 'right' }}>同步状态</th>
                            </tr>
                          </thead>
                          <tbody>
                            {unchangedList.map((item, idx) => (
                              <tr key={item.local_id || idx} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                <td style={{ padding: '12px 14px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                                  {item.repository_name}
                                </td>
                                <td style={{ padding: '12px 14px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>
                                  {item.branchs || '-'}
                                </td>
                                <td style={{ padding: '12px 14px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>
                                  {item.local_id}
                                </td>
                                <td style={{ padding: '12px 14px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>
                                  {item.remote_scheme_id}
                                </td>
                                <td style={{ padding: '12px 14px', textAlign: 'right', color: '#059669', fontSize: 12, fontWeight: 500 }}>
                                  ✓ 两端配置一致
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, background: 'var(--bg-card)', borderRadius: 10, border: '1px dashed var(--border-color)' }}>
                        无完全一致的方案
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>未检索到差异数据</div>
          )}
        </div>

        {/* Drawer Fixed Footer */}
        <div style={{ 
          padding: '16px 24px', 
          borderTop: '1px solid var(--border-color)', 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          background: 'var(--bg-primary)'
        }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            拟应用变更：已勾选 <strong style={{ color: 'var(--border-active, #6366f1)', fontSize: 15 }}>{totalSelectedChanges}</strong> 项同步操作
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button className="btn btn-secondary" onClick={onClose} disabled={submitting}>
              取消
            </button>
            <button 
              className="btn btn-primary" 
              onClick={handleConfirm}
              disabled={submitting || loading || totalSelectedChanges === 0}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 18px' }}
            >
              {submitting ? <RefreshCw size={15} className="spin" /> : null}
              {submitting ? '正在更新应用...' : `确认应用同步变更 (${totalSelectedChanges})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
