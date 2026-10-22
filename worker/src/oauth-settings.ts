import { decryptSecret, encryptSecret } from './secrets'
import type { AuthenticatedUser, Env } from './types'

export interface GithubOAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  allowlist: string[]
}

export interface StoredOauthSettings {
  github: GithubOAuthConfig | null
}

export type OauthSource = 'database' | 'environment'

export interface ResolvedOauthSettings {
  github: GithubOAuthConfig | null
  sources: { github: OauthSource | null }
  updatedAt: string | null
  unreadable: boolean
}

type StoredRow = { ciphertext: string; iv: string; updated_at: string } | null

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/** GitHub 公网回调只接受 HTTPS，本地开发保留 HTTP。 */
export function normalizeOauthRedirectUri(value: string): string {
  if (!isHttpUrl(value)) return value
  const url = new URL(value)
  if (url.protocol === 'http:' && !LOCAL_HOSTS.has(url.hostname)) url.protocol = 'https:'
  return url.toString()
}

export function parseAllowlist(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\s,;]+/) : []
  return entries
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 200)
}

export function parseGithubOAuthConfig(value: unknown, fallbackSecret = ''): GithubOAuthConfig | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const clientId = typeof record.clientId === 'string' ? record.clientId.trim() : ''
  const submittedSecret = typeof record.clientSecret === 'string' ? record.clientSecret.trim() : ''
  const clientSecret = submittedSecret || fallbackSecret
  const redirectUri = normalizeOauthRedirectUri(typeof record.redirectUri === 'string' ? record.redirectUri.trim() : '')
  if (!clientId || !clientSecret || !isHttpUrl(redirectUri)) return null
  return { clientId, clientSecret, redirectUri, allowlist: parseAllowlist(record.allowlist) }
}

export function environmentGithubConfig(env: Env): GithubOAuthConfig | null {
  const clientId = env.GITHUB_CLIENT_ID?.trim() ?? ''
  const clientSecret = env.GITHUB_CLIENT_SECRET?.trim() ?? ''
  const redirectUri = normalizeOauthRedirectUri(env.GITHUB_REDIRECT_URI?.trim() ?? '')
  if (!clientId || !clientSecret || !isHttpUrl(redirectUri)) return null
  return { clientId, clientSecret, redirectUri, allowlist: parseAllowlist(env.GITHUB_ALLOWLIST) }
}

async function readStoredOauthSettings(env: Env): Promise<{ settings: StoredOauthSettings | null; updatedAt: string | null; unreadable: boolean }> {
  const row = await env.DB.prepare('SELECT ciphertext, iv, updated_at FROM oauth_settings WHERE id = ?').bind('primary').first<StoredRow>()
  if (!row) return { settings: null, updatedAt: null, unreadable: false }
  if (!env.SESSION_SECRET) return { settings: null, updatedAt: row.updated_at, unreadable: true }
  try {
    const raw = JSON.parse(await decryptSecret(env.SESSION_SECRET, row.ciphertext, row.iv)) as Record<string, unknown>
    // 旧密文可能还包含 cloudflare 字段；Cloudflare 已改用 API Token，读取时直接忽略。
    return {
      settings: { github: parseGithubOAuthConfig(raw.github) },
      updatedAt: row.updated_at,
      unreadable: false,
    }
  } catch {
    return { settings: null, updatedAt: row.updated_at, unreadable: true }
  }
}

export async function resolveOauthSettings(env: Env): Promise<ResolvedOauthSettings> {
  const stored = await readStoredOauthSettings(env)
  const github = stored.settings?.github ?? environmentGithubConfig(env)
  return {
    github,
    sources: { github: stored.settings?.github ? 'database' : github ? 'environment' : null },
    updatedAt: stored.updatedAt,
    unreadable: stored.unreadable,
  }
}

async function saveStoredOauthSettings(env: Env, settings: StoredOauthSettings): Promise<string> {
  if (!env.SESSION_SECRET) throw new Error('SESSION_SECRET is not configured')
  const sealed = await encryptSecret(env.SESSION_SECRET, JSON.stringify(settings))
  const updatedAt = new Date().toISOString()
  await env.DB.prepare('INSERT INTO oauth_settings (id, ciphertext, iv, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, updated_at = excluded.updated_at').bind('primary', sealed.ciphertext, sealed.iv, updatedAt).run()
  return updatedAt
}

function publicGithub(config: GithubOAuthConfig | null, source: OauthSource | null) {
  if (!config) return { configured: false, clientId: null, redirectUri: null, allowlist: '', secretConfigured: false, source: null }
  return { configured: true, clientId: config.clientId, redirectUri: config.redirectUri, allowlist: config.allowlist.join(', '), secretConfigured: true, source }
}

async function publicSettings(env: Env) {
  const resolved = await resolveOauthSettings(env)
  return {
    github: publicGithub(resolved.github, resolved.sources.github),
    sessionSecretConfigured: Boolean(env.SESSION_SECRET),
    updatedAt: resolved.updatedAt,
    unreadable: resolved.unreadable,
  }
}

export async function saveGithubOAuthSettings(env: Env, github: GithubOAuthConfig): Promise<string> {
  if (!env.SESSION_SECRET) throw new Error('SESSION_SECRET is not configured')
  const stored = await readStoredOauthSettings(env)
  if (stored.unreadable) throw new Error('Stored OAuth settings cannot be decrypted')
  return saveStoredOauthSettings(env, { github })
}

export async function oauthSettingsApi(request: Request, env: Env, user: AuthenticatedUser): Promise<Response> {
  if (user.role !== 'super_admin') return json({ error: 'Forbidden' }, 403)
  if (request.method === 'GET') return json(await publicSettings(env))
  if (request.method === 'DELETE') {
    const provider = new URL(request.url).searchParams.get('provider')
    if (provider !== 'github' && provider !== 'all') {
      return json({ error: 'provider 必须是 github 或 all' }, 400)
    }
    await env.DB.prepare('DELETE FROM oauth_settings WHERE id = ?').bind('primary').run()
    await env.DB.prepare('INSERT INTO audit_log (id, workspace_id, user_id, action, detail_json, created_at) VALUES (?, NULL, ?, ?, ?, ?)').bind(crypto.randomUUID(), user.id, 'oauth.settings.revoked', JSON.stringify({ provider }), new Date().toISOString()).run()
    return json(await publicSettings(env))
  }
  if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, 405)
  if (!env.SESSION_SECRET) return json({ error: 'SESSION_SECRET is not configured' }, 503)
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid OAuth settings' }, 400)
  if (Object.hasOwn(body, 'cloudflare')) return json({ error: 'Cloudflare 已改用 API Token，不再接受 OAuth 配置' }, 400)
  if (!Object.hasOwn(body, 'github')) return json({ error: '请提交 GitHub OAuth 配置' }, 400)
  const stored = await readStoredOauthSettings(env)
  if (stored.unreadable) return json({ error: 'Stored OAuth settings cannot be decrypted' }, 409)
  const github = parseGithubOAuthConfig(body.github, stored.settings?.github?.clientSecret ?? environmentGithubConfig(env)?.clientSecret ?? '')
  if (!github) return json({ error: 'GitHub OAuth 配置不完整或回调地址无效' }, 400)
  const updatedAt = await saveStoredOauthSettings(env, { github })
  await env.DB.prepare('INSERT INTO audit_log (id, workspace_id, user_id, action, detail_json, created_at) VALUES (?, NULL, ?, ?, ?, ?)').bind(crypto.randomUUID(), user.id, 'oauth.settings.updated', JSON.stringify({ providers: ['github'], githubClientId: github.clientId }), updatedAt).run()
  return json(await publicSettings(env))
}
