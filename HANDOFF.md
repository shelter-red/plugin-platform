# Plugmesh 平台交接（HANDOFF）

> 最后整理：2026-10-23（Asia/Shanghai）
>
> 当前状态：**Cloudflare API Token 前端/后端与 8 项用量迁移已提交；完整本地 CI（含 86/86 UI smoke）已通过；基线 `c0bfde3` 已推送，Actions run `39850719037`（#53）completed/success。旧文档/文案已完成盘点但尚未修改；视觉验收、原生二进制/共享库手动构建和帮助中心仍是后续工作。任何之后的 docs-only HANDOFF 提交都要单独核对最新 Actions。**
>
> 本文件是上下文压缩后的第一事实源。README、旧方案、旧测试、聊天摘要或历史提交说明与本文冲突时，以用户最新要求、当前代码和本文为准。恢复后先执行第 0 节的核验命令，再按第 8 节顺序继续。

## 0. 压缩恢复卡（先看这里）

### 0.1 仓库、分支与提交

```text
仓库：/home/tc/work/plugin-platform
分支：main
最近已验证远端基线：c0bfde3 docs: 记录完整本地 CI 结果
origin/main（本次 HANDOFF 更新前）：c0bfde3
本地关系（本次 HANDOFF 更新前）：与 origin/main 相同；本次 docs-only 提交后会 ahead 1
fetch remote：https://github.com/shelter-red/plugin-platform.git
push remote：git@github-plugin-platform:shelter-red/plugin-platform.git
```

本次推送包含的本地提交（已到远端）：

```text
c0bfde3 docs: 记录完整本地 CI 结果
87e88dd docs: 校订交接恢复基线
d1c9f3d docs: 补齐旧文档清理交接清单
a02871a docs: 更新 Token 与用量验收交接基线
850928e feat(console): 完成 Cloudflare Token 与八项用量迁移
653beac docs: 校正交接台账实时恢复基线
45efad3 docs: 固化完整上下文交接台账
649ed66 docs: 重建压缩恢复交接台账
609ba8f docs: 校正 HANDOFF 当前构建阻塞与恢复基线
4d43b32 docs: 固化压缩恢复交接台账
1dbec9c docs: 重整 HANDOFF 恢复基线与未完成事项
9882c76 fix(worker): 收口 Cloudflare API Token 与只读额度契约
```

- 上述基线已 push；`c0bfde3` 对应 Actions run `39850719037`（#53），`completed/success`。
- 本次 HANDOFF 更新若产生新的 docs-only 提交，必须追踪该提交自己的最新 run，不能拿 #53 代替。
- 此前最新成功为 `579eb1f`，run `39840532476`（#52）。
- 仓库内未发现 `AGENTS.md`，无额外仓库级代理指令。
- `850928e` 已提交 35 个前端/测试路径；`a02871a` 只更新 HANDOFF。当前工作区在本次盘点前干净；本 HANDOFF 更新会单独形成 docs-only 提交。
- 恢复时始终以实际 `git log -1`、`git status` 和 `git rev-parse HEAD origin/main` 为准。

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

### 0.2 当前工作区

`850928e` 已收口此前 35 个脏路径（21 个修改、10 个删除、4 个新增）；`a02871a` 只更新 HANDOFF。本文件更新前代码工作区干净；不要把历史脏路径清单当成当前状态。

本次已提交的核心文件：

```text
src/api.ts
src/errors.ts
src/app/ConsoleShell.tsx
src/app/useConsoleData.ts
src/features/settings/CloudflarePanel.tsx
src/features/settings/CloudflarePermissionList.tsx
src/features/settings/CloudflareTokenForm.tsx
src/features/settings/CloudflareTokenStatus.tsx
src/features/settings/useCloudflareTokenForm.ts
src/features/settings/useSettingsSections.ts
src/features/settings/MaintenancePanel.tsx
src/features/settings/QuotaSettings.tsx
src/features/settings/useMaintenanceSettings.ts
src/features/usage/CloudflareUsageSection.tsx
src/features/usage/PlatformUsageSection.tsx
src/features/usage/UsagePage.tsx
src/features/usage/UsageSourcesPanel.tsx
src/features/usage/UsageStatusAlert.tsx
src/features/overview/UsageResourcesPanel.tsx
src/locales/zh-CN.ts
src/locales/en.ts
tests/console-worker.spec.ts
tests/console-real-stack.spec.ts
```

旧 Cloudflare OAuth 前端组件和 hook 已删除。禁止 `git reset --hard`、`git clean`、批量 checkout、`git add .`；后续提交仍须逐文件显式 stage，中文提交信息。

### 0.3 当前验证状态

2026-10-23 在 `850928e` 提交前实测（`a02871a` 仅文档变更，不改变这些代码证据）：

```text
git diff --check                                      PASS
npm run build                                         PASS
npm run ui:smoke                                      86 passed（约 1.5 分钟）
设置导航滚动联动 --repeat-each=3                       3 passed
Cloudflare/用量定向 worker-mock 回归                 8 passed
```

设置导航曾出现 2/3 偶发失败：滚到底的 shell 已高亮最后一项，但随后 `IntersectionObserver` 用旧可见集合覆盖。`850928e` 通过 `atBottom` 引用让滚到底兜底拥有最终决定权；未放宽或删除断言。

尚未完成/不能宣称通过：

```text
npm run ci:local             PASS（2026-10-23，含 86/86 UI smoke）
npm run deploy:worker:test   本轮前端提交后未重跑
worker runtime Docker        最近修改后未重跑
原生 CMake / ctest           新共享库与 workflow 尚未实现
真实 Cloudflare API          未联调
真实 GitHub OAuth            未联调
Workers Builds 控制台配置     未核对
```

### 0.4 恢复后的第一动作

1. 执行 0.1 的 Git 核验，不凭记忆判断 HEAD 或工作区。
2. 阅读第 1、2 节，确认用户硬约束，尤其不要恢复任何 Cloudflare OAuth 字段。
3. 从第 8.2 节继续：先清理旧文档/文案，再做视觉验收，最后实现原生手动构建与帮助中心。
4. 每次压缩恢复后都更新本文件，不把“计划”写成“已完成”。

## 1. 用户硬约束与最终产品决策

### 1.1 Cloudflare 最终只用长期 API Token

- 彻底废弃 Cloudflare OAuth 运行时：路由、回调、state、Cookie、refresh、revoke、auth-result、OAuth 客户端配置与 refresh_token 语义全部不得保留。
- 创建入口固定为：

```text
https://dash.cloudflare.com/profile/api-tokens
```

- 用户创建 Token 时固定只读权限，界面只展示，用户不能勾选、取消、增删或编辑：

```text
Account Settings Read
Account Analytics Read
Billing Read
```

- 最终用户可见界面和活跃逻辑不得出现：

```text
offline_access
workers-platform.read
PKCE
response_type
grant_type
Cloudflare Client ID / Client Secret
Cloudflare callback URL
可编辑 scope
```

- 用户曾要求把 `response_type` 改到 OAuth 配置页；之后决定彻底改用 API Token。因此最终方案不是“移动 response_type”，而是让 Cloudflare OAuth 参数整体消失。若历史资料必须回顾，只能明确标注“已废弃”，不得出现在当前配置流程。
- Cloudflare API Token 可能被撤销、权限被修改，或用户自行设置过期时间；运行时仍须处理 401/403，但文案必须是“Token 无效或权限不足”，不能写“OAuth 授权已过期”或“refresh_token 不可用”。
- 不保存明文 Token；GET 设置接口永远不能回显 Token。旧 OAuth 密文只识别为 `legacy_oauth` 并提示重新录入，不刷新、不查询、不撤销。

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
- GitHub OAuth 的失败页继续使用真实 HTTP 错误页；这部分与 Cloudflare Token 无关。

### 1.3 Cloudflare 未配置、用量与免费额度

- 未配置 Cloudflare 时：

```json
{"configured":false,"cached":false}
```

- 此时不读旧缓存、不向 Cloudflare 发外部请求。
- `GET /api/usage/local?range=7d` 独立返回 200；平台本地统计不依赖 Cloudflare。
- Cloudflare 免费额度不能手填，只能从 subscriptions 读取。
- 只有响应中 `rate_plan.id === "free"` 且确认后才展示官方基线；空结果、缺字段或结构不符都显示“未读取”。
- 只有确认 Free 时才展示以下 8 项每日额度：

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

- 每项必须同时显示已用次数、上限和百分比，包括 D1 行写入、KV 删除、KV 列举。
- 平台统计与 Cloudflare 监控必须分组：
  - 平台请求只统计次数，不设上限，不画百分比；
  - Cloudflare 8 项才显示官方额度与百分比。
- 系统设置不能手填 Cloudflare 免费额度。维护/配额页只保留平台自身可拒绝的 3 项阈值：`activeConnections`、`r2Bytes`、`r2Objects`。

### 1.4 UI 收口

- 用量页只保留一个刷新入口；`PageHeader` 的 `data-testid="usage-refresh"` 是唯一按钮。
- 自动加载期间刷新按钮不能禁用，否则用户/测试点击会被静默吞掉。
- 概览不能同时保留右上箭头和底部“查看全部额度”这两个同目的入口。
- 清理重复按钮、重复卡片、空卡片、技术黑话和异常文案。
- 同一页不要出现多个按钮跳向同一个页面。
- 检查图标/文字对齐，以及左上角“默认工作区”高度是否遮挡文字。
- 登录页必须实际截图确认是新组件视觉，不能只看文件存在。
- `ui:smoke` 通过不能替代人工视觉检查；仍需看桌面、窄屏、双主题下的截图。

### 1.5 Git、部署与 Actions

- 生产部署必须确保 Workers Builds 实际执行 `npm run deploy`。
- `scripts/deploy-worker.sh` 已先应用全部 D1 migrations、检查 pending，再发布；仍须在 Workers Builds 控制台确认 Deploy command。
- 本地完整 CI 通过前禁止 push。
- push 后必须追最新 Actions 到 `completed`；失败时读失败 step、日志和 `playwright-report` artifact。
- 未认证 GitHub REST 限额约 60 次/小时；Actions 轮询间隔至少约 1 分钟，不能高频制造 403。
- 提交按逻辑拆分，中文提交信息，显式 stage 文件。
- 不得用删测试、放宽断言、恢复旧类型、造假 mock 的方式制造绿色。

### 1.6 原生插件服务器手动构建

- 用户要求 Actions 增加仅手动运行的构建入口：选择“可执行程序”或“库文件”、目标平台、构建类型；可选架构/版本前缀。
- 当前 `native-server/CMakeLists.txt` 的 `plugmesh_core` 是 `STATIC`。不能只改文件扩展名伪装共享库，必须增加真正的 `SHARED` target、稳定 C ABI 和公共头文件，并设置构建开关。
- 产物必须包含：真正构建出的产物、依赖说明、README、`SHA256SUMS`。
- Windows 必须处理 OpenSSL DLL/applocal；Linux/macOS 必须处理 OpenSSL、RPATH/依赖边界。
- 帮助中心中英文必须说明可执行文件和共享库两种用法。

## 2. 用户问题总账（U01–U24）

状态：✅已完成并有验证；🟡实现主线完成但测试/文档/视觉未全部闭环；⬜未完成。

| ID | 用户反馈/目标 | 必须达到的效果 | 当前状态 |
| --- | --- | --- | --- |
| U01 | “不是说全部重构成组件吗？登录页还是旧的” | 清晰组件边界；登录页实际视觉验收 | 🟡 登录页/侧栏/账号/工作区已拆；最终截图验收未完成 |
| U02 | “自己从会话历史里读 Git 分支，自行提交推送” | 每步有中文 Git 记录；不靠聊天猜 | 🟡 `main` 领先 10+ 个未推送提交；本地完整 CI 与 Actions 闭环仍未完成 |
| U03 | “推送时注意 Actions，老是错误” | 本地完整 CI + push 后追踪到成功 | ✅ 本地 `npm run ci:local` 通过；`c0bfde3` #53 completed/success |
| U04 | 为什么错误状态靠 `/?auth_error=` | 真实 HTTP + JSON，留在当前页 | 🟡 Cloudflare 跳转/auth-result 链路已删；GitHub 失败页已是 HTTP；仍需统一测试与旧文案清理 |
| U05 | setup 失效为什么单独返回 `Setup is not available` | 返回 null 后走普通非路由行为 | ✅ 已实现并有测试 |
| U06 | `D1_ERROR: no such table: workspaces` | 先应用全部 migrations 再部署 | 🟡 deploy 脚本已实现并测试；Workers Builds 控制台配置待核对 |
| U07 | `invalid_scope` / `workers-platform.read` | 删除错误 OAuth scope，改 API Token，固定真实权限 | 🟡 后端完成；前端 Token 组件已落地；测试/文档待闭合 |
| U08 | 授权失败为什么跳首页 | 错误留系统设置页，显示 HTTP/status/code/message | 🟡 新 Token 表单已保留 HTTP 错误并在 `/settings` 显示；完整回归未补 |
| U09 | 用户不知道 OAuth 给什么权限，取消后权限就没了 | 权限固定只读；创建 Token 直达链接 | 🟡 三项权限组件与链接已实现；仍缺完整交互测试和旧文档清理 |
| U10 | “未识别唯一账号”也是权限问题 | verify → accounts 全分页 → subscriptions，不猜账号 | ✅ 后端和 runtime 测试覆盖 |
| U11 | 用量/配额为什么没刷新按钮 | 一个清晰刷新入口，自动加载期间不禁用 | 🟡 `PageHeader` 唯一刷新入口和独立 `usageRefreshing` 已实现；专项测试未补 |
| U12 | OAuth 根本没有 offline_access | 删除 offline_access/refresh/过期语义 | 🟡 后端/API/新 UI 已删；旧文档与少量旧文案仍待清 |
| U13 | 未配置为何还能查 `/api/usage/local?range=7d` 且返回 200 | 区分 Cloudflare 与本地统计；未配置不读缓存/不发请求 | ✅ 路由与测试已覆盖 |
| U14 | response_type 放错位置；CF OAuth 没有 PKCE | 最终 Token 方案中这些字段全部消失 | 🟡 新组件无这些字段；旧文档仍大量保留 |
| U15 | `1e4fd10`、`fd80fa4` Actions 失败 | 失败修复、本地 CI、push、Actions、产物闭环 | 🟡 最新远端成功；本地改动未 push |
| U16 | 图标没对齐；“默认工作区”很矮挡字 | 统一高度/gap/行高/居中；双主题多视口检查 | 🟡 已有高度修复；本轮新增 UI 未做最终截图验收 |
| U17 | 额度少，D1 写入等都要监控且显示百分比 | 8 项 used/limit/percentage | 🟡 前后端代码已实现 8 项；专项 UI 回归测试未补 |
| U18 | 平台和监控分开；平台请求不限 | 平台只统计；Cloudflare 官方额度独立 | 🟡 分组和“不限”已实现；最终视觉与测试未闭环 |
| U19 | GitHub OAuth 没过期，CF 为什么过期；改 Token | 不再暗示 OAuth 过期；界面/链接/错误全部 Token 化 | 🟡 后端/API/新面板已 Token 化；README/docs/help/deploy 提示仍有旧 OAuth 文案 |
| U20 | CF 免费额度为何在系统设置手填，应从 CF 读取 | 删除手填；读 subscriptions；未确认 Free 显示未读取 | 🟡 维护/用量 UI 已改；文档仍是旧流程 |
| U21 | 文案诡异、莫名卡片、同页多个按钮跳同页 | 中英文审计；清重复说明/空卡片/重复跳转 | ⬜ 未完成 |
| U22 | Actions 手动构建插件服务器：可执行/库、目标平台 | 仅 `workflow_dispatch`；真正共享库 + artifact + SHA256 | ⬜ 未开始 |
| U23 | 帮助中心说明二进制/库文件服务器怎么用 | 中英文完整使用说明 | ⬜ 未开始 |
| U24 | 都整理到磁盘 HANDOFF，避免压缩后忘 | 所有要求、事实、阻塞、步骤、验收可恢复 | ✅ 本次重写 |

## 3. 当前实现清单

### 3.1 已提交后端（`9882c76`，不得回退）

- 删除旧 Cloudflare OAuth 主链路：
  - `/auth/cloudflare/start`
  - `/auth/cloudflare/callback`
  - `/api/settings/cloudflare/auth-result`
  - auth-result Cookie
  - start/finish/redirect 函数
  - scheduled 中 `cloudflare_oauth_states` 清理
- 删除旧后端文件（历史记录，未跟踪）：
  - `worker/src/cloudflare-oauth.ts`
  - `worker/src/cloudflare-auth-result.ts`
  - `worker/runtime/cloudflare-oauth.test.ts`
  - `worker/cloudflare-oauth.smoke.ts`
  - `worker/cloudflare-oauth-route.smoke.ts`
- `/api/settings/oauth` 仅保留 GitHub OAuth；请求体含 `cloudflare` 返回 400。
- `/api/settings/cloudflare` 已切 API Token：
  - GET 返回 `configured`、`credentialKind`、脱敏 `accountId`、固定 `permissions`、`updatedAt`、`lastVerifiedAt`、`legacyCredential`；
  - PUT 接收 `{apiToken, accountId?}`；
  - 保存顺序为 verify → accounts 全分页 → 唯一账号/指定账号校验 → subscriptions → 加密保存；
  - DELETE 只删平台保存的 Token 和 usage cache，不调用 Cloudflare 撤销。
- `/api/usage/cloudflare` 已先检查凭据再读缓存；未配置立即短路。
- `worker/src/cloudflare-token.ts` 提供官方 Free 8 项基线，只有 `plan.confirmed && plan.free` 才返回 limits。
- `worker/src/types.ts`、`worker/src/usage.ts` 已删除手填 `cloudflareQuotas`。
- `platformSettingsApi` 对提交 `cloudflareQuotas` 返回 HTTP 400 `cloudflare_quotas_read_only`。
- 后端测试桩已改为 Token verify/accounts/subscriptions，不再 mock Cloudflare OAuth token/revoke。

### 3.2 已提交前端（`850928e`）

- 旧 Cloudflare OAuth 前端 10 个文件已删除。
- 新增：
  - `CloudflarePermissionList.tsx`：固定三项权限、只读、不提供 input/button；
  - `CloudflareTokenForm.tsx`：Token、可选 Account ID、保存/验证/撤销、创建 Token 链接；
  - `CloudflareTokenStatus.tsx`：脱敏账号、最后验证时间、旧凭据提示；
  - `useCloudflareTokenForm.ts`：HTTP 错误保留 status/code/message。
- `CloudflarePanel.tsx` 已组合 Token 表单、权限清单和状态。
- `SettingsPage.tsx` / `ConsoleShell.tsx` / `useConsoleData.ts` 已删除 Cloudflare OAuth 诊断和 auth-result 轮询。
- `CloudflareUsageSection.tsx` 已只读 `usage.limits`、`usage.limitSource`、`usage.plan`，显示 8 项指标。
- `UsageResourcesPanel.tsx` 已按平台/Cloudflare 分组，并读取 `usage.limits`。
- `PlatformUsageSection.tsx` 平台请求显示为“不限”。
- `QuotaSettings.tsx` / `useMaintenanceSettings.ts` 只保留平台 3 项阈值。
- `UsagePage.tsx` 页面头只保留 `data-testid="usage-refresh"` 一个刷新入口。
- `useConsoleData.ts` 已把自动加载 `usageLoading` 和手动刷新 `usageRefreshing` 分开，刷新按钮不会因自动加载而禁用。
- `UsageStatusAlert.tsx` 已处理 `legacyCredential`、usage error、账号缺失和未配置状态。
- `tests/console-worker.spec.ts` 已有 Cloudflare Token 403 当前页错误断言；`tests/console-real-stack.spec.ts` 已移除手填 Cloudflare 配额主流程。

### 3.3 代码已完成但测试仍未补齐

`tests/console-worker.spec.ts` 当前只有 mock 字段 `usageRequests`，还缺以下用量回归：

1. 自动加载期间 `usage-refresh` 可用，点击会真正再次请求 `/api/usage/cloudflare` 和 `/api/usage/local`。
2. 用量页只有一个刷新入口。
3. Cloudflare 8 项均显示已用次数、上限、百分比。
4. 未配置时官方 Workers 显示 `—`，但平台本地计数仍显示。
5. `legacyCredential` 在当前用量页显示，不跳转首页。
6. 401/403 错误在当前用量页显示 HTTP 状态/错误信息。

测试 mock 建议：

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
}
```

另需修正 `tests/console-worker.spec.ts` 窄屏测试中的旧注释：

```text
当前旧注释：用量页的两组额度卡与设置页的 11 个阈值输入
应改为：平台 3 项阈值输入
```

### 3.4 文档/文案仍大面积过期

重点搜索：

```bash
rg -n "offline_access|workers-platform\\.read|OAuth|oauth|response_type|PKCE|Cloudflare Client|Cloudflare callback|cloudflareQuotas|authorizationExpired|Setup is not available|auth_error" README.md 方案.md docs src/content src worker/src worker/runtime worker/*.smoke.ts
```

必须修改：

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
scripts/deploy-worker.sh 的部署完成提示
worker/src/setup.ts 的初始化说明文案
```

当前过期示例：

- README 仍写 Cloudflare OAuth、两项权限、refresh/offline、手填免费额度。
- `docs/local-e2e.md` 仍要求修改 `cloudflareQuotas.d1RowsRead` 并保存配额。
- `方案.md` 仍写 OAuth 协议参数、PKCE、response_type、CloudflareAuthorizeSection/ClientSection。
- `docs/acceptance-matrix.md` 仍描述旧 Cloudflare OAuth 回调和手填额度。
- `scripts/deploy-worker.sh` 最后仍提示“在管理后台配置 Cloudflare OAuth、SMTP、配额”。
- `worker/src/setup.ts` 仍写“Cloudflare OAuth 与 SMTP 等配置”。
- help 内容仍需要 Cloudflare Token 说明及原生服务器教程。
- privacy 可改为“GitHub OAuth + Cloudflare API Token”，不要泛称 OAuth clients。

### 3.5 允许保留的 OAuth 内容（不要误删）

- GitHub OAuth 是现有登录方式，必须保留：
  - `worker/src/oauth-settings.ts` 中 GitHub 部分；
  - `/auth/github/*`；
  - `oauth_states` 表及其清理；
  - GitHub Client ID/Secret、回调、scope 相关文档。
- `worker/migrations/0002_cloudflare_oauth.sql` 是历史 migration，不删除、不改写。
- `legacy_oauth` 是识别旧 Cloudflare 密文的兼容标记，允许保留；但不得恢复读取/刷新/撤销逻辑。
- 搜索到 “OAuth” 不代表全部删除；必须区分 GitHub 与已废弃的 Cloudflare OAuth。

### 3.6 原生插件服务器现状

当前 `.github/workflows/release.yml`：

- 支持 tag push + `workflow_dispatch`；
- 只构建可执行程序；
- 三平台 matrix；
- 没有“可执行/共享库”选择。

需要新增仅 `workflow_dispatch` 的 workflow，例如 `.github/workflows/build-plugin-server.yml`，输入至少：

- 产物类型：可执行程序 / 共享库；
- 目标平台：Linux / Windows / macOS；
- Debug / Release；
- 架构：x64，按条件支持 arm64；
- 可选 artifact 前缀/版本。

产物必须包含真正构建出的产物、依赖说明、README、`SHA256SUMS`。文件名必须包含 OS/架构/构建类型，避免“latest”漂移。

`native-server/CMakeLists.txt` 中 `plugmesh_core` 当前是 `STATIC`。不能只改扩展名；必须增加真正 `SHARED` target、稳定 C ABI 和公共头文件，并设置构建开关，例如：

```text
PLUGMESH_BUILD_SERVER
PLUGMESH_BUILD_CORE_SHARED
```

Windows 需处理 OpenSSL DLL/applocal；Linux/macOS 需处理 OpenSSL/RPATH/依赖边界。

### 3.7 帮助中心二进制/库教程要求

中英文至少覆盖：

- 下载可执行文件/共享库和 `SHA256SUMS`；
- 校验 SHA256；
- `plugmesh-server --register ...` 完整命令；
- `PLUGMESH_PLUGIN_DIRECTORY`、`PLUGMESH_PLUGIN_HOST` 等环境变量；
- 启动、绑定服务器、加载插件、健康检查；
- 共享库如何链接/嵌入宿主、公共头文件与 ABI；
- OpenSSL/运行时依赖；
- 常见错误：动态库找不到、ABI 不匹配、OpenSSL 版本、权限、注册码过期；
- 删除旧 Cloudflare OAuth FAQ。

## 4. Cloudflare 接口与错误契约速查

### 4.1 设置目标契约

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

### 4.2 用量目标契约

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
- 未配置时同时返回 `configured:false`、`cached:false`，且不发外部请求。

## 5. 部署与 D1 事实

- 历史问题：`D1_ERROR: no such table: workspaces: SQLITE_ERROR`。
- `worker/migrations/0008_workspaces.sql` 已存在，不改写已发布 migration；后续 schema 变更只能新增 migration。
- `scripts/deploy-worker.sh` 当前流程：
  1. 构建管理端；
  2. 准备/复用 D1 和 R2；
  3. `wrangler d1 migrations apply DB --remote`；
  4. 检查 pending migration；
  5. 发布 Worker；
  6. 确保 `SESSION_SECRET` / `SETUP_TOKEN` 存在。
- 生产 Workers Builds 的 Deploy command 必须是 `npm run deploy`；仅执行 `wrangler deploy` 会绕过 migrations，禁止。
- 部署脚本末尾旧文案仍写着配置 Cloudflare OAuth，必须同步改为 API Token。
- 部署后仍需实际访问生产页面，确认 workspaces 表、设置页和用量页不再报 D1 缺表。

## 6. 验证证据与复现

### 6.1 当前前端

`850928e` 提交前实测：

```text
npm run build              PASS
git diff --check           PASS
```

最近一次已记录的有效证据：

```text
npm run ui:smoke           80 passed (1.3m)
npm run worker:typecheck   PASS
npm run worker:smoke       PASS
npm run ui:conventions     PASS，89 TSX / 0 违规
npm run ui:css-audit       PASS，476 规则 / 0 死代码
```

这些证据不能替代最终完整验收，因为当前工作区在证据之后仍有未提交变更，且用量专项测试尚未补齐。

### 6.2 Worker runtime（Docker）

宿主 GLIBC 2.31 低于 `@cloudflare/workerd-linux-64` 要求，runtime 必须使用 `node:22-bookworm` Docker；不要因宿主 workerd GLIBC 报错误判代码失败。

```bash
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$PWD:/workspace" -w /workspace node:22-bookworm \
  npx vitest run --config vitest.workers.config.ts
```

定向测试：

```bash
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$PWD:/workspace" -w /workspace node:22-bookworm \
  npx vitest run --config vitest.workers.config.ts \
  worker/runtime/cloudflare-token.test.ts \
  worker/runtime/cloudflare-settings.test.ts \
  worker/runtime/analytics.test.ts
```

历史最近一次后端证据（提交 `9882c76`）：

```text
npm run worker:typecheck                         PASS
full worker runtime                              20/20 files, 89/89 tests PASS
worker:cloudflare-usage-smoke                    PASS
worker:oauth-settings-smoke                      PASS
```

### 6.3 原生 CMake

涉及 native/CMake 修改后：

```bash
cmake -S native-server -B native-server/build -DCMAKE_BUILD_TYPE=Release
cmake --build native-server/build --parallel
ctest --test-dir native-server/build --output-on-failure
```

当前 `plugmesh_core` 是 STATIC，尚未有真正的核心 SHARED target 和稳定 C ABI。

### 6.4 尚未联调

- 真实 Cloudflare API / API Token / subscriptions / Analytics；
- 真实 GitHub OAuth App；
- 公网 SMTP；
- Workers Builds 生产部署；
- 生产 D1 migration；
- 多地域网络与 Cloudflare 免费额度真实响应。

## 7. 推送后 Actions 追踪方式

查询最新 main Actions：

```bash
curl -fsSL 'https://api.github.com/repos/shelter-red/plugin-platform/actions/runs?branch=main&per_page=8' |
  node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{for(const r of JSON.parse(s).workflow_runs)console.log(r.head_sha.slice(0,7),r.status,r.conclusion??'-',r.id,r.run_number,r.display_title)})"
```

规则：

1. 轮询间隔至少约 1 分钟，避免未认证 GitHub API 限额。
2. 追到最新 commit 的 `completed`，只有 `conclusion=success` 才算通过。
3. 失败先读失败 step 日志；UI smoke 失败下载 `playwright-report` artifact。
4. 检查 `/tmp/plugmesh-playwright`、`/tmp/plugmesh-playwright-report`，不要只看超时名称。
5. 修到本地全绿后再次 push，再从头追踪最新 Actions。

历史 Actions：

```text
579eb1f  run 39840532476  #52  success  （最新已知远端成功）
c84ceb0  run 39839503567  #51  success
92e3fcd  run 39837622904  #50  success
a9c85f0  run 39836893476  #49  success
7a54cfc  run 39835890828  #48  success
cc00faf  run 39834314392  #47  success
1a5e5c1  run 39833249358  #46  success
```

历史失败反例：

```text
fd80fa4  run 39754896119  #11  管理端 UI smoke 失败
1e4fd10  run 39756824624  #12  管理端 UI smoke + linux/windows/macos native 失败
```

已知教训：

- 改 workflow 会触发 native 路径过滤，必须验证三平台，不能只看 web。
- run `39777807648` 曾因通知浮层遮挡刷新按钮和测试超时误判失败；修复后 run `39788653143` 通过。刷新按钮、通知位置和多加载用例超时不能回归。
- Actions 轮询 403 不等于代码失败；先确认 API rate limit。

## 8. 严格按顺序执行的剩余任务

### 8.1 补用量回归测试并修旧注释（已完成，`850928e`）

已新增并通过 6 项用量回归：加载期间刷新可用、唯一刷新入口、8 项额度、未配置时官方为空、旧凭据留在用量页、401/403 保留 HTTP/错误码/消息。同步修正窄屏测试里的“11 个阈值输入”旧注释。定向 worker-mock 8/8、完整 UI smoke 86/86 通过。

### 8.2 清理旧文档与文案

状态：已完成全仓盘点，尚未修改。下一步按下列清单逐文件清理，不能误删 GitHub OAuth。

- `README.md`：第 28、144、165–174、233、235 行仍把运行期 Cloudflare 配置写成 OAuth、OAuth 客户端、两项权限、refresh/offline、手填额度与 OAuth runtime 用例。
- `方案.md`：第 13、44–45、55、57、188、190、197 行仍写 OAuth 客户端、协议参数、PKCE、回调 Cookie、`CloudflareOauthSettings`、`response_type`。
- `docs/acceptance-matrix.md`：第 19、30、32、34、68、73、97、142 行仍写 Cloudflare OAuth 回调/刷新/Cookie、OAuth 组件、手填额度、真实栈配置 OAuth 客户端。
- `docs/local-e2e.md`：第 91 行仍要求手填 `cloudflareQuotas.d1RowsRead`；第 355 行仍写 Cloudflare OAuth 未联调。
- `scripts/deploy-worker.sh`：第 242、245 行部署完成提示仍写后台配置 Cloudflare OAuth。
- `scripts/deploy-worker.test.sh`：仍断言旧部署提示和 README 旧内容；修改 README/脚本后必须同步。
- `worker/src/setup.ts`：第 130 行仍写“Cloudflare OAuth 与 SMTP 等配置”。
- `src/content/help.zh-CN.md` / `help.en.md`：仍有 Cloudflare 授权失败 FAQ，需改成 API Token 创建、固定权限、401/403 排障，并补原生服务器教程。
- `src/content/privacy.zh-CN.md` / `privacy.en.md`：泛称 OAuth clients + Cloudflare credentials，需明确 GitHub OAuth 与 Cloudflare API Token。
- `src/locales/zh-CN.ts`：第 25 行页面描述仍写 Cloudflare 授权；第 717–718 行旧 `cloudflareConnected` toast 需确认是否为死 key 后删除；英文同步。
- `src/api.ts` 第 274 行、`worker/src/index.ts` 第 1187 行注释仍写“Cloudflare 授权”，改成“凭据/API Token”。

清理后重新执行第 3.4 节搜索。保留 GitHub OAuth、`oauth_states`、历史 migration `0002_cloudflare_oauth.sql`、`legacy_oauth` 兼容标记；Cloudflare 活跃流程只允许长期 API Token。

### 8.3 视觉与文案验收

- 登录页实际截图，确认不是旧页面或旧组件。
- 检查设置页 Cloudflare Token 区块、固定权限、创建 Token 链接。
- 检查用量页唯一刷新按钮、平台/Cloudflare 分组、8 项百分比。
- 检查窄屏、双主题、图标/文字对齐、“默认工作区”高度。
- 通读中英文，删除重复按钮、空卡片、技术黑话和异常句子。

### 8.4 实现原生手动构建

新增 `.github/workflows/build-plugin-server.yml`，仅 `workflow_dispatch`，完善 `native-server/CMakeLists.txt` 的真正 SHARED target、公共头和构建开关，处理三平台依赖。通过 CMake/ctest 与至少一次 workflow 语法/构建验证。

### 8.5 补帮助中心及隐私文档

完成第 3.7 节中英文教程，更新 README、方案、验收矩阵、local-e2e、privacy、native-server/README。

### 8.6 部署配置核对

在 Cloudflare Workers Builds 控制台确认 Deploy command 为 `npm run deploy`，确认 0008 及全部迁移在生产执行；实际验证无 `no such table: workspaces`。

### 8.7 完整验收

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

Worker runtime 修改后执行第 6.2 节 Docker 命令；原生修改后执行第 6.3 节 CMake/ctest。

### 8.8 提交、push、Actions 闭环

1. 全部验收通过。
2. 按逻辑分组提交，显式 stage 文件，中文提交信息。
3. push 到 `main`。
4. 查询最新 Actions，间隔至少约 1 分钟，追到 `completed`。
5. 失败时读失败 step、日志和 `playwright-report` artifact；修复后重跑本地、再 push。
6. 只有最新 Actions 成功后才能宣称完成。

## 9. 最终验收清单

- [ ] 登录页实际视觉检查通过，结构为新组件且无旧页面残留。
- [ ] “默认工作区”文字不遮挡，图标/文字对齐。
- [x] 系统设置只出现 Cloudflare API Token 和可选 Account ID。
- [x] 活跃 Cloudflare 流程不出现 Client ID/Secret、回调、scope 编辑、PKCE、`response_type`、`grant_type`。
- [x] 固定权限为 Account Settings Read / Account Analytics Read / Billing Read，只读不可取消。
- [x] “创建 Token”跳到 `https://dash.cloudflare.com/profile/api-tokens`。
- [ ] Token 保存前完成 verify、账号发现、subscriptions 校验；失败用 HTTP 状态并在当前面板显示。
- [ ] 旧 Cloudflare OAuth 路由、Cookie、refresh/revoke、state、smoke 和用户文案全部删除。
- [x] setup 返回 null 时没有 “Setup is not available” 特例。
- [x] 未配置 `/api/usage/cloudflare` 返回 `{"configured":false,"cached":false}`，无外部请求、无旧缓存命中。
- [x] `/api/usage/local?range=7d` 仍返回 200。
- [ ] Cloudflare 免费额度只从 subscriptions 读取；只有确认 Free 才显示官方基线。
- [x] 8 项都显示次数和百分比，包含 D1 行写入、KV 删除、KV 列举。
- [x] 平台统计与 Cloudflare 额度分组；平台请求不设上限。
- [x] 设置页无手填 Cloudflare 免费额度，只剩平台 3 项阈值。
- [x] 用量页只有一个刷新入口；自动加载时刷新按钮不禁用且点击会再次请求。
- [x] 概览已移除与右上箭头重复的“查看全部额度”入口；其他页面文案/空卡片仍待视觉验收。
- [ ] 生产部署应用 0008 及全部 migrations，Workers Builds 实际入口为 `npm run deploy`。
- [ ] 手动 Actions 可选可执行程序/库文件、目标平台，并上传 artifact + SHA256。
- [ ] 帮助中心中英文都有二进制/共享库插件服务器完整说明。
- [ ] `npm run ci:local`、Worker runtime、deploy test、native ctest 全部通过。
- [ ] 推送后最新 Actions 完成且成功。

## 10. 已知风险与禁止事项

- 不能“把 OAuth 字段换个名字”继续保留 Cloudflare OAuth；必须从路由、Cookie、配置、刷新、撤销、文案到测试全部移除。
- 不能保存明文 Token；GET 设置接口永远不能回显 Token。
- 旧 OAuth 密文只能识别并提示重新录入，不能 refresh/revoke/查询。
- 不能因为 Billing Read 读取 subscriptions 出现权限问题就删掉固定权限；应核对官方文档和真实响应，准确映射 401/403/404/其他错误。
- 未确认 Free 时不能展示 8 项固定上限。
- 不能把平台请求套上 Cloudflare Worker 请求上限。
- 不能恢复 `/?auth_error=`、auth-result Cookie、跳首页或 “Setup is not available”。
- 不能用删断言、临时兼容旧字段、重引 OAuth 或造假 mock 的方式制造绿色。
- 不要为“组件化”拆无意义小组件；组件边界应可独立命名、测试和理解。
- 不要批量回滚当前工作区：后端已提交，草稿包含有效 Token/8 项额度意图，也含旧文档残留，必须按本文件收口。
- 官方免费基线可能随 Cloudflare 政策变化；UI 应标注来源和核对日期，不能声称实时计费。
- `worker/migrations/0002_cloudflare_oauth.sql` 是历史 migration，不删除、不改写；只删除运行时逻辑。
- Actions 轮询不要过密；403 不等于代码失败。
- 没有完整 CI 和最新 Actions success，不得说“已推送且完成”。

## 11. 最近动作日志

- 2026-10-23：提交 `45efad3` 单独固化了完整 HANDOFF；当前 HEAD 为 `45efad3`、`origin/main` 为 `579eb1f`、本地领先 6 个提交。
- 2026-10-23：提交 `45efad3` 后校正工作区为 33 个脏路径（19 修改 + 10 删除 + 4 新增）；`HANDOFF.md` 本身已干净提交，不再计入脏路径。
- 2026-10-23：确认旧 Cloudflare OAuth 前端文件已删除；Token 表单、固定三项只读权限、创建 Token 链接、旧凭据提示已落地。
- 2026-10-23：确认用量页读取 `usage.limits`，展示 8 项官方免费额度；平台请求显示“不限”；设置页仅保留平台 3 项阈值。
- 2026-10-23：确认 `PageHeader` 只有一个 `usage-refresh`，自动加载 `usageLoading` 与手动刷新 `usageRefreshing` 已分离。
- 2026-10-23：确认 Cloudflare Token 403 测试保留 HTTP 状态并在 `/settings` 显示；完整用量回归测试仍未补。
- 2026-10-23：确认 README、方案、验收矩阵、local-e2e、help、privacy、部署脚本提示仍有旧 Cloudflare OAuth/手填额度内容。
- 2026-10-23：确认 `native-server` 仅有 `plugmesh_core STATIC`；手动构建 workflow、真正核心 SHARED target、公共 ABI 和帮助中心教程仍未实现。
- 2026-10-23：后端 `9882c76` 完成 Cloudflare API Token 契约，完整 Worker runtime 20/20、89/89 通过，两个 Cloudflare smoke 通过。
- 2026-10-23：远端 #52 (`579eb1f`) 成功；本地 6 个提交尚未 push，不能声称其 Actions 已通过。
- 2026-10-23：确认 Cloudflare 最终只使用 API Token，固定三项权限，删除 `offline_access`、`workers-platform.read`、PKCE、`response_type`、`grant_type`、Client ID/Secret 和回调配置。
- 2026-10-23：确认免费额度只从 subscriptions 读取，只有 `rate_plan.id === "free"` 才展示 8 项官方基线。
- 2026-10-23：确认错误必须真实 HTTP + JSON，留在当前系统设置/用量页，不跳首页。
- 2026-10-23：确认 setup 失效走普通非路由行为，不返回 “Setup is not available”。
- 2026-10-23：提交 `850928e`（`feat(console): 完成 Cloudflare Token 与八项用量迁移`），显式 stage 35 个路径；前端 Token 表单、固定三项权限、8 项额度、HTTP 错误与设置导航竞态修复一并收口。
- 2026-10-23：`850928e` 提交前 `npm run build` PASS；`npm run ui:smoke` 86/86 PASS；设置导航 `--repeat-each=3` 3/3 PASS；`git diff --check` PASS。
- 2026-10-23：提交 `a02871a`（`docs: 更新 Token 与用量验收交接基线`），将实时基线推进到 HEAD `a02871a`、ahead 9。
- 2026-10-23：完成第 8.2 节全仓盘点：README、方案、验收矩阵、local-e2e、help、privacy、部署提示、setup 文案、locale 和两处注释仍有过期 Cloudflare OAuth/手填额度描述；本次仅记录，尚未修改。
- 2026-10-23：确认当前工作区干净；下一严格步骤是第 8.2 节文档/文案清理，之后做视觉验收与原生手动构建。
- 2026-10-23：提交 `d1c9f3d`（`docs: 补齐旧文档清理交接清单`），将下一个严格动作固定为 8.2；本 HANDOFF 再校订一次以避免把“整理前 HEAD”误当成实时 HEAD。
- 2026-10-23：在 HEAD `87e88dd` 实测 `npm run ci:local` 全绿：UI 约定、样式审计、Worker 类型检查、构建、全部 Worker smoke 与 86/86 UI smoke 通过；当前基线满足推送前 web CI 门槛。
- 2026-10-23：提交 `c0bfde3`（`docs: 记录完整本地 CI 结果`）并 push 到 `origin/main`；Actions run `39850719037`（#53）completed/success。
- 2026-10-23：HANDOFF 自身再做一次 docs-only 基线补记；恢复时先 `git fetch` 并核对本文件之后的 HEAD/Actions，不把 #53 误认为后续提交结果。
