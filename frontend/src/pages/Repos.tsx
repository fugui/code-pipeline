import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Search, ChevronDown, ChevronRight, Plus, Trash2,
  GitBranch, AlertCircle, CheckCircle2, Loader2, RefreshCw,
  ExternalLink, Eye, Play, Zap
} from 'lucide-react'
import { ExecutionScheme } from '../types'
import { useToast } from '../components/Toast'

interface ReposProps {
  isAdmin?: boolean
  onAddScheme: (repo: Repo) => void
  onEditScheme: (scheme: ExecutionScheme) => void
  onDeleteScheme: (id: number) => void
  token: string | null
  apiBase: string
  schemeUpdateKey?: number
}

interface Repo {
  id: number
  name: string
  service_group: string
  owner_name: string
  is_active: boolean
  http_url?: string
  webhook_registered?: boolean
  schemes?: ExecutionScheme[]
}

interface PagedResult {
  items: Repo[]
  total: number
  page: number
  page_size: number
}

interface FilterOptions {
  service_groups: string[]
  owner_names: string[]
}

const PAGE_SIZE = 20

export const Repos: React.FC<ReposProps> = ({
  isAdmin = true,
  onAddScheme,
  onEditScheme,
  onDeleteScheme,
  token,
  apiBase,
  schemeUpdateKey = 0,
}) => {
  const { showToast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()

  const [search, setSearch] = useState(() => searchParams.get('search') || '')

  const serviceGroup = searchParams.get('service_group') || ''
  const ownerName = searchParams.get('owner_name') || ''
  const hasScheme = searchParams.get('has_scheme') || 'all'
  const page = parseInt(searchParams.get('page') || '1', 10)

  useEffect(() => {
    setSearch(searchParams.get('search') || '')
  }, [searchParams])

  const updateQueryParams = (newParams: Record<string, string | number>) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      Object.entries(newParams).forEach(([key, val]) => {
        if (val === '' || val === undefined || val === null) {
          next.delete(key)
        } else {
          next.set(key, String(val))
        }
      })
      return next
    })
  }

  const [result, setResult] = useState<PagedResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [filterOpts, setFilterOpts] = useState<FilterOptions>({ service_groups: [], owner_names: [] })

  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const [repoSchemes, setRepoSchemes] = useState<Record<number, ExecutionScheme[]>>({})
  const [schemesLoading, setSchemesLoading] = useState<Record<number, boolean>>({})
  const [runningSchemes, setRunningSchemes] = useState<Record<number, boolean>>({})

  const handleRunScheme = (schemeId: number) => {
    if (runningSchemes[schemeId]) return
    setRunningSchemes(prev => ({ ...prev, [schemeId]: true }))

    fetch(`${apiBase}/execution-schemes/${schemeId}/run`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })
    .then(async (res) => {
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || '启动流水线失败')
      }
      const msg = data.job_id ? `流水线启动成功！任务 ID: ${data.job_id}` : (data.message || '流水线启动成功！')
      showToast(msg, 'success')
    })
    .catch(err => {
      showToast(err.message || '启动流水线失败，网络错误', 'error')
    })
    .finally(() => {
      setRunningSchemes(prev => ({ ...prev, [schemeId]: false }))
    })
  }

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!token) return
    fetch(`${apiBase}/repos/filter-options`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && (Array.isArray(data.service_groups) || Array.isArray(data.owner_names))) {
          setFilterOpts({
            service_groups: Array.isArray(data.service_groups) ? data.service_groups : [],
            owner_names: Array.isArray(data.owner_names) ? data.owner_names : []
          })
        }
      })
      .catch(err => console.error('fetch filter options failed', err))
  }, [token, apiBase])

  const fetchRepos = useCallback(() => {
    if (!token) return
    setLoading(true)
    const finalSearch = searchParams.get('search') || ''
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(PAGE_SIZE),
      search: finalSearch,
      service_group: serviceGroup,
      owner_name: ownerName,
      has_scheme: hasScheme,
    })
    fetch(`${apiBase}/repos?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then((data: PagedResult | null) => {
        if (data && Array.isArray(data.items)) {
          setResult(data)
        } else {
          setResult({ items: [], total: 0, page: 1, page_size: PAGE_SIZE })
        }
      })
      .catch(err => {
        console.error('fetch repos failed', err)
        setResult({ items: [], total: 0, page: 1, page_size: PAGE_SIZE })
      })
      .finally(() => setLoading(false))
  }, [token, apiBase, page, searchParams, serviceGroup, ownerName, hasScheme])

  useEffect(() => {
    fetchRepos()
  }, [fetchRepos])

  const resetAndFilter = (key: string) => (v: string) => {
    updateQueryParams({ [key]: v, page: 1 })
  }

  const handleSearchChange = (v: string) => {
    setSearch(v)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      updateQueryParams({ search: v, page: 1 })
    }, 400)
  }

  const fetchSchemesForRepo = useCallback((repoId: number) => {
    if (!token) return
    setSchemesLoading(prev => ({ ...prev, [repoId]: true }))
    fetch(`${apiBase}/execution-schemes?repository_id=${repoId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then((data: ExecutionScheme[]) =>
        setRepoSchemes(prev => ({ ...prev, [repoId]: data || [] }))
      )
      .catch(err => console.error(`fetch schemes for repo ${repoId} failed`, err))
      .finally(() => setSchemesLoading(prev => ({ ...prev, [repoId]: false })))
  }, [token, apiBase])

  useEffect(() => {
    if (schemeUpdateKey === 0) return
    fetchRepos()
    expandedIds.forEach(id => fetchSchemesForRepo(id))
  }, [schemeUpdateKey])

  const toggleExpand = (repoId: number) => {
    const next = new Set(expandedIds)
    if (next.has(repoId)) {
      next.delete(repoId)
    } else {
      next.add(repoId)
      if (!repoSchemes[repoId]) {
        fetchSchemesForRepo(repoId)
      }
    }
    setExpandedIds(next)
  }

  const totalPages = result ? Math.ceil(result.total / PAGE_SIZE) : 0

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>代码仓全览</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
          完整浏览全量代码仓，按部门、子系统、责任人过滤，并在线管理各仓库的流水线执行方案。
        </p>
      </div>

      <div className="glass-card" style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative' }}>
          <select
            value={serviceGroup}
            onChange={e => resetAndFilter('service_group')(e.target.value)}
            style={selectStyle}
          >
            <option value="">全部子系统</option>
            {(filterOpts?.service_groups || []).map(g => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>
        <div>
          <select
            value={ownerName}
            onChange={e => resetAndFilter('owner_name')(e.target.value)}
            style={selectStyle}
          >
            <option value="">全部负责人</option>
            {(filterOpts?.owner_names || []).map(o => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </div>
        <div>
          <select
            value={hasScheme}
            onChange={e => resetAndFilter('has_scheme')(e.target.value)}
            style={selectStyle}
          >
            <option value="all">全部状态</option>
            <option value="yes">已配置方案</option>
            <option value="no">未配置方案</option>
          </select>
        </div>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="搜索仓库名、子系统或负责人..."
            value={search}
            onChange={e => handleSearchChange(e.target.value)}
            style={{ paddingLeft: 32, fontSize: 13, height: 36, width: '100%' }}
          />
        </div>
        <button
          className="btn btn-secondary"
          style={{ padding: '0 12px', height: 36, fontSize: 13 }}
          onClick={() => { fetchRepos(); expandedIds.forEach(id => fetchSchemesForRepo(id)) }}
          title="刷新"
        >
          <RefreshCw size={13} />
        </button>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
          共 <strong style={{ color: 'var(--text-main)' }}>{result?.total ?? '-'}</strong> 个仓库
        </span>
      </div>

      <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.02)' }}>
              <th style={thStyle({ width: 40 })}></th>
              <th style={thStyle({})}>代码仓名称</th>
              <th style={thStyle({ width: 160 })}>子系统</th>
              <th style={thStyle({ width: 120 })}>负责人</th>
              <th style={thStyle({ width: 140 })}>执行方案</th>
              <th style={thStyle({ width: 100, textAlign: 'right' })}>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && !result?.items?.length ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>
                  <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', marginBottom: 8, display: 'block', margin: '0 auto 8px' }} />
                  加载中...
                </td>
              </tr>
            ) : result?.items?.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>
                  无匹配的代码仓数据
                </td>
              </tr>
            ) : (
              result?.items?.map(repo => (
                <RepoRow
                  key={repo.id}
                  isAdmin={isAdmin}
                  repo={repo}
                  isExpanded={expandedIds.has(repo.id)}
                  schemes={repoSchemes[repo.id] !== undefined ? repoSchemes[repo.id] : repo.schemes}
                  schemesLoading={!!schemesLoading[repo.id]}
                  onToggle={() => toggleExpand(repo.id)}
                  onAddScheme={() => onAddScheme(repo)}
                  onEditScheme={onEditScheme}
                  onDeleteScheme={onDeleteScheme}
                  onRunScheme={handleRunScheme}
                  runningSchemes={runningSchemes}
                  token={token}
                  apiBase={apiBase}
                />
              ))
            )}
          </tbody>
        </table>

        {totalPages > 1 && (
          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 10,
            padding: '12px 20px',
            borderTop: '1px solid var(--border-color)',
            fontSize: 13,
          }}>
            {loading && (
              <Loader2 size={13} style={{ animation: 'spin 1s linear infinite', color: 'var(--text-muted)' }} />
            )}
            <button
              className="btn btn-secondary"
              style={{ padding: '4px 12px', fontSize: 12 }}
              disabled={page <= 1 || loading}
              onClick={() => updateQueryParams({ page: page - 1 })}
            >
              上一页
            </button>
            <span style={{ color: 'var(--text-secondary)', minWidth: 80, textAlign: 'center' }}>
              第 {page} / {totalPages} 页
            </span>
            <button
              className="btn btn-secondary"
              style={{ padding: '4px 12px', fontSize: 12 }}
              disabled={page >= totalPages || loading}
              onClick={() => updateQueryParams({ page: page + 1 })}
            >
              下一页
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

interface RepoRowProps {
  isAdmin?: boolean
  repo: Repo
  isExpanded: boolean
  schemes?: ExecutionScheme[]
  schemesLoading: boolean
  onToggle: () => void
  onAddScheme: () => void
  onEditScheme: (scheme: ExecutionScheme) => void
  onDeleteScheme: (id: number) => void
  onRunScheme: (id: number) => void
  runningSchemes: Record<number, boolean>
  token: string | null
  apiBase: string
}

const RepoRow: React.FC<RepoRowProps> = ({
  isAdmin = true,
  repo, isExpanded, schemes, schemesLoading,
  onToggle, onAddScheme, onEditScheme, onDeleteScheme,
  onRunScheme, runningSchemes, token, apiBase
}) => {
  const { showToast } = useToast()
  const [webhookStatus, setWebhookStatus] = useState<'idle' | 'checking' | 'registering'>('idle')
  const [webhookRegistered, setWebhookRegistered] = useState(repo.webhook_registered ?? false)

  useEffect(() => {
    setWebhookRegistered(repo.webhook_registered ?? false)
  }, [repo.webhook_registered])

  const handleCheckWebhook = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (webhookStatus !== 'idle') return
    setWebhookStatus('checking')
    fetch(`${apiBase}/repos/${repo.id}/webhook`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => res.json())
      .then(data => setWebhookRegistered(!!data.registered))
      .catch(err => console.error('check webhook failed', err))
      .finally(() => setWebhookStatus('idle'))
  }

  const handleRegisterWebhook = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (webhookStatus !== 'idle') return
    setWebhookStatus('registering')
    fetch(`${apiBase}/repos/${repo.id}/webhook`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async res => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || '注册 Webhook 失败')
        setWebhookRegistered(true)
        showToast('Webhook 注册成功！', 'success')
      })
      .catch(err => showToast(err.message || '注册 Webhook 失败', 'error'))
      .finally(() => setWebhookStatus('idle'))
  }
  const schemeCount = schemes?.length ?? null

  const schemeBadge = () => {
    if (schemeCount === null && !isExpanded) {
      return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>-</span>
    }
    if (schemesLoading) {
      return <Loader2 size={12} style={{ animation: 'spin 1s linear infinite', color: 'var(--text-muted)' }} />
    }
    if (!schemeCount) {
      return (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 11, padding: '2px 8px', borderRadius: 12,
          background: 'rgba(244,63,94,0.1)', color: '#f87171',
          border: '1px solid rgba(244,63,94,0.25)',
        }}>
          <AlertCircle size={10} /> 未配置
        </span>
      )
    }
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: 11, padding: '2px 8px', borderRadius: 12,
        background: 'rgba(16,185,129,0.1)', color: '#34d399',
        border: '1px solid rgba(16,185,129,0.25)',
      }}>
        <CheckCircle2 size={10} /> {schemeCount} 个方案
      </span>
    )
  }

  return (
    <>
      <tr
        style={{
          borderBottom: isExpanded ? 'none' : '1px solid var(--border-color)',
          transition: 'background 0.15s',
          background: isExpanded ? 'rgba(99,102,241,0.06)' : 'transparent',
          cursor: 'pointer',
        }}
        onMouseEnter={e => { if (!isExpanded) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.02)' }}
        onMouseLeave={e => { if (!isExpanded) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
        onClick={onToggle}
      >
        <td style={{ padding: '12px 8px 12px 16px', color: 'var(--text-muted)', width: 40 }}>
          {isExpanded
            ? <ChevronDown size={15} style={{ color: '#6366f1' }} />
            : <ChevronRight size={15} />
          }
        </td>

        <td style={{ padding: '12px 8px', fontWeight: 600, color: 'var(--text-main)' }}>
          {repo.http_url ? (
            <a 
              href={repo.http_url} 
              target="_blank" 
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              style={{ 
                color: 'var(--text-main)', 
                textDecoration: 'none',
                transition: 'color 0.2s',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4
              }}
              onMouseEnter={e => e.currentTarget.style.color = '#6366f1'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-main)'}
            >
              {repo.name}
              <ExternalLink size={12} style={{ opacity: 0.6 }} />
            </a>
          ) : (
            repo.name
          )}
          {!repo.is_active && (
            <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--text-muted)', verticalAlign: 'middle' }}>已冻结</span>
          )}
        </td>

        <td style={{ padding: '12px 8px', color: 'var(--text-secondary)', fontSize: 13 }}>
          {repo.service_group || <span style={{ color: 'var(--text-muted)' }}>-</span>}
        </td>

        <td style={{ padding: '12px 8px', color: 'var(--text-secondary)', fontSize: 13 }}>
          {repo.owner_name || <span style={{ color: 'var(--text-muted)' }}>-</span>}
        </td>

        <td style={{ padding: '12px 8px' }}>
          {schemeBadge()}
        </td>

        <td style={{ padding: '12px 16px 12px 8px', textAlign: 'right' }} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            {webhookStatus !== 'idle' ? (
              <span title="检查中...">
                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', color: '#6366f1' }} />
              </span>
            ) : webhookRegistered ? (
              <button
                className="btn-action-add"
                onClick={handleCheckWebhook}
                title="Webhook 已就绪（点击重新检查）"
                style={{ color: '#34d399' }}
              >
                <Zap size={14} />
              </button>
            ) : (
              isAdmin && (
                <button
                  className="btn-action-add"
                  onClick={handleRegisterWebhook}
                  title="Webhook 未注册，点击注册"
                  style={{ color: '#f59e0b' }}
                >
                  <Zap size={14} />
                </button>
              )
            )}
            {isAdmin && (
              <button
                className="btn-action-add"
                onClick={onAddScheme}
                title="为该仓库新增执行方案"
              >
                <Plus size={14} />
              </button>
            )}
          </div>
        </td>
      </tr>

      {isExpanded && (
        <tr>
          <td colSpan={6} style={{ padding: 0, borderBottom: '1px solid var(--border-color)' }}>
            <SubSchemeTable
              isAdmin={isAdmin}
              schemes={schemes}
              loading={schemesLoading}
              onEditScheme={onEditScheme}
              onDeleteScheme={onDeleteScheme}
              onRunScheme={onRunScheme}
              runningSchemes={runningSchemes}
            />
          </td>
        </tr>
      )}
    </>
  )
}

interface SubSchemeTableProps {
  isAdmin?: boolean
  schemes?: ExecutionScheme[]
  loading: boolean
  onEditScheme: (scheme: ExecutionScheme) => void
  onDeleteScheme: (id: number) => void
  onRunScheme: (id: number) => void
  runningSchemes: Record<number, boolean>
}

const SubSchemeTable: React.FC<SubSchemeTableProps> = ({ 
  isAdmin = true,
  schemes, 
  loading, 
  onEditScheme, 
  onDeleteScheme,
  onRunScheme,
  runningSchemes
}) => {
  if (loading) {
    return (
      <div style={{ padding: '20px 60px', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)', fontSize: 13 }}>
        <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
        正在拉取执行方案...
      </div>
    )
  }

  if (!schemes || schemes.length === 0) {
    return (
      <div style={{
        margin: '0 0 0 40px',
        padding: '16px 20px',
        color: 'var(--text-muted)',
        fontSize: 13,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <AlertCircle size={14} style={{ color: '#f87171' }} />
        该仓库暂未配置任何流水线执行方案，请点击行右侧的"新增方案"按钮进行配置。
      </div>
    )
  }

  return (
    <div style={{ overflowX: 'auto' }}>
    <table style={{ width: '100%', minWidth: 860, borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr style={{ background: 'rgba(99,102,241,0.06)', borderBottom: '1px solid rgba(99,102,241,0.12)' }}>
          <th style={subThStyle({ width: 40 })}></th>
          <th style={subThStyle({ width: 110 })}>分支</th>
          <th style={subThStyle({ width: 140 })}>所属流水线</th>
          <th style={subThStyle({ width: 80 })}>语言</th>
          <th style={subThStyle({ width: 130 })}>MR触发</th>
          <th style={subThStyle({ width: 130 })}>每日构建</th>
          <th style={subThStyle({ width: 130 })}>检查任务</th>
          <th style={subThStyle({ width: 130 })}>执行方案</th>
          <th style={subThStyle({ width: 100, textAlign: 'right' })}>操作</th>
        </tr>
      </thead>
      <tbody>
        {schemes.map((scheme, idx) => (
          <tr
            key={scheme.id}
            style={{
              borderBottom: idx < schemes.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(99,102,241,0.04)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
          >
            <td style={{ padding: '10px 0 10px 40px', width: 40 }}>
              <GitBranch size={12} style={{ color: '#6366f1', opacity: 0.6 }} />
            </td>

            <td style={{ padding: '10px 8px' }}>
              <div
                title={scheme.branchs || undefined}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 600,
                  color: 'var(--text-main)',
                  maxWidth: 100,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  cursor: 'default',
                }}
              >
                {scheme.branchs || '-'}
              </div>
            </td>

            <td style={{ padding: '10px 8px', color: 'var(--text-secondary)' }}>
              {scheme.pipeline?.web_url ? (
                <a
                  href={scheme.pipeline.web_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  style={{
                    color: 'var(--text-secondary)',
                    textDecoration: 'none',
                    transition: 'color 0.2s',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = '#6366f1'}
                  onMouseLeave={e => e.currentTarget.style.color = 'var(--text-secondary)'}
                >
                  {scheme.pipeline.name}
                  <ExternalLink size={12} style={{ opacity: 0.6 }} />
                </a>
              ) : (
                scheme.pipeline?.name || scheme.pipeline_name || <span style={{ color: 'var(--text-muted)' }}>ID #{scheme.pipeline_id}</span>
              )}
            </td>

            <td style={{ padding: '10px 8px', color: 'var(--text-secondary)' }}>
              {scheme.languages
                ? scheme.languages.split(',').map(l => (
                  <span key={l} style={{
                    display: 'inline-block', marginRight: 4,
                    fontSize: 10, padding: '1px 6px', borderRadius: 10,
                    background: 'rgba(99,102,241,0.12)', color: '#a5b4fc',
                    border: '1px solid rgba(99,102,241,0.2)',
                  }}>{l}</span>
                ))
                : <span style={{ color: 'var(--text-muted)' }}>-</span>
              }
            </td>

            <td style={{ padding: '10px 8px' }}>
              {scheme.mr_binding_id ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 120 }}>
                  <div>
                    <TriggerTag 
                      active={!!scheme.mr_trigger} 
                      label={scheme.mr_trigger ? "MR触发" : "已关闭"} 
                      title={scheme.mr_binding_name ? `绑定名称: ${scheme.mr_binding_name}` : undefined} 
                    />
                  </div>
                  <span 
                    style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} 
                    title={scheme.mr_binding_id}
                  >
                    ({scheme.mr_binding_id})
                  </span>
                </div>
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>-</span>
              )}
            </td>

            <td style={{ padding: '10px 8px' }}>
              {scheme.execution_plan_id ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 120 }}>
                  <div>
                    <TriggerTag 
                      active={!!scheme.daily_build} 
                      label={scheme.daily_build ? `每日 ${scheme.daily_build_time || '00:30'}` : "已关闭"} 
                      title={scheme.execution_plan_name ? `计划名称: ${scheme.execution_plan_name}` : undefined} 
                    />
                  </div>
                  <span 
                    style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} 
                    title={scheme.execution_plan_id}
                  >
                    ({scheme.execution_plan_id})
                  </span>
                </div>
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>-</span>
              )}
            </td>

            <td style={{ padding: '10px 8px' }}>
              <NameCell name={scheme.code_checker_task_name} id={scheme.code_checker_task_id} linkUrl={scheme.code_checker_task_web_url} />
            </td>

            <td style={{ padding: '10px 8px' }}>
              <NameCell name={scheme.execution_scheme_name} id={scheme.execution_scheme_id} />
            </td>

            <td style={{ padding: '10px 16px 10px 8px', textAlign: 'right' }}>
              <div style={{ display: 'inline-flex', gap: 6 }}>
                <button
                  className="btn btn-secondary btn-small"
                  style={{ padding: '6px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4, color: '#34d399' }}
                  title="按执行方案启动流水线"
                  onClick={() => scheme.id && onRunScheme(scheme.id)}
                  disabled={scheme.id ? runningSchemes[scheme.id] : false}
                >
                  {scheme.id && runningSchemes[scheme.id] ? (
                    <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                  ) : (
                    <Play size={12} />
                  )}
                </button>
                <button
                  className="btn btn-secondary btn-small"
                  style={{ padding: '6px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4 }}
                  title="查看执行方案"
                  onClick={() => onEditScheme(scheme)}
                >
                  <Eye size={12} />
                </button>
                {isAdmin && (
                  <button
                    className="btn btn-secondary btn-small"
                    style={{ padding: '6px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4, color: '#fb7185' }}
                    title="删除执行方案"
                    onClick={() => scheme.id && onDeleteScheme(scheme.id)}
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  )
}


// ---- Name 单元格：优先显示 Name，hover 提示 ID ----
const NameCell: React.FC<{ name?: string; id?: string; linkUrl?: string }> = ({ name, id, linkUrl }) => {
  if (!name && !id) return <span style={{ color: 'var(--text-muted)' }}>-</span>
  
  const renderContent = () => {
    if (name && id) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 130 }}>
          <span
            style={{
              fontSize: 12,
              color: linkUrl ? 'inherit' : 'var(--text-secondary)',
              display: 'block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {name}
          </span>
          <span
            style={{
              fontSize: 10,
              color: linkUrl ? 'inherit' : 'var(--text-muted)',
              opacity: linkUrl ? 0.7 : 1,
            }}
          >
            ({id})
          </span>
        </div>
      )
    }

    const displayName = name || id;
    return (
      <span
        style={{
          fontSize: 12,
          color: linkUrl ? 'inherit' : 'var(--text-secondary)',
          display: 'block',
          maxWidth: 130,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {displayName}
      </span>
    )
  }

  if (linkUrl) {
    return (
      <a
        href={linkUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={e => e.stopPropagation()}
        style={{
          color: 'var(--text-secondary)',
          textDecoration: 'none',
          transition: 'color 0.2s',
          display: 'inline-block'
        }}
        onMouseEnter={e => e.currentTarget.style.color = '#6366f1'}
        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-secondary)'}
      >
        {renderContent()}
      </a>
    )
  }

  return renderContent();
}

// ---- 触发配置标签 ----
const TriggerTag: React.FC<{ active: boolean; label: string; title?: string }> = ({ active, label, title }) => (
  <span
    title={title}
    style={{
      fontSize: 10, padding: '2px 6px', borderRadius: 8,
      background: active ? 'rgba(16,185,129,0.1)' : 'rgba(107,114,128,0.1)',
      color: active ? '#34d399' : '#6b7280',
      border: `1px solid ${active ? 'rgba(16,185,129,0.2)' : 'rgba(107,114,128,0.15)'}`,
      whiteSpace: 'nowrap',
      cursor: title ? 'help' : 'default',
    }}
  >
    {label}
  </span>
)

// ---- 样式工具 ----
const selectStyle: React.CSSProperties = {
  height: 36,
  fontSize: 13,
  padding: '0 10px',
  minWidth: 130,
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-color)',
  borderRadius: 6,
  color: 'var(--text-main)',
  cursor: 'pointer',
}

const thStyle = (extra: React.CSSProperties): React.CSSProperties => ({
  padding: '12px 8px',
  textAlign: 'left',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-secondary)',
  whiteSpace: 'nowrap',
  ...extra,
})

const subThStyle = (extra: React.CSSProperties): React.CSSProperties => ({
  padding: '8px 8px',
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--text-muted)',
  whiteSpace: 'nowrap',
  ...extra,
})
