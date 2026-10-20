import { isManifest, makeFrame, parseControlFrame } from './protocol'
import type { Env } from './types'

type PendingResponse = {
  resolve: (value: Response | PromiseLike<Response>) => void
  timer: number
  writer?: WritableStreamDefaultWriter<Uint8Array>
  buffered: Uint8Array[]
}

type PendingCommand = {
  resolve: (value: { ok: boolean; state?: string; error?: string }) => void
  timer: number
}

export class PluginBridge {
  private serverSocket: WebSocket | null = null
  private serverId = ''
  private env: Env
  private pending = new Map<string, PendingResponse>()
  private pendingCommands = new Map<string, PendingCommand>()
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
    const previousServer = this.serverSocket
    this.serverSocket = server
    previousServer?.close(1012, 'Replaced by a new connection')
    server.addEventListener('message', (event) => this.handleServerMessage(event.data))
    server.addEventListener('close', () => {
      if (this.serverSocket !== server) return
      this.serverSocket = null
      void this.markServerOffline()
      this.failPendingRequests('Plugin server disconnected', 503)
      this.failPendingCommands('Plugin server disconnected')
      this.closePublicSockets(1011, 'Plugin server disconnected')
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
    const sse = request.headers.get('accept')?.toLowerCase().includes('text/event-stream') === true
    const frame = makeFrame(sse ? 'stream.open' : 'request.open', this.serverId, {
      method: request.method,
      path: requestPath,
      headers: Object.fromEntries(forwardedHeaders(request.headers)),
      body,
      ...(sse ? { streamId: requestId } : {}),
    }, pluginId)
    frame.requestId = requestId
    const response = new Promise<Response>((resolve) => {
      const pending: PendingResponse = { resolve, timer: 0, buffered: [] }
      pending.timer = setTimeout(() => {
        this.pending.delete(requestId)
        pending.buffered = []
        if (pending.writer) void pending.writer.abort('Plugin request timed out').catch(() => undefined)
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
      const binary = typeof event.data !== 'string'
      const data = binary ? encodeBytes(new Uint8Array(event.data as ArrayBuffer)) : event.data
      this.serverSocket?.send(JSON.stringify(makeFrame('stream.chunk', this.serverId, { connectionId, data, encoding: binary ? 'base64' : 'text' }, pluginId)))
    })
    socket.addEventListener('close', () => {
      if (this.publicSockets.get(connectionId) !== socket) return
      this.publicSockets.delete(connectionId)
      if (this.serverSocket?.readyState === WebSocket.OPEN) {
        this.serverSocket.send(JSON.stringify(makeFrame('stream.close', this.serverId, { connectionId }, pluginId)))
      }
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
    const result = await this.sendPluginCommand(body.type, body.pluginId)
    const requestId = result.requestId
    if (!result.ok) return new Response(JSON.stringify({ accepted: false, requestId, error: result.error ?? 'Plugin command failed' }), { status: 502, headers: { 'content-type': 'application/json' } })
    return new Response(JSON.stringify({ accepted: true, requestId, state: result.state ?? null }), { status: 202, headers: { 'content-type': 'application/json' } })
  }

  private async sendPluginCommand(type: string, pluginId?: string): Promise<{ ok: boolean; state?: string; error?: string; requestId: string }> {
    const frame = makeFrame(type, this.serverId, {}, pluginId)
    if (!this.serverSocket || this.serverSocket.readyState !== WebSocket.OPEN) return { ok: false, error: 'Plugin server is offline', requestId: frame.requestId }
    const result = await new Promise<{ ok: boolean; state?: string; error?: string }>((resolve) => {
      const pending: PendingCommand = { resolve, timer: 0 }
      pending.timer = setTimeout(() => {
        this.pendingCommands.delete(frame.requestId)
        resolve({ ok: false, error: 'Plugin command timed out' })
      }, 15_000) as unknown as number
      this.pendingCommands.set(frame.requestId, pending)
      try {
        this.serverSocket?.send(JSON.stringify(frame))
      } catch {
        clearTimeout(pending.timer)
        this.pendingCommands.delete(frame.requestId)
        resolve({ ok: false, error: 'Plugin command could not be sent' })
      }
    })
    return { ...result, requestId: frame.requestId }
  }

  private failPendingRequests(message: string, status: number) {
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timer)
      this.pending.delete(requestId)
      pending.buffered = []
      if (pending.writer) void pending.writer.abort(message).catch(() => undefined)
      else pending.resolve(new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } }))
    }
  }

  private failPendingCommands(error: string) {
    for (const [requestId, pending] of this.pendingCommands) {
      clearTimeout(pending.timer)
      this.pendingCommands.delete(requestId)
      pending.resolve({ ok: false, error })
    }
  }

  private closePublicSockets(code: number, reason: string) {
    const sockets = [...this.publicSockets.values()]
    this.publicSockets.clear()
    for (const socket of sockets) socket.close(code, reason)
  }

  private handleServerMessage(data: string | ArrayBuffer) {
    const raw = typeof data === 'string' ? data : new TextDecoder().decode(data)
    const frame = parseControlFrame(raw)
    if (!frame) return
    if (frame.type === 'plugin.result' || frame.type === 'error') {
      const pending = this.pendingCommands.get(frame.requestId)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pendingCommands.delete(frame.requestId)
      const ok = frame.type === 'plugin.result' && frame.payload?.ok === true
      pending.resolve({ ok, state: typeof frame.payload?.state === 'string' ? frame.payload.state : undefined, error: typeof frame.payload?.error === 'string' ? frame.payload.error : typeof frame.payload?.message === 'string' ? frame.payload.message : undefined })
      return
    }
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
      this.writeResponseChunk(frame.requestId, frame.payload ?? {}, false)
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
      const encoding = frame.payload?.encoding
      if (socket && typeof data === 'string' && socket.readyState === WebSocket.OPEN) socket.send(encoding === 'base64' ? decodeBytes(data) : data)
      else if (!socket) this.writeResponseChunk(connectionId, frame.payload ?? {}, true)
      return
    }
    if (frame.type === 'stream.close') {
      const connectionId = typeof frame.payload?.connectionId === 'string' ? frame.payload.connectionId : frame.requestId
      const socket = this.publicSockets.get(connectionId)
      if (socket) {
        socket.close(1000, 'Plugin stream closed')
        this.publicSockets.delete(connectionId)
      } else this.closeResponse(connectionId, frame.payload ?? {})
    }
  }

  private openResponse(requestId: string, payload: Record<string, unknown>) {
    const pending = this.pending.get(requestId)
    if (!pending || pending.writer) return
    const stream = new TransformStream<Uint8Array, Uint8Array>()
    pending.writer = stream.writable.getWriter()
    pending.resolve(new Response(stream.readable, { status: typeof payload.status === 'number' ? payload.status : 200, headers: responseHeaders(payload.headers) }))
    for (const chunk of pending.buffered.splice(0)) void pending.writer.write(chunk)
  }

  private writeResponseChunk(requestId: string, payload: Record<string, unknown>, streaming: boolean) {
    const targetId = typeof payload.connectionId === 'string' ? payload.connectionId : typeof payload.streamId === 'string' ? payload.streamId : requestId
    const pending = this.pending.get(targetId)
    const chunk = typeof payload.data === 'string' ? payload.data : typeof payload.chunk === 'string' ? payload.chunk : ''
    if (!pending || !chunk) return
    const bytes = payload.encoding === 'base64' ? decodeBytes(chunk) : new TextEncoder().encode(chunk)
    if (!pending.writer && streaming) this.openResponse(targetId, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' } })
    if (pending.writer) void pending.writer.write(bytes)
    else pending.buffered.push(bytes)
  }

  private closeResponse(requestId: string, payload: Record<string, unknown>) {
    const pending = this.pending.get(requestId)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(requestId)
    if (pending.writer) {
      void pending.writer.close().catch(() => undefined)
      return
    }
    const body = typeof payload.body === 'string' ? payload.body : toArrayBuffer(combineBytes(pending.buffered))
    pending.resolve(new Response(body, { status: typeof payload.status === 'number' ? payload.status : 200, headers: responseHeaders(payload.headers) }))
  }

  private async markServerOnline() {
    if (!this.serverId) return
    await this.env.DB.prepare('UPDATE servers SET status = ?, last_seen_at = ? WHERE id = ?').bind('online', new Date().toISOString(), this.serverId).run()
  }

  private async markServerOffline() {
    if (!this.serverId) return
    await this.env.DB.batch([
      this.env.DB.prepare('UPDATE servers SET status = ?, last_seen_at = ? WHERE id = ?').bind('offline', new Date().toISOString(), this.serverId),
      this.env.DB.prepare('UPDATE plugin_instances SET state = ?, updated_at = ? WHERE server_id = ? AND state != ?').bind('server_offline', new Date().toISOString(), this.serverId, 'server_offline'),
    ])
  }

  private async registerServer(payload: Record<string, unknown>) {
    await this.markServerOnline()
    const server = await this.env.DB.prepare('SELECT user_id FROM servers WHERE id = ?').bind(this.serverId).first<{ user_id: string }>()
    const manifests = Array.isArray(payload.manifests) ? payload.manifests.filter(isManifest) : []
    if (!server || manifests.length === 0) return
    const now = new Date().toISOString()
    for (const manifest of manifests) {
      await this.env.DB.prepare(`
        INSERT INTO plugin_instances (id, user_id, server_id, plugin_id, name, version, state, desired_state, manifest_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(server_id, plugin_id) DO UPDATE SET name = excluded.name, version = excluded.version, manifest_json = excluded.manifest_json, state = CASE WHEN plugin_instances.state = 'server_offline' THEN 'discovered' ELSE plugin_instances.state END, updated_at = excluded.updated_at
      `).bind(crypto.randomUUID(), server.user_id, this.serverId, manifest.id, manifest.name, manifest.version, 'discovered', 'discovered', JSON.stringify(manifest), now, now).run()
    }
    const desired = await this.env.DB.prepare('SELECT id, plugin_id, desired_state FROM plugin_instances WHERE server_id = ? AND desired_state IN (?, ?, ?)').bind(this.serverId, 'loaded', 'enabled', 'disabled').all<{ id: string; plugin_id: string; desired_state: string }>()
    for (const plugin of desired.results) {
      const action = plugin.desired_state === 'loaded' ? 'plugin.load' : plugin.desired_state === 'enabled' ? 'plugin.enable' : 'plugin.load'
      const loaded = await this.sendPluginCommand(action, plugin.plugin_id)
      if (!loaded.ok) {
        await this.env.DB.prepare('UPDATE plugin_instances SET state = ?, updated_at = ? WHERE id = ?').bind('failed', new Date().toISOString(), plugin.id).run()
        continue
      }
      if (plugin.desired_state === 'disabled') {
        const disabled = await this.sendPluginCommand('plugin.disable', plugin.plugin_id)
        if (!disabled.ok) {
          await this.env.DB.prepare('UPDATE plugin_instances SET state = ?, updated_at = ? WHERE id = ?').bind('failed', new Date().toISOString(), plugin.id).run()
          continue
        }
      }
      const state = plugin.desired_state
      await this.env.DB.prepare('UPDATE plugin_instances SET state = ?, updated_at = ? WHERE id = ?').bind(state, new Date().toISOString(), plugin.id).run()
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

function decodeBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function combineBytes(chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const result = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(result).set(bytes)
  return result
}
