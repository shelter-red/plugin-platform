import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { App, Button, Input, Select, Table, type TableProps } from 'antd'
import { Copy, Plus, Users, X } from 'lucide-react'
import { createInvite, fetchInvites, revokeInvite, type ApiInvite, type Workspace, type WorkspaceRole } from '../../api'
import { EmptyState } from '../../components/EmptyState'
import { Panel } from '../../components/Panel'
import { StatusBadge } from '../../components/StatusBadge'
import type { Notify } from '../../components/ToastProvider'
import { errorMessage } from '../../errors'
import { formatDateTime } from '../../lib/format'

export function InvitePanel({ invites, onChange, onAction, isSuperAdmin, activeWorkspaceId, workspaces }: { invites: ApiInvite[] | null; onChange: (invites: ApiInvite[]) => void; onAction: Notify; isSuperAdmin: boolean; activeWorkspaceId: string | null; workspaces: Workspace[] }) {
  const { t } = useTranslation()
  const modalApi = App.useApp().modal
  const [email, setEmail] = useState('')
  const [githubLogin, setGithubLogin] = useState('')
  const [expiresInHours, setExpiresInHours] = useState('72')
  const [role, setRole] = useState<WorkspaceRole>('viewer')
  const [saving, setSaving] = useState(false)
  const [latestUrl, setLatestUrl] = useState<string | null>(null)

  const refresh = async () => onChange(await fetchInvites())
  const create = async () => {
    if (!email.trim() && !githubLogin.trim()) {
      onAction('warning', t('settings.invite.identityRequired'))
      return
    }
    setSaving(true)
    try {
      const result = await createInvite({ email: email.trim() || undefined, githubLogin: githubLogin.trim() || undefined, expiresInHours: Number(expiresInHours) || 72, workspaceId: activeWorkspaceId ?? undefined, role })
      setLatestUrl(result.inviteUrl)
      setEmail('')
      setGithubLogin('')
      await refresh()
      onAction(result.emailSent === false && email.trim() ? 'warning' : 'success', result.emailSent === false && email.trim() ? t('settings.invite.createdEmailFailed') : t('settings.invite.created'))
    } catch (error) {
      onAction('error', errorMessage(error, 'settings.invite.createFailed'))
    } finally {
      setSaving(false)
    }
  }
  const revoke = (invite: ApiInvite) => {
    modalApi.confirm({
      title: t('settings.invite.revoke'),
      content: t('settings.invite.revokeConfirm'),
      okText: t('settings.invite.revoke'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await revokeInvite(invite.id)
          await refresh()
          onAction('success', t('settings.invite.revoked'))
        } catch (error) {
          onAction('error', errorMessage(error, 'settings.invite.revokeFailed'))
        }
      },
    })
  }
  const copy = async () => {
    if (!latestUrl) return
    await navigator.clipboard.writeText(latestUrl)
    onAction('success', t('settings.invite.copied'))
  }
  const workspaceName = (id: string | undefined) => workspaces.find((workspace) => workspace.id === id)?.name ?? id ?? '—'
  const roleOptions = (['owner', 'operator', 'viewer'] as WorkspaceRole[]).map((value) => ({ value, label: t(`workspace.roles.${value}`) }))
  const columns: TableProps<ApiInvite>['columns'] = [
    {
      title: t('settings.invite.columnIdentity'),
      dataIndex: 'email',
      render: (_, invite) => <div className="cell-title"><div className="table-icon"><Users size={15} /></div><div><strong>{invite.github_login || invite.email || t('settings.invite.noIdentity')}</strong><small>{invite.email || t('settings.invite.noEmail')}</small></div></div>,
    },
    ...(isSuperAdmin ? [{ title: t('settings.invite.columnWorkspace'), key: 'workspace', render: (_: unknown, invite: ApiInvite) => workspaceName(invite.workspace_id) }] : []),
    { title: t('settings.invite.columnRole'), key: 'role', render: (_, invite) => invite.role ? t(`workspace.roles.${invite.role}`) : '—' },
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
  return <Panel className="settings-panel" padded heading={
    <div className="settings-heading">
      <div className="settings-icon"><Users size={18} /></div>
      <div><h2>{t('settings.invite.title')}</h2><p>{invites ? t('settings.invite.description') : t('settings.invite.descriptionUnavailable')}</p></div>
      <StatusBadge tone={invites ? 'success' : 'neutral'}>{invites ? t('settings.invite.count', { count: invites.length }) : t('settings.invite.unknown')}</StatusBadge>
    </div>
  }>
    <div className="form-grid">
      <label>{t('settings.invite.email')}<Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="member@example.com" disabled={!invites || saving} /></label>
      <label>{t('settings.invite.github')}<Input value={githubLogin} onChange={(event) => setGithubLogin(event.target.value)} placeholder="github-login" disabled={!invites || saving} /></label>
      <label>{t('settings.invite.role')}<Select aria-label={t('settings.invite.role')} value={role} onChange={(value: WorkspaceRole) => setRole(value)} disabled={!invites || saving} options={roleOptions} /></label>
      <label>{t('settings.invite.expiresIn')}<Input type="number" min={1} max={720} value={expiresInHours} onChange={(event) => setExpiresInHours(event.target.value)} disabled={!invites || saving} /></label>
    </div>
    <div className="settings-actions">
      <span className="form-hint">{t('settings.invite.workspaceHint', { name: workspaceName(activeWorkspaceId ?? undefined) })}</span>
      <Button type="primary" onClick={() => void create()} loading={saving} disabled={!invites}>{t('settings.invite.create')}<Plus size={14} /></Button>
      {latestUrl && <><Input className="invite-url" value={latestUrl} readOnly aria-label={t('settings.invite.newLink')} /><Button onClick={() => void copy()} icon={<Copy size={14} />}>{t('settings.invite.copy')}</Button></>}
    </div>
    {invites === null
      ? <EmptyState icon={<Users size={20} />} title={t('settings.invite.emptyTitle')} body={t('settings.invite.emptyBody')} />
      : invites.length === 0
        ? <EmptyState icon={<Users size={20} />} title={t('settings.invite.noInvitesTitle')} body={t('settings.invite.noInvitesBody')} />
        : <Table<ApiInvite> rowKey="id" size="small" columns={columns} dataSource={invites} pagination={false} scroll={{ x: 640 }} />}
  </Panel>
}
