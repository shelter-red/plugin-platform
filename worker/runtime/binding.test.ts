import { SELF } from 'cloudflare:test'
import { beforeEach, expect, test } from 'vitest'
import { createServerRegistration } from '../src/index'
import { CONTROL_TOKEN, connectControl, hashToken, openControl, seedServer, sendFrame, testEnv, resetDatabase } from './helpers'

const register = (code: string, name: string) => SELF.fetch('https://console.example.com/control/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ code, name }),
})

beforeEach(resetDatabase)

test('真实 D1 保证一次性注册码在并发下只被消费一次', { timeout: 20_000 }, async () => {
  const now = new Date().toISOString()
  await testEnv.DB.batch([
    testEnv.DB.prepare('INSERT INTO users (id, github_id, email, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind('user-runtime', 'gh-runtime', 'owner@example.com', 'Runtime Owner', 'member', now),
    testEnv.DB.prepare('INSERT INTO registration_codes (id, user_id, code_hash, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind('code-runtime', 'user-runtime', await hashToken('one-time-code'), new Date(Date.now() + 60_000).toISOString(), null, now),
  ])
  const results = await Promise.all([register('one-time-code', 'first'), register('one-time-code', 'second'), register('one-time-code', 'third')])
  expect(results.map((response) => response.status).sort()).toEqual([201, 401, 401])
  const servers = await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM servers').first<{ count: number }>()
  const used = await testEnv.DB.prepare('SELECT used_at FROM registration_codes WHERE id = ?').bind('code-runtime').first<{ used_at: string | null }>()
  expect(servers?.count).toBe(1)
  expect(used?.used_at).not.toBeNull()
})

test('真实 D1 在服务器创建失败时回滚注册码消费', { timeout: 20_000 }, async () => {
  const now = new Date().toISOString()
  await testEnv.DB.batch([
    testEnv.DB.prepare('INSERT INTO users (id, github_id, email, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind('user-runtime', 'gh-runtime', 'owner@example.com', 'Runtime Owner', 'member', now),
    testEnv.DB.prepare('INSERT INTO registration_codes (id, user_id, code_hash, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind('code-runtime', 'user-runtime', await hashToken('one-time-code'), new Date(Date.now() + 60_000).toISOString(), null, now),
  ])
  await testEnv.DB.prepare("CREATE TRIGGER fail_server_insert BEFORE INSERT ON servers BEGIN SELECT RAISE(ABORT, 'forced server insert failure'); END").run()
  try {
    await expect(createServerRegistration(testEnv, 'one-time-code', 'failed')).rejects.toThrow('forced server insert failure')
    const used = await testEnv.DB.prepare('SELECT used_at FROM registration_codes WHERE id = ?').bind('code-runtime').first<{ used_at: string | null }>()
    const servers = await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM servers').first<{ count: number }>()
    const audits = await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'server.registered'").first<{ count: number }>()
    expect(used?.used_at).toBeNull()
    expect(servers?.count).toBe(0)
    expect(audits?.count).toBe(0)
  } finally {
    await testEnv.DB.prepare('DROP TRIGGER IF EXISTS fail_server_insert').run()
  }

  const retried = await createServerRegistration(testEnv, 'one-time-code', 'retried')
  expect('value' in retried).toBe(true)
  const used = await testEnv.DB.prepare('SELECT used_at FROM registration_codes WHERE id = ?').bind('code-runtime').first<{ used_at: string | null }>()
  expect(used?.used_at).not.toBeNull()
})

test('真实 Durable Object 撤销绑定会关闭连接并把插件与域名置为离线', { timeout: 20_000 }, async () => {
  await seedServer()
  const { socket, channel } = await openControl()
  const closed = new Promise<number>((resolve) => socket.addEventListener('close', (event) => resolve(event.code)))
  sendFrame(socket, 'server.revoke')
  const result = await channel.next()
  expect(result.type).toBe('server.result')
  expect(result.payload).toMatchObject({ ok: true, action: 'revoke' })
  expect(await closed).toBe(1000)
  const server = await testEnv.DB.prepare('SELECT status FROM servers WHERE id = ?').bind('server-runtime').first<{ status: string }>()
  const plugin = await testEnv.DB.prepare('SELECT state FROM plugin_instances WHERE id = ?').bind('plugin-runtime').first<{ state: string }>()
  const domain = await testEnv.DB.prepare('SELECT status FROM domains WHERE id = ?').bind('domain-runtime').first<{ status: string }>()
  expect(server?.status).toBe('revoked')
  expect(plugin?.state).toBe('server_offline')
  expect(domain?.status).toBe('offline')
  const revokeAudit = await testEnv.DB.prepare("SELECT user_id, detail_json FROM audit_log WHERE action = 'server.revoked'").first<{ user_id: string; detail_json: string }>()
  expect(revokeAudit?.user_id).toBe('user-runtime')
  expect(JSON.parse(revokeAudit!.detail_json)).toEqual({ serverId: 'server-runtime' })
  const reconnect = await SELF.fetch('https://console.example.com/control/connect?serverId=server-runtime', { headers: { Upgrade: 'websocket', Authorization: `Bearer ${CONTROL_TOKEN}` } })
  expect(reconnect.status).toBe(401)
})

test('真实 Durable Object 轮换密钥后旧令牌失效、新令牌可重连', { timeout: 20_000 }, async () => {
  await seedServer()
  const { socket, channel } = await openControl()
  sendFrame(socket, 'server.rotate')
  const result = await channel.next()
  expect(result.type).toBe('server.result')
  const nextToken = result.payload?.accessToken
  expect(typeof nextToken).toBe('string')
  const stored = await testEnv.DB.prepare('SELECT token_hash FROM servers WHERE id = ?').bind('server-runtime').first<{ token_hash: string }>()
  expect(stored?.token_hash).toBe(await hashToken(String(nextToken)))
  const rotateAudit = await testEnv.DB.prepare("SELECT detail_json FROM audit_log WHERE action = 'server.rotated'").first<{ detail_json: string }>()
  expect(JSON.parse(rotateAudit!.detail_json)).toEqual({ serverId: 'server-runtime' })
  expect(JSON.stringify(rotateAudit)).not.toContain(String(nextToken))
  const rejected = await SELF.fetch('https://console.example.com/control/connect?serverId=server-runtime', { headers: { Upgrade: 'websocket', Authorization: `Bearer ${CONTROL_TOKEN}` } })
  expect(rejected.status).toBe(401)
  const reconnected = await connectControl(String(nextToken))
  reconnected.close(1000, 'test complete')
  socket.close(1000, 'test complete')
})
