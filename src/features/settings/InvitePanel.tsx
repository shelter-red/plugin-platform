import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Plus, Users, X } from 'lucide-react'
import { Select } from 'antd'
import { createInvite, fetchInvites, revokeInvite, type ApiInvite, type Workspace, type WorkspaceRole } from '../../api'
import type { Notify } from '../../components/ToastProvider'
import { StatusBadge } from '../../components/StatusBadge'
import { errorMessage } from '../../errors'
import { formatDateTime } from '../../lib/format'

export function InvitePanel({ invites, onChange, onAction, isSuperAdmin, activeWorkspaceId, workspaces }: { invites: ApiInvite[] | null; onChange: (invites: ApiInvite[]) => void; onAction: Notify; isSuperAdmin: boolean; activeWorkspaceId: string | null; workspaces: Workspace[] }) {
  const { t } = useTranslation()
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
  const revoke = async (invite: ApiInvite) => {
    if (!window.confirm(t('settings.invite.revokeConfirm'))) return
    try {
      await revokeInvite(invite.id)
      await refresh()
      onAction('success', t('settings.invite.revoked'))
    } catch (error) {
      onAction('error', errorMessage(error, 'settings.invite.revokeFailed'))
    }
  }
  const copy = async () => {
    if (!latestUrl) return
    await navigator.clipboard.writeText(latestUrl)
    onAction('success', t('settings.invite.copied'))
  }
  const workspaceName = (id: string | undefined) => workspaces.find((workspace) => workspace.id === id)?.name ?? id ?? '—'
  const roleOptions = (['owner', 'operator', 'viewer'] as WorkspaceRole[]).map((value) => ({ value, label: t(`workspace.roles.${value}`) }))
  return <div className="panel settings-panel"><div className="settings-heading"><div className="settings-icon"><Users size={18} /></div><div><h2>{t('settings.invite.title')}</h2><p>{invites ? t('settings.invite.description') : t('settings.invite.descriptionUnavailable')}</p></div><StatusBadge tone={invites ? 'success' : 'neutral'}>{invites ? t('settings.invite.count', { count: invites.length }) : t('settings.invite.unknown')}</StatusBadge></div><div className="form-grid"><label>{t('settings.invite.email')}<input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="member@example.com" disabled={!invites || saving} /></label><label>{t('settings.invite.github')}<input value={githubLogin} onChange={(event) => setGithubLogin(event.target.value)} placeholder="github-login" disabled={!invites || saving} /></label><label>{t('settings.invite.role')}<Select aria-label={t('settings.invite.role')} value={role} onChange={(value: WorkspaceRole) => setRole(value)} disabled={!invites || saving} options={roleOptions} /></label><label>{t('settings.invite.expiresIn')}<input type="number" min="1" max="720" value={expiresInHours} onChange={(event) => setExpiresInHours(event.target.value)} disabled={!invites || saving} /></label></div><div className="settings-actions"><span className="form-hint">{t('settings.invite.workspaceHint', { name: workspaceName(activeWorkspaceId ?? undefined) })}</span><button className="button primary" onClick={() => void create()} disabled={!invites || saving}>{t('settings.invite.create')}<Plus size={14} /></button>{latestUrl && <><input className="invite-url" value={latestUrl} readOnly aria-label={t('settings.invite.newLink')} /><button className="button secondary" onClick={() => void copy()}><Copy size={14} />{t('settings.invite.copy')}</button></>}</div>{invites === null ? <div className="empty-panel"><div className="empty-illustration"><Users size={20} /></div><h3>{t('settings.invite.emptyTitle')}</h3><p>{t('settings.invite.emptyBody')}</p></div> : invites.length === 0 ? <div className="empty-panel"><div className="empty-illustration"><Users size={20} /></div><h3>{t('settings.invite.noInvitesTitle')}</h3><p>{t('settings.invite.noInvitesBody')}</p></div> : <div className="table-wrap"><table><thead><tr><th>{t('settings.invite.columnIdentity')}</th>{isSuperAdmin && <th>{t('settings.invite.columnWorkspace')}</th>}<th>{t('settings.invite.columnRole')}</th><th>{t('settings.invite.columnStatus')}</th><th>{t('settings.invite.columnExpires')}</th><th /></tr></thead><tbody>{invites.map((invite) => <tr key={invite.id}><td><div className="cell-title"><div className="table-icon"><Users size={15} /></div><div><strong>{invite.github_login || invite.email || t('settings.invite.noIdentity')}</strong><small>{invite.email || t('settings.invite.noEmail')}</small></div></div></td>{isSuperAdmin && <td>{workspaceName(invite.workspace_id)}</td>}<td>{invite.role ? t(`workspace.roles.${invite.role}`) : '—'}</td><td><StatusBadge tone={invite.status === 'pending' ? 'warning' : invite.status === 'used' ? 'success' : 'neutral'}>{t(`status.${invite.status}`, { defaultValue: invite.status })}</StatusBadge></td><td>{formatDateTime(invite.expires_at)}</td><td>{invite.status === 'pending' && <button className="row-action" onClick={() => void revoke(invite)} aria-label={t('settings.invite.revoke')} title={t('settings.invite.revoke')}><X size={15} /></button>}</td></tr>)}</tbody></table></div>}</div>
}
