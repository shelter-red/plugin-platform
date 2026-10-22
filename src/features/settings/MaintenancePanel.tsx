import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Input, Switch } from 'antd'
import { Check, ShieldCheck } from 'lucide-react'
import { ApiError, updatePlatformSettings, type CloudflareQuotas, type PlatformQuotas, type PlatformSettings } from '../../api'
import { Panel } from '../../components/Panel'
import { StatusBadge } from '../../components/StatusBadge'
import type { Notify } from '../../components/ToastProvider'
import { QuotaForm } from './QuotaForm'

// 平台阈值的字段顺序与文案；与 Cloudflare 免费额度分开，避免把官方限额当成平台自设值。
const PLATFORM_QUOTA_FIELDS = [
  ['activeConnections', 'settings.quotas.connections'],
  ['r2Bytes', 'settings.quotas.r2Bytes'],
  ['r2Objects', 'settings.quotas.r2Objects'],
] as const

// Cloudflare 免费计划每日额度：D1 按行读写、KV 按每种操作、DO 按请求数逐项监控。
const CLOUDFLARE_QUOTA_FIELDS = [
  ['workerRequests', 'settings.cloudflareQuotas.workerRequests'],
  ['d1RowsRead', 'settings.cloudflareQuotas.d1RowsRead'],
  ['d1RowsWritten', 'settings.cloudflareQuotas.d1RowsWritten'],
  ['kvRead', 'settings.cloudflareQuotas.kvRead'],
  ['kvWrite', 'settings.cloudflareQuotas.kvWrite'],
  ['kvDelete', 'settings.cloudflareQuotas.kvDelete'],
  ['kvList', 'settings.cloudflareQuotas.kvList'],
  ['doRequests', 'settings.cloudflareQuotas.doRequests'],
] as const

const EMPTY_PLATFORM_FORM: Record<keyof PlatformQuotas, string> = { activeConnections: '', r2Bytes: '', r2Objects: '' }
const EMPTY_CLOUDFLARE_FORM: Record<keyof CloudflareQuotas, string> = { workerRequests: '', d1RowsRead: '', d1RowsWritten: '', kvRead: '', kvWrite: '', kvDelete: '', kvList: '', doRequests: '' }

/** 维护开关、插件域名后缀与两组阈值：都写同一个平台设置接口，因此放在一起维护。 */
export function MaintenancePanel({ settings, onChange, onAction }: {
  settings: PlatformSettings | null
  onChange: (settings: PlatformSettings) => void
  onAction: Notify
}) {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  const [quotaSaving, setQuotaSaving] = useState(false)
  const [suffixSaving, setSuffixSaving] = useState(false)
  const [quotaForm, setQuotaForm] = useState(EMPTY_PLATFORM_FORM)
  const [cloudflareForm, setCloudflareForm] = useState(EMPTY_CLOUDFLARE_FORM)
  const [domainSuffix, setDomainSuffix] = useState('')
  const maintenance = settings?.maintenance ?? false

  useEffect(() => {
    if (!settings) return
    setQuotaForm({ activeConnections: String(settings.quotas.activeConnections), r2Bytes: String(settings.quotas.r2Bytes), r2Objects: String(settings.quotas.r2Objects) })
    setCloudflareForm({
      workerRequests: String(settings.cloudflareQuotas.workerRequests),
      d1RowsRead: String(settings.cloudflareQuotas.d1RowsRead),
      d1RowsWritten: String(settings.cloudflareQuotas.d1RowsWritten),
      kvRead: String(settings.cloudflareQuotas.kvRead),
      kvWrite: String(settings.cloudflareQuotas.kvWrite),
      kvDelete: String(settings.cloudflareQuotas.kvDelete),
      kvList: String(settings.cloudflareQuotas.kvList),
      doRequests: String(settings.cloudflareQuotas.doRequests),
    })
    setDomainSuffix(settings.pluginDomainSuffix)
  }, [settings])

  const toggleMaintenance = async () => {
    if (!settings) {
      onAction('warning', t('settings.maintenance.notConnected'))
      return
    }
    setSaving(true)
    try {
      onChange(await updatePlatformSettings({ ...settings, maintenance: !maintenance }))
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
      onChange(next)
      setDomainSuffix(next.pluginDomainSuffix)
      onAction('success', t('settings.domainSuffix.saved'))
    } catch (error) {
      const invalid = error instanceof ApiError && error.status === 400
      onAction(invalid ? 'warning' : 'error', invalid ? t('settings.domainSuffix.invalid') : t('settings.domainSuffix.saveFailed'))
    } finally {
      setSuffixSaving(false)
    }
  }

  const saveQuotas = async () => {
    if (!settings) return onAction('warning', t('settings.quotas.notConnected'))
    const quotas: PlatformQuotas = {
      activeConnections: Number(quotaForm.activeConnections),
      r2Bytes: Number(quotaForm.r2Bytes),
      r2Objects: Number(quotaForm.r2Objects),
    }
    const cloudflareQuotas: CloudflareQuotas = {
      workerRequests: Number(cloudflareForm.workerRequests),
      d1RowsRead: Number(cloudflareForm.d1RowsRead),
      d1RowsWritten: Number(cloudflareForm.d1RowsWritten),
      kvRead: Number(cloudflareForm.kvRead),
      kvWrite: Number(cloudflareForm.kvWrite),
      kvDelete: Number(cloudflareForm.kvDelete),
      kvList: Number(cloudflareForm.kvList),
      doRequests: Number(cloudflareForm.doRequests),
    }
    if ([...Object.values(quotas), ...Object.values(cloudflareQuotas)].some((value) => !Number.isSafeInteger(value) || value <= 0)) {
      onAction('warning', t('settings.quotas.invalid'))
      return
    }
    setQuotaSaving(true)
    try {
      onChange(await updatePlatformSettings({ ...settings, quotas, cloudflareQuotas }))
      onAction('success', t('settings.quotas.saved'))
    } catch {
      onAction('error', t('settings.quotas.saveFailed'))
    } finally {
      setQuotaSaving(false)
    }
  }

  return <Panel id="settings-maintenance" className="settings-panel" padded heading={
    <div className="settings-heading">
      <div className="settings-icon"><ShieldCheck size={18} /></div>
      <div><h2>{t('settings.maintenance.title')}</h2><p>{settings ? t('settings.maintenance.description') : t('settings.maintenance.descriptionOffline')}</p></div>
      <StatusBadge tone={maintenance ? 'warning' : settings ? 'success' : 'neutral'}>{maintenance ? t('settings.maintenance.on') : settings ? t('settings.maintenance.off') : t('settings.maintenance.unknown')}</StatusBadge>
    </div>
  }>
    <div className="maintenance-row">
      <div><strong>{settings ? (maintenance ? t('settings.maintenance.pause') : t('settings.maintenance.allow')) : t('settings.maintenance.unknownTitle')}</strong><span>{settings ? (maintenance ? t('settings.maintenance.pauseBody') : t('settings.maintenance.allowBody')) : t('settings.maintenance.unknownBody')}</span></div>
      <Switch className="toggle" aria-label={t('settings.maintenance.title')} checked={Boolean(settings && !maintenance)} disabled={saving || !settings} loading={saving} onChange={() => void toggleMaintenance()} />
    </div>
    <div className="quota-form domain-form">
      <div className="form-grid"><label>{t('settings.domainSuffix.label')}<Input value={domainSuffix} onChange={(event) => setDomainSuffix(event.target.value)} placeholder="plugins.example.com" disabled={!settings || suffixSaving} /></label></div>
      <div className="settings-actions quota-actions"><span className="form-hint">{t('settings.domainSuffix.hint')}</span><Button onClick={() => void saveDomainSuffix()} loading={suffixSaving} disabled={!settings || quotaSaving}>{t('settings.domainSuffix.save')}<Check size={14} /></Button></div>
    </div>
    <QuotaForm title={t('settings.quotas.platformTitle')} hint={t('settings.quotas.platformHint')} fields={PLATFORM_QUOTA_FIELDS} values={quotaForm} onChange={(key, value) => setQuotaForm((current) => ({ ...current, [key]: value }))} onSave={() => void saveQuotas()} saving={quotaSaving} disabled={!settings || suffixSaving || quotaSaving} />
    <QuotaForm title={t('settings.quotas.cloudflareTitle')} hint={t('settings.quotas.cloudflareHint')} fields={CLOUDFLARE_QUOTA_FIELDS} values={cloudflareForm} onChange={(key, value) => setCloudflareForm((current) => ({ ...current, [key]: value }))} onSave={() => void saveQuotas()} saving={quotaSaving} disabled={!settings || suffixSaving || quotaSaving} />
  </Panel>
}
