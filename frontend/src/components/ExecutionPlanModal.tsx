import React from 'react'

interface ExecutionPlanModalProps {
  visible: boolean
  activePlan: any | null
  onChange: (plan: any) => void
  onSave: (e: React.FormEvent) => void
  onClose: () => void
}

export const ExecutionPlanModal: React.FC<ExecutionPlanModalProps> = ({
  visible,
  activePlan,
  onChange,
  onSave,
  onClose
}) => {
  if (!visible || !activePlan) return null

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100 }}>
      <div className="glass-card" style={{ width: '100%', maxWidth: 580, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <h3 style={{ fontSize: 18, fontWeight: 700 }}>
          {activePlan.id ? '编辑仓库执行方案' : '新增仓库执行方案'}
        </h3>

        <form onSubmit={onSave} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>代码托管仓 URL</label>
            <input 
              type="text" 
              placeholder="例如: https://github.com/example/repo.git 或本地物理路径"
              value={activePlan.repository || ''} 
              onChange={(e) => onChange({ ...activePlan, repository: e.target.value })}
              required 
            />
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
                  let taskId = activePlan.code_checker_task_id;
                  if (!taskId || taskId.trim() === '') {
                    taskId = 'task_' + Math.random().toString(36).substring(2, 10);
                  }

                  const selectedLangs = activePlan.languages ? activePlan.languages.split(',').filter(Boolean) : [];
                  let currentConfig: any = {};
                  if (activePlan.custom_attributes) {
                    try {
                      currentConfig = JSON.parse(activePlan.custom_attributes);
                    } catch (e) {
                      currentConfig = {};
                    }
                  }

                  currentConfig.code_checker_task_id = taskId;
                  currentConfig.languages = selectedLangs;

                  const checker_config: any = {};
                  if (selectedLangs.includes('C/C++')) {
                    checker_config.c_cpp_rules = ["memory_leak", "coredump_risk", "thread_create", "float_comparison"];
                  }
                  if (selectedLangs.includes('Python')) {
                    checker_config.python_rules = ["format", "linter", "pylint"];
                  }
                  if (selectedLangs.includes('Java')) {
                    checker_config.java_rules = ["naming", "complexity", "pmd"];
                  }
                  currentConfig.checker_config = checker_config;

                  onChange({
                    ...activePlan,
                    code_checker_task_id: taskId,
                    custom_attributes: JSON.stringify(currentConfig, null, 2)
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
