import { Alert, Switch } from 'antd'
import { Mail } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SmtpSettings } from '../../api'
import { Panel } from '../../components/Panel'
import { StatusBadge } from '../../components/StatusBadge'
import type { Notify } from '../../components/ToastProvider'
import { SmtpActions } from './SmtpActions'
import { SmtpSenderFields } from './SmtpSenderFields'
import { SmtpServerFields } from './SmtpServerFields'
import { useSmtpSettingsForm } from './useSmtpSettingsForm'

/** SMTP 面板只做排版：表单状态与请求在 useSmtpSettingsForm，字段与操作各自成组件。 */
export function SmtpPanel({ settings, onChange, onAction }: { settings: SmtpSettings | null; onChange: (settings: SmtpSettings) => void; onAction: Notify }) {
  const { t } = useTranslation()
  const { form, update, saving, testing, testError, canSave, save, test } = useSmtpSettingsForm({ settings, onChange, onAction })
  const disabled = !settings

  return <Panel className="settings-panel" padded heading={
    <div className="settings-heading">
      <div className="settings-icon"><Mail size={18} /></div>
      <div><h2>{t('settings.smtp.title')}</h2><p>{settings ? t('settings.smtp.description') : t('settings.smtp.descriptionUnavailable')}</p></div>
      <StatusBadge tone={settings?.configured ? 'success' : 'neutral'}>{settings?.configured ? t('settings.smtp.configured') : settings ? t('settings.smtp.notConfigured') : t('settings.smtp.unknown')}</StatusBadge>
    </div>
  }>
    <div className="form-grid">
      <SmtpServerFields form={form} update={update} disabled={disabled} configured={Boolean(settings?.configured)} />
      <SmtpSenderFields form={form} update={update} disabled={disabled} />
    </div>
    <div className="smtp-options">
      <label className="check-row"><Switch size="small" checked={form.secure} onChange={(checked) => update('secure', checked)} disabled={disabled} />{t('settings.smtp.secure')}</label>
      <span className="form-hint">{t('settings.smtp.hint')}</span>
    </div>
    {testError && <Alert className="smtp-error" type="error" showIcon message={testError} />}
    <SmtpActions testTo={form.testTo} onTestToChange={(value) => update('testTo', value)} onTest={() => void test()} onSave={() => void save()} testing={testing} saving={saving} canSave={canSave} disabled={disabled} />
    {settings && !canSave && !saving && <span className="field-hint smtp-save-hint">{t('settings.smtp.testFirst')}</span>}
  </Panel>
}
