import { Input } from 'antd'
import { useTranslation } from 'react-i18next'
import type { SmtpForm } from './smtp-form'

type UpdateField = <K extends keyof SmtpForm>(key: K, value: SmtpForm[K]) => void

/** 发件身份：与连接参数同处一个 .form-grid，因此这里只返回字段。 */
export function SmtpSenderFields({ form, update, disabled }: { form: SmtpForm; update: UpdateField; disabled: boolean }) {
  const { t } = useTranslation()
  return <>
    <div className="field">
      <span className="field-label">{t('settings.smtp.from')}</span>
      <Input value={form.from} aria-label={t('settings.smtp.from')} onChange={(event) => update('from', event.target.value)} placeholder="noreply@example.com" disabled={disabled} />
    </div>
    <div className="field">
      <span className="field-label">{t('settings.smtp.fromName')}</span>
      <Input value={form.fromName} aria-label={t('settings.smtp.fromName')} onChange={(event) => update('fromName', event.target.value)} disabled={disabled} />
    </div>
    <div className="field">
      <span className="field-label">{t('settings.smtp.replyTo')}</span>
      <Input value={form.replyTo} aria-label={t('settings.smtp.replyTo')} onChange={(event) => update('replyTo', event.target.value)} disabled={disabled} />
    </div>
  </>
}
