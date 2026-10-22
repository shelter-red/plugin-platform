import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Input, Switch } from 'antd'
import { Check, ShieldCheck } from 'lucide-react'
import { ApiError, updatePlatformSettings, type PlatformSettings } from '../../api'
import { Panel } from '../../components/Panel'
import { StatusBadge } from '../../components/StatusBadge'
import type { Notify } from '../../components/ToastProvider'

const QUOTA_FIELDS = [
  ['requests', 'settings.quotas.requests'],
  ['activeConnections', 'settings.quotas.connections'],
  ['r2Bytes', 'settings.quotas.r2Bytes'],
  ['r2Objects', 'settings.quotas.r2Objects'],
  ['d1Queries', 'settings.quotas.d1'],
  ['kvOperations', 'settings.quotas.kv'],
  ['durableObjectRequests', 'settings.quotas.durableObjects'],
] as const

/** 维护开关、插件域名后缀与总配额：三项都写同一个平台设置接口，因此放在一起维护。 */
export function MaintenancePanel({ settings, onChange, onAction }: {
  settings: PlatformSettings | null
  onChange: (settings: PlatformSettings) => void
  onAction: Notify
}) {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  const [quotaSaving, setQuotaSaving] = useState(false)
  const [suffixSaving, setSuffixSaving] = useState(false)
  const [quotaForm, setQuotaForm] = useState({ requests: '', activeConnections: '', r2Bytes: '', r2Objects: '', d1Queries: '', kvOperations: '', durableObjectRequests: '' })
  const [domainSuffix, setDomainSuffix] = useState('')
  const maintenance = settings?.maintenance ?? false

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
    const quotas = Object.fromEntries(Object.entries(quotaForm).map(([key, value]) => [key, Number(value)])) as PlatformSettings['quotas']
    if (Object.values(quotas).some((value) => !Number.isSafeInteger(value) || value <= 0)) {
      onAction('warning', t('settings.quotas.invalid'))
      return
    }
    setQuotaSaving(true)
    try {
      onChange(await updatePlatformSettings({ ...settings, quotas }))
      onAction('success', t('settings.quotas.saved'))
    } catch {
      onAction('error', t('settings.quotas.saveFailed'))
    } finally {
      setQuotaSaving(false)
    }
  }

  const updateQuota = (key: keyof typeof quotaForm, value: string) => setQuotaForm((current) => ({ ...current, [key]: value }))

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
    <div className="quota-form">
      <div className="form-grid">{QUOTA_FIELDS.map(([key, labelKey]) => <label key={key}>{t(labelKey)}<Input type="number" min={1} step={1} value={quotaForm[key]} onChange={(event) => updateQuota(key, event.target.value)} disabled={!settings || quotaSaving} /></label>)}</div>
      <div className="settings-actions quota-actions"><span className="form-hint">{t('settings.quotas.hint')}</span><Button onClick={() => void saveQuotas()} loading={quotaSaving} disabled={!settings || suffixSaving}>{t('settings.quotas.save')}<Check size={14} /></Button></div>
    </div>
  </Panel>
}
