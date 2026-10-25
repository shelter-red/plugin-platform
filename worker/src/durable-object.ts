import { isManifest, makeFrame, MAX_CONTROL_FRAME_BYTES, parseControlFrame } from './protocol'
import type { ControlFrame, Env } from './types'
import { activateMaintenance, getPlatformSettings, releaseActiveConnection, releaseR2Usage, reserveActiveConnection, reserveR2Usage } from './usage'
import { hashControlToken } from './security'
import { parseResponseStatus, responseHeaders } from './response-validation'
import { restorePluginState, type RestorablePluginState } from './plugin-restore'

const MAX_PROXY_REQUEST_BODY_BYTES = 32 * 1024
const MAX_PROXY_RESPONSE_BODY_BYTES = 16 * 1024 * 1024
const MAX_WEBSOCKET_MESSAGE_BYTES = 32 * 1024
const FILE_STREAM_R2_THRESHOLD_BYTES = 1024 * 1024
const CONTROL_FRAME_TIME_WINDOW_MS = 5 * 60 * 1000
const MAX_SEEN_CONTROL_NONCES = 2048

type PendingResponse = {
  resolve: (value: Response | PromiseLike<Response>) => void
  timer: number
  writer?: WritableStreamDefaultWriter<Uint8Array>
  buffered: Uint8Array[]
  activeConnection?: boolean
  pluginId?: string
  sse?: boolean
  bytes: number
  fileStream?: boolean
  responseStatus?: number
  responseHeaders?: Headers
  fileWriteChain: Promise<void>
  cancelled?: boolean
  r2Upload?: {
    key: string
    writer: WritableStreamDefaultWriter<Uint8Array>
    upload: Promise<void>
  }
}

type PendingCommand = {
  resolve: (value: { ok: boolean; state?: string; status?: number; bodySize?: number; payload?: Record<string, unknown>; error?: string }) => void
  timer: number
}

export class PluginBridge {
  private serverSocket: WebSocket | null = null
  private serverId = ''
  private env: Env
  private pending = new Map<string, PendingResponse>()
  private pendingCommands = new Map<string, PendingCommand>()
  private publicSockets = new Map<string, WebSocket>()
  private reservedPublicConnections = new Set<string>()
  private seenControlNonces = new Map<string, number>()

  constructor(_state: DurableObjectState, env: Env) {
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/status') return Response.json({ online: Boolean(this.serverSocket && this.serverSocket.readyState === WebSocket.OPEN) })
    if (url.pathname === '/connect') return this.connectServer(request)
    if (url.pathname === '/proxy') return this.proxyRequest(request)
    if (url.pathname === '/command') return this.command(request)
    if (url.pathname === '/tunnel/open') return this.openTunnel(request)
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
      this.failPendingRequests('Plugin server disconnected', 503)
      this.failPendingCommands('Plugin server disconnected')
      this.closePublicSockets(1011, 'Plugin server disconnected')
    })
    server.send(JSON.stringify(makeFrame('hello', this.serverId, { message: 'server connection accepted' })))
    return new Response(null, { status: 101, webSocket: client })
  }

  private async proxyRequest(request: Request): Promise<Response> {
    if (!this.serverSocket || this.serverSocket.readyState !== WebSocket.OPEN) return serverOfflineResponse()
    const requestId = crypto.randomUUID()
    const bodyResult = await readRequestBody(request, MAX_PROXY_REQUEST_BODY_BYTES)
    if (!bodyResult.ok) return new Response('Plugin request body is too large', { status: 413 })
    const body = bodyResult.body
    const pluginId = request.headers.get('x-plugmesh-plugin-id') ?? undefined
    const requestPath = request.headers.get('x-plugmesh-request-path') ?? (() => {
      const url = new URL(request.url)
      return url.pathname + url.search
    })()
    const mode = request.headers.get('x-plugmesh-request-mode')
    const sse = mode === 'sse' || (!mode && request.headers.get('accept')?.toLowerCase().includes('text/event-stream') === true)
    const frame = makeFrame(sse ? 'stream.open' : 'request.open', this.serverId, {
      method: request.method,
      path: requestPath,
      headers: Object.fromEntries(forwardedHeaders(request.headers)),
      body: encodeBytes(body),
      bodyEncoding: 'base64',
      ...(!sse ? { mode: mode === 'file' ? 'file' : 'http' } : {}),
      ...(sse ? { streamId: requestId } : {}),
    }, pluginId)
    frame.requestId = requestId
    const serializedFrame = JSON.stringify(frame)
    if (new TextEncoder().encode(serializedFrame).byteLength > MAX_CONTROL_FRAME_BYTES) return new Response('Plugin request is too large for the control channel', { status: 413 })
    let activeConnection = false
    if (sse) {
      const settings = await getPlatformSettings(this.env)
      if (!await reserveActiveConnection(this.env, settings.quotas)) {
        await activateMaintenance(this.env, 'active connection quota reached')
        return new Response('Platform quota reached', { status: 503 })
      }
      activeConnection = true
    }
    const response = new Promise<Response>((resolve) => {
      const pending: PendingResponse = { resolve, timer: 0, buffered: [], activeConnection, pluginId, sse, bytes: 0, fileWriteChain: Promise.resolve() }
      pending.timer = setTimeout(() => {
        pending.cancelled = true
        this.pending.delete(requestId)
        pending.buffered = []
        this.releasePendingConnection(pending)
        void this.discardR2Upload(pending)
        if (pending.writer) void pending.writer.abort('Plugin request timed out').catch(() => undefined)
        else resolve(new Response('Plugin request timed out', { status: 504 }))
      }, 25_000) as unknown as number
      this.pending.set(requestId, pending)
    })
    try {
      this.serverSocket.send(serializedFrame)
    } catch {
      const pending = this.pending.get(requestId)
      if (pending) {
        clearTimeout(pending.timer)
        this.pending.delete(requestId)
        pending.buffered = []
        this.releasePendingConnection(pending)
        void this.discardR2Upload(pending)
      }
      return new Response('Plugin request could not be sent', { status: 502 })
    }
    return response
  }

  private async proxyWebSocket(request: Request): Promise<Response> {
    if (!this.serverSocket || this.serverSocket.readyState !== WebSocket.OPEN) return serverOfflineResponse()
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket upgrade required', { status: 426 })
    const settings = await getPlatformSettings(this.env)
    if (!await reserveActiveConnection(this.env, settings.quotas)) {
      await activateMaintenance(this.env, 'active connection quota reached')
      return new Response('Platform quota reached', { status: 503 })
    }
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
    this.reservedPublicConnections.add(connectionId)
    socket.addEventListener('message', (event) => {
      const binary = typeof event.data !== 'string'
      const raw = binary ? new Uint8Array(event.data as ArrayBuffer) : new TextEncoder().encode(event.data)
      if (raw.byteLength > MAX_WEBSOCKET_MESSAGE_BYTES) {
        socket.close(1009, 'WebSocket message is too large')
        return
      }
      const data = binary ? encodeBytes(raw) : event.data
      const frame = makeFrame('stream.chunk', this.serverId, { connectionId, data, encoding: binary ? 'base64' : 'text' }, pluginId)
      const serializedFrame = JSON.stringify(frame)
      if (new TextEncoder().encode(serializedFrame).byteLength > MAX_CONTROL_FRAME_BYTES) {
        socket.close(1009, 'WebSocket message is too large')
        return
      }
      try {
        this.serverSocket?.send(serializedFrame)
      } catch {
        socket.close(1011, 'Plugin server unavailable')
      }
    })
    socket.addEventListener('close', (event) => {
      if (this.publicSockets.get(connectionId) !== socket) return
      this.publicSockets.delete(connectionId)
      if (this.reservedPublicConnections.delete(connectionId)) void releaseActiveConnection(this.env)
      if (this.serverSocket?.readyState === WebSocket.OPEN) {
        try {
          this.serverSocket.send(JSON.stringify(makeFrame('stream.close', this.serverId, { connectionId, code: event.code, reason: event.reason.slice(0, 123) }, pluginId)))
        } catch {
          // The server may disconnect between the readyState check and send.
        }
      }
    })
    try {
      const frame = makeFrame('stream.open', this.serverId, {
        connectionId,
        path: requestPath,
        headers: Object.fromEntries(forwardedHeaders(request.headers)),
      }, pluginId)
      const serializedFrame = JSON.stringify(frame)
      if (new TextEncoder().encode(serializedFrame).byteLength > MAX_CONTROL_FRAME_BYTES) throw new Error('control frame is too large')
      this.serverSocket.send(serializedFrame)
    } catch {
      this.publicSockets.delete(connectionId)
      this.reservedPublicConnections.delete(connectionId)
      void releaseActiveConnection(this.env)
      socket.close(1011, 'Plugin server unavailable')
      return new Response('Plugin server unavailable', { status: 503 })
    }
    return new Response(null, { status: 101, webSocket: client })
  }

  private async command(request: Request): Promise<Response> {
    if (request.method !== 'POST' || request.headers.get('x-plugmesh-server-id') !== this.serverId) return new Response('Forbidden', { status: 403 })
    if (!this.serverSocket || this.serverSocket.readyState !== WebSocket.OPEN) return new Response('Plugin server is offline', { status: 503 })
    const body = await request.json().catch(() => null) as { type?: string; pluginId?: string } | null
    if (!body?.type || (!body.type.startsWith('plugin.') && body.type !== 'server.sync')) return new Response('Invalid command', { status: 400 })
    const result = await this.sendPluginCommand(body.type, body.pluginId)
    const requestId = result.requestId
    if (!result.ok) return new Response(JSON.stringify({ accepted: false, requestId, error: result.error ?? 'Plugin command failed' }), { status: 502, headers: { 'content-type': 'application/json' } })
    return new Response(JSON.stringify({ accepted: true, requestId, state: result.state ?? null, status: result.status ?? null, bodySize: result.bodySize ?? null, payload: result.payload ?? null }), { status: 202, headers: { 'content-type': 'application/json' } })
  }

  private async openTunnel(request: Request): Promise<Response> {
    if (request.method !== 'POST' || request.headers.get('x-plugmesh-server-id') !== this.serverId) return new Response('Forbidden', { status: 403 })
    if (!this.serverSocket || this.serverSocket.readyState !== WebSocket.OPEN) return new Response('Plugin server is offline', { status: 503 })
    const body = await request.json().catch(() => null) as { sessionId?: unknown; sourceServerId?: unknown; targetHost?: unknown; targetPort?: unknown; protocol?: unknown } | null
    if (!body || typeof body.sessionId !== 'string' || typeof body.sourceServerId !== 'string' || typeof body.targetHost !== 'string' || !Number.isInteger(body.targetPort) || typeof body.protocol !== 'string') return new Response('Invalid tunnel request', { status: 400 })
    try {
      this.serverSocket.send(JSON.stringify(makeFrame('tunnel.open', this.serverId, {
        sessionId: body.sessionId,
        sourceServerId: body.sourceServerId,
        targetHost: body.targetHost,
        targetPort: body.targetPort,
        protocol: body.protocol,
      })))
      return new Response(null, { status: 202 })
    } catch {
      return new Response('Tunnel request could not be sent', { status: 502 })
    }
  }

  private async sendPluginCommand(type: string, pluginId?: string): Promise<{ ok: boolean; state?: string; status?: number; bodySize?: number; payload?: Record<string, unknown>; error?: string; requestId: string }> {
    const frame = makeFrame(type, this.serverId, {}, pluginId)
    if (!this.serverSocket || this.serverSocket.readyState !== WebSocket.OPEN) return { ok: false, error: 'Plugin server is offline', requestId: frame.requestId }
    const result = await new Promise<{ ok: boolean; state?: string; status?: number; bodySize?: number; payload?: Record<string, unknown>; error?: string }>((resolve) => {
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
      pending.cancelled = true
      pending.buffered = []
      this.releasePendingConnection(pending)
      void this.discardR2Upload(pending)
      if (pending.writer) void pending.writer.abort(message).catch(() => undefined)
      else pending.resolve(new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...(status === 503 ? { 'x-plugmesh-bridge-error': 'server-offline' } : {}) } }))
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
    const sockets = [...this.publicSockets.entries()]
    this.publicSockets.clear()
    for (const [connectionId, socket] of sockets) {
      if (this.reservedPublicConnections.delete(connectionId)) void releaseActiveConnection(this.env)
      socket.close(code, reason)
    }
  }

  private handleServerMessage(data: string | ArrayBuffer) {
    const raw = typeof data === 'string' ? data : new TextDecoder().decode(data)
    const frame = parseControlFrame(raw)
    if (!frame) return
    if (frame.serverId !== this.serverId) return
    if (!this.acceptControlFrame(frame)) return
    if (frame.type === 'plugin.result' || frame.type === 'server.result' || frame.type === 'error') {
      const pending = this.pendingCommands.get(frame.requestId)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pendingCommands.delete(frame.requestId)
      const ok = (frame.type === 'plugin.result' || frame.type === 'server.result') && frame.payload?.ok === true
      pending.resolve({
        ok,
        state: typeof frame.payload?.state === 'string' ? frame.payload.state : undefined,
        status: typeof frame.payload?.status === 'number' ? frame.payload.status : undefined,
        bodySize: typeof frame.payload?.bodySize === 'number' ? frame.payload.bodySize : undefined,
         payload: frame.payload && typeof frame.payload === 'object' ? frame.payload as Record<string, unknown> : undefined,
        error: typeof frame.payload?.error === 'string' ? frame.payload.error : typeof frame.payload?.message === 'string' ? frame.payload.message : undefined,
      })
      return
    }
    if (frame.type === 'server.register') {
      const payload = frame.payload ?? {}
      const syncRequestId = typeof payload.syncRequestId === 'string' ? payload.syncRequestId : ''
      if (syncRequestId) void this.completeServerSync(payload, syncRequestId)
      else void this.registerServer(payload)
      return
    }
    if (frame.type === 'server.heartbeat') {
      return
    }
    if (frame.type === 'server.rotate' || frame.type === 'server.revoke') {
      void this.handleServerBindingAction(frame)
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
      if (socket && typeof data === 'string' && socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(encoding === 'base64' ? decodeBytes(data) : data)
        } catch {
          socket.close(1007, 'Invalid plugin stream data')
        }
      } else if (!socket) this.writeResponseChunk(connectionId, frame.payload ?? {}, true)
      return
    }
    if (frame.type === 'stream.close') {
      const connectionId = typeof frame.payload?.connectionId === 'string' ? frame.payload.connectionId : frame.requestId
      const socket = this.publicSockets.get(connectionId)
      if (socket) {
        const requestedCode = typeof frame.payload?.code === 'number' && Number.isInteger(frame.payload.code) ? frame.payload.code : 1000
        const code = requestedCode >= 1000 && requestedCode <= 4999 ? requestedCode : 1000
        const reason = typeof frame.payload?.reason === 'string' ? frame.payload.reason.slice(0, 123) : 'Plugin stream closed'
        socket.close(code, reason)
        this.publicSockets.delete(connectionId)
        if (this.reservedPublicConnections.delete(connectionId)) void releaseActiveConnection(this.env)
      } else this.closeResponse(connectionId, frame.payload ?? {})
    }
  }

  private acceptControlFrame(frame: ControlFrame): boolean {
    const now = Date.now()
    const timestamp = Date.parse(frame.timestamp)
    if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > CONTROL_FRAME_TIME_WINDOW_MS || !frame.nonce) return false
    const cutoff = now - CONTROL_FRAME_TIME_WINDOW_MS
    for (const [nonce, seenAt] of this.seenControlNonces) {
      if (seenAt >= cutoff) break
      this.seenControlNonces.delete(nonce)
    }
    if (this.seenControlNonces.has(frame.nonce)) return false
    this.seenControlNonces.set(frame.nonce, now)
    while (this.seenControlNonces.size > MAX_SEEN_CONTROL_NONCES) this.seenControlNonces.delete(this.seenControlNonces.keys().next().value as string)
    return true
  }

  private async handleServerBindingAction(frame: ControlFrame) {
    try {
      const owner = await this.env.DB.prepare('SELECT user_id, workspace_id FROM servers WHERE id = ?').bind(this.serverId).first<{ user_id: string; workspace_id: string }>()
      if (frame.type === 'server.rotate') {
        const accessToken = crypto.randomUUID() + crypto.randomUUID()
        const updated = await this.env.DB.prepare('UPDATE servers SET token_hash = ? WHERE id = ? AND status != ?').bind(await hashControlToken(accessToken), this.serverId, 'revoked').run()
        if ((updated.meta.changes ?? 0) !== 1) {
          this.sendServerActionError(frame.requestId, 'Server binding is revoked or unavailable')
          return
        }
        if (owner) await this.recordBindingAudit(owner.workspace_id, owner.user_id, 'server.rotated')
        const result = makeFrame('server.result', this.serverId, { ok: true, action: 'rotate', accessToken })
        result.requestId = frame.requestId
        this.serverSocket?.send(JSON.stringify(result))
        return
      }
      const updated = await this.env.DB.batch([
        this.env.DB.prepare('UPDATE servers SET status = ?, last_seen_at = ? WHERE id = ? AND status != ?').bind('revoked', new Date().toISOString(), this.serverId, 'revoked'),
        this.env.DB.prepare('UPDATE plugin_instances SET state = ?, updated_at = ? WHERE server_id = ? AND state != ?').bind('server_offline', new Date().toISOString(), this.serverId, 'server_offline'),
        this.env.DB.prepare('UPDATE domains SET status = ? WHERE plugin_instance_id IN (SELECT id FROM plugin_instances WHERE server_id = ?)').bind('offline', this.serverId),
      ])
      if ((updated[0]?.meta.changes ?? 0) !== 1) {
        this.sendServerActionError(frame.requestId, 'Server binding is already revoked or unavailable')
        return
      }
      if (owner) await this.recordBindingAudit(owner.workspace_id, owner.user_id, 'server.revoked')
      const result = makeFrame('server.result', this.serverId, { ok: true, action: 'revoke' })
      result.requestId = frame.requestId
      this.serverSocket?.send(JSON.stringify(result))
      setTimeout(() => this.serverSocket?.close(1000, 'Server binding revoked'), 50)
    } catch {
      this.sendServerActionError(frame.requestId, 'Server binding action failed')
    }
  }

  // 轮换与撤销会改变长期密钥和绑定关系，必须写入审计；详情只记服务器 ID，不落令牌。
  private async recordBindingAudit(workspaceId: string, userId: string, action: 'server.rotated' | 'server.revoked') {
    await this.env.DB.prepare('INSERT INTO audit_log (id, workspace_id, user_id, action, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), workspaceId, userId, action, JSON.stringify({ serverId: this.serverId }), new Date().toISOString()).run()
  }

  private sendServerActionError(requestId: string, message: string) {
    const frame = makeFrame('error', this.serverId, { message })
    frame.requestId = requestId
    this.serverSocket?.send(JSON.stringify(frame))
  }

  private openResponse(requestId: string, payload: Record<string, unknown>) {
    const pending = this.pending.get(requestId)
    if (!pending || pending.writer) return
    const status = parseResponseStatus(payload.status ?? 200)
    if (status === null) {
      this.rejectPendingResponse(requestId, pending, 'Plugin response status is invalid')
      return
    }
    const headers = responseHeaders(payload.headers)
    if (payload.fileStream === true) {
      pending.fileStream = true
      pending.responseStatus = status
      pending.responseHeaders = headers
      return
    }
    const stream = new TransformStream<Uint8Array, Uint8Array>()
    pending.writer = stream.writable.getWriter()
    void pending.writer.closed.catch(() => this.cancelPendingResponse(requestId, pending, 'Client disconnected'))
    pending.resolve(new Response(stream.readable, { status, headers }))
    for (const chunk of pending.buffered.splice(0)) void pending.writer.write(chunk).catch(() => this.rejectPendingResponse(requestId, pending, 'Plugin response stream failed'))
  }

  private writeResponseChunk(requestId: string, payload: Record<string, unknown>, streaming: boolean) {
    const targetId = typeof payload.connectionId === 'string' ? payload.connectionId : typeof payload.streamId === 'string' ? payload.streamId : requestId
    const pending = this.pending.get(targetId)
    const chunk = typeof payload.data === 'string' ? payload.data : typeof payload.chunk === 'string' ? payload.chunk : ''
    if (!pending || !chunk) return
    let bytes: Uint8Array
    try {
      bytes = payload.encoding === 'base64' ? decodeBytes(chunk) : new TextEncoder().encode(chunk)
    } catch {
      this.rejectPendingResponse(targetId, pending, 'Plugin response encoding is invalid')
      return
    }
    if (pending.bytes + bytes.byteLength > MAX_PROXY_RESPONSE_BODY_BYTES) {
      this.rejectPendingResponse(targetId, pending, 'Plugin response is too large')
      return
    }
    pending.bytes += bytes.byteLength
    if (pending.fileStream) {
      this.writeFileChunk(pending, bytes)
      return
    }
    if (!pending.writer && streaming) this.openResponse(targetId, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' } })
    if (pending.writer) void pending.writer.write(bytes).catch(() => this.rejectPendingResponse(targetId, pending, 'Plugin response stream failed'))
    else pending.buffered.push(bytes)
  }

  private closeResponse(requestId: string, payload: Record<string, unknown>) {
    const pending = this.pending.get(requestId)
    if (!pending) return
    clearTimeout(pending.timer)
    if (pending.fileStream) {
      void this.finishFileResponse(requestId, pending, payload)
      return
    }
    if (pending.writer) {
      this.pending.delete(requestId)
      this.releasePendingConnection(pending)
      void pending.writer.close().catch(() => undefined)
      return
    }
    const status = parseResponseStatus(payload.status ?? 200)
    if (status === null) {
      this.rejectPendingResponse(requestId, pending, 'Plugin response status is invalid')
      return
    }
    const body = typeof payload.body === 'string' ? payload.body : toArrayBuffer(combineBytes(pending.buffered))
    const bodyBytes = typeof body === 'string' ? new TextEncoder().encode(body) : new Uint8Array(body)
    if (bodyBytes.byteLength > MAX_PROXY_RESPONSE_BODY_BYTES) {
      this.rejectPendingResponse(requestId, pending, 'Plugin response is too large')
      return
    }
    this.pending.delete(requestId)
    this.releasePendingConnection(pending)
    pending.resolve(new Response(body, { status, headers: responseHeaders(payload.headers) }))
  }

  private writeFileChunk(pending: PendingResponse, bytes: Uint8Array) {
    if (!pending.r2Upload && pending.bytes > FILE_STREAM_R2_THRESHOLD_BYTES) {
      const contentLength = Number(pending.responseHeaders?.get('content-length') ?? '')
      if (Number.isSafeInteger(contentLength) && contentLength >= pending.bytes) {
        const stream = new FixedLengthStream(contentLength)
        const key = `stream/${crypto.randomUUID()}`
        const upload = { key, writer: stream.writable.getWriter(), upload: this.env.BLOB_BUCKET.put(key, stream.readable).then(() => undefined) }
        // Timeout or failure aborts the fixed-length stream, so the upload and later writes reject.
        // Handle them here so a timed-out stream never surfaces as an unhandled rejection;
        // finishFileResponse still fails on close() and cleans up.
        void upload.upload.catch(() => undefined)
        pending.r2Upload = upload
        const buffered = pending.buffered.splice(0)
        pending.fileWriteChain = pending.fileWriteChain.then(async () => {
          for (const chunk of buffered) await upload.writer.write(chunk)
          await upload.writer.write(bytes)
        }).catch(() => undefined)
        return
      }
    }
    if (pending.r2Upload) {
      const upload = pending.r2Upload
      pending.fileWriteChain = pending.fileWriteChain.then(() => upload.writer.write(bytes)).catch(() => undefined)
      return
    }
    pending.buffered.push(bytes)
  }

  private async finishFileResponse(requestId: string, pending: PendingResponse, payload: Record<string, unknown>) {
    let reserved = false
    let tempObjectCreated = false
    let tempObjectId: string | null = null
    let objectKey: string | null = null
    try {
      await pending.fileWriteChain
      if (pending.cancelled || this.pending.get(requestId) !== pending) throw new Error('Plugin file stream was cancelled')
      if (pending.r2Upload) {
        objectKey = pending.r2Upload.key
        await pending.r2Upload.writer.close()
        await pending.r2Upload.upload
        if (pending.cancelled || this.pending.get(requestId) !== pending) throw new Error('Plugin file stream was cancelled')
      } else if (pending.bytes > FILE_STREAM_R2_THRESHOLD_BYTES) {
        objectKey = `stream/${crypto.randomUUID()}`
        await this.env.BLOB_BUCKET.put(objectKey, combineBytes(pending.buffered))
        if (pending.cancelled || this.pending.get(requestId) !== pending) throw new Error('Plugin file stream was cancelled')
        pending.buffered = []
      }
      if (!objectKey) {
        const body = toArrayBuffer(combineBytes(pending.buffered))
        this.pending.delete(requestId)
        this.releasePendingConnection(pending)
        pending.resolve(new Response(body, { status: pending.responseStatus ?? (typeof payload.status === 'number' ? payload.status : 200), headers: pending.responseHeaders }))
        return
      }
      const settings = await getPlatformSettings(this.env)
      if (!await reserveR2Usage(this.env, settings.quotas, pending.bytes)) {
        await this.env.BLOB_BUCKET.delete(objectKey)
        await activateMaintenance(this.env, 'R2 storage quota reached')
        this.pending.delete(requestId)
        this.releasePendingConnection(pending)
        pending.resolve(new Response('Platform quota reached', { status: 503 }))
        return
      }
      reserved = true
      const object = await this.env.BLOB_BUCKET.get(objectKey)
      if (!object?.body) throw new Error('R2 file stream is unavailable')
      if (pending.cancelled || this.pending.get(requestId) !== pending) throw new Error('Plugin file stream was cancelled')
      tempObjectId = crypto.randomUUID()
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()
      await this.env.DB.prepare('INSERT INTO temp_objects (id, object_key, token_hash, content_type, size_bytes, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(tempObjectId, objectKey, await hashControlToken(crypto.randomUUID()), pending.responseHeaders?.get('content-type') ?? 'application/octet-stream', pending.bytes, expiresAt, new Date().toISOString()).run()
      tempObjectCreated = true
      if (pending.cancelled || this.pending.get(requestId) !== pending) throw new Error('Plugin file stream was cancelled')
      this.pending.delete(requestId)
      this.releasePendingConnection(pending)
      const headers = new Headers(pending.responseHeaders)
      if (!headers.has('content-length')) headers.set('content-length', String(pending.bytes))
      pending.resolve(new Response(this.consumeR2Stream(object.body, objectKey, pending.bytes, tempObjectId!), { status: pending.responseStatus ?? (typeof payload.status === 'number' ? payload.status : 200), headers }))
    } catch {
      if (pending.r2Upload) await pending.r2Upload.writer.abort('Plugin file stream failed').catch(() => undefined)
      if (tempObjectCreated && tempObjectId) await this.env.DB.prepare('DELETE FROM temp_objects WHERE id = ?').bind(tempObjectId).run().catch(() => undefined)
      const deleted = objectKey ? await deleteR2ObjectWithRetry(this.env, objectKey) : true
      if (reserved) {
        if (deleted) await releaseR2Usage(this.env, pending.bytes)
        else if (!tempObjectCreated) await this.trackUncollectedObject(objectKey ?? '', pending.bytes)
      }
      this.pending.delete(requestId)
      this.releasePendingConnection(pending)
      pending.resolve(new Response('Plugin file stream failed', { status: 502 }))
    }
  }

  private async trackUncollectedObject(objectKey: string, sizeBytes: number): Promise<void> {
    if (!objectKey) return
    const now = new Date().toISOString()
    await this.env.DB.prepare('INSERT OR IGNORE INTO temp_objects (id, object_key, token_hash, content_type, size_bytes, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), objectKey, await hashControlToken(crypto.randomUUID()), 'application/octet-stream', sizeBytes, now, now).run().catch(() => undefined)
  }

  private consumeR2Stream(body: ReadableStream<Uint8Array>, key: string, bytes: number, tempObjectId: string): ReadableStream<Uint8Array> {
    const reader = body.getReader()
    let cleaned = false
    let cleanupTimer = 0
    const cleanup = async () => {
      if (cleaned) return
      cleaned = true
      clearTimeout(cleanupTimer)
      const consumedAt = new Date().toISOString()
      const consumed = await this.env.DB.prepare('UPDATE temp_objects SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL').bind(consumedAt, tempObjectId).run()
      if ((consumed.meta.changes ?? 0) !== 1) return
      if (await deleteR2ObjectWithRetry(this.env, key)) {
        const deleted = await this.env.DB.prepare('DELETE FROM temp_objects WHERE id = ? AND consumed_at = ?').bind(tempObjectId, consumedAt).run()
        if ((deleted.meta.changes ?? 0) === 1) await releaseR2Usage(this.env, bytes)
        return
      }
      await this.env.DB.prepare('UPDATE temp_objects SET consumed_at = NULL, expires_at = ? WHERE id = ? AND consumed_at = ?').bind(new Date().toISOString(), tempObjectId, consumedAt).run()
    }
    cleanupTimer = setTimeout(() => void cleanup(), 15 * 60 * 1000) as unknown as number
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const result = await reader.read()
          if (result.done) {
            await cleanup()
            controller.close()
          } else {
            controller.enqueue(result.value)
          }
        } catch (error) {
          await cleanup()
          controller.error(error)
        }
      },
      async cancel(reason) {
        await reader.cancel(reason)
        await cleanup()
      },
    })
  }

  private rejectPendingResponse(requestId: string, pending: PendingResponse, message: string) {
    if (this.pending.get(requestId) !== pending) return
    clearTimeout(pending.timer)
    this.pending.delete(requestId)
    pending.cancelled = true
    pending.buffered = []
    this.releasePendingConnection(pending)
    void this.discardR2Upload(pending)
    if (pending.writer) void pending.writer.abort(message).catch(() => undefined)
    else pending.resolve(new Response(message, { status: 502, headers: { 'content-type': 'text/plain; charset=utf-8' } }))
  }

  private cancelPendingResponse(requestId: string, pending: PendingResponse, reason: string) {
    if (this.pending.get(requestId) !== pending) return
    clearTimeout(pending.timer)
    this.pending.delete(requestId)
    pending.cancelled = true
    pending.buffered = []
    this.releasePendingConnection(pending)
    void this.discardR2Upload(pending)
    if (pending.writer) void pending.writer.abort(reason).catch(() => undefined)
    else pending.resolve(new Response(reason, { status: 499 }))
    if (!pending.sse || !pending.pluginId || this.serverSocket?.readyState !== WebSocket.OPEN) return
    try {
      const frame = makeFrame('stream.close', this.serverId, { streamId: requestId, reason }, pending.pluginId)
      frame.requestId = requestId
      this.serverSocket.send(JSON.stringify(frame))
    } catch {
      // The plugin server may disconnect while the public client is being cleaned up.
    }
  }

  private releasePendingConnection(pending: PendingResponse) {
    if (!pending.activeConnection) return
    pending.activeConnection = false
    void releaseActiveConnection(this.env)
  }

  private async discardR2Upload(pending: PendingResponse): Promise<void> {
    const upload = pending.r2Upload
    if (!upload) return
    pending.r2Upload = undefined
    await upload.writer.abort('Plugin file stream discarded').catch(() => undefined)
    await this.env.BLOB_BUCKET.delete(upload.key).catch(() => undefined)
  }

  private async completeServerSync(payload: Record<string, unknown>, requestId: string) {
    let result: { ok: boolean; error?: string }
    try {
      result = await this.registerServer(payload)
    } catch {
      result = { ok: false, error: 'Server synchronization failed' }
    }
    const pending = this.pendingCommands.get(requestId)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pendingCommands.delete(requestId)
    pending.resolve(result)
  }

  private async registerServer(payload: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
    if (!await this.validateServerBinding()) return { ok: false, error: 'Server binding is revoked or unavailable' }
    const server = await this.env.DB.prepare('SELECT user_id, workspace_id FROM servers WHERE id = ? AND status != ?').bind(this.serverId, 'revoked').first<{ user_id: string; workspace_id: string }>()
    if (!server) return { ok: false, error: 'Plugin server is not registered' }
    if (!Array.isArray(payload.manifests)) {
      await this.rejectServerRegistration('server manifest list is invalid')
      return { ok: false, error: 'Server manifest list is invalid' }
    }
    const manifests = payload.manifests.filter(isManifest)
    if (manifests.length !== payload.manifests.length || new Set(manifests.map((manifest) => manifest.id)).size !== manifests.length) {
      await this.rejectServerRegistration('server manifest is invalid or duplicated')
      return { ok: false, error: 'Server manifest is invalid or duplicated' }
    }
    const now = new Date().toISOString()
    for (const manifest of manifests) {
      await this.env.DB.prepare(`
        INSERT INTO plugin_instances (id, user_id, workspace_id, server_id, plugin_id, name, version, state, desired_state, manifest_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(server_id, plugin_id) DO UPDATE SET name = excluded.name, version = excluded.version, manifest_json = excluded.manifest_json, state = CASE WHEN plugin_instances.state = 'server_offline' THEN 'discovered' ELSE plugin_instances.state END, updated_at = excluded.updated_at
      `).bind(crypto.randomUUID(), server.user_id, server.workspace_id, this.serverId, manifest.id, manifest.name, manifest.version, 'discovered', 'discovered', JSON.stringify(manifest), now, now).run()
    }
    const knownPluginIds = new Set(manifests.map((manifest) => manifest.id))
    const existing = await this.env.DB.prepare('SELECT id, plugin_id FROM plugin_instances WHERE server_id = ?').bind(this.serverId).all<{ id: string; plugin_id: string }>()
    for (const plugin of existing.results) {
      if (knownPluginIds.has(plugin.plugin_id)) continue
      await this.env.DB.prepare('UPDATE plugin_instances SET state = ?, desired_state = ?, updated_at = ? WHERE id = ?').bind('unloaded', 'unloaded', now, plugin.id).run()
    }
    const desired = await this.env.DB.prepare('SELECT id, plugin_id, desired_state FROM plugin_instances WHERE server_id = ? AND desired_state IN (?, ?, ?)').bind(this.serverId, 'loaded', 'enabled', 'disabled').all<{ id: string; plugin_id: string; desired_state: RestorablePluginState }>()
    for (const plugin of desired.results) {
      const state = await restorePluginState(plugin.plugin_id, plugin.desired_state, (type, pluginId) => this.sendPluginCommand(type, pluginId))
      await this.env.DB.prepare('UPDATE plugin_instances SET state = ?, updated_at = ? WHERE id = ?').bind(state, new Date().toISOString(), plugin.id).run()
    }
    await this.env.DB.prepare("UPDATE domains SET status = CASE WHEN (SELECT state FROM plugin_instances WHERE plugin_instances.id = domains.plugin_instance_id) = 'enabled' THEN 'online' ELSE 'offline' END WHERE plugin_instance_id IN (SELECT id FROM plugin_instances WHERE server_id = ?)").bind(this.serverId).run()
    return { ok: true }
  }

  private async validateServerBinding(): Promise<boolean> {
    const server = await this.env.DB.prepare('SELECT id FROM servers WHERE id = ? AND status != ?').bind(this.serverId, 'revoked').first<{ id: string }>()
    if (server) return true
    this.serverSocket?.close(1008, 'Server binding revoked')
    return false
  }

  private async rejectServerRegistration(message: string): Promise<void> {
    const socket = this.serverSocket
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    try {
      socket.send(JSON.stringify(makeFrame('error', this.serverId, { message })))
    } catch {
      // The close path still marks the server offline when sending fails.
    }
    socket.close(1008, 'Invalid server registration')
  }
}

function serverOfflineResponse(): Response {
  return new Response('Plugin server is offline', { status: 503, headers: { 'x-plugmesh-bridge-error': 'server-offline' } })
}

async function deleteR2ObjectWithRetry(env: Env, objectKey: string): Promise<boolean> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await env.BLOB_BUCKET.delete(objectKey)
      return true
    } catch {
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** (attempt - 1)))
    }
  }
  return false
}

async function readRequestBody(request: Request, maxBytes: number): Promise<{ ok: true; body: Uint8Array } | { ok: false }> {
  if (!request.body) return { ok: true, body: new Uint8Array() }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const result = await reader.read()
      if (result.done) break
      size += result.value.byteLength
      if (size > maxBytes) {
        await reader.cancel('Request body is too large')
        return { ok: false }
      }
      chunks.push(result.value)
    }
  } catch {
    return { ok: false }
  }
  return { ok: true, body: combineBytes(chunks) }
}

function forwardedHeaders(headers: Headers): Headers {
  const result = new Headers(headers)
  result.delete('x-plugmesh-server-id')
  result.delete('x-plugmesh-plugin-id')
  result.delete('x-plugmesh-request-path')
  result.delete('x-plugmesh-request-mode')
  result.delete('x-plugmesh-file-stream')
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
