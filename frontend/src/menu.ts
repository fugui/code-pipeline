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
      { path: '/repos', label: '仓库配置' },
      { path: '/pipeline-config', label: '流水线配置' }
    ]
  }
];

export const menuItems: SubMenuItem[] = [
  { path: '/dashboard', label: '控制中心' },
  { path: '/repos', label: '仓库配置' },
  { path: '/pipeline-config', label: '流水线配置' }
];

export default menuItems;
