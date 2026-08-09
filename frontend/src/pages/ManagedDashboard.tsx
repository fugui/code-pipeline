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
  A: '#22c55e',
  B: '#eab308',
  C: '#f97316',
  D: '#ef4444',
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
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh', color: 'rgba(255,255,255,0.5)' }}>
        <RefreshCw size={20} style={{ animation: 'spin 1s linear infinite', marginRight: 8 }} />
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
    <div style={{ padding: '0 0 40px 0' }}>
      {/* 页头 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, color: '#f0f0f0', display: 'flex', alignItems: 'center', gap: 8 }}>
            <BarChart3 size={22} />
            管控 Dashboard
          </h2>
          <p style={{ margin: '4px 0 0', color: 'rgba(255,255,255,0.45)', fontSize: 13 }}>
            代码仓资产全景、合规度量与风险预警
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={fetchStats}
            disabled={loading}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6, color: '#ccc', cursor: 'pointer', fontSize: 13
            }}
          >
            <RefreshCw size={14} style={loading ? { animation: 'spin 1s linear infinite' } : undefined} />
            刷新
          </button>
          {isAdmin && (
            <button
              onClick={triggerAudit}
              disabled={auditing}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', border: 'none',
                borderRadius: 6, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 500
              }}
            >
              <Shield size={14} />
              {auditing ? '巡检中...' : '立即合规巡检'}
            </button>
          )}
        </div>
      </div>

      {/* KPI 卡片行 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 24 }}>
        <KpiCard icon={<Package size={18} />} label="纳管代码仓" value={`${stats.active_repos}`} sub={`总计 ${stats.total_repos} / 纳管率 ${managedRate}%`} color="#6366f1" />
        <KpiCard icon={<Shield size={18} />} label="合规率" value={`${stats.compliance_rate.toFixed(1)}%`} sub={`平均分 ${stats.compliance_avg_score.toFixed(0)} / 已巡检 ${stats.compliance_total_reports}`} color="#22c55e" />
        <KpiCard icon={<GitBranch size={18} />} label="僵死分支" value={`${stats.total_stale_unmerged}`} sub={`已合并待清理 ${stats.total_stale_merged}`} color="#f97316" />
        <KpiCard icon={<Webhook size={18} />} label="保护覆盖率" value={`${protectionRate}%`} sub={`Webhook ${webhookRate}%`} color="#0ea5e9" />
        <KpiCard icon={<FileText size={18} />} label="待审批" value={`${stats.pending_approvals}`} sub={`有负责人 ${stats.repos_with_owner}/${stats.active_repos}`} color="#eab308" onClick={() => navigate('/managed-repos/approvals')} />
      </div>

      {/* 中部：合规等级分布 + 排行榜 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        {/* 合规等级分布 */}
        <div style={{
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 10, padding: '18px 20px'
        }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 15, color: '#e0e0e0', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Shield size={16} />
            合规等级分布
          </h3>
          {gradeTotal > 0 ? (
            <div>
              {/* 条形图 */}
              <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', height: 28, marginBottom: 16 }}>
                {(['A', 'B', 'C', 'D'] as const).map(g => {
                  const count = stats[`compliance_grade_${g.toLowerCase()}` as keyof ManagedDashboardStats] as number
                  const pct = gradeTotal > 0 ? (count / gradeTotal) * 100 : 0
                  if (pct === 0) return null
                  return (
                    <div key={g} style={{
                      width: `${pct}%`, background: gradeColor[g], display: 'flex',
                      alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, color: '#fff',
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
                    <div key={g} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: gradeColor[g], display: 'inline-block' }} />
                      {g} 级: {count} 个 ({gradeTotal > 0 ? ((count / gradeTotal) * 100).toFixed(0) : 0}%)
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14, textAlign: 'center', padding: '24px 0' }}>
              暂无合规巡检数据，请先执行巡检
            </div>
          )}
        </div>

        {/* 僵死分支 Top5 */}
        <div style={{
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 10, padding: '18px 20px'
        }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 15, color: '#e0e0e0', display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={16} />
            僵死分支 Top5
          </h3>
          {stats.stale_top5 && stats.stale_top5.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {stats.stale_top5.map((item, i) => (
                <div key={item.repo_id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: 6
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 700,
                      background: i === 0 ? '#ef4444' : i === 1 ? '#f97316' : i === 2 ? '#eab308' : 'rgba(255,255,255,0.1)',
                      color: i < 3 ? '#fff' : 'rgba(255,255,255,0.5)'
                    }}>{i + 1}</span>
                    <span style={{ color: '#e0e0e0', fontSize: 13 }}>{item.repo_name}</span>
                  </div>
                  <span style={{ color: '#f97316', fontWeight: 600, fontSize: 14 }}>{item.stale_unmerged_count}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14, textAlign: 'center', padding: '24px 0' }}>
              <CheckCircle2 size={20} style={{ marginBottom: 4 }} /><br />所有仓库分支状况良好
            </div>
          )}
        </div>
      </div>

      {/* 底部：合规评分最低仓库 */}
      <div style={{
        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 10, padding: '18px 20px'
      }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 15, color: '#e0e0e0', display: 'flex', alignItems: 'center', gap: 6 }}>
          <TrendingDown size={16} />
          合规评分最低仓库 Top5
        </h3>
        {stats.compliance_bottom5 && stats.compliance_bottom5.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
            {stats.compliance_bottom5.map(item => (
              <div key={item.repo_id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', background: 'rgba(255,255,255,0.02)', borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer',
                transition: 'background 0.2s'
              }}
                onClick={() => navigate(`/managed-repos/hub?repo_id=${item.repo_id}`)}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                  <span style={{
                    fontWeight: 700, fontSize: 16, color: gradeColor[item.grade] || '#888',
                    minWidth: 24
                  }}>{item.grade}</span>
                  <span style={{ color: '#ccc', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.repo_name}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: gradeColor[item.grade] || '#888', fontWeight: 600, fontSize: 15 }}>{item.score}</span>
                  <ArrowRight size={14} style={{ color: 'rgba(255,255,255,0.3)' }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14, textAlign: 'center', padding: '24px 0' }}>
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
    onClick={onClick}
    style={{
      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 10, padding: '16px 18px', cursor: onClick ? 'pointer' : 'default',
      transition: 'transform 0.15s, box-shadow 0.15s',
      borderLeft: `3px solid ${color}`
    }}
    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 4px 12px ${color}22` }}
    onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none' }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
      <span style={{ color }}>{icon}</span>
      {label}
    </div>
    <div style={{ fontSize: 26, fontWeight: 700, color: '#f0f0f0', letterSpacing: '-0.5px' }}>{value}</div>
    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>{sub}</div>
  </div>
)
