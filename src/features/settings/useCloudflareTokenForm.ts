import { useState } from 'react'
import { App } from 'antd'
import { useTranslation } from 'react-i18next'
import { ApiError, revokeCloudflareSettings, updateCloudflareSettings, type CloudflareSettings } from '../../api'
import type { Notify } from '../../components/ToastProvider'

export interface CloudflareRequestFailure {
  status?: number
  code?: string
  message: string
}

function requestFailure(error: unknown, fallback: string): CloudflareRequestFailure {
  if (error instanceof ApiError) return { status: error.status, code: error.code, message: error.message }
  if (error instanceof Error && error.message) return { message: error.message }
  return { message: fallback }
}

export function useCloudflareTokenForm(settings: CloudflareSettings | null, onChange: (settings: CloudflareSettings) => void, onAction: Notify) {
  const { t } = useTranslation()
  const modalApi = App.useApp().modal
  const [apiToken, setApiToken] = useState('')
  const [accountId, setAccountId] = useState('')
  const [saving, setSaving] = useState(false)
  const [revoking, setRevoking] = useState(false)
  const [failure, setFailure] = useState<CloudflareRequestFailure | null>(null)

  const saveToken = async () => {
    const token = apiToken.trim()
    if (!token) {
      setFailure({ code: 'token_required', message: t('settings.cloudflare.tokenRequired') })
      return
    }
    setSaving(true)
    setFailure(null)
    try {
      const next = await updateCloudflareSettings({ apiToken: token, ...(accountId.trim() ? { accountId: accountId.trim() } : {}) })
      onChange(next)
      setApiToken('')
      setAccountId('')
      onAction('success', t('settings.cloudflare.tokenSaved'))
    } catch (error) {
      setFailure(requestFailure(error, t('settings.cloudflare.tokenSaveFailed')))
    } finally {
      setSaving(false)
    }
  }

  const revokeToken = () => {
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
          setApiToken('')
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

  return { apiToken, accountId, saving, revoking, failure, setApiToken, setAccountId, saveToken, revokeToken }
}
