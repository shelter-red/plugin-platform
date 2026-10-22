import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { App } from 'antd'
import { revokeOauthSettings, updateOauthSettings, type OauthSettings } from '../../api'
import type { Notify } from '../../components/ToastProvider'

/** Cloudflare OAuth 客户端凭据的本地状态，以及保存/撤销后的父级同步。 */
export function useCloudflareClientForm(oauth: OauthSettings | null, redirect: string, onOauthChange: (settings: OauthSettings) => void, onAction: Notify) {
  const { t } = useTranslation()
  const modalApi = App.useApp().modal
  const [client, setClient] = useState({ clientId: '', clientSecret: '' })
  const [saving, setSaving] = useState<'save' | 'reset' | null>(null)

  useEffect(() => {
    if (!oauth) return
    setClient({ clientId: oauth.cloudflare.clientId ?? '', clientSecret: '' })
  }, [oauth])

  const saveClient = async () => {
    if (!oauth) {
      onAction('warning', t('settings.oauth.notConnected'))
      return
    }
    setSaving('save')
    try {
      // 授权范围由平台固定，界面不提交 scope；Worker 也会忽略来源里的 scope 字段。
      onOauthChange(await updateOauthSettings({ cloudflare: { clientId: client.clientId, clientSecret: client.clientSecret, redirectUri: redirect } }))
      setClient((current) => ({ ...current, clientSecret: '' }))
      onAction('success', t('settings.cloudflare.clientSaved'))
    } catch {
      onAction('error', t('settings.cloudflare.clientSaveFailed'))
    } finally {
      setSaving(null)
    }
  }

  const resetClient = () => {
    modalApi.confirm({
      title: t('settings.oauth.resetConfirm', { provider: t('settings.cloudflare.clientTitle') }),
      okText: t('settings.oauth.reset'),
      okButtonProps: { danger: true },
      onOk: async () => {
        setSaving('reset')
        try {
          onOauthChange(await revokeOauthSettings('cloudflare'))
          onAction('success', t('settings.oauth.resetDone'))
        } catch {
          onAction('error', t('settings.oauth.resetFailed'))
        } finally {
          setSaving(null)
        }
      },
    })
  }

  return { client, saving, setClient, saveClient, resetClient }
}
