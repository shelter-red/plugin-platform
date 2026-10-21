import { decryptSecret, encryptSecret } from './secrets'
import type { AuthenticatedUser, Env } from './types'

export const DEFAULT_CLOUDFLARE_SCOPE = 'workers-platform.read workers-platform.write'

export interface GithubOAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  allowlist: string[]
}

export interface CloudflareOAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  scope: string
}

export interface StoredOauthSettings {
  github: GithubOAuthConfig | null
  cloudflare: CloudflareOAuthConfig | null
}

export type OauthSource = 'database' | 'environment'

export interface ResolvedOauthSettings {
  github: GithubOAuthConfig | null
  cloudflare: CloudflareOAuthConfig | null
  sources: { github: OauthSource | null; cloudflare: OauthSource | null }
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
  const redirectUri = typeof record.redirectUri === 'string' ? record.redirectUri.trim() : ''
  if (!clientId || !clientSecret || !isHttpUrl(redirectUri)) return null
  return { clientId, clientSecret, redirectUri, allowlist: parseAllowlist(record.allowlist) }
}

export function parseCloudflareOAuthConfig(value: unknown, fallbackSecret = ''): CloudflareOAuthConfig | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const clientId = typeof record.clientId === 'string' ? record.clientId.trim() : ''
  const submittedSecret = typeof record.clientSecret === 'string' ? record.clientSecret.trim() : ''
  const clientSecret = submittedSecret || fallbackSecret
  const redirectUri = typeof record.redirectUri === 'string' ? record.redirectUri.trim() : ''
  const scope = typeof record.scope === 'string' && record.scope.trim() ? record.scope.trim() : DEFAULT_CLOUDFLARE_SCOPE
  if (!clientId || !clientSecret || !isHttpUrl(redirectUri)) return null
  return { clientId, clientSecret, redirectUri, scope }
}

export function environmentGithubConfig(env: Env): GithubOAuthConfig | null {
  const clientId = env.GITHUB_CLIENT_ID?.trim() ?? ''
  const clientSecret = env.GITHUB_CLIENT_SECRET?.trim() ?? ''
  const redirectUri = env.GITHUB_REDIRECT_URI?.trim() ?? ''
  if (!clientId || !clientSecret || !isHttpUrl(redirectUri)) return null
  return { clientId, clientSecret, redirectUri, allowlist: parseAllowlist(env.GITHUB_ALLOWLIST) }
}

export function environmentCloudflareConfig(env: Env): CloudflareOAuthConfig | null {
  const clientId = env.CLOUDFLARE_OAUTH_CLIENT_ID?.trim() ?? ''
  const clientSecret = env.CLOUDFLARE_OAUTH_CLIENT_SECRET?.trim() ?? ''
  const redirectUri = env.CLOUDFLARE_OAUTH_REDIRECT_URI?.trim() ?? ''
  if (!clientId || !clientSecret || !isHttpUrl(redirectUri)) return null
  return { clientId, clientSecret, redirectUri, scope: env.CLOUDFLARE_OAUTH_SCOPE?.trim() || DEFAULT_CLOUDFLARE_SCOPE }
}

async function readStoredOauthSettings(env: Env): Promise<{ settings: StoredOauthSettings | null; updatedAt: string | null; unreadable: boolean }> {
  const row = await env.DB.prepare('SELECT ciphertext, iv, updated_at FROM oauth_settings WHERE id = ?').bind('primary').first<StoredRow>()
  if (!row) return { settings: null, updatedAt: null, unreadable: false }
  if (!env.SESSION_SECRET) return { settings: null, updatedAt: row.updated_at, unreadable: true }
  try {
    const raw = JSON.parse(await decryptSecret(env.SESSION_SECRET, row.ciphertext, row.iv)) as Record<string, unknown>
    return {
      settings: {
        github: parseGithubOAuthConfig(raw.github),
        cloudflare: parseCloudflareOAuthConfig(raw.cloudflare),
      },
      updatedAt: row.updated_at,
      unreadable: false,
    }
  } catch {
    return { settings: null, updatedAt: row.updated_at, unreadable: true }
  }
}

export async function resolveOauthSettings(env: Env): Promise<ResolvedOauthSettings> {
  const stored = await readStoredOauthSettings(env)
  const envGithub = environmentGithubConfig(env)
  const envCloudflare = environmentCloudflareConfig(env)
  const github = stored.settings?.github ?? envGithub
  const cloudflare = stored.settings?.cloudflare ?? envCloudflare
  return {
    github,
    cloudflare,
    sources: {
      github: stored.settings?.github ? 'database' : github ? 'environment' : null,
      cloudflare: stored.settings?.cloudflare ? 'database' : cloudflare ? 'environment' : null,
    },
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

function publicCloudflare(config: CloudflareOAuthConfig | null, source: OauthSource | null) {
  if (!config) return { configured: false, clientId: null, redirectUri: null, scope: DEFAULT_CLOUDFLARE_SCOPE, secretConfigured: false, source: null }
  return { configured: true, clientId: config.clientId, redirectUri: config.redirectUri, scope: config.scope, secretConfigured: true, source }
}

async function publicSettings(env: Env) {
  const resolved = await resolveOauthSettings(env)
  return {
    github: publicGithub(resolved.github, resolved.sources.github),
    cloudflare: publicCloudflare(resolved.cloudflare, resolved.sources.cloudflare),
    sessionSecretConfigured: Boolean(env.SESSION_SECRET),
    updatedAt: resolved.updatedAt,
    unreadable: resolved.unreadable,
  }
}

export async function oauthSettingsApi(request: Request, env: Env, user: AuthenticatedUser): Promise<Response> {
  if (user.role !== 'super_admin') return json({ error: 'Forbidden' }, 403)
  if (request.method === 'GET') return json(await publicSettings(env))
  if (request.method === 'DELETE') {
    const provider = new URL(request.url).searchParams.get('provider')
    if (provider !== 'github' && provider !== 'cloudflare' && provider !== 'all') return json({ error: 'provider 必须是 github、cloudflare 或 all' }, 400)
    const stored = await readStoredOauthSettings(env)
    if (stored.settings) {
      const next: StoredOauthSettings = {
        github: provider === 'github' || provider === 'all' ? null : stored.settings.github,
        cloudflare: provider === 'cloudflare' || provider === 'all' ? null : stored.settings.cloudflare,
      }
      if (next.github || next.cloudflare) {
        await saveStoredOauthSettings(env, next)
      } else {
        await env.DB.prepare('DELETE FROM oauth_settings WHERE id = ?').bind('primary').run()
      }
    } else if (stored.unreadable) {
      await env.DB.prepare('DELETE FROM oauth_settings WHERE id = ?').bind('primary').run()
    }
    await env.DB.prepare('INSERT INTO audit_log (id, user_id, action, detail_json, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), user.id, 'oauth.settings.revoked', JSON.stringify({ provider }), new Date().toISOString()).run()
    return json(await publicSettings(env))
  }
  if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, 405)
  if (!env.SESSION_SECRET) return json({ error: 'SESSION_SECRET is not configured' }, 503)
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid OAuth settings' }, 400)
  const stored = await readStoredOauthSettings(env)
  const current = stored.settings ?? { github: null, cloudflare: null }
  const next: StoredOauthSettings = { github: current.github, cloudflare: current.cloudflare }
  const updated: string[] = []
  if (Object.hasOwn(body, 'github')) {
    const github = parseGithubOAuthConfig(body.github, next.github?.clientSecret ?? environmentGithubConfig(env)?.clientSecret ?? '')
    if (!github) return json({ error: 'GitHub OAuth 配置不完整或回调地址无效' }, 400)
    next.github = github
    updated.push('github')
  }
  if (Object.hasOwn(body, 'cloudflare')) {
    const cloudflare = parseCloudflareOAuthConfig(body.cloudflare, next.cloudflare?.clientSecret ?? environmentCloudflareConfig(env)?.clientSecret ?? '')
    if (!cloudflare) return json({ error: 'Cloudflare OAuth 配置不完整或回调地址无效' }, 400)
    next.cloudflare = cloudflare
    updated.push('cloudflare')
  }
  if (updated.length === 0) return json({ error: '至少提交 GitHub 或 Cloudflare 配置' }, 400)
  const updatedAt = await saveStoredOauthSettings(env, next)
  await env.DB.prepare('INSERT INTO audit_log (id, user_id, action, detail_json, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), user.id, 'oauth.settings.updated', JSON.stringify({ providers: updated, githubClientId: next.github?.clientId ?? null, cloudflareClientId: next.cloudflare?.clientId ?? null }), updatedAt).run()
  return json(await publicSettings(env))
}
