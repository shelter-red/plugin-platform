import { useTranslation } from 'react-i18next'
import type { CloudflareQuotas, PlatformQuotas } from '../../api'
import { QuotaForm } from './QuotaForm'
import { CLOUDFLARE_QUOTA_FIELDS, PLATFORM_QUOTA_FIELDS } from './useMaintenanceSettings'

type PlatformQuotaForm = Record<keyof PlatformQuotas, string>
type CloudflareQuotaForm = Record<keyof CloudflareQuotas, string>

export function QuotaSettings({ platformValues, cloudflareValues, saving, disabled, onPlatformChange, onCloudflareChange, onSave }: {
  platformValues: PlatformQuotaForm
  cloudflareValues: CloudflareQuotaForm
  saving: boolean
  disabled: boolean
  onPlatformChange: (key: keyof PlatformQuotas, value: string) => void
  onCloudflareChange: (key: keyof CloudflareQuotas, value: string) => void
  onSave: () => void
}) {
  const { t } = useTranslation()
  return <>
    <QuotaForm title={t('settings.quotas.platformTitle')} hint={t('settings.quotas.platformHint')} fields={PLATFORM_QUOTA_FIELDS} values={platformValues} onChange={onPlatformChange} onSave={onSave} saving={saving} disabled={disabled} />
    <QuotaForm title={t('settings.quotas.cloudflareTitle')} hint={t('settings.quotas.cloudflareHint')} fields={CLOUDFLARE_QUOTA_FIELDS} values={cloudflareValues} onChange={onCloudflareChange} onSave={onSave} saving={saving} disabled={disabled} />
  </>
}
