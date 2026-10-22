# Plugmesh 平台交接（HANDOFF）

> 最后整理：2026-10-23 03:54（Asia/Shanghai）
> 状态：**前端 Token 化进行中，当前 `npm run build` 失败，禁止推送；Cloudflare Token/usage 后端已本地提交并验收；用量 UI、文案/视觉、部署核对、手动原生构建和帮助中心仍未完成**
> 核验前本地 HEAD：`4d43b32 docs: 固化压缩恢复交接台账`；本次核验的 HANDOFF 更新会作为独立文档提交，之后以 `git log -1` 为准
> 远端基线：`origin/main = 579eb1f docs: 校正交接基线与最新 Actions 结果`
> 本地关系：核验前领先 `origin/main` **3 个提交**（`9882c76` 后端 + `1dbec9c`、`4d43b32` 文档）；本次 HANDOFF 核验提交后领先 **4 个提交**。当前还有 **6 个未提交功能草稿**，全部尚未 push，因此没有对应 Actions run
> 恢复时仍以实际 `git log -1 --oneline --decorate` 和 `git status --short` 为准。
> 本文件是上下文压缩后的第一事实源。README、验收矩阵、旧注释、聊天摘要或历史方案与本文冲突时，以用户最新要求和实际代码为准；旧文档必须在实现后同步重写。

## 0. 压缩恢复卡（先看这里）

- 仓库：`/home/tc/work/plugin-platform`
- 分支：`main`
- push：`git@github-plugin-platform:shelter-red/plugin-platform.git`
- fetch：`https://github.com/shelter-red/plugin-platform.git`
- 当前远端最新成功 Actions：run `39840532476`（#52，`579eb1f`），`completed/success`
- 本地 HEAD `4d43b32` 及其父提交 `1dbec9c`、`9882c76` **尚未 push**，所以不能声称它们的 Actions 已通过；后端 `9882c76` 只完成了本地 Worker typecheck、runtime 和 smoke 验收。
- 仓库内未发现 `AGENTS.md`，没有额外仓库级代理指令。
- 当前工作区有 **6 个未提交功能草稿**（本 HANDOFF 整理已单独提交，不混入这些草稿）：
  ```text
  M src/api.ts
  M src/features/overview/UsageResourcesPanel.tsx
  M src/features/usage/PlatformUsageSection.tsx
  M src/locales/en.ts
  M src/locales/zh-CN.ts
  M tests/console-worker.spec.ts
  ```
- 这些草稿含有效意图（`src/api.ts` 的 Token 类型/错误码、平台请求“不限”、补 KV 删除/列举、D1 写入展示、测试字段），但前端消费方仍引用旧 OAuth/手填额度契约。**不能盲删，也不能整组直接提交。**
- 当前 `npm run build` **FAIL**：`src/app/useConsoleData.ts`、旧 Cloudflare OAuth 组件、`useMaintenanceSettings.ts`、`UsageStatusAlert.tsx` 仍引用已删除或已改名的旧类型/字段。完整错误见 6.1.1。
- 当前 `npm run worker:typecheck`：**PASS**；`git diff --check`：**PASS**。
- 后端 `9882c76` 已在 2026-10-23 03:35 再次实测全绿：
  - `npm run worker:typecheck`：**PASS**
  - 完整 Worker runtime：**20/20 文件、89/89 用例 PASS**
  - `npm run worker:cloudflare-usage-smoke`：**PASS**
  - `npm run worker:oauth-settings-smoke`：**PASS**
  - `git diff --check`：**PASS**
- **2026-10-23 03:54 当前进度：`src/api.ts` 已开始 Token 化。** 已加入 Token 设置/usage limits/plan 类型和稳定的 `ApiError.code/status/message` 解析，已删除 `fetchCloudflareAuthResult()`、Cloudflare OAuth 类型和 `authorizationExpired`；但 `CloudflareQuotas` 与 `PlatformSettings.cloudflareQuotas` 仍作为迁移期兼容字段存在，消费方尚未清理。下一步必须重写 Cloudflare 面板和用量 UI，再删除旧组件/hooks；不得重新引入 Cloudflare OAuth，也不得把已提交后端的 Token 契约回退成旧前端依赖。

### 0.1 绝对硬约束

- Cloudflare 最终方案只有 **长期 API Token**，不再使用 OAuth。
- Token 默认长期有效，但用户可撤销、策略可变化、权限可调整；运行时仍必须正确处理 401/403，但不能描述成“OAuth 自然过期”。
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
  - Cloudflare 8 项同时显示已用次数、上限和百分比；
  - 必须包含 D1 行写入、KV 删除和 KV 列举。
- 部署必须确保 Workers Builds 实际执行 `npm run deploy` 并应用 migrations，避免 `no such table: workspaces`。
- 推送前必须完整本地验证；推送后必须追最新 Actions 到 `completed`。失败必须读日志/产物并修到成功。
- 未认证 GitHub REST 限额为每小时 60 次；Actions 轮询至少间隔约 1 分钟。不要高频轮询制造 403。
- 禁止 `git reset --hard`、`git clean`、`git checkout -- .`、`git add .` 或批量覆盖工作区。提交时必须显式列文件。

### 0.2 已完成：后端 Cloudflare Token/usage 契约

本地提交 `9882c76` 已包含以下后端收口，不能再重复实现或回退：

- 删除旧 Cloudflare OAuth 主链路：
  - `/auth/cloudflare/start`
  - `/auth/cloudflare/callback`
  - `/api/settings/cloudflare/auth-result`
  - auth-result Cookie
  - start/finish/redirect 函数
  - scheduled 中 `cloudflare_oauth_states` 清理
  - 旧 OAuth imports
- 已删除文件：
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
- `worker/src/index.ts` 的 `cloudflareUsageApi` 已先读 Token 凭据、再读缓存：
  - 未配置返回 `{"configured":false,"cached":false}`；
  - 旧 OAuth 密文只提示重新录入，不 refresh/revoke/查询；
  - 只有 Free 确认后才给 8 项 limits 并执行维护判断；
  - subscriptions、Analytics 的 401/403 返回真实 HTTP；
  - 网络异常、非 JSON 响应返回 502，不产生未捕获异常。
- `worker/src/cloudflare-token.ts`：
  - 保存新 Token 时原子写凭据并清 `usage_cache`；
  - 新增官方 Free 8 项基线；
  - 新增 `cloudflarePlanLimits()`；只有 `plan.confirmed && plan.free` 才返回基线。
- `worker/src/types.ts`：
  - `Env` 已无 Cloudflare OAuth 环境变量；
  - `PlatformSettings.cloudflareQuotas` 已删除；
  - 新增 `CloudflareUsageLimits`、`CloudflarePlanSummary`。
- `worker/src/usage.ts`：
  - 删除 `defaultCloudflareQuotas`；
  - `defaultPlatformSettings` 不再含 `cloudflareQuotas`；
  - `readPlatformSettings()` 不再恢复旧额度字段；
  - `cloudflareQuotaReason()` 只接收 `CloudflareUsageLimits`。
- 测试桩已删除 `/oauth2/token`、`/oauth2/revoke`，改为 Token verify/accounts/subscriptions。
- `package.json` 已删除两个 Cloudflare OAuth smoke 脚本及 `worker:smoke` 引用。

### 0.3 当前阻塞与下一步顺序（不得跳步）

当前代码事实：

- `src/api.ts` 已部分 Token 化：新增 Token 设置契约、稳定 `ApiError` 字段、`CloudflareUsage.plan/limitSource/limits`；但迁移期仍保留 `CloudflareQuotas` 和 `PlatformSettings.cloudflareQuotas`，尚未删除。当前 `npm run build` 因消费方仍引用旧契约而失败。
- 系统设置仍由 `CloudflarePanel` 引用旧 `CloudflareAuthorizeSection`、`CloudflareClientSection`、`cloudflare-auth` 和 OAuth 表单/hooks。
- `useConsoleData.ts` 仍调用已删除的 `fetchCloudflareAuthResult()`，并在启动时处理旧 auth-result Cookie 回跳。
- `UsageStatusAlert.tsx` 仍读取已删除的 `usage.authorizationExpired`，构建因此失败。
- 用量页和概览仍读 `settings.cloudflareQuotas`，而不是 `usage.limits`；`useMaintenanceSettings.ts` 仍把 Cloudflare 免费额度当作用户可编辑表单。
- `UsageStatusAlert.tsx`、`UsageSourcesPanel.tsx` 仍各有刷新按钮，`PageHeader` 也有刷新入口；同页存在多个刷新按钮。
- `UsageResourcesPanel.tsx` 同时保留右上箭头和底部“查看全部额度”跳 `/usage`。
- 中英文 locale、`tests/console-worker.spec.ts`、`tests/console-real-stack.spec.ts` 仍有旧 OAuth、`authorizationExpired`、`refresh_token` 或手填额度断言。
- README、`docs/local-e2e.md`、`docs/acceptance-matrix.md`、`方案.md` 和中英文帮助中心仍有大量旧 OAuth/手填额度说明。
- 当前 `npm run build` 失败的错误集中在：`fetchCloudflareAuthResult` 缺失、旧 OAuth 组件读取 `OauthSettings.cloudflare`、`CloudflareProtocolFields` 引用已删除类型、`cloudflareQuotas` 可能为 undefined、`authorizationExpired` 缺失。修复顺序必须与下面第 1–4 步一致，不能用恢复旧类型掩盖错误。
- Workers Builds 生产 Deploy command 仍需到 Cloudflare 控制台核对；本地 `scripts/deploy-worker.sh` 已有 migrations 顺序和 pending migration 失败测试。
- 手动构建插件服务器的 workflow 尚未新增。
- 帮助中心仍缺二进制/共享库插件服务器的完整使用说明。

下一步顺序：

1. **完成前端 Token 化**：保留 `src/api.ts` 已完成的 Token/错误码类型，重写 `CloudflarePanel` 及 Token 表单/状态/权限组件，删除旧 OAuth 组件和 hooks，清理 `useConsoleData.ts` 的 auth-result 回跳。
2. **完成用量/维护 UI**：删除手填 `cloudflareQuotas`，改为 `usage.limits`；未确认 Free 显示“未读取”；8 项显示次数/上限/百分比；平台请求不设上限。
3. **清理界面和文案**：只保留一个刷新入口；自动加载期间刷新按钮不能禁用；清理重复 `/usage` 跳转、重复卡片、空卡片和诡异文案；检查图标对齐与“默认工作区”高度遮挡。
4. **同步测试**：重写 `tests/console-worker.spec.ts`、`tests/console-real-stack.spec.ts`，确保不再 mock 旧 OAuth 契约，也不再 PUT `cloudflareQuotas`。
5. **同步文档**：README、验收矩阵、local-e2e、`方案.md`、中英文帮助中心全部改为 API Token + subscriptions + 8 项额度。
6. **部署/D1**：确认 Workers Builds 的 Deploy command 为 `npm run deploy`，执行全部 migrations 后再发布。
7. **手动原生构建**：新增仅 `workflow_dispatch` 的 workflow，支持可执行文件/真正共享库和目标平台，产出 artifact + SHA256。
8. **帮助中心**：补二进制插件服务器和库文件服务器的下载、校验、启动、注册、依赖、插件目录、常见错误说明。
9. **完整本地 CI → 按逻辑分组中文提交 → push → 追踪最新 Actions 成功**。失败读日志/失败产物并继续修。

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

本次整理时记录：

- 核验前本地 HEAD：`4d43b32 docs: 固化压缩恢复交接台账`；本次 HANDOFF 核验提交在其后，提交哈希以 `git log -1` 为准
- `origin/main`：`579eb1f docs: 校正交接基线与最新 Actions 结果`
- 领先远端：核验前 `3` 个本地提交（`9882c76` 后端、`1dbec9c` 与 `4d43b32` 文档）；本次 HANDOFF 核验提交后为 `4` 个，均未 push
- 远端最新成功 Actions：run `39840532476`（#52，`579eb1f`），`completed/success`
- 本地 HEAD `4d43b32`：尚未 push，**没有 Actions 结果**
- 该后端提交统计：22 个路径，834 insertions / 1146 deletions；包含 `HANDOFF.md` 的上一版更新
- HANDOFF 文档提交后剩余的未提交功能草稿：
  ```text
  M src/api.ts
  M src/features/overview/UsageResourcesPanel.tsx
  M src/features/usage/PlatformUsageSection.tsx
  M src/locales/en.ts
  M src/locales/zh-CN.ts
  M tests/console-worker.spec.ts
  ```
- 当前验收：`npm run worker:typecheck` PASS；`git diff --check` PASS；`npm run build` FAIL（前端旧 OAuth/手填额度消费方尚未迁移）。

上一批成功 Actions 记录：

- `579eb1f` run `39840532476`（#52）
- `c84ceb0` run `39839503567`（#51）
- `92e3fcd` run `39837622904`（#50）
- `a9c85f0` run `39836893476`（#49）
- `7a54cfc` run `39835890828`（#48）
- `cc00faf` run `39834314392`（#47）
- `1a5e5c1` run `39833249358`（#46）

为什么本地两个提交还没 push：

- `9882c76` 只保证 Worker 后端契约通过本地验收；
- 仓库前端、UI 测试和真实栈测试仍按旧 OAuth/手填额度契约编写；
- 当前未提交的 `src/api.ts` 已删除旧导出，导致 `npm run build` 直接失败；
- 在这些依赖尚未同步时推送，可能让平台验收 Actions 失败；
- 正确路径是先完成前端/测试/文档，再完整跑 `npm run ci:local`，然后按逻辑分组提交并 push。

已知 Actions 失败反例，不能重犯：

- `fd80fa4`，run `39754896119`（#11）：管理端 UI smoke 失败。
- `1e4fd10`，run `39756824624`（#12）：管理端 UI smoke 失败，linux/windows/macos native 也失败。
- 这些提交改变 workflow 后触发 native jobs；以后改 workflow 必须验证三平台，而不是只看 web。
- run `39777807648` 曾因通知浮层遮挡刷新按钮和测试超时误判导致 UI smoke 失败；修复后 run `39788653143` 通过。刷新按钮、通知位置和多加载用例超时问题不能回归。

查询最新 Actions：

```bash
curl -fsSL 'https://api.github.com/repos/shelter-red/plugin-platform/actions/runs?branch=main&per_page=8' |
  node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{for(const r of JSON.parse(s).workflow_runs)console.log(r.head_sha.slice(0,7),r.status,r.conclusion??'-',r.id,r.run_number,r.display_title)})"
```

## 2. 用户问题总账（U01–U24）

状态图例：✅ 已实现并有验证证据；🟡 局部完成；⬜ 尚未开始或最终验收未通过。

| ID | 用户反馈或目标 | 必须达到的效果 | 当前状态 |
| --- | --- | --- | --- |
| U01 | “不是说全部重构成组件吗？登录页还是旧的？” | 登录页和全站有清晰组件边界；实际视觉验收 | 🟡 登录页、侧栏、账号、工作区已拆分；多主题/多视口最终视觉检查未完成。 |
| U02 | 自行从会话历史读分支、提交、推送 | 每步有中文 Git 记录；不靠聊天猜仓库/分支 | 🟡 `main` 在本次 HANDOFF 核验提交后领先 `origin/main` 4 个本地提交（`9882c76` 后端 + `1dbec9c`、`4d43b32`、本次核验文档），均未 push；工作区仍有 6 个未提交功能草稿，禁止误推或整组提交。 |
| U03 | 推送时 Actions 老是失败 | 本地完整 CI；推送后追 Actions；失败读日志/产物并修到成功 | 🟡 远端最新 #52（`579eb1f`）成功；本地两个提交尚未 push；当前 `npm run build` FAIL，必须修复并跑完整本地 CI 后才能 push。 |
| U04 | 错误状态为什么靠 `/?auth_error=` | 真实 HTTP status + JSON；留在当前页；不用查询参数/Cookie/跳首页 | 🟡 Cloudflare OAuth 路由/Cookie/跳转已删除，Token API 用 HTTP；前端 `useConsoleData.ts` 仍在轮询旧 auth-result，必须删除。 |
| U05 | setup 失效为何单独返回 “Setup is not available” | `setupApi` 返回 `null` 时走普通非路由处理 | ✅ 已实现并有回归测试；后续不得破坏。 |
| U06 | `D1_ERROR: no such table: workspaces` | 部署前应用 0008 和全部 migrations；pending migration 时失败 | 🟡 `scripts/deploy-worker.sh` 已先迁移后部署并校验 pending migration；仍需核对 Workers Builds 生产配置并验证接口。 |
| U07 | `invalid_scope` / `workers-platform.read` 不允许 | 删除 OAuth scope；改用长期 API Token；固定三项真实权限 | 🟡 后端 OAuth 主链路和 scope 已删除；`src/api.ts` 已删 OAuth Cloudflare 类型，但旧面板/文案/测试残留，当前构建失败。 |
| U08 | 授权失败后为什么跳首页 | 错误留在系统设置页，显示 HTTP 状态、稳定错误码和可操作说明 | 🟡 后端已无 Cloudflare 授权跳转；前端 Token 表单尚未完成。 |
| U09 | 用户不知道怎么给 OAuth 权限，取消后权限就没了 | 权限固定只读、不可编辑；创建 Token 直达链接 | 🟡 后端 GET 已返回固定三项权限；前端链接和只读清单尚未完成。 |
| U10 | “未识别唯一账号”也是权限问题 | verify → accounts 全分页 → subscriptions；不猜第一个账号 | ✅ 后端与 Token/settings/usage runtime 测试覆盖。 |
| U11 | 用量和配额为什么没有刷新按钮 | 保留一个清晰手动刷新入口；刷新不被自动加载禁用 | 🟡 `src/app/useConsoleData.ts` 已区分自动加载与手动刷新，`usageRefreshing` 不随自动加载禁用；但 `UsageStatusAlert`、`UsageSourcesPanel`、`PageHeader` 仍重复提供刷新，需收敛为一个。 |
| U12 | OAuth 里没有 `offline_access` | 删除 offline_access、refresh 和“过期/重新授权”语义 | 🟡 后端 refresh/revoke 已删，`src/api.ts` 已删 `authorizationExpired`；旧 `UsageStatusAlert`、locale、测试仍引用，当前构建失败。 |
| U13 | `configured:false` 为什么还能查 `/api/usage/local` 且 200 | 分清 Cloudflare 与本地统计；未配置不读缓存、不发云请求 | ✅ `analytics.test.ts` 覆盖未配置和旧 OAuth 短路；本地统计仍独立返回 200。 |
| U14 | response_type 位置错误；CF OAuth 没有 PKCE | 最终 Token 方案删除 response_type/grant_type/PKCE | ⬜ 最终验收要求这些字段全部消失；当前旧前端仍显示。 |
| U15 | `1e4fd10`、`fd80fa4` Actions 失败 | 每次失败修复后本地 CI、推送、Actions、失败产物闭环 | 🟡 远端最新 #52 成功；本地两个提交尚未 push；当前 Web build FAIL，不能做最终推送验收。历史失败原因与失败产物路径见第 6.3 节。 |
| U16 | 图标没对齐；“默认工作区”很矮挡住文字 | 统一图标/按钮高度/gap/行高/居中；双主题多视口检查 | 🟡 `1b39960` 已修主要问题并有截图基线；新增 UI 仍需回归。 |
| U17 | 配额少，D1 写入等所有限制都要监控，显示次数和百分比 | 8 项：Worker、D1 行读/写、KV 读/写/删/列表、DO；均有 used/limit/percentage | 🟡 后端 8 项 limits 已就绪；部分 UI 草稿已加入 8 项展示意图，但 `CloudflareUsageSection` / `UsageResourcesPanel` 仍读手填 `settings.cloudflareQuotas`，尚未接 `usage.limits`。 |
| U18 | 平台和监控分开；平台请求不限，CF 免费额度有限 | 平台只统计不设上限；Cloudflare 官方额度独立 | 🟡 后端数据模型已分离；UI 仍需完成分组和上限显示清理。 |
| U19 | GitHub OAuth 没过期，CF 为什么过期；改用 Token | 不再暗示 OAuth 自然过期；界面/链接/错误全部 Token 化；创建链接改为 `https://dash.cloudflare.com/profile/api-tokens` | 🟡 后端已 Token 化；`src/api.ts` 已删旧 OAuth 类型；旧 Cloudflare 面板、`useConsoleData`、文档和测试仍旧。 |
| U20 | CF 免费额度为何能在系统设置配置；应从 CF 读取 | 删除手填；读 subscriptions；只有明确 Free 才展示基线，否则“未读取” | 🟡 后端已从 subscriptions 读取；设置/用量 UI 仍保留手填 `cloudflareQuotas` 字段和保存逻辑。 |
| U21 | 文案诡异、莫名卡片、同页多个按钮跳同一页面 | 通读中英文；清理技术黑话、重复说明、空卡片、重复跳转 | ⬜ 用量页多个刷新入口、概览重复 `/usage` 跳转仍需全站审计。 |
| U22 | Actions 手动构建插件服务器：可执行/库、目标平台 | 仅 `workflow_dispatch`；真正共享库；artifact、SHA256、依赖说明 | ⬜ 尚未新增；当前 `plugmesh_core` 是 STATIC，不能改扩展名冒充共享库。 |
| U23 | 帮助中心说明二进制/库文件服务器怎么用 | 中英文覆盖下载、SHA256、启动/注册、env、插件目录/主机、链接、OpenSSL、常见错误 | ⬜ 尚未完成；现有帮助仍偏旧 Cloudflare FAQ。 |
| U24 | “都整理一下，写到磁盘 HANDOFF，避免压缩后忘记” | 所有用户要求、硬约束、当前代码事实、阻塞、下一步和验收命令必须可在磁盘恢复 | ✅ 2026-10-23 03:54 已再次实测并刷新 Git/Actions 基线、6 个功能草稿、`src/api.ts` 部分 Token 化状态、当前 build FAIL 逐项证据、后端已收口事实和 U01–U24；本次核验作为独立 docs 提交，恢复时先读第 0 节。 |

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
- `DELETE` 只删除本地 `cloudflare_credentials` 和 `usage_cache`，不调用 Cloudflare 撤销；Token 由用户自行到 Cloudflare 撤销。
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

前端 API 错误解析必须保留 `code`、`message` 和 HTTP status，不能只显示泛化失败；错误不能被转换成跳首页或 toast 后丢失上下文。

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
- `cloudflareQuotaReason()` 只接收 `CloudflareUsageLimits`，不能读 `PlatformSettings`。
- `platformSettingsApi` 的 GET/PUT 都不再接受、返回或持久化 `cloudflareQuotas`；PUT 若携带该字段返回 HTTP 400 `cloudflare_quotas_read_only`。
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
- `plan.confirmed === false` 或 `plan.free === false` 时显示“未读取/仅 Free 计划自动读取”，不能展示固定上限。

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

### 4.2 已提交的 Cloudflare Token/usage 后端

- 本地提交：`9882c76 fix(worker): 收口 Cloudflare API Token 与只读额度契约`（尚未 push）。
- Cloudflare 设置 API 的 Token 路径可用。
- Cloudflare usage API 的未配置短路、旧 OAuth 短路、401/403 映射、Free/非 Free limits 可用。
- Cloudflare Token 存储、脱敏、固定权限、账号分页/唯一性、subscriptions 校验有测试。
- OAuth 文件删除后完整 runtime 现在全绿：20/20、89/89。
- `git diff --check` 通过。
- 该提交含 22 个路径（包括 HANDOFF 上一版），已把后端 Token/usage 收口从 5 个前端草稿中拆开；不要重复提交、也不要回退。

### 4.3 工作区前端未完成/已破坏契约的部分

`src/api.ts` 当前已经完成的部分（保留，不要回退）：

- `CloudflareSettings` / `CloudflareSettingsInput` 已改为 API Token 契约；
- `CloudflareUsage` 已有 `plan`、`limitSource`、`limits`；
- `ApiError` 已保留 HTTP `status`、`code`、`message`、`field`；
- `CloudflareOauthSettings`、`OauthSettings.cloudflare`、`OauthSettingsInput.cloudflare`、`CloudflareAuthResult`、`fetchCloudflareAuthResult()` 已删除；
- `CloudflareQuotas`、`PlatformSettings.cloudflareQuotas` 只作为迁移期兼容字段暂留，必须在本轮 UI 重写后删除。

前端消费方仍依赖旧契约的清单（当前构建失败原因）：

- `fetchCloudflareAuthResult()`（`useConsoleData.ts`）
- `usage.authorizationExpired`（`UsageStatusAlert.tsx`）
- `CloudflareOauthSettings` / `OauthSettings.cloudflare` / `OauthSettingsInput.cloudflare`（旧 Cloudflare OAuth 组件）
- `settings.cloudflareQuotas`（用量页、概览、维护设置）

`src/api.ts` 目标：

```ts
export interface CloudflareSettings {
  configured: boolean
  credentialKind: 'api_token' | 'legacy_oauth' | null
  accountIdConfigured: boolean
  accountId: string | null
  permissions: string[]
  updatedAt: string | null
  lastVerifiedAt: string | null
  legacyCredential: boolean
}

export interface CloudflareUsage {
  configured?: boolean
  cached?: boolean
  updatedAt?: string
  plan?: {
    id: string | null
    name: string | null
    free: boolean
    confirmed: boolean
  }
  limitSource?: 'cloudflare_subscriptions_free_baseline' | 'unavailable'
  limits?: CloudflareUsageLimits | null
  // 保留 requests/d1/kv/durableObjects/period/source 等 Analytics 字段
}
```

系统设置旧组件仍存在：

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

必须删除或重写为：

```text
CloudflareTokenForm
CloudflareTokenStatus
CloudflarePermissionList
useCloudflareTokenForm
CloudflarePanel
```

系统设置 Cloudflare 面板最终只保留：

- API Token 密码框；
- 可选 Account ID；
- 固定三项只读权限；
- Token 状态、最后校验时间、旧凭据提示；
- 创建 Token 链接 `https://dash.cloudflare.com/profile/api-tokens`；
- 当前 HTTP 错误码、消息和可操作说明；
- 保存、验证、撤销。

用量/维护 UI 仍读 `settings.cloudflareQuotas`：

```text
src/features/settings/useMaintenanceSettings.ts
src/features/settings/MaintenancePanel.tsx
src/features/settings/QuotaSettings.tsx
src/features/settings/QuotaForm.tsx
src/features/usage/CloudflareUsageSection.tsx
src/features/overview/UsageResourcesPanel.tsx
```

当前未提交路径的具体价值与风险：

- `src/api.ts`：Token/limits/错误码类型已经对齐后端，是本轮有效基础；仍需删除迁移期 `CloudflareQuotas` 兼容字段并补齐消费方。
- `UsageResourcesPanel.tsx`：新增 KV 删除/列举图标与行，平台请求改为“不限”；但仍读 `settings.cloudflareQuotas`，且仍保留两个 `/usage` 跳转入口。
- `PlatformUsageSection.tsx`：平台请求改为“不限”；其他平台资源仍读手填 `quotas`，Cloudflare 部分尚未接 `usage.limits`。
- `src/locales/en.ts`、`src/locales/zh-CN.ts`：已有“不限”和新增 KV 文案；仍含 `authorizationExpired`、`refresh_token` 等旧 OAuth 文案。
- `tests/console-worker.spec.ts`：已有部分 8 项额度字段；仍 mock `/api/settings/cloudflare/auth-result`、旧 OAuth 客户端协议字段和 `cloudflareQuotas`。
- `tests/console-real-stack.spec.ts`：未修改，仍会 PUT `cloudflareQuotas`，与后端新 400 契约冲突。

因此必须按第 5.1、5.2、5.3 节重写所有旧消费方，而不是整组提交；`HANDOFF.md` 本身只记录状态，不参与功能验收。

### 4.4 业务残留搜索基线

当前搜索仍命中旧契约的文件（2026-10-23 03:48，`rg` 共 52 行；其中 allowlist 见下文）：

```text
worker/src/index.ts                 # 仅保留拒绝 cloudflareQuotas 的 400 分支，预期可保留
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
src/features/settings/CloudflareAuthorizeSection.tsx
src/features/settings/CloudflareClientSection.tsx
src/features/settings/CloudflareClientFields.tsx
src/features/settings/useCloudflareClientForm.ts
src/features/settings/useCloudflareAuthorization.ts
src/features/settings/cloudflare-auth.ts
src/app/useConsoleData.ts
README.md
docs/local-e2e.md
docs/acceptance-matrix.md
方案.md
```

搜索命令：

```bash
rg -n "cloudflareQuotas|authorizationExpired|offline_access|workers-platform\.read|response_type|grant_type|PKCE|cloudflare_oauth|auth-result|/auth/cloudflare|Setup is not available|auth_error=" \
  worker/src worker/runtime worker/*.smoke.ts src tests README.md docs scripts package.json vitest.workers.config.ts
```

允许保留的只有历史 migration、明确的“已停用/已删除”文档说明，以及后端拒绝 `cloudflareQuotas` 的防御性 400 分支；不能有可执行旧逻辑或用户可见旧配置。

历史 migration `worker/migrations/0002_cloudflare_oauth.sql` 保留，不改写已发布 migration；运行时已不再使用该 state 表。

## 5. 分阶段执行清单

### 5.1 前端 Token 化（下一步最优先）

1. 完成 `src/api.ts` 迁移：
   - ✅ `CloudflareSettings` 已改为 Token 契约；
   - ✅ 已删除 `CloudflareOauthSettings`、`OauthSettings.cloudflare`、`OauthSettingsInput.cloudflare`；
   - ✅ 已删除 `CloudflareAuthResult`、`fetchCloudflareAuthResult()`；
   - ✅ 已删除 `authorizationExpired`；
   - ✅ usage 已增加 `plan/limitSource/limits`；
   - ⬜ 在 UI 消费方迁移完成后删除 `CloudflareQuotas`、`PlatformSettings.cloudflareQuotas`，不要靠恢复它们让构建变绿。
2. 重写 `CloudflarePanel`：
   - Token 密码框 + 可选 Account ID；
   - 固定权限只读清单；
   - 创建 Token 链接；
   - Token 状态和最后校验时间；
   - 保存/验证/撤销；
   - HTTP 错误码和消息留在面板。
3. 删除旧组件和 hooks：
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
4. 清理 `OauthSettings` 页面和 API 代码中 Cloudflare 分支；`/api/settings/oauth` 只处理 GitHub。
5. 清理所有 `authorizationExpired`、`refresh_token`、`response_type`、`grant_type`、PKCE、Client ID/Secret、回调地址和 scope 文案。
6. 错误组件必须展示 status/code/message，刷新和重试不得跳页。

完成标准：

```text
rg 旧字段/旧文案 无用户可见残留
npm run build PASS
npm run ui:conventions PASS
npm run ui:css-audit PASS
```

### 5.2 用量/设置 UI 清理

- 删除手填 Cloudflare 额度：
  - `useMaintenanceSettings.ts`
  - `MaintenancePanel.tsx`
  - `QuotaSettings.tsx`
  - `QuotaForm.tsx`
  - `CloudflareUsageSection.tsx`
  - `UsageResourcesPanel.tsx`
- `CloudflareUsageSection` 只使用 `usage.limits`。
- 未配置时显示未连接；未确认 Free 显示“未读取”；不要展示固定上限。
- 8 项均显示已用次数、上限和百分比，必须包含 D1 行写入。
- 平台请求只显示次数和不设上限，不画上限百分比。
- 只留一个清晰刷新按钮；自动加载期间刷新按钮不禁用。
- 清理概览和用量页重复 `/usage` 跳转、重复卡片、空信息卡和异常文案。
- 检查图标对齐、“默认工作区”高度遮挡、双主题和多视口截图。

完成标准：

```text
npm run build PASS
npm run ui:smoke PASS
涉及像素变化时更新并复核截图基线
```

### 5.3 测试与文档同步

- `tests/console-worker.spec.ts` 全部改为 Token mock 和真实 HTTP 错误 fixture。
- `tests/console-real-stack.spec.ts` 删除手填配额流程，改为维护/R2 阈值和其他可本地验证流程；不得再 PUT `cloudflareQuotas`。
- 中英文 locale 删除旧 OAuth 文案，新增 Token、固定权限、Free 未确认和 HTTP 错误文案。
- 同步更新：
  ```text
  src/content/help.zh-CN.md
  src/content/help.en.md
  native-server/README.md
  README.md
  docs/acceptance-matrix.md
  docs/local-e2e.md
  方案.md
  ```

### 5.4 部署和 D1

- `worker/migrations/0008_workspaces.sql` 已存在，不改写已发布 migration。
- `scripts/deploy-worker.sh` 当前顺序已实现为先应用全部 D1 migrations、校验 `d1 migrations list` 无遗留，再发布 Worker；`deploy-worker.test.sh` 覆盖 fresh/existing/cloud/prebuilt/drift 路径。
- 必须到 Cloudflare Workers Builds 控制台确认 Deploy command 实际为 `npm run deploy`，不能只依赖 README。
- 验证 migrations 后，生产接口不再出现 `D1_ERROR: no such table: workspaces`。
- 涉及 Worker 运行时/Cloudflare 时运行：
  ```bash
  npm run worker:runtime-test
  npm run deploy:worker:test
  ```

### 5.5 手动原生构建

新增仅 `workflow_dispatch` 的 workflow（建议 `.github/workflows/build-plugin-server.yml`）：

- 输入：可执行程序 / 共享库。
- 输入：目标平台 Linux、Windows、macOS；明确 x64/arm64 支持范围。
- 输入：Release/Debug，可选插件服务器版本号或 artifact 前缀。
- 不与 tag release 冲突。
- 工作流只在手动触发时运行一个目标矩阵，不做无意义全平台构建。

`native-server/CMakeLists.txt`：

- 增加 `PLUGMESH_BUILD_SERVER`、`PLUGMESH_BUILD_CORE_SHARED` 等明确开关。
- `plugmesh_core` 现在是 STATIC，必须新增真正共享库 target，不能只改扩展名。
- Windows 处理 OpenSSL DLL/applocal；macOS/Linux 处理 OpenSSL 查找和 RPATH/部署边界。
- 共享库必须暴露稳定的 C ABI 和公共头文件，并确保构建产物可被外部宿主链接。

产物要求：

- 可执行文件：`plugmesh-server`、运行依赖、README、SHA256。
- 共享库：库文件、公共头文件、OpenSSL/运行时依赖说明、README、SHA256。
- 工作流上传 artifact，并生成可复核的 `SHA256SUMS`。
- 产物命名避免 `linux-latest` 等漂移标签，包含 OS/架构/构建类型。

### 5.6 帮助中心

至少覆盖：

- 从哪里下载可执行文件/库文件，如何下载 SHA256SUMS。
- 如何校验 SHA256。
- `plugmesh-server --register ...` 的完整命令。
- `PLUGMESH_PLUGIN_DIRECTORY`、`PLUGMESH_PLUGIN_HOST` 等环境变量。
- 启动、绑定服务器、加载插件、健康检查。
- 库文件如何链接/嵌入宿主，公共头文件和 ABI 版本。
- 可执行文件与库文件的部署边界。
- 所需头文件、库文件、OpenSSL 运行库。
- 常见错误：动态库找不到、ABI 不匹配、OpenSSL 版本、权限、注册码过期。
- 删除旧 Cloudflare OAuth FAQ。

## 6. 当前测试证据与复现命令

### 6.1 2026-10-23 03:35 后端提交 `9882c76` 实测

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

宿主 GLIBC 2.31 低于 `@cloudflare/workerd-linux-64` 要求，runtime 必须使用 `node:22-bookworm` Docker；不要因宿主 workerd 的 GLIBC 报错误判代码失败。

完整 runtime 日志可能出现 workerd 的预期 warning/uncaught 日志（如 forced domain update failure、disconnected pipe），只要退出码为 0 且 20/20、89/89 通过，不代表测试失败。若退出码非 0 才按失败处理。

定向命令：

```bash
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$PWD:/workspace" -w /workspace node:22-bookworm \
  npx vitest run --config vitest.workers.config.ts \
  worker/runtime/cloudflare-token.test.ts \
  worker/runtime/cloudflare-settings.test.ts \
  worker/runtime/analytics.test.ts
```

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

### 6.1.1 2026-10-23 03:54 当前前端构建实测

```text
npm run worker:typecheck    PASS
git diff --check            PASS
npm run build               FAIL
```

`npm run build` 的阻塞错误必须逐项通过 Token/用量 UI 迁移解决，禁止恢复旧导出或把 `cloudflareQuotas` 改成必填来掩盖：

```text
src/app/useConsoleData.ts
  TS2305: Module '../api' has no exported member 'fetchCloudflareAuthResult'
  TS7006: auth-result 回调参数 result 隐式 any（随旧 auth-result 轮询一起删除）
src/features/settings/CloudflareAuthorizeSection.tsx
src/features/settings/CloudflareClientFields.tsx
src/features/settings/CloudflareClientSection.tsx
src/features/settings/useCloudflareClientForm.ts
  TS2339/TS2345: OauthSettings.cloudflare / OauthSettingsInput.cloudflare 已删除
src/features/settings/CloudflareProtocolFields.tsx
  TS2724: CloudflareOauthSettings 已删除
src/features/settings/useMaintenanceSettings.ts
  TS18048: settings.cloudflareQuotas 可能为 undefined
src/features/usage/UsageStatusAlert.tsx
  TS2339: CloudflareUsage.authorizationExpired 已删除
```

这意味着当前工作区 **不能提交为功能完成，更不能 push 触发 Actions**；先按第 5.1、5.2、5.3 节完成迁移，并让 `npm run build` 变绿。

涉及 native/CMake 时：

```bash
cmake -S native-server -B native-server/build -DCMAKE_BUILD_TYPE=Release
cmake --build native-server/build --parallel
ctest --test-dir native-server/build --output-on-failure
```

### 6.2 本轮未验证项

- `npm run build`：本轮已跑，**FAIL**；错误见 6.1.1，完成 Token 化后才可重新验收。
- `npm run ui:conventions`、`npm run ui:css-audit`：本轮未跑。
- `npm run ui:smoke`：本轮未跑；旧 UI 测试预期会在前端改造时重写。
- `npm run ci:local`：本轮未跑；最终提交前必须跑。
- 真实 Cloudflare API、Workers Builds、生产 D1、真实 GitHub OAuth、公网 SMTP：本轮未联调。

### 6.3 推送闭环

- 推送前至少 `git diff --check`；涉及运行时必须跑完整 runtime 和 smoke。
- 提交信息按逻辑拆分，中文、可追溯。
- 推送后必须查询 workflow 到 `completed`；不能只看“已 push”。
- 失败时读取失败 step、日志和失败产物；修复后重新本地验证、提交、推送、查 Actions。
- 未认证 API 下载日志可能 403；使用 `gh run view --log-failed` 或带认证 API，不要把 403 当代码失败。
- 改动 `.github/workflows/platform-ci.yml` 会触发 native 路径过滤，必须验证三平台 job，而不是只盯 web。
- 如果 UI smoke 失败，先下载 `playwright-report` artifact，并检查 `/tmp/plugmesh-playwright`、`/tmp/plugmesh-playwright-report`，不要只看超时名称。

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
- [ ] 用量页只有一个刷新入口；自动加载时刷新按钮不禁用；概览无同目的重复按钮；异常文案/空卡片已清理。
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
- 不要批量回滚当前工作区：后端已提交；剩余前端草稿包含 8 项额度展示和平台请求“不限”的有效意图，但仍含旧 OAuth/手填额度残留，必须按 Token 契约重写。
- 官方免费基线可能随 Cloudflare 政策变化；UI 应标注来源和核对日期，不能声称实时计费。
- `worker/migrations/0002_cloudflare_oauth.sql` 是历史 migration，不应删除或改写；只删除运行时逻辑。
- `usage_cache` 旧结构必须 miss；不能为了减少一次请求而信任缺少 `plan/limitSource/limits` 的缓存。
- Actions 轮询不要过密；未认证 GitHub API 限额有限，403 不等于代码失败。

## 9. 最近动作日志

- 2026-10-23 03:54：从当前工作区再次核验并更新 HANDOFF。确认 HEAD 为 `4d43b32`、`origin/main` 为 `579eb1f`、领先 3 个未推送提交、工作区仍有 6 个功能草稿；重新执行 `npm run build` 后仍 FAIL，逐项确认 `fetchCloudflareAuthResult`、旧 OAuth 组件/hooks、`cloudflareQuotas` 和 `authorizationExpired` 是唯一阻塞组，未发现新的独立错误类别。本次只修改 `HANDOFF.md`，不混入功能草稿，也不因构建失败而 push。
- 2026-10-23 03:51：把本 HANDOFF 整理作为独立文档提交落地，显式只 stage `HANDOFF.md`，不混入 `src/api.ts`、UI/locale/test 草稿；提交后工作区应剩 6 个未提交功能草稿。因前端 Token 化未完成且 `npm run build` FAIL，本分支暂不 push，避免触发失败 Actions。
- 2026-10-23 03:48：从会话历史重新核对用户全部反馈、当前 Git 与 Actions，确认 `1dbec9c` 为本地 HEAD、`origin/main` 为 `579eb1f`、本地领先 2 个未推送提交、工作区有 7 个未提交路径；新建的 `src/api.ts` Token 契约已落地但消费方未迁移，实测 `npm run build` FAIL、`npm run worker:typecheck` PASS、`git diff --check` PASS。本文件补充当前构建错误、未提交路径、U02/U03/U04/U07/U11/U12/U15/U17/U19/U20/U24 状态和禁止 push 条件。
- 2026-10-23 03:45：重新读取工作区、Git 提交和 GitHub Actions，确认本地 HEAD 为 `9882c76`、`origin/main` 为 `579eb1f`、本地领先 1 个未推送提交；远端最新 #52 成功。工作区只剩 5 个前端草稿（旧契约与有效展示意图混合）。重写本文件第 0、1 节并校正 U02/U03/U15/U24、4.2、4.3 和本日志，恢复时以本文件为第一事实源。
- 2026-10-23 03:40：从 26 个未提交路径中拆出 21 个已验证后端 Token/usage 文件，准备与 HANDOFF 一起做中文提交；保留 5 个前端草稿不动。再次实测 `worker:typecheck`、完整 Worker runtime 20/20 89/89、`worker:cloudflare-usage-smoke`、`worker:oauth-settings-smoke` 和 `git diff --check` 全部通过。
- 2026-10-23 03:32：把 HANDOFF 基线校正到已推送 HEAD `c84ceb0` 和 Actions run `39839503567`（#51）；该文档提交后基线为 `579eb1f`、run `39840532476`（#52）成功。
- 2026-10-23 03:22：重新核对工作区和 GitHub，HEAD/`origin/main` 为 `c84ceb0`；该文档提交的 Actions run `39839503567`（#51）最终 `completed/success`。最近一次后端实测 Worker typecheck、完整 runtime 20/20 89/89、两个 Cloudflare smoke 全绿，确认后端 Token/usage 契约已落地，前端仍为旧 OAuth/手填额度契约。
- 2026-10-23 03:20：完整 Worker runtime 在 `node:22-bookworm` 中通过，20/20 文件、89/89 用例；日志中的 workerd warning/uncaught 均未改变成功退出码。
- 2026-10-23：`worker:cloudflare-usage-smoke` 与 `worker:oauth-settings-smoke` 均通过；后端 smoke 已切换到 Token + subscriptions + 8 项 Free limits 契约。
- 2026-10-23 03:09：HANDOFF 基线刷新提交 `a9c85f0` 的 Actions run `39836893476`（#49）为 `completed/success`；当时 22 个代码路径未提交。
- 2026-10-23 03:03：`worker:typecheck` 曾因 27 个旧 `cloudflareQuotas` 类型错误失败，完整 runtime 为 82/84；这些阻塞已在本轮后端修复后消除。
- 2026-10-23 02:52：开始删除 Cloudflare OAuth 授权/回调/auth-result 路由、OAuth 配置与环境变量、refresh/revoke 桩、state 清理、旧 smoke 和旧测试；保留并验证 Token 设置/用量 API。
- 2026-10-23：核对 subscriptions 响应：`{ result: Subscription[], errors, messages }`，含 `rate_plan.id`、`rate_plan.public_name`、`state`；只有实际 `rate_plan.id === "free"` 才能确认 Free。
- 2026-10-23：核对 API Token 权限文档，确认 Account Settings Read、Account Analytics Read、Billing Read 真实存在。
- 2026-10-23：历史失败 `fd80fa4` #11、`1e4fd10` #12 继续保留为警示，不能从记录中删除。
