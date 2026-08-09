export interface SubMenuItem {
  id?: string;
  path: string;
  label: string;
  headerTitle?: string;
  icon?: string;
  adminOnly?: boolean;
  hidden?: boolean;
}

export interface MenuGroup {
  groupKey?: string;
  title: string;
  adminOnly?: boolean;
  items: SubMenuItem[];
}

export interface ModuleMenuConfig {
  moduleKey: string;
  moduleName: string;
  groups: MenuGroup[];
}

export const pipelineMenuConfig: ModuleMenuConfig = {
  moduleKey: 'pipeline',
  moduleName: '持续构建 (Code Pipeline)',
  groups: [
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
        { path: '/pipeline-config', label: '构建与流水线管理' },
        { path: '/managed-repos/compliance', label: '代码仓合规基线配置' }
      ]
    }
  ]
};

export const menuGroups: MenuGroup[] = pipelineMenuConfig.groups;
export const menuItems: SubMenuItem[] = pipelineMenuConfig.groups.flatMap(group => group.items);

export default pipelineMenuConfig;

