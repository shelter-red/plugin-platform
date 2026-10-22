import { useTranslation } from 'react-i18next'
import type { PlatformQuotas } from '../../api'
import { QuotaForm } from './QuotaForm'
import { PLATFORM_QUOTA_FIELDS } from './useMaintenanceSettings'

type PlatformQuotaForm = Record<keyof PlatformQuotas, string>

export function QuotaSettings({ values, saving, disabled, onChange, onSave }: {
  values: PlatformQuotaForm
  saving: boolean
  disabled: boolean
  onChange: (key: keyof PlatformQuotas, value: string) => void
  onSave: () => void
}) {
  const { t } = useTranslation()
  return <QuotaForm title={t('settings.quotas.platformTitle')} hint={t('settings.quotas.platformHint')} fields={PLATFORM_QUOTA_FIELDS} values={values} onChange={onChange} onSave={onSave} saving={saving} disabled={disabled} />
}
