import React from 'react'
import { RefreshCw, Loader2, Terminal, Square } from 'lucide-react'
import { ExecutionLog } from '../types'

interface HistoryProps {
  executions: ExecutionLog[]
  totalExecutions: number
  execPage: number
  setExecPage: React.Dispatch<React.SetStateAction<number>>
  statusFilter: string
  setStatusFilter: (status: string) => void
  repoFilter: string
  setRepoFilter: (repoId: string) => void
  onViewExecDetails: (exec: ExecutionLog) => void
  onCancelExecution: (id: number) => void
  onRefresh: () => void
}

export const History: React.FC<HistoryProps> = ({
  executions,
  totalExecutions,
  execPage,
  setExecPage,
  statusFilter,
  setStatusFilter,
  repoFilter,
  setRepoFilter,
  onViewExecDetails,
  onCancelExecution,
  onRefresh
}) => {
  const formatTime = (isoString: string | null) => {
    if (!isoString) return '-'
    const date = new Date(isoString)
    return date.toLocaleString('zh-CN', { hour12: false })
  }

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>流水线执行历史轨迹</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>全局追溯所有项目代码的编译构建和质量检查输出日志</p>
      </div>

      {/* Filter controls */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ width: 160 }}>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">所有状态</option>
            <option value="success">成功 (success)</option>
            <option value="failed">失败 (failed)</option>
            <option value="running">执行中 (running)</option>
            <option value="pending">排队中 (pending)</option>
            <option value="cancelled">已取消 (cancelled)</option>
          </select>
        </div>

        <div style={{ width: 220 }}>
          <input 
            type="text" 
            placeholder="根据仓库ID过滤..." 
            value={repoFilter}
            onChange={(e) => setRepoFilter(e.target.value)}
          />
        </div>

        <button className="btn btn-secondary btn-small" style={{ height: 40 }} onClick={onRefresh}>
          <RefreshCw size={14} /> 刷新数据
        </button>
      </div>

      {/* Executions Table */}
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
              <th style={{ padding: '12px 8px' }}>流水线 ID</th>
              <th style={{ padding: '12px 8px' }}>应用仓库</th>
              <th style={{ padding: '12px 8px' }}>分支</th>
              <th style={{ padding: '12px 8px' }}>触发方式</th>
              <th style={{ padding: '12px 8px' }}>状态</th>
              <th style={{ padding: '12px 8px' }}>启动时间</th>
              <th style={{ padding: '12px 8px' }}>持续时间</th>
              <th style={{ padding: '12px 8px', textAlign: 'right' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {executions.length > 0 ? (
              executions.map((run) => (
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
                      {run.status}
                    </span>
                  </td>
                  <td style={{ padding: '12px 8px' }}>{formatTime(run.start_time)}</td>
                  <td style={{ padding: '12px 8px' }}>
                    {run.duration_sec ? `${run.duration_sec} 秒` : '-'}
                  </td>
                  <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button className="btn btn-secondary btn-small" onClick={() => onViewExecDetails(run)}>
                        <Terminal size={12} /> 控制台日志
                      </button>
                      {(run.status === 'running' || run.status === 'pending') && (
                        <button className="btn btn-danger btn-small" onClick={() => onCancelExecution(run.id)}>
                          <Square size={12} /> 终止
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: 24, color: 'var(--text-secondary)' }}>
                  未查询到符合过滤要求的构建执行记录
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {totalExecutions > 10 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 10 }}>
            <button 
              className="btn btn-secondary btn-small" 
              disabled={execPage === 1}
              onClick={() => setExecPage(prev => Math.max(1, prev - 1))}
            >
              上一页
            </button>
            <span style={{ alignSelf: 'center', fontSize: 13, color: 'var(--text-secondary)' }}>
              第 {execPage} 页，共 {Math.ceil(totalExecutions / 10)} 页
            </span>
            <button 
              className="btn btn-secondary btn-small" 
              disabled={execPage * 10 >= totalExecutions}
              onClick={() => setExecPage(prev => prev + 1)}
            >
              下一页
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
