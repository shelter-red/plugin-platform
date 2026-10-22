import { decryptSecret, encryptSecret } from './secrets'
import type { Env } from './types'

/** Cloudflare 官方只读权限。前端只展示，保存接口不接受自定义 scope。 */
export const CLOUDFLARE_API_TOKEN_PERMISSIONS = [
  'Account Settings Read',
  'Account Analytics Read',
  'Billing Read',
] as const

export type CloudflareTokenErrorCode =
  | 'token_required'
  | 'token_invalid'
  | 'token_permission_denied'
  | 'account_missing'
  | 'account_ambiguous'
  | 'cloudflare_upstream_error'
  | 'secret_missing'
  | 'credential_unreadable'

export class CloudflareTokenError extends Error {
  constructor(
    readonly status: number,
    readonly code: CloudflareTokenErrorCode,
    message: string,
    readonly upstreamStatus?: number,
  ) {
    super(message)
    this.name = 'CloudflareTokenError'
  }
}

export interface CloudflareTokenVerification {
  id: string | null
  status: 'active'
  notBefore: string | null
  expiresOn: string | null
}

export interface CloudflareAccount {
  id: string
  name: string
}

export interface CloudflareSubscriptionSummary {
  id: string | null
  state: string | null
  planId: string | null
  planName: string | null
}

export interface CloudflarePlanSummary {
  id: string | null
  name: string | null
  free: boolean
  confirmed: boolean
}

export interface CloudflareSubscriptionResult {
  subscriptions: CloudflareSubscriptionSummary[]
  plan: CloudflarePlanSummary
}

export interface CloudflareApiTokenCredential {
  kind: 'api_token'
  apiToken: string
  accountId: string
  verifiedAt: string
}

export type StoredCloudflareCredential =
  | { kind: 'api_token'; credential: CloudflareApiTokenCredential; updatedAt: string }
  | { kind: 'legacy_oauth'; accountId: string | null; updatedAt: string }

export interface ValidatedCloudflareToken {
  credential: CloudflareApiTokenCredential
  account: CloudflareAccount
  subscriptions: CloudflareSubscriptionResult
}

interface CloudflareApiError {
  code?: number | string
  message?: string
}

interface CloudflareEnvelope<T> {
  success?: boolean
  result?: T
  errors?: CloudflareApiError[]
  result_info?: {
    page?: number
    per_page?: number
    count?: number
    total_count?: number
    total_pages?: number
  }
}

interface CloudflareAccountPayload {
  id?: string
  name?: string
}

interface CloudflareSubscriptionPayload {
  id?: string
  state?: string
  rate_plan?: {
    id?: string
    public_name?: string
  }
}

type Fetcher = typeof fetch

const API_ORIGIN = 'https://api.cloudflare.com/client/v4'
const ACCOUNTS_PER_PAGE = 50
const MAX_ACCOUNT_PAGES = 100

function upstreamError(message: string, upstreamStatus?: number): CloudflareTokenError {
  return new CloudflareTokenError(502, 'cloudflare_upstream_error', message, upstreamStatus)
}

function invalidTokenError(message = 'Cloudflare API Token 无效或已被撤销'): CloudflareTokenError {
  return new CloudflareTokenError(401, 'token_invalid', message)
}

function permissionDeniedError(message = 'Cloudflare API Token 缺少所需的只读权限'): CloudflareTokenError {
  return new CloudflareTokenError(403, 'token_permission_denied', message)
}

async function parseJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null)
}

function envelopeErrors(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const errors = (payload as CloudflareEnvelope<unknown>).errors
  if (!Array.isArray(errors)) return null
  const messages = errors
    .map((error) => typeof error?.message === 'string' ? error.message.trim() : '')
    .filter(Boolean)
  return messages.length > 0 ? messages.join('; ').slice(0, 512) : null
}

function requestError(stage: 'verify' | 'accounts' | 'subscriptions', response: Response, payload: unknown): CloudflareTokenError {
  const detail = envelopeErrors(payload) ?? `Cloudflare ${stage} 请求失败（HTTP ${response.status}）`
  if (response.status === 401) return invalidTokenError(detail)
  if (response.status === 403) return permissionDeniedError(detail)
  if (stage === 'subscriptions' && response.status === 404) {
    return new CloudflareTokenError(409, 'account_missing', '指定账号不可见或不存在')
  }
  return upstreamError(detail, response.status)
}

async function requestCloudflare<T>(
  stage: 'verify' | 'accounts' | 'subscriptions',
  apiToken: string,
  path: string,
  fetchImpl: Fetcher,
): Promise<CloudflareEnvelope<T>> {
  let response: Response
  try {
    response = await fetchImpl(`${API_ORIGIN}${path}`, {
      headers: { authorization: `Bearer ${apiToken}`, accept: 'application/json' },
    })
  } catch {
    throw upstreamError(`无法连接 Cloudflare ${stage} 接口`)
  }
  const payload = await parseJson(response)
  if (!response.ok) throw requestError(stage, response, payload)
  if (!payload || typeof payload !== 'object') throw upstreamError(`Cloudflare ${stage} 响应不是有效 JSON`, response.status)
  return payload as CloudflareEnvelope<T>
}

export async function verifyCloudflareApiToken(apiToken: string, fetchImpl: Fetcher = fetch): Promise<CloudflareTokenVerification> {
  const token = apiToken.trim()
  if (!token) throw new CloudflareTokenError(400, 'token_required', '请输入 Cloudflare API Token')
  const payload = await requestCloudflare<{ id?: string; status?: string; not_before?: string; expires_on?: string }>('verify', token, '/user/tokens/verify', fetchImpl)
  if (payload.success === false || payload.result?.status !== 'active') {
    throw invalidTokenError(envelopeErrors(payload) ?? 'Cloudflare API Token 未处于 active 状态')
  }
  return {
    id: typeof payload.result.id === 'string' ? payload.result.id : null,
    status: 'active',
    notBefore: typeof payload.result.not_before === 'string' ? payload.result.not_before : null,
    expiresOn: typeof payload.result.expires_on === 'string' ? payload.result.expires_on : null,
  }
}

/** 读取全部账号页；不能只取第一条，否则多账号会被误判为唯一账号。 */
export async function listCloudflareAccounts(apiToken: string, fetchImpl: Fetcher = fetch): Promise<CloudflareAccount[]> {
  const accounts: CloudflareAccount[] = []
  for (let page = 1; page <= MAX_ACCOUNT_PAGES; page += 1) {
    const payload = await requestCloudflare<CloudflareAccountPayload[]>(
      'accounts',
      apiToken,
      `/accounts?page=${page}&per_page=${ACCOUNTS_PER_PAGE}`,
      fetchImpl,
    )
    if (payload.success === false || !Array.isArray(payload.result)) {
      throw upstreamError(envelopeErrors(payload) ?? 'Cloudflare accounts 响应结构无效')
    }
    for (const account of payload.result) {
      if (typeof account?.id !== 'string' || !account.id.trim()) {
        throw upstreamError('Cloudflare accounts 响应缺少账号 ID')
      }
      accounts.push({ id: account.id, name: typeof account.name === 'string' ? account.name : '' })
    }
    const totalPages = payload.result_info?.total_pages
    if (typeof totalPages === 'number') {
      if (page >= totalPages) return accounts
      continue
    }
    const pageCount = payload.result_info?.count ?? payload.result.length
    if (pageCount < ACCOUNTS_PER_PAGE) return accounts
  }
  throw upstreamError('Cloudflare accounts 分页超过安全上限')
}

export function selectCloudflareAccountId(accounts: CloudflareAccount[], requestedAccountId?: string): string {
  const requested = requestedAccountId?.trim()
  if (requested) {
    const matched = accounts.find((account) => account.id.toLowerCase() === requested.toLowerCase())
    if (!matched) throw new CloudflareTokenError(409, 'account_missing', '指定 Account ID 不可见或不存在')
    return matched.id
  }
  if (accounts.length === 0) throw new CloudflareTokenError(409, 'account_missing', 'Token 没有可见的 Cloudflare 账号')
  if (accounts.length > 1) {
    throw new CloudflareTokenError(409, 'account_ambiguous', 'Token 可见多个账号，请填写 Account ID')
  }
  return accounts[0].id
}

export async function readCloudflareSubscriptions(
  apiToken: string,
  accountId: string,
  fetchImpl: Fetcher = fetch,
): Promise<CloudflareSubscriptionResult> {
  const payload = await requestCloudflare<CloudflareSubscriptionPayload[]>(
    'subscriptions',
    apiToken,
    `/accounts/${encodeURIComponent(accountId)}/subscriptions`,
    fetchImpl,
  )
  if (payload.success === false || !Array.isArray(payload.result)) {
    throw upstreamError(envelopeErrors(payload) ?? 'Cloudflare subscriptions 响应结构无效')
  }
  const subscriptions = payload.result.map((subscription) => ({
    id: typeof subscription?.id === 'string' ? subscription.id : null,
    state: typeof subscription?.state === 'string' ? subscription.state : null,
    planId: typeof subscription?.rate_plan?.id === 'string' ? subscription.rate_plan.id : null,
    planName: typeof subscription?.rate_plan?.public_name === 'string' ? subscription.rate_plan.public_name : null,
  }))
  const freeSubscription = subscriptions.find((subscription) => subscription.planId === 'free')
  const firstConfirmed = subscriptions.find((subscription) => Boolean(subscription.planId))
  const selected = freeSubscription ?? firstConfirmed
  return {
    subscriptions,
    plan: {
      id: selected?.planId ?? null,
      name: selected?.planName ?? null,
      free: Boolean(freeSubscription),
      confirmed: Boolean(firstConfirmed),
    },
  }
}

/** 保存前完整验证 Token、账号可见性和 Billing Read 权限。 */
export async function validateCloudflareApiToken(
  apiToken: string,
  requestedAccountId?: string,
  fetchImpl: Fetcher = fetch,
): Promise<ValidatedCloudflareToken> {
  const token = apiToken.trim()
  await verifyCloudflareApiToken(token, fetchImpl)
  const accounts = await listCloudflareAccounts(token, fetchImpl)
  const accountId = selectCloudflareAccountId(accounts, requestedAccountId)
  const account = accounts.find((candidate) => candidate.id === accountId)!
  const subscriptions = await readCloudflareSubscriptions(token, accountId, fetchImpl)
  return {
    credential: { kind: 'api_token', apiToken: token, accountId, verifiedAt: new Date().toISOString() },
    account,
    subscriptions,
  }
}

export function maskCloudflareAccountId(accountId: string | null | undefined): string | null {
  if (!accountId) return null
  return accountId.length <= 8 ? accountId : `${accountId.slice(0, 4)}...${accountId.slice(-4)}`
}

export async function storeCloudflareCredential(env: Env, credential: CloudflareApiTokenCredential): Promise<string> {
  if (!env.SESSION_SECRET) throw new CloudflareTokenError(503, 'secret_missing', 'SESSION_SECRET 未配置，无法安全保存 Token')
  const sealed = await encryptSecret(env.SESSION_SECRET, JSON.stringify(credential))
  const updatedAt = new Date().toISOString()
  await env.DB.prepare('INSERT INTO cloudflare_credentials (id, ciphertext, iv, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, updated_at = excluded.updated_at').bind('primary', sealed.ciphertext, sealed.iv, updatedAt).run()
  return updatedAt
}

/** 新密文返回 api_token；旧 OAuth 密文只识别类型，不返回 access/refresh token。 */
export async function readStoredCloudflareCredential(env: Env): Promise<StoredCloudflareCredential | null> {
  if (!env.SESSION_SECRET) throw new CloudflareTokenError(503, 'secret_missing', 'SESSION_SECRET 未配置，无法读取凭据')
  const row = await env.DB.prepare('SELECT ciphertext, iv, updated_at FROM cloudflare_credentials WHERE id = ?').bind('primary').first<{ ciphertext: string; iv: string; updated_at: string }>()
  if (!row) return null
  let value: Record<string, unknown>
  try {
    value = JSON.parse(await decryptSecret(env.SESSION_SECRET, row.ciphertext, row.iv)) as Record<string, unknown>
  } catch {
    throw new CloudflareTokenError(500, 'credential_unreadable', 'Cloudflare 凭据无法解密')
  }
  if (value.kind === 'api_token' && typeof value.apiToken === 'string' && value.apiToken && typeof value.accountId === 'string' && value.accountId) {
    return {
      kind: 'api_token',
      credential: {
        kind: 'api_token',
        apiToken: value.apiToken,
        accountId: value.accountId,
        verifiedAt: typeof value.verifiedAt === 'string' ? value.verifiedAt : row.updated_at,
      },
      updatedAt: row.updated_at,
    }
  }
  if (typeof value.accessToken === 'string' || typeof value.refreshToken === 'string') {
    return {
      kind: 'legacy_oauth',
      accountId: typeof value.accountId === 'string' && value.accountId ? value.accountId : null,
      updatedAt: row.updated_at,
    }
  }
  throw new CloudflareTokenError(500, 'credential_unreadable', 'Cloudflare 凭据格式无法识别')
}

export async function deleteStoredCloudflareCredential(env: Env): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM cloudflare_credentials WHERE id = ?').bind('primary'),
    env.DB.prepare('DELETE FROM usage_cache WHERE key = ?').bind('cloudflare:workers'),
  ])
}
