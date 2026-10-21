import type { Env, PlatformQuotas, PlatformSettings } from './types'
import { decryptSecret } from './secrets'
import { parseSmtpSettings, sendMaintenanceEmail, type SmtpSettings } from './email'

export const defaultPlatformSettings: PlatformSettings = {
  maintenance: false,
  quotas: {
    requests: 100000,
    activeConnections: 100,
    r2Bytes: 10 * 1024 * 1024 * 1024,
    r2Objects: 1000,
    d1Queries: 5_000_000,
    kvOperations: 100_000,
    durableObjectRequests: 100_000,
  },
}

const usageKey = 'global'
const settingsCacheTtlMs = 30_000
let settingsCache: { value: PlatformSettings; expiresAt: number } | null = null
type MaintenanceEmailSender = (settings: SmtpSettings, to: string, reason: string) => Promise<void>

export async function getPlatformSettings(env: Env): Promise<PlatformSettings> {
  if (settingsCache && settingsCache.expiresAt > Date.now()) return settingsCache.value
  const settings = await readPlatformSettings(env)
  settingsCache = { value: settings, expiresAt: Date.now() + settingsCacheTtlMs }
  return settings
}

export async function isMaintenanceMode(env: Env): Promise<boolean> {
  return (await getPlatformSettings(env)).maintenance
}

export async function activateMaintenance(env: Env, reason = 'platform quota reached', sendEmail: MaintenanceEmailSender = sendMaintenanceEmail): Promise<void> {
  await ensurePlatformSettingsRow(env)
  const updated = await env.DB.prepare("UPDATE platform_settings SET value_json = json_set(value_json, '$.maintenance', true), updated_at = ? WHERE key = ? AND COALESCE(json_extract(value_json, '$.maintenance'), 0) != 1").bind(new Date().toISOString(), 'platform').run()
  if ((updated.meta.changes ?? 0) !== 1) {
    setPlatformSettingsCache(await readPlatformSettings(env))
    return
  }
  const next = await readPlatformSettings(env)
  setPlatformSettingsCache(next)
  await notifyMaintenance(env, reason, sendEmail)
}

async function notifyMaintenance(env: Env, reason: string, sendEmail: MaintenanceEmailSender): Promise<void> {
  if (!env.SESSION_SECRET) {
    await recordMaintenanceNotice(env, 'maintenance.email.skipped', { reason, error: 'SESSION_SECRET is not configured' })
    return
  }
  const stored = await env.DB.prepare('SELECT ciphertext, iv FROM smtp_settings WHERE id = ?').bind('primary').first<{ ciphertext: string; iv: string }>()
  const administrators = await env.DB.prepare('SELECT id, email FROM users WHERE role = ? AND email IS NOT NULL').bind('super_admin').all<{ id: string; email: string }>()
  if (!stored || administrators.results.length === 0) {
    await recordMaintenanceNotice(env, 'maintenance.email.skipped', { reason, configured: Boolean(stored), administratorCount: administrators.results.length })
    return
  }
  let settings: ReturnType<typeof parseSmtpSettings> = null
  try {
    settings = parseSmtpSettings(JSON.parse(await decryptSecret(env.SESSION_SECRET, stored.ciphertext, stored.iv)))
  } catch {
    settings = null
  }
  if (!settings) {
    await recordMaintenanceNotice(env, 'maintenance.email.skipped', { reason, configured: false, error: 'SMTP settings are invalid' })
    return
  }
  for (const administrator of administrators.results) {
    let sent = false
    let attempts = 0
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      attempts = attempt
      try {
        await sendEmail(settings, administrator.email, reason)
        sent = true
        break
      } catch {
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)))
      }
    }
    await recordMaintenanceNotice(env, sent ? 'maintenance.email.sent' : 'maintenance.email.failed', { reason, administratorId: administrator.id, attempts })
  }
}

async function recordMaintenanceNotice(env: Env, action: string, detail: Record<string, unknown>): Promise<void> {
  await env.DB.prepare('INSERT INTO audit_log (id, user_id, action, detail_json, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), null, action, JSON.stringify(detail), new Date().toISOString()).run()
}

export function setPlatformSettingsCache(settings: PlatformSettings): void {
  settingsCache = { value: settings, expiresAt: Date.now() + settingsCacheTtlMs }
}

export async function reserveRequest(env: Env, quotas: PlatformQuotas): Promise<boolean> {
  await ensureUsageRow(env)
  const now = new Date()
  const nowIso = now.toISOString()
  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const result = await env.DB.prepare(`
    UPDATE platform_usage
    SET request_count = CASE WHEN request_window_started_at <= ? THEN 1 ELSE request_count + 1 END,
        request_window_started_at = CASE WHEN request_window_started_at <= ? THEN ? ELSE request_window_started_at END,
        updated_at = ?
    WHERE key = ? AND (request_window_started_at <= ? OR request_count < ?)
  `).bind(windowStart, windowStart, nowIso, nowIso, usageKey, windowStart, quotas.requests).run()
  return (result.meta.changes ?? 0) === 1
}

export async function reserveActiveConnection(env: Env, quotas: PlatformQuotas): Promise<boolean> {
  await ensureUsageRow(env)
  const result = await env.DB.prepare('UPDATE platform_usage SET active_connections = active_connections + 1, updated_at = ? WHERE key = ? AND active_connections < ?').bind(new Date().toISOString(), usageKey, quotas.activeConnections).run()
  return (result.meta.changes ?? 0) === 1
}

export async function releaseActiveConnection(env: Env): Promise<void> {
  await ensureUsageRow(env)
  await env.DB.prepare('UPDATE platform_usage SET active_connections = MAX(active_connections - 1, 0), updated_at = ? WHERE key = ?').bind(new Date().toISOString(), usageKey).run()
}

export async function reserveR2Usage(env: Env, quotas: PlatformQuotas, bytes: number): Promise<boolean> {
  await ensureUsageRow(env)
  const result = await env.DB.prepare('UPDATE platform_usage SET r2_bytes = r2_bytes + ?, r2_objects = r2_objects + 1, updated_at = ? WHERE key = ? AND r2_bytes + ? <= ? AND r2_objects + 1 <= ?').bind(bytes, new Date().toISOString(), usageKey, bytes, quotas.r2Bytes, quotas.r2Objects).run()
  return (result.meta.changes ?? 0) === 1
}

export async function releaseR2Usage(env: Env, bytes: number): Promise<void> {
  await ensureUsageRow(env)
  await env.DB.prepare('UPDATE platform_usage SET r2_bytes = MAX(r2_bytes - ?, 0), r2_objects = MAX(r2_objects - 1, 0), updated_at = ? WHERE key = ?').bind(bytes, new Date().toISOString(), usageKey).run()
}

export function cloudflareQuotaReason(usage: {
  d1?: { readQueries: number; writeQueries: number }
  kv?: { read: number; write: number; delete: number; list: number }
  durableObjects?: { requests: number }
}, quotas: PlatformQuotas): string | null {
  const d1Queries = usage.d1 ? usage.d1.readQueries + usage.d1.writeQueries : 0
  if (d1Queries >= quotas.d1Queries) return 'D1 query quota reached'
  const kvOperations = usage.kv ? usage.kv.read + usage.kv.write + usage.kv.delete + usage.kv.list : 0
  if (kvOperations >= quotas.kvOperations) return 'KV operation quota reached'
  if ((usage.durableObjects?.requests ?? 0) >= quotas.durableObjectRequests) return 'Durable Object request quota reached'
  return null
}

async function ensureUsageRow(env: Env): Promise<void> {
  const now = new Date().toISOString()
  await env.DB.prepare('INSERT OR IGNORE INTO platform_usage (key, request_count, request_window_started_at, active_connections, r2_bytes, r2_objects, updated_at) VALUES (?, 0, ?, 0, 0, 0, ?)').bind(usageKey, now, now).run()
}

async function ensurePlatformSettingsRow(env: Env): Promise<void> {
  const now = new Date().toISOString()
  await env.DB.prepare('INSERT OR IGNORE INTO platform_settings (key, value_json, updated_at) VALUES (?, ?, ?)').bind('platform', JSON.stringify(defaultPlatformSettings), now).run()
}

async function readPlatformSettings(env: Env): Promise<PlatformSettings> {
  const row = await env.DB.prepare('SELECT value_json FROM platform_settings WHERE key = ?').bind('platform').first<{ value_json: string }>()
  if (!row) return defaultPlatformSettings
  try {
    const value = JSON.parse(row.value_json) as Partial<PlatformSettings>
    return {
      maintenance: Boolean(value.maintenance),
      quotas: {
        ...defaultPlatformSettings.quotas,
        ...(value.quotas ?? {}),
      },
    }
  } catch {
    return defaultPlatformSettings
  }
}

