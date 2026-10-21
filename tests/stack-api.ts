import type { APIRequestContext, APIResponse } from '@playwright/test'

export type StackApiOptions = Parameters<APIRequestContext['fetch']>[1]
export type StackApi = (path: string, init?: StackApiOptions) => Promise<APIResponse>

/** 携带本地验收会话 Cookie 的请求辅助；`api` 会对非 2xx 直接抛错，`call` 保留原始响应。 */
export function createStackApi(request: APIRequestContext, sessionToken: string) {
  const cookie = `plugmesh_session=${sessionToken}`
  const call: StackApi = (path, init = {}) => request.fetch(path, { ...init, headers: { cookie, ...(init.headers ?? {}) } })
  const api: StackApi = async (path, init = {}) => {
    const response = await call(path, init)
    if (!response.ok()) throw new Error(`${init.method ?? 'GET'} ${path} 失败：${response.status()} ${await response.text()}`)
    return response
  }
  return { call, api }
}
