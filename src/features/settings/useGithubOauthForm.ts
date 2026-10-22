import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { App } from 'antd'
import { revokeOauthSettings, updateOauthSettings, type OauthSettings } from '../../api'
import type { Notify } from '../../components/ToastProvider'

const splitList = (value: string) => value.split(/[\s,;]+/).map((entry) => entry.trim()).filter(Boolean)

export interface GithubOauthForm {
  clientId: string
  clientSecret: string
  allowlist: string[]
}

/** GitHub OAuth 客户端：表单回填、保存与撤销都收在这里，面板只做排版。 */
export function useGithubOauthForm({ settings, onChange, onAction }: {
  settings: OauthSettings | null
  onChange: (settings: OauthSettings) => void
  onAction: Notify
}) {
  const { t } = useTranslation()
  const modalApi = App.useApp().modal
  const [github, setGithub] = useState<GithubOauthForm>({ clientId: '', clientSecret: '', allowlist: [] })
  const [saving, setSaving] = useState(false)
  // 回调地址由当前访问域名推导，页面不提供手填。
  const redirect = `${window.location.origin}/auth/github/callback`

  useEffect(() => {
    if (!settings) return
    setGithub({ clientId: settings.github.clientId ?? '', clientSecret: '', allowlist: splitList(settings.github.allowlist) })
  }, [settings])

  const patch = <K extends keyof GithubOauthForm>(key: K, value: GithubOauthForm[K]) => setGithub((current) => ({ ...current, [key]: value }))

  const save = async () => {
    if (!settings) return onAction('warning', t('settings.oauth.notConnected'))
    setSaving(true)
    try {
      onChange(await updateOauthSettings({ github: { clientId: github.clientId, clientSecret: github.clientSecret, redirectUri: redirect, allowlist: github.allowlist.join(', ') } }))
      setGithub((current) => ({ ...current, clientSecret: '' }))
      onAction('success', t('settings.oauth.saved'))
    } catch {
      onAction('error', t('settings.oauth.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const reset = () => {
    modalApi.confirm({
      title: t('settings.oauth.reset'),
      content: t('settings.oauth.resetConfirm', { provider: t('settings.oauth.githubTitle') }),
      okText: t('settings.oauth.reset'),
      okButtonProps: { danger: true },
      onOk: async () => {
        setSaving(true)
        try {
          onChange(await revokeOauthSettings('github'))
          onAction('success', t('settings.oauth.resetDone'))
        } catch {
          onAction('error', t('settings.oauth.resetFailed'))
        } finally {
          setSaving(false)
        }
      },
    })
  }

  return { github, patch, saving, redirect, save, reset }
}
