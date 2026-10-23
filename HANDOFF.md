# Plugmesh 平台交接（HANDOFF）

> 最后整理：2026-10-23（Asia/Shanghai）
>
> 本次恢复记录：U29 的主站 Host 路由修复、回归测试和应急说明已在当前工作区完成；代码提交与最新 Actions 仍待本步验收闭环。在该闭环完成前不得进入 8.5。
>
> 本步本地验收已通过：`npm run worker:typecheck`、`npm run build`、`npm run worker:smoke`、`worker/runtime/setup.test.ts` 2/2，以及 Docker Worker runtime 20/20 文件、93/93 测试；下一步提交 U29 代码/文档并重新执行完整 CI。
>
> 当前状态：**Cloudflare API Token、8 项用量监控、Token 直接配置插件域名、原生插件服务器手动构建和 Cloudflare 权限三列文案已完成。权限修正提交为 `3e9f89d`，原生修复提交为 `accfed0`；`accfed0` 的 Actions #84（run `39931270148`）已在 GitHub Actions 页面确认成功。权限面板现在按创建页左、中、右三列展示：账户/区域/用户范围、中文+官方英文权限组、读取/写入/编辑级别；中列不再让用户把 `Account Analytics Read` 误当成一个下拉选项。`3e9f89d` 的本地构建、UI 静态审计和 Cloudflare 设置定向 Playwright 31/31 已通过。新发现 U29：当插件域名后缀覆盖主站（例如后缀为 `shelter.red`、主站为 `platform.shelter.red`）时，主站会被误判为插件域名并返回 `Plugin domain not found`；下一步先修复主站 Host 路由，再进入 8.5。若之后再次修改本 HANDOFF，会生成新的 docs-only commit；恢复时不要用本文代替实时 Git/Actions 查询。**
>
> 本文件是上下文压缩后的第一事实源。README、旧方案、旧测试、聊天摘要或历史提交说明与本文冲突时，以用户最新要求、当前代码和本文为准。恢复后先执行第 0 节的核验命令，再按第 8 节顺序继续。

## 0. 压缩恢复卡（先看这里）

### 0.1 仓库、分支与提交

```text
仓库：/home/tc/work/plugin-platform
分支：main
HEAD（本次核验）：68e56ee docs: 登记主站域名误判路由问题
origin/main（本次核验）：68e56ee
工作区（本次核验）：U29 路由修复、回归测试和 README/help/验收说明共 8 个非 HANDOFF 文件待验收提交；本次先提交 HANDOFF 状态记录
fetch remote：https://github.com/shelter-red/plugin-platform.git
push remote：git@github-plugin-platform:shelter-red/plugin-platform.git
```

最近提交（均已推送）：

```text
3e9f89d fix(cloudflare): 明确权限组三列中文名称
a44e427 docs: 记录原生构建完成与权限三列后续
accfed0 fix(native): 修复 Windows 共享库构建
e4ae1f1 feat(native): 增加插件服务器手动构建与共享库
a07193e docs: 更新权限验收状态
114acee fix(ui): 清理重复入口和空态卡片
5504b62 docs: 记录界面重复入口修复验收  ← Actions #75（run `39904507031`）成功
fea273f docs: 登记清理 Cloudflare 多余配置文案
9bdd26b fix(copy): 删除 Cloudflare 手动配置提示  ← Actions #77（run `39906392896`）成功
7903e41 docs: 登记用量权限解耦与范围标注
3cf3ba1 fix(cloudflare): 解耦用量读取与域名权限  ← Actions #79（run `39912901398`）成功
ca7e54c fix(cloudflare): 显示 Token 权限实际状态  ← Actions #71 成功
ce8ca1d docs: 固化最终权限验收基线
269befa docs: 更新权限诊断验收状态
8ec7590 fix(cloudflare): 区分监控与域名权限
9d2f38d fix(cloudflare): 收口 Token 权限与配置文案
de1a4e2 docs: 记录 Token 自动配置域名实现
49c7413 docs: 明确 Token 范围与域名配置边界
67efa26 docs: 记录窄屏修复闭环与文案审计入口
e349e7b fix(ui): 修复设置页窄屏布局并更新视觉基线
b6ad802 docs: 记录交接提交的 Actions 成功结果
02dbb1a docs: 更新交接状态与 Actions 基线
a9e3839 docs: 固化完整交接与本地验收基线
6e9d0ec docs: 统一 Cloudflare API Token 与平台额度语义
cc37ba8 docs: 校订交接基线并固化剩余任务
42d1870 docs: 记录推送与 Actions 验收结果
c0bfde3 docs: 记录完整本地 CI 结果
87e88dd docs: 校订交接恢复基线
d1c9f3d docs: 补齐旧文档清理交接清单
a02871a docs: 更新 Token 与用量验收交接基线
850928e feat(console): 完成 Cloudflare Token 与八项用量迁移
9882c76 fix(worker): 收口 Cloudflare API Token 与只读额度契约
```

- `6e9d0ec` 包含本轮 16 个非 HANDOFF 路径；`a9e3839` 是随后单独收口 HANDOFF 的提交，两者均已 push。
- `a9e3839` 对应 Actions run `39855022484`（#56），`completed/success`；随后 HANDOFF-only 的 `02dbb1a` 对应 #57，也已成功。
- `e349e7b` 是窄屏布局与视觉基线修复提交，对应 Actions run `39880735501`（#61），`completed/success`。
- 上一基线 `cc37ba8` 对应 #55（run `39852598521`）；更早成功包括 `42d1870` #54（run `39851368864`）、`c0bfde3` #53（run `39850719037`）、`579eb1f` #52（run `39840532476`）。
- 本轮 17 个路径已通过完整本地验收并完成 push/远端 Actions 闭环；`02dbb1a`、`b6ad802` 记录前序 Actions 结果，`e349e7b` 的 #61 也已成功。若之后新增 HANDOFF-only commit，仍须按第 7 节追踪最新 HEAD，不能拿 #61 代替新提交证据。
- 仓库内未发现 `AGENTS.md`，无额外仓库级代理指令。
- 恢复时始终以实际 `git fetch`、`git log -1`、`git status`、`git rev-parse HEAD origin/main` 为准，不凭本文记忆判断。

恢复时先运行：

```bash
cd /home/tc/work/plugin-platform
git fetch
git status --short --branch
git log -1 --oneline --decorate
git rev-parse HEAD origin/main
git diff --stat
git diff --check
find .. -name AGENTS.md -print
```

### 0.2 本轮文件与提交

本轮初始工作区共 17 个路径。其中以下 16 个非 HANDOFF 路径已提交为 `6e9d0ec` 并推送：

```text
README.md
docs/acceptance-matrix.md
docs/local-e2e.md
scripts/deploy-worker.sh
scripts/deploy-worker.test.sh
src/api.ts
src/content/help.en.md
src/content/help.zh-CN.md
src/content/privacy.en.md
src/content/privacy.zh-CN.md
src/features/settings/QuotaForm.tsx
src/locales/en.ts
src/locales/zh-CN.ts
worker/src/index.ts
worker/src/setup.ts
方案.md
```

`HANDOFF.md` 随后作为 `a9e3839` 独立提交收口并推送。

这些改动的主旨是：把活跃 Cloudflare 运行时统一为长期 API Token、删除手填 Cloudflare 免费额度语义、保留 GitHub OAuth、清理旧组件/旧字段文案并更新交接事实。`src/api.ts`、`worker/src/index.ts`、`QuotaForm.tsx` 目前是注释/文案级改动，不是行为改动。

`850928e` 已提交的核心前端路径包括：

```text
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
tests/console-worker.spec.ts
tests/console-real-stack.spec.ts
```

禁止 `git reset --hard`、`git clean`、批量 checkout、`git add .`；后续提交必须逐文件显式 stage，使用中文提交信息。

### 0.3 当前验证状态

```text
git diff --check                               PASS
npm run ci:local                               PASS（本轮 19 个路径；87/87 UI smoke）
npm run deploy:worker:test                     10/10 PASS（含 README 新部署前提断言）
Worker runtime（Docker node:22-bookworm）       20/20 files，91/91 tests PASS
latest known remote Actions #84 / 39931270148   completed/success
本轮功能改动提交 / push / Actions 闭环            PASS
```

已记录的代码验收：

```text
npm run build                                  PASS
npm run ui:conventions                         89 个 TSX，0 违规
npm run ui:css-audit                           486 条规则，0 死代码/重复
npm run ui:smoke                               87 passed
npx playwright test tests/console-worker.spec.ts 31 passed（本轮 Cloudflare/UI 定向验收）
npm run deploy:worker:test                     10/10 PASS
Worker runtime                                 20/20 files，89/89 tests PASS
npm run ci:local                               PASS（最近的完整基线）
```

尚未完成/不能宣称通过：

```text
登录页、设置页、Cloudflare Token 面板、用量页人工视觉验收
帮助中心的二进制/共享库插件服务器教程
真实 Cloudflare API / Token / subscriptions / Analytics 联调
真实 GitHub OAuth App 与公网 SMTP 联调
Workers Builds 控制台 Deploy command 核对
生产 D1 migration 与已部署页面复核
帮助中心的二进制/共享库插件服务器教程
```

### 0.4 恢复后的第一动作

1. 执行 0.1 的 Git 核验，不凭记忆判断 HEAD、分支或工作区。
2. 阅读第 1、2 节，确认用户硬约束，尤其不要恢复任何 Cloudflare OAuth 字段。
3. 8.2 已完成：16 个非 HANDOFF 路径在 `6e9d0ec`，HANDOFF 记录提交为 `a9e3839`、`02dbb1a`、`b6ad802`，窄屏修复为 `e349e7b`，均已推送；#56、#57、#58、#61 均成功。8.3 窄屏布局子步骤已完成，8.4 原生手动构建已实现；#83 的 Windows 失败已由 `accfed0` 修复，#84 已确认成功。U28 权限三列修正已由 `3e9f89d` 完成。U29 的代码和文档已在工作区，先完成本次 HANDOFF-only 记录，再做本地验收、代码提交和新 HEAD 的 Actions 追踪。若本次又产生 HANDOFF-only 提交，以实时 Git/Actions 为准。
4. 之后严格按 U29 提交/推送闭环 → 8.5 → 8.6 → 8.7 → 8.8 执行；8.4 原生手动构建和 U28 权限三列修正已完成。
5. 每次更新本文件后单独提交；push 后追踪新 HEAD 的 Actions，不引用旧 run 作为新提交证据。
6. 每次压缩恢复后都更新本文件，不把“计划”写成“已完成”。

## 1. 用户硬约束与最终产品决策

### 1.1 Cloudflare 最终只用长期 API Token

- 彻底废弃 Cloudflare OAuth 运行时：路由、回调、state、Cookie、refresh、revoke、auth-result、OAuth 客户端配置与 refresh_token 语义全部不得保留。
- 创建入口固定为：

```text
https://dash.cloudflare.com/profile/api-tokens
```

- 用户创建 Token 时当前界面固定展示六项权限，不能勾选、取消、增删或编辑：

```text
Account Settings Read
Account Analytics Read
Billing Read
Zone Read
DNS Write
Workers Routes Edit
```

- 前三项用于账号发现、Analytics 用量和套餐读取；后三项用于查找 Zone、写入插件通配 DNS 记录和创建 Worker Route。插件域名后缀保存时由平台使用已保存 Token 自动同步这些资源；已有第三方记录或路由时返回冲突，不覆盖。
- Cloudflare API Token 的固定六项权限在设置页平铺列出，并显示当前 Token 的实际探测状态。`Account resources` 选择目标账号，`Zone resources` 选择插件域名所在 Zone；`User resources` 不使用。平台的 Account ID 只用于多个可见账号时选择目标账号。

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
| U02 | “自己从会话历史里读 Git 分支，自行提交推送” | 每步有中文 Git 记录；不靠聊天猜 | ✅ 16 个非 HANDOFF 路径为 `6e9d0ec`，HANDOFF 为 `a9e3839`，均已推送 |
| U03 | “推送时注意 Actions，老是错误” | 本地完整 CI + push 后追踪到成功 | ✅ `e349e7b` 的代码提交 Actions #61 成功；后续新提交仍须重新追踪 |
| U04 | 为什么错误状态靠 `/?auth_error=` | 真实 HTTP + JSON，留在当前页 | ✅ Cloudflare 当前页 HTTP 错误与 GitHub 错误页均有测试；旧 `auth_error` 文案已清理 |
| U05 | setup 失效为什么单独返回 `Setup is not available` | 返回 null 后走普通非路由行为 | ✅ 已实现并有测试 |
| U06 | `D1_ERROR: no such table: workspaces` | 先应用全部 migrations 再部署 | 🟡 deploy 脚本已实现并测试；Workers Builds 控制台配置待核对 |
| U07 | `invalid_scope` / `workers-platform.read` | 删除错误 OAuth scope，改 API Token，固定真实权限 | 🟡 前后端和文档已 Token 化并有 mock/runtime/UI 证据；真实 Cloudflare API 未联调 |
| U08 | 授权失败为什么跳首页 | 错误留系统设置页，显示 HTTP/status/code/message | ✅ Token 表单保留 HTTP 错误并在 `/settings` 显示，runtime/UI 已覆盖 |
| U09 | 用户不知道 Token 给什么权限，取消后权限就没了 | 权限固定展示；创建 Token 直达链接 | ✅ 六项权限固定展示、创建 Token 直达链接、UI 与文档均已同步 |
| U10 | “未识别唯一账号”也是权限问题 | verify → accounts 全分页 → subscriptions，不猜账号 | ✅ 后端和 runtime 测试覆盖 |
| U11 | 用量/配额为什么没刷新按钮 | 一个清晰刷新入口，自动加载期间不禁用 | ✅ `PageHeader` 唯一刷新入口、独立 `usageRefreshing` 和点击后再次请求的回归测试均已通过 |
| U12 | OAuth 根本没有 offline_access | 删除 offline_access/refresh/过期语义 | ✅ 活跃 Cloudflare 流程与文档已删除；仅测试负断言和历史 migration/兼容标记保留 |
| U13 | 未配置为何还能查 `/api/usage/local?range=7d` 且返回 200 | 区分 Cloudflare 与本地统计；未配置不读缓存/不发请求 | ✅ 路由与测试已覆盖 |
| U14 | response_type 放错位置；CF OAuth 没有 PKCE | 最终 Token 方案中这些字段全部消失 | ✅ 当前 Token UI/文档不出现这些字段；测试只把它们作为“必须不存在”的负断言 |
| U15 | `1e4fd10`、`fd80fa4` Actions 失败 | 失败修复、本地 CI、push、Actions、产物闭环 | ✅ 当前最终基线 `e349e7b` #61 成功；每次新提交仍须重新追踪 |
| U16 | 图标没对齐；“默认工作区”很矮挡字 | 统一高度/gap/行高/居中；双主题多视口检查 | 🟡 空态与窄屏设置布局已实测；默认工作区真实数据和全局图标对齐仍待下一步审计 |
| U17 | 额度少，D1 写入等都要监控且显示百分比 | 8 项 used/limit/percentage | ✅ 前后端已实现 8 项，含次数、上限、百分比；专项回归已通过 |
| U18 | 平台和监控分开；平台请求不限 | 平台只统计；Cloudflare 官方额度独立 | 🟡 分组、“不限”和定向回归已实现；最终多视口视觉验收未完成 |
| U19 | GitHub OAuth 没过期，CF 为什么过期；改 Token | 不再暗示 OAuth 过期；界面/链接/错误全部 Token 化 | ✅ 后端/API/面板/README/docs/help/deploy 提示已 Token 化，随 `6e9d0ec` 推送并通过 #56 |
| U20 | CF 免费额度为何在系统设置手填，应从 CF 读取 | 删除手填；读 subscriptions；未确认 Free 显示未读取 | ✅ 维护/用量 UI 与文档已改；真实 subscriptions 响应仍未联调 |
| U21 | 文案诡异、莫名卡片、同页多个按钮跳同页 | 中英文审计；清重复说明/空卡片/重复跳转 | ✅ `114acee` 已完成列表页空卡片、重复入口和中英文 Cloudflare 文案清理；Actions #75（run `39904507031`）成功 |
| U26 | “在 Cloudflare 创建页还要设置”及手动 DNS/Worker Route 提示没有必要且与 Token 自动配置冲突 | 删除旧的创建页说明和部署脚本中的手动 DNS/Worker Route 指示；保留必要的六项权限与 Account/Zone/User resources 说明；增加无误导提示的回归断言 | 🟡 已登记，待实现与 Actions 验证 |
| U22 | Actions 手动构建插件服务器：可执行/库、目标平台 | 仅 `workflow_dispatch`；真正共享库 + artifact + SHA256 | ✅ `e4ae1f1` / `accfed0` 已实现并完成本地三平台构建验证；`accfed0` Actions 最终结论待限流恢复后确认 |
| U23 | 帮助中心说明二进制/库文件服务器怎么用 | 中英文完整使用说明 | ⬜ 未开始 |
| U24 | 都整理到磁盘 HANDOFF，避免压缩后忘 | 所有要求、事实、阻塞、步骤、验收可恢复 | ✅ 已更新到 `9d2f38d` 基线，明确区分完成项、剩余项、禁止事项和实时核验要求 |
| U25 | 监控权限怎么配置域名；OAuth/Token 名称不一致；Token 还要选范围 | Token 固定六项权限平铺展示实际状态；说明 Account/Zone/User resources；保存插件域名后缀时自动同步 Zone、DNS 和 Worker Route | ✅ `ca7e54c`：前后端状态探测、平铺 UI、文案、Docker runtime 17/17、`ci:local` 87/87、定向浏览器验收已通过；Actions #71 成功 |
| U27 | 用量刷新不应被 DNS/Worker Route 缺失阻断；权限列表看不出账户/区域/用户范围 | 用量查询只要求监控权限；资源明细权限失败时保留可读取结果并把明细标为未读取；每项权限标明 Account/Zone resources，并明确 User resources 不使用 | ✅ `3cf3ba1`：Billing/Resource Analytics 缺失降级、账户/区域范围标签、Docker runtime 93/93、`ci:local` 88/88；Actions #79 成功 |
| U28 | Cloudflare 创建页是范围/权限/级别三个并排选择，现有拼接英文名称搜不到 | 权限列表按左“账户/区域/用户范围”、中“中文权限组（含官方英文）”、右“读取/写入/编辑级别”三列展示；名称与 Cloudflare 官方权限组一致；同步帮助、README、验收和测试 | ✅ `3e9f89d`：本地构建、UI 静态审计、Cloudflare 设置定向 Playwright 31/31 通过；推送后追踪本提交 Actions |
| U29 | 主站 `platform.shelter.red` 返回 `Plugin domain not found` | 插件后缀匹配不能覆盖已配置的主站 Host；主站继续交给管理端 SPA/API，真正的插件域名才进入公开代理 | 🟡 本地验收通过（setup 2/2、Worker runtime 93/93）；待代码提交、推送和最新 Actions 闭环 |

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
  - `CloudflarePermissionList.tsx`：固定六项权限平铺展示，不提供 input/button，并显示当前 Token 的“已验证/缺少/未检测”状态；
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

### 3.3 用量回归已完成（`850928e`）

`tests/console-worker.spec.ts` 已覆盖并通过以下 6 项：

1. 自动加载期间 `usage-refresh` 可用，点击会真正再次请求 `/api/usage/cloudflare` 和 `/api/usage/local`。
2. 用量页只有一个刷新入口。
3. Cloudflare 8 项均显示已用次数、上限、百分比。
4. 未配置时官方 Workers 显示 `—`，但平台本地计数仍显示。
5. `legacyCredential` 在当前用量页显示，不跳转首页。
6. 401/403 错误在当前用量页显示 HTTP 状态/错误信息。

定向 worker-mock 回归 8/8、完整 UI smoke 88/88 通过；窄屏测试中“11 个阈值输入”旧注释已同步改为平台 3 项阈值，并新增设置分区 390px 边界断言。后续若修改用量契约或设置布局，必须保留这些断言，不能删测试或放宽断言。

### 3.4 文档/文案清理状态（已推送并通过 Actions #56）

本轮已将活跃流程中的旧 Cloudflare OAuth/手填额度文档改为 API Token / subscriptions 语义：

```text
README.md
docs/acceptance-matrix.md
docs/local-e2e.md
scripts/deploy-worker.sh
scripts/deploy-worker.test.sh
src/content/help.zh-CN.md
src/content/help.en.md
src/content/privacy.zh-CN.md
src/content/privacy.en.md
src/locales/zh-CN.ts
src/locales/en.ts
src/api.ts（注释）
worker/src/index.ts（注释）
worker/src/setup.ts（初始化说明）
src/features/settings/QuotaForm.tsx（注释）
方案.md
```

收口搜索：

```bash
rg -n -i "offline_access|workers-platform\.read|response_type|pkce|grant_type|cloudflareQuotas|Cloudflare OAuth|Cloudflare 授权|OAuth 客户端|OAuth client|CloudflareAuthorizeSection|CloudflareClientSection|CloudflareScopeList|CloudflareAuthDiagnostics|CloudflareAccountCard" README.md 方案.md docs src worker scripts native-server .github tests
```

允许保留并已在当前工作区复核的命中：

- GitHub OAuth 登录、GitHub Client ID/Secret、GitHub 回调与 `oauth_states`。
- 测试中的负断言：确认 Cloudflare Token 面板不存在 OAuth 客户端、`response_type`、PKCE、可编辑 scope。
- `legacy_oauth`：只用于识别旧 Cloudflare 密文并提示重新录入。
- `worker/migrations/0002_cloudflare_oauth.sql`：历史 migration，不删除、不改写。
- `native-server/third_party/**` 中的 `response_type` 是 WebSocket++ 内部类型，与 Cloudflare OAuth 无关。

帮助中心的 Cloudflare API Token FAQ 与 privacy 已更新；二进制/共享库插件服务器教程仍属第 8.5 节，不能把“Cloudflare FAQ 已改”误当成“帮助中心全部完成”。

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
- 部署脚本末尾提示已改为“在管理后台配置 Cloudflare API Token、SMTP、平台阈值和插件域名后缀”，`npm run deploy:worker:test` 10/10 通过，并随 `6e9d0ec` 推送。
- 部署后仍需实际访问生产页面，确认 workspaces 表、设置页和用量页不再报 D1 缺表。

## 6. 验证证据与复现

### 6.1 当前前端

有效的已提交代码基线：

```text
git diff --check           PASS
npm run build              PASS
npm run ui:conventions     PASS，89 TSX / 0 违规
npm run ui:css-audit       PASS，476 规则 / 0 死代码
npm run ui:smoke           86 passed
npm run deploy:worker:test 10/10 PASS
npm run ci:local           PASS（最近一次完整记录）
```

当前 17 个路径（含文档/文案、注释与部署测试断言）已执行完整本地验收：`git diff --check`、`npm run ci:local`（87/87 UI smoke）、`npm run deploy:worker:test`（10/10）和 Docker Worker runtime（20/20 files，89/89 tests）全部通过。随后 `02dbb1a`、`b6ad802` 仅更新交接事实，`e349e7b` 修复窄屏布局并更新视觉基线；Actions #57/#58/#61 也已成功。后续若再有提交，仍必须追踪该新 HEAD，不能拿本轮证据代替。

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
e349e7b  run 39880735501  #61  success  （当前已核验最终基线）
b6ad802  run 39877275016  #58  success
02dbb1a  run 39856158838  #57  success
a9e3839  run 39855022484  #56  success
cc37ba8  run 39852598521  #55  success
42d1870  run 39851368864  #54  success
c0bfde3  run 39850719037  #53  success
579eb1f  run 39840532476  #52  success
c84ceb0  run 39839503567  #51  success
92e3fcd  run 39837622904  #50  success
a9c85f0  run 39836893476  #49  success
7a54cfc  run 39835890828  #48  success
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

已新增并通过 6 项用量回归：加载期间刷新可用、唯一刷新入口、8 项额度、未配置时官方为空、旧凭据留在用量页、401/403 保留 HTTP/错误码/消息。同步修正窄屏测试里的“11 个阈值输入”旧注释。定向 worker-mock 8/8、完整 UI smoke 87/87 通过。

### 8.2 清理旧文档与文案（已完成并推送，Actions #56/#57 成功）

状态：**本轮 17 个路径已通过完整本地验收并推送；16 个非 HANDOFF 路径为 `6e9d0ec`，HANDOFF 由 `a9e3839`、`02dbb1a` 逐步收口，#56/#57 成功。不得再写成“尚未修改”“待 push”或“尚未验证”**。

- README：GitHub OAuth 与 Cloudflare API Token 已明确区分；Cloudflare 固定六项权限并说明 Token 名称、Account/Zone resources 与自动 DNS/Worker Route；不再写 refresh/offline、Cloudflare OAuth 客户端或手填免费额度。
- `docs/acceptance-matrix.md`：Cloudflare 行改为 Token verify / accounts / subscriptions / Zone / DNS / Worker Route / 权限实际状态 / 密文保存 / 本地删除；组件化行改为 `CloudflareTokenForm` / `CloudflareTokenStatus` / `CloudflarePermissionList` / `useCloudflareTokenForm`；维护配额行只写平台 3 项阈值；真实栈说明不再手填 Cloudflare 额度。
- `docs/local-e2e.md`：移除 `cloudflareQuotas.d1RowsRead` 手填流程，改为确认面板没有免费额度输入框；联调边界改为 Cloudflare API Token / Analytics / subscriptions。
- `方案.md`：Cloudflare 区块、接口、权限矩阵、验证项改为 API Token；平台设置权限矩阵明确 GitHub OAuth，不再用含糊的 OAuth 指代 Cloudflare。
- `scripts/deploy-worker.sh` / `deploy-worker.test.sh`：部署完成提示与断言同步为 GitHub OAuth + Cloudflare API Token + SMTP + 平台阈值。
- `worker/src/setup.ts`：初始化说明改为 Cloudflare API Token。
- help/privacy：明确 GitHub OAuth 与 Cloudflare API Token，不泛称 OAuth clients；Cloudflare FAQ 已覆盖固定权限和 401/403/409/502。
- locale/注释：删除旧 `cloudflareConnected` 死 key，页面描述和本地用量注释改为 Token/凭据语义。

收口判定：运行第 3.4 节搜索时，只允许出现 GitHub OAuth、测试负断言、`legacy_oauth`、历史 migration 和 `native-server/third_party`。本轮 `git diff --check`、`npm run ci:local`、Worker runtime 与 `npm run deploy:worker:test` 均已通过；`deploy-worker.test.sh` 的 README 最小部署断言已从旧的“Cloudflare 账号授权”同步为“连接 Cloudflare Workers Builds 账号”。`6e9d0ec`、`a9e3839` 与 `02dbb1a` 已推送，#56/#57 成功。

### 8.3 视觉与文案验收（窄屏布局子步骤已完成）

开始本步骤前必须先检查本地 Git/Actions；本次已在 `b6ad802` 的 HANDOFF 中登记，并在 `cf130d1` 的 Actions #59 成功后执行。当前证据与问题：

- 登录页实际页面是 `AuthFrame`/`LoginPage` 组件，桌面与窄屏没有横向溢出；不是旧登录页。
- Cloudflare 设置区实际页面使用 Token 表单、固定六项权限、Token 创建说明和创建 Token 链接；页面没有 Cloudflare Client ID、Secret 或回调字段。现有 tracked settings 截图仍是旧 OAuth 外观，且 5% 像素容差使 targeted screenshot 仍通过，不能继续作为可靠视觉基线。
- 390px 设置页的 `.settings-nav` 与 `.settings-content` 已通过 `min-width: 0`、`width: 100%` 和布局断言收敛到 362px 内容列，没有横向溢出。
- 空态下工作区切换器高度为 46.34px，标题/副标题合计 30.34px，当前没有遮挡；真实默认工作区数据和全局图标对齐仍属于后续视觉审计。
- 当前宿主缺少 CJK 字体，直接截图出现方框/缺字；最终像素基线必须在 CI 同款 Playwright 环境重建，不能把宿主字体缺失误当成产品文案问题。

本步骤已完成（`114acee`）：

- 服务器和域名页删除无条件额外 EmptyState 操作卡片，页头保留唯一主操作。
- 插件页删除空态按钮和表格底部重复“加载插件”，保留页头主操作与数量信息。
- 用量页数据源状态只显示状态；配置入口只在未连接、错误或旧凭据状态出现，已连接状态不再重复跳设置。
- 账号页删除与工作区行重复的“管理工作区”按钮。
- 删除对应无用 props、imports、locale key 和 `EmptyState` 的 children 接口；英文 Cloudflare 帮助同步 Account/Zone/User resources 与三种权限状态。
- 新增重复入口负断言；定向测试列表页 1/1、用量与账号页 2/2，临时桌面/390px 截图检查通过，完整 `ci:local` 88/88 通过。

本步骤不改变路由、API、权限和数据契约。下一步按 8.4 登记原生插件服务器手动构建 workflow；不得把构建功能回填到本步骤。

本步骤审计发现（待实现）：

- `ServersPage` 与 `DomainsPage` 在列表有数据时仍然无条件渲染额外的 EmptyState 操作卡片；无数据时又与页头主按钮重复。删除额外卡片，页头保留唯一主操作。
- `PluginsPage` 的页头、空态和有数据时表格底部都提供“加载插件”；保留页头主操作，删除空态按钮和底部重复按钮，保留数量信息。
- `UsagePage` 的状态提示和“数据源状态”都跳转 Cloudflare 设置；保留状态提示的配置入口，数据源状态只展示状态。
- `AccountWorkspacesCard` 的工作区行和底部“管理工作区”按钮都跳转 `/workspaces`；保留工作区行入口，删除底部重复操作。
- `src/content/help.en.md` 仍要求填写 Token 名称且未说明 `User resources`；与中文帮助和当前 Token 权限模型统一。

本步骤不改变路由、API、权限和数据契约；修复需同步移除无用 import/props，并增加 Playwright 负断言证明重复入口和额外卡片不再出现。

本次已完成：`.settings-nav`、`.settings-content` 和 AntD 菜单补充 `min-width: 0`/`width: 100%`；新增 `console-ui` 的 390px 分区边界断言；在 CI 同款 Playwright 容器重建设置页 6 张截图、移动设置预览和登录页截图。结果为 `ci:local` 87/87、`npm run deploy:worker:test` 10/10；390px 下设置布局、导航和内容列均为 362px，未超出视口。当前又完成 Cloudflare Token 六项权限、自动 DNS/Worker Route 和帮助中心文案收口；下一步仍是图标/文字对齐、重复入口/空卡片以及中英文文案审计。

- 登录页实际截图，确认不是旧页面或旧组件。
- 检查设置页 Cloudflare Token 区块、固定权限、创建 Token 链接。
- 检查用量页唯一刷新按钮、平台/Cloudflare 分组、8 项百分比。
- 检查窄屏、双主题、图标/文字对齐、“默认工作区”高度。
- 通读中英文，删除重复按钮、空卡片、技术黑话和异常句子。

### 8.4 实现原生手动构建（已完成）

新增 `.github/workflows/build-plugin-server.yml`，仅 `workflow_dispatch`，完善 `native-server/CMakeLists.txt` 的真正 SHARED target、公共头和构建开关，处理三平台依赖。`e4ae1f1` 增加实现，`accfed0` 修复 MSVC `min` 宏冲突；本地 CTest 11/11、Linux executable/shared、MinGW Windows executable/shared/host 均通过。Actions #83（run `39927071976`）因 MSVC `std::min` 冲突失败，#84（run `39931270148`）已包含修复，最终状态待 GitHub 页面/API 限流恢复后确认。

### 8.5 补帮助中心及隐私文档

状态：Cloudflare API Token FAQ、privacy、README/docs 已在工作区同步；**原生二进制/共享库教程仍未写**。U29 的主站误判应急说明已同步到 README/help，但不替代代码修复和生产部署。

剩余：完成第 3.7 节中英文教程，并更新 README、方案、验收矩阵、local-e2e、privacy、`native-server/README.md` 中与原生构建产物相关的部分。

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
4. 查询最新 Actions，间隔至少约 1 分钟，追到 `completed`；`9d2f38d` 已由 #66 验证成功。
5. 失败时读失败 step、日志和 `playwright-report` artifact；修复后重跑本地、再 push。
6. 只有最新 Actions 成功后才能宣称完成。

## 9. 最终验收清单

- [ ] 登录页实际视觉检查通过，结构为新组件且无旧页面残留。
- [ ] “默认工作区”文字不遮挡，图标/文字对齐。
- [x] 系统设置只出现 Cloudflare API Token 和可选 Account ID。
- [x] 活跃 Cloudflare 流程不出现 Client ID/Secret、回调、scope 编辑、PKCE、`response_type`、`grant_type`。
- [x] 固定权限按 Cloudflare 三列展示：账户 / Account + 账户设置 / Account Settings + 读取 / Read、账户 / Account + 账户分析 / Account Analytics + 读取 / Read、账户 / Account + 账单 / Billing + 读取 / Read、区域 / Zone + 区域 / Zone + 读取 / Read、区域 / Zone + DNS + 写入 / Write、区域 / Zone + Workers 路由 / Workers Routes + 编辑 / Edit；用户 / User 不使用，不提供自定义入口。
- [x] “创建 Token”跳到 `https://dash.cloudflare.com/profile/api-tokens`。
- [x] Token 保存前完成 verify、账号发现、subscriptions 校验；失败用 HTTP 状态并在当前面板显示，runtime/UI 回归已有覆盖。
- [x] 旧 Cloudflare OAuth 活跃路由、Cookie、refresh/revoke、state 和 smoke 已删除。
- [x] README/docs/help/privacy 中活跃 Cloudflare 流程已 Token 化并推送。
- [x] setup 返回 null 时没有 “Setup is not available” 特例。
- [x] 未配置 `/api/usage/cloudflare` 返回 `{"configured":false,"cached":false}`，无外部请求、无旧缓存命中。
- [x] `/api/usage/local?range=7d` 仍返回 200。
- [x] Cloudflare 免费额度只从 subscriptions 读取；只有确认 Free 才显示官方基线，未确认时显示未读取。
- [x] 8 项都显示次数和百分比，包含 D1 行写入、KV 删除、KV 列举。
- [x] 平台统计与 Cloudflare 额度分组；平台请求不设上限。
- [x] 设置页无手填 Cloudflare 免费额度，只剩平台 3 项阈值。
- [x] 用量页只有一个刷新入口；自动加载时刷新按钮不禁用且点击会再次请求。
- [x] 概览已移除与右上箭头重复的“查看全部额度”入口；其他页面文案/空卡片仍待视觉验收。
- [ ] 生产部署应用 0008 及全部 migrations，Workers Builds 实际入口为 `npm run deploy`。
- [x] 手动 Actions 可选可执行程序/库文件、目标平台，并上传 artifact + SHA256；本地三平台构建和 CTest 11/11 通过，#84 已确认成功。
- [ ] 帮助中心中英文都有二进制/共享库插件服务器完整说明。
- [x] 当前 17 个路径的 `npm run ci:local`、Worker runtime、deploy test 均已通过。
- [x] native CTest 11/11、Linux executable/shared、MinGW Windows executable/shared/host 已执行并通过。
- [x] `e4ae1f1` / `accfed0` 的原生实现、本地三平台构建、C ABI smoke 和 CTest 11/11 已通过；#83 的 Windows 失败原因已修复，#84 已确认成功。
- [x] 当前 17 个路径的完整本地 CI 已通过（87/87 UI smoke）。
- [x] 16 个非 HANDOFF 路径已提交为 `6e9d0ec`，HANDOFF 收口为 `a9e3839`，两者均已 push。
- [x] `a9e3839`/#56、`02dbb1a`/#57、`b6ad802`/#58、`e349e7b`/#61 的远端 Actions 均已成功；若本次整理又生成 HANDOFF-only commit，以实时最新 run 为准。

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
- 当前 17 个路径已经提交；不要用批量 reset/checkout/clean 回滚已收口的 Token 化文档、行为修复和 HANDOFF。后续改动仍应逐文件审查、显式 stage。
- 官方免费基线可能随 Cloudflare 政策变化；UI 应标注来源和核对日期，不能声称实时计费。
- `worker/migrations/0002_cloudflare_oauth.sql` 是历史 migration，不删除、不改写；只删除运行时逻辑。
- Actions 轮询不要过密；403 不等于代码失败。
- 没有完整 CI 和最新 Actions success，不得说“已推送且完成”。

## 11. 最近动作日志

- 2026-10-23：提交 `850928e`（`feat(console): 完成 Cloudflare Token 与八项用量迁移`），前端 Token 表单、8 项额度、HTTP 错误与设置导航竞态修复收口；其权限清单已在本轮扩展为六项并补充自动域名配置说明。
- 2026-10-23：提交 `9882c76`（`fix(worker): 收口 Cloudflare API Token 与只读额度契约`）；Worker runtime 20 个文件、89 个测试通过。
- 2026-10-23：完成 Cloudflare 硬约束：只用长期 API Token；固定 `Account Settings Read`、`Account Analytics Read`、`Billing Read`；删除 `offline_access`、`workers-platform.read`、PKCE、`response_type`、`grant_type`、Client ID/Secret、回调和 refresh/revoke 活跃逻辑。
- 2026-10-23：确认未配置 Cloudflare 时 `/api/usage/cloudflare` 返回 `{"configured":false,"cached":false}`，不读旧缓存、不发外部请求；`/api/usage/local?range=7d` 独立返回 200。
- 2026-10-23：确认免费额度只从 subscriptions 读取，只有确认 Free 才展示 8 项官方基线；设置页只保留平台 `activeConnections`、`r2Bytes`、`r2Objects` 三项阈值。
- 2026-10-23：提交 `a02871a`、`d1c9f3d`、`87e88dd`、`c0bfde3`、`42d1870`、`cc37ba8` 等交接文档；`87e88dd` 基线完整 `npm run ci:local` 通过。
- 2026-10-23：`cc37ba8` push 后 Actions run `39852598521`（#55）completed/success。
- 2026-10-23：恢复核对 `HEAD == origin/main == cc37ba8`，无 `AGENTS.md`；发现工作区 16 个文件是旧 Cloudflare OAuth/手填额度文案清理，并非干净基线。
- 2026-10-23：修正验收矩阵第 19 行“生产 OAuth/API 端点”残留，并重写组件化验收行：Cloudflare 区明确为 `CloudflarePanel` + Token 三组件 + hook；维护配额明确只剩平台 3 项阈值；刷新入口明确只有 `usage-refresh`。
- 2026-10-23：修正 `方案.md` 权限矩阵与目录注释，Cloudflare 只用 API Token，平台设置中的 OAuth 明确为 GitHub OAuth。
- 2026-10-23：README/help 中泛化 OAuth 表述改为 GitHub OAuth / Cloudflare API Token；历史 migration、`legacy_oauth` 和测试负断言保持。
- 2026-10-23：当前工作区共 17 个路径（16 个文档/文案/注释/部署测试断言 + `HANDOFF.md`）。`git diff --check`、`npm run ci:local`（89 TSX 审计、476 样式规则、构建、Worker smoke、86/86 UI smoke）、`npm run deploy:worker:test`（10/10）和 Docker Worker runtime（20/20 files，89/89 tests）全部通过。
- 2026-10-23：部署测试发现并修复 README 最小部署断言残留：由“唯一部署必填项：Cloudflare 账号授权”同步为“唯一部署必填项：连接 Cloudflare Workers Builds 账号”。
- 2026-10-23：16 个非 HANDOFF 路径提交为 `6e9d0ec`（`docs: 统一 Cloudflare API Token 与平台额度语义`）；HANDOFF 随后以 `a9e3839`（`docs: 固化完整交接与本地验收基线`）单独收口，两者均已推送。
- 2026-10-23：`a9e3839` 的 Actions run `39855022484`（#56）达到 `completed/success`；`HEAD == origin/main == a9e3839`，工作区 clean。
- 2026-10-23：再次整理 HANDOFF，更新“待 push/PENDING”旧状态，将已完成的 Token 化、部署断言、17 路径验收与 #56 成功记录下来；若产生新的 HANDOFF-only commit，仍需按第 7 节实时追踪，不能用 #56 代替新 HEAD。
- 2026-10-23：本次 HANDOFF-only 更新后重新执行 `git diff --check`、`npm run ci:local`（89 TSX 审计、476 样式规则、构建、Worker smoke、86/86 UI smoke）和 `npm run deploy:worker:test`（10/10），全部通过。
- 2026-10-23：提交 `02dbb1a` 已推送；Actions run `39856158838`（#57）达到 `completed/success`。后续 HANDOFF 更新必须继续先记录、再提交、再推送并追踪新 HEAD。
- 2026-10-23：提交 `b6ad802` 已推送；Actions run `39877275016`（#58）达到 `completed/success`。
- 2026-10-23：完成视觉验收登记的窄屏布局子步骤：发现并修复 390px 设置页 462px 溢出，新增布局边界回归；CI 同款容器重建设置页 6 张、移动设置预览和登录页截图；`ci:local` 87/87、`npm run deploy:worker:test` 10/10 通过。下一步为图标/文字对齐、重复入口/空卡片和中英文文案审计。
- 2026-10-23：`e349e7b`（`fix(ui): 修复设置页窄屏布局并更新视觉基线`）已推送；Actions run `39880735501`（#61）达到 `completed/success`。
- 2026-10-23：当前工作区完成 Cloudflare Token 六项权限、Token 名称与 Account/Zone resources 指引、保存域名后缀时自动同步 Zone/DNS/Worker Route；删除帮助中心“配置 Cloudflare 不需要 OAuth 客户端”这类反向文案，改为直接说明操作步骤。`ci:local` 87/87、Docker runtime 20/20 文件 91/91 测试、`deploy:worker:test` 10/10、`worker:typecheck` 和 `build` 均通过，待提交推送。
- 2026-10-23：功能提交 `9d2f38d` 已推送；Actions #66（run `39890875239`）`completed/success`。本次 HANDOFF 更新需另行提交并追踪其 Actions。
- 2026-10-23：权限面板改为监控/域名两组并标注只读、写入、编辑；不再显示无法由 Cloudflare API 回读确认的逐项“缺失”状态；账号、订阅、Zone、DNS、Worker Route 的 403 错误分别指出对应权限。完整 `ci:local` 87/87、设置页 Axe 2/2、权限定向 Docker runtime 16/16 通过；`8ec7590`、`269befa` 已推送，Actions #68/#69 成功。
- 2026-10-23：确认剩余工作顺序：视觉/文案人工验收 → 原生手动构建与真正 SHARED target → 帮助中心原生教程 → Workers Builds/D1/真实服务联调 → 全量验收 → 新提交的 push/Actions 闭环。
- 2026-10-23：提交 `beb8668`（`fix(cloudflare): 按三列展示 Token 权限`）已推送。Cloudflare 权限面板现在按“范围 / Scope、权限组 / Permission、级别 / Level”三列显示；权限组为中文 + Cloudflare 英文原名，范围明确为账户、区域、用户，用户范围仅说明不使用；README、帮助中心、方案和验收矩阵同步为三列填写方式。`git diff --check`、`npm run build`、`npm run ui:conventions`、`npm run ui:css-audit`、`npm run ci:local`（Worker smoke、UI 88/88）和 Docker runtime（20 个文件、93 个测试）通过。Actions #81 / run `39920624930` 已 `completed/success`。
- 2026-10-23：提交 `b9eb2b8`（`docs: 登记主站路由修复待验收状态`）记录 U29 工作区范围。随后验证 `npm run worker:typecheck`、`npm run build`、`npm run worker:smoke`、setup 定向 2/2 和 Docker Worker runtime 20/20 文件、93/93 测试通过；U29 代码/文档仍待单独提交、推送和最新 Actions 验收。
