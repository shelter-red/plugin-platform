# Plugmesh 平台交接（HANDOFF）

> 最后更新：2026-10-23 02:38（Asia/Shanghai）
> 状态：**进行中，当前工作区不可直接推送**
> 维护规则：每完成一个可验证步骤，先更新本文件，再提交一条可追溯的中文 Git 记录；未记录不得继续下一步。
> 本文件是压缩后优先读取的事实来源。若 README、验收矩阵、旧注释或聊天摘要与本文冲突，以用户最新要求和实际代码为准；旧文档必须在实现完成后同步重写。

## 0. 压缩恢复卡（先看这里）

- 仓库：`/home/tc/work/plugin-platform`
- 分支：`main`
- 整理时 HEAD 与 `origin/main`：`f9ae7b8 docs: 重整交接台账并记录 Token 用量迁移进度`
- 最近已验收 Actions：run `39832365360`，`completed/success`（`f9ae7b8`）；`39830753816`（`eb414d0`）也成功。
- 当前环境没有 `AGENTS.md`；未发现额外仓库级代理指令。
- 除本 `HANDOFF.md` 外，工作区有 **10 个未提交代码文件**，必须分组理解和处理：
  - UI/额度草稿 5 个：
    ```text
    M src/features/overview/UsageResourcesPanel.tsx
    M src/features/usage/PlatformUsageSection.tsx
    M src/locales/en.ts
    M src/locales/zh-CN.ts
    M tests/console-worker.spec.ts
    ```
    这些改动包含 8 项额度展示、D1 写入/KV 删除/KV 列举、平台请求“不限”等有效方向，但仍依赖旧的 `settings.cloudflareQuotas`、`authorizationExpired` 和旧 OAuth 测试假设。**不要回滚，也不要原样提交。**
  - Cloudflare Token 设置/用量后端 5 个：
    ```text
    M worker/runtime/analytics.test.ts
    M worker/runtime/cloudflare-settings.test.ts
    M worker/runtime/outbound-stub.ts
    M worker/src/cloudflare-token.ts
    M worker/src/index.ts
    ```
    设置 API 和用量 API 均已迁到 API Token；定向测试成立，但同一份 `worker/src/index.ts` 仍保留旧 Cloudflare OAuth 路由/导入，完整 runtime 仍有 4 个旧 OAuth 用例失败。**修完全链路前不能推送。**
- 禁止执行 `git reset --hard`、`git clean`、`git checkout -- .`、`git add .` 或任何批量覆盖工作区命令。提交时必须显式列出文件。
- Cloudflare 最终方案只有 **长期 API Token**，不再使用 OAuth。Token 默认长期有效，但用户可撤销、策略可失效、权限可变；运行时仍要正确处理 401/403，但不能把它描述为 OAuth 自然过期。
- 固定只读 Token 权限只有三项，用户不可编辑、不可取消：
  - `Account Settings Read`
  - `Account Analytics Read`
  - `Billing Read`
- 创建 Token 链接固定为：`https://dash.cloudflare.com/profile/api-tokens`
- 不得出现 `offline_access`、`workers-platform.read`、PKCE、`response_type`、`grant_type`、Client ID/Secret、回调地址或可编辑 scope。
- 未配置 Cloudflare 时，`GET /api/usage/cloudflare` 必须立即返回 `{"configured":false,"cached":false}`，不读缓存、不发外部请求；`GET /api/usage/local?range=7d` 仍应返回 200，因为它是平台本地统计，不依赖 Cloudflare。
- 错误必须使用真实 HTTP 状态和 JSON，留在当前系统设置页；不得 `302 /?auth_error=...`、不得跳首页、不得用 Cookie 传授权结果。
- 免费额度不能手填，只能从 Cloudflare subscriptions 读取；只有明确 `rate_plan.id === "free"` 时展示官方 8 项基线，否则显示“未读取”。
- 平台请求只统计、不设上限；Cloudflare 官方免费额度独立展示，必须有已用次数和百分比。
- 推送前必须完整本地验证；推送后必须查最新 Actions 到成功。GitHub REST 轮询间隔至少约 1 分钟。

### 0.1 当前最强恢复结论

已经完成的代码事实：

- `cloudflareSettingsApi` 已切到 API Token：verify → accounts 全分页 → 账号唯一性/指定账号校验 → subscriptions → 加密保存。
- `cloudflareUsageApi` 已切到 API Token：
  - 先读凭据，再读缓存；
  - 无凭据或旧 OAuth 密文立即短路；
  - 删除用量路径中的 refresh、revoke、`authorizationExpired`；
  - Analytics 401/403 返回真实 HTTP 状态和稳定错误码。
- 定向 runtime：
  ```text
  cloudflare-token.test.ts       8/8 PASS
  cloudflare-settings.test.ts    6/6 PASS
  analytics.test.ts              6/6 PASS
  合计                          20/20 PASS
  npm run worker:typecheck        PASS
  ```

仍阻塞的事实：

- 完整 runtime 为 **86 passed / 4 failed**，20/21 个测试文件通过；4 个失败全部来自 `worker/runtime/cloudflare-oauth.test.ts`：
  - 临近过期凭据自动刷新；
  - Analytics 401 后刷新重试；
  - 刷新失败提示重新授权；
  - 无 `refresh_token` 时提示重新授权。
- 这些失败不是要兼容的旧行为，而是证明下一步必须删除整个 Cloudflare OAuth 链路和对应测试。
- `/auth/cloudflare/start`、`/auth/cloudflare/callback`、`/api/settings/cloudflare/auth-result`、auth-result Cookie、旧 OAuth 配置、refresh/revoke、scheduled state 清理仍未删除。
- 旧 smoke 仍可能使用 `{accessToken}` 契约，`package.json` 仍包含旧 Cloudflare OAuth smoke 入口；必须删除或重写。
- usage 响应仍没有只读 `plan` / `limitSource` / `limits`，维护判断仍读 `settings.cloudflareQuotas`。
- 前端仍使用旧 OAuth 表单、可编辑额度、`authorizationExpired` 和多个刷新入口。
- README、验收矩阵、local-e2e 和中英文帮助仍有旧 OAuth/手填额度内容。

### 0.2 下一步顺序（不得跳步）

1. 本 HANDOFF 已提交并推送为 `f9ae7b8`，Actions `39832365360` 成功；后续每次状态变化先更新本文件，再推进代码。
2. 彻底删除 Cloudflare OAuth：
   - 路由、回调、Cookie、refresh/revoke、state 清理、Env、smoke、测试全部删除或重写；
   - `oauth-settings.ts` 只保留 GitHub；
   - `outbound-stub.ts` 删除 `/oauth2/token`、`/oauth2/revoke`；
   - 跑完整 runtime，目标是 21/21 文件、90/90 用例通过。
3. 把免费额度和 8 项上限接到 usage：
   - 删除 `PlatformSettings.cloudflareQuotas`；
   - 从 subscriptions 得到 `plan`、`limitSource`、`limits`；
   - 只有明确 Free 才返回 8 项官方基线；
   - 重写旧 `cloudflareQuotas` maintenance 测试。
4. 前端 Token 化：
   - 只保留 Token + 可选 Account ID；
   - 固定三项权限只读展示和创建 Token 链接；
   - 删除所有 OAuth/PKCE/response_type/grant_type 字段；
   - HTTP 错误留在当前设置面板。
5. 用量和 UI 清理：
   - 8 项次数/百分比；
   - 平台与 Cloudflare 分组；
   - 单一刷新入口；
   - 删除重复卡片/跳转、诡异文案、空信息卡；
   - 检查图标对齐和“默认工作区”高度。
6. 部署链路：确认 Workers Builds Deploy command 为 `npm run deploy`，先应用 migrations，关闭 `no such table: workspaces` 风险。
7. 新增仅 `workflow_dispatch` 的原生构建：可执行文件/共享库、目标平台、artifact、SHA256。
8. 中英文帮助中心补二进制插件服务器/库文件使用说明，并同步 README、验收矩阵、local-e2e。
9. 完整本地 CI → 中文提交 → 推送 → 最新 Actions 成功；失败读日志和失败产物并继续修。

## 1. Git、分支与 Actions 快照

恢复工作先执行：

```bash
cd /home/tc/work/plugin-platform
git status --short
git log -1 --oneline --decorate
git rev-parse HEAD origin/main
git diff --stat
git diff --check
```

当前权威快照（2026-10-23 02:38，Asia/Shanghai）：

- 整理时 HEAD / `origin/main`：`f9ae7b8`，run `39832365360` 成功。
- 上一提交：`eb414d0`，run `39830753816`（#44）成功。
- 最近已验收功能提交：`a0539fb feat(cloudflare): 增加 API Token 校验与凭据基础模块`，run `39827872017`（#42）成功。
- 此前已验收文档：`2a32bfe` run `39828876658`（#43）、`c32a587` run `39826901281`（#41）、`e3cdb05` run `39826112664`（#40）均成功。
- push 地址：`git@github-plugin-platform:shelter-red/plugin-platform.git`
- fetch 地址：`https://github.com/shelter-red/plugin-platform.git`
- 本 HANDOFF 提交会晚于上面的 HEAD；恢复时必须以实际 `git log -1` 为准，不要照抄旧 SHA。
- 本 HANDOFF 自身的 Actions run 不写回本文件，避免自我引用循环；推送后直接查询 GitHub。

已知 Actions 失败反例，不能重犯：

- `fd80fa4`，run `39754896119`（#11）：web 的“管理端 UI smoke”失败；native jobs 为 skipped。
- `1e4fd10`，run `39756824624`（#12）：web 的“管理端 UI smoke”失败，linux/windows/macos native 构建也失败；该提交改动 workflow 后触发了 native jobs。
- 后续提交已覆盖这些旧问题，但历史失败不能从记录中删除。每次新推送仍要重新验证。

查询 Actions：

```bash
curl -fsSL 'https://api.github.com/repos/shelter-red/plugin-platform/actions/runs?per_page=5' |
  node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{for(const r of JSON.parse(s).workflow_runs)console.log(r.head_sha.slice(0,7),r.status,r.conclusion??'-',r.id,r.display_title)})"
```

未认证 GitHub REST 限额为每小时 60 次；曾因 15 秒高频轮询触发 403。轮询至少间隔约 1 分钟，额度耗尽时等待 `X-RateLimit-Reset`，不要把 403 误判成 Actions 失败。

## 2. 用户问题总账（U01–U24）

状态图例：✅ 已实现并有验证证据；🟡 局部完成；⬜ 尚未开始或最终验收未通过。

| ID | 用户反馈或目标 | 必须达到的效果 | 当前状态 |
| --- | --- | --- | --- |
| U01 | “不是说全部重构成组件吗？登录页还是旧的？” | 登录页和全站有清晰组件边界；不重复重写；实际视觉验收 | 🟡 登录页、侧栏、账号、工作区已拆分；多主题/多视口最终视觉检查未完成。 |
| U02 | 自行从会话历史读分支、提交、推送 | 每步有中文 Git 记录；不靠聊天猜仓库/分支 | 🟡 分支和远端已知；HEAD `f9ae7b8` 的 run `39832365360` 成功；当前 10 个代码文件未提交，禁止误推。 |
| U03 | 推送时 Actions 老是失败 | 本地完整 CI；推送后追 Actions；失败读日志/产物并修到成功 | 🟡 最新已推送 HEAD 成功；当前完整 runtime 86/90，未全绿，禁止推代码。 |
| U04 | 错误状态为什么靠 `/?auth_error=` | 真实 HTTP status + JSON；留在当前页；不用查询参数/Cookie/跳首页 | 🟡 GitHub 登录和 Token 设置已使用 HTTP；旧 Cloudflare OAuth 路由、Cookie、跳转仍待删除。 |
| U05 | setup 失效为何单独返回 “Setup is not available” | `setupApi` 返回 `null` 时走普通非路由处理 | ✅ 已实现并有回归测试；后续改造不得破坏。 |
| U06 | `D1_ERROR: no such table: workspaces` | 部署前应用 0008 和全部 migrations；pending migration 时失败 | 🟡 `scripts/deploy-worker.sh` 已检查 migration；仍需核对 Workers Builds 实际部署命令和生产接口。 |
| U07 | `invalid_scope` / `workers-platform.read` 不允许 | 删除 OAuth scope；改用长期 API Token；固定三项真实权限 | 🟡 设置与用量后端已切 Token；旧 OAuth 模块/路由/smoke 仍存在。 |
| U08 | 授权失败后为什么跳首页 | 错误留在系统设置页，显示 HTTP 状态、稳定错误码和可操作说明 | 🟡 Token 保存错误已留在设置接口；旧 auth-result Cookie 和跳转账号仍待删除。 |
| U09 | 用户不知道怎么给 OAuth 权限，取消后权限就没了 | 权限固定只读、不可编辑；创建 Token 直达链接 | 🟡 后端 GET 固定返回三项权限；前端 Token 表单和链接尚未完成。 |
| U10 | “未识别唯一账号”也是权限问题 | verify → accounts 全分页 → subscriptions；不猜第一个账号 | ✅ 设置 API 和 14 个 token/settings 测试已覆盖；待随 Token 全链路提交。 |
| U11 | 用量和配额为什么没有刷新按钮 | 保留一个清晰手动刷新入口；刷新不被自动加载禁用 | ⬜ 当前仍有多处刷新/重复入口，未完成。 |
| U12 | OAuth 里没有 `offline_access` | 删除 offline_access、refresh 和“过期/重新授权”语义 | 🟡 用量路径已删除 refresh；旧 OAuth 模块、路由、测试和文案仍存在。 |
| U13 | `configured:false` 为什么还能查 `/api/usage/local` 且 200 | 分清 Cloudflare 与本地统计；未配置不读缓存、不发云请求 | ✅ `analytics.test.ts` 6/6 覆盖未配置和旧 OAuth 短路；`/api/usage/local` 仍独立返回 200。 |
| U14 | response_type 位置错误；CF OAuth 没有 PKCE | 最终 Token 方案删除 response_type/grant_type/PKCE；历史 OAuth UI 不应再出现 | ⬜ 最终验收仍是这些字段全部消失。若短暂保留旧 OAuth 页面，`response_type` 必须属于 OAuth 配置并显示 `code`，但目标不是保留它。 |
| U15 | `1e4fd10`、`fd80fa4` Actions 失败 | 每次失败修复后本地 CI、推送、Actions、失败产物闭环 | 🟡 最新 HEAD #44 成功；当前代码 runtime 未全绿，尚未到推送阶段。 |
| U16 | 图标没对齐；“默认工作区”很矮挡住文字 | 统一图标/按钮高度/gap/行高/居中；双主题多视口检查 | 🟡 `1b39960` 已修复主要问题并有 18 张截图基线；新增 UI 仍需回归。 |
| U17 | 配额少，D1 写入等所有限制都要监控，显示次数和百分比 | 8 项：Worker、D1 行读/写、KV 读/写/删/列表、DO；均有 used/limit/percentage | 🟡 已有 8 项 UI 草稿；上限仍来自手填 `cloudflareQuotas`，未接 subscriptions。 |
| U18 | 平台和监控分开；平台请求不限，CF 免费额度有限 | 平台只统计不设上限；Cloudflare 官方额度独立 | 🟡 分组和“不限”已有草稿；Cloudflare limits 来源仍错误。 |
| U19 | GitHub OAuth 没过期，CF 为什么过期；改用 Token | 不再暗示 OAuth 自然过期；界面/链接/错误全部 Token 化 | 🟡 后端设置和用量已迁移；前端、旧路由、文档仍待迁移。 |
| U20 | CF 免费额度为何能在系统设置配置；应从 CF 读取 | 删除手填；读 subscriptions；只有明确 Free 才展示基线，否则“未读取” | 🟡 token 模块可解析 Free；usage 响应/UI 和 `cloudflareQuotas` 清理未完成。 |
| U21 | 文案诡异、莫名卡片、同页多个按钮跳同一页面 | 通读中英文；清理技术黑话、重复说明、空卡片、重复跳转 | ⬜ 已知用量页多个刷新入口、概览重复 `/usage` 跳转，需全站审计。 |
| U22 | Actions 手动构建插件服务器：可执行/库、目标平台 | 仅 `workflow_dispatch`；真正共享库；artifact、SHA256、依赖说明 | ⬜ 尚未新增；当前 CMake 只有 STATIC core，不能改扩展名冒充共享库。 |
| U23 | 帮助中心说明二进制/库文件服务器怎么用 | 中英文覆盖下载、SHA256、启动/注册、env、插件目录/主机、链接、OpenSSL、常见错误 | ⬜ 尚未完成；现有帮助仍偏旧 OAuth FAQ。 |
| U24 | “都整理一下，写到磁盘 HANDOFF，避免压缩后忘记” | 所有用户要求、硬约束、当前代码事实、阻塞、下一步和验收命令必须可在磁盘恢复 | ✅ 本文件即权威台账；压缩恢复时先读第 0 节，再读 U01–U24 和对应执行清单。 |

总账完整性：U01–U24 覆盖本会话中组件化、登录页、HTTP 错误、setup、D1、Cloudflare OAuth/Token、固定权限、账号识别、刷新按钮、`configured:false`、`response_type`/PKCE、8 项额度与百分比、平台/Cloudflare 分组、额度来源、异常文案/重复卡片/重复跳转、图标对齐、Actions、原生手动构建、帮助中心和磁盘恢复要求。若用户新增反馈，继续追加编号，不覆盖旧条目。

## 3. Cloudflare Token 的固定契约

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
- 任何错误都留在当前设置页，不得 302、不得 `auth_error` 查询参数、不得 Cookie 回传。

稳定错误映射：

| HTTP | code | 场景 |
| --- | --- | --- |
| 400 | `token_required` | 首次保存缺少 Token 或请求体不合法 |
| 401 | `token_invalid` | Token verify 失败或 Analytics 明确 401 |
| 403 | `token_permission_denied` | accounts/subscriptions/Analytics 权限不足 |
| 409 | `account_missing` | 无可见账号，或指定 Account ID 不可见 |
| 409 | `account_ambiguous` | 未填 Account ID 且完整分页后有多个可见账号 |
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

### 3.3 用量接口和免费额度

未配置 Cloudflare：

```json
{"configured":false,"cached":false}
```

同时满足：不先读缓存、不请求外部 API、不凭旧缓存伪装已配置。旧 OAuth 密文额外返回明确提示，但仍不请求 Cloudflare。

配置 Token 后必须先凭据、后缓存。响应最终应包含只读：

```ts
{
  configured: true,
  plan: { id?: string; name?: string; free: boolean; confirmed: boolean },
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

只有确认 Free 才能返回 8 项官方基线；其他情况 `limits` 必须为 `null`，UI 显示“未读取”。前端不得继续读 `settings.cloudflareQuotas`。

官方免费基线（2026-10 核对，显示时注明来源和核对日期）：

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

## 4. 当前实现状态与代码地图

### 4.1 已提交、不要重复做

- `775384e`：登录页拆为 `LoginPage` / `AuthFrame` / 品牌 / 加载页。
- `7ab4c90`：侧栏与顶栏从外壳拆出。
- `1b39960`：工作区开关高度、文字遮挡、AntD 按钮图标基线修复；18 张双主题三视口截图验证。
- `742640e`：平台请求不限；Cloudflare 8 项额度与百分比；平台/Cloudflare 分组。
- `12e7aae`：用量页拆为状态提示、额度分组、数据源、分布部件。
- `abf05ca`：侧栏品牌、工作区切换、导航、页脚、账号/工作区页进一步拆分。
- `a0539fb`：Cloudflare Token 基础模块与 8 项 runtime 测试。
- `HANDOFF` 多次整理提交；不要再重复拆登录页、侧栏、账号、工作区。

### 4.2 已实现、未提交

- `cloudflareSettingsApi`：API Token 校验、固定权限、账号分页/唯一性、subscriptions、加密保存、旧 OAuth 识别、HTTP 稳定错误。
- `cloudflareUsageApi`：Token 凭据优先、未配置短路、旧 OAuth 短路、删除 refresh/revoke/`authorizationExpired`、Analytics 401/403 真实 HTTP。
- `cloudflare-token.ts`：保存新 Token 时原子更新密文并清 `usage_cache`。
- runtime stub：verify、accounts、subscriptions、Token 错误分支已补。
- 5 个 UI/额度草稿：8 项展示、平台请求不限、部分测试断言；仍依赖旧数据模型。

### 4.3 当前阻塞

- `worker/runtime/cloudflare-oauth.test.ts` 的 4 个 refresh/过期用例失败；这不是实现缺陷，而是旧 OAuth 测试还没删除。
- `worker/src/index.ts` 仍保留 Cloudflare OAuth 路由、auth-result、start/finish、state 清理和旧 imports。
- `worker/src/cloudflare-oauth.ts`、`worker/src/cloudflare-auth-result.ts` 仍存在。
- `worker/src/oauth-settings.ts` 仍混合 GitHub 与 Cloudflare OAuth，输出 responseType/grantType/tokenAuthMethod/scope 等。
- `worker/src/types.ts` 仍含 `CLOUDFLARE_OAUTH_*` 和 `cloudflareQuotas`。
- `worker/src/usage.ts` 和 `platformSettingsApi` 仍把 `cloudflareQuotas` 当作可编辑设置/维护阈值。
- `worker/runtime/outbound-stub.ts` 仍有 `/oauth2/token`、`/oauth2/revoke` 旧桩。
- `package.json` 仍有 `worker:cloudflare-oauth-smoke`、`worker:cloudflare-oauth-route-smoke`，`worker:smoke` 仍包含它们。
- `worker/cloudflare-oauth.smoke.ts`、`worker/cloudflare-oauth-route.smoke.ts`、`worker/cloudflare-usage.smoke.ts`、`worker/oauth-settings.smoke.ts` 需要删除或重写。
- 前端仍显示 OAuth Client/Scope/协议字段，仍允许编辑 Cloudflare 额度。
- 用量页仍有多个刷新入口；概览有重复 `/usage` 跳转。

## 5. 下一阶段的具体删除/重写清单

### 5.1 删除 Cloudflare OAuth 全链路

`worker/src/index.ts`：

- 删除 `/auth/cloudflare/start`。
- 删除 `/auth/cloudflare/callback`。
- 删除 `/api/settings/cloudflare/auth-result`。
- 删除 `startCloudflareAuth`、`finishCloudflareAuth`。
- 删除 auth-result Cookie/重定向函数。
- 删除旧 `storeCloudflareCredential` 和旧 OAuth imports。
- 删除 scheduled 中清理 `cloudflare_oauth_states`。
- 删除 `CloudflareCredential` 等旧类型依赖。

直接删除或重写：

```text
worker/src/cloudflare-oauth.ts
worker/src/cloudflare-auth-result.ts
worker/runtime/cloudflare-oauth.test.ts
worker/cloudflare-oauth.smoke.ts
worker/cloudflare-oauth-route.smoke.ts
worker/cloudflare-usage.smoke.ts
worker/oauth-settings.smoke.ts
```

`worker/src/oauth-settings.ts`：

- 收缩为仅 GitHub。
- 删除 Cloudflare client ID/secret/redirect/scope/protocol。
- 删除 `response_type`、`grant_type`、`tokenAuthMethod`、PKCE 等输出。

`worker/src/types.ts`：

- 删除 `CLOUDFLARE_OAUTH_*` Env 字段。
- 删除 `PlatformSettings.cloudflareQuotas`。

`vitest.workers.config.ts`：

- 删除 Cloudflare OAuth 环境变量。

`worker/runtime/outbound-stub.ts`：

- 删除 `/oauth2/token`、`/oauth2/revoke`。
- 保留 Token verify/accounts/subscriptions/GraphQL 所需桩。

`package.json`：

- 删除两个旧 Cloudflare OAuth smoke 脚本，并从 `worker:smoke` 移除。
- 把设置/用量 smoke 改成 Token 契约。

完成后搜索业务残留：

```bash
rg -n "offline_access|workers-platform\.read|response_type|grant_type|PKCE|cloudflare_oauth|authorizationExpired|cloudflareQuotas|auth_error|Setup is not available" worker/src worker/runtime src tests README.md docs
```

允许保留的只有历史 migration 或明确解释“已删除”的文档，不应有可执行旧逻辑。

### 5.2 接入只读 Free 额度和 8 项限制

- 删除 `PlatformSettings.cloudflareQuotas`。
- 删除平台设置 API 的 `cloudflareQuotas` 入参/输出。
- 删除前端可编辑 Cloudflare 额度表单和 `useMaintenanceSettings` 中对应字段。
- usage 从当前 Token 的 Account ID 调 `GET /accounts/{account_id}/subscriptions`。
- 只有明确 Free 才返回官方 8 项 `limits`；否则 `limits:null`。
- 更新 `analytics.test.ts` 的维护模式用例，不再 PUT `cloudflareQuotas`。
- 更新 `tests/console-worker.spec.ts`、`tests/console-real-stack.spec.ts`，使用 usage 响应里的只读 limits。

### 5.3 前端 Token 化和 UI 清理

系统设置只保留：

- Cloudflare API Token 密码框。
- 可选 Account ID。
- 三项固定只读权限。
- 当前校验状态和操作说明。
- 创建 Token 链接 `https://dash.cloudflare.com/profile/api-tokens`。

删除：

- Client ID/Secret。
- 回调地址。
- OAuth scope 编辑和勾选。
- `response_type`、`grant_type`、token endpoint auth method、PKCE。
- “授权已过期”“重新授权”等文案。

现有旧组件需要删除/重写：

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

建议新边界：

```text
CloudflareTokenForm
CloudflareTokenStatus
CloudflarePermissionList
useCloudflareTokenForm
CloudflarePanel
```

用量页：

- 只保留一个刷新入口。
- 未配置、Token 无效、权限不足、账号缺失、上游失败分别给出可操作提示。
- 平台请求不画上限百分比。
- Cloudflare 8 项显示次数和百分比。
- 未确认 Free 时显示“未读取”，不能显示伪造上限。

### 5.4 部署和 D1

- `worker/migrations/0008_workspaces.sql` 已存在，不改写已发布 migration。
- 必须确保 Cloudflare Workers Builds 的 Deploy command 是 `npm run deploy`，或等价地先执行 migrations 再发布。
- `scripts/deploy-worker.sh` 已有 pending migration 检查；仍需在真实 Workers Builds 配置中确认。
- 验证全部 migrations 后，生产接口不再出现 `D1_ERROR: no such table: workspaces`。

### 5.5 手动原生构建

新增仅 `workflow_dispatch` 的 workflow（建议 `.github/workflows/build-plugin-server.yml`）：

- 可执行程序 / 共享库。
- 目标平台：Linux、Windows、macOS；明确 x64/arm64 支持范围。
- 不与 tag release 冲突。

`native-server/CMakeLists.txt`：

- 增加 `PLUGMESH_BUILD_SERVER`、`PLUGMESH_BUILD_CORE_SHARED` 等明确开关。
- `plugmesh_core` 现在是 STATIC，必须新增真正共享库 target，不能只改扩展名。
- Windows 处理 OpenSSL DLL/applocal；macOS/Linux 处理 OpenSSL 查找和 RPATH/部署边界。

产物：

- 可执行文件：`plugmesh-server`、运行依赖、README、SHA256。
- 共享库：库文件、公共头文件、OpenSSL/运行时依赖说明、README、SHA256。
- 工作流上传 artifact，并生成校验和。

### 5.6 帮助中心

同步更新：

```text
src/content/help.zh-CN.md
src/content/help.en.md
native-server/README.md
README.md
docs/acceptance-matrix.md
docs/local-e2e.md
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

## 6. 测试与验收

### 6.1 当前证据（2026-10-23 02:38，Asia/Shanghai）

```text
npm run worker:typecheck                         PASS
cloudflare-token.test.ts                         8/8 PASS
cloudflare-settings.test.ts                      6/6 PASS
analytics.test.ts                                6/6 PASS
Token/settings/analytics 定向合计                20/20 PASS
full worker runtime                              86/90 PASS（20/21 files）
git diff --check                                 PASS
```

完整 runtime 的 4 个失败仅为旧 Cloudflare OAuth refresh/过期用例；删除旧 OAuth 后才算可推送状态。

### 6.2 本地命令

类型检查：

```bash
npm run worker:typecheck
```

定向 runtime：

```bash
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$PWD:/workspace" -w /workspace node:22-bookworm \
  npx vitest run --config vitest.workers.config.ts \
  worker/runtime/analytics.test.ts \
  worker/runtime/cloudflare-settings.test.ts \
  worker/runtime/cloudflare-token.test.ts
```

完整 runtime：

```bash
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$PWD:/workspace" -w /workspace node:22-bookworm \
  npx vitest run --config vitest.workers.config.ts
```

完整本地 CI：

```bash
npm run ci:local
```

涉及 Worker 运行时/Cloudflare 时还要：

```bash
npm run worker:runtime-test
npm run deploy:worker:test
```

涉及 native/CMake 时：

```bash
cmake -S native-server -B native-server/build -DCMAKE_BUILD_TYPE=Release
cmake --build native-server/build --parallel
ctest --test-dir native-server/build --output-on-failure
```

说明：当前宿主 GLIBC 2.31 低于 `@cloudflare/workerd-linux-64` 要求，runtime 测试使用 `node:22-bookworm` Docker 执行；不要因宿主 workerd 的 GLIBC 报错误判代码失败。

### 6.3 推送闭环

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
- [ ] 生产部署应用 0008 及全部 migrations，`workspaces` 表存在，`npm run deploy` 是 Workers Builds 实际部署入口。
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
- 不要批量回滚当前 10 个未提交代码文件：UI 草稿包含 8 项额度展示和平台请求“不限”的有效意图；后端文件包含已验证的 Token 设置与用量实现。两组都应在 OAuth 删除和 limits 数据模型落地后整合。
- 官方免费基线可能随 Cloudflare 政策变化；UI 应标注来源和核对日期，不能声称实时计费。

## 9. 最近动作日志

- 2026-10-23 02:38：按用户要求再次整理磁盘 HANDOFF，补齐 U24，刷新 HEAD/`origin/main` 为 `f9ae7b8`、最近 Actions 为 run `39832365360` 成功，并纠正文档时间戳。当前 10 个代码文件仍未提交；下一步仍是删除整个 Cloudflare OAuth 链路，确认完整 runtime 全绿后才推送代码。
- 2026-10-23 02:32：重新核对当前代码与测试：`worker:typecheck` 通过；Token/settings/analytics 定向 20/20；完整 runtime 86/90，4 个失败全部是旧 OAuth refresh/过期用例。确认 `cloudflareUsageApi` 已改为先凭据后缓存、未配置和旧 OAuth 短路、Analytics 401/403 真实 HTTP。本次整理 HANDOFF，明确下一步是删除整个 Cloudflare OAuth 链路。
- 2026-10-23 02:20：整理 HANDOFF 当前快照，并验证 Cloudflare Token 设置阶段；当时设置 + Token 定向 runtime 14/14 通过、`worker:typecheck` 通过；完整 runtime 为 85/89 通过，4 个失败全在旧 `analytics.test.ts`。该阻塞随后已由用量 Token 迁移解除。
- 2026-10-23：完成 Cloudflare Token 设置 API：GET 固定权限和不回显 Token；PUT 全链路校验后加密保存并清缓存；DELETE 不调用 Cloudflare；旧 OAuth 密文识别；settings + token 测试 14/14 通过。
- 2026-10-23：核对 Cloudflare 官方 subscriptions：响应为 `{ result: Subscription[], errors, messages }`，含 `rate_plan.id`、`rate_plan.public_name`、`state`；端点接受 `Billing Read`/`Billing Write`；只有实际 `rate_plan.id === "free"` 才能确认 Free。
- 2026-10-23：核对 Cloudflare API Token 权限文档，确认 Account Settings Read、Account Analytics Read、Billing Read 真实存在。
- 2026-10-23：确认 `eb414d0` 的 Actions run `39830753816`（#44）成功；`2a32bfe` #43、`a0539fb` #42、`c32a587` #41、`e3cdb05` #40 均成功。
- 2026-10-23：用户反馈历史累计：组件化、登录页、`auth_error`、setup、D1 缺表、Cloudflare OAuth 权限与 refresh、账号识别、额度刷新/8 项百分比、平台与 Cloudflare 分离、Token 迁移、subs 读取额度、异常文案/重复 UI、图标对齐、Actions 稳定性、手动原生构建、帮助中心和磁盘恢复；已全部固化在 U01–U24。
- 2026-10-23：`1e5fec7`、`4cc1b72`、`e4b8179`、`abf05ca` 等历史文档/组件化提交均已完成 Actions 闭环；历史失败 `fd80fa4` #11、`1e4fd10` #12 继续保留为警示。
