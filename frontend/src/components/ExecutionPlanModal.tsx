import React from 'react'

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

  React.useEffect(() => {
    if (activePlan) {
      const found = repos.find(r => r.id === activePlan.repository_id)
      setFilterQuery(found ? found.name : '')
    }
  }, [activePlan, repos])

  if (!visible || !activePlan) return null

  const filteredRepos = repos.filter(r => 
    r.name.toLowerCase().includes(filterQuery.toLowerCase()) || 
    r.url.toLowerCase().includes(filterQuery.toLowerCase())
  )

  const selectedRepo = repos.find(r => r.id === activePlan.repository_id)

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100 }}>
      <div className="glass-card" style={{ width: '100%', maxWidth: 580, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <h3 style={{ fontSize: 18, fontWeight: 700 }}>
          {activePlan.id ? '编辑仓库执行方案' : '新增仓库执行方案'}
        </h3>

        <form onSubmit={onSave} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
                    // 稍作延时，确保点击项事件在失去焦点前完成触发
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
                      maxHeight: 220, 
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
                            padding: '10px 12px', 
                            cursor: 'pointer', 
                            borderBottom: '1px solid rgba(255,255,255,0.03)',
                            transition: 'background 0.2s',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 2
                          }}
                          className="search-item"
                          onClick={() => {
                            onChange({
                              ...activePlan,
                              repository_id: r.id,
                              repository: r
                            });
                            setFilterQuery(r.name);
                            setIsOpen(false);
                          }}
                        >
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-main)' }}>{r.name}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{r.url}</span>
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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>执行构建分支</label>
              <input 
                type="text" 
                placeholder="master / main"
                value={activePlan.branch || ''} 
                onChange={(e) => onChange({ ...activePlan, branch: e.target.value })}
                required 
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>三方方案唯一 ID (非必填，自动同步生成)</label>
              <input 
                type="text" 
                placeholder="只读 (三方流水线ID)"
                value={activePlan.execution_plan_id || ''} 
                disabled 
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>访问用户名 (Username)</label>
              <input 
                type="text" 
                placeholder="仓密码对应用户名"
                value={activePlan.username || ''} 
                onChange={(e) => onChange({ ...activePlan, username: e.target.value })}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>访问凭证/密码 (Password)</label>
              <input 
                type="password" 
                placeholder="令牌或账户密码"
                value={activePlan.password || ''} 
                onChange={(e) => onChange({ ...activePlan, password: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>代码检查任务 ID (Code Checker Task ID)</label>
            <div style={{ display: 'flex', gap: 10 }}>
              <input 
                type="text" 
                placeholder="请输入代码检查任务 ID"
                style={{ flex: 1 }}
                value={activePlan.code_checker_task_id || ''} 
                onChange={(e) => onChange({ ...activePlan, code_checker_task_id: e.target.value })}
              />
              <button
                type="button"
                className="btn btn-secondary"
                style={{ whiteSpace: 'nowrap' }}
                onClick={() => {
                  const token = localStorage.getItem('code_shield_token') || localStorage.getItem('code_pipeline_token');
                  fetch(`${apiBase}/execution-plans/update-checker-task`, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                    },
                    body: JSON.stringify({
                      pipeline_id: activePlan.pipeline_id,
                      repository_id: activePlan.repository_id,
                      branch: activePlan.branch || 'master',
                      username: activePlan.username || '',
                      password: activePlan.password || '',
                      code_checker_task_id: activePlan.code_checker_task_id || '',
                      languages: activePlan.languages || '',
                      custom_attributes: activePlan.custom_attributes || '{}'
                    })
                  })
                  .then(async (res) => {
                    if (!res.ok) {
                      const errData = await res.json();
                      throw new Error(errData.error || '更新失败');
                    }
                    return res.json();
                  })
                  .then((data) => {
                    onChange({
                      ...activePlan,
                      code_checker_task_id: data.code_checker_task_id,
                      custom_attributes: data.custom_attributes
                    });
                    alert('更新配置成功！');
                  })
                  .catch((err) => {
                    alert('更新失败: ' + err.message);
                  });
                }}
              >
                更新
              </button>
            </div>
          </div>

          {/* 多选编程语言 */}
          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
              支持的编程语言 (多选)
            </label>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              {['C/C++', 'Python', 'Java'].map((lang) => {
                const activeLangs = activePlan.languages ? activePlan.languages.split(',') : [];
                const checked = activeLangs.includes(lang);
                return (
                  <label key={lang} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 14 }}>
                    <input 
                      type="checkbox" 
                      checked={checked}
                      style={{ width: 'auto' }}
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

          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>自定义属性 (JSON 格式)</label>
            <textarea 
              placeholder='例如: { "timeout": 300, "retry": 3 }'
              rows={3}
              value={activePlan.custom_attributes || ''} 
              onChange={(e) => onChange({ ...activePlan, custom_attributes: e.target.value })}
              onBlur={(e) => {
                const val = e.target.value.trim();
                if (val && val !== '') {
                  try {
                    JSON.parse(val);
                  } catch (err) {
                    alert('自定义属性非标准 JSON 格式，请检查修改。');
                  }
                }
              }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
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
