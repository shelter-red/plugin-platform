import { strict as assert } from 'node:assert'
import { oauthSettingsApi } from './src/oauth-settings.ts'
import { decryptSecret } from './src/secrets.ts'
import type { AuthenticatedUser, Env } from './src/types.ts'

const admin: AuthenticatedUser = { id: 'admin-1', github_id: '1', email: 'admin@example.test', display_name: 'Admin', role: 'super_admin' }
const member: AuthenticatedUser = { id: 'member-1', github_id: '2', email: 'member@example.test', display_name: 'Member', role: 'member' }
const secret = 'oauth-settings-smoke-secret'
const protocol = { responseType: 'code', grantType: 'authorization_code', tokenAuthMethod: 'client_secret_basic', pkce: false }

function createEnvironment(withCloudflare: boolean) {
  let stored: { ciphertext: string; iv: string; updated_at: string } | null = null
  const audits: string[] = []
  const database = {
    prepare(sql: string) {
      let values: unknown[] = []
      const query = {
        bind: (...next: unknown[]) => {
          values = next
          return query
        },
        first: async <T>() => (sql.includes('FROM oauth_settings') ? stored as T : null as T),
        run: async () => {
          if (sql.startsWith('INSERT INTO oauth_settings')) stored = { ciphertext: String(values[1]), iv: String(values[2]), updated_at: String(values[3]) }
          if (sql.startsWith('DELETE FROM oauth_settings')) stored = null
          if (sql.includes('INSERT INTO audit_log')) audits.push(String(values[2]))
          return { meta: { changes: 1 } }
        },
      }
      return query
    },
  }
  const env = {
    DB: database,
    SESSION_SECRET: secret,
    ...(withCloudflare ? {
      CLOUDFLARE_OAUTH_CLIENT_ID: 'cf-client-id',
      CLOUDFLARE_OAUTH_CLIENT_SECRET: 'cf-client-secret',
      CLOUDFLARE_OAUTH_REDIRECT_URI: 'https://console.example.test/auth/cloudflare/callback',
      CLOUDFLARE_OAUTH_SCOPE: 'workers-platform.read',
    } : {}),
  } as unknown as Env
  return { env, audits, readStored: () => stored }
}

const request = (method: string, body?: unknown) => new Request('https://console.example.test/api/settings/oauth', { method, body: body === undefined ? undefined : JSON.stringify(body) })

{
  // 未配置时也必须输出只读协议参数，前端才能展示实际握手方式。
  const { env } = createEnvironment(false)
  const response = await oauthSettingsApi(request('GET'), env, admin)
  assert.equal(response.status, 200)
  const body = await response.json() as { cloudflare: Record<string, unknown> }
  assert.equal(body.cloudflare.configured, false)
  assert.deepEqual({ responseType: body.cloudflare.responseType, grantType: body.cloudflare.grantType, tokenAuthMethod: body.cloudflare.tokenAuthMethod, pkce: body.cloudflare.pkce }, protocol)
}

{
  const { env } = createEnvironment(true)
  const response = await oauthSettingsApi(request('GET'), env, admin)
  const body = await response.json() as { cloudflare: Record<string, unknown> }
  assert.equal(body.cloudflare.configured, true)
  assert.equal(body.cloudflare.clientId, 'cf-client-id')
  assert.equal(body.cloudflare.scope, 'workers-platform.read')
  assert.equal(body.cloudflare.secretConfigured, true)
  assert.equal(body.cloudflare.source, 'environment')
  assert.deepEqual({ responseType: body.cloudflare.responseType, grantType: body.cloudflare.grantType, tokenAuthMethod: body.cloudflare.tokenAuthMethod, pkce: body.cloudflare.pkce }, protocol)

  const forbidden = await oauthSettingsApi(request('GET'), env, member)
  assert.equal(forbidden.status, 403)
}

{
  // 空 Secret 回退已存/环境密钥，保存后协议字段仍只读输出。
  const { env, audits, readStored } = createEnvironment(true)
  const response = await oauthSettingsApi(request('PUT', { cloudflare: { clientId: 'cf-client-2', clientSecret: '', redirectUri: 'https://console.example.test/auth/cloudflare/callback', scope: 'workers-platform.read workers-platform.write' } }), env, admin)
  assert.equal(response.status, 200)
  const body = await response.json() as { cloudflare: Record<string, unknown> }
  assert.equal(body.cloudflare.clientId, 'cf-client-2')
  assert.equal(body.cloudflare.scope, 'workers-platform.read workers-platform.write')
  assert.equal(body.cloudflare.source, 'database')
  assert.deepEqual({ responseType: body.cloudflare.responseType, grantType: body.cloudflare.grantType, tokenAuthMethod: body.cloudflare.tokenAuthMethod, pkce: body.cloudflare.pkce }, protocol)
  const stored = JSON.parse(await decryptSecret(secret, readStored()!.ciphertext, readStored()!.iv)) as { cloudflare: { clientSecret: string } }
  assert.equal(stored.cloudflare.clientSecret, 'cf-client-secret')
  assert.deepEqual(audits, ['oauth.settings.updated'])
}

{
  // 回调地址无效时拒绝保存，避免授权必然失败。
  const { env } = createEnvironment(true)
  const response = await oauthSettingsApi(request('PUT', { cloudflare: { clientId: 'cf-client-3', clientSecret: 'x', redirectUri: 'not-a-url', scope: '' } }), env, admin)
  assert.equal(response.status, 400)
}

console.log('OAuth settings smoke test passed')
