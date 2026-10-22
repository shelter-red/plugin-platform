import { strict as assert } from 'node:assert'
import { cloudflareSettingsApi, smtpSettingsApi } from './src/index.ts'
import { discoverCloudflareAccountId, exchangeCloudflareCode, refreshCloudflareCredential, revokeCloudflareToken } from './src/cloudflare-oauth.ts'
import { decryptSecret } from './src/secrets.ts'
import type { AuthenticatedUser, Env } from './src/types.ts'

type StoredCredential = { ciphertext: string; iv: string; updated_at: string }
type Audit = { action: string; detail: string }

const credentialToken = 'cloudflare-access-token'
const refreshedToken = 'cloudflare-refreshed-token'
const smtpPassword = 'smtp-password-that-must-stay-private'
let credential: StoredCredential | null = null
let smtp: StoredCredential | null = null
const audits: Audit[] = []

const database = {
  prepare(sql: string) {
    let values: unknown[] = []
    const query = {
      bind: (...nextValues: unknown[]) => {
        values = nextValues
        return query
      },
      first: async <T>() => {
        if (sql.includes('FROM cloudflare_credentials')) return credential as T
        if (sql.includes('FROM smtp_settings')) return smtp as T
        return null as T
      },
      run: async () => {
        if (sql.includes('INSERT INTO cloudflare_credentials')) {
          credential = { ciphertext: values[1] as string, iv: values[2] as string, updated_at: values[3] as string }
        } else if (sql.includes('INSERT INTO smtp_settings')) {
          smtp = { ciphertext: values[1] as string, iv: values[2] as string, updated_at: values[3] as string }
        } else if (sql.includes('INSERT INTO audit_log')) {
          // recordAudit 绑定 workspace_id；平台设置类审计使用字面量 NULL，参数位置不同。
          const shift = sql.includes('NULL') ? 0 : 1
          audits.push({ action: values[2 + shift] as string, detail: values[3 + shift] as string })
        }
        return { meta: { changes: 1 } }
      },
    }
    return query
  },
}

const env = {
  DB: database,
  SESSION_SECRET: 'smoke-session-secret',
  CLOUDFLARE_OAUTH_CLIENT_ID: 'client-id',
  CLOUDFLARE_OAUTH_CLIENT_SECRET: 'client-secret',
  CLOUDFLARE_OAUTH_REDIRECT_URI: 'https://console.example.test/auth/cloudflare/callback',
} as unknown as Env

const admin: AuthenticatedUser = {
  id: 'admin-1',
  github_id: 'github-admin',
  email: 'admin@example.test',
  display_name: 'Administrator',
  role: 'super_admin',
}

const originalFetch = globalThis.fetch
const requests: Array<{ url: string; init?: RequestInit }> = []
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url
  requests.push({ url, init })
  if (url.endsWith('/oauth2/token')) {
    const body = String(init?.body ?? '')
    if (body.includes('grant_type=authorization_code')) {
      return new Response(JSON.stringify({ access_token: credentialToken, refresh_token: 'cloudflare-refresh-token', token_type: 'Bearer', expires_in: 3600 }), { status: 200 })
    }
    return new Response(JSON.stringify({ access_token: refreshedToken, refresh_token: 'cloudflare-refresh-token-2', expires_in: 7200 }), { status: 200 })
  }
  if (url.includes('/client/v4/accounts')) return new Response(JSON.stringify({ result: [{ id: 'account-123' }] }), { status: 200 })
  if (url.endsWith('/oauth2/revoke')) return new Response(null, { status: 200 })
  throw new Error(`unexpected fetch: ${url}`)
}

try {
  const exchanged = await exchangeCloudflareCode(env, 'authorization-code')
  assert.equal(exchanged?.accessToken, credentialToken)
  assert.equal(exchanged?.refreshToken, 'cloudflare-refresh-token')
  assert.equal(exchanged?.tokenType, 'Bearer')
  assert.equal(exchanged?.accountId, null)
  assert.equal(typeof exchanged?.expiresAt, 'string')
  assert.ok(Date.parse(exchanged!.expiresAt!) > Date.now())
  assert.equal(requests[0].url, 'https://dash.cloudflare.com/oauth2/token')
  assert.equal(requests[0].init?.method, 'POST')
  assert.equal(requests[0].init?.headers && new Headers(requests[0].init.headers).get('authorization'), `Basic ${btoa('client-id:client-secret')}`)
  assert.match(String(requests[0].init?.body), /grant_type=authorization_code/)

  const refreshed = await refreshCloudflareCredential(env, exchanged!)
  assert.equal(refreshed?.accessToken, refreshedToken)
  assert.equal(refreshed?.refreshToken, 'cloudflare-refresh-token-2')
  assert.match(String(requests[1].init?.body), /grant_type=refresh_token/)
  assert.equal(await discoverCloudflareAccountId(refreshed!.accessToken), 'account-123')
  await revokeCloudflareToken(env, refreshed!.accessToken)
  assert.equal(requests.filter(({ url }) => url.endsWith('/oauth2/revoke')).length, 1)
  assert.match(String(requests[3].init?.body), /token=cloudflare-refreshed-token/)

  let response = await cloudflareSettingsApi(new Request('https://console.example.test/api/settings/cloudflare', {
    method: 'PUT',
    body: JSON.stringify({ accessToken: credentialToken, accountId: 'account-123' }),
    headers: { 'content-type': 'application/json' },
  }), env, admin)
  assert.equal(response.status, 200)
  let responseText = await response.text()
  assert.equal(responseText.includes(credentialToken), false)
  assert.equal(responseText.includes('account-123'), false)
  assert.equal(audits.at(-1)?.action, 'cloudflare.credentials.updated')
  assert.equal(audits.at(-1)?.detail.includes(credentialToken), false)
  assert.equal(audits.at(-1)?.detail.includes('account-123'), false)
  const storedCloudflare = JSON.parse(await decryptSecret(env.SESSION_SECRET!, credential!.ciphertext, credential!.iv)) as { accessToken: string; accountId: string }
  assert.deepEqual(storedCloudflare, { accessToken: credentialToken, accountId: 'account-123', tokenType: 'Bearer', expiresAt: null })

  response = await cloudflareSettingsApi(new Request('https://console.example.test/api/settings/cloudflare'), env, admin)
  responseText = await response.text()
  assert.equal(response.status, 200)
  assert.equal(responseText.includes(credentialToken), false)
  assert.equal(responseText.includes('account-123'), false)
  assert.match(responseText, /acco\.\.\.-123/)

  response = await smtpSettingsApi(new Request('https://console.example.test/api/settings/smtp', {
    method: 'PUT',
    body: JSON.stringify({ host: 'smtp.example.test', port: 465, secure: true, username: 'mailer', password: smtpPassword, authType: 'plain', from: 'noreply@example.test' }),
    headers: { 'content-type': 'application/json' },
  }), env, admin)
  responseText = await response.text()
  assert.equal(response.status, 200)
  assert.equal(responseText.includes(smtpPassword), false)
  assert.equal(audits.at(-1)?.action, 'smtp.settings.updated')
  assert.equal(audits.at(-1)?.detail.includes(smtpPassword), false)

  response = await smtpSettingsApi(new Request('https://console.example.test/api/settings/smtp'), env, admin)
  responseText = await response.text()
  assert.equal(response.status, 200)
  assert.equal(responseText.includes(smtpPassword), false)
  assert.match(responseText, /smtp\.example\.test/)
} finally {
  globalThis.fetch = originalFetch
}

console.log('Cloudflare OAuth credential smoke test passed')
