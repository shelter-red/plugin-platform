import { Alert, Button, Input, InputNumber, Select, Switch } from 'antd'
import { ArrowUpRight, Check, Mail } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, sendSmtpTest, updateSmtpSettings, type SmtpAuthType, type SmtpSettings, type SmtpSettingsInput } from '../../api'
import { StatusBadge } from '../../components/StatusBadge'
import type { Notify } from '../../components/ToastProvider'
import { errorMessage } from '../../errors'

interface SmtpForm {
  host: string
  port: number | null
  secure: boolean
  username: string
  password: string
  authType: SmtpAuthType
  from: string
  fromName: string
  replyTo: string
  testTo: string
}

const AUTH_TYPES: SmtpAuthType[] = ['plain', 'login', 'cram-md5']

const emptyForm: SmtpForm = { host: '', port: 587, secure: false, username: '', password: '', authType: 'plain', from: '', fromName: '', replyTo: '', testTo: '' }

const toPayload = (form: SmtpForm): SmtpSettingsInput => ({
  host: form.host.trim(),
  port: form.port ?? 0,
  secure: form.secure,
  username: form.username.trim(),
  password: form.password,
  authType: form.authType,
  from: form.from.trim(),
  fromName: form.fromName.trim(),
  replyTo: form.replyTo.trim(),
})

/** 当前表单值的指纹：任一字段改动都会让上一次成功的测试失效。 */
const signatureOf = (form: SmtpForm) => JSON.stringify(toPayload(form))

export function SmtpPanel({ settings, onChange, onAction }: { settings: SmtpSettings | null; onChange: (settings: SmtpSettings) => void; onAction: Notify }) {
  const { t } = useTranslation()
  const [form, setForm] = useState<SmtpForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testedSignature, setTestedSignature] = useState<string | null>(null)
  const [testError, setTestError] = useState<string | null>(null)

  useEffect(() => {
    setForm((current) => ({
      ...current,
      host: settings?.host ?? '',
      port: settings?.port ?? 587,
      secure: settings?.secure ?? false,
      username: settings?.username ?? '',
      authType: settings?.authType ?? 'plain',
      from: settings?.from ?? '',
      fromName: settings?.fromName ?? '',
      replyTo: settings?.replyTo ?? '',
    }))
  }, [settings])

  const update = <K extends keyof SmtpForm>(key: K, value: SmtpForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
    setTestError(null)
  }

  const describeError = (error: unknown, fallbackKey: string) => {
    if (error instanceof ApiError && error.field) {
      return error.field === 'password'
        ? t('settings.smtp.passwordRequired')
        : t('settings.smtp.fieldInvalid', { field: t(`settings.smtp.${error.field}`) })
    }
    return errorMessage(error, fallbackKey)
  }

  const save = async () => {
    if (!settings) return onAction('warning', t('settings.smtp.notConnectedSave'))
    setSaving(true)
    try {
      onChange(await updateSmtpSettings(toPayload(form)))
      const cleared = { ...form, password: '' }
      setForm(cleared)
      setTestedSignature(signatureOf(cleared))
      setTestError(null)
      onAction('success', t('settings.smtp.saved'))
    } catch (error) {
      onAction('error', describeError(error, 'settings.smtp.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    if (!settings) return onAction('warning', t('settings.smtp.notConnectedTest'))
    if (!form.testTo.trim()) return onAction('warning', t('settings.smtp.testRecipientRequired'))
    const signature = signatureOf(form)
    setTesting(true)
    setTestError(null)
    try {
      await sendSmtpTest(form.testTo.trim(), toPayload(form))
      setTestedSignature(signature)
      onAction('success', t('settings.smtp.sent'))
    } catch (error) {
      const message = describeError(error, 'settings.smtp.sendFailed')
      setTestedSignature(null)
      setTestError(message)
      onAction('error', message)
    } finally {
      setTesting(false)
    }
  }

  const canSave = Boolean(settings) && !saving && !testing && testedSignature === signatureOf(form)

  return <div className="panel settings-panel">
    <div className="settings-heading">
      <div className="settings-icon"><Mail size={18} /></div>
      <div><h2>{t('settings.smtp.title')}</h2><p>{settings ? t('settings.smtp.description') : t('settings.smtp.descriptionUnavailable')}</p></div>
      <StatusBadge tone={settings?.configured ? 'success' : 'neutral'}>{settings?.configured ? t('settings.smtp.configured') : settings ? t('settings.smtp.notConfigured') : t('settings.smtp.unknown')}</StatusBadge>
    </div>
    <div className="form-grid">
      <div className="field">
        <span className="field-label">{t('settings.smtp.host')}</span>
        <Input value={form.host} aria-label={t('settings.smtp.host')} onChange={(event) => update('host', event.target.value)} placeholder="smtp.example.com" disabled={!settings} />
      </div>
      <div className="field">
        <span className="field-label">{t('settings.smtp.port')}</span>
        <InputNumber value={form.port} aria-label={t('settings.smtp.port')} min={1} max={65535} onChange={(value) => update('port', value)} disabled={!settings} />
      </div>
      <div className="field">
        <span className="field-label">{t('settings.smtp.username')}</span>
        <Input value={form.username} aria-label={t('settings.smtp.username')} onChange={(event) => update('username', event.target.value)} disabled={!settings} />
      </div>
      <div className="field">
        <span className="field-label">{t('settings.smtp.password')}</span>
        <Input.Password value={form.password} aria-label={t('settings.smtp.password')} onChange={(event) => update('password', event.target.value)} placeholder={settings?.configured ? t('settings.smtp.passwordPlaceholder') : t('settings.smtp.passwordPlaceholderNew')} disabled={!settings} />
      </div>
      <div className="field">
        <span className="field-label">{t('settings.smtp.authType')}</span>
        <Select<SmtpAuthType> value={form.authType} aria-label={t('settings.smtp.authType')} onChange={(value) => update('authType', value)} options={AUTH_TYPES.map((value) => ({ value, label: value.toUpperCase() }))} disabled={!settings} />
      </div>
      <div className="field">
        <span className="field-label">{t('settings.smtp.from')}</span>
        <Input value={form.from} aria-label={t('settings.smtp.from')} onChange={(event) => update('from', event.target.value)} placeholder="noreply@example.com" disabled={!settings} />
      </div>
      <div className="field">
        <span className="field-label">{t('settings.smtp.fromName')}</span>
        <Input value={form.fromName} aria-label={t('settings.smtp.fromName')} onChange={(event) => update('fromName', event.target.value)} disabled={!settings} />
      </div>
      <div className="field">
        <span className="field-label">{t('settings.smtp.replyTo')}</span>
        <Input value={form.replyTo} aria-label={t('settings.smtp.replyTo')} onChange={(event) => update('replyTo', event.target.value)} disabled={!settings} />
      </div>
    </div>
    <div className="smtp-options">
      <label className="check-row"><Switch size="small" checked={form.secure} onChange={(checked) => update('secure', checked)} disabled={!settings} />{t('settings.smtp.secure')}</label>
      <span className="form-hint">{t('settings.smtp.hint')}</span>
    </div>
    {testError && <Alert className="smtp-error" type="error" showIcon message={testError} />}
    <div className="settings-actions">
      <div className="smtp-test">
        <Input value={form.testTo} aria-label={t('settings.smtp.testPlaceholder')} onChange={(event) => update('testTo', event.target.value)} placeholder={t('settings.smtp.testPlaceholder')} disabled={!settings} />
        <Button onClick={() => void test()} disabled={testing || !settings} loading={testing}>{testing ? t('common.sending') : t('settings.smtp.sendTest')}<ArrowUpRight size={14} /></Button>
      </div>
      <Button type="primary" onClick={() => void save()} disabled={!canSave}>{saving ? t('common.saving') : t('settings.smtp.save')}<Check size={14} /></Button>
    </div>
    {settings && !canSave && !saving && <span className="field-hint smtp-save-hint">{t('settings.smtp.testFirst')}</span>}
  </div>
}
