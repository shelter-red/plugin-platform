import { makeFrame, parseControlFrame } from './protocol'
import type { Env } from './types'

export class PluginBridge {
  private state: DurableObjectState
  private serverSocket: WebSocket | null = null
  private pending = new Map<string, { resolve: (response: Response) => void; timer: number }>()

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/connect') return this.connectServer(request)
    if (url.pathname === '/proxy') return this.proxyRequest(request)
    return new Response('Not found', { status: 404 })
  }

  private connectServer(request: Request): Response {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket upgrade required', { status: 426 })
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    server.accept()
    this.serverSocket?.close(1012, 'Replaced by a new connection')
    this.serverSocket = server
    server.addEventListener('message', (event) => this.handleServerMessage(event.data))
    server.addEventListener('close', () => {
      if (this.serverSocket === server) this.serverSocket = null
    })
    server.send(JSON.stringify(makeFrame('hello', 'bridge', { message: 'server connection accepted' })))
    return new Response(null, { status: 101, webSocket: client })
  }

  private async proxyRequest(request: Request): Promise<Response> {
    if (!this.serverSocket || this.serverSocket.readyState !== WebSocket.OPEN) return new Response('Plugin server is offline', { status: 503 })
    const requestId = crypto.randomUUID()
    const body = await request.text()
    const frame = makeFrame('request.open', 'bridge', {
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

  private handleServerMessage(data: string | ArrayBuffer) {
    const raw = typeof data === 'string' ? data : new TextDecoder().decode(data)
    const frame = parseControlFrame(raw)
    if (!frame || frame.type !== 'request.close') return
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
}
