import React from 'react'
import { Terminal, Square, AlertCircle, X } from 'lucide-react'
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
  if (!activeExec) return null

  const formatTime = (isoString: string | null | undefined) => {
    if (!isoString) return '-'
    const date = new Date(isoString)
    return date.toLocaleString('zh-CN', { hour12: false })
  }

  return (
    <div 
      className="execution-log-drawer-overlay" 
      onClick={onClose} 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.45)',
        backdropFilter: 'blur(4px)',
        zIndex: 99,
        animation: 'pipeline-fade-in 0.2s ease-out'
      }}
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: '50%',
          minWidth: 520,
          background: 'var(--bg-secondary, #111827)',
          color: 'var(--text-main, #f3f4f6)',
          borderLeft: '1px solid var(--border-color)',
          boxShadow: '-10px 0 30px rgba(0, 0, 0, 0.25)',
          zIndex: 100,
          display: 'flex',
          flexDirection: 'column',
          animation: 'slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
        }}
      >
        {/* Modal Header */}
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--bg-card, rgba(255, 255, 255, 0.03))'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Terminal size={18} color="#6366f1" />
              <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-main)' }}>
                控制台执行日志 #{activeExec.task_id || activeExec.id}
              </h3>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              项目: <strong style={{ color: 'var(--text-main)' }}>{activeExec.repo_name}</strong> | 分支: <strong style={{ color: 'var(--text-main)' }}>{activeExec.branch}</strong>
            </p>
          </div>
          <button className="btn btn-secondary btn-small" onClick={onClose} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <X size={14} /> 关闭
          </button>
        </div>

        {/* Modal Content */}
        <div style={{ flex: 1, padding: 24, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
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
        </div>
      </div>
    </div>
  )
}
