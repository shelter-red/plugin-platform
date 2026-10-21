import { SELF } from 'cloudflare:test'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { defaultPlatformSettings, setPlatformSettingsCache } from '../src/usage'
import { hashToken, resetDatabase, seedServer, testEnv } from './helpers'

const MEMBER_TOKEN = 'blob-member-session'

const api = (path: string, init: RequestInit = {}): Promise<Response> =>
  SELF.fetch(`https://console.example.com${path}`, { ...init, headers: { cookie: `plugmesh_session=${MEMBER_TOKEN}`, ...(init.headers as Record<string, string> | undefined) } })

async function seedMemberSession(): Promise<void> {
  const now = new Date().toISOString()
  await testEnv.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').bind('session-blob', 'user-runtime', await hashToken(MEMBER_TOKEN), new Date(Date.now() + 3_600_000).toISOString(), now).run()
}

beforeEach(resetDatabase)
afterEach(() => setPlatformSettingsCache(defaultPlatformSettings))

test('一次上传返回短时链接，下载一次后删除对象并归还用量', { timeout: 20_000 }, async () => {
  await seedServer()
  await seedMemberSession()
  const payload = new Uint8Array(4096).map((_, index) => index % 251)

  const created = await api('/api/blobs', { method: 'POST', body: payload, headers: { 'content-type': 'application/octet-stream', 'content-length': String(payload.byteLength) } })
  expect(created.status).toBe(201)
  const { url, expiresAt } = await created.json() as { url: string; expiresAt: string }
  expect(url.startsWith('/blobs/')).toBe(true)
  expect(Date.parse(expiresAt) - Date.now()).toBeGreaterThan(14 * 60 * 1000)

  const stored = await testEnv.DB.prepare('SELECT object_key, size_bytes FROM temp_objects').all<{ object_key: string; size_bytes: number }>()
  expect(stored.results).toHaveLength(1)
  expect(stored.results[0]!.size_bytes).toBe(payload.byteLength)
  expect((await testEnv.BLOB_BUCKET.list()).objects).toHaveLength(1)
  const reserved = await testEnv.DB.prepare('SELECT r2_bytes, r2_objects FROM platform_usage WHERE key = ?').bind('global').first<{ r2_bytes: number; r2_objects: number }>()
  expect(`${reserved?.r2_bytes}/${reserved?.r2_objects}`).toBe('4096/1')

  const download = await SELF.fetch(`https://console.example.com${url}`)
  expect(download.status).toBe(200)
  expect(download.headers.get('content-type')).toBe('application/octet-stream')
  expect(new Uint8Array(await download.arrayBuffer())).toEqual(payload)

  await expect.poll(async () => (await testEnv.BLOB_BUCKET.list()).objects.length, { timeout: 3_000 }).toBe(0)
  await expect.poll(async () => {
    const row = await testEnv.DB.prepare('SELECT r2_bytes, r2_objects FROM platform_usage WHERE key = ?').bind('global').first<{ r2_bytes: number; r2_objects: number }>()
    return `${row?.r2_bytes ?? -1}/${row?.r2_objects ?? -1}`
  }, { timeout: 3_000 }).toBe('0/0')
  const remaining = await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM temp_objects').first<{ count: number }>()
  expect(remaining?.count).toBe(0)

  const replay = await SELF.fetch(`https://console.example.com${url}`)
  expect(replay.status).toBe(410)
})

test('R2 配额耗尽时拒绝上传并清理已写入对象', { timeout: 20_000 }, async () => {
  await seedServer()
  await seedMemberSession()
  const settings = { ...defaultPlatformSettings, quotas: { ...defaultPlatformSettings.quotas, r2Bytes: 0 } }
  await testEnv.DB.prepare('INSERT INTO platform_settings (key, value_json, updated_at) VALUES (?, ?, ?)').bind('platform', JSON.stringify(settings), new Date().toISOString()).run()
  setPlatformSettingsCache(settings)

  const response = await api('/api/blobs', { method: 'POST', body: new Uint8Array(512), headers: { 'content-length': '512' } })
  expect(response.status).toBe(503)
  expect((await response.json() as { error: string }).error).toBe('Platform quota reached')
  expect((await testEnv.BLOB_BUCKET.list()).objects).toHaveLength(0)
  const remaining = await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM temp_objects').first<{ count: number }>()
  expect(remaining?.count).toBe(0)
  const stored = await testEnv.DB.prepare('SELECT value_json FROM platform_settings WHERE key = ?').bind('platform').first<{ value_json: string }>()
  expect(Boolean(JSON.parse(stored?.value_json ?? '{}').maintenance)).toBe(true)
})

test('缺少 Content-Length 的流式上传被明确拒绝', { timeout: 20_000 }, async () => {
  await seedServer()
  await seedMemberSession()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(16))
      controller.close()
    },
  })
  const response = await api('/api/blobs', { method: 'POST', body: stream, headers: { 'content-type': 'application/octet-stream' } })
  expect(response.status).toBe(411)
  expect((await response.json() as { error: string }).error).toBe('Content-Length header is required')
})
