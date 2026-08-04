export interface SubMenuItem {
  path: string;
  label: string;
}

export interface MenuGroup {
  title: string;
  items: SubMenuItem[];
}

export const menuGroups: MenuGroup[] = [
  {
    title: '构建与检查',
    items: [
      { path: '/dashboard', label: '控制中心' },
      { path: '/repos', label: '流水线配置' }
    ]
  },
  {
    title: '代码实时看护',
    items: [
      { path: '/mr/list', label: 'MR 全览' },
      { path: '/mr/hook', label: '实时MR看护' }
    ]
  },
  {
    title: '代码仓与分支管控(WIP)',
    items: [
      { path: '/managed-repos/hub', label: '代码仓大盘' },
      { path: '/managed-repos/sync-branch', label: '跨仓特性分支' },
      { path: '/managed-repos/protected-rules', label: '保护分支策略' },
      { path: '/managed-repos/approvals', label: '审批管理中心' },
      { path: '/managed-repos/branch-health', label: '分支健康与清理' }
    ]
  },
  {
    title: '管理中心',
    items: [
      { path: '/pipeline-config', label: '系统配置' }
    ]
  }
];

export const menuItems: SubMenuItem[] = [
  { path: '/dashboard', label: '控制中心' },
  { path: '/repos', label: '流水线配置' },
  { path: '/managed-repos/hub', label: '代码仓大盘' },
  { path: '/managed-repos/sync-branch', label: '跨仓特性分支' },
  { path: '/managed-repos/protected-rules', label: '保护分支策略' },
  { path: '/managed-repos/approvals', label: '审批管理中心' },
  { path: '/managed-repos/branch-health', label: '分支健康与清理' },
  { path: '/pipeline-config', label: '系统配置' },
  { path: '/mr/list', label: 'MR 全览' },
  { path: '/mr/hook', label: '实时MR看护' }
];

export default menuItems;
