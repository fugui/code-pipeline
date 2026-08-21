import React from 'react'
import { Drawer } from '@code/common'
import { Terminal, Square, AlertCircle } from 'lucide-react'
import { ExecutionLog } from '../types'

interface ExecutionLogModalProps {
  activeExec: ExecutionLog | null
  onClose: () => void
  onCancel: (id: number) => void
}

export const ExecutionLogModal: React.FC<ExecutionLogModalProps> = ({
  activeExec,
  onClose,
  onCancel
}) => {
  const formatTime = (isoString: string | null | undefined) => {
    if (!isoString) return '-'
    const date = new Date(isoString)
    return date.toLocaleString('zh-CN', { hour12: false })
  }

  const drawerTitle = activeExec ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Terminal size={18} color="#6366f1" />
      <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-main)' }}>
        控制台执行日志 #{activeExec.task_id || activeExec.id}
      </span>
    </div>
  ) : undefined

  const drawerSubtitle = activeExec ? (
    <span>
      项目: <strong style={{ color: 'var(--text-main)' }}>{activeExec.repo_name}</strong> | 分支: <strong style={{ color: 'var(--text-main)' }}>{activeExec.branch}</strong>
    </span>
  ) : undefined

  return (
    <Drawer
      open={!!activeExec}
      onClose={onClose}
      width="max(520px, 50%)"
      title={drawerTitle}
      subtitle={drawerSubtitle}
      bodyStyle={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}
    >
      {activeExec && (
        <>
          {/* Status overview */}
          <div className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>运行状态</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-main)' }}>{activeExec.status}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>开始时间</span>
              <span style={{ fontSize: 13, color: 'var(--text-main)' }}>{formatTime(activeExec.start_time)}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>运行时长</span>
              <span style={{ fontSize: 13, color: 'var(--text-main)' }}>{activeExec.duration_sec ? `${activeExec.duration_sec} 秒` : '运行中'}</span>
            </div>

            {(activeExec.status === 'running' || activeExec.status === 'pending') && (
              <button className="btn btn-danger btn-small" onClick={() => onCancel(activeExec.id)}>
                <Square size={12} /> 停止任务
              </button>
            )}
          </div>

          {/* Error Message if failed */}
          {activeExec.error_msg && (
            <div className="glass-card" style={{ borderLeft: '4px solid #f43f5e', background: 'rgba(244, 63, 94, 0.08)', padding: '12px 16px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, color: '#f43f5e', marginBottom: 4 }}>
                <AlertCircle size={16} /> 报错中断原因
              </span>
              <p style={{ fontSize: 13, color: 'var(--text-main)', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap' }}>
                {activeExec.error_msg}
              </p>
            </div>
          )}

          {/* Execution Log Terminal */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-main)' }}>控制台日志输出 (Execution Console Output)</h4>
            <div className="terminal">
              <div className="terminal-header">
                <div className="terminal-dots">
                  <div className="terminal-dot dot-red"></div>
                  <div className="terminal-dot dot-yellow"></div>
                  <div className="terminal-dot dot-green"></div>
                </div>
                <span>bash -c "{activeExec.log_content || activeExec.build_log || activeExec.check_log ? 'completed' : 'waiting'}"</span>
              </div>
              <div className="terminal-body">
                {activeExec.log_content || activeExec.build_log || activeExec.check_log || '$ (无控制台日志上报内容 / No execution log content)'}
              </div>
            </div>
          </div>
        </>
      )}
    </Drawer>
  )
}
