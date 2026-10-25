const MAX_PENDING_BYTES = 256 * 1024
const MAX_TUNNEL_FRAME_BYTES = 64 * 1024

export class TunnelSession {
  private source: WebSocket | null = null
  private target: WebSocket | null = null
  private targetServerId = ''
  private pending: Array<{ side: 'source' | 'target'; data: string | ArrayBuffer }> = []
  private pendingBytes = 0
  private sourceMessages = Promise.resolve()
  private targetMessages = Promise.resolve()

  constructor(private readonly state: DurableObjectState, _env: unknown) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket upgrade required', { status: 426 })
    if (url.pathname === '/source') return this.attach(request, 'source')
    if (url.pathname === '/target') return this.attach(request, 'target')
    return new Response('Not found', { status: 404 })
  }

  private async attach(request: Request, side: 'source' | 'target'): Promise<Response> {
    const url = new URL(request.url)
    const sessionId = url.searchParams.get('sessionId') ?? ''
    const serverId = url.searchParams.get(side === 'source' ? 'targetServerId' : 'serverId') ?? ''
    if (!sessionId || !serverId || (side === 'source' && !url.searchParams.get('sourceServerId'))) return new Response('Invalid tunnel session', { status: 400 })

    if (side === 'source') {
      if (this.source || this.targetServerId) return new Response('Tunnel session already exists', { status: 409 })
      this.targetServerId = serverId
      await this.state.storage.put('targetServerId', serverId)
      await this.state.storage.put('sessionId', sessionId)
    } else {
      const expectedTarget = this.targetServerId || await this.state.storage.get<string>('targetServerId')
      const expectedSession = await this.state.storage.get<string>('sessionId')
      if (!expectedTarget || !expectedSession || expectedTarget !== serverId || expectedSession !== sessionId || this.target) return new Response('Tunnel target does not match session', { status: 403 })
      this.targetServerId = expectedTarget
    }

    const pair = new WebSocketPair()
    const client = pair[0]
    const socket = pair[1]
    socket.accept()
    if (side === 'source') {
      this.source = socket
      const sessionIdBytes = new TextEncoder().encode(sessionId)
      const sessionFrame = new Uint8Array(3 + sessionIdBytes.length)
      sessionFrame.set([0x50, 1, 20])
      sessionFrame.set(sessionIdBytes, 3)
      socket.send(sessionFrame.buffer)
    }
    else this.target = socket

    socket.addEventListener('message', (event) => this.queueForward(side, event.data))
    socket.addEventListener('close', (event) => this.closePeer(side, event.code, event.reason))
    socket.addEventListener('error', () => this.closePeer(side, 1011, 'Tunnel socket error'))
    this.flushPending()
    return new Response(null, { status: 101, webSocket: client })
  }

  private queueForward(from: 'source' | 'target', input: unknown) {
    const chain = from === 'source' ? this.sourceMessages : this.targetMessages
    const next = chain.then(() => this.forward(from, input)).catch(() => this.closeAll(1011, 'Tunnel frame could not be read'))
    if (from === 'source') this.sourceMessages = next
    else this.targetMessages = next
  }

  private async forward(from: 'source' | 'target', input: unknown) {
    let data: string | ArrayBuffer
    if (typeof input === 'string') data = input
    else if (input instanceof ArrayBuffer) data = input
    else if (ArrayBuffer.isView(input)) {
      const copy = new Uint8Array(input.byteLength)
      copy.set(new Uint8Array(input.buffer, input.byteOffset, input.byteLength))
      data = copy.buffer
    } else if (input && typeof (input as Blob).arrayBuffer === 'function') {
      data = await (input as Blob).arrayBuffer()
    } else {
      this.closeAll(1003, 'Unsupported tunnel frame')
      return
    }
    const size = typeof data === 'string' ? new TextEncoder().encode(data).byteLength : data.byteLength
    if (size > MAX_TUNNEL_FRAME_BYTES) {
      this.closeAll(1009, 'Tunnel frame is too large')
      return
    }
    const destination = from === 'source' ? this.target : this.source
    if (destination?.readyState === WebSocket.OPEN) {
      try {
        destination.send(data)
      } catch {
        this.closeAll(1011, 'Tunnel forwarding failed')
      }
      return
    }
    if (size > MAX_PENDING_BYTES - this.pendingBytes) {
      this.closeAll(1009, 'Tunnel peer did not become ready')
      return
    }
    this.pending.push({ side: from, data })
    this.pendingBytes += size
  }

  private flushPending() {
    for (let index = 0; index < this.pending.length;) {
      const item = this.pending[index]
      const destination = item.side === 'source' ? this.target : this.source
      if (!destination || destination.readyState !== WebSocket.OPEN) {
        index += 1
        continue
      }
      try {
        destination.send(item.data)
      } catch {
        this.closeAll(1011, 'Tunnel forwarding failed')
        return
      }
      this.pendingBytes -= typeof item.data === 'string' ? new TextEncoder().encode(item.data).byteLength : item.data.byteLength
      this.pending.splice(index, 1)
    }
  }

  private closePeer(side: 'source' | 'target', code: number, reason: string) {
    const peer = side === 'source' ? this.target : this.source
    if (peer?.readyState === WebSocket.OPEN) {
      try { peer.close(code, reason.slice(0, 123)) } catch { /* peer may be closing */ }
    }
    if (side === 'source') this.source = null
    else this.target = null
    this.pending = []
    this.pendingBytes = 0
  }

  private closeAll(code: number, reason: string) {
    for (const socket of [this.source, this.target]) {
      if (socket?.readyState === WebSocket.OPEN) {
        try { socket.close(code, reason) } catch { /* socket may be closing */ }
      }
    }
    this.source = null
    this.target = null
    this.pending = []
    this.pendingBytes = 0
  }
}
