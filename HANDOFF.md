# Plugmesh 平台交接（HANDOFF）

> 最后更新：2026-10-23（Asia/Shanghai）
> 状态：**进行中，未完成**
> 维护规则：每完成一个可验证步骤，先更新本文件，再提交一条可追溯的中文 Git 记录；未记录不得继续下一步。
> 本文件是后续上下文的优先事实来源。若 README、验收矩阵或旧注释与本文冲突，以用户最新要求和实际代码为准；旧文档需要在实现完成后同步重写，不能把旧 OAuth 行为当成现状。

## 最近动作

- 2026-10-23：核对分支、远端、未提交组件化文件和最近 Actions；建立本 HANDOFF。此步只整理事实与实施计划，未开始 Cloudflare Token / 原生构建实现。

## 0. 先读这里：工作区与 Git 状态

- 仓库：`/home/tc/work/plugin-platform`
- 当前分支：`main`
- 编写本文件时的 HEAD / `origin/main`：`12e7aae refactor(usage): 用量页拆成状态提示、额度分组、数据源与分布部件`
- fetch remote：`https://github.com/shelter-red/plugin-platform.git`
- push remote：`git@github-plugin-platform:shelter-red/plugin-platform.git`
- 2026-10-23 通过 GitHub API 查询时，`12e7aae` 的“平台验收”已成功；用户指出的 `1e4fd10`、`fd80fa4` 是更早的失败提交。**不要因此认为后续改动不会让 Actions 失败。**
- 当前环境没有安装 `gh`。可先用 GitHub API 查询 run；需要看日志时再安装/配置 GitHub CLI，或使用已认证的 GitHub API。
- **工作区有上一轮组件化改动，严禁 `git reset --hard`、`git clean -fd`、`git checkout -- .` 或覆盖这些文件。** 修改前先看 `git status` 和 `git diff`。

当前未提交改动：

```text
M src/app/Sidebar.tsx
M src/app/palette.ts
M src/features/account/AccountPage.tsx
M src/features/overview/UsageResourcesPanel.tsx
M src/features/usage/PlatformUsageSection.tsx
M src/features/workspaces/WorkspaceDangerPanel.tsx
M src/features/workspaces/WorkspaceSwitcherPanel.tsx
M src/locales/en.ts
M src/locales/zh-CN.ts
M tests/console-worker.spec.ts

?? src/app/SidebarBrand.tsx
?? src/app/SidebarFooter.tsx
?? src/app/SidebarNavigation.tsx
?? src/app/SidebarWorkspaceSwitcher.tsx
?? src/app/sidebar-nav.ts
?? src/features/account/AccountIdentityCard.tsx
?? src/features/account/AccountLinksCard.tsx
?? src/features/account/AccountLogoutButton.tsx
?? src/features/account/AccountWorkspacesCard.tsx
?? src/features/account/account.ts
?? src/features/workspaces/WorkspaceCreateForm.tsx
?? src/features/workspaces/WorkspaceDangerActions.tsx
?? src/features/workspaces/WorkspaceList.tsx
?? src/features/workspaces/WorkspaceRenameForm.tsx
?? src/features/workspaces/useWorkspaceDangerActions.ts
```

建议先审阅、跑测试并把这一批组件化改动提交，再开始 Cloudflare 大改；不要把它们和 Token 迁移混成一个无法审查的巨型提交。

## 1. 用户最新要求（验收口径）

### 1.1 Cloudflare 必须从短效 OAuth 迁移为长期 API Token

- Cloudflare API Token 默认不过期；创建时若显式设置 TTL 才会过期。界面不要再暗示“和 GitHub OAuth 一样会自然过期”。
- 系统设置只录入：
  - Cloudflare API Token（密码框，保存后不回显）
  - Account ID（可选；账号不唯一时必须填写）
- “创建 Token”链接改为：`https://dash.cloudflare.com/profile/api-tokens`
- 删除整个 Cloudflare OAuth 客户端配置流程，不再要求用户创建 OAuth Client：
  - 不出现 Client ID / Client Secret
  - 不出现回调地址
  - 不出现 `response_type` / `grant_type` / token endpoint auth method / PKCE
  - 不出现可编辑 scope、`offline_access`、`workers-platform.read`
- 权限必须固定、只读展示，不能勾选/取消，不能让用户自行猜测：
  - `Account Settings Read`
  - `Account Analytics Read`
  - `Billing Read`
- 不再创建 OAuth 授权链接；不再有 `/auth/cloudflare/start` 回调授权流程。
- 保存 Token 前服务端必须校验，不能只加密落库：
  1. `GET https://api.cloudflare.com/client/v4/user/tokens/verify` 验证 Token。
  2. `GET https://api.cloudflare.com/client/v4/accounts?per_page=...` 发现/校验 Account ID。
  3. `GET https://api.cloudflare.com/client/v4/accounts/{account_id}/subscriptions` 验证 `Billing Read` 并读取套餐。
  4. 全部成功后加密保存 Token、Account ID、验证时间和可用的 token metadata。
- 错误必须是真实 HTTP 状态并把错误留在系统设置页，不允许：
  - `302 /?auth_error=...`
  - 跳回首页
  - 用 Cookie 传 Cloudflare 授权结果
  - 在授权不可用/未配置时返回特殊文案 “Setup is not available”
- 建议稳定错误映射：
  - Token 无效：HTTP 401，`token_invalid`
  - Token 缺少固定权限：HTTP 403，`token_permission_denied`
  - Token 可见账号不唯一且未填 Account ID，或指定账号不可见：HTTP 409，`account_missing` / `account_ambiguous`
  - `SESSION_SECRET` 缺失：HTTP 503，`secret_missing`
- 删除配置只删除本地密文和 `usage_cache`，不要调用 OAuth revoke；Token 由用户自行到 Cloudflare 后台撤销。
- 旧 OAuth 密文要兼容读取以便识别，但必须在 UI 标成“旧版 OAuth 凭据，请重新录入 API Token”，不能静默当成有效 Token。

### 1.2 Cloudflare 免费额度只能从 Cloudflare 读取

- 用户不能在系统设置手填 Cloudflare 免费额度。
- 从 `GET /accounts/{account_id}/subscriptions` 读取套餐；**只有明确确认是免费计划时**，才显示官方免费基线。
- 无法读取订阅、无法确认套餐或权限不足时显示“未读取”，不能把静态常量伪装成账号实时返回值。
- 当前官方免费基线（2026-10 核对，显示时注明“官方免费基线，已确认 Free 套餐”）：
  - Worker 请求：100,000 / 日
  - D1 行读：5,000,000 / 日
  - D1 行写：100,000 / 日
  - KV 读：100,000 / 日
  - KV 写：1,000 / 日
  - KV 删除：1,000 / 日
  - KV 列表：1,000 / 日
  - Durable Object 请求：100,000 / 日
- 所有有上限的项目必须同时显示“已用次数”和“百分比”，尤其不能漏掉 D1 行写入。总计 8 项。
- 平台自己的统计和 Cloudflare 官方额度必须分组展示：
  - 平台请求只统计，不设上限，也不画上限百分比。
  - 平台本地统计不依赖 Cloudflare Token。
- 未配置 Cloudflare 时，`GET /api/usage/cloudflare` 必须直接返回：

```json
{"configured":false,"cached":false}
```

同时满足：
  - 不先读缓存
  - 不请求 Cloudflare 外部 API
  - 不凭旧缓存显示“已查到”
  - `/api/usage/local?range=7d` 仍可返回 200 和本地统计

- 配置了 Token 后的缓存顺序必须是：先读并解密凭据，再读 `usage_cache`；不能在未配置时命中缓存。
- 用量响应建议包含只读字段：

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

- 前端只能使用响应里的 `limits`，不能继续读 `settings.cloudflareQuotas`。

### 1.3 setup、错误状态和路由语义

- `setupApi` 返回 `null` 时，请求继续走普通非路由处理；不要单独返回 “Setup is not available”，也不要为 setup 发明不同于其他非路由路径的行为。
- GitHub 登录错误已经改为 HTTP 错误页；Cloudflare Token 迁移后不存在授权回调，设置保存错误必须使用 HTTP status + JSON，由当前设置面板展示。
- 任何“重新授权”“授权已过期”的文案都要清理，改成 Token 无效/权限不足/检查配置。

### 1.4 组件化和界面质量

- 所有页面继续组件化。不要因为“登录页还是旧的”就无脑重写：当前登录页已经拆分：
  - `src/features/auth/LoginPage.tsx`
  - `AuthFrame.tsx`
  - `AuthBrand.tsx`
  - `AuthLoadingScreen.tsx`
  - `GithubMark.tsx`
  - 下一步是实际视觉检查和修正，而不是重复拆一遍。
- 侧栏已拆为 `SidebarBrand`、`SidebarWorkspaceSwitcher`、`SidebarNavigation`、`SidebarFooter`、`sidebar-nav.ts`；保留并完成测试。
- 清理“像压缩上下文后生成”的异常文案：重复说明、技术黑话、前后矛盾、无信息量卡片。
- 清理同一页面重复功能：
  - 用量页目前“刷新用量”至少出现在 `PageHeader`、`UsageStatusAlert`、`UsageSourcesPanel`；只保留一个主刷新入口，避免三个按钮做同一件事。
  - 概览 `UsageResourcesPanel` 右上角详情按钮和底部“查看全部配额”都跳 `/usage`；删除同一卡片内重复出口。
  - 检查 MetricCard、快速开始等是否存在同页多个按钮跳同一页面。
- “默认工作区”切换器不能过矮遮挡文字；统一检查图标尺寸、按钮高度、gap、文字行高和垂直居中。
- 至少在双主题 × 桌面/平板/手机视口下实际检查登录、总览、用量、设置、工作区、账号页。

### 1.5 生产 D1 `workspaces` 表缺失

- migration `worker/migrations/0008_workspaces.sql` 已存在；曾排查到生产环境直接用了 `wrangler versions upload`，绕过 `npm run deploy` 的 migrations。
- 远端缺失表当年已人工补齐，但这不能代替流程修复。
- 必须确保 Cloudflare Workers Builds 的 Deploy command 是 `npm run deploy`（或等价地先执行 `wrangler d1 migrations apply DB --remote` 再发布）。
- 保留并验证部署脚本的 migration 遗留检查：有 pending migration 时必须让构建失败，不能上线缺表版本。
- 验证 0008 及全部 migration 后，生产接口不再出现 `D1_ERROR: no such table: workspaces`。

### 1.6 GitHub Actions 手动构建插件服务器

- 新增一个 **仅手动触发** 的 workflow（建议 `.github/workflows/build-plugin-server.yml`，`on: workflow_dispatch`）。不要和 tag 发布 workflow 混淆。
- 输入至少包括：
  - 产物类型：可执行程序 / 库文件
  - 目标平台：Linux、Windows、macOS；需要明确 x64/arm64 中哪些 runner 实际支持
- 可执行程序产物继续包含 `plugmesh-server`、运行依赖和 README。
- 库文件产物需要真正构建动态/共享库，而不是把现有 STATIC `plugmesh_core` 改个文件名：
  - 在 `native-server/CMakeLists.txt` 增加明确开关，例如 `PLUGMESH_BUILD_SERVER`、`PLUGMESH_BUILD_CORE_SHARED`
  - 输出共享库 `plugmesh_core`
  - 打包公共头文件、库文件、OpenSSL/运行时依赖说明、README 和校验和
- Windows 要处理 OpenSSL DLL/applocal；macOS/Linux 要处理 OpenSSL 查找和 RPATH/部署边界。
- 工作流要上传 artifact，并生成 SHA256；可选产物名要和用户选择一致。
- 当前 `release.yml` 是 tag/workflow_dispatch 发可执行文件；新增手动 workflow 后避免与 release 重复发布同一 tag。

### 1.7 帮助中心补二进制服务器/库服务器用法

必须同时更新中英文，并让内容按用户操作路径写，不能只列技术栈：

- `src/content/help.zh-CN.md`
- `src/content/help.en.md`
- `native-server/README.md` / 根 README 视情况同步

至少覆盖：
- 从哪里下载可执行程序和校验和
- 如何校验 SHA256
- 如何运行 `plugmesh-server --register ...`
- 如何配置 `PLUGMESH_PLUGIN_DIRECTORY`、`PLUGMESH_PLUGIN_HOST`
- 如何启动、绑定服务器、加载插件
- 库文件如何被宿主程序链接/嵌入
- 需要哪些头文件、库文件和 OpenSSL 运行库
- 可执行文件与库文件两种部署边界和常见错误

## 2. 当前实现状态（不要重复劳动）

### 已完成/已提交

- 总览、列表、工作区、Cloudflare 设置、用量页做过一轮组件拆分。
- 平台统计与 Cloudflare 免费额度在 UI 上已尝试分组。
- 侧栏工作区切换曾修复遮挡和图标对齐，但当前仍有未提交的进一步拆分，需要完成验证。
- GitHub 登录错误已使用 HTTP 错误页，不再使用 `?auth_error=`。
- `setupApi` 当前返回 `null` 后会继续普通请求处理。
- `scripts/deploy-worker.sh` 已包含构建、D1/R2 准备、migrations apply、pending migration 检查和发布。
- `platform-ci.yml` 已固定 Playwright 镜像并上传 UI 失败产物。

### 尚未完成

- Cloudflare 后端仍是 OAuth exchange/refresh/revoke，仍会请求不存在/不合适的 OAuth scope。
- Cloudflare 设置页仍要求 OAuth Client ID/Secret、回调地址、协议字段和 scope。
- `cloudflareQuotas` 仍存在 PlatformSettings、编辑表单、测试和本地统计 UI 中。
- Cloudflare 未配置时 `cloudflareUsageApi` 仍可能先读缓存。
- `auth-result` Cookie 和前端读取逻辑仍在。
- 文档 `README.md`、`docs/acceptance-matrix.md`、`docs/local-e2e.md` 仍描述旧 OAuth 和手填免费额度，实施时必须同步改，不能保留互相矛盾的说明。
- 手动原生构建 workflow 尚未新增。
- 帮助中心仍只有旧 Cloudflare OAuth FAQ，没有二进制服务器/库服务器说明。

## 3. 代码修改地图

### Worker / 数据模型

- `worker/src/cloudflare-oauth.ts`
  - 当前是 OAuth exchange/refresh/revoke。
  - 建议替换为 `cloudflare-token.ts` 或同等模块：verify、accounts、subscriptions、credential 类型、稳定错误类型。
- `worker/src/index.ts`
  - 删除 `/auth/cloudflare/start`、`/auth/cloudflare/callback` 的导入和路由。
  - 删除 `/api/settings/cloudflare/auth-result`。
  - 删除 `startCloudflareAuth`、`finishCloudflareAuth`、`redirectWithCloudflareAuthResult`。
  - 重写 `cloudflareSettingsApi`：PUT 必须先验证 Token/账号/订阅，DELETE 不 revoke。
  - 重写 `cloudflareUsageApi`：先凭据，后缓存；未配置立即返回 `{configured:false,cached:false}`。
  - `platformSettingsApi` 删除 `cloudflareQuotas` 入参和输出。
- `worker/src/types.ts`
  - 从 `PlatformSettings` 删除 `cloudflareQuotas`。
  - 删除 `CloudflareQuotas` 的平台设置含义，改成 usage 响应中的只读 `limits`。
  - 删除 `CLOUDFLARE_OAUTH_*` env。
- `worker/src/usage.ts`
  - 删除 `defaultCloudflareQuotas` 作为持久化设置来源和 platform settings 字段。
  - 保留 `cloudflareQuotaReason` 逻辑，但调用方传入运行时读取到的官方 `limits`。
  - 官方基线可作为“已确认 Free 套餐后的 fallback 常量”，不能作为用户可编辑设置。
- `worker/src/oauth-settings.ts`
  - 仅保留 GitHub OAuth；所有 Cloudflare OAuth 协议/scope 输出删除。
- `worker/src/cloudflare-auth-result.ts`
  - 整体删除。
- `worker/src/scheduled.ts` / 相关清理
  - 搜索并处理 `cloudflare_oauth_states` 等旧表清理逻辑；迁移可保留历史表，但不再产生新 state。
- `worker/migrations/0008_workspaces.sql`
  - 不改写已发布 migration；保证部署流程应用它。
- `scripts/deploy-worker.sh`
  - 继续作为唯一部署入口；检查 Workers Builds Deploy command 文档和测试。

### 前端

- `src/api.ts`
  - 删除 `CloudflareOauthSettings`、`CloudflareAuthResult`、`fetchCloudflareAuthResult`。
  - `OauthSettings` / `OauthSettingsInput` 只剩 GitHub。
  - `PlatformSettings` 删除 `cloudflareQuotas`。
  - `CloudflareUsage` 增加 `plan`、`limitSource`、只读 `limits`；删除 `authorizationExpired`。
- `src/app/useConsoleData.ts`
  - 删除 Cloudflare auth-result Cookie useEffect 和 diagnosis 状态；保留 GitHub 登录态路径。
- `src/features/settings/`
  - 删除/重写这些旧 OAuth 文件：
    - `CloudflareAuthorizeSection.tsx`
    - `CloudflareAccountCard.tsx`
    - `CloudflareClientSection.tsx`
    - `CloudflareClientFields.tsx`
    - `CloudflareProtocolFields.tsx`
    - `CloudflareScopeList.tsx`
    - `CloudflareAuthDiagnostics.tsx`
    - `useCloudflareAuthorization.ts`
    - `useCloudflareClientForm.ts`
    - `cloudflare-auth.ts`
  - 新组件建议：`CloudflareTokenForm`、`CloudflareTokenStatus`、`CloudflarePermissionList`、`useCloudflareTokenForm`。
  - `CloudflarePanel` 只保留 Token 表单、固定权限、校验状态和当前面板错误。
  - `MaintenancePanel` / `QuotaSettings` / `useMaintenanceSettings` 只编辑平台阈值（连接、R2 bytes、R2 objects）；免费额度改成只读或移出设置页。
- `src/features/usage/`
  - `CloudflareUsageSection` 和 `UsageResourcesPanel` 从 usage 响应读 `limits`，不读 settings。
  - `UsageStatusAlert` 删除“授权过期/重新授权”；只保留 Token 无效、权限不足、账号缺失、配置入口。
  - 用量页只保留一个刷新入口。
- `src/locales/zh-CN.ts` / `en.ts`
  - 同步 Token、固定权限、配额来源、错误文案。
  - 用户明确说现有若干文案诡异；通读修改，不保留重复解释和错位卡片。
- `src/content/help.*.md`
  - 加二进制服务器/库服务器指南，删除旧 Cloudflare OAuth FAQ。

### GitHub Actions / 原生

- 现有：
  - `.github/workflows/platform-ci.yml`：web + native tests，native 只按路径触发。
  - `.github/workflows/release.yml`：tag/release，构建可执行程序。
- 新增手动 workflow；必要时调整 `native-server/CMakeLists.txt` 的 target/options。
- 不要破坏现有 `native-ui:smoke`、ctest 和 release。

## 4. 必须补/改的测试

- `worker/runtime/cloudflare-settings.test.ts`
  - stub token verify、accounts、subscriptions
  - 401 invalid token、403 permission denied、409 account missing/ambiguous、503 secret missing
  - 密文不含明文 Token，GET 不回显 Token
  - 删除只删本地，不调用外部 revoke
- `worker/runtime/cloudflare-oauth.test.ts`
  - 删除 OAuth 回调测试；若保留文件名则改成 Token 测试，或迁移为 `cloudflare-token.test.ts` 并更新 vitest 配置
- `worker/runtime/analytics.test.ts`
  - 不 PUT `cloudflareQuotas`
  - 未配置不得访问外部 API，不得读缓存伪装成已配置
  - 缓存检查发生在凭据检查之后
  - 订阅返回非 Free 时 `limits=null`
  - Free 确认后返回 8 项官方基线
- `worker/runtime/outbound-stub.ts`
  - 删除 OAuth token/revoke stub，新增 verify、accounts、subscriptions stub
- `worker/cloudflare-usage.smoke.ts`
  - 覆盖 8 项额度和百分比来源
- `worker/cloudflare-oauth*.smoke.ts`
  - 删除或改造成 Token/设置 smoke
- `worker/oauth-settings.smoke.ts`
  - 只验证 GitHub，不再输出 Cloudflare 协议字段
- `tests/console-worker.spec.ts`
  - Token 表单、固定权限、错误留在设置页、不出现 PKCE/response_type/offline_access
  - 用量页刷新入口去重
- `tests/console-real-stack.spec.ts`
  - 删除 `cloudflareQuotas` PUT/恢复断言，改成验证平台阈值与只读官方额度
- 新增 workflow 测试或至少 workflow lint/手动 dispatch 验证。

清理搜索必须最终无命中（或只剩解释性历史迁移代码）：

```bash
rg -n "offline_access|workers-platform\.read|response_type|grant_type|PKCE|cloudflareQuotas|auth_error|Setup is not available" worker/src src tests README.md docs
```

## 5. 推荐实施顺序

1. **保护现有工作区改动**：审阅并提交当前组件拆分；先跑一次 `npm run ui:conventions && npm run ui:css-audit && npm run build`。
2. **后端 Token 迁移**：新 Cloudflare Token 客户端 + 设置/用量 API + 类型 + 迁移旧密文兼容。
3. **后端测试**：先让 runtime tests 和 smoke 通过，确保未配置时不发外部请求。
4. **前端 Token 表单**：删除 OAuth UI/Cookie/诊断，把错误放回当前设置面板。
5. **额度只读化**：删除 `cloudflareQuotas`，用量响应带 limits，UI 显示 8 项次数/百分比。
6. **UI 品质清理**：登录页、侧栏、用量刷新去重、概览重复跳转、异常文案、双主题/多视口。
7. **部署链路**：确认 Workers Builds Deploy command 是 `npm run deploy`；验证 migrations 无 pending；复查 `no such table`。
8. **原生手动构建**：CMake 可执行/库开关 + 手动 workflow + artifact/checksum。
9. **帮助文档**：中英文二进制服务器/库服务器教程；同步 README、验收矩阵、local-e2e。
10. **完整验收、提交、推送、盯 Actions**。

## 6. 本地验收与推送流程

推送前必须执行完整本地 CI：

```bash
npm run ci:local
```

涉及 Worker 运行时或 Cloudflare 时还必须：

```bash
npm run worker:runtime-test
npm run deploy:worker:test
```

涉及 native/CMake 时还必须：

```bash
cmake -S native-server -B native-server/build -DCMAKE_BUILD_TYPE=Release
cmake --build native-server/build --parallel
ctest --test-dir native-server/build --output-on-failure
```

推送要求：
- 不要把未验证的代码直接推 `main`。
- 提交信息按逻辑拆分，例如：
  1. `refactor(ui): 完成登录、侧栏、账号与工作区组件化`
  2. `feat(cloudflare): 迁移到 API Token 并移除 OAuth 配置`
  3. `feat(usage): 从 Cloudflare 订阅读取免费额度并展示百分比`
  4. `ci(native): 增加可执行文件与库文件手动构建`
  5. `docs(help): 补充二进制插件服务器与库文件部署说明`
- 推送后不能只看“已 push”：必须查 workflow 到完成；失败就拉日志继续修。
- 当前无 `gh` 时，可用：

```bash
curl -fsSL 'https://api.github.com/repos/shelter-red/plugin-platform/actions/runs?per_page=10'
```

需要完整日志时安装/配置 `gh`，或使用带认证的 GitHub API。

## 7. 最终验收清单

- [ ] 登录页实际视觉检查通过，组件结构保留且没有旧页面残留。
- [ ] 侧栏“默认工作区”文字不遮挡，图标/文字对齐。
- [ ] 系统设置只出现 Cloudflare API Token 和可选 Account ID，不出现任何 OAuth 客户端字段。
- [ ] 权限固定为 Account Settings Read / Account Analytics Read / Billing Read，只读不可取消。
- [ ] “创建 Token”跳到 `https://dash.cloudflare.com/profile/api-tokens`。
- [ ] Token 保存前 verify、账号发现、subscriptions 校验全部完成；失败用 HTTP 状态并在当前面板显示。
- [ ] 不再出现 `auth_error`、`offline_access`、`workers-platform.read`、PKCE、`response_type`、`grant_type` 等旧内容。
- [ ] setup 返回 null 时与其他非路由行为一致，没有 “Setup is not available”。
- [ ] 未配置 Cloudflare 时 `/api/usage/cloudflare` 返回 `{"configured":false,"cached":false}`，无外部请求，无旧缓存命中；`/api/usage/local` 仍 200。
- [ ] Cloudflare 免费额度从 subscriptions 读取，只有确认 Free 才显示官方基线；不可确认显示未读取。
- [ ] Worker、D1 行读/行写、KV 读/写/删/列表、DO 请求共 8 项均显示次数和百分比。
- [ ] 平台统计与 Cloudflare 额度分组；平台请求不设上限。
- [ ] 设置页无手填 Cloudflare 免费额度。
- [ ] 用量页只有一个刷新入口；概览无同目的重复按钮；异常文案/空卡片已清理。
- [ ] 生产部署应用 0008 及全部 migrations，`workspaces` 表存在，`npm run deploy` 是 Workers Builds 实际部署入口。
- [ ] 手动 Actions 可选可执行程序/库文件、目标平台，并上传 artifact + SHA256。
- [ ] 帮助中心中英文都有二进制插件服务器与库文件插件的完整使用说明。
- [ ] `npm run ci:local`、Worker runtime tests、deploy test、native ctest 全部通过。
- [ ] 推送后 Actions 完成且成功；失败已定位、修复并重新验证。

## 8. 已知风险与边界

- Cloudflare API Token 长期有效不等于永久有效：用户可撤销、Token 可被策略阻止、账号权限可变，因此运行时要稳定处理 401/403；但不要把它描述成 OAuth 自然过期。
- `Billing Read` 是否可用于当前账号订阅端点要以实际 Cloudflare 响应为准；400/401/403 必须区分，不能统一报“授权过期”。
- 免费基线是官方公布值，可能随 Cloudflare 政策变化；只有在订阅明确为 Free 时展示，最好在 UI 标注核对日期和数据来源。
- 账号发现与多账号场景要避免猜测：无法唯一确定且用户未填 Account ID 时返回 409，不要随便选第一个账号。
- 迁移旧 OAuth 密文只能用于识别和提示重新录入，不能继续 refresh/revoke。
- 旧的 `cloudflare_oauth_states`、usage cache、环境变量和 README 可能残留；实现后逐项搜索清理。
- 不要为了“组件化”把所有东西拆成无意义小组件；组件边界应能独立命名、测试和理解。
