import { useTranslation } from 'react-i18next'
import { Button, Input } from 'antd'
import { Check } from 'lucide-react'

export function DomainSuffixForm({ enabled, value, saving, disabled, onChange, onSave }: {
  enabled: boolean
  value: string
  saving: boolean
  disabled: boolean
  onChange: (value: string) => void
  onSave: () => void
}) {
  const { t } = useTranslation()
  return <div className="quota-form domain-form">
    <div className="form-grid"><label>{t('settings.domainSuffix.label')}<Input value={value} onChange={(event) => onChange(event.target.value)} placeholder="plugins.example.com" disabled={!enabled || saving} /></label></div>
    <div className="settings-actions quota-actions"><span className="form-hint">{t('settings.domainSuffix.hint')}</span><Button onClick={onSave} loading={saving} disabled={!enabled || disabled}>{t('settings.domainSuffix.save')}<Check size={14} /></Button></div>
  </div>
}
