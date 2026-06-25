import React from 'react'
import { Plus, Search, GitBranch, Calendar, Clock, Play, Edit, Trash2 } from 'lucide-react'
import { Repository } from '../types'

interface ReposProps {
  repos: Repository[]
  loading: boolean
  searchQuery: string
  setSearchQuery: (query: string) => void
  onTrigger: (id: number) => void
  onAdd: () => void
  onEdit: (repo: Repository) => void
  onDelete: (id: number) => void
}

export const Repos: React.FC<ReposProps> = ({
  repos,
  loading,
  searchQuery,
  setSearchQuery,
  onTrigger,
  onAdd,
  onEdit,
  onDelete
}) => {
  const formatTime = (isoString: string | null) => {
    if (!isoString) return '-'
    const date = new Date(isoString)
    return date.toLocaleString('zh-CN', { hour12: false })
  }

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>应用仓库流水线配置</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>配置单个代码仓的编译脚本、质量门禁检查与定时扫描计划</p>
        </div>
        <button className="btn btn-primary" onClick={onAdd}>
          <Plus size={16} /> 添加应用仓库
        </button>
      </div>

      {/* Search Box */}
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <Search style={{ position: 'absolute', left: 12, top: 12, color: 'var(--text-muted)' }} size={16} />
          <input 
            type="text" 
            placeholder="按照项目名称快速模糊搜索..." 
            style={{ paddingLeft: 40 }}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Repos Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 20 }}>
        {repos.length > 0 ? (
          repos.map((repo) => (
            <div key={repo.id} className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h4 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{repo.name}</h4>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                    {repo.git_url}
                  </span>
                </div>
                <span className={`status-badge ${repo.last_run_status}`}>
                  {repo.last_run_status}
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--border-color)', paddingTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
                  <GitBranch size={14} />
                  <span>默认构建分支: <strong>{repo.branch}</strong></span>
                </div>
                
                {repo.cron_expr ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
                    <Calendar size={14} />
                    <span>定时计划: <code>{repo.cron_expr}</code> {repo.is_active ? '✅' : '❌'}</span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-muted)' }}>
                    <Calendar size={14} />
                    <span>未配置定时触发</span>
                  </div>
                )}

                {repo.last_run_time && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
                    <Clock size={14} />
                    <span>上次构建时间: {formatTime(repo.last_run_time)}</span>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 'auto', borderTop: '1px solid var(--border-color)', paddingTop: 12 }}>
                <button 
                  className="btn btn-primary btn-small" 
                  style={{ flex: 1 }}
                  onClick={() => onTrigger(repo.id)}
                  disabled={repo.last_run_status === 'running'}
                >
                  <Play size={12} /> 一键构建
                </button>
                <button 
                  className="btn btn-secondary btn-small" 
                  onClick={() => onEdit(repo)}
                >
                  <Edit size={12} /> 编辑
                </button>
                <button 
                  className="btn btn-secondary btn-small"
                  style={{ color: '#fb7185' }}
                  onClick={() => onDelete(repo.id)}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))
        ) : (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 48, color: 'var(--text-secondary)' }} className="glass-card">
            {loading ? '正在加载仓库配置...' : '没有找到对应的代码仓流水线，请点击“添加应用仓库”'}
          </div>
        )}
      </div>
    </div>
  )
}
