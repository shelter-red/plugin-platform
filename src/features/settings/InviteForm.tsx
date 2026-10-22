import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Input, Select } from 'antd'
import { Copy, Plus } from 'lucide-react'
import { createInvite, type WorkspaceRole } from '../../api'
import type { Notify } from '../../components/ToastProvider'
import { errorMessage } from '../../errors'
import { workspaceRoleLabel, workspaceRoles } from '../workspaces/roles'

/** 邀请创建表单；创建成功后把一次性链接留在原地供复制，列表刷新交给外层。 */
export function InviteForm({ enabled, activeWorkspaceId, workspaceName, onCreated, onAction }: {
  enabled: boolean
  activeWorkspaceId: string | null
  workspaceName: string
  onCreated: () => Promise<void>
  onAction: Notify
}) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [githubLogin, setGithubLogin] = useState('')
  const [expiresInHours, setExpiresInHours] = useState('72')
  const [role, setRole] = useState<WorkspaceRole>('viewer')
  const [saving, setSaving] = useState(false)
  const [latestUrl, setLatestUrl] = useState<string | null>(null)
  const disabled = !enabled || saving

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
      await onCreated()
      // 填了邮箱却没发出去属于「创建成功但通知失败」，不能当成功提示。
      const emailFailed = result.emailSent === false && Boolean(email.trim())
      onAction(emailFailed ? 'warning' : 'success', emailFailed ? t('settings.invite.createdEmailFailed') : t('settings.invite.created'))
    } catch (error) {
      onAction('error', errorMessage(error, 'settings.invite.createFailed'))
    } finally {
      setSaving(false)
    }
  }

  const copy = async () => {
    if (!latestUrl) return
    await navigator.clipboard.writeText(latestUrl)
    onAction('success', t('settings.invite.copied'))
  }

  return <>
    <div className="form-grid">
      <label>{t('settings.invite.email')}<Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="member@example.com" disabled={disabled} /></label>
      <label>{t('settings.invite.github')}<Input value={githubLogin} onChange={(event) => setGithubLogin(event.target.value)} placeholder="github-login" disabled={disabled} /></label>
      <label>{t('settings.invite.role')}<Select aria-label={t('settings.invite.role')} value={role} onChange={(value: WorkspaceRole) => setRole(value)} disabled={disabled} options={workspaceRoles.map((value) => ({ value, label: workspaceRoleLabel(t, value) }))} /></label>
      <label>{t('settings.invite.expiresIn')}<Input type="number" min={1} max={720} value={expiresInHours} onChange={(event) => setExpiresInHours(event.target.value)} disabled={disabled} /></label>
    </div>
    <div className="settings-actions">
      <span className="form-hint">{t('settings.invite.workspaceHint', { name: workspaceName })}</span>
      <Button type="primary" onClick={() => void create()} loading={saving} disabled={!enabled}>{t('settings.invite.create')}<Plus size={14} /></Button>
      {latestUrl && <><Input className="invite-url" value={latestUrl} readOnly aria-label={t('settings.invite.newLink')} /><Button onClick={() => void copy()} icon={<Copy size={14} />}>{t('settings.invite.copy')}</Button></>}
    </div>
  </>
}
