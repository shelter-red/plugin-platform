import { Input, InputNumber, Select } from 'antd'
import { useTranslation } from 'react-i18next'
import type { SmtpAuthType } from '../../api'
import { AUTH_TYPES, type SmtpForm } from './smtp-form'

type UpdateField = <K extends keyof SmtpForm>(key: K, value: SmtpForm[K]) => void

/** 连接参数：只渲染 .field，外层仍是同一个 .form-grid，网格列数不变。 */
export function SmtpServerFields({ form, update, disabled, configured }: {
  form: SmtpForm
  update: UpdateField
  disabled: boolean
  configured: boolean
}) {
  const { t } = useTranslation()
  return <>
    <div className="field">
      <span className="field-label">{t('settings.smtp.host')}</span>
      <Input value={form.host} aria-label={t('settings.smtp.host')} onChange={(event) => update('host', event.target.value)} placeholder="smtp.example.com" disabled={disabled} />
    </div>
    <div className="field">
      <span className="field-label">{t('settings.smtp.port')}</span>
      <InputNumber value={form.port} aria-label={t('settings.smtp.port')} min={1} max={65535} onChange={(value) => update('port', value)} disabled={disabled} />
    </div>
    <div className="field">
      <span className="field-label">{t('settings.smtp.username')}</span>
      <Input value={form.username} aria-label={t('settings.smtp.username')} onChange={(event) => update('username', event.target.value)} disabled={disabled} />
    </div>
    <div className="field">
      <span className="field-label">{t('settings.smtp.password')}</span>
      <Input.Password value={form.password} aria-label={t('settings.smtp.password')} onChange={(event) => update('password', event.target.value)} placeholder={configured ? t('settings.smtp.passwordPlaceholder') : t('settings.smtp.passwordPlaceholderNew')} disabled={disabled} />
    </div>
    <div className="field">
      <span className="field-label">{t('settings.smtp.authType')}</span>
      <Select<SmtpAuthType> value={form.authType} aria-label={t('settings.smtp.authType')} onChange={(value) => update('authType', value)} options={AUTH_TYPES.map((value) => ({ value, label: value.toUpperCase() }))} disabled={disabled} />
    </div>
  </>
}
