import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, updatePlatformSettings, type PlatformQuotas, type PlatformSettings } from '../../api'
import type { Notify } from '../../components/ToastProvider'

export const PLATFORM_QUOTA_FIELDS = [
  ['activeConnections', 'settings.quotas.connections'],
  ['r2Bytes', 'settings.quotas.r2Bytes'],
  ['r2Objects', 'settings.quotas.r2Objects'],
] as const

type PlatformQuotaForm = Record<keyof PlatformQuotas, string>

const EMPTY_PLATFORM_FORM: PlatformQuotaForm = { activeConnections: '', r2Bytes: '', r2Objects: '' }

/** 维护、域名后缀和平台自身阈值的本地表单；Cloudflare 官方额度只读，不在这里保存。 */
export function useMaintenanceSettings(settings: PlatformSettings | null, onChange: (settings: PlatformSettings) => void, onAction: Notify) {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  const [quotaSaving, setQuotaSaving] = useState(false)
  const [suffixSaving, setSuffixSaving] = useState(false)
  const [quotaForm, setQuotaForm] = useState(EMPTY_PLATFORM_FORM)
  const [domainSuffix, setDomainSuffix] = useState('')
  const maintenance = settings?.maintenance ?? false

  useEffect(() => {
    if (!settings) return
    setQuotaForm({
      activeConnections: String(settings.quotas.activeConnections),
      r2Bytes: String(settings.quotas.r2Bytes),
      r2Objects: String(settings.quotas.r2Objects),
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
      onAction(invalid ? 'warning' : 'error', invalid ? t('settings.domainSuffix.invalid') : error instanceof ApiError ? error.message : t('settings.domainSuffix.saveFailed'))
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

  return {
    maintenance, saving, quotaSaving, suffixSaving,
    quotaForm, domainSuffix,
    setQuotaForm, setDomainSuffix,
    toggleMaintenance, saveDomainSuffix, saveQuotas,
  }
}
