import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Avatar, Button, Dropdown, Menu, Typography, type MenuProps } from 'antd'
import { Activity, ArrowUpRight, Box, Building2, Check, CircleHelp, FileText, Gauge, Globe2, LayoutDashboard, MoreHorizontal, Network, Plus, Server, Settings, X } from 'lucide-react'
import { IconButton } from '../components/IconButton'
import type { ApiMe, Workspace } from '../api'
import type { Page } from './routes'

export const sidebarNavGroups: { labelKey: string; items: { id: Page; icon: typeof LayoutDashboard }[] }[] = [
  {
    labelKey: 'nav.groups.main',
    items: [
      { id: 'overview', icon: LayoutDashboard },
      { id: 'servers', icon: Server },
      { id: 'plugins', icon: Box },
      { id: 'domains', icon: Globe2 },
      { id: 'workspaces', icon: Building2 },
    ],
  },
  {
    labelKey: 'nav.groups.system',
    items: [
      { id: 'usage', icon: Gauge },
      { id: 'logs', icon: Activity },
      { id: 'audit', icon: FileText },
      { id: 'settings', icon: Settings },
    ],
  },
]

export type SidebarProps = {
  compactNav: boolean
  page: Page | null
  serverCount: number
  workspaces: Workspace[]
  activeWorkspace: Workspace | null
  activeWorkspaceId: string | null
  apiLive: boolean
  user: ApiMe['user'] | null
  userMenuItems: MenuProps['items']
  onUserMenu: MenuProps['onClick']
  onSelectPage: (page: Page) => void
  onSwitchWorkspace: (workspaceId: string) => void
  onManageWorkspaces: () => void
  onClose: () => void
}

/** 主导航侧栏：品牌、工作区切换、页面菜单、帮助与用户菜单。结构固定，交互全部经 props 回调。 */
export function Sidebar({ compactNav, page, serverCount, workspaces, activeWorkspace, activeWorkspaceId, apiLive, user, userMenuItems, onUserMenu, onSelectPage, onSwitchWorkspace, onManageWorkspaces, onClose }: SidebarProps) {
  const { t } = useTranslation()
  const workspaceMenuItems: MenuProps['items'] = [
    ...workspaces.map((workspace) => ({ key: `ws:${workspace.id}`, label: `${workspace.name} · ${t(`workspace.roles.${workspace.role}`)}`, icon: workspace.id === activeWorkspaceId ? <Check size={14} /> : <Building2 size={14} /> })),
    ...(workspaces.length > 0 ? [{ type: 'divider' as const }] : []),
    { key: 'workspace:manage', label: t('workspace.manage'), icon: <Building2 size={14} /> },
    { key: 'workspace:create', label: t('workspace.create'), icon: <Plus size={14} /> },
  ]
  const onWorkspaceMenu: MenuProps['onClick'] = ({ key }) => {
    if (key.startsWith('ws:')) onSwitchWorkspace(key.slice(3))
    else onManageWorkspaces()
  }
  const navItems: MenuProps['items'] = sidebarNavGroups.map((group) => ({
    type: 'group',
    key: group.labelKey,
    label: t(group.labelKey),
    children: group.items.map(({ id, icon: NavIcon }) => ({
      key: id,
      icon: <NavIcon size={16} />,
      label: t(`nav.${id}`),
      extra: id === 'servers' && serverCount > 0 ? <span className="nav-count">{serverCount}</span> : undefined,
    })),
  }))
  return (
    <aside className="sidebar">
      <div className="brand-row">
        <Link className="brand-link" to="/" onClick={onClose}>
          <Avatar shape="square" size={30} className="brand-mark" icon={<Network size={17} strokeWidth={2.4} />} />
          <div>
            <Typography.Text strong className="brand-name">Plugmesh</Typography.Text>
            <Typography.Text className="brand-caption">{t('brand.caption')}</Typography.Text>
          </div>
          <span className="sr-only">{t('shell.home')}</span>
        </Link>
        <IconButton label={t('shell.closeNav')} onClick={onClose}><X size={17} /></IconButton>
      </div>
      <Dropdown menu={{ items: workspaceMenuItems, onClick: onWorkspaceMenu }} trigger={['click']} placement="bottomLeft">
        <Button type="text" block className="workspace-switcher">
          <Avatar shape="square" size={24} className="workspace-icon">{(activeWorkspace?.name ?? t('shell.workspace')).trim().slice(0, 1).toUpperCase()}</Avatar>
          <span className="workspace-copy"><strong>{activeWorkspace?.name ?? t('workspace.none')}</strong><span>{activeWorkspace ? `${t(`workspace.roles.${activeWorkspace.role}`)} · ${apiLive ? t('shell.connected') : t('shell.waiting')}` : t('shell.waiting')}</span></span>
          <MoreHorizontal size={16} />
          <span className="sr-only">{t('workspace.switch')}</span>
        </Button>
      </Dropdown>
      <nav className="nav-area" aria-label={t('shell.navigation')}>
        <Menu mode="inline" inlineCollapsed={compactNav} className="nav-menu" items={navItems} selectedKeys={page ? [page] : []} onClick={({ key }) => onSelectPage(key as Page)} />
      </nav>
      <div className="sidebar-bottom">
        <Link className="support-link" to="/help" onClick={onClose}><CircleHelp size={15} /><span>{t('shell.help')}</span><ArrowUpRight size={12} /></Link>
        <Dropdown menu={{ items: userMenuItems, onClick: onUserMenu }} trigger={['click']} placement="topLeft">
          <Button type="text" block className="user-card">
            <Avatar size={26} className="avatar">{(user?.display_name ?? '—').slice(0, 2).toUpperCase()}</Avatar>
            <span className="user-copy"><strong>{user?.display_name ?? t('shell.unknownUser')}</strong><span>{user?.email ?? t('shell.unknownIdentity')}</span></span>
            <MoreHorizontal size={16} />
            <span className="sr-only">{t('shell.openUserMenu')}</span>
          </Button>
        </Dropdown>
      </div>
    </aside>
  )
}
