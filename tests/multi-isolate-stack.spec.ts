import { DatabaseSync } from 'node:sqlite'
import { expect, test } from '@playwright/test'
import { getPublic, makeTarget } from './public-client'

const aUrl = process.env.PLUGMESH_MULTI_ISOLATE_A_URL
const bUrl = process.env.PLUGMESH_MULTI_ISOLATE_B_URL
const d1Path = process.env.PLUGMESH_D1_SQLITE

test.skip(!aUrl || !bUrl || !d1Path, '需要两个共享同一 D1 的 wrangler dev 实例，并设置 PLUGMESH_D1_SQLITE')

test('路由缓存不跨 isolate 共享，5 秒 TTL 后各自回源 D1', async () => {
  test.setTimeout(60_000)
  const hostname = `ttl-${Date.now().toString(36)}.plugins.example.com`
  const aTarget = makeTarget(aUrl!, hostname)
  const bTarget = makeTarget(bUrl!, hostname)
  const db = new DatabaseSync(d1Path!)
  db.exec('PRAGMA busy_timeout = 5000')

  const plugin = db.prepare('SELECT id, user_id FROM plugin_instances LIMIT 1').get() as { id: string; user_id: string } | undefined
  test.skip(!plugin, '本地 D1 没有插件记录，先按 docs/local-e2e.md 写入 seed')

  try {
    // 只让 A 建立该域名的负缓存；B 保持冷启动，稍后用来证明缓存不跨 isolate 共享。
    expect((await getPublic(aTarget)).status).toBe(404)

    // 直接写 D1：不经过任一 isolate 的失效逻辑，模拟另一个 isolate 的配置写穿。
    db.prepare('INSERT INTO domains (id, user_id, plugin_instance_id, hostname, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(`dom-${hostname}`, plugin!.user_id, plugin!.id, hostname, 'online', new Date().toISOString())

    // A 的负缓存尚未到期，仍返回 404；B 首次请求该域名，只能回源 D1 看到新记录。
    expect((await getPublic(aTarget)).status).toBe(404)
    const fresh = (await getPublic(bTarget)).status
    expect(fresh).not.toBe(404)

    // 超过 5 秒 TTL 后，A 也回源 D1，与 B 得到同一结论。
    await new Promise((resolve) => setTimeout(resolve, 6_000))
    expect((await getPublic(aTarget)).status).toBe(fresh)
    console.log(`多 isolate：写入 D1 后 A 仍命中 404 负缓存；B 立即回源得到 ${fresh}；TTL 后 A 收敛为 ${fresh}`)
  } finally {
    db.prepare('DELETE FROM domains WHERE id = ?').run(`dom-${hostname}`)
    db.close()
  }
})
