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
    title: '管理中心',
    items: [
      { path: '/managed-repos', label: '代码仓与分支管理' },
      { path: '/pipeline-config', label: '系统配置' }
    ]
  }
];

export const menuItems: SubMenuItem[] = [
  { path: '/dashboard', label: '控制中心' },
  { path: '/repos', label: '流水线配置' },
  { path: '/managed-repos', label: '代码仓与分支管理' },
  { path: '/pipeline-config', label: '系统配置' },
  { path: '/mr/list', label: 'MR 全览' },
  { path: '/mr/hook', label: '实时MR看护' }
];


export default menuItems;
