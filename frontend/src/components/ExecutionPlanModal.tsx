import React from 'react'
import { Trash2 } from 'lucide-react'

interface ExecutionPlanModalProps {
  visible: boolean
  activePlan: any | null
  onChange: (plan: any) => void
  onSave: (e: React.FormEvent) => void
  onClose: () => void
  apiBase: string
  repos: any[]
}

export const ExecutionPlanModal: React.FC<ExecutionPlanModalProps> = ({
  visible,
  activePlan,
  onChange,
  onSave,
  onClose,
  apiBase,
  repos
}) => {
  const [isOpen, setIsOpen] = React.useState(false)
  const [filterQuery, setFilterQuery] = React.useState('')
  const [branches, setBranches] = React.useState<string[]>([])
  const [loadingBranches, setLoadingBranches] = React.useState(false)
  const [customAttrs, setCustomAttrs] = React.useState<{ key: string; value: string }[]>([]);
  const [animateVisible, setAnimateVisible] = React.useState(false);
  const [orderedBranches, setOrderedBranches] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (activePlan) {
      const found = repos.find(r => r.id === activePlan.repository_id)
      setFilterQuery(found ? found.name : '')
    }
  }, [activePlan, repos])

  React.useEffect(() => {
    if (activePlan && activePlan.repository_id) {
      setLoadingBranches(true);
      const token = localStorage.getItem('code_shield_token') || localStorage.getItem('code_pipeline_token');
      fetch(`${apiBase}/repos/${activePlan.repository_id}/branches`, {
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      })
      .then(res => {
        if (!res.ok) {
          throw new Error('Failed to fetch branches');
        }
        return res.json();
      })
      .then(data => {
        if (Array.isArray(data)) {
          setBranches(data);
        } else {
          setBranches([]);
        }
      })
      .catch(err => {
        console.error('Failed to fetch branches', err);
        setBranches([]);
      })
      .finally(() => {
        setLoadingBranches(false);
      });
    } else {
      setBranches([]);
    }
  }, [activePlan?.repository_id, apiBase])

  React.useEffect(() => {
    if (visible && activePlan) {
      try {
        const parsed = JSON.parse(activePlan.custom_attributes || '{}');
        const list = Object.entries(parsed).map(([k, v]) => ({
          key: k,
          value: String(v)
        }));
        setCustomAttrs(list);
      } catch (e) {
        setCustomAttrs([]);
      }
    }
  }, [visible, activePlan?.id]);

  React.useEffect(() => {
    if (activePlan) {
      const activeBranches = activePlan.branch ? activePlan.branch.split(',').filter(Boolean) : [];
      const allOpts = Array.from(new Set([...branches, ...activeBranches])).filter(Boolean);

      const sortBranches = (a: string, b: string) => {
        const aChecked = activeBranches.includes(a);
        const bChecked = activeBranches.includes(b);
        if (aChecked && !bChecked) return -1;
        if (!aChecked && bChecked) return 1;

        const isMasterOrMain = (name: string) => name === 'master' || name === 'main';
        const aMasterOrMain = isMasterOrMain(a);
        const bMasterOrMain = isMasterOrMain(b);
        if (aMasterOrMain && !bMasterOrMain) return -1;
        if (!aMasterOrMain && bMasterOrMain) return 1;
        if (aMasterOrMain && bMasterOrMain) return a.localeCompare(b);

        const aDevelop = a === 'develop';
        const bDevelop = b === 'develop';
        if (aDevelop && !bDevelop) return -1;
        if (!aDevelop && bDevelop) return 1;
        if (aDevelop && bDevelop) return 0;

        const isFea = (name: string) => name.toLowerCase().startsWith('fea');
        const aFea = isFea(a);
        const bFea = isFea(b);
        if (aFea && !bFea) return -1;
        if (!aFea && bFea) return 1;
        if (aFea && bFea) return a.localeCompare(b);

        return a.localeCompare(b);
      };

      setOrderedBranches(allOpts.sort(sortBranches));
    } else {
      setOrderedBranches([]);
    }
  }, [branches, visible, activePlan?.id]);

  React.useEffect(() => {
    if (visible) {
      const timer = setTimeout(() => {
        setAnimateVisible(true);
      }, 30);
      return () => clearTimeout(timer);
    } else {
      setAnimateVisible(false);
    }
  }, [visible]);

  if (!visible || !activePlan) return null

  const handleCloseWithAnimation = () => {
    setAnimateVisible(false);
    setTimeout(() => {
      onClose();
    }, 300);
  };

  const filteredRepos = repos.filter(r => 
    r.name.toLowerCase().includes(filterQuery.toLowerCase()) || 
    r.url.toLowerCase().includes(filterQuery.toLowerCase()) ||
    (r.service_group && r.service_group.toLowerCase().includes(filterQuery.toLowerCase())) ||
    (r.owner_name && r.owner_name.toLowerCase().includes(filterQuery.toLowerCase()))
  )

  const selectedRepo = repos.find(r => r.id === activePlan.repository_id)

  const updateCustomAttrs = (newList: { key: string; value: string }[]) => {
    setCustomAttrs(newList);
    const obj: Record<string, string> = {};
    newList.forEach(item => {
      if (item.key.trim()) {
        obj[item.key.trim()] = item.value;
      }
    });
    onChange({
      ...activePlan,
      custom_attributes: JSON.stringify(obj)
    });
  };

  return (
    <div 
      style={{ 
        position: 'fixed', 
        top: 0, 
        left: 0, 
        right: 0, 
        bottom: 0, 
        background: 'rgba(0,0,0,0.4)', 
        backdropFilter: 'blur(4px)', 
        zIndex: 1000,
        opacity: animateVisible ? 1 : 0,
        transition: 'opacity 300ms ease-out',
        pointerEvents: animateVisible ? 'auto' : 'none'
      }}
      onClick={handleCloseWithAnimation}
    >
      <div 
        style={{ 
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: '100%',
          maxWidth: 640,
          background: 'var(--bg-secondary, #111827)',
          borderLeft: '1px solid var(--border-color, rgba(255,255,255,0.08))',
          boxShadow: '-10px 0 30px rgba(0,0,0,0.4)',
          zIndex: 1001,
          transform: animateVisible ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 300ms cubic-bezier(0.16, 1, 0.3, 1)',
          display: 'flex',
          flexDirection: 'column'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          padding: '20px 24px', 
          borderBottom: '1px solid var(--border-color, rgba(255,255,255,0.08))' 
        }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
            {activePlan.id ? '编辑仓库执行方案' : '新增仓库执行方案'}
          </h3>
          <button 
            type="button" 
            style={{ 
              background: 'none', 
              border: 'none', 
              color: 'var(--text-secondary)', 
              fontSize: 24, 
              cursor: 'pointer', 
              padding: '4px 8px',
              lineHeight: 1
            }} 
            onClick={handleCloseWithAnimation}
          >
            &times;
          </button>
        </div>

        <form onSubmit={onSave} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>代码仓</label>
              {activePlan.id ? (
                <input 
                  type="text" 
                  value={selectedRepo ? `${selectedRepo.name} (${selectedRepo.url})` : '未绑定仓库'} 
                  disabled 
                />
              ) : (
                <div style={{ position: 'relative' }}>
                  <input 
                    type="text" 
                    placeholder="输入关键字检索并选择仓库 (支持 200+ 仓库模糊过滤)..."
                    value={filterQuery}
                    onChange={(e) => {
                      setFilterQuery(e.target.value);
                      setIsOpen(true);
                    }}
                    onFocus={() => setIsOpen(true)}
                    onBlur={() => {
                      setTimeout(() => setIsOpen(false), 200);
                    }}
                    required
                  />
                  {isOpen && (
                    <div 
                      style={{ 
                        position: 'absolute', 
                        top: '100%', 
                        left: 0, 
                        right: 0, 
                        zIndex: 1000, 
                        maxHeight: 280, 
                        overflowY: 'auto', 
                        background: 'var(--bg-secondary)', 
                        backdropFilter: 'blur(12px)',
                        border: '1px solid var(--border-color)', 
                        borderRadius: 6, 
                        marginTop: 4, 
                        boxShadow: '0 10px 15px -3px rgba(0,0,0,0.5)' 
                      }}
                      onMouseDown={(e) => e.preventDefault()}
                    >
                      {filteredRepos.length > 0 ? (
                        filteredRepos.map(r => (
                          <div 
                            key={r.id} 
                            style={{ 
                              padding: '10px 14px', 
                              cursor: 'pointer', 
                              borderBottom: '1px solid rgba(255,255,255,0.03)',
                              transition: 'background 0.2s',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 4
                            }}
                            className="search-item"
                            onClick={() => {
                              onChange({
                                ...activePlan,
                                repository_id: r.id,
                                repository: r,
                                branch: ''
                              });
                              setFilterQuery(r.name);
                              setIsOpen(false);
                            }}
                          >
                            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-main)' }}>{r.name}</span>
                            <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-muted)' }}>
                              <span>子系统: {r.service_group || '未归属'}</span>
                              <span style={{ color: 'rgba(255,255,255,0.12)' }}>|</span>
                              <span>负责人: {r.owner_name || '未分配'}</span>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div style={{ padding: '12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                          无匹配的代码仓数据
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>生效分支 (多选)</label>
                {loadingBranches ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', height: 168, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-color)', borderRadius: 6, background: 'rgba(255,255,255,0.01)' }}>正在加载分支...</div>
                ) : (
                  <div style={{ 
                    border: '1px solid var(--border-color)', 
                    borderRadius: 6, 
                    padding: '10px 12px', 
                    height: 168, 
                    overflowY: 'auto',
                    background: 'rgba(255,255,255,0.01)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    direction: 'rtl'
                  }}>
                    <div style={{ direction: 'ltr', display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
                      {(() => {
                        const activeBranches = activePlan.branch ? activePlan.branch.split(',').filter(Boolean) : [];
                        if (orderedBranches.length === 0) {
                          return <span style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginTop: 32, display: 'block', width: '100%' }}>暂无分支，请先选择代码仓</span>;
                        }
                        return orderedBranches.map(branch => {
                          const checked = activeBranches.includes(branch);
                          return (
                            <label key={branch} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: 'var(--text-main)', userSelect: 'none' }}>
                              <input 
                                type="checkbox"
                                checked={checked}
                                style={{ width: 'auto', margin: 0 }}
                                onChange={(e) => {
                                  let current = activePlan.branch ? activePlan.branch.split(',').filter(Boolean) : [];
                                  if (e.target.checked) {
                                    if (!current.includes(branch)) {
                                      current.push(branch);
                                    }
                                  } else {
                                    current = current.filter((x: string) => x !== branch);
                                  }
                                  onChange({ ...activePlan, branch: current.join(',') });
                                }}
                              />
                              {branch}
                            </label>
                          );
                        });
                      })()}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  支持的编程语言 (多选)
                </label>
                <div style={{ 
                  border: '1px solid var(--border-color)', 
                  borderRadius: 6, 
                  padding: '10px 12px', 
                  height: 168, 
                  background: 'rgba(255,255,255,0.01)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  justifyContent: 'center'
                }}>
                  {['C/C++', 'Python', 'Java'].map((lang) => {
                    const activeLangs = activePlan.languages ? activePlan.languages.split(',') : [];
                    const checked = activeLangs.includes(lang);
                    return (
                      <label key={lang} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-main)', userSelect: 'none' }}>
                        <input 
                          type="checkbox" 
                          checked={checked}
                          style={{ width: 'auto', margin: 0 }}
                          onChange={(e) => {
                            let current = activePlan.languages ? activePlan.languages.split(',') : [];
                            if (e.target.checked) {
                              if (!current.includes(lang)) current.push(lang);
                            } else {
                              current = current.filter((x: string) => x !== lang);
                            }
                            onChange({ ...activePlan, languages: current.filter(Boolean).join(',') });
                          }}
                        />
                        {lang}
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 200 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>自定义属性</label>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '4px 10px', fontSize: 12, height: 'auto' }}
                  onClick={() => {
                    const newList = [...customAttrs, { key: '', value: '' }];
                    updateCustomAttrs(newList);
                  }}
                >
                  + 添加属性
                </button>
              </div>

              <div style={{ 
                border: '1px solid var(--border-color)', 
                borderRadius: 6, 
                background: 'rgba(255,255,255,0.01)', 
                flex: 1,
                overflowY: 'auto',
                direction: 'rtl'
              }}>
                <div style={{ direction: 'ltr', width: '100%' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)', textAlign: 'left' }}>
                        <th style={{ padding: '8px 12px', width: '45%' }}>键 (Key)</th>
                        <th style={{ padding: '8px 12px', width: '45%' }}>值 (Value)</th>
                        <th style={{ padding: '8px 12px', width: '10%', textAlign: 'center' }}>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customAttrs.length === 0 ? (
                        <tr>
                          <td colSpan={3} style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                            暂无自定义属性，点击右上角“添加属性”新增
                          </td>
                        </tr>
                      ) : (
                        customAttrs.map((item, index) => (
                          <tr key={index} style={{ borderBottom: index === customAttrs.length - 1 ? 'none' : '1px solid rgba(255, 255, 255, 0.03)' }}>
                            <td style={{ padding: '4px 8px' }}>
                              <input
                                type="text"
                                placeholder="例如: timeout"
                                value={item.key}
                                style={{ width: '100%', padding: '6px 10px', fontSize: 13, height: 32 }}
                                onChange={(e) => {
                                  const newList = [...customAttrs];
                                  newList[index] = { ...newList[index], key: e.target.value };
                                  updateCustomAttrs(newList);
                                }}
                              />
                            </td>
                            <td style={{ padding: '4px 8px' }}>
                              <input
                                type="text"
                                placeholder="例如: 300"
                                value={item.value}
                                style={{ width: '100%', padding: '6px 10px', fontSize: 13, height: 32 }}
                                onChange={(e) => {
                                  const newList = [...customAttrs];
                                  newList[index] = { ...newList[index], value: e.target.value };
                                  updateCustomAttrs(newList);
                                }}
                              />
                            </td>
                            <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                              <button
                                type="button"
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: '#fda4af',
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  padding: '6px',
                                  borderRadius: '4px',
                                  transition: 'all 0.2s'
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.color = '#fb7185';
                                  e.currentTarget.style.background = 'rgba(244, 63, 94, 0.1)';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.color = '#fda4af';
                                  e.currentTarget.style.background = 'none';
                                }}
                                onClick={() => {
                                  const newList = customAttrs.filter((_, i) => i !== index);
                                  updateCustomAttrs(newList);
                                }}
                                title="删除"
                              >
                                <Trash2 size={15} />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <div style={{ 
            display: 'flex', 
            justifyContent: 'flex-end', 
            gap: 12, 
            padding: '16px 24px', 
            borderTop: '1px solid var(--border-color, rgba(255,255,255,0.08))',
            background: 'rgba(255, 255, 255, 0.01)'
          }}>
            <button type="button" className="btn btn-secondary" onClick={handleCloseWithAnimation}>
              取消
            </button>
            <button type="submit" className="btn btn-primary">
              保存方案
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
