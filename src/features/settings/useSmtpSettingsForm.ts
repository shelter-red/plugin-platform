import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, sendSmtpTest, updateSmtpSettings, type SmtpSettings } from '../../api'
import type { Notify } from '../../components/ToastProvider'
import { errorMessage } from '../../errors'
import { emptyForm, signatureOf, toPayload, type SmtpForm } from './smtp-form'

/**
 * SMTP 表单状态与「先测试通过才允许保存」的约束集中在这里。
 * 面板只负责排版，不再自己拼请求和错误文案。
 */
export function useSmtpSettingsForm({ settings, onChange, onAction }: {
  settings: SmtpSettings | null
  onChange: (settings: SmtpSettings) => void
  onAction: Notify
}) {
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

  return {
    form,
    update,
    saving,
    testing,
    testError,
    canSave: Boolean(settings) && !saving && !testing && testedSignature === signatureOf(form),
    save,
    test,
  }
}
