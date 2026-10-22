import type { Workspace } from '../../api'
import type { Notify } from '../../components/ToastProvider'
import { WorkspaceDangerPanel } from './WorkspaceDangerPanel'
import { WorkspaceMembersPanel } from './WorkspaceMembersPanel'
import { WorkspaceSwitcherPanel } from './WorkspaceSwitcherPanel'

/** 页面只解析当前工作区与权限，其余交给三个面板各自管理与自身的请求。 */
export function WorkspacePage({ workspaces, activeWorkspaceId, onSwitch, onWorkspacesChange, onAction }: {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  onSwitch: (workspaceId: string) => void
  onWorkspacesChange: () => Promise<void>
  onAction: Notify
}) {
  const active = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null
  const canManage = active?.role === 'owner'
  return <div className="workspace-page">
    <WorkspaceSwitcherPanel workspaces={workspaces} activeWorkspaceId={activeWorkspaceId} onSwitch={onSwitch} onWorkspacesChange={onWorkspacesChange} onAction={onAction} />
    <WorkspaceMembersPanel active={active} canManage={canManage} onAction={onAction} />
    {active && <WorkspaceDangerPanel active={active} canManage={canManage} onWorkspacesChange={onWorkspacesChange} onSwitch={onSwitch} onAction={onAction} />}
  </div>
}
