import { decryptSecret } from './secrets'
import type { Env } from './types'

export interface CloudflareCredential {
  accessToken: string
  refreshToken?: string | null
  tokenType?: string | null
  accountId?: string | null
  expiresAt?: string | null
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  token_type?: string
  expires_in?: number
  account_id?: string
  accountId?: string
}

function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`
}

export async function exchangeCloudflareCode(env: Env, code: string): Promise<CloudflareCredential | null> {
  if (!env.CLOUDFLARE_OAUTH_CLIENT_ID || !env.CLOUDFLARE_OAUTH_CLIENT_SECRET || !env.CLOUDFLARE_OAUTH_REDIRECT_URI) return null
  const response = await fetch('https://dash.cloudflare.com/oauth2/token', {
    method: 'POST',
    headers: {
      authorization: basicAuth(env.CLOUDFLARE_OAUTH_CLIENT_ID, env.CLOUDFLARE_OAUTH_CLIENT_SECRET),
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: env.CLOUDFLARE_OAUTH_REDIRECT_URI }).toString(),
  })
  if (!response.ok) return null
  const payload = await response.json().catch(() => null) as TokenResponse | null
  if (!payload?.access_token) return null
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    tokenType: payload.token_type ?? 'Bearer',
    accountId: payload.account_id ?? payload.accountId ?? null,
    expiresAt: typeof payload.expires_in === 'number' ? new Date(Date.now() + payload.expires_in * 1000).toISOString() : null,
  }
}

export async function refreshCloudflareCredential(env: Env, credential: CloudflareCredential): Promise<CloudflareCredential | null> {
  if (!env.CLOUDFLARE_OAUTH_CLIENT_ID || !env.CLOUDFLARE_OAUTH_CLIENT_SECRET || !credential.refreshToken) return null
  const response = await fetch('https://dash.cloudflare.com/oauth2/token', {
    method: 'POST',
    headers: {
      authorization: basicAuth(env.CLOUDFLARE_OAUTH_CLIENT_ID, env.CLOUDFLARE_OAUTH_CLIENT_SECRET),
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: credential.refreshToken }).toString(),
  })
  if (!response.ok) return null
  const payload = await response.json().catch(() => null) as TokenResponse | null
  if (!payload?.access_token) return null
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? credential.refreshToken,
    tokenType: payload.token_type ?? credential.tokenType ?? 'Bearer',
    accountId: payload.account_id ?? payload.accountId ?? credential.accountId ?? null,
    expiresAt: typeof payload.expires_in === 'number' ? new Date(Date.now() + payload.expires_in * 1000).toISOString() : null,
  }
}

export async function discoverCloudflareAccountId(accessToken: string): Promise<string | null> {
  const response = await fetch('https://api.cloudflare.com/client/v4/accounts?per_page=2', { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' } })
  if (!response.ok) return null
  const payload = await response.json().catch(() => null) as { result?: Array<{ id?: string }> } | null
  const accounts = payload?.result?.filter((account): account is { id: string } => Boolean(account.id)) ?? []
  return accounts.length === 1 ? accounts[0].id : null
}

export async function revokeCloudflareToken(env: Env, accessToken: string): Promise<void> {
  if (!env.CLOUDFLARE_OAUTH_CLIENT_ID || !env.CLOUDFLARE_OAUTH_CLIENT_SECRET) return
  await fetch('https://dash.cloudflare.com/oauth2/revoke', {
    method: 'POST',
    headers: {
      authorization: basicAuth(env.CLOUDFLARE_OAUTH_CLIENT_ID, env.CLOUDFLARE_OAUTH_CLIENT_SECRET),
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ token: accessToken, token_type_hint: 'access_token' }).toString(),
  }).catch(() => undefined)
}

export async function readCloudflareCredential(env: Env, ciphertext: string, iv: string): Promise<CloudflareCredential | null> {
  if (!env.SESSION_SECRET) return null
  try {
    const value = JSON.parse(await decryptSecret(env.SESSION_SECRET, ciphertext, iv)) as Partial<CloudflareCredential>
    if (typeof value.accessToken !== 'string' || !value.accessToken) return null
    return { accessToken: value.accessToken, refreshToken: value.refreshToken ?? null, tokenType: value.tokenType ?? 'Bearer', accountId: value.accountId ?? null, expiresAt: value.expiresAt ?? null }
  } catch {
    return null
  }
}
