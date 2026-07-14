import React, { useEffect, useState, useCallback } from 'react';
import { useToast } from '../components/Toast';

// Premium SVG Icons
const RefreshIcon = ({ className = "" }) => (
  <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
  </svg>
);

const ExternalLinkIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
    <polyline points="15 3 21 3 21 9"/>
    <line x1="10" y1="14" x2="21" y2="3"/>
  </svg>
);

interface GitMr {
  id: string | number;
  iid: number;
  title: string;
  state: string;
  description: string;
  target_branch: string;
  source_branch: string;
  web_url: string;
  repo_name: string;
  author: {
    name: string;
    username: string;
  };
  created_at: string;
  updated_at: string;
}

interface Repository {
  id: number;
  name: string;
  project_id: string;
}

interface RealtimeMrListProps {
  apiBase: string;
  token: string | null;
}

export default function RealtimeMrList({ apiBase, token }: RealtimeMrListProps) {
  const { showToast } = useToast();
  const [mrs, setMrs] = useState<GitMr[]>([]);
  const [repos, setRepos] = useState<Repository[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState<string>('');
  const [selectedState, setSelectedState] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [hasSynced, setHasSynced] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 15;

  // 获取所有仓库列表，以用于下拉筛选
  const fetchRepos = useCallback(() => {
    fetch(`${apiBase}/repos?page_size=500`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })
      .then(res => {
        if (!res.ok) throw new Error('获取仓库列表失败');
        return res.json();
      })
      .then(data => {
        setRepos(data.items || []);
      })
      .catch(err => {
        console.error('Failed to fetch repos:', err);
      });
  }, [apiBase, token]);

  // 从后端实时向 Git 平台拉取合并请求数据
  const fetchMRs = useCallback((repoIdFilter: string = '') => {
    setLoading(true);
    let url = `${apiBase}/mr/list`;
    if (repoIdFilter) {
      url += `?repo_id=${repoIdFilter}`;
    }
    fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })
      .then(res => {
        if (!res.ok) throw new Error('从 Git 系统拉取 MR 数据失败');
        return res.json();
      })
      .then(data => {
        setMrs(data || []);
        setPage(1); // 重置页码
        setHasSynced(true);
        showToast('已从 Git 托管平台同步最新 MR 数据', 'success');
      })
      .catch(err => {
        console.error('Failed to fetch MRs from Git:', err);
        showToast(err.message || '拉取 MR 数据失败', 'error');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [apiBase, token, showToast]);

  useEffect(() => {
    fetchRepos();
  }, [fetchRepos]);

  const handleRepoChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSelectedRepoId(val);
    setMrs([]);
    setHasSynced(false);
    setPage(1);
  };


  const getStatusBadgeStyle = (state: string) => {
    let bg = 'rgba(100, 116, 139, 0.08)';
    let color = '#64748b';
    let border = '1px solid rgba(100, 116, 139, 0.15)';
    const st = state.toLowerCase();

    if (st === 'opened' || st === 'open' || st === 'active') {
      bg = 'rgba(59, 130, 246, 0.08)';
      color = '#3b82f6';
      border = '1px solid rgba(59, 130, 246, 0.2)';
    } else if (st === 'merged' || st === 'merge') {
      bg = 'rgba(16, 185, 129, 0.08)';
      color = '#10b981';
      border = '1px solid rgba(16, 185, 129, 0.2)';
    } else if (st === 'closed' || st === 'close' || st === 'rejected') {
      bg = 'rgba(239, 68, 68, 0.08)';
      color = '#ef4444';
      border = '1px solid rgba(239, 68, 68, 0.2)';
    }
    return {
      display: 'inline-flex',
      alignItems: 'center',
      padding: '0.2rem 0.55rem',
      borderRadius: '6px',
      fontSize: '0.75rem',
      fontWeight: 600,
      backgroundColor: bg,
      color: color,
      border: border,
    };
  };

  const getStatusText = (state: string) => {
    const st = state.toLowerCase();
    if (st === 'opened' || st === 'open') return '开启中';
    if (st === 'merged') return '已合并';
    if (st === 'closed') return '已关闭';
    return state.toUpperCase();
  };

  // 格式化展示时间，去除无用秒及T字符
  const formatTime = (timeStr: string) => {
    if (!timeStr) return '-';
    return timeStr.replace('T', ' ').substring(0, 16);
  };

  // 前端过滤：根据搜索标题和状态做动态筛选
  const filteredMRs = mrs.filter(mr => {
    const matchesSearch = searchQuery === '' || 
      mr.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      String(mr.iid).includes(searchQuery);
    
    const matchesState = selectedState === '' || 
      mr.state.toLowerCase() === selectedState.toLowerCase() ||
      (selectedState === 'opened' && mr.state.toLowerCase() === 'open') ||
      (selectedState === 'closed' && mr.state.toLowerCase() === 'close');

    return matchesSearch && matchesState;
  });

  // 前端分页
  const totalItems = filteredMRs.length;
  const totalPages = Math.ceil(totalItems / pageSize) || 1;
  const paginatedMRs = filteredMRs.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '100%' }}>
      <style>{`
        @keyframes spin-custom {
          to { transform: rotate(360deg); }
        }
        .filter-select {
          padding: 0.55rem 0.85rem;
          border-radius: 8px;
          border: 1px solid var(--border-color);
          outline: none;
          font-size: 0.85rem;
          background: var(--bg-color);
          color: var(--text-color);
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          cursor: pointer;
        }
        .filter-select:focus {
          border-color: var(--primary-color);
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
          transform: translateY(-1px);
        }
        .filter-input {
          padding: 0.55rem 0.85rem;
          border-radius: 8px;
          border: 1px solid var(--border-color);
          outline: none;
          font-size: 0.85rem;
          background: var(--bg-color);
          color: var(--text-color);
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .filter-input:focus {
          border-color: var(--primary-color);
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
          transform: translateY(-1px);
        }
        .table-row-hover {
          transition: background-color 0.2s, transform 0.2s;
        }
        .table-row-hover:hover {
          background-color: rgba(37, 99, 235, 0.02) !important;
        }
        .spin-anim {
          animation: spin-custom 0.8s linear infinite;
        }
      `}</style>

      {/* Header Info Panel */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.03) 0%, rgba(99, 102, 241, 0.07) 100%)',
        border: '1px solid rgba(99, 102, 241, 0.15)',
        padding: '1.5rem',
        borderRadius: '12px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '1rem'
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-color)' }}>Merge Request 全览</h2>
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>
            在此展现从代码托管平台 (CodeArts CodeHub) 获取的所有历史合并请求。点击同步最新数据按钮即可手动刷新。
          </p>
        </div>
      </div>

      {/* Stats & Filters Card */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '1rem',
        background: 'var(--card-bg)',
        padding: '1.25rem',
        borderRadius: '12px',
        border: '1px solid var(--border-color)',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* 仓库筛选 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', minWidth: '180px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>选择代码仓</label>
            <select
              className="filter-select"
              value={selectedRepoId}
              onChange={handleRepoChange}
            >
              <option value="">全部代码仓</option>
              {repos.map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>

          {/* 状态筛选 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', minWidth: '130px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>状态过滤</label>
            <select
              className="filter-select"
              value={selectedState}
              onChange={e => { setSelectedState(e.target.value); setPage(1); }}
            >
              <option value="">全部状态</option>
              <option value="opened">开启中</option>
              <option value="merged">已合并</option>
              <option value="closed">已关闭</option>
            </select>
          </div>

          {/* 标题搜索 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', minWidth: '200px' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>模糊搜索</label>
            <input
              type="text"
              className="filter-input"
              placeholder="搜索标题或 MR 序号..."
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
            共 <strong>{totalItems}</strong> 个合并请求
          </span>
          <button
            onClick={() => fetchMRs(selectedRepoId)}
            disabled={loading}
            style={{
              background: 'var(--primary-color)',
              color: 'white',
              border: 'none',
              padding: '0.55rem 1.1rem',
              borderRadius: '8px',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.45rem',
              transition: 'opacity 0.2s',
              boxShadow: '0 4px 6px -1px rgba(99, 102, 241, 0.2)'
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = '0.9'}
            onMouseLeave={e => e.currentTarget.style.opacity = '1'}
          >
            <RefreshIcon className={loading ? "spin-anim" : ""} />
            同步最新数据
          </button>
        </div>
      </div>

      {/* Table Card */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', borderRadius: '12px' }}>
        {loading ? (
          <div style={{ padding: '6rem', textAlign: 'center', color: '#64748b' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '50%', border: '3px solid rgba(99,102,241,0.15)', borderTopColor: 'var(--primary-color)', animation: 'spin-custom 0.8s linear infinite', margin: '0 auto 1.25rem' }} />
            正在拉取三方 Git 平台最新 MR 数据，请稍候...
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: '80px', paddingLeft: '1.5rem' }}>序号</th>
                <th style={{ width: '180px' }}>代码仓</th>
                <th>合并请求 (MR) 标题</th>
                <th style={{ width: '140px' }}>源分支</th>
                <th style={{ width: '140px' }}>目标分支</th>
                <th style={{ width: '130px' }}>创建人</th>
                <th style={{ width: '100px' }}>状态</th>
                <th style={{ width: '160px' }}>创建时间</th>
                <th style={{ width: '160px', paddingRight: '1.5rem' }}>更新时间</th>
              </tr>
            </thead>
            <tbody>
              {paginatedMRs.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '5rem', color: '#94a3b8' }}>
                    {!hasSynced ? '暂无数据，请点击右上角“同步最新数据”按钮拉取三方合并请求列表。' : '暂无相关的 Merge Request 记录。'}
                  </td>
                </tr>
              ) : (
                paginatedMRs.map((item) => (
                  <tr key={item.id} className="table-row-hover">
                    <td style={{ paddingLeft: '1.5rem', color: '#94a3b8', fontWeight: 500 }}>
                      !{item.iid}
                    </td>
                    <td style={{ fontWeight: 600 }}>
                      <span style={{ maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }} title={item.repo_name}>
                        {item.repo_name}
                      </span>
                    </td>
                    <td>
                      {item.web_url ? (
                        <a
                          href={item.web_url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: 'var(--text-color)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                          onMouseEnter={e => e.currentTarget.style.color = 'var(--primary-color)'}
                          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-color)'}
                          title="在新标签页中打开托管平台合并请求"
                        >
                          <span style={{ maxWidth: '380px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
                            {item.title}
                          </span>
                          <ExternalLinkIcon />
                        </a>
                      ) : (
                        <span style={{ fontWeight: 600 }}>{item.title}</span>
                      )}
                    </td>
                    <td>
                      <span style={{ fontFamily: 'monospace', background: 'var(--bg-color)', padding: '0.15rem 0.4rem', borderRadius: '4px', border: '1px solid var(--border-color)', fontSize: '0.75rem' }}>
                        {item.source_branch}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontFamily: 'monospace', background: 'var(--bg-color)', padding: '0.15rem 0.4rem', borderRadius: '4px', border: '1px solid var(--border-color)', fontSize: '0.75rem' }}>
                        {item.target_branch}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-color)', fontWeight: 500 }}>
                      {item.author.name || item.author.username || '匿名'}
                    </td>
                    <td>
                      <span style={getStatusBadgeStyle(item.state)}>
                        {getStatusText(item.state)}
                      </span>
                    </td>
                    <td style={{ color: '#64748b', fontSize: '0.8rem' }}>
                      {formatTime(item.created_at)}
                    </td>
                    <td style={{ color: '#64748b', fontSize: '0.8rem', paddingRight: '1.5rem' }}>
                      {formatTime(item.updated_at)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination Footer */}
      {!loading && totalPages > 1 && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: '0.5rem',
          padding: '0.75rem 1.25rem',
          background: 'var(--card-bg)',
          borderRadius: '12px',
          border: '1px solid var(--border-color)'
        }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-color)' }}>
            当前第 <strong>{page}</strong> / {totalPages} 页 (共 {totalItems} 条数据)
          </span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
              style={{
                padding: '0.4rem 0.9rem',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                background: page === 1 ? 'var(--bg-color)' : 'var(--card-bg)',
                color: page === 1 ? '#94a3b8' : 'var(--text-color)',
                cursor: page === 1 ? 'not-allowed' : 'pointer',
                fontSize: '0.825rem',
                transition: 'all 0.2s'
              }}
            >
              上一页
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
              style={{
                padding: '0.4rem 0.9rem',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                background: page >= totalPages ? 'var(--bg-color)' : 'var(--card-bg)',
                color: page >= totalPages ? '#94a3b8' : 'var(--text-color)',
                cursor: page >= totalPages ? 'not-allowed' : 'pointer',
                fontSize: '0.825rem',
                transition: 'all 0.2s'
              }}
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
