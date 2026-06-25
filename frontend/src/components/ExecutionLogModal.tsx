import React from 'react'
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
  if (!activeExec) return null

  const formatTime = (isoString: string | null) => {
    if (!isoString) return '-'
    const date = new Date(isoString)
    return date.toLocaleString('zh-CN', { hour12: false })
  }

  return (
    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: '45%', minWidth: 500, background: 'rgba(9, 13, 22, 0.95)', borderLeft: '1px solid var(--border-color)', backdropFilter: 'blur(20px)', boxShadow: '-10px 0 30px rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', flexDirection: 'column', animation: 'slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }}>
      <div style={{ padding: 24, borderBottom: '1px solid var(--border-color)', display: 'flex', justifyItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Terminal size={18} color="#6366f1" />
            <h3 style={{ fontSize: 16, fontWeight: 700 }}>控制台执行日志 #{activeExec.id}</h3>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>项目: <strong>{activeExec.repo_name}</strong> | 分支: <strong>{activeExec.branch}</strong></p>
        </div>
        <button className="btn btn-secondary btn-small" onClick={onClose}>关闭</button>
      </div>

      <div style={{ flex: 1, padding: 24, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Status overview */}
        <div className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>运行状态</span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{activeExec.status}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>开始时间</span>
            <span style={{ fontSize: 13 }}>{formatTime(activeExec.start_time)}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>运行时长</span>
            <span style={{ fontSize: 13 }}>{activeExec.duration_sec ? `${activeExec.duration_sec} 秒` : '运行中'}</span>
          </div>

          {(activeExec.status === 'running' || activeExec.status === 'pending') && (
            <button className="btn btn-danger btn-small" onClick={() => onCancel(activeExec.id)}>
              <Square size={12} /> 停止任务
            </button>
          )}
        </div>

        {/* Error Message if failed */}
        {activeExec.error_msg && (
          <div className="glass-card" style={{ borderLeft: '4px solid #f43f5e', background: 'rgba(244, 63, 94, 0.05)', padding: '12px 16px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, color: '#f43f5e', marginBottom: 4 }}>
              <AlertCircle size={16} /> 报错中断原因
            </span>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap' }}>
              {activeExec.error_msg}
            </p>
          </div>
        )}

        {/* Build Log Terminal */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>步骤 1: 编译构建 (Build Outputs)</h4>
          <div className="terminal">
            <div className="terminal-header">
              <div className="terminal-dots">
                <div className="terminal-dot dot-red"></div>
                <div className="terminal-dot dot-yellow"></div>
                <div className="terminal-dot dot-green"></div>
              </div>
              <span>bash -c "{activeExec.build_log ? 'completed' : 'waiting'}"</span>
            </div>
            {activeExec.build_log || '$ (No build logs recorded)'}
          </div>
        </div>

        {/* Check Log Terminal */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>步骤 2: 静态检查/测试 (Check Outputs)</h4>
          <div className="terminal">
            <div className="terminal-header">
              <div className="terminal-dots">
                <div className="terminal-dot dot-red"></div>
                <div className="terminal-dot dot-yellow"></div>
                <div className="terminal-dot dot-green"></div>
              </div>
              <span>bash -c "{activeExec.check_log ? 'completed' : 'waiting'}"</span>
            </div>
            {activeExec.check_log || '$ (No check logs recorded)'}
          </div>
        </div>
      </div>
    </div>
  )
}
