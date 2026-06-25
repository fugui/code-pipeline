import React from 'react'
import { Repository } from '../types'

interface RepositoryModalProps {
  visible: boolean
  activeRepo: Partial<Repository> | null
  onChange: (repo: Partial<Repository>) => void
  onSave: (e: React.FormEvent) => void
  onClose: () => void
}

export const RepositoryModal: React.FC<RepositoryModalProps> = ({
  visible,
  activeRepo,
  onChange,
  onSave,
  onClose
}) => {
  if (!visible || !activeRepo) return null

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100 }}>
      <div className="glass-card" style={{ width: '100%', maxWidth: 540, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <h3 style={{ fontSize: 18, fontWeight: 700 }}>
          {activeRepo.id ? '编辑流水线配置' : '添加应用仓库'}
        </h3>

        <form onSubmit={onSave} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>项目仓库名称</label>
            <input 
              type="text" 
              placeholder="例如: code-shield"
              value={activeRepo.name || ''} 
              onChange={(e) => onChange({ ...activeRepo, name: e.target.value })}
              required 
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>Git 远程 URL 或本地路径</label>
            <input 
              type="text" 
              placeholder="例如: /home/fugui/codes/code-shield"
              value={activeRepo.git_url || ''} 
              onChange={(e) => onChange({ ...activeRepo, git_url: e.target.value })}
              required 
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>默认构建分支</label>
              <input 
                type="text" 
                placeholder="master"
                value={activeRepo.branch || ''} 
                onChange={(e) => onChange({ ...activeRepo, branch: e.target.value })}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>定时调度 Cron 表达式 (可选)</label>
              <input 
                type="text" 
                placeholder="e.g. 0 2 * * *"
                value={activeRepo.cron_expr || ''} 
                onChange={(e) => onChange({ ...activeRepo, cron_expr: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>编译构建指令 (Build Command)</label>
            <input 
              type="text" 
              placeholder="例如: make build 或 go build"
              value={activeRepo.build_cmd || ''} 
              onChange={(e) => onChange({ ...activeRepo, build_cmd: e.target.value })}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>静态检查/测试指令 (Check Command)</label>
            <input 
              type="text" 
              placeholder="例如: make lint 或 go test ./..."
              value={activeRepo.check_cmd || ''} 
              onChange={(e) => onChange({ ...activeRepo, check_cmd: e.target.value })}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <input 
              type="checkbox" 
              id="isActive"
              style={{ width: 'auto' }}
              checked={activeRepo.is_active || false} 
              onChange={(e) => onChange({ ...activeRepo, is_active: e.target.checked })}
            />
            <label htmlFor="isActive" style={{ fontSize: 14 }}>激活此项目的定时调度任务</label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="btn btn-primary">
              保存配置
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
