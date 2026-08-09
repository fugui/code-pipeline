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
    title: '代码仓与分支管控',
    items: [
      { path: '/managed-repos/dashboard', label: '管控 Dashboard' },
      { path: '/managed-repos/hub', label: '代码仓大盘' },
      { path: '/managed-repos/approvals', label: '审批管理中心' },
      { path: '/managed-repos/branch-health', label: '分支健康与清理' }
    ]
  },
  {
    title: '管理中心',
    items: [
      { path: '/managed-repos/compliance', label: '代码仓合规基线配置' },
      { path: '/pipeline-config', label: '系统配置' }
    ]
  }
];

export const menuItems: SubMenuItem[] = [
  { path: '/dashboard', label: '控制中心' },
  { path: '/repos', label: '流水线配置' },
  { path: '/managed-repos/dashboard', label: '管控 Dashboard' },
  { path: '/managed-repos/hub', label: '代码仓大盘' },
  { path: '/managed-repos/compliance', label: '代码仓合规基线配置' },
  { path: '/managed-repos/approvals', label: '审批管理中心' },
  { path: '/managed-repos/branch-health', label: '分支健康与清理' },
  { path: '/pipeline-config', label: '系统配置' },
  { path: '/mr/list', label: 'MR 全览' },
  { path: '/mr/hook', label: '实时MR看护' }
];

export default menuItems;
