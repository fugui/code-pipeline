import React, { useState, useMemo } from 'react'
import { Loader2, RefreshCw, CheckCircle, XCircle, Terminal, Square, ExternalLink, ShieldCheck, Hammer, AlertTriangle, Search, Clock } from 'lucide-react'
import { EmptyState } from '@code/common'
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
  const [taskTypeFilter, setTaskTypeFilter] = useState<'all' | 'build' | 'code_check'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'success' | 'failed'>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Filtered runs calculation (Must be called before any early return)
  const filteredRuns = useMemo(() => {
    if (!stats || !stats.recent_runs) return []
    return stats.recent_runs.filter(run => {
      const isCodeCheck = run.task_type === 'code_check' || !!run.code_checker_task_id || !!run.code_check_details
      if (taskTypeFilter === 'build' && isCodeCheck) return false
      if (taskTypeFilter === 'code_check' && !isCodeCheck) return false

      if (statusFilter !== 'all') {
        if (statusFilter === 'running' && run.status !== 'running' && run.status !== 'pending') return false
        if (statusFilter === 'success' && run.status !== 'success') return false
        if (statusFilter === 'failed' && run.status !== 'failed') return false
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const repoNameMatch = run.repo_name ? run.repo_name.toLowerCase().includes(q) : false
        const branchMatch = run.branch ? run.branch.toLowerCase().includes(q) : false
        const taskIdMatch = (run.task_id || run.id?.toString())?.toLowerCase().includes(q)
        const triggerUserMatch = run.trigger_user ? run.trigger_user.toLowerCase().includes(q) : false
        if (!repoNameMatch && !branchMatch && !taskIdMatch && !triggerUserMatch) return false
      }

      return true
    })
  }, [stats, taskTypeFilter, statusFilter, searchQuery])

  if (!stats) return null

  const formatTime = (isoString: string | null | undefined) => {
    if (!isoString) return '-'
    const date = new Date(isoString)
    return date.toLocaleString('zh-CN', { hour12: false })
  }

  const formatDuration = (seconds?: number) => {
    if (!seconds || seconds <= 0) return '-'
    if (seconds < 60) return `${seconds} 秒`
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins} 分 ${secs} 秒`
  }

  const getRepoWebUrl = (url?: string) => {
    if (!url) return null
    let cleanUrl = url.trim()
    if (cleanUrl.endsWith('.git')) {
      cleanUrl = cleanUrl.slice(0, -4)
    }
    if (cleanUrl.startsWith('git@')) {
      cleanUrl = cleanUrl.replace(/^git@([^:]+):/, 'http://$1/')
    }
    return cleanUrl
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

  const gatePassPercentage = ((stats.gate_pass_rate ?? 1) * 100).toFixed(1)
  const successPercentage = (stats.success_rate * 100).toFixed(1)

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div>
        <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>流水线控制中心</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
          实时观测 {stats.total_schemes ?? stats.total_repos} 个执行方案的持续集成与代码质量数据现状
        </p>
      </div>

      {/* Metrics cards grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>执行方案总数</span>
          <span style={{ fontSize: 30, fontWeight: 700 }}>{stats.total_schemes ?? stats.total_repos}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>全量配置执行方案</span>
        </div>
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>活跃定时任务</span>
          <span style={{ fontSize: 30, fontWeight: 700, color: '#3b82f6' }}>{stats.active_schedulers}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>每日构建/定时计划</span>
        </div>
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>流水线运行总数</span>
          <span style={{ fontSize: 30, fontWeight: 700 }}>{stats.total_runs}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            构建:{stats.build_count ?? 0} | 检查:{stats.code_check_count ?? 0}
          </span>
        </div>
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>构建成功率</span>
          <span style={{ fontSize: 30, fontWeight: 700, color: '#10b981' }}>
            {successPercentage}%
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>失败次数: {stats.failed_runs ?? 0}</span>
        </div>
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>门禁合规率</span>
          <span style={{ fontSize: 30, fontWeight: 700, color: Number(gatePassPercentage) >= 80 ? '#34d399' : '#f59e0b' }}>
            {gatePassPercentage}%
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>代码质量门禁</span>
        </div>
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>平均构建耗时</span>
          <span style={{ fontSize: 30, fontWeight: 700, color: '#a855f7', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Clock size={20} />
            {formatDuration(stats.avg_duration_sec)}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>任务平均运行时间</span>
        </div>
      </div>

      {/* Top Failed Repos Alert Card */}
      {stats.top_failed_repos && stats.top_failed_repos.length > 0 && stats.top_failed_repos.some(r => r.failed_count > 0) && (
        <div className="glass-card" style={{ background: 'rgba(239, 68, 68, 0.05)', borderColor: 'rgba(239, 68, 68, 0.2)', padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <AlertTriangle size={18} color="#ef4444" />
            <h4 style={{ fontSize: 15, fontWeight: 600, color: '#f87171' }}>高风险仓告警（近期失败频次最高 Top 5）</h4>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {stats.top_failed_repos.filter(r => r.failed_count > 0).map((item, idx) => (
              <div 
                key={idx} 
                style={{ 
                  background: 'rgba(239, 68, 68, 0.1)', 
                  border: '1px solid rgba(239, 68, 68, 0.2)', 
                  borderRadius: 6, 
                  padding: '6px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13
                }}
              >
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{item.repo_name}</span>
                <span style={{ background: '#ef4444', color: '#fff', fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 10 }}>
                  失败 {item.failed_count} 次
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent executions table */}
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600 }}>最近执行轨迹</h3>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              (共 {filteredRuns.length} 条记录)
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {/* Search Input */}
            <div style={{ position: 'relative', width: 200 }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="搜索项目/分支/TaskID..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  paddingLeft: 30,
                  paddingRight: 10,
                  paddingTop: 6,
                  paddingBottom: 6,
                  borderRadius: 6,
                  background: 'rgba(125, 125, 125, 0.08)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-main)',
                  fontSize: 13
                }}
              />
            </div>

            {/* Task Type Filter */}
            <div style={{ display: 'flex', background: 'rgba(125, 125, 125, 0.1)', borderRadius: 6, padding: 2, border: '1px solid var(--border-color)' }}>
              <button
                onClick={() => setTaskTypeFilter('all')}
                style={{
                  padding: '4px 10px',
                  fontSize: 12,
                  borderRadius: 4,
                  border: 'none',
                  cursor: 'pointer',
                  background: taskTypeFilter === 'all' ? '#6366f1' : 'transparent',
                  color: taskTypeFilter === 'all' ? '#ffffff' : 'var(--text-secondary)',
                  fontWeight: taskTypeFilter === 'all' ? 600 : 400
                }}
              >
                全部类型
              </button>
              <button
                onClick={() => setTaskTypeFilter('build')}
                style={{
                  padding: '4px 10px',
                  fontSize: 12,
                  borderRadius: 4,
                  border: 'none',
                  cursor: 'pointer',
                  background: taskTypeFilter === 'build' ? '#3b82f6' : 'transparent',
                  color: taskTypeFilter === 'build' ? '#ffffff' : 'var(--text-secondary)',
                  fontWeight: taskTypeFilter === 'build' ? 600 : 400
                }}
              >
                构建
              </button>
              <button
                onClick={() => setTaskTypeFilter('code_check')}
                style={{
                  padding: '4px 10px',
                  fontSize: 12,
                  borderRadius: 4,
                  border: 'none',
                  cursor: 'pointer',
                  background: taskTypeFilter === 'code_check' ? '#818cf8' : 'transparent',
                  color: taskTypeFilter === 'code_check' ? '#ffffff' : 'var(--text-secondary)',
                  fontWeight: taskTypeFilter === 'code_check' ? 600 : 400
                }}
              >
                代码检查
              </button>
            </div>

            {/* Status Filter */}
            <div style={{ display: 'flex', background: 'rgba(125, 125, 125, 0.1)', borderRadius: 6, padding: 2, border: '1px solid var(--border-color)' }}>
              <button
                onClick={() => setStatusFilter('all')}
                style={{
                  padding: '4px 8px',
                  fontSize: 12,
                  borderRadius: 4,
                  border: 'none',
                  cursor: 'pointer',
                  background: statusFilter === 'all' ? '#6366f1' : 'transparent',
                  color: statusFilter === 'all' ? '#ffffff' : 'var(--text-secondary)',
                  fontWeight: statusFilter === 'all' ? 600 : 400
                }}
              >
                全部状态
              </button>
              <button
                onClick={() => setStatusFilter('running')}
                style={{
                  padding: '4px 8px',
                  fontSize: 12,
                  borderRadius: 4,
                  border: 'none',
                  cursor: 'pointer',
                  background: statusFilter === 'running' ? '#3b82f6' : 'transparent',
                  color: statusFilter === 'running' ? '#ffffff' : 'var(--text-secondary)',
                  fontWeight: statusFilter === 'running' ? 600 : 400
                }}
              >
                运行中
              </button>
              <button
                onClick={() => setStatusFilter('success')}
                style={{
                  padding: '4px 8px',
                  fontSize: 12,
                  borderRadius: 4,
                  border: 'none',
                  cursor: 'pointer',
                  background: statusFilter === 'success' ? '#10b981' : 'transparent',
                  color: statusFilter === 'success' ? '#ffffff' : 'var(--text-secondary)',
                  fontWeight: statusFilter === 'success' ? 600 : 400
                }}
              >
                成功
              </button>
              <button
                onClick={() => setStatusFilter('failed')}
                style={{
                  padding: '4px 8px',
                  fontSize: 12,
                  borderRadius: 4,
                  border: 'none',
                  cursor: 'pointer',
                  background: statusFilter === 'failed' ? '#ef4444' : 'transparent',
                  color: statusFilter === 'failed' ? '#ffffff' : 'var(--text-secondary)',
                  fontWeight: statusFilter === 'failed' ? 600 : 400
                }}
              >
                失败
              </button>
            </div>

            <button className="btn btn-secondary btn-small" onClick={onRefresh}>
              <RefreshCw size={12} /> 刷新
            </button>
          </div>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
              <th style={{ padding: '12px 8px' }}>任务类型</th>
              <th style={{ padding: '12px 8px' }}>代码仓</th>
              <th style={{ padding: '12px 8px' }}>分支</th>
              <th style={{ padding: '12px 8px' }}>触发源</th>
              <th style={{ padding: '12px 8px' }}>状态 / 门禁</th>
              <th style={{ padding: '12px 8px' }}>指标明细</th>
              <th style={{ padding: '12px 8px' }}>启动时间</th>
              <th style={{ padding: '12px 8px', textAlign: 'right' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredRuns && filteredRuns.length > 0 ? (
              filteredRuns.map((run) => {
                const isCodeCheck = run.task_type === 'code_check' || !!run.code_checker_task_id || !!run.code_check_details
                const ccDetails = parseCodeCheckDetails(run.code_check_details)
                const reportURL = ccDetails?.checker_report_url || run.external_log_url
                const isGatePassed = ccDetails?.gate_status && ['passed', 'success', 'ok', 'pass', 'true'].includes(ccDetails.gate_status.toLowerCase())
                const repoWebUrl = getRepoWebUrl(run.repo_url)

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
                    <td style={{ padding: '12px 8px', fontWeight: 500 }}>
                      {repoWebUrl ? (
                        <a
                          href={repoWebUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            color: '#60a5fa',
                            textDecoration: 'none',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4
                          }}
                        >
                          {run.repo_name}
                          <ExternalLink size={11} style={{ opacity: 0.7 }} />
                        </a>
                      ) : (
                        <span>{run.repo_name}</span>
                      )}
                    </td>
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
              <EmptyState
                inTable
                colSpan={8}
                type="search"
                title="暂无匹配的执行日志记录"
                description="未发现符合当前检索条件的流水线执行记录。"
              />
            )}
          </tbody>

        </table>
      </div>
    </div>
  )
}
