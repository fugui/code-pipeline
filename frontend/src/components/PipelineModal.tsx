import React from 'react'
import { Loader2, HelpCircle, RefreshCw, Cloud, Info } from 'lucide-react'
import { Modal } from '@code/common'
import { Pipeline } from '../types'

interface PipelineModalProps {
  isAdmin?: boolean
  visible: boolean
  activePipeline: Pipeline | null
  onChange: (pipeline: Pipeline) => void
  onSave: (e: React.FormEvent) => void
  onClose: () => void
  isFetchingPipeline: boolean
  pipelineFetchError: string
  onFetchRemoteInfo: (pipelineID: string) => void
}

export const PipelineModal: React.FC<PipelineModalProps> = ({
  isAdmin = true,
  visible,
  activePipeline,
  onChange,
  onSave,
  onClose,
  isFetchingPipeline,
  pipelineFetchError,
  onFetchRemoteInfo
}) => {
  if (!activePipeline) return null

  const modalFooter = (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, width: '100%' }}>
      <button type="button" className="btn btn-secondary" onClick={onClose}>
        {isAdmin ? '取消' : '关闭'}
      </button>
      {isAdmin && (
        <button
          form="pipeline-modal-form"
          type="submit"
          className="btn btn-primary"
          disabled={isFetchingPipeline}
        >
          {isFetchingPipeline ? (
            <>
              <Loader2 className="animate-spin" size={14} />
              处理中...
            </>
          ) : (
            activePipeline.id ? '保存修改' : '确认导入'
          )}
        </button>
      )}
    </div>
  )

  return (
    <Modal
      open={visible}
      onClose={onClose}
      title={activePipeline.id ? (isAdmin ? '编辑流水线元数据' : '查看流水线元数据 (只读)') : '导入流水线'}
      subtitle={activePipeline.id ? '维护流水线基本配置及关联的三方元数据' : '通过流水线唯一 ID 同步三方元数据并导入本地管理'}
      width="md"
      footer={modalFooter}
    >
      <form id="pipeline-modal-form" onSubmit={onSave} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* 1. 流水线唯一 ID */}
        <div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 8 }}>
            流水线唯一 ID (Pipeline ID)
            <span title="从三方流水线系统获取的唯一标识" style={{ display: 'inline-flex', alignItems: 'center' }}>
              <HelpCircle size={14} style={{ cursor: 'help', color: 'var(--text-muted)' }} />
            </span>
          </label>
          <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
            <input 
              type="text" 
              placeholder="例如: pipeline_demo_01"
              value={activePipeline.pipeline_id || ''} 
              onChange={(e) => onChange({ ...activePipeline, pipeline_id: e.target.value })}
              onBlur={() => !activePipeline.id && activePipeline.pipeline_id && onFetchRemoteInfo(activePipeline.pipeline_id)}
              disabled={!!activePipeline.id || !isAdmin}
              required 
              style={{ flex: 1 }}
            />
            {!activePipeline.id && isAdmin && (
              <button 
                type="button" 
                className="btn btn-secondary"
                style={{ flexShrink: 0, padding: '0 16px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                onClick={() => onFetchRemoteInfo(activePipeline.pipeline_id)}
                disabled={isFetchingPipeline || !activePipeline.pipeline_id}
                title="根据流水线 ID 自动拉取三方服务信息与方案名称"
              >
                {isFetchingPipeline ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}
                {isFetchingPipeline ? '正在拉取...' : '同步三方信息'}
              </button>
            )}
          </div>
          {pipelineFetchError && (
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '10px 14px',
              borderRadius: 8,
              fontSize: 12,
              marginTop: 8,
              background: pipelineFetchError.includes('提示') ? 'rgba(59, 130, 246, 0.08)' : 'rgba(239, 68, 68, 0.08)',
              border: pipelineFetchError.includes('提示') ? '1px solid rgba(59, 130, 246, 0.25)' : '1px solid rgba(239, 68, 68, 0.25)',
              color: pipelineFetchError.includes('提示') ? 'var(--color-primary, #3b82f6)' : 'var(--color-danger, #ef4444)'
            }}>
              <Info size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{pipelineFetchError}</span>
            </div>
          )}
        </div>

        {/* 2. 流水线名称 */}
        <div>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 8 }}>
            流水线名称
          </label>
          <input 
            type="text" 
            placeholder="例如: 每日合并扫描流水线"
            value={activePipeline.name || ''} 
            onChange={(e) => onChange({ ...activePipeline, name: e.target.value })}
            disabled={!isAdmin}
            required 
          />
        </div>

        {/* 3. 流水线类型与所属分组 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 8 }}>
              流水线类型
            </label>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', minHeight: 42 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: isAdmin ? 'pointer' : 'default', fontSize: 13, userSelect: 'none' }}>
                <input 
                  type="checkbox" 
                  checked={(activePipeline.type || '').includes('MR')} 
                  disabled={!isAdmin}
                  style={{ width: 16, height: 16, cursor: isAdmin ? 'pointer' : 'default' }}
                  onChange={(e) => {
                    const currentTypes = activePipeline.type ? activePipeline.type.split(',').filter(Boolean) : []
                    let newTypes: string[]
                    if (e.target.checked) {
                      newTypes = [...currentTypes, 'MR']
                    } else {
                      newTypes = currentTypes.filter(t => t !== 'MR')
                    }
                    onChange({ ...activePipeline, type: newTypes.join(',') })
                  }}
                />
                MR 定时看护
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: isAdmin ? 'pointer' : 'default', fontSize: 13, userSelect: 'none' }}>
                <input 
                  type="checkbox" 
                  checked={(activePipeline.type || '').includes('每日构建')} 
                  disabled={!isAdmin}
                  style={{ width: 16, height: 16, cursor: isAdmin ? 'pointer' : 'default' }}
                  onChange={(e) => {
                    const currentTypes = activePipeline.type ? activePipeline.type.split(',').filter(Boolean) : []
                    let newTypes: string[]
                    if (e.target.checked) {
                      newTypes = [...currentTypes, '每日构建']
                    } else {
                      newTypes = currentTypes.filter(t => t !== '每日构建')
                    }
                    onChange({ ...activePipeline, type: newTypes.join(',') })
                  }}
                />
                每日构建
              </label>
            </div>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 8 }}>
              所属分组
            </label>
            <input 
              type="text" 
              placeholder="例如: 基础架构组"
              value={activePipeline.group_name || ''} 
              onChange={(e) => onChange({ ...activePipeline, group_name: e.target.value })}
              disabled={!isAdmin}
            />
          </div>
        </div>

        {/* 4. 三方平台只读元数据 (卡片展示) */}
        <div style={{
          background: 'var(--color-bg-muted, rgba(255, 255, 255, 0.03))',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-md, 8px)',
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-main)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Cloud size={15} style={{ color: 'var(--accent-primary, #6366f1)' }} />
              三方平台关联属性
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--color-bg-hover)', padding: '2px 8px', borderRadius: 4 }}>
              只读同步
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ color: 'var(--text-secondary)' }}>三方服务 ID (ServiceID)</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: activePipeline.service_id ? 'var(--text-main)' : 'var(--text-muted)', background: 'var(--color-bg-input, var(--bg-color))', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--color-border-subtle)' }}>
                {activePipeline.service_id || '未拉取'}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ color: 'var(--text-secondary)' }}>三方 Workspace ID</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: activePipeline.workspace_id ? 'var(--text-main)' : 'var(--text-muted)', background: 'var(--color-bg-input, var(--bg-color))', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--color-border-subtle)' }}>
                {activePipeline.workspace_id || '未拉取'}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ color: 'var(--text-secondary)' }}>三方项目 ID (OwnerID)</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: activePipeline.owner_id ? 'var(--text-main)' : 'var(--text-muted)', background: 'var(--color-bg-input, var(--bg-color))', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--color-border-subtle)' }}>
                {activePipeline.owner_id || '未拉取'}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ color: 'var(--text-secondary)' }}>三方项目名称 (OwnerName)</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: activePipeline.owner_name ? 'var(--text-main)' : 'var(--text-muted)', background: 'var(--color-bg-input, var(--bg-color))', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--color-border-subtle)' }}>
                {activePipeline.owner_name || '未拉取'}
              </span>
            </div>
          </div>
        </div>

        {/* 5. 描述说明 */}
        <div>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 8 }}>
            描述说明
          </label>
          <textarea 
            placeholder="请输入流水线的描述与用途..."
            rows={3}
            value={activePipeline.description || ''} 
            onChange={(e) => onChange({ ...activePipeline, description: e.target.value })}
            disabled={!isAdmin}
            style={{ resize: 'vertical', minHeight: 72 }}
          />
        </div>
      </form>
    </Modal>
  )
}
