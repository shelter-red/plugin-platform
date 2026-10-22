import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, updatePlatformSettings, type CloudflareQuotas, type PlatformQuotas, type PlatformSettings } from '../../api'
import type { Notify } from '../../components/ToastProvider'

export const PLATFORM_QUOTA_FIELDS = [
  ['activeConnections', 'settings.quotas.connections'],
  ['r2Bytes', 'settings.quotas.r2Bytes'],
  ['r2Objects', 'settings.quotas.r2Objects'],
] as const

export const CLOUDFLARE_QUOTA_FIELDS = [
  ['workerRequests', 'settings.cloudflareQuotas.workerRequests'],
  ['d1RowsRead', 'settings.cloudflareQuotas.d1RowsRead'],
  ['d1RowsWritten', 'settings.cloudflareQuotas.d1RowsWritten'],
  ['kvRead', 'settings.cloudflareQuotas.kvRead'],
  ['kvWrite', 'settings.cloudflareQuotas.kvWrite'],
  ['kvDelete', 'settings.cloudflareQuotas.kvDelete'],
  ['kvList', 'settings.cloudflareQuotas.kvList'],
  ['doRequests', 'settings.cloudflareQuotas.doRequests'],
] as const

type PlatformQuotaForm = Record<keyof PlatformQuotas, string>
type CloudflareQuotaForm = Record<keyof CloudflareQuotas, string>

const EMPTY_PLATFORM_FORM: PlatformQuotaForm = { activeConnections: '', r2Bytes: '', r2Objects: '' }
const EMPTY_CLOUDFLARE_FORM: CloudflareQuotaForm = { workerRequests: '', d1RowsRead: '', d1RowsWritten: '', kvRead: '', kvWrite: '', kvDelete: '', kvList: '', doRequests: '' }

/** 维护、域名后缀和两组阈值的本地表单与保存动作；所有写操作仍共用平台设置接口。 */
export function useMaintenanceSettings(settings: PlatformSettings | null, onChange: (settings: PlatformSettings) => void, onAction: Notify) {
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
    setQuotaForm({
      activeConnections: String(settings.quotas.activeConnections),
      r2Bytes: String(settings.quotas.r2Bytes),
      r2Objects: String(settings.quotas.r2Objects),
    })
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
    if (!settings) {
      onAction('warning', t('settings.domainSuffix.notConnected'))
      return
    }
    if (!domainSuffix.trim()) {
      onAction('warning', t('settings.domainSuffix.invalid'))
      return
    }
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
    if (!settings) {
      onAction('warning', t('settings.quotas.notConnected'))
      return
    }
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

  return {
    maintenance, saving, quotaSaving, suffixSaving,
    quotaForm, cloudflareForm, domainSuffix,
    setQuotaForm, setCloudflareForm, setDomainSuffix,
    toggleMaintenance, saveDomainSuffix, saveQuotas,
  }
}
