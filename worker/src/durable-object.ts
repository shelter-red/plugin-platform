import { isManifest, makeFrame, parseControlFrame } from './protocol'
import type { Env } from './types'

export class PluginBridge {
  private state: DurableObjectState
  private serverSocket: WebSocket | null = null
  private serverId = ''
  private env: Env
  private pending = new Map<string, { resolve: (response: Response) => void; timer: number }>()

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/connect') return this.connectServer(request)
    if (url.pathname === '/proxy') return this.proxyRequest(request)
    if (url.pathname === '/command') return this.command(request)
    return new Response('Not found', { status: 404 })
  }

  private connectServer(request: Request): Response {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket upgrade required', { status: 426 })
    const pair = new WebSocketPair()
    this.serverId = new URL(request.url).searchParams.get('serverId') ?? ''
    const client = pair[0]
    const server = pair[1]
    server.accept()
    this.serverSocket?.close(1012, 'Replaced by a new connection')
    this.serverSocket = server
    server.addEventListener('message', (event) => this.handleServerMessage(event.data))
    server.addEventListener('close', () => {
      if (this.serverSocket === server) this.serverSocket = null
      void this.markServerOffline()
    })
    server.send(JSON.stringify(makeFrame('hello', this.serverId, { message: 'server connection accepted' })))
    return new Response(null, { status: 101, webSocket: client })
  }

  private async proxyRequest(request: Request): Promise<Response> {
    if (!this.serverSocket || this.serverSocket.readyState !== WebSocket.OPEN) return new Response('Plugin server is offline', { status: 503 })
    const requestId = crypto.randomUUID()
    const body = await request.text()
    const frame = makeFrame('request.open', this.serverId, {
      method: request.method,
      path: new URL(request.url).pathname + new URL(request.url).search,
      headers: Object.fromEntries(request.headers),
      body,
    })
    frame.requestId = requestId
    const response = new Promise<Response>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        resolve(new Response('Plugin request timed out', { status: 504 }))
      }, 25_000) as unknown as number
      this.pending.set(requestId, { resolve, timer })
    })
    this.serverSocket.send(JSON.stringify(frame))
    return response
  }

  private async command(request: Request): Promise<Response> {
    if (!this.serverSocket || this.serverSocket.readyState !== WebSocket.OPEN) return new Response('Plugin server is offline', { status: 503 })
    const body = await request.json().catch(() => null) as { type?: string; pluginId?: string } | null
    if (!body?.type || !body.type.startsWith('plugin.')) return new Response('Invalid command', { status: 400 })
    const frame = makeFrame(body.type, this.serverId, {}, body.pluginId)
    this.serverSocket.send(JSON.stringify(frame))
    return new Response(JSON.stringify({ accepted: true, requestId: frame.requestId }), { status: 202, headers: { 'content-type': 'application/json' } })
  }

  private handleServerMessage(data: string | ArrayBuffer) {
    const raw = typeof data === 'string' ? data : new TextDecoder().decode(data)
    const frame = parseControlFrame(raw)
    if (!frame) return
    if (frame.type === 'server.register') {
      void this.registerServer(frame.payload ?? {})
      return
    }
    if (frame.type === 'server.heartbeat') {
      void this.markServerOnline()
      return
    }
    if (frame.type !== 'request.close') return
    const pending = this.pending.get(frame.requestId)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(frame.requestId)
    const payload = frame.payload ?? {}
    pending.resolve(new Response(typeof payload.body === 'string' ? payload.body : '', {
      status: typeof payload.status === 'number' ? payload.status : 502,
      headers: payload.headers && typeof payload.headers === 'object' ? payload.headers as Record<string, string> : undefined,
    }))
  }

  private async markServerOnline() {
    if (!this.serverId) return
    await this.env.DB.prepare('UPDATE servers SET status = ?, last_seen_at = ? WHERE id = ?').bind('online', new Date().toISOString(), this.serverId).run()
  }

  private async markServerOffline() {
    if (!this.serverId) return
    await this.env.DB.prepare('UPDATE servers SET status = ?, last_seen_at = ? WHERE id = ?').bind('offline', new Date().toISOString(), this.serverId).run()
  }

  private async registerServer(payload: Record<string, unknown>) {
    await this.markServerOnline()
    const server = await this.env.DB.prepare('SELECT user_id FROM servers WHERE id = ?').bind(this.serverId).first<{ user_id: string }>()
    const manifests = Array.isArray(payload.manifests) ? payload.manifests.filter(isManifest) : []
    if (!server || manifests.length === 0) return
    const now = new Date().toISOString()
    for (const manifest of manifests) {
      await this.env.DB.prepare(`
        INSERT INTO plugin_instances (id, user_id, server_id, plugin_id, name, version, state, manifest_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(server_id, plugin_id) DO UPDATE SET name = excluded.name, version = excluded.version, manifest_json = excluded.manifest_json, updated_at = excluded.updated_at
      `).bind(crypto.randomUUID(), server.user_id, this.serverId, manifest.id, manifest.name, manifest.version, 'discovered', JSON.stringify(manifest), now, now).run()
    }
  }
}
