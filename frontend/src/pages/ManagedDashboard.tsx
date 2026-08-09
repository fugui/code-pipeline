import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BarChart3, GitBranch, Shield, AlertTriangle, CheckCircle2, RefreshCw,
  ArrowRight, Package, Webhook, FileText, TrendingDown
} from 'lucide-react'
import { ManagedDashboardStats } from '../types'

interface ManagedDashboardProps {
  apiBase: string
  token: string
  isAdmin?: boolean
}

const gradeColor: Record<string, string> = {
  A: '#10b981',
  B: '#f59e0b',
  C: '#f97316',
  D: '#f43f5e',
}

const gradeBg: Record<string, string> = {
  A: 'rgba(16, 185, 129, 0.15)',
  B: 'rgba(245, 158, 11, 0.15)',
  C: 'rgba(249, 115, 22, 0.15)',
  D: 'rgba(244, 63, 94, 0.15)',
}

export const ManagedDashboard: React.FC<ManagedDashboardProps> = ({ apiBase, token, isAdmin }) => {
  const navigate = useNavigate()
  const [stats, setStats] = useState<ManagedDashboardStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [auditing, setAuditing] = useState(false)

  const fetchStats = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${apiBase}/managed-repos/dashboard/stats`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setStats(data)
      }
    } catch (err) {
      console.error('获取 Dashboard 统计失败:', err)
    } finally {
      setLoading(false)
    }
  }

  const triggerAudit = async () => {
    setAuditing(true)
    try {
      const res = await fetch(`${apiBase}/managed-repos/compliance/audit`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (res.ok) {
        await fetchStats()
      }
    } catch (err) {
      console.error('合规巡检触发失败:', err)
    } finally {
      setAuditing(false)
    }
  }

  useEffect(() => { fetchStats() }, [])

  if (loading && !stats) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh', color: 'var(--text-secondary)' }}>
        <RefreshCw size={20} className="animate-spin" style={{ marginRight: 8 }} />
        加载中...
      </div>
    )
  }

  if (!stats) return null

  const managedRate = stats.total_repos > 0 ? ((stats.active_repos / stats.total_repos) * 100).toFixed(1) : '0'
  const protectionRate = stats.active_repos > 0 ? ((stats.repos_with_protection / stats.active_repos) * 100).toFixed(1) : '0'
  const webhookRate = stats.active_repos > 0 ? ((stats.webhook_registered / stats.active_repos) * 100).toFixed(1) : '0'

  const gradeTotal = stats.compliance_grade_a + stats.compliance_grade_b + stats.compliance_grade_c + stats.compliance_grade_d

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 40 }}>
      {/* 页头 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <BarChart3 size={24} style={{ color: '#6366f1' }} />
            管控 Dashboard
          </h2>
          <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>
            代码仓资产全景、合规度量与风险预警
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={fetchStats}
            disabled={loading}
            className="btn btn-secondary btn-small"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            刷新
          </button>
          {isAdmin && (
            <button
              onClick={triggerAudit}
              disabled={auditing}
              className="btn btn-primary btn-small"
            >
              <Shield size={14} />
              {auditing ? '巡检中...' : '立即合规巡检'}
            </button>
          )}
        </div>
      </div>

      {/* KPI 卡片行 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        <KpiCard icon={<Package size={18} />} label="纳管代码仓" value={`${stats.active_repos}`} sub={`总计 ${stats.total_repos} / 纳管率 ${managedRate}%`} color="#6366f1" />
        <KpiCard icon={<Shield size={18} />} label="合规率" value={`${stats.compliance_rate.toFixed(1)}%`} sub={`平均分 ${stats.compliance_avg_score.toFixed(0)} / 已巡检 ${stats.compliance_total_reports}`} color="#10b981" />
        <KpiCard icon={<GitBranch size={18} />} label="僵死分支" value={`${stats.total_stale_unmerged}`} sub={`已合并待清理 ${stats.total_stale_merged}`} color="#f97316" />
        <KpiCard icon={<Webhook size={18} />} label="保护覆盖率" value={`${protectionRate}%`} sub={`Webhook ${webhookRate}%`} color="#0ea5e9" />
        <KpiCard icon={<FileText size={18} />} label="待审批" value={`${stats.pending_approvals}`} sub={`有负责人 ${stats.repos_with_owner}/${stats.active_repos}`} color="#f59e0b" onClick={() => navigate('/managed-repos/approvals')} />
      </div>

      {/* 中部：合规等级分布 + 排行榜 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* 合规等级分布 */}
        <div className="glass-card">
          <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Shield size={16} style={{ color: '#6366f1' }} />
            合规等级分布
          </h3>
          {gradeTotal > 0 ? (
            <div>
              {/* 条形图 */}
              <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', height: 32, marginBottom: 16, border: '1px solid var(--border-color)' }}>
                {(['A', 'B', 'C', 'D'] as const).map(g => {
                  const count = stats[`compliance_grade_${g.toLowerCase()}` as keyof ManagedDashboardStats] as number
                  const pct = gradeTotal > 0 ? (count / gradeTotal) * 100 : 0
                  if (pct === 0) return null
                  return (
                    <div key={g} style={{
                      width: `${pct}%`, background: gradeColor[g], display: 'flex',
                      alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff',
                      minWidth: pct > 3 ? 'auto' : 0, transition: 'width 0.5s ease'
                    }}>
                      {pct > 8 ? `${g} ${count}` : ''}
                    </div>
                  )
                })}
              </div>
              {/* 图例 */}
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                {(['A', 'B', 'C', 'D'] as const).map(g => {
                  const count = stats[`compliance_grade_${g.toLowerCase()}` as keyof ManagedDashboardStats] as number
                  return (
                    <div key={g} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: gradeColor[g], display: 'inline-block' }} />
                      {g} 级: <strong style={{ color: 'var(--text-main)' }}>{count}</strong> 个 ({gradeTotal > 0 ? ((count / gradeTotal) * 100).toFixed(0) : 0}%)
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: 14, textAlign: 'center', padding: '24px 0' }}>
              暂无合规巡检数据，请先执行巡检
            </div>
          )}
        </div>

        {/* 僵死分支 Top5 */}
        <div className="glass-card">
          <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={16} style={{ color: '#f97316' }} />
            僵死分支 Top5
          </h3>
          {stats.stale_top5 && stats.stale_top5.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {stats.stale_top5.map((item, i) => (
                <div key={item.repo_id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 14px', background: 'var(--portal-bg-color, rgba(255,255,255,0.03))', borderRadius: 8,
                  border: '1px solid var(--border-color)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{
                      width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 700,
                      background: i === 0 ? '#f43f5e' : i === 1 ? '#f97316' : i === 2 ? '#f59e0b' : 'var(--border-color)',
                      color: i < 3 ? '#fff' : 'var(--text-secondary)'
                    }}>{i + 1}</span>
                    <span style={{ color: 'var(--text-main)', fontSize: 14, fontWeight: 500 }}>{item.repo_name}</span>
                  </div>
                  <span style={{ color: '#f97316', fontWeight: 700, fontSize: 14 }}>{item.stale_unmerged_count} 个分支</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: 14, textAlign: 'center', padding: '24px 0' }}>
              <CheckCircle2 size={20} style={{ marginBottom: 6, color: '#10b981' }} /><br />所有仓库分支状况良好
            </div>
          )}
        </div>
      </div>

      {/* 底部：合规评分最低仓库 */}
      <div className="glass-card">
        <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <TrendingDown size={16} style={{ color: '#f43f5e' }} />
          合规评分最低仓库 Top5
        </h3>
        {stats.compliance_bottom5 && stats.compliance_bottom5.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            {stats.compliance_bottom5.map(item => (
              <div key={item.repo_id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 16px', background: 'var(--portal-bg-color, rgba(255,255,255,0.03))', borderRadius: 8,
                border: '1px solid var(--border-color)', cursor: 'pointer',
                transition: 'var(--transition)'
              }}
                onClick={() => navigate(`/managed-repos/hub?repo_id=${item.repo_id}`)}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-active)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-color)')}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden' }}>
                  <span style={{
                    fontWeight: 700, fontSize: 15, color: gradeColor[item.grade] || 'var(--text-secondary)',
                    padding: '2px 8px', borderRadius: 4, background: gradeBg[item.grade] || 'var(--border-color)',
                    minWidth: 24, textAlign: 'center'
                  }}>{item.grade}</span>
                  <span style={{ color: 'var(--text-main)', fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.repo_name}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: gradeColor[item.grade] || 'var(--text-secondary)', fontWeight: 700, fontSize: 15 }}>{item.score}分</span>
                  <ArrowRight size={14} style={{ color: 'var(--text-muted)' }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color: 'var(--text-muted)', fontSize: 14, textAlign: 'center', padding: '24px 0' }}>
            暂无合规巡检数据
          </div>
        )}
      </div>
    </div>
  )
}

// KPI 卡片组件
const KpiCard: React.FC<{
  icon: React.ReactNode
  label: string
  value: string
  sub: string
  color: string
  onClick?: () => void
}> = ({ icon, label, value, sub, color, onClick }) => (
  <div
    className="glass-card"
    onClick={onClick}
    style={{
      padding: '18px 20px', cursor: onClick ? 'pointer' : 'default',
      borderLeft: `4px solid ${color}`,
      display: 'flex', flexDirection: 'column', gap: 4
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500 }}>
      <span style={{ color }}>{icon}</span>
      {label}
    </div>
    <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-main)', letterSpacing: '-0.5px', marginTop: 4 }}>{value}</div>
    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>
  </div>
)
