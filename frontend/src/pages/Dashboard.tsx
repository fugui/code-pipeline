import React from 'react'
import { Loader2, RefreshCw, CheckCircle, XCircle, Terminal, Square, ExternalLink } from 'lucide-react'
import { DashboardStats, ExecutionLog } from '../types'

interface DashboardProps {
  stats: DashboardStats | null
  onViewExecDetails: (exec: ExecutionLog) => void
  onCancelExecution: (id: number) => void
  onRefresh: () => void
}

export const Dashboard: React.FC<DashboardProps> = ({
  stats,
  onViewExecDetails,
  onCancelExecution,
  onRefresh
}) => {
  if (!stats) return null

  const formatTime = (isoString: string | null) => {
    if (!isoString) return '-'
    const date = new Date(isoString)
    return date.toLocaleString('zh-CN', { hour12: false })
  }

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div>
        <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>流水线控制中心</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>实时观测 300+ 个应用服务的持续集成运行现状</p>
      </div>

      {/* Metrics cards grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>接入项目数</span>
          <span style={{ fontSize: 32, fontWeight: 700 }}>{stats.total_repos}</span>
        </div>
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>活跃定时任务</span>
          <span style={{ fontSize: 32, fontWeight: 700, color: '#3b82f6' }}>{stats.active_schedulers}</span>
        </div>
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>流水线运行总数</span>
          <span style={{ fontSize: 32, fontWeight: 700 }}>{stats.total_runs}</span>
        </div>
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>构建成功率</span>
          <span style={{ fontSize: 32, fontWeight: 700, color: '#10b981' }}>
            {(stats.success_rate * 100).toFixed(1)}%
          </span>
        </div>
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>并发任务 / 排队等待</span>
          <span style={{ fontSize: 32, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#60a5fa' }}>{stats.running_count}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 20 }}>/</span>
            <span style={{ color: 'var(--text-secondary)' }}>{stats.pending_count}</span>
          </span>
        </div>
      </div>

      {/* Concurrent load and queues */}
      {(stats.running_count > 0 || stats.pending_count > 0) && (
        <div className="glass-card" style={{ background: 'rgba(99, 102, 241, 0.05)', borderColor: 'rgba(99, 102, 241, 0.2)', display: 'flex', alignItems: 'center', gap: 16 }}>
          <Loader2 className="animate-spin" color="#6366f1" />
          <div>
            <span style={{ fontWeight: 600, fontSize: 14, display: 'block' }}>流水线引擎执行中</span>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              正在并发处理 {stats.running_count} 个任务，剩余 {stats.pending_count} 个任务在排队等待队列中。
            </span>
          </div>
        </div>
      )}

      {/* Recent executions table */}
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: 16, fontWeight: 600 }}>最近执行轨迹</h3>
          <button className="btn btn-secondary btn-small" onClick={onRefresh}>
            <RefreshCw size={12} /> 刷新
          </button>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
              <th style={{ padding: '12px 8px' }}>流水线 ID</th>
              <th style={{ padding: '12px 8px' }}>项目名称</th>
              <th style={{ padding: '12px 8px' }}>分支</th>
              <th style={{ padding: '12px 8px' }}>触发源</th>
              <th style={{ padding: '12px 8px' }}>状态</th>
              <th style={{ padding: '12px 8px' }}>启动时间</th>
              <th style={{ padding: '12px 8px', textAlign: 'right' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {stats.recent_runs && stats.recent_runs.length > 0 ? (
              stats.recent_runs.map((run) => (
                <tr key={run.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.03)' }}>
                  <td style={{ padding: '12px 8px' }}>#{run.id}</td>
                  <td style={{ padding: '12px 8px', fontWeight: 500 }}>{run.repo_name}</td>
                  <td style={{ padding: '12px 8px' }}>{run.branch}</td>
                  <td style={{ padding: '12px 8px' }}>
                    {run.trigger_type === 'manual' ? '手动' : run.trigger_type === 'schedule' ? '定时' : 'Webhook'}
                  </td>
                  <td style={{ padding: '12px 8px' }}>
                    <span className={`status-badge ${run.status}`}>
                      {run.status === 'running' && <Loader2 className="animate-spin" size={10} />}
                      {run.status === 'success' && <CheckCircle size={10} />}
                      {run.status === 'failed' && <XCircle size={10} />}
                      {run.status}
                    </span>
                  </td>
                  <td style={{ padding: '12px 8px' }}>{formatTime(run.start_time)}</td>
                  <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button className="btn btn-secondary btn-small" onClick={() => onViewExecDetails(run)}>
                        <Terminal size={12} /> 日志
                      </button>
                      <a 
                        href={`http://192.168.56.18:9080/pipelines/logs/` + (run.plan_id || 'default')} 
                        target="_blank" 
                        rel="noreferrer"
                        className="btn btn-secondary btn-small"
                        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        <ExternalLink size={12} style={{ marginRight: 4 }} /> 三方日志
                      </a>
                      {(run.status === 'running' || run.status === 'pending') && (
                        <button className="btn btn-danger btn-small" onClick={() => onCancelExecution(run.id)}>
                          <Square size={12} /> 停止
                      </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--text-secondary)' }}>
                  暂无任何执行日志记录
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
