import { Building2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Workspace } from '../../api'
import { Panel } from '../../components/Panel'
import type { Notify } from '../../components/ToastProvider'
import { WorkspaceDangerActions } from './WorkspaceDangerActions'
import { WorkspaceRenameForm } from './WorkspaceRenameForm'
import { useWorkspaceDangerActions } from './useWorkspaceDangerActions'

/** 改名与删除：默认工作区不可删除，删除后回到默认工作区由外层切换。 */
export function WorkspaceDangerPanel({ active, canManage, onWorkspacesChange, onSwitch, onAction }: {
  active: Workspace
  canManage: boolean
  onWorkspacesChange: () => Promise<void>
  onSwitch: (workspaceId: string) => void
  onAction: Notify
}) {
  const { t } = useTranslation()
  const { name, setName, busy, isDefault, rename, remove } = useWorkspaceDangerActions({ active, onWorkspacesChange, onSwitch, onAction })

  return <Panel className="settings-panel" padded heading={
    <div className="settings-heading">
      <div className="settings-icon"><Building2 size={18} /></div>
      <div><h2>{t('workspace.dangerTitle')}</h2><p>{isDefault ? t('workspace.defaultLocked') : t('workspace.dangerDescription')}</p></div>
    </div>
  }>
    <WorkspaceRenameForm name={name} onChange={setName} disabled={!canManage || busy !== null} placeholder={active.name} />
    <WorkspaceDangerActions canManage={canManage} busy={busy} isDefault={isDefault} canRename={Boolean(name.trim())} onRename={() => void rename()} onDelete={remove} />
  </Panel>
}
