import { useTranslation } from 'react-i18next'
import { Users } from 'lucide-react'
import { fetchInvites, type ApiInvite, type Workspace } from '../../api'
import { Panel } from '../../components/Panel'
import { StatusBadge } from '../../components/StatusBadge'
import type { Notify } from '../../components/ToastProvider'
import { InviteForm } from './InviteForm'
import { InviteTable } from './InviteTable'

/** 邀请面板只持有列表刷新与标题状态，表单和表格各自成组件。 */
export function InvitePanel({ invites, onChange, onAction, isSuperAdmin, activeWorkspaceId, workspaces }: {
  invites: ApiInvite[] | null
  onChange: (invites: ApiInvite[]) => void
  onAction: Notify
  isSuperAdmin: boolean
  activeWorkspaceId: string | null
  workspaces: Workspace[]
}) {
  const { t } = useTranslation()
  const refresh = async () => onChange(await fetchInvites())
  const workspaceName = workspaces.find((workspace) => workspace.id === activeWorkspaceId)?.name ?? activeWorkspaceId ?? '—'

  return <Panel className="settings-panel" padded heading={
    <div className="settings-heading">
      <div className="settings-icon"><Users size={18} /></div>
      <div><h2>{t('settings.invite.title')}</h2><p>{invites ? t('settings.invite.description') : t('settings.invite.descriptionUnavailable')}</p></div>
      <StatusBadge tone={invites ? 'success' : 'neutral'}>{invites ? t('settings.invite.count', { count: invites.length }) : t('settings.invite.unknown')}</StatusBadge>
    </div>
  }>
    <InviteForm enabled={invites !== null} activeWorkspaceId={activeWorkspaceId} workspaceName={workspaceName} onCreated={refresh} onAction={onAction} />
    <InviteTable invites={invites} isSuperAdmin={isSuperAdmin} workspaces={workspaces} onRefresh={refresh} onAction={onAction} />
  </Panel>
}
