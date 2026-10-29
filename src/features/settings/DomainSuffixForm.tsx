import { useTranslation } from 'react-i18next'
import { Button, Input, Popconfirm } from 'antd'
import { Check, Trash2 } from 'lucide-react'

export function DomainSuffixForm({ enabled, value, saving, disabled, canReset, onChange, onSave, onReset }: {
  enabled: boolean
  value: string
  saving: boolean
  disabled: boolean
  canReset: boolean
  onChange: (value: string) => void
  onSave: () => void
  onReset: () => void
}) {
  const { t } = useTranslation()
  return <div className="quota-form domain-form">
    <div className="form-grid"><label>{t('settings.domainSuffix.label')}<Input value={value} onChange={(event) => onChange(event.target.value)} placeholder="plugins.example.com" disabled={!enabled || saving} /></label></div>
    <div className="settings-actions quota-actions"><span className="form-hint">{t('settings.domainSuffix.hint')}</span><div className="settings-button-row">
      <Popconfirm title={t('settings.domainSuffix.resetConfirm')} okText={t('settings.domainSuffix.resetAction')} cancelText={t('common.cancel')} onConfirm={onReset}>
        <Button danger icon={<Trash2 size={14} />} disabled={!enabled || disabled || !canReset}>{t('settings.domainSuffix.reset')}</Button>
      </Popconfirm>
      <Button onClick={onSave} loading={saving} disabled={!enabled || disabled}>{t('settings.domainSuffix.save')}<Check size={14} /></Button>
    </div></div>
  </div>
}
