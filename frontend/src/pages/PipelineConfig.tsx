import React from 'react'
import { Plus, Search, Edit, Trash2, Activity } from 'lucide-react'
import { Pipeline, ExecutionPlan } from '../types'

interface PipelineConfigProps {
  pipelines: Pipeline[]
  selectedPipeline: Pipeline | null
  plans: ExecutionPlan[]
  loading: boolean
  searchQuery: string
  setSearchQuery: (query: string) => void
  onSelectPipeline: (pipeline: Pipeline) => void
  onAddPipeline: () => void
  onEditPipeline: (pipeline: Pipeline) => void
  onDeletePipeline: (id: number) => void
  onAddPlan: () => void
  onEditPlan: (plan: ExecutionPlan) => void
  onDeletePlan: (id: number) => void
}

export const PipelineConfig: React.FC<PipelineConfigProps> = ({
  pipelines,
  selectedPipeline,
  plans,
  loading,
  searchQuery,
  setSearchQuery,
  onSelectPipeline,
  onAddPipeline,
  onEditPipeline,
  onDeletePipeline,
  onAddPlan,
  onEditPlan,
  onDeletePlan
}) => {
  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>流水线与执行方案配置</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>配置持续集成流水线，并绑定仓库执行方案，支持同步三方流水线控制台。</p>
        </div>
        <button className="btn btn-primary" onClick={onAddPipeline}>
          <Plus size={16} /> 新增流水线
        </button>
      </div>

      {/* Search filter */}
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <Search style={{ position: 'absolute', left: 12, top: 12, color: 'var(--text-muted)' }} size={16} />
          <input 
            type="text" 
            placeholder="按照流水线 ID、名称或分组进行检索..." 
            style={{ paddingLeft: 40 }}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Split layout */}
      <div style={{ display: 'flex', gap: 24, flex: 1, minHeight: 480 }}>
        {/* Left Column: Pipelines list */}
        <div style={{ width: '40%', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600 }}>流水线配置列表 ({pipelines.length})</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', maxHeight: 'calc(100vh - 280px)', paddingRight: 4 }}>
            {pipelines.length > 0 ? (
              pipelines.map((p) => {
                const isSelected = selectedPipeline && selectedPipeline.id === p.id;
                return (
                  <div 
                    key={p.id} 
                    className="glass-card" 
                    style={{ 
                      padding: 16, 
                      cursor: 'pointer', 
                      borderLeft: isSelected ? '4px solid #6366f1' : '1px solid var(--border-color)',
                      background: isSelected ? 'rgba(99, 102, 241, 0.08)' : '',
                      transition: 'all 0.2s ease'
                    }}
                    onClick={() => onSelectPipeline(p)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>ID: {p.pipeline_id}</span>
                          <span style={{ background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8', fontSize: 10, padding: '1px 5px', borderRadius: 4 }}>{p.type}</span>
                        </div>
                        <h4 style={{ fontSize: 15, fontWeight: 600, marginTop: 4 }}>{p.name}</h4>
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button 
                          className="btn btn-secondary btn-small" 
                          style={{ padding: 4 }}
                          onClick={(e) => { e.stopPropagation(); onEditPipeline(p); }}
                        >
                          <Edit size={11} />
                        </button>
                        <button 
                          className="btn btn-secondary btn-small" 
                          style={{ padding: 4, color: '#fb7185' }}
                          onClick={(e) => { e.stopPropagation(); p.id && onDeletePipeline(p.id); }}
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>
                      <span>分组: {p.group_name || '默认组'}</span>
                      <span style={{ maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.description || '暂无详细描述'}</span>
                    </div>
                    {p.service_name && (
                      <div style={{ display: 'flex', gap: 10, fontSize: 11, color: 'var(--text-muted)', marginTop: 6, borderTop: '1px dashed rgba(255,255,255,0.06)', paddingTop: 6 }}>
                        <span>关联服务: <strong>{p.service_name}</strong></span>
                        <span>负责人: <strong>{p.owner}</strong></span>
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="glass-card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
                {loading ? '正在加载流水线...' : '未录入任何流水线数据，请点击右上角进行添加'}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Execution Plans Detail Board */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {selectedPipeline ? (
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', minHeight: 450 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: 16 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 700 }}>{selectedPipeline.name}</h3>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>({selectedPipeline.pipeline_id})</span>
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>触发规则: {selectedPipeline.type} | 团队组名: {selectedPipeline.group_name || '默认组'}</p>
                  {selectedPipeline.service_name && (
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                      关联服务: <strong>{selectedPipeline.service_name}</strong> ({selectedPipeline.service_id}) | 工作区: <strong>{selectedPipeline.workspace_id}</strong> | 负责人: <strong>{selectedPipeline.owner}</strong>
                    </p>
                  )}
                </div>
                <button className="btn btn-primary btn-small" onClick={onAddPlan}>
                  <Plus size={13} /> 绑定执行方案
                </button>
              </div>

              <div style={{ flex: 1, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                      <th style={{ padding: '12px 8px' }}>三方系统方案 ID</th>
                      <th style={{ padding: '12px 8px' }}>代码托管仓</th>
                      <th style={{ padding: '12px 8px' }}>默认分支</th>
                      <th style={{ padding: '12px 8px' }}>编译语言</th>
                      <th style={{ padding: '12px 8px' }}>认证用户</th>
                      <th style={{ padding: '12px 8px', textAlign: 'right' }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plans.length > 0 ? (
                      plans.map((plan) => (
                        <tr key={plan.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.03)' }}>
                          <td style={{ padding: '12px 8px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
                            {plan.execution_plan_id || '未绑定'}
                          </td>
                          <td style={{ padding: '12px 8px', fontWeight: 500, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={plan.repository}>
                            {plan.repository}
                          </td>
                          <td style={{ padding: '12px 8px' }}>{plan.branch}</td>
                          <td style={{ padding: '12px 8px' }}>
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                              {plan.languages ? plan.languages.split(',').map((l: string) => (
                                <span key={l} style={{ background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8', fontSize: 10, padding: '1px 5px', borderRadius: 4 }}>
                                  {l}
                                </span>
                              )) : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>未选择</span>}
                            </div>
                          </td>
                          <td style={{ padding: '12px 8px' }}>{plan.username || '-'}</td>
                          <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                              <button className="btn btn-secondary btn-small" onClick={() => onEditPlan(plan)}>
                                <Edit size={11} /> 编辑
                              </button>
                              <button className="btn btn-secondary btn-small" style={{ color: '#fb7185' }} onClick={() => plan.id && onDeletePlan(plan.id)}>
                                <Trash2 size={11} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>
                          暂无仓库绑定的执行方案，请点击右上角绑定代码仓配置
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', flex: 1, minHeight: 450, background: 'rgba(255,255,255,0.01)', borderStyle: 'dashed' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                <Activity size={32} color="var(--text-muted)" />
                <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>请在左侧列表中选定一条流水线，以展现和配置其关联仓库的执行方案</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
