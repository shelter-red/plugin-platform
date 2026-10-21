import http from 'node:http'
import { once } from 'node:events'
import WebSocket from 'ws'

export type Target = { hostname: string; host: string; port: number }

type PublicResponse = { status: number; headers: http.IncomingHttpHeaders; body: string }

export function makeTarget(base: string, hostname: string): Target {
  const url = new URL(base)
  return { hostname: url.hostname, host: hostname, port: Number(url.port || 80) }
}

function publicRequest(target: Target, options: { method?: string; accept?: string; path?: string } = {}) {
  return http.request({
    hostname: target.hostname,
    port: target.port,
    path: options.path ?? '/',
    method: options.method ?? 'GET',
    headers: { host: target.host, ...(options.accept ? { accept: options.accept } : {}) },
  })
}

export function getPublic(target: Target): Promise<PublicResponse> {
  return new Promise((resolve, reject) => {
    const request = publicRequest(target)
    request.on('response', (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }))
    })
    request.on('error', reject)
    request.end()
  })
}

export async function openStream(target: Target) {
  const request = publicRequest(target, { accept: 'text/event-stream' })
  const responsePromise = once(request, 'response') as Promise<[http.IncomingMessage]>
  request.end()
  const [response] = await responsePromise
  if (response.statusCode !== 200) throw new Error(`SSE 状态码 ${response.statusCode}`)
  const firstChunk = await Promise.race([
    once(response, 'data') as Promise<[Buffer]>,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('SSE 首个数据块超时')), 10_000)),
  ])
  if (!firstChunk[0].toString('utf8').startsWith('data: ')) throw new Error(`SSE 数据块格式异常：${firstChunk[0].toString('utf8').slice(0, 40)}`)
  return { request, response }
}

export function openEcho(target: Target) {
  return new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(`ws://${target.hostname}:${target.port}/`, { headers: { host: target.host } })
    const timer = setTimeout(() => { socket.terminate(); reject(new Error('WebSocket 连接超时')) }, 10_000)
    socket.once('error', (error) => { clearTimeout(timer); reject(error) })
    socket.once('open', () => { clearTimeout(timer); resolve(socket) })
  })
}

export function echoOnce(socket: WebSocket, payload: string) {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket 回显超时')), 10_000)
    socket.once('message', (data) => { clearTimeout(timer); resolve(data.toString()) })
    socket.send(payload)
  })
}

export function upgradeStatus(target: Target): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://${target.hostname}:${target.port}/`, { headers: { host: target.host } })
    const timer = setTimeout(() => { socket.terminate(); reject(new Error('WebSocket 升级超时')) }, 10_000)
    socket.once('unexpected-response', (_request, response) => {
      clearTimeout(timer)
      response.resume()
      socket.terminate()
      resolve(response.statusCode ?? 0)
    })
    socket.once('open', () => {
      clearTimeout(timer)
      socket.close()
      reject(new Error('预期 WebSocket 升级被拒绝，但连接已建立'))
    })
    socket.once('error', (error) => { clearTimeout(timer); reject(error) })
  })
}
