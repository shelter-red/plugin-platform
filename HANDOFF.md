# Plugmesh 平台交接（HANDOFF）

> 最后整理：2026-10-23（Asia/Shanghai）
> 当前状态：**Cloudflare API Token 后端已完成；前端 Token/用量迁移进行中；`npm run build` 失败；禁止推送，直到完整本地 CI 通过**
> 本文件是上下文压缩后的第一事实源。README、旧方案、旧测试、聊天摘要与本文冲突时，以用户最新要求和实际代码为准。恢复后先执行第 0 节的核验命令，再按第 5 节顺序继续。

## 0. 压缩恢复卡（先看这里）

### 0.1 仓库与分支

```text
仓库：/home/tc/work/plugin-platform
分支：main
更新本文件前的 HEAD：609ba8f docs: 校正 HANDOFF 当前构建阻塞与恢复基线
origin/main：579eb1f docs: 校正交接基线与最新 Actions 结果
本地关系：ahead origin/main 4 个提交
push remote：git@github-plugin-platform:shelter-red/plugin-platform.git
fetch remote：https://github.com/shelter-red/plugin-platform.git
```

本地领先远端的 4 个提交：

```text
9882c76 fix(worker): 收口 Cloudflare API Token 与只读额度契约
1dbec9c docs: 重整 HANDOFF 恢复基线与未完成事项
4d43b32 docs: 固化压缩恢复交接台账
609ba8f docs: 校正 HANDOFF 当前构建阻塞与恢复基线
```

- 这 4 个提交尚未 push，**没有对应 Actions 结果**。
- 最新已知远端成功 Actions：`579eb1f`，run `39840532476`（#52），`completed/success`。
- 仓库内未发现 `AGENTS.md`，无额外仓库级代理指令。
- 本次 HANDOFF 重写后可能再多一个仅文档提交；始终以实际 `git log -1` 为准。

恢复时先运行：

```bash
cd /home/tc/work/plugin-platform
git status --short --branch
git log -1 --oneline --decorate
git rev-parse HEAD origin/main
git diff --stat
git diff --check
find .. -name AGENTS.md -print
```

### 0.2 当前工作区：14 个未提交路径

已修改：

```text
 M src/api.ts
 M src/app/ConsoleShell.tsx
 M src/app/useConsoleData.ts
 M src/features/overview/UsageResourcesPanel.tsx
 M src/features/settings/CloudflarePanel.tsx
 M src/features/settings/SettingsPage.tsx
 M src/features/usage/PlatformUsageSection.tsx
 M src/locales/en.ts
 M src/locales/zh-CN.ts
 M tests/console-worker.spec.ts
```

新增未跟踪：

```text
?? src/features/settings/CloudflarePermissionList.tsx
?? src/features/settings/CloudflareTokenForm.tsx
?? src/features/settings/CloudflareTokenStatus.tsx
?? src/features/settings/useCloudflareTokenForm.ts
```

禁止 `git reset --hard`、`git clean`、批量 checkout、`git add .`。提交时必须逐文件显式 stage。

### 0.3 当前构建状态

最近实测：

```text
npm run build        FAIL
npm run worker:typecheck / full worker runtime / Cloudflare smoke
                     最近一次（提交 9882c76）PASS
git diff --check     PASS
```

`npm run build` 当前错误组：

```text
src/features/settings/CloudflareAuthorizeSection.tsx
src/features/settings/CloudflareClientFields.tsx
src/features/settings/CloudflareClientSection.tsx
src/features/settings/useCloudflareClientForm.ts
  OauthSettings.cloudflare / OauthSettingsInput.cloudflare 已删除

src/features/settings/CloudflareProtocolFields.tsx
  CloudflareOauthSettings 已删除

src/features/settings/useMaintenanceSettings.ts
  settings.cloudflareQuotas 可能 undefined，且代码仍 PUT 已废弃字段

src/features/usage/UsageStatusAlert.tsx
  CloudflareUsage.authorizationExpired 已删除
```

这些文件是旧实现，**不要把旧类型加回来让构建变绿**。先删除已无引用的旧 OAuth 文件，再迁移维护/用量 UI。

### 0.4 恢复后的第一动作

1. 执行 0.1 的 Git 核验，不凭记忆判断 HEAD。
2. 运行 `npm run build`，确认错误仍为 0.3 所列。
3. 按第 5.1 节删除旧 OAuth 死代码并迁移维护/用量 UI。
4. 补 locale、测试、文档。
5. 完整跑第 7 节验收，全部通过后才提交并 push。
6. push 后追最新 Actions 到 `completed`；失败必须读日志/Playwright artifact 并修到成功。

## 1. 绝对硬约束与已确定产品决策

### 1.1 Cloudflare 只用长期 API Token

- 彻底废弃 Cloudflare OAuth：路由、回调、state、Cookie、refresh、revoke、auth-result、OAuth 客户端配置和 refresh_token 语义全部不得保留。
- 创建 Token 链接固定为：

```text
https://dash.cloudflare.com/profile/api-tokens
```

- 固定三项只读权限，界面只展示，用户不能勾选、取消、增删或编辑：

```text
Account Settings Read
Account Analytics Read
Billing Read
```

- 最终用户可见界面和可执行逻辑不得出现：

```text
offline_access
workers-platform.read
PKCE
response_type
grant_type
Client ID / Client Secret
OAuth callback URL
可编辑 scope
```

- 用户曾要求把 `response_type` 放到 OAuth 配置页；之后又决定彻底改用 API Token。因此最终方案不是“移动 response_type”，而是让它随 Cloudflare OAuth 配置整体消失。
- Token 默认长期有效，但可能被撤销、权限被修改或用户设置过期时间。运行时仍须正确处理 401/403，文案应为“Token 无效或权限不足”，不能写“OAuth 授权已过期”或“refresh_token 不可用”。

### 1.2 错误必须走真实 HTTP，不跳首页

- API 错误必须使用真实 HTTP status + JSON `{code,message}`。
- 前端必须在当前系统设置/用量面板显示 HTTP 状态、错误码、消息和可操作说明。
- 不得：

```text
302 /?auth_error=...
Cookie 回传授权结果
跳转首页后 toast 一下
只显示泛化失败而丢失 status/code
```

- `setup` 失效返回 `null` 后走普通非路由行为，不返回单独的 `Setup is not available`。该行为已实现并有测试，后续不得破坏。

### 1.3 Cloudflare 未配置与额度来源

- 未配置 Cloudflare 时：

```json
{"configured":false,"cached":false}
```

- 此时不读旧缓存、不向 Cloudflare 发外部请求。
- `GET /api/usage/local?range=7d` 仍独立返回 200；本地平台统计不依赖 Cloudflare。
- Cloudflare 免费额度不能手填，只能从 subscriptions 读取。
- 只有响应中 `rate_plan.id === "free"` 且确认后才展示官方基线；空结果、缺字段或结构不符都显示“未读取”。
- 只有确认 Free 时展示以下 8 项每日额度：

```text
workerRequests    100,000
d1RowsRead      5,000,000
d1RowsWritten     100,000
kvRead            100,000
kvWrite             1,000
kvDelete            1,000
kvList              1,000
doRequests        100,000
```

- 每项必须显示已用次数、上限和百分比，包括 D1 行写入、KV 删除、KV 列举。
- 平台统计与 Cloudflare 额度必须分组：
  - 平台请求只统计次数，不设上限，不画百分比；
  - Cloudflare 8 项才显示官方额度与百分比。

### 1.4 UI 收口

- 用量页只保留一个刷新入口；`PageHeader` 的 `data-testid="usage-refresh"` 作为唯一按钮。
- 自动加载期间刷新按钮不能禁用，否则用户/测试点击会被静默吞掉。
- 概览不能同时保留右上箭头和底部“查看全部额度”这两个同目的入口。
- 清理重复按钮、重复卡片、空卡片、技术黑话和异常文案。
- 检查图标/文字对齐，以及左上角“默认工作区”高度是否遮挡文字。
- 登录页必须实际截图确认是新组件视觉，不能只看文件存在。

### 1.5 部署、Actions 与提交纪律

- 生产部署必须确保 Workers Builds 实际执行 `npm run deploy`，并先应用全部 D1 migrations，避免 `D1_ERROR: no such table: workspaces`。
- 本地完整 CI 通过前禁止 push。
- push 后必须追最新 Actions 到 `completed`；失败读日志和失败产物后再修。
- 未认证 GitHub REST 限额为每小时 60 次；Actions 轮询间隔至少约 1 分钟，不能高频制造 403。
- 提交按逻辑拆分，中文提交信息，显式 stage 文件。

## 2. 已提交后端：Cloudflare Token/usage 契约

本地提交 `9882c76` 已完成，不要重复实现或回退：

- 删除旧 Cloudflare OAuth 主链路：
  - `/auth/cloudflare/start`
  - `/auth/cloudflare/callback`
  - `/api/settings/cloudflare/auth-result`
  - auth-result Cookie
  - start/finish/redirect 函数
  - scheduled 中 `cloudflare_oauth_states` 清理
- 删除文件：

```text
worker/src/cloudflare-oauth.ts
worker/src/cloudflare-auth-result.ts
worker/runtime/cloudflare-oauth.test.ts
worker/cloudflare-oauth.smoke.ts
worker/cloudflare-oauth-route.smoke.ts
```

- `/api/settings/oauth` 仅保留 GitHub OAuth；提交 `cloudflare` 返回 400。
- `/api/settings/cloudflare` 已切 API Token：
  - GET 返回 `configured`、`credentialKind`、脱敏 `accountId`、固定 `permissions`、`updatedAt`、`lastVerifiedAt`、`legacyCredential`；
  - PUT 接收 `{apiToken, accountId?}`；
  - 保存顺序为 verify → accounts 全分页 → 唯一账号/指定账号校验 → subscriptions → 加密保存；
  - DELETE 只删平台保存的 Token 和 usage cache，不调用 Cloudflare 撤销。
- `/api/usage/cloudflare` 已先检查凭据再读缓存；未配置立即短路。
- `worker/src/cloudflare-token.ts` 提供官方 Free 8 项基线，只有 `plan.confirmed && plan.free` 才返回 limits。
- `worker/src/types.ts`、`worker/src/usage.ts` 已删除手填 `cloudflareQuotas`。
- `platformSettingsApi` 对提交 `cloudflareQuotas` 返回 HTTP 400 `cloudflare_quotas_read_only`。
- 后端测试桩已改为 Token verify/accounts/subscriptions，不再 mock OAuth token/revoke。

### 2.1 Cloudflare 设置目标契约

```ts
// GET /api/settings/cloudflare
{
  configured: boolean
  credentialKind: 'api_token' | 'legacy_oauth' | null
  accountIdConfigured: boolean
  accountId: string | null // 掩码
  permissions: string[]
  updatedAt: string | null
  lastVerifiedAt: string | null
  legacyCredential: boolean
}

// PUT
{ apiToken: string; accountId?: string }
```

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

### 2.2 用量目标契约

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

- 缓存必须同时携带 `plan/limitSource/limits`；缺字段的旧缓存视为 miss。
- 只有 `limits !== null` 才执行 Cloudflare 免费额度维护判断。
- `plan.confirmed === false` 或 `plan.free === false` 时显示“未读取/仅 Free 计划自动读取”，不能展示固定上限。

## 3. 前端当前进度

### 3.1 已完成的未提交基础

- `src/api.ts`
  - `CloudflareSettings` / `CloudflareSettingsInput` 已改为 API Token；
  - `CloudflareUsage` 已有 `plan`、`limitSource`、`limits`；
  - `ApiError` 保留 HTTP `status`、`code`、`message`、`field`；
  - 已删除 `CloudflareOauthSettings`、`OauthSettings.cloudflare`、`OauthSettingsInput.cloudflare`；
  - 已删除 `CloudflareAuthResult`、`fetchCloudflareAuthResult()`；
  - 已删除 `authorizationExpired`；
  - 仍暂留 `CloudflareQuotas` / `PlatformSettings.cloudflareQuotas` 作为迁移期兼容字段，**UI 清理完必须删除**。
- 新增 Token 组件（初版已落地）：
  - `CloudflarePermissionList.tsx`：固定三项权限、不可编辑；
  - `CloudflareTokenForm.tsx`：Token、可选 Account ID、保存/验证/撤销、创建 Token 链接；
  - `CloudflareTokenStatus.tsx`：脱敏账号、最后验证时间、旧 OAuth 提示；
  - `useCloudflareTokenForm.ts`：HTTP 错误保留 status/code/message。
- `CloudflarePanel.tsx` 已改为组合上述新组件。
- `SettingsPage.tsx` 已移除 Cloudflare OAuth 诊断 props。
- `useConsoleData.ts` 已删除 auth-result 轮询和 `cloudflareDiagnosis`。
- `ConsoleShell.tsx` 已同步函数签名，不再传 OAuth 诊断。
- `PlatformUsageSection.tsx` 已把平台请求显示为“不限”。

### 3.2 仍待清理

旧 Cloudflare OAuth 文件目前没有活跃 import，但因 tsconfig 包含整个 `src` 仍会参与编译。确认 `rg` 无引用后删除：

```text
src/features/settings/CloudflareAuthorizeSection.tsx
src/features/settings/CloudflareClientFields.tsx
src/features/settings/CloudflareClientSection.tsx
src/features/settings/CloudflareProtocolFields.tsx
src/features/settings/CloudflareScopeList.tsx
src/features/settings/CloudflareAuthDiagnostics.tsx
src/features/settings/CloudflareAccountCard.tsx
src/features/settings/cloudflare-auth.ts
src/features/settings/useCloudflareAuthorization.ts
src/features/settings/useCloudflareClientForm.ts
```

仍读手填额度或旧 OAuth 字段：

```text
src/features/settings/useMaintenanceSettings.ts
src/features/settings/MaintenancePanel.tsx
src/features/settings/QuotaSettings.tsx
src/features/settings/QuotaForm.tsx
src/features/usage/CloudflareUsageSection.tsx
src/features/usage/UsageStatusAlert.tsx
src/features/usage/UsageSourcesPanel.tsx
src/features/overview/UsageResourcesPanel.tsx
src/locales/en.ts
src/locales/zh-CN.ts
tests/console-worker.spec.ts
tests/console-real-stack.spec.ts
```

已知问题：

- `CloudflareUsageSection` 仍从 `settings.cloudflareQuotas` 取上限，而不是 `usage.limits`。
- `UsageResourcesPanel` 同样仍读手填额度，并同时保留右上箭头和底部 `/usage` 入口。
- `UsageStatusAlert` 仍引用 `authorizationExpired`，并带一个重复刷新按钮。
- `useMaintenanceSettings` 仍把 Cloudflare 免费额度当作用户可编辑表单，并 PUT `cloudflareQuotas`。
- locale 仍有 `authorizationExpired`、`refresh_token`、OAuth 客户端/scope/诊断码等旧文案；新 Token 组件引用的若干 key 也尚未补齐。
- `tests/console-worker.spec.ts` 仍 mock `/api/settings/cloudflare/auth-result`、`oauthSettings.cloudflare`、`cloudflareQuotas` 和旧 OAuth 面板。
- `tests/console-real-stack.spec.ts` 仍 PUT/还原 `cloudflareQuotas`。
- 文档仍大量描述 Cloudflare OAuth 和手填额度。

### 3.3 当前旧契约搜索基线

```bash
rg -n "cloudflareQuotas|authorizationExpired|offline_access|workers-platform\.read|response_type|grant_type|PKCE|cloudflare_oauth|auth-result|/auth/cloudflare|Setup is not available|auth_error=" \
  src tests README.md docs 方案.md worker/src worker/runtime worker/*.smoke.ts
```

允许保留：

- 历史 migration `worker/migrations/0002_cloudflare_oauth.sql`，不改写已发布 migration；
- 后端防御性拒绝 `cloudflareQuotas` 的 400 分支；
- 文档中明确标注“旧方案已删除”的历史说明，最好也移除，避免混淆。

不允许保留：

- 活跃 OAuth 路由/Cookie/refresh/revoke/scope 编辑；
- `authorizationExpired`、`refresh_token` 用户文案；
- 手填 Cloudflare 额度；
- 旧 auth-result 测试或跳首页逻辑。

## 4. 用户问题总账（U01–U24）

状态：✅已完成并有验证；🟡局部完成；⬜未完成。

| ID | 用户反馈/目标 | 必须达到的效果 | 当前状态 |
| --- | --- | --- | --- |
| U01 | 不是说全部重构成组件？登录页还是旧的 | 清晰组件边界；实际视觉验收 | 🟡 登录页/侧栏/账号/工作区已拆；最终截图验收未完成 |
| U02 | 自行从会话历史读 Git 分支、提交、推送 | 每步有中文 Git 记录；不靠聊天猜 | 🟡 `main` 领先 4 个未推送提交，14 个草稿未提交 |
| U03 | 推送时 Actions 老是失败 | 本地完整 CI + push 后追踪到成功 | 🟡 最新远端 #52 成功；当前 build FAIL，禁止 push |
| U04 | 错误为什么靠 `/?auth_error=` | 真实 HTTP + JSON，留在当前页 | 🟡 后端已无 Cloudflare 跳转；auth-result 前端轮询已删；旧文件/测试/文档仍待清理 |
| U05 | setup 失效为何单独返回 Setup is not available | 返回 null 后走普通非路由行为 | ✅ 已实现并有测试 |
| U06 | `D1_ERROR: no such table: workspaces` | 先应用全部 migrations 再部署 | 🟡 deploy 脚本已实现并测试；Workers Builds 控制台配置待核对 |
| U07 | `invalid_scope` / `workers-platform.read` | 删除 OAuth scope，改 API Token，固定真实权限 | 🟡 后端完成；前端新组件完成初版；旧死代码/文案/测试待删 |
| U08 | 授权失败为什么跳首页 | 错误留系统设置页，显示 HTTP/status/code/message | 🟡 新 Token 表单已保留 HTTP 错误；测试未同步 |
| U09 | 用户不知道 OAuth 给什么权限，取消后就没了 | 权限固定只读；创建 Token 直达链接 | 🟡 新组件已实现；locale/测试/文档待补齐 |
| U10 | 未识别唯一账号也是权限问题 | verify → accounts 全分页 → subscriptions，不猜账号 | ✅ 后端和 runtime 测试覆盖 |
| U11 | 用量/配额为什么没刷新按钮 | 一个清晰刷新入口，自动加载期间不禁用 | 🟡 自动加载与手动刷新已分离；仍有多处刷新按钮 |
| U12 | OAuth 没有 offline_access | 删除 offline_access/refresh/过期语义 | 🟡 后端与 API 类型已删；旧 UI/locale/test 仍有 |
| U13 | 未配置为何还能查 `/api/usage/local` 且 200 | 区分 Cloudflare 与本地统计；未配置不读缓存/不发请求 | ✅ 路由与测试已覆盖 |
| U14 | response_type 放错位置；CF OAuth 没有 PKCE | 最终 Token 方案中这些字段全部消失 | 🟡 新组件无这些字段；旧文件仍参与编译 |
| U15 | `1e4fd10`、`fd80fa4` Actions 失败 | 失败修复、本地 CI、push、Actions、产物闭环 | 🟡 最新远端成功；本地改动未 push |
| U16 | 图标没对齐；“默认工作区”很矮挡字 | 统一高度/gap/行高/居中；双主题多视口检查 | 🟡 已有高度修复；本轮新增 UI 未截图验收 |
| U17 | 额度少，D1 写入等都要监控且显示百分比 | 8 项 used/limit/percentage | 🟡 后端已就绪；UI 仍读手填额度 |
| U18 | 平台和监控分开；平台请求不限 | 平台只统计；Cloudflare 官方额度独立 | 🟡 后端完成；UI 待完成 |
| U19 | GitHub OAuth 没过期，CF 为什么过期；改 Token | 不再暗示 OAuth 过期；界面/链接/错误全部 Token 化 | 🟡 后端/API/新面板已 Token 化；旧文案与文档仍待清 |
| U20 | CF 免费额度为何在系统设置手填，应从 CF 读取 | 删除手填；读 subscriptions；未确认 Free 显示未读取 | 🟡 后端完成；维护/用量 UI 仍有手填 |
| U21 | 文案诡异、莫名卡片、同页多个按钮跳同页 | 中英文审计；清重复说明/空卡片/重复跳转 | ⬜ 未完成 |
| U22 | Actions 手动构建插件服务器：可执行/库、目标平台 | 仅 workflow_dispatch；真正共享库 + artifact + SHA256 | ⬜ 未开始 |
| U23 | 帮助中心说明二进制/库文件服务器怎么用 | 中英文完整使用说明 | ⬜ 未开始 |
| U24 | 都整理到磁盘 HANDOFF，避免压缩后忘 | 所有要求、事实、阻塞、步骤、验收可恢复 | ✅ 本次重写 |

## 5. 分阶段执行清单（严格按顺序）

### 5.1 删除旧 OAuth 死代码并修复构建

1. 先用 `rg` 确认下列文件无活跃 import：

```bash
rg -n "CloudflareAuthorizeSection|CloudflareClientSection|CloudflareClientFields|CloudflareProtocolFields|CloudflareScopeList|CloudflareAuthDiagnostics|CloudflareAccountCard|cloudflare-auth|useCloudflareAuthorization|useCloudflareClientForm" src tests
```

2. 删除第 3.2 节列出的 10 个旧 OAuth 文件。
3. 不要删除 GitHub OAuth 的 Client ID/Secret/回调；只清 Cloudflare 分支。
4. 重新跑 `npm run build`，剩余错误应只剩手填额度和 `authorizationExpired`。

### 5.2 迁移维护/用量 UI

#### 维护设置

- 重写 `useMaintenanceSettings.ts`，只保留平台 `quotas`：
  - `activeConnections`
  - `r2Bytes`
  - `r2Objects`
- 删除 `cloudflareForm` 和所有 `cloudflareQuotas` 保存/校验。
- 同步清理：
  - `MaintenancePanel.tsx`
  - `QuotaSettings.tsx`
  - `QuotaForm.tsx`
- 所有消费方清理完后，从 `src/api.ts` 删除 `CloudflareQuotas` 和 `PlatformSettings.cloudflareQuotas`。

#### 用量页

- `CloudflareUsageSection.tsx` 只读 `usage.limits`、`usage.limitSource`、`usage.plan`。
- 只有 `limitSource === 'cloudflare_subscriptions_free_baseline'` 且有 limits 时显示上限和百分比。
- 未配置显示未连接；未确认 Free 显示“未读取”，不能猜额度。
- 8 项都展示次数、上限、百分比。
- 平台请求只显示次数和“不限”。
- `UsageResourcesPanel.tsx` 同样改用 `usage.limits`，删除 `settings.cloudflareQuotas`。
- `UsageStatusAlert.tsx` 删除 `authorizationExpired` 和 refresh_token 文案；处理 `usage.legacyCredential`、`usage.error`、HTTP 401/403。
- 只保留 `PageHeader` 的 `data-testid="usage-refresh"` 一个刷新入口；删除 `UsageStatusAlert`、`UsageSourcesPanel` 内重复刷新按钮。
- 概览只保留一个 `/usage` 入口。

### 5.3 补齐中英文 locale

- 新 Token 组件需要补齐/核对：
  - `settings.cloudflare.tokenTitle`
  - `tokenDescription`
  - `tokenRequired`
  - `tokenSaved`
  - `tokenSaveFailed`
  - `tokenPlaceholderSaved`
  - `tokenPlaceholderNew`
  - `apiToken`
  - `accountIdOptional`
  - `accountIdPlaceholder`
  - `verifyToken`
  - `saveToken`
  - `createToken`
  - `tokenSecurityHint`
  - `revokeConfirm`
  - `revoked`
  - `revokeFailed`
  - `legacyTitle`
  - `legacyHint`
  - `notConfiguredHint`
  - `permissionMissing`
  - `requestFailed`
  - `requestFailedLocal`
  - `errorCode`
- 权限文案必须包含 `Account Settings Read`、`Account Analytics Read`、`Billing Read`。
- 删除 Cloudflare OAuth、refresh_token、授权过期、scope、诊断码等旧文案。
- 用量权限提示改为三项固定权限，包含 `Billing Read`。
- 保留 `cloudflare.credentials.*` 审计文案；清理 `cloudflare.oauth.*`。

### 5.4 修测试

#### `tests/console-worker.spec.ts`

重写为 Token mock：

- GET `/api/settings/cloudflare` 返回固定 permissions 和脱敏 Account ID。
- PUT 记录 `{apiToken, accountId?}`，成功后清空密码框。
- PUT 403 JSON 后仍停留在 `/settings`，面板显示 HTTP 状态、code、message。
- 断言无 scope 输入、无权限勾选按钮、创建 Token 链接正确。
- 删除 `/api/settings/cloudflare/auth-result`、`oauthSettings.cloudflare`、旧协议字段断言。

用量 mock 必须包含：

```ts
plan: { id: 'free', name: 'Free', free: true, confirmed: true },
limitSource: 'cloudflare_subscriptions_free_baseline',
limits: {
  workerRequests: 100_000,
  d1RowsRead: 5_000_000,
  d1RowsWritten: 100_000,
  kvRead: 100_000,
  kvWrite: 1_000,
  kvDelete: 1_000,
  kvList: 1_000,
  doRequests: 100_000,
},
```

#### `tests/console-real-stack.spec.ts`

- 删除手填 Cloudflare 配额流程和 `cloudflareQuotas` 的 PUT/还原。
- 维护开关与审计仍可验证。
- 真实栈不能安全测试真实 Token；保留“未配置时官方数据为空、本地统计正常”的断言。

### 5.5 同步文档

修改：

```text
README.md
docs/acceptance-matrix.md
docs/local-e2e.md
方案.md
src/content/help.zh-CN.md
src/content/help.en.md
src/content/privacy.zh-CN.md
src/content/privacy.en.md
native-server/README.md
```

写清：

- 创建 API Token，而不是 OAuth Client；
- 三项固定只读权限；
- Token 保存时会验证并读取账号/订阅；
- 401/403 是 Token 无效或权限不足，不是“OAuth 过期”；
- 只有确认 Free 才显示 8 项官方额度；
- 未配置时本地用量仍可用；
- 删除手填额度和旧 OAuth 教程。

### 5.6 视觉与文案清理

- 复核 `.workspace-switcher` 的 `height:auto; min-height:44px`，不要盲目重写；用截图多视口确认“默认工作区”不遮挡。
- 检查图标与文字垂直对齐、按钮高度、间距。
- 通读中英文：删除技术黑话、模板化句子、重复提示、空卡片。
- 搜索同一页面多个按钮跳同一路由，优先删除重复入口。
- 跑截图/UI smoke，确认登录页实际是新视觉。

### 5.7 手动原生构建 workflow

新增仅 `workflow_dispatch` 的 workflow，建议 `.github/workflows/build-plugin-server.yml`：

- 输入：可执行程序 / 共享库；
- 输入：Linux / Windows / macOS；
- 输入：x64 / arm64 支持范围；
- 输入：Release / Debug；
- 可选 artifact 前缀/版本；
- 不与 tag release 冲突。

`native-server/CMakeLists.txt`：

- `plugmesh_core` 当前是 STATIC，必须增加真正 SHARED target，不能只改扩展名。
- 增加构建开关，例如 `PLUGMESH_BUILD_SERVER`、`PLUGMESH_BUILD_CORE_SHARED`。
- 共享库暴露稳定 C ABI 和公共头文件。
- Windows 处理 OpenSSL DLL/applocal；Linux/macOS 处理 OpenSSL、RPATH/依赖边界。
- artifact 包含产物、依赖说明、README、`SHA256SUMS`。
- 文件名包含 OS/架构/构建类型，避免 `latest` 漂移标签。

### 5.8 帮助中心补二进制/库使用

至少覆盖：

- 下载可执行文件/共享库和 `SHA256SUMS`；
- 校验 SHA256；
- `plugmesh-server --register ...` 完整命令；
- `PLUGMESH_PLUGIN_DIRECTORY`、`PLUGMESH_PLUGIN_HOST` 等环境变量；
- 启动、绑定服务器、加载插件、健康检查；
- 共享库如何链接/嵌入宿主、公共头文件与 ABI；
- OpenSSL/运行时依赖；
- 常见错误：动态库找不到、ABI 不匹配、OpenSSL 版本、权限、注册码过期；
- 删除旧 Cloudflare OAuth FAQ。

### 5.9 部署与 D1

- `worker/migrations/0008_workspaces.sql` 已存在，不改写已发布 migration。
- `scripts/deploy-worker.sh` 已先应用全部 migrations、检查 pending、再发布。
- 仍需在 Cloudflare Workers Builds 控制台确认 Deploy command 为 `npm run deploy`。
- 验证生产不再出现 `no such table: workspaces`。

## 6. 测试证据与复现

### 6.1 后端 `9882c76` 最近一次实测

```text
npm run worker:typecheck                         PASS
full worker runtime                              20/20 files, 89/89 tests PASS
worker:cloudflare-usage-smoke                    PASS
worker:oauth-settings-smoke                      PASS
git diff --check                                 PASS
```

完整 runtime：

```bash
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$PWD:/workspace" -w /workspace node:22-bookworm \
  npx vitest run --config vitest.workers.config.ts
```

宿主 GLIBC 2.31 低于 `@cloudflare/workerd-linux-64` 要求，runtime 必须使用 `node:22-bookworm` Docker；不要因宿主 workerd GLIBC 报错误判代码失败。

定向测试：

```bash
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$PWD:/workspace" -w /workspace node:22-bookworm \
  npx vitest run --config vitest.workers.config.ts \
  worker/runtime/cloudflare-token.test.ts \
  worker/runtime/cloudflare-settings.test.ts \
  worker/runtime/analytics.test.ts
```

### 6.2 当前前端

```text
npm run build        FAIL，错误见 0.3
ui:conventions       本轮未跑
ui:css-audit         本轮未跑
ui:smoke             本轮未跑
ci:local             本轮未跑
```

本轮未联调：真实 Cloudflare API、Workers Builds、生产 D1、真实 GitHub OAuth、公网 SMTP。

## 7. 最终验收与推送闭环

至少执行：

```bash
git diff --check
npm run build
npm run ui:conventions
npm run ui:css-audit
npm run worker:typecheck
npm run worker:smoke
npm run ui:smoke
npm run deploy:worker:test
npm run ci:local
```

涉及 Worker runtime：

```bash
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$PWD:/workspace" -w /workspace node:22-bookworm \
  npx vitest run --config vitest.workers.config.ts
```

涉及 native/CMake：

```bash
cmake -S native-server -B native-server/build -DCMAKE_BUILD_TYPE=Release
cmake --build native-server/build --parallel
ctest --test-dir native-server/build --output-on-failure
```

推送流程：

1. 全部验收通过。
2. 按逻辑分组提交，显式 stage 文件，中文提交信息。
3. push 到 `main`。
4. 查询最新 Actions，间隔至少约 1 分钟，追到 `completed`。
5. 失败时读失败 step、日志和 `playwright-report` artifact；修复后重跑本地、再 push。
6. 只有最新 Actions 成功后才能宣称完成。

查询 Actions：

```bash
curl -fsSL 'https://api.github.com/repos/shelter-red/plugin-platform/actions/runs?branch=main&per_page=8' |
  node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{for(const r of JSON.parse(s).workflow_runs)console.log(r.head_sha.slice(0,7),r.status,r.conclusion??'-',r.id,r.run_number,r.display_title)})"
```

## 8. 最终验收清单

- [ ] 登录页实际视觉检查通过，组件结构保留且没有旧页面残留。
- [ ] “默认工作区”文字不遮挡，图标/文字对齐。
- [ ] 系统设置只出现 Cloudflare API Token 和可选 Account ID。
- [ ] 不出现 Client ID/Secret、回调、scope 编辑、PKCE、`response_type`、`grant_type`。
- [ ] 固定权限为 Account Settings Read / Account Analytics Read / Billing Read，只读不可取消。
- [ ] “创建 Token”跳到 `https://dash.cloudflare.com/profile/api-tokens`。
- [ ] Token 保存前完成 verify、账号发现、subscriptions 校验；失败用 HTTP 状态并在当前面板显示。
- [ ] 旧 OAuth 路由、Cookie、refresh/revoke、state、smoke 和文案全部删除。
- [ ] setup 返回 null 时没有 “Setup is not available” 特例。
- [ ] 未配置 `/api/usage/cloudflare` 返回 `{"configured":false,"cached":false}`，无外部请求、无旧缓存命中。
- [ ] `/api/usage/local?range=7d` 仍返回 200。
- [ ] Cloudflare 免费额度只从 subscriptions 读取；只有确认 Free 才显示官方基线。
- [ ] 8 项都显示次数和百分比，包含 D1 行写入、KV 删除、KV 列举。
- [ ] 平台统计与 Cloudflare 额度分组；平台请求不设上限。
- [ ] 设置页无手填 Cloudflare 免费额度。
- [ ] 用量页只有一个刷新入口；自动加载时刷新按钮不禁用。
- [ ] 概览无同目的重复按钮；异常文案/空卡片已清理。
- [ ] 生产部署应用 0008 及全部 migrations，Workers Builds 实际入口为 `npm run deploy`。
- [ ] 手动 Actions 可选可执行程序/库文件、目标平台，并上传 artifact + SHA256。
- [ ] 帮助中心中英文都有二进制/共享库插件服务器完整说明。
- [ ] `npm run ci:local`、Worker runtime、deploy test、native ctest 全部通过。
- [ ] 推送后最新 Actions 完成且成功。

## 9. 已知风险

- 不能“把 OAuth 字段换个名字”继续保留 OAuth；必须从路由、Cookie、配置、刷新、撤销、文案到测试全部移除。
- 不能保存明文 Token；GET 设置接口永远不能回显 Token。
- 旧 OAuth 密文只能识别并提示重新录入，不能 refresh/revoke/查询。
- 不能因为 Billing Read 读取 subscriptions 出现权限问题就删掉固定权限；应核对官方文档和真实响应，准确映射 401/403/404/其他错误。
- 未确认 Free 时不能展示 8 项固定上限。
- 不能把平台请求套上 Cloudflare Worker 请求上限。
- 不能恢复 `/?auth_error=`、auth-result Cookie、跳首页或 “Setup is not available”。
- 不能用删断言、临时兼容旧字段、重引 OAuth 或造假 mock 的方式制造绿色。
- 不要为“组件化”拆无意义小组件；组件边界应可独立命名、测试和理解。
- 不要批量回滚当前工作区：后端已提交，草稿包含有效 Token/8 项额度意图，也含旧契约残留，必须按本文件重写。
- 官方免费基线可能随 Cloudflare 政策变化；UI 应标注来源和核对日期，不能声称实时计费。
- `worker/migrations/0002_cloudflare_oauth.sql` 是历史 migration，不删除、不改写；只删除运行时逻辑。
- Actions 轮询不要过密；403 不等于代码失败。

## 10. 历史 Actions 与失败警示

最新成功：

```text
579eb1f  run 39840532476  #52  success
c84ceb0  run 39839503567  #51  success
92e3fcd  run 39837622904  #50  success
a9c85f0  run 39836893476  #49  success
7a54cfc  run 39835890828  #48  success
cc00faf  run 39834314392  #47  success
1a5e5c1  run 39833249358  #46  success
```

历史失败反例：

- `fd80fa4`，run `39754896119`（#11）：管理端 UI smoke 失败。
- `1e4fd10`，run `39756824624`（#12）：管理端 UI smoke 失败，linux/windows/macos native 也失败。
- 改 workflow 会触发 native 路径过滤，必须验证三平台，不能只看 web。
- run `39777807648` 曾因通知浮层遮挡刷新按钮和测试超时误判失败；修复后 run `39788653143` 通过。刷新按钮、通知位置和多加载用例超时不能回归。
- UI smoke 失败先下载 `playwright-report` artifact，并检查 `/tmp/plugmesh-playwright`、`/tmp/plugmesh-playwright-report`，不要只看超时名称。

## 11. 最近动作日志

- 2026-10-23：重写 HANDOFF，校正 HEAD 为 `609ba8f`、`origin/main` 为 `579eb1f`、本地领先 4 个提交、工作区 14 个路径；重新实测 `npm run build` 仍 FAIL，并确认旧 OAuth 死代码、`cloudflareQuotas`、`authorizationExpired` 是当前阻塞组。本文件不把未完成功能描述为完成，也不在 build FAIL 时 push。
- 2026-10-23：新增 Token 前端初版组件并接入 `CloudflarePanel`；`useConsoleData` 已删除 auth-result 轮询和 Cloudflare 诊断状态；`ConsoleShell`/`SettingsPage` 签名已同步；`PlatformUsageSection` 平台请求改为“不限”。
- 2026-10-23：后端 `9882c76` 完成 Cloudflare API Token 契约，完整 Worker runtime 20/20、89/89 通过，两个 Cloudflare smoke 通过。
- 2026-10-23：远端 #52 (`579eb1f`) 成功；本地 4 个提交尚未 push，不能声称其 Actions 已通过。
- 2026-10-23：确认 Cloudflare 最终只使用 API Token，固定三项权限，删除 `offline_access`、`workers-platform.read`、PKCE、`response_type`、`grant_type`、Client ID/Secret 和回调配置。
- 2026-10-23：确认免费额度只从 subscriptions 读取，只有 `rate_plan.id === "free"` 才展示 8 项官方基线。
- 2026-10-23：确认错误必须真实 HTTP + JSON，留在当前系统设置/用量页，不跳首页。
- 2026-10-23：确认 setup 失效走普通非路由行为，不返回 “Setup is not available”。
