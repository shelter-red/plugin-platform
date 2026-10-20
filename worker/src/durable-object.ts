import { isManifest, makeFrame, parseControlFrame } from './protocol'
import type { Env } from './types'

type PendingResponse = {
  resolve: (value: Response | PromiseLike<Response>) => void
  timer: number
  writer?: WritableStreamDefaultWriter<Uint8Array>
  buffered: string[]
}

export class PluginBridge {
  private serverSocket: WebSocket | null = null
  private serverId = ''
  private env: Env
  private pending = new Map<string, PendingResponse>()
  private publicSockets = new Map<string, WebSocket>()

  constructor(_state: DurableObjectState, env: Env) {
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/connect') return this.connectServer(request)
    if (url.pathname === '/proxy') return this.proxyRequest(request)
    if (url.pathname === '/command') return this.command(request)
    if (url.pathname === '/websocket') return this.proxyWebSocket(request)
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
      for (const socket of this.publicSockets.values()) socket.close(1011, 'Plugin server disconnected')
      this.publicSockets.clear()
    })
    server.send(JSON.stringify(makeFrame('hello', this.serverId, { message: 'server connection accepted' })))
    return new Response(null, { status: 101, webSocket: client })
  }

  private async proxyRequest(request: Request): Promise<Response> {
    if (!this.serverSocket || this.serverSocket.readyState !== WebSocket.OPEN) return new Response('Plugin server is offline', { status: 503 })
    const requestId = crypto.randomUUID()
    const body = await request.text()
    const pluginId = request.headers.get('x-plugmesh-plugin-id') ?? undefined
    const requestPath = request.headers.get('x-plugmesh-request-path') ?? (() => {
      const url = new URL(request.url)
      return url.pathname + url.search
    })()
    const frame = makeFrame('request.open', this.serverId, {
      method: request.method,
      path: requestPath,
      headers: Object.fromEntries(forwardedHeaders(request.headers)),
      body,
    }, pluginId)
    frame.requestId = requestId
    const response = new Promise<Response>((resolve) => {
      const pending: PendingResponse = { resolve, timer: 0, buffered: [] }
      pending.timer = setTimeout(() => {
        this.pending.delete(requestId)
        if (pending.writer) void pending.writer.abort('Plugin request timed out')
        else resolve(new Response('Plugin request timed out', { status: 504 }))
      }, 25_000) as unknown as number
      this.pending.set(requestId, pending)
    })
    this.serverSocket.send(JSON.stringify(frame))
    return response
  }

  private proxyWebSocket(request: Request): Response {
    if (!this.serverSocket || this.serverSocket.readyState !== WebSocket.OPEN) return new Response('Plugin server is offline', { status: 503 })
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket upgrade required', { status: 426 })
    const pair = new WebSocketPair()
    const client = pair[0]
    const socket = pair[1]
    const connectionId = crypto.randomUUID()
    const pluginId = request.headers.get('x-plugmesh-plugin-id') ?? undefined
    const requestPath = request.headers.get('x-plugmesh-request-path') ?? (() => {
      const url = new URL(request.url)
      return url.pathname + url.search
    })()
    socket.accept()
    this.publicSockets.set(connectionId, socket)
    socket.addEventListener('message', (event) => {
      const data = typeof event.data === 'string' ? event.data : encodeBytes(new Uint8Array(event.data as ArrayBuffer))
      this.serverSocket?.send(JSON.stringify(makeFrame('stream.chunk', this.serverId, { connectionId, data }, pluginId)))
    })
    socket.addEventListener('close', () => {
      this.publicSockets.delete(connectionId)
      this.serverSocket?.send(JSON.stringify(makeFrame('stream.close', this.serverId, { connectionId }, pluginId)))
    })
    this.serverSocket.send(JSON.stringify(makeFrame('stream.open', this.serverId, {
      connectionId,
      path: requestPath,
      headers: Object.fromEntries(forwardedHeaders(request.headers)),
    }, pluginId)))
    return new Response(null, { status: 101, webSocket: client })
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
    if (frame.type === 'request.open') {
      this.openResponse(frame.requestId, frame.payload ?? {})
      return
    }
    if (frame.type === 'request.chunk') {
      this.writeResponseChunk(frame.requestId, frame.payload ?? {})
      return
    }
    if (frame.type === 'request.close') {
      this.closeResponse(frame.requestId, frame.payload ?? {})
      return
    }
    if (frame.type === 'stream.chunk') {
      const connectionId = typeof frame.payload?.connectionId === 'string' ? frame.payload.connectionId : frame.requestId
      const socket = this.publicSockets.get(connectionId)
      const data = frame.payload?.data
      if (socket && typeof data === 'string' && socket.readyState === WebSocket.OPEN) socket.send(data)
      return
    }
    if (frame.type === 'stream.close') {
      const connectionId = typeof frame.payload?.connectionId === 'string' ? frame.payload.connectionId : frame.requestId
      this.publicSockets.get(connectionId)?.close(1000, 'Plugin stream closed')
      this.publicSockets.delete(connectionId)
    }
  }

  private openResponse(requestId: string, payload: Record<string, unknown>) {
    const pending = this.pending.get(requestId)
    if (!pending || pending.writer) return
    const stream = new TransformStream<Uint8Array, Uint8Array>()
    pending.writer = stream.writable.getWriter()
    pending.resolve(new Response(stream.readable, { status: typeof payload.status === 'number' ? payload.status : 200, headers: responseHeaders(payload.headers) }))
    for (const chunk of pending.buffered.splice(0)) void pending.writer.write(new TextEncoder().encode(chunk))
  }

  private writeResponseChunk(requestId: string, payload: Record<string, unknown>) {
    const pending = this.pending.get(requestId)
    const chunk = typeof payload.data === 'string' ? payload.data : typeof payload.chunk === 'string' ? payload.chunk : ''
    if (!pending || !chunk) return
    if (pending.writer) void pending.writer.write(new TextEncoder().encode(chunk))
    else pending.buffered.push(chunk)
  }

  private closeResponse(requestId: string, payload: Record<string, unknown>) {
    const pending = this.pending.get(requestId)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(requestId)
    if (pending.writer) {
      void pending.writer.close()
      return
    }
    const body = typeof payload.body === 'string' ? payload.body : pending.buffered.join('')
    pending.resolve(new Response(body, { status: typeof payload.status === 'number' ? payload.status : 200, headers: responseHeaders(payload.headers) }))
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

function responseHeaders(value: unknown): Headers {
  const headers = new Headers()
  if (!value || typeof value !== 'object') return headers
  for (const [key, item] of Object.entries(value)) if (typeof item === 'string') headers.set(key, item)
  return headers
}

function forwardedHeaders(headers: Headers): Headers {
  const result = new Headers(headers)
  result.delete('x-plugmesh-server-id')
  result.delete('x-plugmesh-plugin-id')
  result.delete('x-plugmesh-request-path')
  return result
}

function encodeBytes(bytes: Uint8Array): string {
  let value = ''
  for (const byte of bytes) value += String.fromCharCode(byte)
  return btoa(value)
}
