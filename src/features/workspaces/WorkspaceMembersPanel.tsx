import { useTranslation } from 'react-i18next'
import { Skeleton } from 'antd'
import { Building2, Users } from 'lucide-react'
import type { Workspace } from '../../api'
import { EmptyState } from '../../components/EmptyState'
import { Panel } from '../../components/Panel'
import { StatusBadge } from '../../components/StatusBadge'
import type { Notify } from '../../components/ToastProvider'
import { workspaceRoleLabel } from './roles'
import { WorkspaceMemberForm } from './WorkspaceMemberForm'
import { WorkspaceMemberTable } from './WorkspaceMemberTable'
import { useWorkspaceMembers } from './useWorkspaceMembers'

export function WorkspaceMembersPanel({ active, canManage, onAction }: {
  active: Workspace | null
  canManage: boolean
  onAction: Notify
}) {
  const { t } = useTranslation()
  const { members, busy, error, addMember, changeRole, removeMember } = useWorkspaceMembers(active, onAction)

  return <Panel className="settings-panel" padded heading={
    <div className="settings-heading">
      <div className="settings-icon"><Users size={18} /></div>
      <div><h2>{t('workspace.membersTitle')}</h2><p>{active ? t('workspace.membersDescription', { name: active.name }) : t('workspace.none')}</p></div>
      <StatusBadge tone={canManage ? 'success' : 'warning'}>{active ? workspaceRoleLabel(t, active.role) : t('workspace.none')}</StatusBadge>
    </div>
  }>
    {!active ? <EmptyState icon={<Building2 size={20} />} title={t('workspace.none')} body={t('workspace.noneHint')} /> : <>
      <WorkspaceMemberForm canManage={canManage} busy={busy !== null} onAdd={addMember} />
      {error && <div className="form-hint error">{error}</div>}
      {members === null
        ? <Skeleton active paragraph={{ rows: 3 }} />
        : members.length === 0
          ? <EmptyState icon={<Users size={20} />} title={t('workspace.noMembers')} body={t('workspace.noMembersHint')} />
          : <WorkspaceMemberTable members={members} canManage={canManage} busy={busy !== null} onChangeRole={(member, role) => void changeRole(member, role)} onRemove={removeMember} />}
    </>}
  </Panel>
}
