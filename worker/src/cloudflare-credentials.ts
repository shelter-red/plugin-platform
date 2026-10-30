import { decryptSecret, encryptSecret } from './secrets'
import type { CloudflarePlanSummary, CloudflareUsageLimits, Env } from './types'

export type CloudflareCredentialErrorCode =
  | 'credential_required'
  | 'credential_invalid'
  | 'credential_denied'
  | 'account_missing'
  | 'account_ambiguous'
  | 'cloudflare_upstream_error'
  | 'domain_zone_not_found'
  | 'domain_record_conflict'
  | 'domain_route_conflict'
  | 'secret_missing'
  | 'credential_unreadable'

export class CloudflareCredentialError extends Error {
  constructor(
    readonly status: number,
    readonly code: CloudflareCredentialErrorCode,
    message: string,
    readonly upstreamStatus?: number,
    readonly accounts?: CloudflareAccount[],
  ) {
    super(message)
    this.name = 'CloudflareCredentialError'
  }
}

export interface CloudflareAccount {
  id: string
  name: string
}

interface CloudflareZone {
  id: string
  name: string
  status: string
}

interface CloudflareDnsRecord {
  id: string
  type: string
  name: string
  content: string
  proxied?: boolean
  comment?: string | null
}

interface CloudflareWorkerRoute {
  id: string
  pattern: string
  script?: string | null
}

export interface CloudflareDomainConfiguration {
  zoneId: string
  zoneName: string
  hostname: string
  routePattern: string
}

export interface CloudflareSubscriptionSummary {
  id: string | null
  state: string | null
  planId: string | null
  planName: string | null
}

export interface CloudflareSubscriptionResult {
  subscriptions: CloudflareSubscriptionSummary[]
  plan: CloudflarePlanSummary
}

export interface CloudflareGlobalApiKeyCredential {
  kind: 'global_api_key'
  email: string
  globalApiKey: string
  accountId: string
  verifiedAt: string
}

export type StoredCloudflareCredential =
  | { kind: 'global_api_key'; credential: CloudflareGlobalApiKeyCredential; updatedAt: string }

export interface ValidatedCloudflareCredential {
  credential: CloudflareGlobalApiKeyCredential
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

/** Cloudflare 免费计划每日基线。只有 subscriptions 明确返回 Free 才使用这组值。 */
export const CLOUDFLARE_FREE_LIMITS: CloudflareUsageLimits = {
  workerRequests: 100_000,
  d1RowsRead: 5_000_000,
  d1RowsWritten: 100_000,
  d1StorageBytes: 5_000_000_000,
  kvRead: 100_000,
  kvWrite: 1_000,
  kvDelete: 1_000,
  kvList: 1_000,
  doRequests: 100_000,
}

export const CLOUDFLARE_FREE_LIMITS_VERIFIED_AT = '2026-10'

const API_ORIGIN = 'https://api.cloudflare.com/client/v4'
const ACCOUNTS_PER_PAGE = 50
const MAX_ACCOUNT_PAGES = 100

function upstreamError(message: string, upstreamStatus?: number): CloudflareCredentialError {
  return new CloudflareCredentialError(502, 'cloudflare_upstream_error', message, upstreamStatus)
}

function invalidCredentialError(message = 'Cloudflare Email 或 Global API Key 无效'): CloudflareCredentialError {
  return new CloudflareCredentialError(401, 'credential_invalid', message)
}

function credentialDeniedError(message = 'Cloudflare Global API Key 无权访问该 Cloudflare 资源'): CloudflareCredentialError {
  return new CloudflareCredentialError(403, 'credential_denied', message)
}

export interface CloudflareAuth {
  email: string
  globalApiKey: string
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

type CloudflareRequestStage = 'verify' | 'accounts' | 'subscriptions' | 'zones' | 'dns' | 'routes'

function requestError(stage: CloudflareRequestStage, response: Response, payload: unknown): CloudflareCredentialError {
  const detail = envelopeErrors(payload) ?? `Cloudflare ${stage} 请求失败（HTTP ${response.status}）`
  if (response.status === 401) return invalidCredentialError(detail)
  if (response.status === 403) return credentialDeniedError(detail)
  if (stage === 'subscriptions' && response.status === 404) {
    return new CloudflareCredentialError(409, 'account_missing', '指定账号不可见或不存在')
  }
  return upstreamError(detail, response.status)
}

async function requestCloudflare<T>(
  stage: CloudflareRequestStage,
  auth: CloudflareAuth,
  path: string,
  fetchImpl: Fetcher,
  init: RequestInit = {},
): Promise<CloudflareEnvelope<T>> {
  let response: Response
  try {
    response = await fetchImpl(`${API_ORIGIN}${path}`, {
      ...init,
      headers: { 'X-Auth-Email': auth.email, 'X-Auth-Key': auth.globalApiKey, accept: 'application/json', ...(init.headers ?? {}) },
    })
  } catch {
    throw upstreamError(`无法连接 Cloudflare ${stage} 接口`)
  }
  const payload = await parseJson(response)
  if (!response.ok) throw requestError(stage, response, payload)
  if (!payload || typeof payload !== 'object') throw upstreamError(`Cloudflare ${stage} 响应不是有效 JSON`, response.status)
  return payload as CloudflareEnvelope<T>
}

export async function verifyCloudflareGlobalApiKey(auth: CloudflareAuth, fetchImpl: Fetcher = fetch): Promise<void> {
  if (!auth.email.trim() || !auth.globalApiKey.trim()) throw new CloudflareCredentialError(400, 'credential_required', '请输入 Cloudflare Email 和 Global API Key')
  const payload = await requestCloudflare<{ id?: string }>('verify', auth, '/user', fetchImpl)
  if (payload.success === false || !payload.result) throw invalidCredentialError(envelopeErrors(payload) ?? 'Cloudflare Global API Key 验证失败')
}

/** 读取全部账号页；不能只取第一条，否则多账号会被误判为唯一账号。 */
export async function listCloudflareAccounts(auth: CloudflareAuth, fetchImpl: Fetcher = fetch): Promise<CloudflareAccount[]> {
  const accounts: CloudflareAccount[] = []
  for (let page = 1; page <= MAX_ACCOUNT_PAGES; page += 1) {
    const payload = await requestCloudflare<CloudflareAccountPayload[]>(
      'accounts',
      auth,
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
    if (!matched) throw new CloudflareCredentialError(409, 'account_missing', '指定 Account ID 不可见或不存在')
    return matched.id
  }
  if (accounts.length === 0) throw new CloudflareCredentialError(409, 'account_missing', 'Global API Key 没有可见的 Cloudflare 账号')
  if (accounts.length > 1) {
    throw new CloudflareCredentialError(409, 'account_ambiguous', 'Global API Key 可见多个账号，请选择目标账号', undefined, accounts)
  }
  return accounts[0].id
}

export async function readCloudflareSubscriptions(
  auth: CloudflareAuth,
  accountId: string,
  fetchImpl: Fetcher = fetch,
): Promise<CloudflareSubscriptionResult> {
  const payload = await requestCloudflare<CloudflareSubscriptionPayload[]>(
    'subscriptions',
    auth,
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
  const inactiveStates = new Set(['Cancelled', 'Failed', 'Expired'])
  const freeSubscription = subscriptions.find((subscription) => subscription.planId === 'free' && !inactiveStates.has(subscription.state ?? ''))
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

/** 保存前完整验证 Global API Key、Email、账号可见性和订阅读取。 */
export async function validateCloudflareCredential(
  email: string,
  globalApiKey: string,
  requestedAccountId?: string,
  fetchImpl: Fetcher = fetch,
): Promise<ValidatedCloudflareCredential> {
  const auth = { email: email.trim(), globalApiKey: globalApiKey.trim() }
  await verifyCloudflareGlobalApiKey(auth, fetchImpl)
  const accounts = await listCloudflareAccounts(auth, fetchImpl)
  const accountId = selectCloudflareAccountId(accounts, requestedAccountId)
  const account = accounts.find((candidate) => candidate.id === accountId)!
  const subscriptions = await readCloudflareSubscriptions(auth, accountId, fetchImpl)
  return {
    credential: { kind: 'global_api_key', email: auth.email, globalApiKey: auth.globalApiKey, accountId, verifiedAt: new Date().toISOString() },
    account,
    subscriptions,
  }
}

async function listCloudflareZones(auth: CloudflareAuth, accountId: string, fetchImpl: Fetcher): Promise<CloudflareZone[]> {
  const zones: CloudflareZone[] = []
  for (let page = 1; page <= MAX_ACCOUNT_PAGES; page += 1) {
    const payload = await requestCloudflare<CloudflareZone[]>('zones', auth, `/zones?account.id=${encodeURIComponent(accountId)}&status=active&page=${page}&per_page=${ACCOUNTS_PER_PAGE}`, fetchImpl)
    if (payload.success === false || !Array.isArray(payload.result)) throw upstreamError(envelopeErrors(payload) ?? 'Cloudflare zones 响应结构无效')
    zones.push(...payload.result.filter((zone): zone is CloudflareZone => typeof zone?.id === 'string' && typeof zone.name === 'string' && zone.status === 'active'))
    const totalPages = payload.result_info?.total_pages
    if (typeof totalPages === 'number' ? page >= totalPages : payload.result.length < ACCOUNTS_PER_PAGE) return zones
  }
  throw upstreamError('Cloudflare zones 分页超过安全上限')
}

function selectCloudflareZone(zones: CloudflareZone[], hostname: string): CloudflareZone {
  const matched = zones
    .filter((zone) => hostname === zone.name || hostname.endsWith(`.${zone.name}`))
    .sort((left, right) => right.name.length - left.name.length)[0]
  if (!matched) throw new CloudflareCredentialError(409, 'domain_zone_not_found', `Cloudflare 账号中没有覆盖 ${hostname} 的 active Zone`)
  return matched
}

async function configureCloudflareDnsRecord(auth: CloudflareAuth, zoneId: string, hostname: string, fetchImpl: Fetcher): Promise<string> {
  const query = `/zones/${encodeURIComponent(zoneId)}/dns_records?name=${encodeURIComponent(hostname)}`
  const listed = await requestCloudflare<CloudflareDnsRecord[]>('dns', auth, query, fetchImpl)
  if (listed.success === false || !Array.isArray(listed.result)) throw upstreamError(envelopeErrors(listed) ?? 'Cloudflare DNS 响应结构无效')
  const existing = listed.result[0]
  const desired = { type: 'A', name: hostname, content: '192.0.2.1', ttl: 1, proxied: true, comment: 'Managed by Plugmesh' }
  if (existing && (existing.type !== 'A' || (existing.comment && existing.comment !== 'Managed by Plugmesh'))) {
    throw new CloudflareCredentialError(409, 'domain_record_conflict', `${hostname} 已存在非 Plugmesh DNS 记录，未覆盖现有记录`)
  }
  const path = existing
    ? `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(existing.id)}`
    : `/zones/${encodeURIComponent(zoneId)}/dns_records`
  const saved = await requestCloudflare<CloudflareDnsRecord>('dns', auth, path, fetchImpl, {
    method: existing ? 'PUT' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(desired),
  })
  if (saved.success === false || !saved.result || typeof saved.result.id !== 'string') throw upstreamError(envelopeErrors(saved) ?? 'Cloudflare DNS 记录保存失败')
  return saved.result.id
}

async function configureCloudflareWorkerRoute(auth: CloudflareAuth, zoneId: string, routePattern: string, fetchImpl: Fetcher): Promise<string> {
  const listed = await requestCloudflare<CloudflareWorkerRoute[]>('routes', auth, `/zones/${encodeURIComponent(zoneId)}/workers/routes`, fetchImpl)
  if (listed.success === false || !Array.isArray(listed.result)) throw upstreamError(envelopeErrors(listed) ?? 'Cloudflare Worker Route 响应结构无效')
  const existing = listed.result.find((route) => route.pattern === routePattern)
  if (existing?.script && existing.script !== 'plugmesh-worker') {
    throw new CloudflareCredentialError(409, 'domain_route_conflict', `${routePattern} 已绑定其他 Worker，未覆盖现有路由`)
  }
  const path = existing?.id
    ? `/zones/${encodeURIComponent(zoneId)}/workers/routes/${encodeURIComponent(existing.id)}`
    : `/zones/${encodeURIComponent(zoneId)}/workers/routes`
  const saved = await requestCloudflare<CloudflareWorkerRoute>('routes', auth, path, fetchImpl, {
    method: existing?.id ? 'PUT' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pattern: routePattern, script: 'plugmesh-worker' }),
  })
  if (saved.success === false || !saved.result || typeof saved.result.id !== 'string') throw upstreamError(envelopeErrors(saved) ?? 'Cloudflare Worker Route 保存失败')
  return saved.result.id
}

export async function removeManagedCloudflareDomain(
  auth: CloudflareAuth,
  accountId: string,
  domainSuffix: string,
  fetchImpl: Fetcher = fetch,
): Promise<{ zoneId: string; hostname: string; routePattern: string; removedDns: boolean; removedRoute: boolean; skippedForeignRoute: boolean }> {
  const domain = domainSuffix.trim().toLowerCase().replace(/^\.+/, '')
  const hostname = `*.${domain}`
  const routePattern = `${hostname}/*`
  const zone = selectCloudflareZone(await listCloudflareZones(auth, accountId, fetchImpl), domain)
  const routes = await requestCloudflare<CloudflareWorkerRoute[]>('routes', auth, `/zones/${encodeURIComponent(zone.id)}/workers/routes`, fetchImpl)
  if (routes.success === false || !Array.isArray(routes.result)) throw upstreamError(envelopeErrors(routes) ?? 'Cloudflare Worker Route 响应结构无效')
  const route = routes.result.find((candidate) => candidate.pattern === routePattern)
  const skippedForeignRoute = Boolean(route?.script && route.script !== 'plugmesh-worker')
  let removedRoute = false
  if (route?.id && route.script === 'plugmesh-worker') {
    const deleted = await requestCloudflare<unknown>('routes', auth, `/zones/${encodeURIComponent(zone.id)}/workers/routes/${encodeURIComponent(route.id)}`, fetchImpl, { method: 'DELETE' })
    if (deleted.success === false) throw upstreamError(envelopeErrors(deleted) ?? 'Cloudflare Worker Route 删除失败')
    removedRoute = true
  }

  let removedDns = false
  if (!skippedForeignRoute) {
    const dns = await requestCloudflare<CloudflareDnsRecord[]>('dns', auth, `/zones/${encodeURIComponent(zone.id)}/dns_records?name=${encodeURIComponent(hostname)}`, fetchImpl)
    if (dns.success === false || !Array.isArray(dns.result)) throw upstreamError(envelopeErrors(dns) ?? 'Cloudflare DNS 响应结构无效')
    const record = dns.result.find((candidate) => candidate.name === hostname && candidate.type === 'A' && candidate.content === '192.0.2.1' && candidate.comment === 'Managed by Plugmesh')
    if (record) {
      const deleted = await requestCloudflare<unknown>('dns', auth, `/zones/${encodeURIComponent(zone.id)}/dns_records/${encodeURIComponent(record.id)}`, fetchImpl, { method: 'DELETE' })
      if (deleted.success === false) throw upstreamError(envelopeErrors(deleted) ?? 'Cloudflare DNS 记录删除失败')
      removedDns = true
    }
  }
  return { zoneId: zone.id, hostname, routePattern, removedDns, removedRoute, skippedForeignRoute }
}

/** 用已保存的 Global API Key 把插件通配域名接到当前 Worker。 */
export async function configureCloudflareDomain(
  auth: CloudflareAuth,
  accountId: string,
  domainSuffix: string,
  fetchImpl: Fetcher = fetch,
): Promise<CloudflareDomainConfiguration> {
  const domain = domainSuffix.trim().toLowerCase().replace(/^\.+/, '')
  const hostname = `*.${domain}`
  const routePattern = `${hostname}/*`
  const zone = selectCloudflareZone(await listCloudflareZones(auth, accountId, fetchImpl), domain)
  await configureCloudflareDnsRecord(auth, zone.id, hostname, fetchImpl)
  await configureCloudflareWorkerRoute(auth, zone.id, routePattern, fetchImpl)
  return { zoneId: zone.id, zoneName: zone.name, hostname, routePattern }
}

export function maskCloudflareAccountId(accountId: string | null | undefined): string | null {
  if (!accountId) return null
  return accountId.length <= 8 ? accountId : `${accountId.slice(0, 4)}...${accountId.slice(-4)}`
}

export async function storeCloudflareCredential(env: Env, credential: CloudflareGlobalApiKeyCredential): Promise<string> {
  if (!env.SESSION_SECRET) throw new CloudflareCredentialError(503, 'secret_missing', 'SESSION_SECRET 未配置，无法安全保存 Cloudflare 凭据')
  const sealed = await encryptSecret(env.SESSION_SECRET, JSON.stringify(credential))
  const updatedAt = new Date().toISOString()
  await env.DB.prepare('INSERT INTO cloudflare_credentials (id, ciphertext, iv, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, updated_at = excluded.updated_at').bind('primary', sealed.ciphertext, sealed.iv, updatedAt).run()
  return updatedAt
}

/** 读取已保存的 Global API Key 密文；任何旧格式都要求重新配置。 */
export async function readStoredCloudflareCredential(env: Env): Promise<StoredCloudflareCredential | null> {
  if (!env.SESSION_SECRET) throw new CloudflareCredentialError(503, 'secret_missing', 'SESSION_SECRET 未配置，无法读取 Cloudflare 凭据')
  const row = await env.DB.prepare('SELECT ciphertext, iv, updated_at FROM cloudflare_credentials WHERE id = ?').bind('primary').first<{ ciphertext: string; iv: string; updated_at: string }>()
  if (!row) return null
  let value: Record<string, unknown>
  try {
    value = JSON.parse(await decryptSecret(env.SESSION_SECRET, row.ciphertext, row.iv)) as Record<string, unknown>
  } catch {
    throw new CloudflareCredentialError(500, 'credential_unreadable', 'Cloudflare 凭据无法解密')
  }
  if (value.kind === 'global_api_key' && typeof value.email === 'string' && value.email && typeof value.globalApiKey === 'string' && value.globalApiKey && typeof value.accountId === 'string' && value.accountId) {
    return {
      kind: 'global_api_key',
      credential: {
        kind: 'global_api_key',
        email: value.email,
        globalApiKey: value.globalApiKey,
        accountId: value.accountId,
        verifiedAt: typeof value.verifiedAt === 'string' ? value.verifiedAt : row.updated_at,
      },
      updatedAt: row.updated_at,
    }
  }
  throw new CloudflareCredentialError(409, 'credential_unreadable', 'Cloudflare 凭据格式已停用，请重新配置 Email 和 Global API Key')
}

export async function deleteStoredCloudflareCredential(env: Env): Promise<void> {
  await env.DB.prepare('DELETE FROM cloudflare_credentials WHERE id = ?').bind('primary').run()
}

/** subscriptions 只确认 Free 时才返回官方基线；其他套餐明确返回 unavailable。 */
export function cloudflarePlanLimits(plan: CloudflarePlanSummary): {
  limitSource: 'cloudflare_subscriptions_free_baseline' | 'unavailable'
  limits: CloudflareUsageLimits | null
} {
  if (!plan.confirmed || !plan.free) return { limitSource: 'unavailable', limits: null }
  return { limitSource: 'cloudflare_subscriptions_free_baseline', limits: { ...CLOUDFLARE_FREE_LIMITS } }
}
