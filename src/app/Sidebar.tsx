import type { MenuProps } from 'antd'
import type { ApiMe, Workspace } from '../api'
import type { Page } from './routes'
import { SidebarBrand } from './SidebarBrand'
import { SidebarFooter } from './SidebarFooter'
import { SidebarNavigation } from './SidebarNavigation'
import { SidebarWorkspaceSwitcher } from './SidebarWorkspaceSwitcher'

export { sidebarNavGroups } from './sidebar-nav'

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

/** 主导航侧栏：品牌、工作区切换、页面菜单、帮助与用户菜单。 */
export function Sidebar({ compactNav, page, serverCount, workspaces, activeWorkspace, activeWorkspaceId, apiLive, user, userMenuItems, onUserMenu, onSelectPage, onSwitchWorkspace, onManageWorkspaces, onClose }: SidebarProps) {
  return <aside className="sidebar">
    <SidebarBrand onClose={onClose} />
    <SidebarWorkspaceSwitcher workspaces={workspaces} activeWorkspace={activeWorkspace} activeWorkspaceId={activeWorkspaceId} apiLive={apiLive} onSwitchWorkspace={onSwitchWorkspace} onManageWorkspaces={onManageWorkspaces} />
    <SidebarNavigation compactNav={compactNav} page={page} serverCount={serverCount} onSelectPage={onSelectPage} />
    <SidebarFooter user={user} userMenuItems={userMenuItems} onUserMenu={onUserMenu} onClose={onClose} />
  </aside>
}
