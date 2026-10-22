import { useTranslation } from 'react-i18next'
import { Button } from 'antd'
import type { OauthSettings } from '../../api'
import { StatusBadge } from '../../components/StatusBadge'
import type { Notify } from '../../components/ToastProvider'
import { CloudflareClientFields } from './CloudflareClientFields'
import { CloudflareProtocolFields } from './CloudflareProtocolFields'
import { CloudflareScopeList } from './CloudflareScopeList'
import { oauthSourceLabel, oauthSourceTone } from './oauth-source'
import { useCloudflareClientForm } from './useCloudflareClientForm'

interface Props {
  oauth: OauthSettings | null
  onOauthChange: (settings: OauthSettings) => void
  redirect: string
  onAction: Notify
}

/** Cloudflare「OAuth 客户端」区：客户端凭据、只读协议参数、固定权限清单与保存/重置。 */
export function CloudflareClientSection({ oauth, onOauthChange, redirect, onAction }: Props) {
  const { t } = useTranslation()
  const { client, saving, setClient, saveClient, resetClient } = useCloudflareClientForm(oauth, redirect, onOauthChange, onAction)
  const protocol = oauth?.cloudflare

  return <div className="oauth-block">
    <div className="oauth-block-heading">
      <div><h3>{t('settings.cloudflare.clientTitle')}</h3><p>{t('settings.cloudflare.clientDescription')}</p></div>
      <StatusBadge tone={oauthSourceTone(protocol?.source ?? null)}>{oauthSourceLabel(protocol?.source ?? null, t)}</StatusBadge>
    </div>
    <CloudflareClientFields
      oauth={oauth}
      redirect={redirect}
      client={client}
      disabled={saving !== null}
      onChange={(clientId) => setClient((current) => ({ ...current, clientId }))}
      onSecretChange={(clientSecret) => setClient((current) => ({ ...current, clientSecret }))}
    />
    <CloudflareProtocolFields protocol={protocol} />
    <CloudflareScopeList scopes={protocol?.scopeNames} />
    <div className="settings-actions">
      <Button type="primary" onClick={() => void saveClient()} loading={saving === 'save'} disabled={!oauth || saving !== null}>{t('settings.oauth.save')}</Button>
      {protocol?.source === 'database' && <Button onClick={resetClient} disabled={saving !== null}>{t('settings.oauth.reset')}</Button>}
      <a className="field-link" href="https://developers.cloudflare.com/fundamentals/api/get-started/oauth/" target="_blank" rel="noreferrer">{t('settings.cloudflare.docs')}</a>
    </div>
  </div>
}
