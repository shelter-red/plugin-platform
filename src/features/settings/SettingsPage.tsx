import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Cloud, FileText, KeyRound, ShieldCheck, Users } from 'lucide-react'
import { ApiError, updatePlatformSettings, type ApiInvite, type CloudflareSettings, type OauthSettings, type PlatformSettings, type SmtpSettings, type Workspace } from '../../api'
import type { Notify } from '../../components/ToastProvider'
import { StatusBadge } from '../../components/StatusBadge'
import { CloudflarePanel } from './CloudflarePanel'
import type { CloudflareDiagnosis } from './cloudflare-auth'
import { InvitePanel } from './InvitePanel'
import { OauthPanel } from './OauthPanel'
import { SmtpPanel } from './SmtpPanel'

export const settingsSections: { id: string; labelKey: string; icon: typeof Cloud }[] = [
  { id: 'cloudflare', labelKey: 'settings.nav.cloudflare', icon: Cloud },
  { id: 'oauth', labelKey: 'settings.nav.oauth', icon: KeyRound },
  { id: 'invites', labelKey: 'settings.nav.invites', icon: Users },
  { id: 'smtp', labelKey: 'settings.nav.smtp', icon: FileText },
  { id: 'maintenance', labelKey: 'settings.nav.maintenance', icon: ShieldCheck },
]

const scrollBehavior = (): ScrollBehavior => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'

export function SettingsPage({ focusSection, settings, onSettingsChange, apiLive, isSuperAdmin, canManageInvites, activeWorkspaceId, workspaces, cloudflareSettings, onCloudflareChange, cloudflareDiagnosis, onDismissCloudflareDiagnosis, smtpSettings, onSmtpChange, oauthSettings, onOauthChange, invites, onInvitesChange, onAction }: { focusSection: { section: string; nonce: number } | null; settings: PlatformSettings | null; onSettingsChange: (settings: PlatformSettings) => void; apiLive: boolean; isSuperAdmin: boolean; canManageInvites: boolean; activeWorkspaceId: string | null; workspaces: Workspace[]; cloudflareSettings: CloudflareSettings | null; onCloudflareChange: (settings: CloudflareSettings) => void; cloudflareDiagnosis: CloudflareDiagnosis | null; onDismissCloudflareDiagnosis: () => void; smtpSettings: SmtpSettings | null; onSmtpChange: (settings: SmtpSettings) => void; oauthSettings: OauthSettings | null; onOauthChange: (settings: OauthSettings) => void; invites: ApiInvite[] | null; onInvitesChange: (invites: ApiInvite[]) => void; onAction: Notify }) {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  const [quotaSaving, setQuotaSaving] = useState(false)
  const [suffixSaving, setSuffixSaving] = useState(false)
  const [quotaForm, setQuotaForm] = useState({ requests: '', activeConnections: '', r2Bytes: '', r2Objects: '', d1Queries: '', kvOperations: '', durableObjectRequests: '' })
  const [domainSuffix, setDomainSuffix] = useState('')
  const [activeSection, setActiveSection] = useState('cloudflare')
  const maintenance = settings?.maintenance ?? false
  const sectionNav = settingsSections.filter(({ id }) => (isSuperAdmin ? true : id === 'invites') && (id !== 'invites' || canManageInvites)).map(({ id, labelKey, icon }) => ({ id, label: t(labelKey), icon }))
  useEffect(() => {
    if (!focusSection) return
    setActiveSection(focusSection.section)
    document.getElementById(`settings-${focusSection.section}`)?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
  }, [focusSection])
  useEffect(() => {
    const scroller = document.querySelector('.page-scroll')
    const sections = sectionNav.map(({ id }) => document.getElementById(`settings-${id}`)).filter((section): section is HTMLElement => section !== null)
    if (!scroller || sections.length === 0) return
    const visible = new Set<string>()
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target.id)
        else visible.delete(entry.target.id)
      }
      const current = sections.find((section) => visible.has(section.id))
      if (current) setActiveSection(current.id.replace('settings-', ''))
    }, { root: scroller, rootMargin: '-72px 0px -55% 0px' })
    sections.forEach((section) => observer.observe(section))
    // 末尾区块通常不足视口高度，滚到底时直接高亮最后一项，避免高亮停在上一节。
    const onScroll = () => {
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 8) setActiveSection(sectionNav[sectionNav.length - 1].id)
    }
    scroller.addEventListener('scroll', onScroll)
    return () => {
      observer.disconnect()
      scroller.removeEventListener('scroll', onScroll)
    }
    // 分区与滚动容器在设置页挂载时即固定，无需随渲染重建观察器。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!settings) return
    setQuotaForm({ requests: String(settings.quotas.requests), activeConnections: String(settings.quotas.activeConnections), r2Bytes: String(settings.quotas.r2Bytes), r2Objects: String(settings.quotas.r2Objects), d1Queries: String(settings.quotas.d1Queries), kvOperations: String(settings.quotas.kvOperations), durableObjectRequests: String(settings.quotas.durableObjectRequests) })
    setDomainSuffix(settings.pluginDomainSuffix)
  }, [settings])
  const toggleMaintenance = async () => {
    if (!settings) {
      onAction('warning', t('settings.maintenance.notConnected'))
      return
    }
    setSaving(true)
    try {
      onSettingsChange(await updatePlatformSettings({ ...settings, maintenance: !maintenance }))
      onAction('success', !maintenance ? t('settings.maintenance.enter') : t('settings.maintenance.resume'))
    } catch {
      onAction('error', t('settings.maintenance.updateFailed'))
    } finally {
      setSaving(false)
    }
  }
  const saveDomainSuffix = async () => {
    if (!settings) return onAction('warning', t('settings.domainSuffix.notConnected'))
    if (!domainSuffix.trim()) return onAction('warning', t('settings.domainSuffix.invalid'))
    setSuffixSaving(true)
    try {
      const next = await updatePlatformSettings({ ...settings, pluginDomainSuffix: domainSuffix.trim() })
      onSettingsChange(next)
      setDomainSuffix(next.pluginDomainSuffix)
      onAction('success', t('settings.domainSuffix.saved'))
    } catch (error) {
      onAction(error instanceof ApiError && error.status === 400 ? 'warning' : 'error', error instanceof ApiError && error.status === 400 ? t('settings.domainSuffix.invalid') : t('settings.domainSuffix.saveFailed'))
    } finally {
      setSuffixSaving(false)
    }
  }
  const saveQuotas = async () => {
    if (!settings) return onAction('warning', t('settings.quotas.notConnected'))
    const quotas = Object.fromEntries(Object.entries(quotaForm).map(([key, value]) => [key, Number(value)])) as PlatformSettings['quotas']
    if (Object.values(quotas).some((value) => !Number.isSafeInteger(value) || value <= 0)) {
      onAction('warning', t('settings.quotas.invalid'))
      return
    }
    setQuotaSaving(true)
    try {
      onSettingsChange(await updatePlatformSettings({ ...settings, quotas }))
      onAction('success', t('settings.quotas.saved'))
    } catch {
      onAction('error', t('settings.quotas.saveFailed'))
    } finally {
      setQuotaSaving(false)
    }
  }
  const updateQuota = (key: keyof typeof quotaForm, value: string) => setQuotaForm((current) => ({ ...current, [key]: value }))
  const goToSection = (section: string) => {
    setActiveSection(section)
    document.getElementById(`settings-${section}`)?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
  }
  return <div className="settings-layout"><nav className="settings-nav" aria-label={t('pages.settings.title')}>{sectionNav.map(({ id, label, icon: Icon }) => <button key={id} className={activeSection === id ? 'selected' : ''} onClick={() => goToSection(id)} aria-current={activeSection === id ? 'page' : undefined}><Icon size={15} />{label}</button>)}</nav><div className="settings-content">{isSuperAdmin && <CloudflarePanel settings={cloudflareSettings} onSettingsChange={onCloudflareChange} oauth={oauthSettings} onOauthChange={onOauthChange} diagnosis={cloudflareDiagnosis} onDismissDiagnosis={onDismissCloudflareDiagnosis} apiLive={apiLive} onAction={onAction} />}{isSuperAdmin && <div id="settings-oauth"><OauthPanel settings={oauthSettings} onChange={onOauthChange} onAction={onAction} /></div>}{canManageInvites && <div id="settings-invites"><InvitePanel invites={invites} onChange={onInvitesChange} onAction={onAction} isSuperAdmin={isSuperAdmin} activeWorkspaceId={activeWorkspaceId} workspaces={workspaces} /></div>}{isSuperAdmin && <div id="settings-smtp"><SmtpPanel settings={smtpSettings} onChange={onSmtpChange} onAction={onAction} /></div>}{isSuperAdmin && <div id="settings-maintenance" className="panel settings-panel"><div className="settings-heading"><div className="settings-icon"><ShieldCheck size={18} /></div><div><h2>{t('settings.maintenance.title')}</h2><p>{settings ? t('settings.maintenance.description') : t('settings.maintenance.descriptionOffline')}</p></div><StatusBadge tone={maintenance ? 'warning' : settings ? 'success' : 'neutral'}>{maintenance ? t('settings.maintenance.on') : settings ? t('settings.maintenance.off') : t('settings.maintenance.unknown')}</StatusBadge></div><div className="maintenance-row"><div><strong>{settings ? (maintenance ? t('settings.maintenance.pause') : t('settings.maintenance.allow')) : t('settings.maintenance.unknownTitle')}</strong><span>{settings ? (maintenance ? t('settings.maintenance.pauseBody') : t('settings.maintenance.allowBody')) : t('settings.maintenance.unknownBody')}</span></div><button type="button" className={`toggle ${settings && !maintenance ? 'on' : ''}`} aria-label={t('settings.maintenance.title')} aria-pressed={Boolean(settings && !maintenance)} disabled={saving || !settings} onClick={toggleMaintenance}><span /></button></div><div className="quota-form domain-form"><div className="form-grid"><label>{t('settings.domainSuffix.label')}<input value={domainSuffix} onChange={(event) => setDomainSuffix(event.target.value)} placeholder="plugins.example.com" disabled={!settings || suffixSaving} /></label></div><div className="settings-actions quota-actions"><span className="form-hint">{t('settings.domainSuffix.hint')}</span><button className="button secondary" onClick={() => void saveDomainSuffix()} disabled={!settings || suffixSaving || quotaSaving}>{suffixSaving ? t('common.saving') : t('settings.domainSuffix.save')}<Check size={14} /></button></div></div><div className="quota-form"><div className="form-grid"><label>{t('settings.quotas.requests')}<input type="number" min="1" step="1" value={quotaForm.requests} onChange={(event) => updateQuota('requests', event.target.value)} disabled={!settings || quotaSaving} /></label><label>{t('settings.quotas.connections')}<input type="number" min="1" step="1" value={quotaForm.activeConnections} onChange={(event) => updateQuota('activeConnections', event.target.value)} disabled={!settings || quotaSaving} /></label><label>{t('settings.quotas.r2Bytes')}<input type="number" min="1" step="1" value={quotaForm.r2Bytes} onChange={(event) => updateQuota('r2Bytes', event.target.value)} disabled={!settings || quotaSaving} /></label><label>{t('settings.quotas.r2Objects')}<input type="number" min="1" step="1" value={quotaForm.r2Objects} onChange={(event) => updateQuota('r2Objects', event.target.value)} disabled={!settings || quotaSaving} /></label><label>{t('settings.quotas.d1')}<input type="number" min="1" step="1" value={quotaForm.d1Queries} onChange={(event) => updateQuota('d1Queries', event.target.value)} disabled={!settings || quotaSaving} /></label><label>{t('settings.quotas.kv')}<input type="number" min="1" step="1" value={quotaForm.kvOperations} onChange={(event) => updateQuota('kvOperations', event.target.value)} disabled={!settings || quotaSaving} /></label><label>{t('settings.quotas.durableObjects')}<input type="number" min="1" step="1" value={quotaForm.durableObjectRequests} onChange={(event) => updateQuota('durableObjectRequests', event.target.value)} disabled={!settings || quotaSaving} /></label></div><div className="settings-actions quota-actions"><span className="form-hint">{t('settings.quotas.hint')}</span><button className="button secondary" onClick={() => void saveQuotas()} disabled={!settings || quotaSaving || suffixSaving}>{quotaSaving ? t('common.saving') : t('settings.quotas.save')}<Check size={14} /></button></div></div></div>}</div></div>
}
