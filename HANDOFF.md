# Plugmesh 平台交接（HANDOFF）

> 最后整理：2026-10-23 03:06（Asia/Shanghai）
> 状态：**进行中，工作区不可推送**
> 记录基线 HEAD：`7a54cfc`（`main` 与 `origin/main` 当时一致）
> 本文件提交后，以实际 `git log -1 --oneline --decorate` 为最新 HEAD，不要照抄本页基线。
> 维护规则：每完成一个可验证步骤，先更新本文件，再提交一条可追溯的中文 Git 记录；未记录不得继续下一步。
> 本文件是压缩后的第一事实源。README、验收矩阵、旧注释或聊天摘要与本文冲突时，以用户最新要求和实际代码为准；旧文档必须在实现后同步重写。

## 0. 压缩恢复卡（先看这里）

- 仓库：`/home/tc/work/plugin-platform`
- 分支：`main`
- push：`git@github-plugin-platform:shelter-red/plugin-platform.git`
- fetch：`https://github.com/shelter-red/plugin-platform.git`
- 记录基线：HEAD 与 `origin/main` 均为 `7a54cfc docs: 重整完整交接台账与真实阻塞状态`
- 最近已验收 Actions：run `39835890828`（#48，`7a54cfc`），`completed/success`
- 仓库内未发现 `AGENTS.md`；没有额外仓库级代理指令。
- HANDOFF 已在 `7a54cfc` 单独提交并验收；当前仍有 **22 个代码路径**未提交，不能随文档一起推送：
  - Cloudflare OAuth 删除与 Token 后端迁移；
  - `types.ts` 已删除 `cloudflareQuotas`，新增 Free 额度/套餐类型；
  - 用量/设置 UI 只有零散草稿，仍使用旧 OAuth 和可编辑额度契约；
  - 旧测试/文档/前端尚未同步完。
- 当前实测：
  - `npm run worker:typecheck` **FAIL**，27 个 TypeScript 错误，集中在 `worker/src/usage.ts` 与 `worker/src/index.ts` 的旧 `cloudflareQuotas` 残留。
  - 完整 Worker runtime：**19/20 文件、82/84 用例 PASS**；失败 2 个都在旧 `worker/runtime/oauth-settings.test.ts`。
  - Token/settings/analytics 定向 runtime：**3/3 文件、20/20 用例 PASS**。
  - `git diff --check`：**PASS**。
- 当前禁止推送代码：类型检查失败且完整 runtime 未全绿。删除旧 OAuth 不是问题；剩余 2 个失败是旧测试假设，需要重写而不是兼容旧行为。HANDOFF 已先单独提交/推送，以便跨会话保留事实源。

### 0.1 绝对硬约束

- Cloudflare 最终方案只有 **长期 API Token**，不再使用 OAuth。
- Token 默认长期有效，但用户可撤销、策略可失效、权限可变；运行时仍要正确处理 401/403，但不能描述成“OAuth 自然过期”。
- 固定三项只读权限，用户不可编辑、不可取消：
  - `Account Settings Read`
  - `Account Analytics Read`
  - `Billing Read`
- 创建 Token 链接固定为：`https://dash.cloudflare.com/profile/api-tokens`
- 最终界面和可执行逻辑不得出现：
  - `offline_access`
  - `workers-platform.read`
  - PKCE
  - `response_type`
  - `grant_type`
  - Client ID/Secret
  - OAuth 回调地址
  - 可编辑 scope
- 错误必须使用真实 HTTP 状态 + JSON，留在当前系统设置页：
  - 不得 `302 /?auth_error=...`
  - 不得跳首页
  - 不得用 Cookie 传授权结果
- `setup` 失效时返回 `null` 后走普通非路由行为，不返回 `Setup is not available`。
- 未配置 Cloudflare 时：
  - `GET /api/usage/cloudflare` 立即返回 `{"configured":false,"cached":false}`；
  - 不先读缓存、不发任何外部请求；
  - `GET /api/usage/local?range=7d` 仍返回 200，因为它是平台本地统计。
- Cloudflare 免费额度不能手填，必须从 subscriptions 读取。
- 只有明确 `rate_plan.id === "free"` 才展示 8 项官方基线，否则显示“未读取”。
- 平台统计与 Cloudflare 额度分组：
  - 平台请求只统计，不设上限；
  - Cloudflare 8 项同时显示已用次数、上限、百分比；
  - 必须包含 D1 行写入。
- 部署必须确保 Workers Builds 实际执行 `npm run deploy` 并应用 migrations，避免 `no such table: workspaces`。
- 推送前必须完整本地验证；推送后必须追最新 Actions 到 `completed`。失败必须读日志/产物并修到成功。
- 未认证 GitHub REST 限额为每小时 60 次；Actions 轮询至少间隔约 1 分钟。不要用 15 秒高频轮询制造 403。
- 禁止 `git reset --hard`、`git clean`、`git checkout -- .`、`git add .` 或批量覆盖工作区。提交时显式列文件。

### 0.2 当前最强恢复结论

已经完成的后端代码事实：

- 删除旧 Cloudflare OAuth 主链路：
  - `/auth/cloudflare/start`
  - `/auth/cloudflare/callback`
  - `/api/settings/cloudflare/auth-result`
  - auth-result Cookie
  - start/finish/redirect 函数
  - scheduled 中 `cloudflare_oauth_states` 清理
  - 旧 OAuth imports
- 删除文件：
  ```text
  worker/src/cloudflare-oauth.ts
  worker/src/cloudflare-auth-result.ts
  worker/runtime/cloudflare-oauth.test.ts
  worker/cloudflare-oauth.smoke.ts
  worker/cloudflare-oauth-route.smoke.ts
  ```
- `worker/src/oauth-settings.ts` 已收缩为仅 GitHub：
  - 旧密文里的 `cloudflare` 字段读取时忽略；
  - PUT 若提交 `cloudflare` 返回 400。
- `worker/src/index.ts` 的 `cloudflareSettingsApi` 已切 API Token：
  - verify；
  - accounts 全分页；
  - 唯一账号/指定 Account ID；
  - subscriptions；
  - 加密保存；
  - 固定三项权限返回；
  - 稳定 HTTP 错误码。
- `worker/src/index.ts` 的 `cloudflareUsageApi` 已优先读 Token 凭据，再读缓存：
  - 未配置返回 `{"configured":false,"cached":false}`；
  - 旧 OAuth 密文只提示重新录入，不 refresh/revoke/查询；
  - Analytics 401/403 返回真实 HTTP。
- `worker/src/cloudflare-token.ts`：
  - 保存新 Token 时原子写凭据并清 `usage_cache`；
  - 新增官方 Free 8 项基线；
  - 新增 `cloudflarePlanLimits()`；只有 `plan.confirmed && plan.free` 才返回基线。
- `worker/src/types.ts`：
  - `Env` 已无 Cloudflare OAuth 环境变量；
  - `PlatformSettings.cloudflareQuotas` 已删除；
  - 新增 `CloudflareUsageLimits`、`CloudflarePlanSummary`。
- 测试桩已删除 `/oauth2/token`、`/oauth2/revoke`，改为 Token verify/accounts/subscriptions。
- `package.json` 已删除两个 Cloudflare OAuth smoke 脚本及 `worker:smoke` 引用。

仍阻塞的事实：

- `worker/src/usage.ts` 仍导入并写入已删除的 `CloudflareQuotas` / `cloudflareQuotas`。
- `worker/src/index.ts` 的 `platformSettingsApi` 和 `enforceCloudflareUsageQuotas` 仍使用 `settings.cloudflareQuotas`。
- usage 响应仍没有只读 `plan` / `limitSource` / `limits`，缓存也没有这些字段。
- 完整 runtime 的 2 个失败来自旧 `oauth-settings.test.ts` 仍要求 Cloudflare OAuth 配置和 `/auth/cloudflare/start`。
- `worker/oauth-settings.smoke.ts`、`worker/cloudflare-usage.smoke.ts` 仍是旧契约。
- 前端仍使用旧 OAuth 表单、可编辑额度、`authorizationExpired` 和多个刷新入口。
- `src/api.ts` 尚未 Token 化。
- README、验收矩阵、local-e2e、中英文帮助仍有旧 OAuth/手填额度内容。
- 部署链路、手动原生构建 workflow、二进制插件服务器帮助仍未完成。

### 0.3 下一步顺序（不得跳步）

1. **先修到可编译**：删除 `usage.ts` / `index.ts` 中所有 `cloudflareQuotas` 残留。
2. **完成 usage 只读契约**：接 subscriptions，返回 `plan` / `limitSource` / `limits`；旧缓存不得伪装成新契约。
3. **重写旧测试**：`oauth-settings.test.ts` 只测 GitHub；两个 smoke 改 Token 契约；全量 runtime 必须 20/20 文件、84/84 用例通过。
4. **前端 Token 化**：系统设置只留 Token + 可选 Account ID + 固定权限 + 创建链接。
5. **用量/UI 清理**：8 项次数和百分比、单一刷新入口、平台/Cloudflare 分组、异常文案/重复卡片/重复跳转。
6. **部署/D1**：确认 Workers Builds 的 Deploy command 是 `npm run deploy`，先应用 migrations。
7. **手动插件服务器构建**：新增仅 `workflow_dispatch` 的 workflow，支持可执行文件/共享库和目标平台，产出 artifact + SHA256。
8. **帮助中心**：中英文补二进制插件服务器/库文件使用说明，并同步旧文档。
9. **完整本地 CI → 中文提交 → 推送 → 最新 Actions 成功**。失败读日志/失败产物并继续修。

## 1. Git、分支与 Actions 快照

恢复工作先执行：

```bash
cd /home/tc/work/plugin-platform
git status --short --branch
git log -1 --oneline --decorate
git rev-parse HEAD origin/main
git diff --stat
git diff --check
```

记录基线（2026-10-23 03:06）：

- HEAD / `origin/main`：`7a54cfc`（本次 HANDOFF 校正提交前）
- 最新 Actions：run `39835890828`（#48），`completed/success`
- 上一批成功记录：
  - `1a5e5c1` run `39833249358`（#46）
  - `f9ae7b8` run `39832365360`（#45）
  - `eb414d0` run `39830753816`（#44）
  - `a0539fb` run `39827872017`（#42）
- 本 HANDOFF 提交后会产生新 HEAD；以实际 Git 和 GitHub Actions 为准。

当前未提交代码路径（22 个；HANDOFF 已提交，不计入）：

```text
M package.json
M src/features/overview/UsageResourcesPanel.tsx
M src/features/usage/PlatformUsageSection.tsx
M src/locales/en.ts
M src/locales/zh-CN.ts
M tests/console-worker.spec.ts
M vitest.workers.config.ts
D worker/cloudflare-oauth-route.smoke.ts
D worker/cloudflare-oauth.smoke.ts
M worker/runtime/analytics.test.ts
D worker/runtime/cloudflare-oauth.test.ts
M worker/runtime/cloudflare-settings.test.ts
M worker/runtime/helpers.ts
M worker/runtime/outbound-stub.ts
M worker/runtime/scheduled.test.ts
M worker/scheduled-maintenance.smoke.ts
D worker/src/cloudflare-auth-result.ts
D worker/src/cloudflare-oauth.ts
M worker/src/cloudflare-token.ts
M worker/src/index.ts
M worker/src/oauth-settings.ts
M worker/src/types.ts
```

已知 Actions 失败反例，不能重犯：

- `fd80fa4`，run `39754896119`（#11）：管理端 UI smoke 失败。
- `1e4fd10`，run `39756824624`（#12）：管理端 UI smoke 失败，linux/windows/macos native 也失败。
- 这些提交改变 workflow 后触发 native jobs；以后改 workflow 必须验证三平台，而不是只看 web。

查询最新 Actions：

```bash
curl -fsSL 'https://api.github.com/repos/shelter-red/plugin-platform/actions/runs?per_page=8' |
  node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{for(const r of JSON.parse(s).workflow_runs)console.log(r.head_sha.slice(0,7),r.status,r.conclusion??'-',r.id,r.run_number,r.display_title)})"
```

## 2. 用户问题总账（U01–U24）

状态图例：✅ 已实现并有验证证据；🟡 局部完成；⬜ 尚未开始或最终验收未通过。

| ID | 用户反馈或目标 | 必须达到的效果 | 当前状态 |
| --- | --- | --- | --- |
| U01 | “不是说全部重构成组件吗？登录页还是旧的？” | 登录页和全站有清晰组件边界；实际视觉验收 | 🟡 登录页、侧栏、账号、工作区已拆分；多主题/多视口最终视觉检查未完成。 |
| U02 | 自行从会话历史读分支、提交、推送 | 每步有中文 Git 记录；不靠聊天猜仓库/分支 | 🟡 分支和远端已知；最新已推送 HEAD 成功；当前 22 个代码路径未提交，禁止误推。 |
| U03 | 推送时 Actions 老是失败 | 本地完整 CI；推送后追 Actions；失败读日志/产物并修到成功 | 🟡 最新 HEAD 成功；当前 typecheck FAIL、runtime 82/84，不可推送。 |
| U04 | 错误状态为什么靠 `/?auth_error=` | 真实 HTTP status + JSON；留在当前页；不用查询参数/Cookie/跳首页 | 🟡 Cloudflare OAuth 路由/Cookie/跳转已删除，Token API 用 HTTP；前端和旧测试仍待清理。 |
| U05 | setup 失效为何单独返回 “Setup is not available” | `setupApi` 返回 `null` 时走普通非路由处理 | ✅ 已实现并有回归测试；后续不得破坏。 |
| U06 | `D1_ERROR: no such table: workspaces` | 部署前应用 0008 和全部 migrations；pending migration 时失败 | 🟡 `scripts/deploy-worker.sh` 已检查 migration；仍需核对 Workers Builds 实际命令和生产接口。 |
| U07 | `invalid_scope` / `workers-platform.read` 不允许 | 删除 OAuth scope；改用长期 API Token；固定三项真实权限 | 🟡 后端 OAuth 主链路已删除；前端/文档/旧 smoke 仍有残留。 |
| U08 | 授权失败后为什么跳首页 | 错误留在系统设置页，显示 HTTP 状态、稳定错误码和可操作说明 | 🟡 后端已无 Cloudflare 授权跳转；前端 Token 表单尚未完成。 |
| U09 | 用户不知道怎么给 OAuth 权限，取消后权限就没了 | 权限固定只读、不可编辑；创建 Token 直达链接 | 🟡 后端 GET 已返回固定三项权限；前端链接和只读清单尚未完成。 |
| U10 | “未识别唯一账号”也是权限问题 | verify → accounts 全分页 → subscriptions；不猜第一个账号 | ✅ 后端与 8 个 Token/6 个 settings runtime 测试覆盖。 |
| U11 | 用量和配额为什么没有刷新按钮 | 保留一个清晰手动刷新入口；刷新不被自动加载禁用 | ⬜ 当前仍有多处刷新/重复入口，未完成。 |
| U12 | OAuth 里没有 `offline_access` | 删除 offline_access、refresh 和“过期/重新授权”语义 | 🟡 后端 refresh/revoke 已删；前端和旧文案/测试仍存在。 |
| U13 | `configured:false` 为什么还能查 `/api/usage/local` 且 200 | 分清 Cloudflare 与本地统计；未配置不读缓存、不发云请求 | ✅ `analytics.test.ts` 覆盖未配置和旧 OAuth 短路；本地统计仍独立返回 200。 |
| U14 | response_type 位置错误；CF OAuth 没有 PKCE | 最终 Token 方案删除 response_type/grant_type/PKCE | ⬜ 最终验收要求这些字段全部消失；当前旧前端仍显示。 |
| U15 | `1e4fd10`、`fd80fa4` Actions 失败 | 每次失败修复后本地 CI、推送、Actions、失败产物闭环 | 🟡 最新 HEAD 成功；当前工作区未全绿，未到推送阶段。 |
| U16 | 图标没对齐；“默认工作区”很矮挡住文字 | 统一图标/按钮高度/gap/行高/居中；双主题多视口检查 | 🟡 `1b39960` 已修主要问题并有截图基线；新增 UI 仍需回归。 |
| U17 | 配额少，D1 写入等所有限制都要监控，显示次数和百分比 | 8 项：Worker、D1 行读/写、KV 读/写/删/列表、DO；均有 used/limit/percentage | 🟡 已有 8 项基础常量和 UI 草稿；尚未接 usage limits，仍读手填额度。 |
| U18 | 平台和监控分开；平台请求不限，CF 免费额度有限 | 平台只统计不设上限；Cloudflare 官方额度独立 | 🟡 分组草稿存在；Cloudflare limits 来源未完成。 |
| U19 | GitHub OAuth 没过期，CF 为什么过期；改用 Token | 不再暗示 OAuth 自然过期；界面/链接/错误全部 Token 化 | 🟡 后端已 Token 化；前端、文档仍旧。 |
| U20 | CF 免费额度为何能在系统设置配置；应从 CF 读取 | 删除手填；读 subscriptions；只有明确 Free 才展示基线，否则“未读取” | 🟡 Free 基线函数已加；usage 响应/UI/旧设置字段未完成。 |
| U21 | 文案诡异、莫名卡片、同页多个按钮跳同一页面 | 通读中英文；清理技术黑话、重复说明、空卡片、重复跳转 | ⬜ 用量页多个刷新入口、概览重复 `/usage` 跳转仍需全站审计。 |
| U22 | Actions 手动构建插件服务器：可执行/库、目标平台 | 仅 `workflow_dispatch`；真正共享库；artifact、SHA256、依赖说明 | ⬜ 尚未新增；当前 CMake 只有 STATIC core，不能改扩展名冒充共享库。 |
| U23 | 帮助中心说明二进制/库文件服务器怎么用 | 中英文覆盖下载、SHA256、启动/注册、env、插件目录/主机、链接、OpenSSL、常见错误 | ⬜ 尚未完成；现有帮助仍偏旧 OAuth FAQ。 |
| U24 | “都整理一下，写到磁盘 HANDOFF，避免压缩后忘记” | 所有用户要求、硬约束、当前代码事实、阻塞、下一步和验收命令必须可在磁盘恢复 | ✅ 本文件即权威台账；恢复时先读第 0 节，再读 U01–U24 和执行清单。 |

总账完整性：U01–U24 已覆盖组件化、登录页、HTTP 错误、setup、D1、Cloudflare OAuth/Token、固定权限、账号识别、刷新按钮、`configured:false`、`response_type`/PKCE、8 项额度与百分比、平台/Cloudflare 分组、额度来源、异常文案/重复卡片/重复跳转、图标对齐、Actions、原生手动构建、帮助中心和磁盘恢复。若用户新增反馈，继续追加 U25，不覆盖旧条目。

## 3. Cloudflare Token 固定契约

### 3.1 设置接口

`GET/PUT/DELETE /api/settings/cloudflare`：

```ts
// GET
{
  configured: boolean
  credentialKind: 'api_token' | 'legacy_oauth' | null
  accountIdConfigured: boolean
  accountId: string | null // 只返回掩码
  permissions: string[]    // 固定三项只读
  updatedAt: string | null
  lastVerifiedAt: string | null
  legacyCredential: boolean
}

// PUT
{ apiToken: string; accountId?: string }
```

- Token 不得为空；保存时必须实际校验，不能只加密落库。
- `PUT` 顺序固定：`verify → accounts 全分页 → 账号唯一性/指定账号匹配 → subscriptions → 加密保存`。
- `DELETE` 只删除本地 `cloudflare_credentials` 和 `usage_cache`，不调用 OAuth revoke；Token 由用户自行到 Cloudflare 撤销。
- 旧 OAuth 密文只识别为 `legacy_oauth`，提示重新录入 API Token；不得 refresh、revoke、查询或返回旧 access/refresh token。
- GET 永不回显 Token。
- 任何错误都留在当前设置页，不得 302、不得 `auth_error` 查询参数、不得 Cookie 回传。

稳定错误映射：

| HTTP | code | 场景 |
| --- | --- | --- |
| 400 | `token_required` | 首次保存缺少 Token 或请求体不合法 |
| 401 | `token_invalid` | Token verify 失败或 Analytics 明确 401 |
| 403 | `token_permission_denied` | accounts/subscriptions/Analytics 权限不足 |
| 409 | `account_missing` | 无可见账号，或指定 Account ID 不可见 |
| 409 | `account_ambiguous` | 未填 Account ID 且完整分页后有多个可见账号 |
| 500 | `credential_unreadable` | 已存密文无法解密或格式不可识别 |
| 502 | `cloudflare_upstream_error` / `cloudflare_analytics_failed` | Cloudflare 5xx、网络失败、响应不可解析 |
| 503 | `secret_missing` | `SESSION_SECRET` 缺失，无法安全存取 Token |

### 3.2 官方文档核对记录

- API Token 权限列表：https://developers.cloudflare.com/fundamentals/api/reference/permissions/
- 官方确认 `Account Settings Read`、`Account Analytics Read`、`Billing Read` 均真实存在。
- `Billing Read` 可读取 billing profile、subscriptions 和 invoices/entitlements。
- 不得再使用不存在的 `workers-platform.read`、`offline_access`。
- subscriptions 端点：https://developers.cloudflare.com/api/resources/accounts/subresources/subscriptions/
- Markdown：https://developers.cloudflare.com/api/resources/accounts/subresources/subscriptions/index.md
- `GET /accounts/{account_id}/subscriptions` 返回 `{ result: Subscription[], errors, messages }`；订阅含 `rate_plan.id`、`rate_plan.public_name`、`state`。
- 该端点接受 `Billing Read` 或 `Billing Write`。
- **只有响应中实际存在 `rate_plan.id === "free"` 才能确认 Free**；空结果、缺字段、结构不符都必须视为未确认。
- `https://api.cloudflare.com/client/v4/openapi.json` 曾返回 HTTP 400，不能作为官方 schema 依据。

### 3.3 用量接口目标契约

未配置 Cloudflare：

```json
{"configured":false,"cached":false}
```

同时满足：不先读缓存、不请求外部 API、不凭旧缓存伪装已配置。旧 OAuth 密文额外返回明确提示，但仍不请求 Cloudflare。

配置 Token 后必须先凭据、后缓存。响应最终必须包含只读：

```ts
{
  configured: true,
  plan: { id: string | null; name: string | null; free: boolean; confirmed: boolean },
  limitSource: 'cloudflare_subscriptions_free_baseline' | 'unavailable',
  limits: {
    workerRequests: number
    d1RowsRead: number
    d1RowsWritten: number
    kvRead: number
    kvWrite: number
    kvDelete: number
    kvList: number
    doRequests: number
  } | null
}
```

实现要求：

- 未缓存刷新时从当前 Token/Account 调 subscriptions，得到 `plan`，再用 `cloudflarePlanLimits(plan)` 得到 limits。
- 缓存必须同时携带 `plan/limitSource/limits`；旧缓存没有这些字段时视为 miss，或升级 cache key（如 `cloudflare:workers:v2`）。
- 只有 `limits !== null` 时才执行 Cloudflare 免费额度维护判断。
- `cloudflareQuotaReason()` 改成接收 `CloudflareUsageLimits`，不能读 `PlatformSettings`。
- `platformSettingsApi` 的 GET/PUT 都不再接受、返回或持久化 `cloudflareQuotas`。
- `CloudflareTokenError` 在 usage 路径也要映射成真实 HTTP，不能一律 500。

官方免费基线（2026-10 核对，UI 标注来源和核对日期）：

| 项目 | 每日上限 |
| --- | ---: |
| Worker 请求 | 100,000 |
| D1 行读取 | 5,000,000 |
| D1 行写入 | 100,000 |
| KV 读取 | 100,000 |
| KV 写入 | 1,000 |
| KV 删除 | 1,000 |
| KV 列举 | 1,000 |
| Durable Object 请求 | 100,000 |

平台自己的统计与 Cloudflare 官方额度必须分组：

- 平台请求只计数，不设上限，不画上限百分比。
- 平台本地统计不依赖 Cloudflare Token。
- 所有受限项同时显示已用次数、上限和百分比，不能漏 D1 写入。

## 4. 当前实现地图

### 4.1 已提交、不要重复做

- `775384e`：登录页拆为 `LoginPage` / `AuthFrame` / 品牌 / 加载页。
- `7ab4c90`：侧栏与顶栏从外壳拆出。
- `1b39960`：工作区开关高度、文字遮挡、AntD 按钮图标基线修复；18 张双主题三视口截图验证。
- `742640e`：平台请求不限；Cloudflare 8 项额度与百分比；平台/Cloudflare 分组。
- `12e7aae`：用量页拆为状态提示、额度分组、数据源、分布部件。
- `abf05ca`：侧栏品牌、工作区切换、导航、页脚、账号/工作区页进一步拆分。
- `a0539fb`：Cloudflare Token 基础模块与 8 项 runtime 测试。
- HANDOFF 多次整理提交；不要再重复拆登录页、侧栏、账号、工作区。

### 4.2 工作区已验证的部分

- Cloudflare 设置 API 的 Token 路径可用。
- Cloudflare usage API 的未配置短路、旧 OAuth 短路、401/403 映射可用。
- Cloudflare Token 存储、脱敏、固定权限、账号分页/唯一性、subscriptions 校验有测试。
- 删除 OAuth 文件后完整 runtime 从旧 4 个 refresh 失败变为当前仅 2 个 oauth-settings 测试失败。
- `git diff --check` 通过。

### 4.3 工作区未完成/已破坏编译的部分

- `worker/src/usage.ts`：
  - 仍导入 `CloudflareQuotas`；
  - `defaultCloudflareQuotas` 未删；
  - `defaultPlatformSettings.cloudflareQuotas` 未删；
  - `readPlatformSettings()` 仍在恢复旧字段；
  - `cloudflareQuotaReason()` 仍依赖旧额度类型。
- `worker/src/index.ts`：
  - `platformSettingsApi` 仍在 PUT `cloudflareQuotas`；
  - `enforceCloudflareUsageQuotas` 仍读 `settings.cloudflareQuotas`；
  - usage 结果没有 `plan/limitSource/limits`；
  - 缓存仍是旧结构。
- `worker/runtime/analytics.test.ts` 仍有 `cloudflareQuotas` 维护测试残留。
- `worker/runtime/oauth-settings.test.ts` 仍断言 Cloudflare OAuth 和 `/auth/cloudflare/start`。
- `worker/oauth-settings.smoke.ts`、`worker/cloudflare-usage.smoke.ts` 仍是旧契约。
- 前端仍依赖旧 `src/api.ts` 类型：
  - `CloudflareOauthSettings`；
  - `CloudflareQuotas`；
  - `authorizationExpired`；
  - `fetchCloudflareAuthResult()`。
- 系统设置旧组件仍存在：
  ```text
  CloudflareAuthorizeSection.tsx
  CloudflareAccountCard.tsx
  CloudflareClientSection.tsx
  CloudflareClientFields.tsx
  CloudflareProtocolFields.tsx
  CloudflareScopeList.tsx
  CloudflareAuthDiagnostics.tsx
  useCloudflareAuthorization.ts
  useCloudflareClientForm.ts
  cloudflare-auth.ts
  ```
- 用量/维护 UI 仍读 `settings.cloudflareQuotas`：
  ```text
  src/features/settings/useMaintenanceSettings.ts
  src/features/settings/MaintenancePanel.tsx
  src/features/settings/QuotaSettings.tsx
  src/features/settings/QuotaForm.tsx
  src/features/usage/CloudflareUsageSection.tsx
  src/features/overview/UsageResourcesPanel.tsx
  ```
- `src/locales/en.ts`、`src/locales/zh-CN.ts`、`tests/console-worker.spec.ts`、`tests/console-real-stack.spec.ts` 仍含旧 OAuth、`response_type`、`authorizationExpired` 或手填额度。
- `README.md`、`docs/acceptance-matrix.md`、`docs/local-e2e.md`、`src/content/help.zh-CN.md`、`src/content/help.en.md`、`方案.md` 仍需同步。
- 历史 migration `worker/migrations/0002_cloudflare_oauth.sql` 保留，不要改写已发布 migration；运行时已不再使用该 state 表。

### 4.4 业务残留搜索基线

当前仍有旧契约的文件：

```text
worker/src/index.ts
worker/src/usage.ts
src/locales/en.ts
src/locales/zh-CN.ts
src/api.ts
tests/console-worker.spec.ts
tests/console-real-stack.spec.ts
src/features/usage/CloudflareUsageSection.tsx
src/features/usage/UsageStatusAlert.tsx
src/features/overview/UsageResourcesPanel.tsx
src/features/settings/useMaintenanceSettings.ts
src/features/settings/CloudflareProtocolFields.tsx
src/features/settings/CloudflarePanel.tsx
src/features/settings/CloudflareAccountCard.tsx
worker/oauth-settings.smoke.ts
worker/cloudflare-usage.smoke.ts
worker/runtime/analytics.test.ts
worker/runtime/oauth-settings.test.ts
README.md
docs/local-e2e.md
docs/acceptance-matrix.md
```

搜索命令：

```bash
rg -n "cloudflareQuotas|authorizationExpired|offline_access|workers-platform\.read|response_type|grant_type|PKCE|cloudflare_oauth|auth-result|/auth/cloudflare" \
  worker/src worker/runtime worker/*.smoke.ts src tests README.md docs scripts package.json
```

允许保留的只有历史 migration，或明确解释“已停用/已删除”的文档；不能有可执行旧逻辑。

## 5. 分阶段执行清单

### 5.1 后端 usage 契约（最先做）

1. `worker/src/usage.ts`：
   - 删除 `CloudflareQuotas` import；
   - 删除 `defaultCloudflareQuotas`；
   - 从 `defaultPlatformSettings` 删除 `cloudflareQuotas`；
   - `readPlatformSettings` 不再恢复旧字段；
   - 把 `cloudflareQuotaReason` 参数改为 `CloudflareUsageLimits`。
2. `worker/src/index.ts`：
   - `platformSettingsApi` PUT 不再接受/写回 `cloudflareQuotas`；
   - usage 未缓存时读取 subscriptions；
   - 返回 `plan/limitSource/limits`；
   - 缓存升级并校验新字段；
   - 只有 `limits` 存在时才判断免费额度触顶；
   - `CloudflareTokenError` 映射真实 HTTP。
3. 测试：
   - `analytics.test.ts` 删除 PUT `cloudflareQuotas`；
   - 覆盖未配置短路、旧 OAuth 短路、Free limits、非 Free unavailable、Analytics 401/403；
   - `cloudflare-settings.test.ts` 保持 Token 契约；
   - `scheduled.test.ts` 不再依赖 `cloudflare_oauth_states`。

完成标准：

```text
npm run worker:typecheck                         PASS
full worker runtime                              20/20 files / 84/84 tests PASS
定向 cloudflare-token/settings/analytics          20/20 PASS
```

### 5.2 重写旧 OAuth 测试和 smoke

- `worker/runtime/oauth-settings.test.ts` 只测 GitHub：
  - 超级管理员权限；
  - GET 不回显 secret；
  - 保存/继承 secret；
  - 非法回调；
  - 提交 `cloudflare` 返回 400。
- `worker/oauth-settings.smoke.ts` 删除所有 Cloudflare OAuth/protocol 断言。
- `worker/cloudflare-usage.smoke.ts` 重写为 Token + Free limits：
  - 未配置不发请求；
  - Token 凭据优先；
  - Free 8 项触顶原因；
  - 非 Free limits=null 不触发；
  - 401/403 真实 HTTP。

### 5.3 前端 Token 化

系统设置 Cloudflare 面板最终只保留：

- API Token 密码框；
- 可选 Account ID；
- 三项固定只读权限；
- Token 状态/最后校验时间；
- 创建 Token 链接；
- 当前 HTTP 错误、错误码和操作说明。

删除/重写：

```text
CloudflareAuthorizeSection.tsx
CloudflareAccountCard.tsx
CloudflareClientSection.tsx
CloudflareClientFields.tsx
CloudflareProtocolFields.tsx
CloudflareScopeList.tsx
CloudflareAuthDiagnostics.tsx
useCloudflareAuthorization.ts
useCloudflareClientForm.ts
cloudflare-auth.ts
```

建议组件边界：

```text
CloudflareTokenForm
CloudflareTokenStatus
CloudflarePermissionList
useCloudflareTokenForm
CloudflarePanel
```

`src/api.ts`：

- `CloudflareSettings` 改为 Token 契约；
- 删除 `CloudflareOauthSettings`；
- 删除 `fetchCloudflareAuthResult`；
- usage 增加 `plan/limitSource/limits`；
- 删除 `authorizationExpired`；
- 删除 `CloudflareQuotas` 和手填字段。

### 5.4 用量/设置 UI 清理

- 删除手填 Cloudflare 额度：
  - `useMaintenanceSettings.ts`
  - `MaintenancePanel.tsx`
  - `QuotaSettings.tsx`
  - `QuotaForm.tsx`
- `CloudflareUsageSection` 只使用 `usage.limits`。
- 未确认 Free 显示“未读取”。
- 8 项均显示次数和百分比。
- 平台请求不画上限。
- 只留一个清晰刷新按钮，自动加载期间不禁用。
- 清理重复 `/usage` 跳转、重复卡片、空信息卡和异常文案。
- 检查图标对齐、“默认工作区”高度遮挡、双主题多视口。

### 5.5 部署和 D1

- `worker/migrations/0008_workspaces.sql` 已存在，不改写已发布 migration。
- 必须确保 Cloudflare Workers Builds 的 Deploy command 是 `npm run deploy`，或等价地先执行 migrations 再发布。
- `scripts/deploy-worker.sh` 已有 pending migration 检查；仍需在真实 Workers Builds 配置中确认。
- 验证全部 migrations 后，生产接口不再出现 `D1_ERROR: no such table: workspaces`。
- 涉及 Worker 运行时/Cloudflare 时运行：
  ```bash
  npm run worker:runtime-test
  npm run deploy:worker:test
  ```

### 5.6 手动原生构建

新增仅 `workflow_dispatch` 的 workflow（建议 `.github/workflows/build-plugin-server.yml`）：

- 输入：可执行程序 / 共享库。
- 输入：目标平台 Linux、Windows、macOS；明确 x64/arm64 支持范围。
- 不与 tag release 冲突。

`native-server/CMakeLists.txt`：

- 增加 `PLUGMESH_BUILD_SERVER`、`PLUGMESH_BUILD_CORE_SHARED` 等明确开关。
- `plugmesh_core` 现在是 STATIC，必须新增真正共享库 target，不能只改扩展名。
- Windows 处理 OpenSSL DLL/applocal；macOS/Linux 处理 OpenSSL 查找和 RPATH/部署边界。

产物：

- 可执行文件：`plugmesh-server`、运行依赖、README、SHA256。
- 共享库：库文件、公共头文件、OpenSSL/运行时依赖说明、README、SHA256。
- 工作流上传 artifact，并生成校验和。

### 5.7 帮助中心与旧文档

同步更新：

```text
src/content/help.zh-CN.md
src/content/help.en.md
native-server/README.md
README.md
docs/acceptance-matrix.md
docs/local-e2e.md
方案.md
```

至少覆盖：

- 下载可执行文件/库文件和校验和。
- 校验 SHA256。
- `plugmesh-server --register ...`。
- `PLUGMESH_PLUGIN_DIRECTORY`、`PLUGMESH_PLUGIN_HOST`。
- 启动、绑定服务器、加载插件。
- 库文件如何链接/嵌入。
- 所需头文件、库文件、OpenSSL 运行库。
- 可执行文件与库文件的部署边界和常见错误。
- 删除旧 Cloudflare OAuth FAQ。

## 6. 当前测试证据与复现命令

### 6.1 2026-10-23 03:03 实测

```text
npm run worker:typecheck                         FAIL（27 个 TS2339/TS2305/TS2353）
Token/settings/analytics 定向 runtime             20/20 PASS
full worker runtime                              82/84 PASS（19/20 files）
full worker runtime 失败                          2/2 位于旧 oauth-settings.test.ts
git diff --check                                 PASS
```

定向命令：

```bash
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$PWD:/workspace" -w /workspace node:22-bookworm \
  npx vitest run --config vitest.workers.config.ts \
  worker/runtime/cloudflare-token.test.ts \
  worker/runtime/cloudflare-settings.test.ts \
  worker/runtime/analytics.test.ts
```

完整 runtime：

```bash
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$PWD:/workspace" -w /workspace node:22-bookworm \
  npx vitest run --config vitest.workers.config.ts
```

宿主 GLIBC 2.31 低于 `@cloudflare/workerd-linux-64` 要求，runtime 必须使用 `node:22-bookworm` Docker；不要因宿主 workerd 的 GLIBC 报错误判代码失败。

其他验收命令：

```bash
npm run worker:typecheck
npm run worker:smoke
npm run build
npm run ui:conventions
npm run ui:css-audit
npm run ui:smoke
npm run deploy:worker:test
npm run ci:local
```

涉及 native/CMake 时：

```bash
cmake -S native-server -B native-server/build -DCMAKE_BUILD_TYPE=Release
cmake --build native-server/build --parallel
ctest --test-dir native-server/build --output-on-failure
```

### 6.2 推送闭环

- 推送前至少 `git diff --check`；涉及运行时必须跑完整 runtime 和 smoke。
- 提交信息按逻辑拆分，中文、可追溯。
- 推送后必须查询 workflow 到 `completed`；不能只看“已 push”。
- 失败时读取失败 step、日志和失败产物；修复后重新本地验证、提交、推送、查 Actions。
- 未认证 API 下载日志可能 403；使用 `gh run view --log-failed` 或带认证 API，不要把 403 当代码失败。
- 改动 `.github/workflows/platform-ci.yml` 会触发 native 路径过滤，必须验证三平台 job，而不是只盯 web。

## 7. 最终验收清单

- [ ] 登录页实际视觉检查通过，组件结构保留且没有旧页面残留。
- [ ] 侧栏“默认工作区”文字不遮挡，图标/文字对齐。
- [ ] 系统设置只出现 Cloudflare API Token 和可选 Account ID。
- [ ] 不出现 Client ID/Secret、回调、scope 编辑、PKCE、`response_type`、`grant_type`。
- [ ] 固定权限为 Account Settings Read / Account Analytics Read / Billing Read，只读不可取消。
- [ ] “创建 Token”跳到 `https://dash.cloudflare.com/profile/api-tokens`。
- [ ] Token 保存前 verify、账号发现、subscriptions 校验全部完成；失败用 HTTP 状态并在当前面板显示。
- [ ] 旧 OAuth 路由、Cookie、refresh/revoke、state 清理、smoke 和文案全部删除。
- [ ] setup 返回 null 时与其他非路由行为一致，没有 “Setup is not available”。
- [ ] 未配置 Cloudflare 时 `/api/usage/cloudflare` 返回 `{"configured":false,"cached":false}`，无外部请求、无旧缓存命中。
- [ ] `/api/usage/local?range=7d` 仍返回 200，不受 Cloudflare 配置影响。
- [ ] Cloudflare 免费额度从 subscriptions 读取，只有确认 Free 才显示官方基线；不可确认显示未读取。
- [ ] Worker、D1 行读/行写、KV 读/写/删/列表、DO 请求共 8 项均显示次数和百分比。
- [ ] 平台统计与 Cloudflare 额度分组；平台请求不设上限。
- [ ] 设置页无手填 Cloudflare 免费额度。
- [ ] 用量页只有一个刷新入口；概览无同目的重复按钮；异常文案/空卡片已清理。
- [ ] 生产部署应用 0008 及全部 migrations，`workspaces` 表存在，`npm run deploy` 是 Workers Builds 实际入口。
- [ ] 手动 Actions 可选可执行程序/库文件、目标平台，并上传 artifact + SHA256。
- [ ] 帮助中心中英文都有二进制插件服务器与库文件插件的完整使用说明。
- [ ] `npm run ci:local`、Worker runtime tests、deploy test、native ctest 全部通过。
- [ ] 推送后最新 Actions 完成且成功；失败已定位、修复并重新验证。

## 8. 已知风险与硬约束

- 不能“把 OAuth 字段换个名字”继续保留 OAuth；目标是从路由、Cookie、配置、刷新、撤销、文案到测试全部移除 Cloudflare OAuth。
- 不能保存明文 Token；GET 设置接口永远不能回显 Token。
- 旧 OAuth 密文只能识别和提示重新录入，不能 refresh/revoke/查询。
- 不能因为 Billing Read 读取 subscriptions 出现权限问题就删掉固定权限；应核对官方文档和真实响应，准确映射 401/403/404/其他错误。
- 未确认 Free 时不能展示 8 项固定上限；`limits` 必须为 `null`。
- 不能把平台请求套上 Cloudflare Worker 请求上限；平台只统计，Cloudflare 官方额度独立。
- 不能恢复 `/?auth_error=`、Cloudflare auth-result Cookie、跳首页或 “Setup is not available” 特例。
- 不能用删断言、临时兼容旧字段、重引 OAuth 或手写 mock 的方式制造绿色。
- 不要为了“组件化”把所有东西拆成无意义小组件；组件边界应可独立命名、测试和理解。
- 不要批量回滚当前工作区：UI 草稿包含 8 项额度展示和平台请求“不限”的有效意图；后端文件包含已验证的 Token 设置与用量实现。两组都应在 OAuth 删除和 limits 数据模型落地后整合。
- 官方免费基线可能随 Cloudflare 政策变化；UI 应标注来源和核对日期，不能声称实时计费。
- `worker/migrations/0002_cloudflare_oauth.sql` 是历史 migration，不应删除或改写；只删除运行时逻辑。

## 9. 最近动作日志

- 2026-10-23 03:03：在当前 HEAD `7a54cfc` 上重新实测，确认 `worker:typecheck` 仍为 27 个旧 `cloudflareQuotas` 类型错误，完整 runtime 仍为 82/84（19/20 files，2 个旧 oauth-settings 测试失败）；当前 22 个代码路径未提交，HANDOFF 保持独立可推送。GitHub Actions run `39835890828`（#48）为 `completed/success`。
- 2026-10-23 03:00：重新核对磁盘与 GitHub。确认最新已验收 Actions 为 `cc00faf` 的 run `39834314392`（#47，success）；实测 `worker:typecheck` 27 个错误、完整 runtime 82/84（19/20 files，2 个旧 oauth-settings 测试失败）、Token/settings/analytics 定向 20/20、`git diff --check` 通过。本次重写 HANDOFF，把 OAuth 已删除事实、usage 契约、剩余前端/文档/部署/原生构建工作和真实阻塞全部固化。
- 2026-10-23 02:52：开始执行后端 Cloudflare OAuth 删除步骤：移除授权/回调/auth-result 路由、OAuth 配置与环境变量、refresh/revoke 桩、state 清理、旧 smoke 和旧测试；保留并验证 Token 设置/用量 API。
- 2026-10-23 02:46：核对 `1a5e5c1` 的 run `39833249358` 为 `completed/success`；修正 HANDOFF 中过时的 HEAD、Actions 和测试目标。
- 2026-10-23 02:38：刷新 HEAD/`origin/main` 为 `f9ae7b8`、最近 Actions 为 run `39832365360` 成功；当时 10 个代码文件仍未提交，下一步仍是删除 Cloudflare OAuth 链路。
- 2026-10-23 02:32：Token/settings/analytics 定向 20/20；当时完整 runtime 86/90，4 个失败全部是旧 OAuth refresh/过期用例；确认 usage 已改成先凭据后缓存、未配置和旧 OAuth 短路、Analytics 401/403 真实 HTTP。
- 2026-10-23 02:20：Cloudflare Token 设置阶段完成；设置 + Token 定向 runtime 14/14 通过、`worker:typecheck` 通过；当时完整 runtime 为 85/89 通过。
- 2026-10-23：完成 Cloudflare Token 设置 API：GET 固定权限和不回显 Token；PUT 全链路校验后加密保存并清缓存；DELETE 不调用 Cloudflare；旧 OAuth 密文识别。
- 2026-10-23：核对 subscriptions 响应：`{ result: Subscription[], errors, messages }`，含 `rate_plan.id`、`rate_plan.public_name`、`state`；只有实际 `rate_plan.id === "free"` 才能确认 Free。
- 2026-10-23：核对 API Token 权限文档，确认 Account Settings Read、Account Analytics Read、Billing Read 真实存在。
- 2026-10-23：确认 `eb414d0` #44、`2a32bfe` #43、`a0539fb` #42、`c32a587` #41、`e3cdb05` #40 Actions 均成功。
- 2026-10-23：历史失败 `fd80fa4` #11、`1e4fd10` #12 继续保留为警示，不能从记录中删除。
