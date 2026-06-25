import React from 'react'
import { Loader2 } from 'lucide-react'
import { Pipeline } from '../types'

interface PipelineModalProps {
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
  visible,
  activePipeline,
  onChange,
  onSave,
  onClose,
  isFetchingPipeline,
  pipelineFetchError,
  onFetchRemoteInfo
}) => {
  if (!visible || !activePipeline) return null

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100 }}>
      <div className="glass-card" style={{ width: '100%', maxWidth: 540, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <h3 style={{ fontSize: 18, fontWeight: 700 }}>
          {activePipeline.id ? '编辑流水线元数据' : '录入新流水线'}
        </h3>

        <form onSubmit={onSave} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>
              流水线唯一 ID (Pipeline ID)
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input 
                type="text" 
                placeholder="例如: pipeline_demo_01"
                value={activePipeline.pipeline_id || ''} 
                onChange={(e) => onChange({ ...activePipeline, pipeline_id: e.target.value })}
                onBlur={() => !activePipeline.id && onFetchRemoteInfo(activePipeline.pipeline_id)}
                disabled={!!activePipeline.id}
                required 
              />
              {!activePipeline.id && (
                <button 
                  type="button" 
                  className="btn btn-secondary btn-small"
                  style={{ flexShrink: 0 }}
                  onClick={() => onFetchRemoteInfo(activePipeline.pipeline_id)}
                  disabled={isFetchingPipeline || !activePipeline.pipeline_id}
                >
                  {isFetchingPipeline ? <Loader2 className="animate-spin" size={14} /> : '同步三方名称'}
                </button>
              )}
            </div>
            {pipelineFetchError && (
              <p style={{ fontSize: 12, color: pipelineFetchError.includes('提示') ? '#60a5fa' : '#f87171', marginTop: 4 }}>
                {pipelineFetchError}
              </p>
            )}
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>流水线名称</label>
            <input 
              type="text" 
              placeholder="例如: 每日合并扫描流水线"
              value={activePipeline.name || ''} 
              onChange={(e) => onChange({ ...activePipeline, name: e.target.value })}
              required 
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>流水线类型</label>
              <select 
                value={activePipeline.type || '每日构建'} 
                onChange={(e) => onChange({ ...activePipeline, type: e.target.value })}
                required
              >
                <option value="每日构建">每日构建</option>
                <option value="MR">MR (Merge Request 触发)</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>组名称 (GroupName)</label>
              <input 
                type="text" 
                placeholder="例如: 效能研发组"
                value={activePipeline.group_name || ''} 
                onChange={(e) => onChange({ ...activePipeline, group_name: e.target.value })}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>微服务 ID (Service ID - 只读)</label>
              <input 
                type="text" 
                value={activePipeline.service_id || '未拉取'} 
                disabled 
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>工作区 ID (Workspace ID - 只读)</label>
              <input 
                type="text" 
                value={activePipeline.workspace_id || '未拉取'} 
                disabled 
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>微服务名称 (Service Name - 只读)</label>
              <input 
                type="text" 
                value={activePipeline.service_name || '未拉取'} 
                disabled 
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>三方负责人 (Owner - 只读)</label>
              <input 
                type="text" 
                value={activePipeline.owner || '未拉取'} 
                disabled 
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>描述说明</label>
            <textarea 
              placeholder="请输入流水线的描述与用途..."
              rows={3}
              value={activePipeline.description || ''} 
              onChange={(e) => onChange({ ...activePipeline, description: e.target.value })}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="btn btn-primary" disabled={isFetchingPipeline}>
              保存流水线
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
