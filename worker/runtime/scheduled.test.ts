import { beforeEach, expect, test } from 'vitest'
import { runScheduledMaintenance } from '../src/index'
import { resetDatabase, seedServer, testEnv } from './helpers'

beforeEach(resetDatabase)

const daysAgo = (days: number): string => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
const hoursAgo = (hours: number): string => new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
const inDays = (days: number): string => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()

test('定时维护任务在真实 D1 上按保留期清理数据并删除过期 R2 对象', { timeout: 30_000 }, async () => {
  await seedServer()
  await testEnv.DB.batch([
    testEnv.DB.prepare('INSERT INTO request_logs (id, user_id, domain_id, plugin_instance_id, hostname, method, path, status, duration_ms, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind('log-old', 'user-runtime', 'domain-runtime', 'plugin-runtime', 'old.example.com', 'GET', '/', 200, 5, null, daysAgo(31)),
    testEnv.DB.prepare('INSERT INTO request_logs (id, user_id, domain_id, plugin_instance_id, hostname, method, path, status, duration_ms, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind('log-new', 'user-runtime', 'domain-runtime', 'plugin-runtime', 'new.example.com', 'GET', '/', 200, 5, null, daysAgo(10)),
    testEnv.DB.prepare('INSERT INTO audit_log (id, user_id, action, detail_json, created_at) VALUES (?, ?, ?, ?, ?)').bind('audit-old', 'user-runtime', 'old.action', '{}', daysAgo(181)),
    testEnv.DB.prepare('INSERT INTO audit_log (id, user_id, action, detail_json, created_at) VALUES (?, ?, ?, ?, ?)').bind('audit-new', 'user-runtime', 'new.action', '{}', daysAgo(170)),
    testEnv.DB.prepare('INSERT INTO invites (id, token_hash, email, github_login, status, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind('invite-expired', 'hash-invite-expired', 'expired@example.com', null, 'pending', hoursAgo(1), null, daysAgo(8)),
    testEnv.DB.prepare('INSERT INTO invites (id, token_hash, email, github_login, status, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind('invite-pending', 'hash-invite-pending', 'pending@example.com', null, 'pending', inDays(3), null, daysAgo(1)),
    testEnv.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').bind('session-expired', 'user-runtime', 'hash-session-expired', hoursAgo(1), daysAgo(30)),
    testEnv.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').bind('session-valid', 'user-runtime', 'hash-session-valid', inDays(7), daysAgo(1)),
    testEnv.DB.prepare('INSERT INTO oauth_states (state_hash, invite_token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)').bind('hash-oauth-expired', null, hoursAgo(1), daysAgo(1)),
    testEnv.DB.prepare('INSERT INTO oauth_states (state_hash, invite_token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)').bind('hash-oauth-valid', null, inDays(1), daysAgo(1)),
    testEnv.DB.prepare('INSERT INTO registration_codes (id, user_id, code_hash, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind('code-expired', 'user-runtime', 'hash-code-expired', hoursAgo(1), null, daysAgo(1)),
    testEnv.DB.prepare('INSERT INTO registration_codes (id, user_id, code_hash, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind('code-valid', 'user-runtime', 'hash-code-valid', inDays(1), null, daysAgo(1)),
  ])
  await testEnv.BLOB_BUCKET.put('stream/expired.bin', new Uint8Array(512))
  await testEnv.BLOB_BUCKET.put('stream/stale.bin', new Uint8Array(512))
  await testEnv.DB.batch([
    testEnv.DB.prepare('INSERT INTO temp_objects (id, object_key, token_hash, content_type, size_bytes, expires_at, consumed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind('temp-expired', 'stream/expired.bin', 'hash-temp-expired', 'application/octet-stream', 512, hoursAgo(1), null, hoursAgo(2)),
    testEnv.DB.prepare('INSERT INTO temp_objects (id, object_key, token_hash, content_type, size_bytes, expires_at, consumed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind('temp-stale', 'stream/stale.bin', 'hash-temp-stale', 'application/octet-stream', 512, inDays(1), daysAgo(2), daysAgo(2)),
    testEnv.DB.prepare('INSERT INTO platform_usage (key, request_count, request_window_started_at, active_connections, r2_bytes, r2_objects, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind('global', 3, daysAgo(1), 0, 1024, 2, daysAgo(1)),
    testEnv.DB.prepare('INSERT INTO usage_snapshots (captured_at, request_count, active_connections, r2_bytes, r2_objects) VALUES (?, ?, ?, ?, ?)').bind(daysAgo(31), 1, 0, 0, 0),
  ])

  await runScheduledMaintenance(testEnv)

  const requestLogs = await testEnv.DB.prepare('SELECT id FROM request_logs ORDER BY id').all<{ id: string }>()
  expect(requestLogs.results.map((row) => row.id)).toEqual(['log-new'])
  const audit = await testEnv.DB.prepare('SELECT id FROM audit_log ORDER BY id').all<{ id: string }>()
  expect(audit.results.map((row) => row.id)).toEqual(['audit-new'])
  const invite = await testEnv.DB.prepare('SELECT status FROM invites WHERE id = ?').bind('invite-expired').first<{ status: string }>()
  const pendingInvite = await testEnv.DB.prepare('SELECT status FROM invites WHERE id = ?').bind('invite-pending').first<{ status: string }>()
  expect(invite?.status).toBe('expired')
  expect(pendingInvite?.status).toBe('pending')
  const sessions = await testEnv.DB.prepare('SELECT id FROM sessions ORDER BY id').all<{ id: string }>()
  expect(sessions.results.map((row) => row.id)).toEqual(['session-valid'])
  const oauthStates = await testEnv.DB.prepare('SELECT state_hash FROM oauth_states ORDER BY state_hash').all<{ state_hash: string }>()
  expect(oauthStates.results.map((row) => row.state_hash)).toEqual(['hash-oauth-valid'])
  const codes = await testEnv.DB.prepare('SELECT id FROM registration_codes ORDER BY id').all<{ id: string }>()
  expect(codes.results.map((row) => row.id)).toEqual(['code-valid'])

  const tempObjects = await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM temp_objects').first<{ count: number }>()
  expect(tempObjects?.count).toBe(0)
  const objects = await testEnv.BLOB_BUCKET.list()
  expect(objects.objects.length).toBe(0)
  const usage = await testEnv.DB.prepare('SELECT r2_bytes, r2_objects FROM platform_usage WHERE key = ?').bind('global').first<{ r2_bytes: number; r2_objects: number }>()
  expect(`${usage?.r2_bytes ?? -1}/${usage?.r2_objects ?? -1}`).toBe('0/0')

  const snapshots = await testEnv.DB.prepare('SELECT captured_at FROM usage_snapshots').all<{ captured_at: string }>()
  expect(snapshots.results.length).toBe(1)
  expect(snapshots.results[0]!.captured_at >= daysAgo(1)).toBe(true)
})
