import { useTranslation } from 'react-i18next'
import { App, Button, Table, type TableProps } from 'antd'
import { Users, X } from 'lucide-react'
import { revokeInvite, type ApiInvite, type Workspace } from '../../api'
import { EmptyState } from '../../components/EmptyState'
import { StatusBadge } from '../../components/StatusBadge'
import type { Notify } from '../../components/ToastProvider'
import { errorMessage } from '../../errors'
import { formatDateTime } from '../../lib/format'
import { workspaceRoleLabel } from '../workspaces/roles'

/** 邀请列表：撤销走 Modal.confirm，撤销成功后由外层重取列表。 */
export function InviteTable({ invites, isSuperAdmin, workspaces, onRefresh, onAction }: {
  invites: ApiInvite[] | null
  isSuperAdmin: boolean
  workspaces: Workspace[]
  onRefresh: () => Promise<void>
  onAction: Notify
}) {
  const { t } = useTranslation()
  const modalApi = App.useApp().modal

  const revoke = (invite: ApiInvite) => {
    modalApi.confirm({
      title: t('settings.invite.revoke'),
      content: t('settings.invite.revokeConfirm'),
      okText: t('settings.invite.revoke'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await revokeInvite(invite.id)
          await onRefresh()
          onAction('success', t('settings.invite.revoked'))
        } catch (error) {
          onAction('error', errorMessage(error, 'settings.invite.revokeFailed'))
        }
      },
    })
  }

  const workspaceName = (id: string | undefined) => workspaces.find((workspace) => workspace.id === id)?.name ?? id ?? '—'
  const columns: TableProps<ApiInvite>['columns'] = [
    {
      title: t('settings.invite.columnIdentity'),
      dataIndex: 'email',
      render: (_, invite) => <div className="cell-title"><div className="table-icon"><Users size={15} /></div><div><strong>{invite.github_login || invite.email || t('settings.invite.noIdentity')}</strong><small>{invite.email || t('settings.invite.noEmail')}</small></div></div>,
    },
    ...(isSuperAdmin ? [{ title: t('settings.invite.columnWorkspace'), key: 'workspace', render: (_: unknown, invite: ApiInvite) => workspaceName(invite.workspace_id) }] : []),
    { title: t('settings.invite.columnRole'), key: 'role', render: (_, invite) => invite.role ? workspaceRoleLabel(t, invite.role) : '—' },
    {
      title: t('settings.invite.columnStatus'),
      dataIndex: 'status',
      render: (status: ApiInvite['status']) => <StatusBadge tone={status === 'pending' ? 'warning' : status === 'used' ? 'success' : 'neutral'}>{t(`status.${status}`, { defaultValue: status })}</StatusBadge>,
    },
    { title: t('settings.invite.columnExpires'), dataIndex: 'expires_at', render: (expiresAt: string) => formatDateTime(expiresAt) },
    {
      title: '',
      key: 'actions',
      width: 64,
      render: (_, invite) => invite.status === 'pending' ? <Button type="text" size="small" onClick={() => void revoke(invite)} aria-label={t('settings.invite.revoke')} title={t('settings.invite.revoke')} icon={<X size={15} />} /> : null,
    },
  ]

  if (invites === null) return <EmptyState icon={<Users size={20} />} title={t('settings.invite.emptyTitle')} body={t('settings.invite.emptyBody')} />
  if (invites.length === 0) return <EmptyState icon={<Users size={20} />} title={t('settings.invite.noInvitesTitle')} body={t('settings.invite.noInvitesBody')} />
  return <Table<ApiInvite> rowKey="id" size="small" columns={columns} dataSource={invites} pagination={false} scroll={{ x: 640 }} />
}
