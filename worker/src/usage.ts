import type { Env, PlatformQuotas, PlatformSettings } from './types'

export const defaultPlatformSettings: PlatformSettings = {
  maintenance: false,
  quotas: {
    requests: 100000,
    activeConnections: 100,
    r2Bytes: 10 * 1024 * 1024 * 1024,
    r2Objects: 1000,
  },
}

const usageKey = 'global'
const settingsCacheTtlMs = 30_000
let settingsCache: { value: PlatformSettings; expiresAt: number } | null = null

export async function getPlatformSettings(env: Env): Promise<PlatformSettings> {
  if (settingsCache && settingsCache.expiresAt > Date.now()) return settingsCache.value
  const row = await env.DB.prepare('SELECT value_json FROM platform_settings WHERE key = ?').bind('platform').first<{ value_json: string }>()
  if (!row) {
    settingsCache = { value: defaultPlatformSettings, expiresAt: Date.now() + settingsCacheTtlMs }
    return defaultPlatformSettings
  }
  try {
    const value = JSON.parse(row.value_json) as Partial<PlatformSettings>
    const settings = {
      maintenance: Boolean(value.maintenance),
      quotas: {
        ...defaultPlatformSettings.quotas,
        ...(value.quotas ?? {}),
      },
    }
    settingsCache = { value: settings, expiresAt: Date.now() + settingsCacheTtlMs }
    return settings
  } catch {
    settingsCache = { value: defaultPlatformSettings, expiresAt: Date.now() + settingsCacheTtlMs }
    return defaultPlatformSettings
  }
}

export async function isMaintenanceMode(env: Env): Promise<boolean> {
  return (await getPlatformSettings(env)).maintenance
}

export async function activateMaintenance(env: Env): Promise<void> {
  const settings = await getPlatformSettings(env)
  if (settings.maintenance) return
  const next = { ...settings, maintenance: true }
  await env.DB.prepare('INSERT INTO platform_settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at').bind('platform', JSON.stringify(next), new Date().toISOString()).run()
  setPlatformSettingsCache(next)
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

async function ensureUsageRow(env: Env): Promise<void> {
  const now = new Date().toISOString()
  await env.DB.prepare('INSERT OR IGNORE INTO platform_usage (key, request_count, request_window_started_at, active_connections, r2_bytes, r2_objects, updated_at) VALUES (?, 0, ?, 0, 0, 0, ?)').bind(usageKey, now, now).run()
}

export function countStream(stream: ReadableStream<Uint8Array>, counter: { bytes: number }, maxBytes: number): ReadableStream<Uint8Array> {
  const reader = stream.getReader()
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const result = await reader.read()
      if (result.done) {
        controller.close()
        return
      }
      const chunk = result.value
      counter.bytes += chunk.byteLength
      if (counter.bytes > maxBytes) {
        await reader.cancel('Request body is too large')
        controller.error(new Error('Request body is too large'))
        return
      }
      controller.enqueue(chunk)
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
}
