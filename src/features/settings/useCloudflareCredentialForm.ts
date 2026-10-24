import { useEffect, useState } from 'react'
import { App } from 'antd'
import { useTranslation } from 'react-i18next'
import { ApiError, revokeCloudflareSettings, updateCloudflareSettings, type CloudflareSettings } from '../../api'
import type { Notify } from '../../components/ToastProvider'

export interface CloudflareRequestFailure {
  status?: number
  code?: string
  message: string
  accounts?: Array<{ id: string; name: string }>
}

function requestFailure(error: unknown, fallback: string): CloudflareRequestFailure {
  if (error instanceof ApiError) return { status: error.status, code: error.code, message: error.message, accounts: error.accounts }
  if (error instanceof Error && error.message) return { message: error.message }
  return { message: fallback }
}

export function useCloudflareCredentialForm(settings: CloudflareSettings | null, onChange: (settings: CloudflareSettings) => void, onAction: Notify) {
  const { t } = useTranslation()
  const modalApi = App.useApp().modal
  const [email, setEmail] = useState('')
  const [globalApiKey, setGlobalApiKey] = useState('')
  const [accountId, setAccountId] = useState('')
  const [saving, setSaving] = useState(false)
  const [revoking, setRevoking] = useState(false)
  const [failure, setFailure] = useState<CloudflareRequestFailure | null>(null)

  useEffect(() => {
    if (settings?.email) setEmail((current) => current || settings.email || '')
  }, [settings?.email])

  const saveCredential = async () => {
    const nextEmail = email.trim()
    const key = globalApiKey.trim()
    if (!nextEmail || !key) {
      setFailure({ code: 'credential_required', message: t('settings.cloudflare.credentialRequired') })
      return
    }
    setSaving(true)
    setFailure(null)
    try {
      const next = await updateCloudflareSettings({ email: nextEmail, globalApiKey: key, ...(accountId.trim() ? { accountId: accountId.trim() } : {}) })
      onChange(next)
      setGlobalApiKey('')
      setAccountId('')
      onAction('success', t('settings.cloudflare.credentialSaved'))
    } catch (error) {
      const nextFailure = requestFailure(error, t('settings.cloudflare.credentialSaveFailed'))
      setFailure(nextFailure)
    } finally {
      setSaving(false)
    }
  }

  const revokeCredential = () => {
    if (!settings?.configured) return
    modalApi.confirm({
      title: t('settings.cloudflare.revokeConfirm'),
      okText: t('settings.cloudflare.revoke'),
      okButtonProps: { danger: true },
      onOk: async () => {
        setRevoking(true)
        setFailure(null)
        try {
          onChange(await revokeCloudflareSettings())
          setGlobalApiKey('')
          setEmail('')
          setAccountId('')
          onAction('success', t('settings.cloudflare.revoked'))
        } catch (error) {
          setFailure(requestFailure(error, t('settings.cloudflare.revokeFailed')))
        } finally {
          setRevoking(false)
        }
      },
    })
  }

  return { email, globalApiKey, accountId, saving, revoking, failure, setEmail, setGlobalApiKey, setAccountId, saveCredential, revokeCredential }
}
