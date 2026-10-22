# Plugmesh 平台交接（HANDOFF）

> 最后更新：2026-10-23 01:39（Asia/Shanghai）
> 状态：**进行中，未完成**
> 维护规则：每完成一个可验证步骤，先更新本文件，再提交一条可追溯的中文 Git 记录；未记录不得继续下一步。
> 本文件是后续上下文的优先事实来源。若 README、验收矩阵、旧注释或聊天摘要与本文冲突，以用户最新要求和实际代码为准；旧文档需在实现完成后同步重写，不能把旧 OAuth 行为当成目标。

## 压缩恢复速查

恢复工作先执行：

```bash
cd /home/tc/work/plugin-platform
git status --short
git log -1 --oneline --decorate
git rev-parse HEAD origin/main
git diff
```

当前权威快照（2026-10-23 01:39）：

- 仓库：`/home/tc/work/plugin-platform`
- 分支：`main`
- HEAD：`0325530 docs: 整理 Cloudflare Token 迁移交接事实`
- `origin/main` 与本机 HEAD 一致；push 使用 `git@github-plugin-platform:shelter-red/plugin-platform.git`，fetch 使用 `https://github.com/shelter-red/plugin-platform.git`。
- `0325530` 已推送，Actions“平台验收”run `39823921091`（run #37）已为 `completed/success`；同一 SHA 的并发 run `39823919519`（#36）被取消，属于重复触发，不是失败。上一提交 `70f62e3` 的 run `39822695994`（#35）和 `abf05ca` 的 run `39820685855`（#34）也成功。恢复后仍需在每次推送时重复“本地验证 → 推送 → Actions 闭环”，不能沿用历史成功。
- 当前工作区只保留以下 5 个未提交文件，均与尚未完成的 Cloudflare 额度/旧 OAuth 文案有关：
  ```text
  M src/features/overview/UsageResourcesPanel.tsx
  M src/features/usage/PlatformUsageSection.tsx
  M src/locales/en.ts
  M src/locales/zh-CN.ts
  M tests/console-worker.spec.ts
  ```
  这些改动包含有用的 8 项额度展示和“平台请求不限”方向，但仍依赖旧的 `settings.cloudflareQuotas`、`authorizationExpired` 和 OAuth 接口，**不能原样提交**；应在 Token + subscriptions 实现时整合、改写或删除。
- 侧栏、账号、工作区组件拆分已经提交为 `abf05ca`；`HANDOFF.md` 本次整理是独立文档步骤。不要再重复拆分登录页/侧栏/账号/工作区。
- Cloudflare Token 迁移目前只完成了代码审计、官方权限核对和验收契约，**尚未创建 `worker/src/cloudflare-token.ts`，后端仍完全是 OAuth**。不要根据“已有 Token 字段”误判迁移已开始或已完成。
- **严禁用 `git reset --hard`、`git clean`、`git checkout -- .` 或任何批量覆盖操作处理这 5 个文件。**

下一步（按顺序）：

1. 继续核对 Cloudflare 官方文档中的 subscriptions 精确响应结构、Free 套餐识别字段，以及 Billing Read 与该端点的实际关系；不确定的结果不得写成代码常量或测试 mock。官方权限页已确认三项固定权限真实存在，但订阅响应仍待核对。
2. 新建 `worker/src/cloudflare-token.ts`：Token verify、accounts 完整分页、指定账号校验、subscriptions 读取、Free 判定、新凭据加密类型、旧 OAuth 密文识别、稳定错误类型。
3. 重写 `cloudflareSettingsApi` / `cloudflareUsageApi`：保存前验证，未配置立即短路，先凭据后缓存，DELETE 不 revoke；删除 Cloudflare auth routes、auth-result API/Cookie、refresh/revoke。
4. 把 `oauth-settings.ts` 收缩到只服务 GitHub；从 `PlatformSettings` / `platformSettingsApi` / `usage.ts` 删除可编辑 `cloudflareQuotas`。
5. 先重写 Worker runtime tests、outbound stub 和 smoke，再改前端 Token 表单、usage limits 与 8 项次数/百分比。
6. 清理重复刷新入口、异常文案、重复跳转、图标对齐，并做双主题 × 桌面/平板/手机实际检查。
7. 核验 Workers Builds 实际 Deploy command 和 migration，关闭 D1 `no such table: workspaces` 风险。
8. 新增仅手动触发的原生可执行文件/共享库构建 workflow，并在中英文帮助中心补使用教程。
9. 完整本地 CI、中文提交、推送、Actions 闭环；失败必须读取日志/失败产物并修到最新 run 成功。

## 最近动作

- 2026-10-23：核对分支、远端、工作区和 Actions；确认 `0325530` 已推送，平台验收 run `39823921091` 成功，同 SHA 的并发 run `39823919519` 已取消（重复触发）。
- 2026-10-23：核对 Cloudflare 官方 API Token 权限文档，确认 `Account Settings Read`、`Account Analytics Read`、`Billing Read` 三项权限真实存在，并记录文档地址、日期和 Billing Read 的说明；subscriptions 响应结构尚未确认，禁止猜测。
- 2026-10-23：完成 Cloudflare OAuth→API Token 迁移的代码级审计，并把后端事实、固定接口契约、测试替换范围和实施顺序补入本 HANDOFF。本次是文档整理提交，不夹带 5 个未提交草稿文件。
- 2026-10-23：确认 `abf05ca` 已推送且平台验收 run `39820685855` 成功。
- 2026-10-23：当前 HEAD 完整 `npm run ci:local` 通过：UI 约定、CSS 审计、Worker 类型检查、管理端构建、Worker smoke 全部通过，Playwright 81/81 passed。
- 2026-10-23：建立并持续整理本 HANDOFF，把用户从组件化、登录错误、setup、D1、Cloudflare OAuth/Token、额度监控、UI 文案到原生构建/帮助中心的全部反馈固化为用户问题总账和最终验收口径。
- 2026-10-23：`1e5fec7 docs: 记录平台迁移与组件化交接清单` 已推送，Actions run `39816813766` 成功；`4cc1b72 docs: 整理会话遗留问题与验收总账` 已推送，run `39817786882` 成功；`e4b8179 docs: 更新交接验收状态与 Actions 轮询说明` 已推送，run `39818997739` 成功。
- 2026-10-23：组件化收尾验证通过：`npm run ui:conventions`、`npm run ui:css-audit`、`npm run build`，以及账号页/工作区页两项 Playwright 用例（2 passed）。随后提交并推送 `abf05ca`，未夹带额度/OAuth 残留改动。
- 用户指出的 `1e4fd10`、`fd80fa4` 是更早的失败提交，保留为“推送后必须查 Actions”的反例；历史成功不能替代后续每次推送后的检查。

## 0. 先读这里：工作区与 Git 状态

- 精确 HEAD 不要抄本文档，执行 `git log -1 --oneline`；本文档自身提交可能晚于最近的功能提交。
- 当前环境没有 `gh`。使用 GitHub API 查询 run；需要日志时安装/配置 GitHub CLI 或使用已认证 GitHub API。
- 未认证 GitHub REST API 限额为每小时 60 次；曾因 15 秒高频轮询触发 403。轮询间隔至少 1 分钟，优先在预计完成后查询；额度耗尽时等 `X-RateLimit-Reset`，不要把 403 误判为 Actions 失败。
- 查询示例：
  ```bash
  curl -fsSL 'https://api.github.com/repos/shelter-red/plugin-platform/actions/runs?per_page=5' |
    node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{for(const r of JSON.parse(s).workflow_runs)console.log(r.head_sha.slice(0,7),r.status,r.conclusion??'-',r.id,r.display_title)})"
  ```
- 工作区存在未提交额度改动时，修改前先看 `git status` 和 `git diff`；不要用批量回滚命令掩盖或丢弃已有工作。

### 0.0 当前未提交改动的审查结论

- `UsageResourcesPanel` / `PlatformUsageSection` 已把平台请求改为“不限”，并补上 KV 删除/列举方向；这是最终需求的一部分。
- `src/locales/*` 仍混有 `authorizationExpired`、`reauthorize` 等应删除的 OAuth 文案；不能原样提交为最终 Token 实现。
- `tests/console-worker.spec.ts` 新增了 8 项额度与百分比断言，但仍基于旧 `cloudflareQuotas`、旧 OAuth mock 和 `authorizationExpired`；必须随 Token/usage 响应重写。
- 处理原则：保留其中有用的 UI 意图，不等同于保留旧接口假设；最终以本文件第 1 节验收口径为准。

## 0.1 用户问题总账（按会话反馈整理）

状态图例：✅ 已实现并有验证证据；🟡 局部完成/待提交验证；⬜ 尚未开始或最终验收未通过。

| ID | 用户反馈或目标 | 必须达到的效果 | 当前状态 |
| --- | --- | --- | --- |
| U01 | “不是说全部重构成组件吗？登录页还是旧的” | 登录页及全站页面有清晰组件边界；登录页不重复重写；实际看视觉结果 | 🟡 登录页、侧栏、账号、工作区已完成组件拆分，构建与相关交互测试通过；多主题/多视口视觉检查仍未完成。 |
| U02 | 自行从会话历史读分支、提交、推送 | 每步有中文 Git 记录；不靠聊天上下文猜分支 | 🟡 `main` 已跟踪远端，`0325530` 已推送；后续每个代码步骤继续先更新本文件再提交。 |
| U03 | 推送时 Actions 老是失败 | 推送前跑完整本地 CI；推送后查 run；失败读日志/失败产物并修到成功 | 🟡 `0325530` run `39823921091`、`70f62e3` run `39822695994` 与 `abf05ca` run `39820685855` 均成功；`1e4fd10`、`fd80fa4` 是已知失败反例，后续每次推送仍须闭环，失败产物上传要求必须保留。 |
| U04 | 错误状态为什么是 `/?auth_error=` | 授权/配置错误使用真实 HTTP status + JSON；不靠 URL 查询参数；不跳首页 | 🟡 GitHub 登录错误路径已改为 HTTP 错误页；Cloudflare 设置/授权仍存在旧 OAuth 跳转，Token 迁移后必须全部改为当前设置面板展示。 |
| U05 | setup 失效为何单独返回 “Setup is not available” | `setupApi` 返回 `null` 时与其他非路由请求一致，不发明特殊响应 | ✅ 已按普通非路由路径处理；保留回归测试，Cloudflare 改造不能破坏。 |
| U06 | `D1_ERROR: no such table: workspaces` | 生产部署必须先应用 `0008_workspaces.sql` 及全部 migrations；pending migration 时构建失败 | 🟡 `scripts/deploy-worker.sh` 已包含 migration 检查；仍需核对 Workers Builds 实际 Deploy command 和生产接口，不能只修脚本。 |
| U07 | `invalid_scope`，不允许 `workers-platform.read` | 删除 OAuth scope 流程，使用长期 API Token；Token 权限固定为 Account Settings Read / Account Analytics Read / Billing Read | 🟡 官方权限页已确认三项固定权限真实存在；代码仍是 OAuth exchange/refresh/revoke，这是当前最高优先级后端迁移。 |
| U08 | Cloudflare 授权失败后为什么跳首页 | 错误留在系统设置页，显示 HTTP 状态、稳定错误码和可操作说明 | ⬜ 旧 `/auth/cloudflare/*`、Cookie auth-result、跳转逻辑尚未删除。 |
| U09 | 用户创建 OAuth 不知道给什么权限；取消勾选权限就没了 | 权限不可编辑、固定只读展示；用户不需要猜 scope；创建链接直接去 Token 页面 | ⬜ 目标已明确，但最终实现尚未落地。Token 页面：`https://dash.cloudflare.com/profile/api-tokens`。 |
| U10 | “未识别唯一账号”也是权限问题 | verify → accounts → subscriptions 全链路校验；账号不唯一/不可见返回 409 `account_missing`/`account_ambiguous`，不猜第一个账号 | ⬜ 新 Token 设置 API 中实现并测试。 |
| U11 | 用量和配额为什么没有刷新按钮 | 用量页保留一个清晰的手动刷新入口；刷新不被自动加载禁用；按钮状态可观察 | ⬜ 当前存在多处刷新/重复入口，尚未完成最终清理。 |
| U12 | OAuth 里没有 `offline_access` | 彻底移除 `offline_access`、OAuth refresh 和“过期/重新授权”文案 | ⬜ Token 迁移时删除。 |
| U13 | `configured:false` 为什么还能查 `/api/usage/local`，且返回 200 | 分清接口语义：未配置 Cloudflare 时 `/api/usage/cloudflare` 立即 `{"configured":false,"cached":false}`，不读缓存、不发外部请求；本地统计 `/api/usage/local?range=7d` 仍应 200 | 🟡 目标已写入验收；Cloudflare 缓存顺序和未配置短路仍需代码及测试修复。 |
| U14 | `response_type` 等字段放错位置；CF OAuth 没有 PKCE 选项 | 旧 OAuth UI 中 `response_type` 若短暂保留也只能属于 OAuth 配置、值为 `code`；最终 Token 方案应直接移除 response_type/grant_type/PKCE 等全部客户端字段 | ⬜ 最终以“所有 OAuth 客户端字段消失”为验收，避免继续维护错误表单。 |
| U15 | `1e4fd10`、`fd80fa4` 两个提交 Actions 失败 | 每次失败修复后本地 CI、推送、Actions、失败产物全部闭环 | 🟡 `0325530` 的 run `39823921091` 已成功；后续每次推送仍须重复当前提交验收，并保留失败产物上传。 |
| U16 | 图标没对齐；左上角“默认工作区”很矮挡住文字 | 统一图标尺寸、按钮高度、gap、行高和垂直居中；双主题/多视口实际检查 | 🟡 侧栏/工作区组件已随 `abf05ca` 提交；图标与“默认工作区”遮挡仍需实际视觉检查和修正。 |
| U17 | 配额少，D1 写入等所有有限制项目都要监控，显示次数和百分比 | Worker、D1 行读、D1 行写、KV 读/写/删/列表、DO 请求共 8 项；每项都有 used/limit/percentage | 🟡 部分静态基线/测试在未提交改动中出现；后台读取、响应 `limits`、8 项完整 UI 尚未完成。 |
| U18 | 平台和监控分开；平台请求不限，CF 免费额度有限 | 平台请求只统计不设上限、不画上限百分比；Cloudflare 官方额度独立分组 | 🟡 文案/展示有部分调整；数据模型和最终 UI 尚未统一。 |
| U19 | GitHub OAuth 没过期，为什么 CF OAuth 会过期；Token/API key 会不会过期；改成 Token | 不再暗示 OAuth 自然过期；改用 Cloudflare API Token（默认长期，可被撤销/策略限制）；界面、链接、错误文案同步改成 Token | 🟡 后端代码审计和固定契约已完成并写入本文件；前后端及文档全链路迁移尚未开始。 |
| U20 | CF 免费额度为什么能在系统设置配置；应该从 CF 读取 | 删除 `cloudflareQuotas` 手填；调用 `GET /accounts/{account_id}/subscriptions`；只有明确 Free 才展示官方基线，否则“未读取” | ⬜ 当前仍存在设置字段、默认配额、旧测试和 UI；需整体删除。 |
| U21 | 界面文案诡异、莫名卡片、同页多个按钮跳同一页面 | 通读中英文文案；清理重复说明、技术黑话、无信息量卡片和重复跳转；每个页面只保留必要主入口 | ⬜ 已知用量页至少三个刷新入口、概览卡片重复跳 `/usage`；尚需全站审计。 |
| U22 | Actions 增加手动构建插件服务器：可选可执行文件/库文件、目标平台 | 新增仅 `workflow_dispatch` 的 workflow；构建真正共享库及可执行程序；目标平台/架构明确；artifact、SHA256、依赖说明完整；不与 tag release 冲突 | ⬜ 尚未新增。 |
| U23 | 帮助中心说明二进制插件服务器/库文件怎么用 | 中英文帮助中心覆盖下载、SHA256、启动/注册、环境变量、插件目录/主机、库链接、OpenSSL 运行依赖、常见错误 | ⬜ 尚未新增；现有帮助仍偏旧 OAuth FAQ。 |

### 0.2 当前不能误判为“已完成”的事项

- 登录页“看起来旧”不代表组件化失败；先把组件结构、视觉和实际交互一起验收。
- Cloudflare 代码能保存字段不等于 Token 迁移完成；只要还存在 OAuth client、scope、auth-result Cookie、refresh/revoke 或 `/auth/cloudflare/*`，就按未完成处理。
- 静态免费额度常量不等于从 Cloudflare 读取；只有 subscriptions 明确确认 Free 套餐后才有资格展示官方基线。
- `/api/usage/local` 返回 200 是预期行为，不代表 Cloudflare 未配置也能查询云端数据；两个接口必须分开验证。
- 历史 Actions 成功不代表后续安全；每次推送后以最新 run 的状态和日志为准。

### 0.3 代码级审计事实（2026-10-23）

以下内容是恢复后可直接定位的当前事实，不是建议：

- `worker/src/cloudflare-oauth.ts` 仍导出并使用 `exchangeCloudflareCode`、`refreshCloudflareCredential`、`discoverCloudflareAccountId`、`revokeCloudflareToken`、`readCloudflareCredential`。凭据结构仍是 `accessToken/refreshToken/tokenType/accountId/expiresAt`。
- `discoverCloudflareAccountId` 当前只请求 `GET /client/v4/accounts?per_page=2`，没有分页遍历；即使继续临时使用 OAuth，也不能据此判断账号唯一性。
- `worker/src/cloudflare-auth-result.ts` 当前通过一次性 Cookie `plugmesh_cf_auth` 传递授权成功/失败结果；Token 方案落地时必须整体删除，而不是改名继续用。
- `worker/src/oauth-settings.ts` 当前混合 GitHub 与 Cloudflare OAuth，仍公开 `clientId`、`redirectUri`、`scope`、`scopeNames`、`responseType`、`grantType`、`tokenAuthMethod`；最终文件只能保留 GitHub 配置。
- `worker/src/index.ts` 当前仍注册 `/auth/cloudflare/start`、`/auth/cloudflare/callback` 和 `/api/settings/cloudflare/auth-result`，并在 scheduled maintenance 中清理 `cloudflare_oauth_states`。
- `worker/src/index.ts` 的 `cloudflareSettingsApi` 当前 PUT 只做字段解析和加密保存，不 verify Token、不列出账号、不读 subscriptions；DELETE 还会调用 `revokeCloudflareToken`。这两个行为都必须改掉。
- `worker/src/index.ts` 的 `cloudflareUsageApi` 当前先读 `usage_cache`，再读凭据，违反未配置短路；仍有 401 后 refresh、`authorizationExpired` 和 OAuth 错误语义。
- `worker/src/index.ts` 的 `platformSettingsApi` 当前接受并持久化 `cloudflareQuotas`；`worker/src/types.ts` 的 `PlatformSettings`、`worker/src/usage.ts` 的 `defaultPlatformSettings` 也仍包含它。
- `worker/src/usage.ts` 的 `defaultCloudflareQuotas` 内容与 8 项官方基线一致，但目前被当成用户可编辑设置和默认平台设置使用。最终它只能作为“subscriptions 已明确确认 Free”后的只读官方基线。
- 当前 `package.json` 仍有 `worker:cloudflare-oauth-smoke`、`worker:cloudflare-oauth-route-smoke`，并包含在 `worker:smoke` 中；Token 改造时要替换，不能只让旧测试暂时绕过。
- 当前 `.github/workflows/` 只有 `platform-ci.yml` 和 `release.yml`；尚无仅 `workflow_dispatch` 的原生“可执行文件/共享库”构建 workflow。
- 当前 `native-server/CMakeLists.txt` 的 `plugmesh_core` 是 `STATIC`，只有 `add_executable(plugmesh-server ...)`；真正的共享库 target 和构建开关尚未实现，不能把静态库改扩展名冒充共享库。

### 0.3.1 Cloudflare 官方文档核对记录（2026-10-23）

- 官方 API Token 权限列表：https://developers.cloudflare.com/fundamentals/api/reference/permissions/
- 该页确认 `Account Settings Read`、`Account Analytics Read`、`Billing Read` 都是真实权限，不再使用不存在的 `workers-platform.read`、`offline_access`。
- 该页对 `Billing Read` 的说明是：可读取 billing profile、subscriptions，并可访问 invoices/entitlements；这支持用它读取订阅，但实际账号响应和错误边界仍需按下面的官方端点文档核对。
- 账号订阅端点文档：https://developers.cloudflare.com/api/resources/accounts/subresources/subscriptions/
- 该页的 Markdown 版本：https://developers.cloudflare.com/api/resources/accounts/subresources/subscriptions/index.md
- 曾尝试 `https://api.cloudflare.com/client/v4/openapi.json`，返回 HTTP 400；**不能**把该地址当作官方 schema 依据。
- 尚未确认 subscriptions 的精确响应结构、Free 套餐识别字段和真实 `Billing Read` 响应；在确认前只能写“未读取”，不能猜 `plan.id === 'free'` 或伪造 mock。

### 0.4 后续不得偏离的硬约束

- 不能“把 OAuth 字段换个名字”继续保留 OAuth；目标是从路由、Cookie、配置、刷新、撤销、文案到测试全部移除 Cloudflare OAuth。
- 不能保存明文 Token；GET 设置接口永远不能回显 Token。旧 OAuth 密文只能被识别为旧格式并提示重新录入 API Token，不能 refresh、revoke 或继续查询。
- 不能因为 Billing Read 读取 subscriptions 出现权限问题就删掉该固定权限；应先核对 Cloudflare 官方文档和真实响应，把 401/403/404/其他错误准确映射给用户。
- 不能在未确认 Free 套餐时展示 8 项固定上限；无法读取/确认时 `limits` 必须为 `null`，UI 显示“未读取”。
- 不能把平台请求套上 Cloudflare Worker 请求上限；平台统计只计数、不拦截，Cloudflare 官方额度独立分组。
- 不能恢复 `/?auth_error=`、Cloudflare auth-result Cookie、跳首页或 “Setup is not available” 等特例。
- 不能用牺牲测试覆盖、删除断言、只改文案或手写 mock 的方式制造绿色；每个稳定错误码和未配置短路都要有真实请求边界测试。
- 不要批量回滚当前 5 个未提交草稿；它们包含 8 项额度展示和平台请求“不限”的有用 UI 意图，应在 Token/limits 数据模型落地时改写整合。

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

#### 1.1.1 建议固定 API 契约（实现时以此收敛前后端）

设置接口 `GET/PUT/DELETE /api/settings/cloudflare`：

```ts
// GET
{
  configured: boolean
  credentialKind: 'api_token' | 'legacy_oauth' | null
  accountIdConfigured: boolean
  accountId: string | null // 只返回掩码，例如 abcd...wxyz
  permissions: string[] // 固定三项只读展示，不接受前端修改
  updatedAt: string | null
  lastVerifiedAt: string | null
  legacyCredential: boolean
}

// PUT
{ apiToken: string; accountId?: string }
```

- `PUT` 的 `apiToken` 不得为空；编辑时若产品允许不重新输入 Token，必须明确使用已保存密文并重新 verify，不能跳过校验。
- `PUT` 只有 `verify → accounts 全分页 → account 唯一性/指定账号匹配 → subscriptions` 全部成功后才落库。失败响应至少包含真实 HTTP status、稳定 `code`、可展示 `message`，字段错误可附 `field`。
- `DELETE` 只删除 `cloudflare_credentials`，同时删除 `usage_cache` 中该账号/全局 Cloudflare key；不调用任何 Cloudflare 外部接口。
- `GET` 解密旧 OAuth 结构时返回 `configured:false`、`legacyCredential:true` 或等价明确状态，不得回显旧 access/refresh token。
- 任何 Cloudflare 设置错误都留在系统设置页当前面板显示；不得 302、不得写 `auth_error` 查询参数、不得用 Cookie 传结果。

稳定错误映射：

| HTTP | code | 场景 |
| --- | --- | --- |
| 400 | `token_required` | 首次保存缺少 Token，或请求体不合法 |
| 401 | `token_invalid` | `/user/tokens/verify` 返回未验证/无效 Token |
| 403 | `token_permission_denied` | verify 通过，但 accounts 或 subscriptions 因固定权限不足而拒绝 |
| 409 | `account_missing` | 无可见账号、指定 Account ID 不可见/不存在 |
| 409 | `account_ambiguous` | 未填写 Account ID 且完整分页后发现多个可见账号 |
| 502 | `cloudflare_upstream_error` | Cloudflare 5xx、网络失败或响应结构无法解析 |
| 503 | `secret_missing` | `SESSION_SECRET` 缺失，无法安全存取 Token |

实现订阅读取前，必须先确认官方文档中的响应字段和 Free 识别方式，并把“已核对的文档/日期”写进代码注释或本文件；不得根据测试猜测 `plan.id === 'free'`。

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
- 侧栏/账号/工作区已在 `abf05ca` 完成进一步拆分并提交；“默认工作区”高度、文字遮挡和全站图标对齐仍需实际视觉验收。
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
  1. `refactor(ui): 完成登录、侧栏、账号与工作区组件化`（已实现，登录页仅剩视觉检查）
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
