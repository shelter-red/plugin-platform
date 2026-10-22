import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { App } from 'antd'
import { revokeCloudflareSettings, type CloudflareSettings } from '../../api'
import type { Notify } from '../../components/ToastProvider'

export function useCloudflareAuthorization(settings: CloudflareSettings | null, onSettingsChange: (settings: CloudflareSettings) => void, onAction: Notify) {
  const { t } = useTranslation()
  const modalApi = App.useApp().modal
  const [revoking, setRevoking] = useState(false)

  const revoke = () => {
    if (!settings?.configured) return
    modalApi.confirm({
      title: t('settings.cloudflare.revokeConfirm'),
      okText: t('settings.cloudflare.revoke'),
      okButtonProps: { danger: true },
      onOk: async () => {
        setRevoking(true)
        try {
          onSettingsChange(await revokeCloudflareSettings())
          onAction('success', t('settings.cloudflare.revoked'))
        } catch {
          onAction('error', t('settings.cloudflare.revokeFailed'))
        } finally {
          setRevoking(false)
        }
      },
    })
  }

  return { revoking, revoke }
}
