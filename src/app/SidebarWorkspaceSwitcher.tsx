import { Avatar, Button, Dropdown, type MenuProps } from 'antd'
import { Building2, Check, MoreHorizontal, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Workspace } from '../api'

export function SidebarWorkspaceSwitcher({ workspaces, activeWorkspace, activeWorkspaceId, apiLive, onSwitchWorkspace, onManageWorkspaces }: {
  workspaces: Workspace[]
  activeWorkspace: Workspace | null
  activeWorkspaceId: string | null
  apiLive: boolean
  onSwitchWorkspace: (workspaceId: string) => void
  onManageWorkspaces: () => void
}) {
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
  return <Dropdown menu={{ items: workspaceMenuItems, onClick: onWorkspaceMenu }} trigger={['click']} placement="bottomLeft">
    <Button type="text" block className="workspace-switcher">
      <Avatar shape="square" size={24} className="workspace-icon">{(activeWorkspace?.name ?? t('shell.workspace')).trim().slice(0, 1).toUpperCase()}</Avatar>
      <span className="workspace-copy"><strong>{activeWorkspace?.name ?? t('workspace.none')}</strong><span>{activeWorkspace ? `${t(`workspace.roles.${activeWorkspace.role}`)} · ${apiLive ? t('shell.connected') : t('shell.waiting')}` : t('shell.waiting')}</span></span>
      <MoreHorizontal size={16} />
      <span className="sr-only">{t('workspace.switch')}</span>
    </Button>
  </Dropdown>
}
