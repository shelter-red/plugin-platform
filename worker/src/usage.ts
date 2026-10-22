import type { CloudflareUsageLimits, Env, PlatformQuotas, PlatformSettings } from './types'
import { decryptSecret } from './secrets'
import { parseSmtpSettings, sendMaintenanceEmail, type SmtpSettings } from './email'

export const defaultPluginDomainSuffix = '.plugins.example.com'

export const defaultPlatformSettings: PlatformSettings = {
  maintenance: false,
  pluginDomainSuffix: defaultPluginDomainSuffix,
  quotas: {
    activeConnections: 100,
    r2Bytes: 10 * 1024 * 1024 * 1024,
    r2Objects: 1000,
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
  await env.DB.prepare('INSERT INTO audit_log (id, workspace_id, user_id, action, detail_json, created_at) VALUES (?, NULL, ?, ?, ?, ?)').bind(crypto.randomUUID(), null, action, JSON.stringify(detail), new Date().toISOString()).run()
}

export function setPlatformSettingsCache(settings: PlatformSettings): void {
  settingsCache = { value: settings, expiresAt: Date.now() + settingsCacheTtlMs }
}

export function normalizePluginDomainSuffix(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const domain = value.trim().toLowerCase().replace(/^\.+/, '')
  if (!domain || domain.length > 253) return null
  const labels = domain.split('.')
  if (labels.length < 2 || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null
  return `.${domain}`
}

// 平台请求只计数不拦截：24 小时窗口内的请求数用于展示，真正的额度上限在 Cloudflare 官方侧。
export async function recordRequest(env: Env): Promise<void> {
  await ensureUsageRow(env)
  const now = new Date()
  const nowIso = now.toISOString()
  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  await env.DB.prepare(`
    UPDATE platform_usage
    SET request_count = CASE WHEN request_window_started_at <= ? THEN 1 ELSE request_count + 1 END,
        request_window_started_at = CASE WHEN request_window_started_at <= ? THEN ? ELSE request_window_started_at END,
        updated_at = ?
    WHERE key = ?
  `).bind(windowStart, windowStart, nowIso, nowIso, usageKey).run()
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

// 逐项比对 Cloudflare 免费额度：D1 按行读写、KV 按每种操作、DO 按请求数分别判断，
// 任何一项触顶都进入维护模式，避免合并统计掩盖单项超限。
export function cloudflareQuotaReason(usage: {
  requests?: number
  d1?: { rowsRead: number; rowsWritten: number }
  kv?: { read: number; write: number; delete: number; list: number }
  durableObjects?: { requests: number }
}, quotas: CloudflareUsageLimits): string | null {
  if ((usage.requests ?? 0) >= quotas.workerRequests) return 'Worker request quota reached'
  if ((usage.d1?.rowsRead ?? 0) >= quotas.d1RowsRead) return 'D1 rows read quota reached'
  if ((usage.d1?.rowsWritten ?? 0) >= quotas.d1RowsWritten) return 'D1 rows written quota reached'
  if ((usage.kv?.read ?? 0) >= quotas.kvRead) return 'KV read quota reached'
  if ((usage.kv?.write ?? 0) >= quotas.kvWrite) return 'KV write quota reached'
  if ((usage.kv?.delete ?? 0) >= quotas.kvDelete) return 'KV delete quota reached'
  if ((usage.kv?.list ?? 0) >= quotas.kvList) return 'KV list quota reached'
  if ((usage.durableObjects?.requests ?? 0) >= quotas.doRequests) return 'Durable Object request quota reached'
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
  const fallback = environmentPlatformSettings(env)
  const row = await env.DB.prepare('SELECT value_json FROM platform_settings WHERE key = ?').bind('platform').first<{ value_json: string }>()
  if (!row) return fallback
  try {
    const value = JSON.parse(row.value_json) as Partial<PlatformSettings>
    return {
      maintenance: Boolean(value.maintenance),
      pluginDomainSuffix: normalizePluginDomainSuffix(value.pluginDomainSuffix) ?? fallback.pluginDomainSuffix,
      quotas: {
        activeConnections: positiveQuota(value.quotas?.activeConnections) ?? fallback.quotas.activeConnections,
        r2Bytes: positiveQuota(value.quotas?.r2Bytes) ?? fallback.quotas.r2Bytes,
        r2Objects: positiveQuota(value.quotas?.r2Objects) ?? fallback.quotas.r2Objects,
      },
    }
  } catch {
    return fallback
  }
}

// 旧版本把 D1/KV/DO/请求数混在 quotas 里，这里只接受新字段，缺失或非法的一律回退默认值。
function positiveQuota(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function environmentPlatformSettings(env: Env): PlatformSettings {
  return {
    ...defaultPlatformSettings,
    pluginDomainSuffix: normalizePluginDomainSuffix(env.PLUGIN_DOMAIN_SUFFIX) ?? defaultPluginDomainSuffix,
  }
}

