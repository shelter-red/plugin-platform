import { useTranslation } from 'react-i18next'
import { Button, Input } from 'antd'
import { Check } from 'lucide-react'

// 平台自身数值阈值表单；Cloudflare 免费额度只读，不经过这里编辑。
export function QuotaForm<K extends string>({ title, hint, fields, values, onChange, onSave, saving, disabled }: {
  title: string
  hint: string
  fields: ReadonlyArray<readonly [K, string]>
  values: Record<K, string>
  onChange: (key: K, value: string) => void
  onSave: () => void
  saving: boolean
  disabled: boolean
}) {
  const { t } = useTranslation()
  return <div className="quota-form">
    <h3 className="quota-form-title">{title}</h3>
    <div className="form-grid">{fields.map(([key, labelKey]) => <label key={key}>{t(labelKey)}<Input type="number" min={1} step={1} value={values[key]} onChange={(event) => onChange(key, event.target.value)} disabled={disabled} /></label>)}</div>
    <div className="settings-actions quota-actions"><span className="form-hint">{hint}</span><Button onClick={onSave} loading={saving} disabled={disabled}>{t('settings.quotas.save')}<Check size={14} /></Button></div>
  </div>
}
