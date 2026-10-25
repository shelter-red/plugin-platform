import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { CONTROL_TOKEN, DEFAULT_WORKSPACE_ID, hashToken, resetDatabase, seedServer, testEnv } from './helpers'
import { TunnelSession } from '../src/tunnel-session'

const TARGET_ID = 'server-tunnel-target'
const TARGET_TOKEN = 'runtime-tunnel-target-token'

async function connect(url: string, token: string): Promise<WebSocket> {
  const response = await SELF.fetch(url, { headers: { Upgrade: 'websocket', Authorization: `Bearer ${token}` } })
  expect(response.status).toBe(101)
  if (!response.webSocket) throw new Error('missing websocket')
  response.webSocket.accept()
  response.webSocket.binaryType = 'arraybuffer'
  return response.webSocket
}

function nextMessage(socket: WebSocket): Promise<MessageEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('websocket frame timeout')), 3_000)
    socket.addEventListener('message', (event) => {
      clearTimeout(timer)
      resolve(event)
    }, { once: true })
  })
}

async function messageBytes(data: unknown): Promise<Uint8Array> {
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  if (data && typeof (data as Blob).arrayBuffer === 'function') return new Uint8Array(await (data as Blob).arrayBuffer())
  throw new TypeError('expected a binary WebSocket message')
}

describe('TCP tunnel control and binary data path', () => {
  it('keeps the short-lived session pairing in Durable Object memory', async () => {
    const state = {
      storage: {
        get: async () => { throw new Error('tunnel session must not read Durable Object storage') },
        put: async () => { throw new Error('tunnel session must not write Durable Object storage') },
      },
    } as unknown as DurableObjectState
    const tunnel = new TunnelSession(state, {})
    const source = await tunnel.fetch(new Request('https://console.example.com/source?sessionId=session-memory&targetServerId=target&sourceServerId=source', { headers: { Upgrade: 'websocket' } }))
    expect(source.status).toBe(101)
    source.webSocket?.accept()
    const target = await tunnel.fetch(new Request('https://console.example.com/target?serverId=target&sessionId=session-memory', { headers: { Upgrade: 'websocket' } }))
    expect(target.status).toBe(101)
    target.webSocket?.accept()
    source.webSocket?.close()
    target.webSocket?.close()
  })

  it('discovers same-workspace servers and relays binary WebSocket frames in both directions', async () => {
    await resetDatabase()
    await seedServer()
    const now = new Date().toISOString()
    await testEnv.DB.prepare('INSERT INTO servers (id, user_id, workspace_id, name, token_hash, status, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(TARGET_ID, 'user-runtime', DEFAULT_WORKSPACE_ID, 'SSH host', await hashToken(TARGET_TOKEN), 'online', now, now).run()

    const targetControlResponse = await SELF.fetch(`https://console.example.com/control/connect?serverId=${TARGET_ID}`, {
      headers: { Upgrade: 'websocket', Authorization: `Bearer ${TARGET_TOKEN}` },
    })
    expect(targetControlResponse.status).toBe(101)
    const targetControl = targetControlResponse.webSocket!
    targetControl.accept()
    targetControl.binaryType = 'arraybuffer'
    expect(JSON.parse((await nextMessage(targetControl)).data as string).type).toBe('hello')
    const openFrame = nextMessage(targetControl)

    const listed = await SELF.fetch(`https://console.example.com/control/tunnel/targets?serverId=server-runtime`, {
      headers: { Authorization: `Bearer ${CONTROL_TOKEN}` },
    })
    expect(listed.status).toBe(200)
    expect(await listed.json()).toMatchObject({ results: [{ id: TARGET_ID, name: 'SSH host', status: 'online' }] })

    const source = await connect(`https://console.example.com/control/tunnel/connect?serverId=server-runtime&targetServerId=${TARGET_ID}&targetHost=127.0.0.1&targetPort=22&protocol=tcp`, CONTROL_TOKEN)
    const sessionFrame = await messageBytes((await nextMessage(source)).data)
    expect(sessionFrame[0]).toBe(0x50)
    expect(sessionFrame[1]).toBe(1)
    expect(sessionFrame[2]).toBe(20)
    const open = JSON.parse((await openFrame).data as string) as { type: string; payload: { sessionId: string; targetPort: number } }
    expect(open.type).toBe('tunnel.open')
    expect(open.payload.targetPort).toBe(22)

    const target = await connect(`https://console.example.com/control/tunnel/target?serverId=${TARGET_ID}&sessionId=${open.payload.sessionId}`, TARGET_TOKEN)
    const targetReceives = nextMessage(target)
    source.send(new Uint8Array([0, 255, 1, 0, 128]).buffer)
    const targetFrame = await targetReceives
    expect(await messageBytes(targetFrame.data)).toEqual(new Uint8Array([0, 255, 1, 0, 128]))

    const sourceReceives = nextMessage(source)
    target.send(new Uint8Array([255, 0, 254, 10]).buffer)
    expect(await messageBytes((await sourceReceives).data)).toEqual(new Uint8Array([255, 0, 254, 10]))
    source.close(1000, 'test complete')
    target.close(1000, 'test complete')
    targetControl.close(1000, 'test complete')
  })

  it('rejects targets outside the source workspace and invalid control tokens', async () => {
    await resetDatabase()
    await seedServer()
    const invalid = await SELF.fetch('https://console.example.com/control/tunnel/targets?serverId=server-runtime', {
      headers: { Authorization: 'Bearer invalid' },
    })
    expect(invalid.status).toBe(401)
    const absent = await SELF.fetch('https://console.example.com/control/tunnel/connect?serverId=server-runtime&targetServerId=other&targetHost=127.0.0.1&targetPort=22&protocol=tcp', {
      headers: { Upgrade: 'websocket', Authorization: `Bearer ${CONTROL_TOKEN}` },
    })
    expect(absent.status).toBe(404)
  })
})
