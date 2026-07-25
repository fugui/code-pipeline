import React from 'react'
import { Loader2, RefreshCw, CheckCircle, XCircle, Terminal, Square, ExternalLink, ShieldCheck, Hammer } from 'lucide-react'
import { DashboardStats, ExecutionLog, CodeCheckDetails } from '../types'

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

  const formatTime = (isoString: string | null | undefined) => {
    if (!isoString) return '-'
    const date = new Date(isoString)
    return date.toLocaleString('zh-CN', { hour12: false })
  }

  const parseCodeCheckDetails = (details: any): CodeCheckDetails | null => {
    if (!details) return null
    if (typeof details === 'object') return details as CodeCheckDetails
    try {
      return JSON.parse(details) as CodeCheckDetails
    } catch {
      return null
    }
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
              <th style={{ padding: '12px 8px' }}>任务类型</th>
              <th style={{ padding: '12px 8px' }}>项目名称</th>
              <th style={{ padding: '12px 8px' }}>分支</th>
              <th style={{ padding: '12px 8px' }}>触发源</th>
              <th style={{ padding: '12px 8px' }}>状态 / 门禁</th>
              <th style={{ padding: '12px 8px' }}>指标明细</th>
              <th style={{ padding: '12px 8px' }}>启动时间</th>
              <th style={{ padding: '12px 8px', textAlign: 'right' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {stats.recent_runs && stats.recent_runs.length > 0 ? (
              stats.recent_runs.map((run) => {
                const isCodeCheck = run.task_type === 'code_check' || !!run.code_checker_task_id || !!run.code_check_details
                const ccDetails = parseCodeCheckDetails(run.code_check_details)
                const reportURL = ccDetails?.checker_report_url || run.external_log_url
                const isGatePassed = ccDetails?.gate_status && ['passed', 'success', 'ok', 'pass', 'true'].includes(ccDetails.gate_status.toLowerCase())

                return (
                  <tr key={run.id || run.task_id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.03)' }}>
                    <td style={{ padding: '12px 8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {isCodeCheck ? (
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <ShieldCheck size={12} /> 代码检查
                          </span>
                        ) : (
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Hammer size={12} /> 构建
                          </span>
                        )}
                        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>#{run.task_id || run.id}</span>
                      </div>
                    </td>
                    <td style={{ padding: '12px 8px', fontWeight: 500 }}>{run.repo_name}</td>
                    <td style={{ padding: '12px 8px' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 13, background: 'rgba(255, 255, 255, 0.05)', padding: '2px 6px', borderRadius: 4 }}>
                        {run.branch}
                      </span>
                    </td>
                    <td style={{ padding: '12px 8px' }}>
                      {run.trigger_type === 'manual' ? '手动' : run.trigger_type === 'mr' ? 'Merge Request' : run.trigger_type === 'schedule' ? '定时' : 'Webhook'}
                      {run.trigger_user ? <span style={{ color: 'var(--text-secondary)', fontSize: 12, display: 'block' }}>({run.trigger_user})</span> : null}
                    </td>
                    <td style={{ padding: '12px 8px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                        <span className={`status-badge ${run.status}`}>
                          {run.status === 'running' && <Loader2 className="animate-spin" size={10} />}
                          {run.status === 'success' && <CheckCircle size={10} />}
                          {run.status === 'failed' && <XCircle size={10} />}
                          {run.status}
                        </span>
                        {isCodeCheck && ccDetails?.gate_status && (
                          <span style={{
                            fontSize: 10,
                            padding: '1px 5px',
                            borderRadius: 3,
                            fontWeight: 600,
                            background: isGatePassed ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                            color: isGatePassed ? '#34d399' : '#f87171',
                            border: isGatePassed ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)'
                          }}>
                            门禁: {ccDetails.gate_status.toUpperCase()}
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '12px 8px', fontSize: 12 }}>
                      {isCodeCheck && ccDetails ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, color: 'var(--text-secondary)' }}>
                          <div>
                            缺陷: <strong style={{ color: 'var(--text-primary)' }}>{ccDetails.total_issues ?? 0}</strong>
                            {ccDetails.critical_issues ? <span style={{ color: '#ef4444', marginLeft: 6 }}>严重:{ccDetails.critical_issues}</span> : null}
                            {ccDetails.major_issues ? <span style={{ color: '#f59e0b', marginLeft: 6 }}>主要:{ccDetails.major_issues}</span> : null}
                          </div>
                          {ccDetails.code_duplication_rate ? (
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              重复率: {ccDetails.code_duplication_rate}
                              {ccDetails.lines_scanned ? ` | ${ccDetails.lines_scanned} 行` : ''}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>
                          {run.duration_sec ? `耗时 ${run.duration_sec} 秒` : '-'}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '12px 8px', fontSize: 13 }}>{formatTime(run.start_time)}</td>
                    <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button className="btn btn-secondary btn-small" onClick={() => onViewExecDetails(run)}>
                          <Terminal size={12} /> 日志
                        </button>
                        {reportURL ? (
                          <a 
                            href={reportURL} 
                            target="_blank" 
                            rel="noreferrer"
                            className="btn btn-secondary btn-small"
                            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                          >
                            <ExternalLink size={12} style={{ marginRight: 4 }} /> {isCodeCheck ? '扫描报告' : '三方日志'}
                          </a>
                        ) : null}
                        {(run.status === 'running' || run.status === 'pending') && (
                          <button className="btn btn-danger btn-small" onClick={() => onCancelExecution(run.id)}>
                            <Square size={12} /> 停止
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })
            ) : (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: 24, color: 'var(--text-secondary)' }}>
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
