import { useTranslation } from 'react-i18next'
import type { ApiInvite, CloudflareSettings, OauthSettings, PlatformSettings, SmtpSettings, Workspace } from '../../api'
import type { Notify } from '../../components/ToastProvider'
import { CloudflarePanel } from './CloudflarePanel'
import { InvitePanel } from './InvitePanel'
import { MaintenancePanel } from './MaintenancePanel'
import { OauthPanel } from './OauthPanel'
import { settingsSections } from './settings-sections'
import { SettingsNav } from './SettingsNav'
import { SmtpPanel } from './SmtpPanel'
import { useSettingsSections } from './useSettingsSections'

export interface SettingsPageProps {
  focusSection: { section: string; nonce: number } | null
  settings: PlatformSettings | null
  onSettingsChange: (settings: PlatformSettings) => void
  apiLive: boolean
  isSuperAdmin: boolean
  canManageInvites: boolean
  activeWorkspaceId: string | null
  workspaces: Workspace[]
  cloudflareSettings: CloudflareSettings | null
  onCloudflareChange: (settings: CloudflareSettings) => void
  smtpSettings: SmtpSettings | null
  onSmtpChange: (settings: SmtpSettings) => void
  oauthSettings: OauthSettings | null
  onOauthChange: (settings: OauthSettings) => void
  invites: ApiInvite[] | null
  onInvitesChange: (invites: ApiInvite[]) => void
  onAction: Notify
}

/** 设置页只做权限过滤与分区装配，各区自己的状态留在各自的组件里。 */
export function SettingsPage({
  focusSection, settings, onSettingsChange, apiLive, isSuperAdmin, canManageInvites,
  activeWorkspaceId, workspaces, cloudflareSettings, onCloudflareChange,
  smtpSettings, onSmtpChange, oauthSettings, onOauthChange,
  invites, onInvitesChange, onAction,
}: SettingsPageProps) {
  const { t } = useTranslation()
  const nav = settingsSections.filter(({ id }) => (isSuperAdmin ? true : id === 'invites') && (id !== 'invites' || canManageInvites))
  const navItems = nav.map(({ id, labelKey, icon }) => ({ id, label: t(labelKey), icon }))
  const { activeSection, goToSection } = useSettingsSections(nav.map(({ id }) => id), focusSection)

  return <div className="settings-layout">
    <SettingsNav items={navItems} activeSection={activeSection} onSelect={goToSection} />
    <div className="settings-content">
      {isSuperAdmin && <CloudflarePanel settings={cloudflareSettings} onSettingsChange={onCloudflareChange} apiLive={apiLive} onAction={onAction} />}
      {isSuperAdmin && <div id="settings-oauth"><OauthPanel settings={oauthSettings} onChange={onOauthChange} onAction={onAction} /></div>}
      {canManageInvites && <div id="settings-invites"><InvitePanel invites={invites} onChange={onInvitesChange} onAction={onAction} isSuperAdmin={isSuperAdmin} activeWorkspaceId={activeWorkspaceId} workspaces={workspaces} /></div>}
      {isSuperAdmin && <div id="settings-smtp"><SmtpPanel settings={smtpSettings} onChange={onSmtpChange} onAction={onAction} /></div>}
      {isSuperAdmin && <MaintenancePanel settings={settings} onChange={onSettingsChange} onAction={onAction} />}
    </div>
  </div>
}
