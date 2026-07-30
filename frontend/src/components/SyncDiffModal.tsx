import React, { useState, useEffect } from 'react'
import { 
  PlusCircle, 
  AlertTriangle, 
  CheckCircle2, 
  RefreshCw, 
  Database,
  Cloud,
  ArrowDownLeft,
  ArrowUpRight,
  Trash2,
  Check
} from 'lucide-react'
import { Pipeline } from '../types'
import { Drawer } from './Drawer'

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
  onRefreshDiff?: () => Promise<void> | void
  onConfirmSync?: (payload: {
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
  onRefreshDiff
}) => {
  const [activeTab, setActiveTab] = useState<'update' | 'add' | 'delete' | 'unchanged'>('update')
  const [syncingKey, setSyncingKey] = useState<string | null>(null)
  const [msgNotice, setMsgNotice] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  const details = diffResult?.diff_details

  // Helper lists with null fallback protection
  const addList = details?.add_list || []
  const updateList = details?.update_list || []
  const deleteList = details?.delete_list || []
  const unchangedList = details?.unchanged_list || []

  // Auto initialize default active tab when diffResult arrives
  useEffect(() => {
    if (diffResult?.diff_details) {
      const add_l = diffResult.diff_details.add_list || []
      const update_l = diffResult.diff_details.update_list || []
      const delete_l = diffResult.diff_details.delete_list || []

      if (update_l.length > 0) {
        setActiveTab('update')
      } else if (add_l.length > 0) {
        setActiveTab('add')
      } else if (delete_l.length > 0) {
        setActiveTab('delete')
      } else {
        setActiveTab('unchanged')
      }
    }
  }, [diffResult])

  const summary = diffResult?.summary

  // Directional Single Item / Field Sync Handler
  const handleSingleItemSync = async (params: {
    key: string
    direction: 'pull_to_local' | 'push_to_remote'
    category?: string
    action?: string
    local_id?: number
    remote_scheme_id?: string
    scheme_data?: any
  }) => {
    if (!diffResult && !pipeline) return
    setSyncingKey(params.key)
    setMsgNotice(null)

    const token = localStorage.getItem('code_shield_token') || localStorage.getItem('code_pipeline_token')
    const apiBase = window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')
      ? 'http://192.168.56.18:8000/api'
      : '/api'

    try {
      const res = await fetch(`${apiBase}/execution-schemes/sync-item`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          pipeline_id: diffResult?.pipeline_id || pipeline?.id || 0,
          direction: params.direction,
          category: params.category || 'full',
          action: params.action || 'upsert',
          local_id: params.local_id || 0,
          remote_scheme_id: params.remote_scheme_id || '',
          scheme_data: params.scheme_data || {}
        })
      })

      const data = await res.json()
      if (res.ok) {
        setMsgNotice({ type: 'success', text: data.message || '定向同步成功！' })
        if (onRefreshDiff) {
          await onRefreshDiff()
        }
      } else {
        setMsgNotice({ type: 'error', text: data.error || '定向同步失败' })
      }
    } catch (err: any) {
      console.error('Failed to sync single item', err)
      setMsgNotice({ type: 'error', text: err.message || '网络请求发生错误' })
    } finally {
      setSyncingKey(null)
    }
  }

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

  // Header Title component
  const drawerTitle = (
    <h3 style={{ fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-main)', margin: 0 }}>
      <RefreshCw size={20} className={loading ? 'spin' : ''} style={{ color: 'var(--border-active, #6366f1)' }} />
      流水线同步差异比对与二次确认
    </h3>
  )

  // Subtitle component
  const drawerSubtitle = (
    <div style={{ display: 'flex', gap: 16, color: 'var(--text-secondary)', fontSize: 13, alignItems: 'center' }}>
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
  )

  // Footer component (Replaced bulk sync with status notice & per-item actions)
  const drawerFooter = (
    <>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>💡 <strong>操作说明：</strong>您可以对任意差异记录或模块选择【⬇️ 拉取至本地】(修正本地数据库) 或【⬆️ 推送至三方】(更新/创建远程系统)，变更即时应用生效。</span>
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        {onRefreshDiff && (
          <button 
            className="btn btn-secondary" 
            onClick={() => onRefreshDiff()} 
            disabled={loading || !!syncingKey}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '7px 14px' }}
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            重新比对
          </button>
        )}
        <button 
          className="btn btn-primary" 
          onClick={onClose} 
          disabled={!!syncingKey}
          style={{ padding: '7px 18px', fontSize: 13 }}
        >
          完成 / 关闭
        </button>
      </div>
    </>
  )

  return (
    <Drawer
      visible={visible}
      onClose={onClose}
      title={drawerTitle}
      subtitle={drawerSubtitle}
      footer={drawerFooter}
      width="min(1092px, 96vw)"
    >
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 360, gap: 14, color: 'var(--text-secondary)' }}>
          <RefreshCw size={36} className="spin" style={{ color: 'var(--border-active, #6366f1)' }} />
          <div style={{ fontSize: 14, fontWeight: 500 }}>正在抓取第三方控制台与本地数据库，比对【执行方案 + MR触发 + 执行计划】全量差异...</div>
        </div>
      ) : diffResult ? (
        <>
          {/* Notification Message Banner */}
          {msgNotice && (
            <div style={{
              padding: '10px 16px',
              borderRadius: 8,
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: msgNotice.type === 'success' ? 'rgba(5, 150, 105, 0.12)' : 'rgba(225, 29, 72, 0.12)',
              border: msgNotice.type === 'success' ? '1px solid rgba(5, 150, 105, 0.3)' : '1px solid rgba(225, 29, 72, 0.3)',
              color: msgNotice.type === 'success' ? '#059669' : '#e11d48'
            }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
                {msgNotice.type === 'success' ? <Check size={16} /> : <AlertTriangle size={16} />}
                {msgNotice.text}
              </span>
              <button 
                onClick={() => setMsgNotice(null)} 
                style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 4 }}
              >
                ✕
              </button>
            </div>
          )}

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
                </div>
                {updateList.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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
                        {/* Card Top Title & Global Card Action Bar */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600, fontSize: 14 }}>
                            <span style={{ color: 'var(--text-main)', fontSize: 15 }}>{item.repository_name}</span>
                            {item.name && (
                              <span style={{ fontSize: 13, color: '#6366f1', fontWeight: 500 }}>
                                ({item.name})
                              </span>
                            )}
                            <span style={{ fontSize: 12, color: '#6366f1', fontFamily: 'var(--font-mono)', background: 'rgba(99, 102, 241, 0.12)', padding: '2px 8px', borderRadius: 4, fontWeight: 500 }}>
                              分支: {item.branchs || '未设置'}
                            </span>
                          </div>

                          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 10, marginRight: 6 }}>
                              <span>本地 DB ID: <strong>{item.local_id}</strong></span>
                              <span>
                                三方方案: <strong style={{ color: 'var(--text-main)' }}>{item.name || '未设置'}</strong>
                                {item.remote_scheme_id && (
                                  <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4, fontFamily: 'var(--font-mono)' }} title={`Scheme ID: ${item.remote_scheme_id}`}>
                                    ({item.remote_scheme_id})
                                  </span>
                                )}
                              </span>
                            </div>

                            {/* Card Level Action Buttons */}
                            <button
                              className="btn btn-secondary btn-small"
                              style={{ padding: '4px 10px', fontSize: 12, background: 'rgba(5, 150, 105, 0.12)', color: '#059669', border: '1px solid rgba(5, 150, 105, 0.3)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                              disabled={!!syncingKey}
                              onClick={() => handleSingleItemSync({
                                key: `update-${item.local_id}-full-pull`,
                                direction: 'pull_to_local',
                                category: 'full',
                                local_id: item.local_id,
                                remote_scheme_id: item.remote_scheme_id,
                                scheme_data: item.new_scheme_data
                              })}
                              title="将该方案在三方系统的全部配置覆盖修正至本地 DB"
                            >
                              {syncingKey === `update-${item.local_id}-full-pull` ? <RefreshCw size={12} className="spin" /> : <ArrowDownLeft size={13} />}
                              整方案拉取至本地
                            </button>
                            <button
                              className="btn btn-secondary btn-small"
                              style={{ padding: '4px 10px', fontSize: 12, background: 'rgba(99, 102, 241, 0.12)', color: '#6366f1', border: '1px solid rgba(99, 102, 241, 0.3)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                              disabled={!!syncingKey}
                              onClick={() => handleSingleItemSync({
                                key: `update-${item.local_id}-full-push`,
                                direction: 'push_to_remote',
                                category: 'full',
                                local_id: item.local_id,
                                remote_scheme_id: item.remote_scheme_id,
                                scheme_data: item.new_scheme_data
                              })}
                              title="将该方案在本地 DB 的配置修改覆盖推送至三方系统"
                            >
                              {syncingKey === `update-${item.local_id}-full-push` ? <RefreshCw size={12} className="spin" /> : <ArrowUpRight size={13} />}
                              整方案推送至三方
                            </button>
                          </div>
                        </div>

                        {/* Detailed Tabular Diff Matrix with Row-Level Granular Sync Actions */}
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, background: 'var(--bg-primary)', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                          <thead>
                            <tr style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>
                              <th style={{ padding: '10px 12px', width: 110 }}>变更模块</th>
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
                              <th style={{ padding: '10px 12px', width: 230, textAlign: 'center' }}>分项精准同步</th>
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
                                <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                                  <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                                    <button
                                      className="btn btn-secondary btn-small"
                                      style={{ padding: '3px 8px', fontSize: 11, background: 'rgba(5, 150, 105, 0.12)', color: '#059669', border: '1px solid rgba(5, 150, 105, 0.3)', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                                      disabled={!!syncingKey}
                                      onClick={() => handleSingleItemSync({
                                        key: `update-${item.local_id}-${change.category}-pull`,
                                        direction: 'pull_to_local',
                                        category: change.category,
                                        local_id: item.local_id,
                                        remote_scheme_id: item.remote_scheme_id,
                                        scheme_data: item.new_scheme_data
                                      })}
                                      title="以三方的这项配置为准，覆盖更正本地 DB 对应字段"
                                    >
                                      {syncingKey === `update-${item.local_id}-${change.category}-pull` ? <RefreshCw size={11} className="spin" /> : <ArrowDownLeft size={12} />}
                                      拉取至本地
                                    </button>
                                    <button
                                      className="btn btn-secondary btn-small"
                                      style={{ padding: '3px 8px', fontSize: 11, background: 'rgba(99, 102, 241, 0.12)', color: '#6366f1', border: '1px solid rgba(99, 102, 241, 0.3)', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                                      disabled={!!syncingKey}
                                      onClick={() => handleSingleItemSync({
                                        key: `update-${item.local_id}-${change.category}-push`,
                                        direction: 'push_to_remote',
                                        category: change.category,
                                        local_id: item.local_id,
                                        remote_scheme_id: item.remote_scheme_id,
                                        scheme_data: item.new_scheme_data
                                      })}
                                      title="以本地此项配置为准，在三方新建/更新该模块或规则"
                                    >
                                      {syncingKey === `update-${item.local_id}-${change.category}-push` ? <RefreshCw size={11} className="spin" /> : <ArrowUpRight size={12} />}
                                      推送至三方
                                    </button>
                                  </div>
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

            {/* 2. ADD TAB (三方拟新增方案) */}
            {activeTab === 'add' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-main)' }}>
                    三方控制台拟新增执行方案 <span style={{ color: '#059669', fontSize: 12 }}>({addList.length} 个新方案)</span>
                  </span>
                </div>
                {addList.length > 0 ? (
                  <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid rgba(16, 185, 129, 0.4)', background: 'var(--bg-card)' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
                      <thead>
                        <tr style={{ background: 'rgba(16, 185, 129, 0.08)', color: '#059669', borderBottom: '1px solid rgba(16, 185, 129, 0.2)' }}>
                          <th style={{ padding: '10px 14px' }}>代码仓 / 方案名称</th>
                          <th style={{ padding: '10px 14px', width: 120 }}>生效分支</th>
                          <th style={{ padding: '10px 14px', width: 110 }}>MR 触发状态</th>
                          <th style={{ padding: '10px 14px', width: 110 }}>每日构建状态</th>
                          <th style={{ padding: '10px 14px', width: 160 }}>三方方案名称 / ID</th>
                          <th style={{ padding: '10px 14px', width: 250, textAlign: 'center' }}>定向操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {addList.map((item, idx) => (
                          <tr key={item.remote_scheme_id || idx} style={{ borderBottom: '1px solid var(--border-color)' }}>
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
                            <td style={{ padding: '12px 14px', fontSize: 12 }}>
                              {item.name && <div style={{ fontWeight: 500, color: 'var(--text-main)' }}>{item.name}</div>}
                              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
                                {item.remote_scheme_id}
                              </div>
                            </td>
                            <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                              <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                                <button
                                  className="btn btn-secondary btn-small"
                                  style={{ padding: '4px 10px', fontSize: 12, background: 'rgba(5, 150, 105, 0.15)', color: '#059669', border: '1px solid rgba(5, 150, 105, 0.3)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                                  disabled={!!syncingKey}
                                  onClick={() => handleSingleItemSync({
                                    key: `add-${item.remote_scheme_id}-pull`,
                                    direction: 'pull_to_local',
                                    action: 'upsert',
                                    category: 'full',
                                    remote_scheme_id: item.remote_scheme_id,
                                    scheme_data: item.scheme_data
                                  })}
                                  title="在本地数据库创建导入该三方新增方案"
                                >
                                  {syncingKey === `add-${item.remote_scheme_id}-pull` ? <RefreshCw size={12} className="spin" /> : <ArrowDownLeft size={13} />}
                                  拉取导入本地
                                </button>
                                <button
                                  className="btn btn-secondary btn-small"
                                  style={{ padding: '4px 10px', fontSize: 12, background: 'rgba(225, 29, 72, 0.1)', color: '#e11d48', border: '1px solid rgba(225, 29, 72, 0.3)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                                  disabled={!!syncingKey}
                                  onClick={() => handleSingleItemSync({
                                    key: `add-${item.remote_scheme_id}-delremote`,
                                    direction: 'push_to_remote',
                                    action: 'delete_remote',
                                    remote_scheme_id: item.remote_scheme_id,
                                    scheme_data: item.scheme_data
                                  })}
                                  title="在三方系统中物理下架该废弃方案"
                                >
                                  {syncingKey === `add-${item.remote_scheme_id}-delremote` ? <RefreshCw size={12} className="spin" /> : <Trash2 size={13} />}
                                  清理三方远程
                                </button>
                              </div>
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

            {/* 3. DELETE TAB (本地拟废弃方案) */}
            {activeTab === 'delete' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-main)' }}>
                    本地拟废弃/移除的执行方案 <span style={{ color: '#e11d48', fontSize: 12 }}>({deleteList.length} 个废弃方案)</span>
                  </span>
                </div>
                {deleteList.length > 0 ? (
                  <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid rgba(244, 63, 94, 0.4)', background: 'var(--bg-card)' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
                      <thead>
                        <tr style={{ background: 'rgba(244, 63, 94, 0.08)', color: '#e11d48', borderBottom: '1px solid rgba(244, 63, 94, 0.2)' }}>
                          <th style={{ padding: '10px 14px' }}>代码仓 / 方案名称</th>
                          <th style={{ padding: '10px 14px', width: 120 }}>生效分支</th>
                          <th style={{ padding: '10px 14px', width: 100 }}>本地 DB ID</th>
                          <th style={{ padding: '10px 14px' }}>物理删除说明</th>
                          <th style={{ padding: '10px 14px', width: 250, textAlign: 'center' }}>定向操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {deleteList.map((item, idx) => (
                          <tr key={item.local_id || idx} style={{ borderBottom: '1px solid var(--border-color)' }}>
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
                              ⚠️ 三方控制台已无此方案
                            </td>
                            <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                              <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                                <button
                                  className="btn btn-secondary btn-small"
                                  style={{ padding: '4px 10px', fontSize: 12, background: 'rgba(99, 102, 241, 0.12)', color: '#6366f1', border: '1px solid rgba(99, 102, 241, 0.3)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                                  disabled={!!syncingKey}
                                  onClick={() => handleSingleItemSync({
                                    key: `delete-${item.local_id}-pushcreate`,
                                    direction: 'push_to_remote',
                                    action: 'create_remote',
                                    category: 'full',
                                    local_id: item.local_id,
                                    scheme_data: {
                                      id: item.local_id,
                                      name: item.name,
                                      branch: item.branchs,
                                      mr_trigger: item.had_mr_trigger,
                                      daily_build: item.had_daily_build
                                    }
                                  })}
                                  title="以本地配置为准，在三方控制台中重新新建该方案"
                                >
                                  {syncingKey === `delete-${item.local_id}-pushcreate` ? <RefreshCw size={12} className="spin" /> : <ArrowUpRight size={13} />}
                                  推送新建至三方
                                </button>
                                <button
                                  className="btn btn-secondary btn-small"
                                  style={{ padding: '4px 10px', fontSize: 12, background: 'rgba(225, 29, 72, 0.12)', color: '#e11d48', border: '1px solid rgba(225, 29, 72, 0.3)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                                  disabled={!!syncingKey}
                                  onClick={() => handleSingleItemSync({
                                    key: `delete-${item.local_id}-dellocal`,
                                    direction: 'pull_to_local',
                                    action: 'delete',
                                    local_id: item.local_id
                                  })}
                                  title="确认废弃，物理下架清理本地数据库记录"
                                >
                                  {syncingKey === `delete-${item.local_id}-dellocal` ? <RefreshCw size={12} className="spin" /> : <Trash2 size={13} />}
                                  清理本地 DB
                                </button>
                              </div>
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
                          <th style={{ padding: '10px 14px' }}>代码仓 / 方案名称</th>
                          <th style={{ padding: '10px 14px', width: 130 }}>生效分支</th>
                          <th style={{ padding: '10px 14px', width: 120 }}>本地 DB ID</th>
                          <th style={{ padding: '10px 14px', width: 180 }}>三方方案名称 / ID</th>
                          <th style={{ padding: '10px 14px', width: 110, textAlign: 'right' }}>同步状态</th>
                        </tr>
                      </thead>
                      <tbody>
                        {unchangedList.map((item, idx) => (
                          <tr key={item.local_id || idx} style={{ borderBottom: '1px solid var(--border-color)' }}>
                            <td style={{ padding: '12px 14px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                              <div>{item.repository_name}</div>
                              {item.name && <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>{item.name}</div>}
                            </td>
                            <td style={{ padding: '12px 14px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>
                              {item.branchs || '-'}
                            </td>
                            <td style={{ padding: '12px 14px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>
                              {item.local_id}
                            </td>
                            <td style={{ padding: '12px 14px', fontSize: 12 }}>
                              {item.name && <div style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>{item.name}</div>}
                              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
                                {item.remote_scheme_id}
                              </div>
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
    </Drawer>
  )
}
