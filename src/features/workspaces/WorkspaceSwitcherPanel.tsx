import { Building2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Workspace } from '../../api'
import { Panel } from '../../components/Panel'
import { StatusBadge } from '../../components/StatusBadge'
import type { Notify } from '../../components/ToastProvider'
import { WorkspaceCreateForm } from './WorkspaceCreateForm'
import { WorkspaceList } from './WorkspaceList'

/** 工作区列表即导航；新建后由外层重取列表并切到新工作区。 */
export function WorkspaceSwitcherPanel({ workspaces, activeWorkspaceId, onSwitch, onWorkspacesChange, onAction }: {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  onSwitch: (workspaceId: string) => void
  onWorkspacesChange: () => Promise<void>
  onAction: Notify
}) {
  const { t } = useTranslation()
  return <Panel className="settings-panel" padded heading={
    <div className="settings-heading">
      <div className="settings-icon"><Building2 size={18} /></div>
      <div><h2>{t('workspace.switcherTitle')}</h2><p>{t('workspace.switcherDescription')}</p></div>
      <StatusBadge tone="success">{t('workspace.count', { count: workspaces.length })}</StatusBadge>
    </div>
  }>
    <WorkspaceList workspaces={workspaces} activeWorkspaceId={activeWorkspaceId} onSwitch={onSwitch} />
    <WorkspaceCreateForm onSwitch={onSwitch} onWorkspacesChange={onWorkspacesChange} onAction={onAction} />
  </Panel>
}
