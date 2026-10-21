# Plugmesh MVP 验收矩阵

更新日期：2026-10-21

## 状态定义

- `本地已验证`：实现存在，并由当前仓库中的构建、CTest、Playwright 或 smoke 覆盖。
- `模块已验证`：核心逻辑由 mock 或模块测试覆盖，但没有连接真实外部服务。
- `已实现未联调`：代码和配置入口存在，当前环境没有真实凭据或云资源可验证。
- `部分实现`：主流程存在，但原验收条件仍有缺口。
- `未验证`：当前环境不能给出该平台或生产条件下的结论。

## Worker 与 Cloudflare

| 验收项 | 状态 | 证据与边界 |
| --- | --- | --- |
| GitHub OAuth 登录、邀请过期、身份匹配、并发领取和权限隔离 | 部分/模块已验证 | `github-auth`、`github-oauth`、`invite-claim`、`api-permission` smoke；`worker:runtime-test` 用真实 D1 直接验证 `exchangeGithubCode`（只保留已验证邮箱、主邮箱优先、令牌/用户/邮箱异常与未配置返回 null）、`claimInvite`（邮箱和 GitHub 登录名大小写不敏感匹配、过期/已撤销/未知令牌拒绝、领取后 `used` 且不可重复使用）与 `upsertGithubUser`（按 `github_id` 去重并更新资料和角色）。`worker:runtime-test` 的 `oauth-route.test.ts` 还在 workerd 中经 `SELF.fetch` 走完 `/auth/github/start` 与 `/auth/github/callback`：state 哈希与邀请令牌哈希落库、授权跳转携带 `client_id`/`redirect_uri`/`scope`；回调经 `outboundService` 桩（模拟 `github.com` 与 `api.github.com`）换取令牌与身份后领取邀请并签发 `HttpOnly` 会话 Cookie；`state` 二次使用返回「OAuth 状态已过期」，未被邀请身份返回「该 GitHub 身份未被邀请」且不创建用户，白名单身份直接成为 `super_admin`。真实 GitHub OAuth App 仍未连接。 |
| Cloudflare OAuth 回调、管理员权限、state、凭据加密、刷新和撤销 | 部分/模块已验证 | `cloudflare-oauth` 与 `cloudflare-oauth-route` smoke 覆盖回调、state 校验和路由；`worker:runtime-test` 用真实 D1 验证 `/api/settings/cloudflare`：access token 与 account ID 加密落库且密文不含明文、读取只返回脱敏账号 `0123...cdef` 不回显 token、成员 403、缺少 token 400、删除后 `configured=false`，审计动作 `cloudflare.credentials.updated`/`revoked` 不含 token。`worker:runtime-test` 的 `cloudflare-oauth.test.ts` 另经 `outboundService` 桩（`dash.cloudflare.com/oauth2/token`、`api.cloudflare.com/client/v4/accounts`）在 workerd 中走完 `/auth/cloudflare/start` 与回调：授权跳转携带 `client_id`/`redirect_uri`/`scope`、state 哈希落库并一次性消费、授权码换取令牌后自动发现唯一账号、凭据加密落库且密文不含 access token、审计 `cloudflare.oauth.connected`，重放同一 state 返回「状态已过期或已使用」。同一文件验证令牌刷新：临近过期时先刷新再查询用量、Analytics 返回 401 时刷新并重试一次、刷新失败返回 502 且不改动已存凭据；刷新成功后新的 access token、refresh token 与 `expiresAt` 落库并记录 `cloudflare.oauth.refreshed`。仍未连接真实 Cloudflare OAuth client，也未对真实账号发起查询。 |
| 通配 Host 路由、管理 API 优先级、未知域名和离线维护页 | 本地已验证 | `public-route`、`public-proxy` smoke，覆盖插件 Host、未知域名、API 路径和桥接离线响应。另以真实 `wrangler dev` + 本地 C++ 服务器 + 示例插件联调：`Host: e2e.plugins.example.com` 的 `GET /`、带 query 的 GET 和 POST 均转达插件并返回 200，未知插件 Host 返回 404 `Plugin domain not found`，控制台 Host 仍返回 SPA HTML。联调首次暴露静态资源层会截获插件域名根路径，现由 `[assets] run_worker_first = true` 保证请求先经 Worker 路由；仍是本地 miniflare/workerd，不是已部署 Cloudflare。 |
| 一次性注册码原子消费 | 本地已验证 | `worker:runtime-test` 对真实 D1 并发三次提交同一注册码，仅一次 201、两次 401，并核对服务端只新增一条记录；`registration-race` smoke 覆盖并发消费逻辑。 |
| 控制连接注册、心跳、断线、重连和旧断线竞态 | 本地已验证 | `worker:runtime-test` 通过 workerd 中的真实 Durable Object 验证心跳置为在线、控制连接断开后插件转 `server_offline`、域名转 `offline` 且公开入口返回维护页；`durable-object-lifecycle` smoke 覆盖 manifest 注册与断线/重连交错；C++ `control-client` smoke 覆盖连接重试。本地真实栈重启验证：停止 `plugmesh-server` 后公开入口立即返回 503 维护页、服务器转 `offline`，重新启动后自动重连、插件恢复 `enabled`、域名恢复 `online` 且请求返回 200（步骤见 `docs/local-e2e.md`）。真实多地域网络未验证。 |
| 密钥轮换和绑定撤销 | 本地已验证 | `worker:runtime-test` 在 workerd 的真实 Durable Object 上执行 `server.rotate`/`server.revoke`：新 token 哈希落库、旧 token 被 401 拒绝、新 token 可重连、撤销后插件转 `server_offline`、域名转 `offline`、连接以 1000 关闭；轮换与撤销成功后均写入 `audit_log`（`server.rotated`/`server.revoked`，详情仅含 `serverId`、不含令牌）；`server-binding` smoke 另外覆盖重复撤销与撤销后轮换被拒。C++ 侧持久化和本地 UI 操作已有覆盖，本地真实栈端到端轮换与撤销见 `docs/local-e2e.md`。 |
| Durable Object 请求映射和并发隔离 | 本地已验证 | `worker:runtime-test` 在 workerd 中为同一服务器建立真实控制连接，并发 16 个公开 HTTP 请求并乱序回帧，验证响应按 `requestId` 一一对应；同时建立两条公开 WebSocket，验证 `connectionId` 隔离。多 isolate 的缓存侧行为由 `npm run stack:multi-isolate` 在两个共享同一 D1 的 `wrangler dev` 实例上验证（见「D1/KV 路由缓存读穿和配置写穿」行）。当前 Durable Object 用 `server.accept()` 持有连接、不使用 Hibernation API：连接存续期间 DO 常驻内存，因此不存在「休眠后恢复 WebSocket」路径；若 DO 被回收或进程重启，连接断开后由 C++ 控制客户端自动重连并重新注册，但本机无法制造 DO 进程级重启，该场景仍未实测。 |
| HTTP 方法、状态、响应头、Cookie 和二进制请求/响应 | 本地已验证 | `public-proxy`、`response-validation`、C++ `control-client` smoke；`worker:runtime-test` 在真实 Durable Object 链路上验证 POST 方法、查询串、自定义请求头与 `cookie` 原样转发，7 字节二进制请求体逐字节一致，插件返回 206、`content-type`、单个 `set-cookie` 与 4 字节二进制响应也逐字节透传。协议头是字符串映射，插件无法一次返回多个同名 `Set-Cookie`。`npm run stack:browser` 已在真实 Chromium 中验证单条 `Set-Cookie`：浏览器保存 `plugmesh_e2e=1` 并在后续请求中回传，插件经 `/headers` 回显的请求头 JSON 含该 cookie。 |
| SSE、公开 WebSocket 和文件流桥接 | 本地已验证 | 真实 `wrangler dev` + C++ 服务器联调中，`accept: text/event-stream` 请求收到 `data: sample-plugin`；公开 WebSocket 经 Worker→Durable Object→C++→插件回显 `hello-ws`；`x-plugmesh-file-stream: true` 返回 18 字节 `sample-file-stream`，结束后 `r2Objects`/`r2Bytes` 归零（步骤见 `docs/local-e2e.md`）。 这些结果现已由 `npm run stack:streams`（`tests/streams-stack.spec.ts`）自动断言：每次新建服务器与唯一域名，校验 SSE 的 `content-type` 与首帧 `data: sample-plugin`、WebSocket 回显 `hello-ws`、18 字节 `/file` 返回 `sample-file-stream` 与 `application/octet-stream`（低于 1 MiB 阈值，走内存缓冲、不产生 R2 对象），以及 8 MiB `/large` 大文件在暂停读取时 `r2Objects=1`、`r2Bytes ≥ 8388608`（确由 R2 定长流中转）、读完后对象与字节数归零且内容逐字节匹配，访问日志记录 `/file` 与 `/large` 200；另由 `npm run stack:browser`（`tests/browser-stack.spec.ts`）用真实 Chromium 经插件域名验证浏览器侧链路：首页 200 与正文 `ok`、页面内 `POST /echo` 方法未被改写、原生 `EventSource` 首帧 `sample-plugin`、原生 `WebSocket` 回显 `hello-ws`、`/file` 与 8 MiB `/large` 流式读取后逐字节一致、`Set-Cookie` 与 Cookie 双向透传，关闭后 `activeConnections`/`r2Objects`/`r2Bytes` 全部归零且访问日志记录三条 200；Worker 流式 smoke 与 C++ WebSocket 生命周期测试覆盖协议路径；`worker:runtime-test` 在 workerd 中验证 SSE 分块经真实 Durable Object 送达并在结束后释放活跃连接，1MB+ 文件在声明 `content-length` 时经真实 R2 定长流中转、缺少长度时回退一次性上传，且两种路径都会在读取后删除对象并归还用量。真实公网长连接未验证。 |
| 请求超时、帧大小、响应大小和活跃连接上限 | 本地已验证 | Durable Object 中有硬限制和超时；配额 smoke 覆盖计数边界。`worker:runtime-test` 在 workerd 中验证：超过 32 KiB 的公开请求体返回 413 并写入访问日志；64 个并发公开请求乱序回帧后各自拿到正确响应且活跃连接归零；活跃连接上限设为 2 时第三个公开 WebSocket 返回 503 并进入维护模式，关闭一个连接后额度释放且恢复维护开关后可重新连接；超过 16 MiB 的插件响应返回 502 `Plugin response is too large` 并释放缓冲；R2 配额为 0 时大文件流转返回 503 且删除已上传对象、用量归零；插件 25 秒不回帧时，普通 HTTP、SSE 与正在进行 R2 定长流的公开请求都在 25 秒后返回 504 `Plugin request timed out`，活跃连接、R2 对象与 `temp_objects` 全部归零，同一 Durable Object 随后仍能正常转发请求（该用例还暴露并修复了中止定长流时 `put` 与写入链路产生未处理拒绝的问题）。另用 `npm run stack:load`（`tests/load-stack.spec.ts`）在同一真实栈上施加 3 轮 × 300 请求、并发 100 的 HTTP 压力（900 次全部 200，延迟 p50 479 ms / p95 666 ms / max 729 ms）、40 条并发 SSE（全部收到首帧）和 40 条 WebSocket 驻留连接（逐条回显，关闭后 `activeConnections` 归零）；仍是单机 miniflare，未在已部署环境做数百并发的持续压力测试。 |
| R2 上传、一次性读取、过期和删除 | 本地已验证 | `blob-stream` 与 `durable-object-stream` smoke 覆盖流式消费、一次性读取和删除；`blob-expiry` smoke 覆盖过期对象清理、24 小时陈旧对象清理、重试三次、删除失败后回滚占用和用量释放。`worker:runtime-test` 用 workerd + 本地 R2 验证：`POST /api/blobs` 必须以 `content-length` 声明长度（缺失返回 411，超 50 MiB 返回 413），上传后返回 `/blobs/<token>`，首次 GET 返回原始内容并删除对象、清空 `temp_objects`、归还 `r2_bytes`/`r2_objects`，重复 GET 返回 410；R2 配额为 0 时上传返回 503 且不残留对象；Durable Object 的定长流与缺长度回退两条文件流路径也会在读取后清理。真实 R2 一致性与费用仍未验证。 |
| D1/KV 路由缓存读穿和配置写穿 | 部分实现 | Host 路由内存缓存和更新失效逻辑已接入；`route-cache` smoke 覆盖读穿、负缓存、主动失效、5 秒 TTL 和 256 条上限淘汰；`worker:runtime-test` 用真实 D1 验证 Host 路由解析与未启用插件的维护页，并验证缓存命中期间直接改 D1 域名状态仍按旧路由转发、插件停用命令成功后立即失效并返回 503 不可用页。`npm run stack:restart`（`tests/restart-stack.spec.ts`）在真实栈上先预热 isolate 缓存，再 `docker restart` 承载 `wrangler dev` 的容器：新 isolate 缓存为空时公开入口仍返回 200、真实服务器自动回到 `online`，验证了重启后的冷回源。`npm run stack:multi-isolate`（`tests/multi-isolate-stack.spec.ts`）用两个 `wrangler dev` 实例共享同一 D1 持久目录模拟两个 isolate：A 建立 404 负缓存后直接写 D1，A 在 5 秒内仍返回 404（缓存不跨 isolate 共享），B 首次请求立即回源得到 503，TTL 到期后 A 也收敛为 503。真实 Cloudflare 多地域缓存传播与 D1 跨地域读一致性仍未验证。按设计不引入 KV 业务缓存：KV 最小过期粒度为 60 秒且跨地域最终一致，域名撤销或转移后可能继续命中旧路由，当前用 5 秒 isolate 缓存加 D1 回源保证正确性。 |
| 总配额触发全局维护模式 | 本地已验证 | `worker:runtime-test` 在真实 D1 上把请求配额设为 1：首个公开请求经 Durable Object 正常返回 200，第二个请求因配额耗尽返回 503 维护页并把 `platform_settings` 的 `maintenance` 置为 true，写入 `maintenance.email.skipped` 审计（原因 `request quota reached`），后续请求直接走维护页；`worker:runtime-test` 另外用注入的 GraphQL 响应把 D1 查询配额设为 10，验证 Analytics 汇总达到阈值后进入维护模式并记录 `maintenance.email.skipped`（原因 `D1 query quota reached`）。另在真实栈（`npm run stack:maintenance`，`tests/maintenance-stack.spec.ts`，本地 `wrangler dev` + 真实 C++ 服务器 + 示例插件）把请求配额压到 1：下一次公开请求返回 503 维护页（`content-type: text/html`、`retry-after: 300`），新的公开 WebSocket 升级同样被拒为 503，已建立的长连接继续回显，维护中注册码发放、插件命令和域名分配均返回 503，`audit_log` 记录 `maintenance.email.skipped`（原因 `request quota reached`），解除维护后公开入口恢复 200、可重新建连且 `activeConnections` 归零。`npm run ui:real-stack` 第五条用例再从管理端 UI 走一遍开关：在「维护与配额」面板点击开关进入维护，断言 Toast「平台已进入维护模式」与面板徽标「维护中」，对一个从未分配过的插件域名请求返回 503 且页面为「平台维护中」，总览徽标同步显示「平台维护中」；再次点击恢复后同一域名回到 404 `Plugin domain not found`；随后把「请求数 / 24 小时」改为 `5,000,000` 并点「保存配额」，断言 Toast「平台配额已保存」、`/api/settings/platform` 回源该值、用量页平台请求计数卡显示「上限 5,000,000」，整页重载后配额表单仍为 `5000000`（证明写入 D1 而非仅内存），审计日志页出现「更新平台设置」记录，点「导出日志」下载的 CSV 带 UTF-8 BOM，且含原始事件 `platform.settings.updated` 与操作者 `E2E Admin`/`e2e@example.com`（用例在 `finally` 中把维护开关与配额复位）。真实 Cloudflare 账号的 Analytics 阈值触发与已部署环境仍未验证。 |
| SMTP 测试发送、维护通知、失败重试和审计 | 本地已验证 | `maintenance-email` smoke 注入发送器验证第三次成功、最终失败、审计和敏感字段不落日志。`worker:runtime-test` 用真实 D1 验证管理 API：SMTP 设置加密落库（密文不含密码与发件地址）、读取不回显密码、成员 403、非法端口 400、删除后 `configured=false`；测试发送经 `worker-mailer` 真实连接不可达服务器重试三次后返回 502 并写入脱敏 `smtp.test.failed` 审计；请求配额耗尽触发维护模式时向超级管理员发送通知，失败重试三次后记录 `maintenance.email.failed`；SMTP 不可达时创建邀请仍成功落库为 `pending`，响应 `emailSent=false`，`invite.email.failed` 重试三次且审计不含密码。`worker:runtime-test` 另外启动本地真实 SMTP 服务端（`smtp-server`，监听 `127.0.0.1`），`worker-mailer` 经真实 TCP/SMTP 会话完成 PLAIN 认证与投递；服务端用 `mailparser` 解析邮件并校验收件人、发件人与主题，不匹配时以 450 拒绝（已用错误主题反证接口返回 502）——覆盖测试邮件、邀请邮件（`emailSent=true`）和配额触发的维护通知（审计 `smtp.test.sent`/`maintenance.email.sent`），错误凭据三次失败后返回 502 且审计不含密码。`npm run ui:real-stack` 第七条用例在该栈上走管理端表单：填写 Host `127.0.0.1`、端口 `1`、用户名、密码、发件人后保存，断言 Toast「SMTP 配置已保存」、`/api/settings/smtp` 返回 `configured=true` 且不含 `password` 字段，整页重载后 Host/用户名从 D1 回填、密码框为空；对不可达端口点「发送测试邮件」后页面提示「测试邮件发送失败」，审计出现 `smtp.test.failed` 且详情不含明文密码；用例结束删除配置。公网 SMTP、STARTTLS/SMTPS、退信和外部联通仍未验证。 |
| Cloudflare Analytics/GraphQL 缓存、权限错误和过期 | 模块已验证 | `cloudflare-usage` smoke；`worker:runtime-test` 直接调用 `cloudflareUsageApi` 并注入 GraphQL fetch：合并 D1 读写、KV 按 actionType 分类和 Durable Object 请求/CPU/存储用量，首次调用只发起两条 GraphQL 查询，第二次命中 `usage_cache` 且 TTL 五分钟、不再发起外部请求；把缓存 `expires_at` 置为过去后再次调用会重新发起两条 GraphQL 查询、返回 `cached=false` 并刷新 `updated_at`/`expires_at`；HTTP 403 与 GraphQL errors 返回 502 且不写缓存；账号 ID 缺失时跳过查询；成员访问 403。`npm run ui:real-stack` 第六条用例在同一真实栈上验证管理端「用量与配额」页：真实 `POST /api/blobs` 使 `/api/usage/local` 请求计数 +1、`r2Objects=1`，页面「平台请求计数」显示该计数与「24 小时窗口」、R2 卡片显示「1 个对象」；读取一次性 blob 后 `r2Objects`/`r2Bytes` 归零，刷新为「0 个对象」。未配置 Cloudflare 凭据时「Worker 请求」显示 `—`、提示「官方数据尚未连接」、数据源行为「未配置」，不伪造官方数字；本地计数行显示真实 `updatedAt` 与窗口起点。真实 token 刷新与真实 Cloudflare 账号查询未验证。 |
| 30 天用量/访问日志和 180 天审计清理 | 本地已验证 | `scheduled-maintenance` smoke 覆盖保留时间边界；`worker:runtime-test` 在 workerd 中直接调用 scheduled 维护函数，用真实 D1 与本地 R2 验证：31 天前的访问日志、181 天前的审计删除而保留期内数据保留，过期邀请转 `expired`、过期会话 / OAuth state / Cloudflare OAuth state / 注册码删除，过期与 24 小时前已消费的临时对象连同 R2 对象删除并归还 `r2_bytes`/`r2_objects`，30 天前的用量快照清理并写入新快照。真实 Cron 触发时刻未验证。 |
| Wrangler bundle 和资源绑定 | 本地已验证 | `wrangler deploy --dry-run` 通过；`wrangler-config` smoke 断言 `[assets]` 的 `directory`、`binding`、`not_found_handling` 和 `run_worker_first = true`，防止插件域名根路径被静态资源层截获。D1 ID 仍为占位符，没有生产部署。 |

## C++ 本地服务器

| 验收项 | 状态 | 证据与边界 |
| --- | --- | --- |
| Linux 构建、启动和 localhost UI | 本地已验证 | CMake 构建、CTest `10/10`、`native-ui:smoke` 通过。 |
| Windows 构建与启动 | 部分实现 | 用 MinGW-w64 交叉编译出 `plugmesh-server.exe`、`plugmesh-plugin-host.exe`、本地 UI smoke 服务器、10 个 smoke 可执行文件和三个示例 `.dll`（PE32+），据此补齐 Windows 分支的链接库（`advapi32`/`ws2_32`/`mswsock`/`crypt32`），并对 MinGW 显式启用 websocketpp 的 C++11 线程宏（否则回退 `boost::thread`）。构建步骤见 `native-server/README.md`「Windows 构建」与 `native-server/cmake/mingw-w64-toolchain.cmake`。产物静态链接 MinGW 运行时，只依赖系统 DLL。在 Wine 5.0（`wine64`）下 10 个 smoke 全部通过，`plugmesh-server.exe` 以 setup 模式启动、`/api/health` 返回 `systemCredentialsAvailable=true`，并正常提供本地 UI 的 `index.html` 与静态资源；`native-ui/run-wine-smoke.sh` 让 `native-ui` Playwright 连到 Wine 下的 `plugmesh-local-ui-smoke-server.exe`，首次绑定、会话流程、日志与诊断（含健康检查与停用/重载/卸载）、主题与语言五条用例 5/5 通过（新增用例暴露并修复了 Windows 下插件宿主可执行文件缺少 `.exe` 后缀、导致本地 UI 加载插件失败的问题）；未在真实 Windows 主机上启动。 |
| 首次 UI 设置本地口令和一次性注册码绑定 | 本地已验证 | Native UI Playwright smoke 覆盖绑定表单、localhost 服务重启和新口令登录；注册码交换仍由本地 mock handler 承载，未连接已部署 Worker。 |
| 长期密钥持久化和重启恢复 | 本地已验证 | Linux 加密文件保存/读取有 CTest；本地真实栈中加密凭据文件重启 `plugmesh-server` 后自动重连 Worker，插件状态和域名恢复，公开入口返回 200（`docs/local-e2e.md`）。Windows 凭据存储未验证。 |
| Windows Credential Manager | 部分实现 | Windows 分支在 Wine 下经 `CredWriteA`/`CredReadA`/`CredDeleteA` 完成保存、读取和删除往返（`plugmesh-credential-store-smoke`），`plugmesh-server.exe` 启动时报告系统凭据可用；真实 Windows 账户与注册表凭据存储仍未验证。 |
| macOS Keychain | 未验证 | `native-server/src/credential_store.cpp` 的 `__APPLE__` 分支以通用密码项（service `Plugmesh`、account `default`）调用 `SecItemAdd`/`SecItemUpdate`/`SecItemCopyMatching`/`SecItemDelete`；`native-server/CMakeLists.txt` 的 `APPLE` 分支链接 `-framework Security` 与 `-framework CoreFoundation`，并已与 Linux 共用 `PLUGMESH_PLATFORM_POSIX`（此前 macOS 上凭据文件的 `chmod 0600` 分支被编译掉，已修复）。当前环境没有 macOS 工具链，该分支从未编译或运行：授权弹窗、无头/无登录钥匙串、`errSecItemNotFound` 与重复项更新路径、以及回退到加密凭据文件的实际行为均未取得证据。 |
| 加密凭据文件回退 | 本地已验证 | AES-256-GCM、PBKDF2 和文件权限由 `credential-store` CTest 覆盖。 |
| 重新绑定、撤销和密钥轮换 | 本地已验证 | 本地 `wrangler dev` + 真实 `plugmesh-server` 控制台流程：轮换后凭据文件与 D1 token 哈希同时更新、连接保持、重启后自动重连；撤销后凭据文件删除、服务器转 `revoked`、插件转 `server_offline`、域名转 `offline` 且公开入口 503；在同一进程内通过本地 UI 重新绑定后取得新 serverId 并恢复 `online`（步骤见 `docs/local-e2e.md`）。联调中发现并修复了重新绑定成功后进程误判启动失败而退出的缺陷。边界：本地 miniflare，未在已部署 Worker 上验证。 |
| 仅监听 localhost、本地会话口令和登录限速 | 本地已验证 | `local-http-server` CTest 与 Native UI Playwright smoke。 |
| 无浏览器 CLI 注册入口 | 本地已验证 | `--register` 支持省略全部位置参数后逐项交互提示（Worker 地址、服务器名、凭据文件、注册码、本地 UI 口令及确认、凭据口令），也可用 `PLUGMESH_WORKER_URL`/`PLUGMESH_SERVER_NAME`/`PLUGMESH_CREDENTIAL_FILE` 等环境变量替代提示；2026-10-21 在本地 `wrangler dev` 上以管道输入完成一次真实注册，凭据文件权限 0600，随后用该文件启动服务器得到 `/api/status` 的 `configured=true`、`connected=true`，空输入时以退出码 2 报缺少必填项。注册 client 另有本地 WebSocket smoke；`npm run ui:real-stack` 第三条用例通过 `plugmesh-server --register <worker> <name> <credentialFile>` 连接本地 `wrangler dev` 兑换一次性注册码并取得 serverId，随后同一凭据文件启动服务器并完成插件加载与域名访问。未连接已部署 Worker。 |
| manifest 校验和目录越界防护 | 本地已验证 | `plugin-manager`、`plugin-loader` CTest。 |
| `.so` 动态加载和 C ABI v2/v3 | 本地已验证 | Linux 示例插件和 ABI/lifecycle CTest。 |
| `.dll` 动态加载 | 部分实现 | 示例插件已交叉编译为 `libplugmesh-*.dll`，在 Wine 下由 `plugin-loader`、`plugin-host`、`plugin-manager`、崩溃隔离和 WebSocket 生命周期用例实际 `LoadLibrary` 加载并执行 ABI v2/v3 回调；真实 Windows 上的加载路径与错误码未验证。 |
| 插件加载、卸载、启停、重载和健康检查 | 本地已验证 | `plugin-manager` CTest 覆盖加载、卸载、启停、重载与健康检查；本地 UI 的 `/api/plugins/<id>/<action>` 由 `native-ui:smoke` 在 Linux 与 Wine 下依次点击“加载”“启用”“检查”“停用”“重载”“卸载”，逐项断言状态徽标、已启用计数和日志同步变化。健康检查接口同时接受 `GET` 与 `POST /api/plugins/<id>/health`：此前 `POST` 落入通用动作分支返回 `unknown plugin action`，与 Worker 管理端使用的 `POST` 不一致，现已修复并有 curl 实测（两种方法均返回 `ok=true`、`status=200`）。管理端 `ui:real-stack` 第三条用例在真实 `wrangler dev` + 真实 C++ 服务器上通过插件详情弹窗点击“健康检查”与“重载”，断言 Toast「健康检查通过（200，2 B）」与「已重载」，覆盖 Worker→Durable Object→服务器→插件 的完整链路；随后点击“卸载”（确认弹窗自动接受），断言 Toast「已卸载」与详情状态，再对已分配域名发起公开请求得到 503，验证卸载后路由立即不可用。管理端原先只在 `loaded`/`disabled` 显示“卸载”，与本地 UI 和服务器能力不一致，已改为 `loaded`/`enabled`/`disabled` 均可卸载。 |
| HTTP、SSE、文件流和 WebSocket 回调 | 本地已验证 | C++ manager/control client/WebSocket lifecycle 测试。 |
| 协议错误和网络断线恢复 | 本地已验证 | 控制帧校验、nonce/时间窗以及 reconnect smoke。 |
| 插件原生崩溃隔离 | 本地已验证 | 每个插件由独立 `plugmesh-plugin-host` 子进程加载，父子进程通过逐行 JSON 管道通信；`plugin-manager-crash-smoke` 让插件空指针崩溃后断言仅宿主退出、插件转 `failed` 并记录错误、服务器可继续服务其他插件且可重新加载。Windows 分支在 Wine 下运行同一 `plugmesh-plugin-manager-crash-smoke` 通过：`CreateProcess` 拉起 `plugmesh-plugin-host.exe`、管道协议与崩溃隔离均生效，宿主崩溃后服务器继续服务并可重新加载；真实 Windows 主机仍未验证。边界：宿主内同步调用阻塞期间崩溃只能在下一次调用时被发现，崩溃后需要重新加载插件。 |

## 管理端与本地 UI

| 验收项 | 状态 | 证据与边界 |
| --- | --- | --- |
| 暗色、浅色、系统主题和持久化 | 本地已验证 | 管理端 Playwright 覆盖默认暗色、浅色切换、`prefers-color-scheme` 跟随和 localStorage 持久化；Native UI Playwright 覆盖深色→浅色→系统三态循环及系统偏好切换。 |
| 桌面、移动和窄窗口响应式布局 | 本地已验证 | 管理端 1440px/390px smoke；Native UI 1440px/390px smoke。 |
| 服务器、插件、域名、用量和维护空态 | 本地已验证 | 页面使用真实 API 空数据，不注入伪造业务数据；管理端 Playwright 在桌面和 390px 窄窗口逐页断言服务器、插件实例、公开域名、访问日志、审计日志、用量与系统设置的空态，并校验设置页维护/授权状态在未连接时显示“未读取/未连接”。 |
| 总览维护状态、数据更新时间与最近错误 | 本地已验证 | `console-worker` Playwright 项目用拦截的 Worker 响应验证总览：维护状态徽标随 `/api/settings/platform` 显示“平台运行中/平台维护中”，未连接时为“维护状态未读取”；资源面板展示 Cloudflare 官方 Analytics 与平台本地计数的更新时间，未连接时显示真实缺失态；错误面板先展示非在线服务器（离线/撤销，最近 3 台，含最近心跳或“尚未连接”），再展示最近 30 天访问日志中状态码 ≥ 500 的前 3 条（入口、路径、方法、错误类型、状态码、时间），4xx 不计入，加载态、空态和 5xx 数据态均有覆盖，“查看访问日志”可跳转到完整日志页。`console-real-stack` 第四条用例在本地真实栈上用真实 D1 访问日志复核该面板：对只声明 `http`/`websocket` 能力的 `lifecycle.plugin` 域名发起文件流请求，Worker 返回 `501` 并写入 `request_logs`（`error=plugin capability unavailable`），总览展示该入口、方法、错误文案与 `501` 徽标；访问日志页同样读到该行与「错误 N 条」统计，「导出日志」下载的 CSV 含该入口与 `plugin capability unavailable`；随后停掉真实 C++ 服务器并等到 `servers.status=offline`，刷新后总览出现该服务器行与“离线”徽标，覆盖连接异常分支；从插件服务器列表打开该服务器的详情弹窗，真实 `/api/servers/:id` 返回的状态徽标为“离线”、插件行状态为“服务器离线”、最近错误区列出该 501 请求。边界：`console-worker` 部分数据来自 Worker 响应夹具，官方用量时间为响应中的 `updatedAt`，不代表 Cloudflare 侧采集时刻；真实栈为本地 miniflare/workerd，未连接已部署 Worker。 |
| 本地 UI 插件 manifest 字段 | 本地已验证 | `native-ui:smoke` 的会话用例在插件行断言 `Sample Plugin` 展示动态库 `libplugmesh-sample.so`、健康检查路径 `/health` 与“权限: 无”，并在列表标题旁显示已加载数量；UI 数据由 smoke 服务器用真实 `PluginManager::discover` 读取示例插件目录，不是前端注入。边界：Linux 断言 `.so`，Wine 下的同一用例断言 `.dll`（`libplugmesh-sample.dll`），插件均来自真实 `PluginManager::discover`；真实 Windows 主机未覆盖。 |
| 本地 UI 日志和基础诊断 | 本地已验证 | 本地服务器 `GET /api/logs` 与 `GET /api/diagnostics` 由 `plugmesh::LocalLogBuffer`（与真实服务器同一实现，最近 200 条、UTC 时间戳）和 `PluginManager::set_log_writer` 提供；`native-ui:smoke` 新增用例断言指标卡片的插件总数 3、已启用 0→1、失败 0 和本地端口来自 `/api/diagnostics`，点击“加载”“启用”“停用”“重载”“卸载”后插件状态依次变为已加载/已启用/已停用/已停用/已卸载，日志区依次出现 `plugin loaded`、`plugin enabled`、`plugin disabled`、`plugin reloaded`、`plugin unloaded` 五行 `sample.plugin` 事件，级别徽标为 INFO，侧栏日志计数同步更新；`plugin reloaded` 为本轮新增的显式日志（重载此前只留下 unload+load 两行）。Linux（5 passed）与 Wine 5.0（5 passed）均通过。边界：日志只覆盖插件生命周期事件，插件主动日志回传尚未定义控制帧；未在真实 Windows 主机验证。 |
| 加载态、错误态、连接变化和 Toast | 本地已验证 | `console-worker` Playwright 项目用拦截的 Worker 响应验证：访问日志加载态→空态、服务器/插件/域名 500 后的“数据读取失败”与重试恢复、刷新成功 Toast、未连接/已连接切换和维护状态展示。`npm run ui:real-stack` 第四条用例再在真实栈上点公开域名行的复制按钮（按钮带 `aria-label="复制 <hostname>"`），断言 Toast「公开域名已复制」并从系统剪贴板读回同一 hostname。边界：`console-worker` 部分数据来自 Worker 响应夹具，不是已部署 Worker。 |
| 表单校验、注册码、本地口令、轮换和撤销确认 | 本地已验证 | 管理端 Playwright 覆盖注册码生成与弹窗内展示、域名前缀长度与空值校验、服务端校验错误回显、域名分配结果和插件加载命令提交；本地服务器口令、轮换和撤销有 CTest 与 Native UI smoke。`worker:runtime-test` 的 `admin.test.ts` 用真实 D1、会话 Cookie 和 Durable Object 串起管理 API：邀请参数校验与成员越权 403、创建/列出/撤销及审计，注册码生成后经 `/control/register` 只能兑换一次并核对令牌哈希，域名前缀/保留字/插件归属/服务器离线/健康检查/重复分配校验，配额保存回源与维护模式阻止注册码和域名分配。本地真实栈另已验证注册码、插件加载/启用、域名分配和公开入口 200（`docs/local-e2e.md`）。`npm run ui:real-stack` 用默认构建的管理端连接本地 `wrangler dev`，携带真实会话 Cookie 读取 D1 中的服务器/插件/域名记录，并通过页面创建邀请、回显并复制邀请链接、撤销邀请（确认后列表转「已撤销」、重复撤销 409 并写审计）、展示非法 GitHub 用户名错误和生成注册码；同一套件的第三条用例再由测试进程用一次性注册码启动真实 `plugmesh-server`，经管理端表单加载并启用 `sample.plugin`、分配唯一前缀域名，并从该域名请求插件得到 `200` 与 `ok`；随后在插件实例详情弹窗点「停用」，公开入口立即返回 503「插件暂时不可用」且 `/api/plugins/:id` 回源 `state=disabled`，重新启用后（生命周期命令会把域名状态置回 offline）再点健康检查才恢复 `200`；最后点「卸载」后入口再次 503（`docs/local-e2e.md`「管理端控制台真实数据」）。边界：仍为本地 miniflare/workerd 与本地 C++ 服务器，未连接已部署 Worker。 |
| 表格、图表和弹窗移动布局 | 本地已验证 | 各页面在 390px 下断言无横向溢出；`console-worker` 项目用带数据的 Worker 夹具在 390px 下逐页断言服务器/插件/域名/访问日志/审计表格行可见、请求趋势图渲染，并断言插件详情弹窗宽度不超出视口。详情弹窗已覆盖 Escape 关闭；`console-ui` 另以 `toHaveScreenshot` 锁定桌面暗色总览和 390px 系统设置两张像素基线（`tests/console-ui.spec.ts-snapshots/`，Linux 后缀），覆盖字体、间距和主题色回归。 |
| 中文优先和国际化预留 | 本地已验证 | 管理端与 C++ 本地 UI 均接入 i18next/react-i18next，默认中文、可切换 English；管理端语言写入 localStorage `plugmesh-language`，本地 UI 写入 `plugmesh-local-language`，两者都同步 `<html lang>`。Playwright 分别覆盖切换、刷新持久化和回切中文。键集合核对：管理端 en/zh 498/498、本地 UI 139/139，无缺失；审计动作与状态枚举（含 invite.revoked、smtp.test.failed、status.expired、plugin.*.failed）均已覆盖。管理端接口错误经 `ApiError` 携带状态码，由 `errorMessage()` 映射为 `toast.http.*` 本地化文案（401/403/404/409/429/5xx/其他），仅在服务端返回中文提示时原样展示，`console-worker` 用例断言英文服务端错误不会直出。本地 UI 采用同一策略：`LocalHttpServer` 在错误响应中新增稳定 `code`（`invalid_password`、`password_setup_required`、`registration_failed`、`credential_action_failed`、`plugin_action_failed`、`health_check_failed`、`payload_too_large` 等），`native-ui` 的 `request()` 抛出的 `RequestError` 携带该 `code`，`errorMessage()` 先按 `errors.code.*`（部分复用 `errors.passwordTooShort` 等既有键）映射，再按 401/403/404/409/429/5xx 落到 `errors.http.*`；`native-ui` 用例断言登录失败显示「本地 UI 口令不正确」且不出现 `invalid local UI password` 原文，CTest `plugmesh-local-http-server-smoke` 断言 401/409 响应携带对应 `code`。边界：英文 `error` 字段仍保留在响应体中供开发排查，界面不再直接展示。 |

## 当前自动化基线

在当前 Linux 环境中已通过：

```text
npm run build
npm run ui:smoke                         20 passed（preview 7 + worker-mock 13）
npm run native-ui:smoke                  5 passed
npm run native-ui:smoke:wine -- /tmp/build-win
                                         5 passed（Wine 5.0，指向 Windows 交叉编译产物；默认目录为 native-server/build-win）
PLUGMESH_REAL_STACK_URL=http://127.0.0.1:18888 npm run ui:real-stack
                                         7 passed（需先启动本地 wrangler dev 并写入验收数据；会话令牌默认值即 docs/local-e2e.md 的 e2e-session-token；第二条用例覆盖邀请创建、链接复制、撤销（重复撤销 409、整页重载回源与审计）、非法用户名校验和注册码生成，第三、四条用例自动注册并启动真实 C++ 服务器，第五条用例切换维护开关并保存配额后复位，第六条用例校验用量页真实本地计数、R2 用量回收与官方未连接状态，第七条用例保存 SMTP 配置并验证测试发送失败路径）
npm run worker:typecheck
npm run worker:smoke                     25 个 smoke 脚本全部通过
npm run worker:runtime-test              56 passed（workerd + 真实 D1/Durable Object/R2 模拟）
  # 本机 glibc 2.31，经 node:22-bookworm-slim 容器执行；glibc ≥ 2.35 可直接运行
  # 容器内没有系统 CA，必须只读挂载 /etc/ssl/certs，否则 16 个测试文件全部启动失败
  docker run --rm -v "$PWD":/work -v /etc/ssl/certs:/etc/ssl/certs:ro \
    -w /work -e CI=1 node:22-bookworm-slim \
    npx vitest run --config vitest.workers.config.ts
npx wrangler deploy --dry-run --config worker/wrangler.toml
cmake --build native-server/build --parallel 2
cmake -S native-server -B /tmp/build-win -DCMAKE_TOOLCHAIN_FILE=native-server/cmake/mingw-w64-toolchain.cmake \
  -DOPENSSL_ROOT_DIR=/tmp/mingw-openssl -DCMAKE_BUILD_TYPE=Release && cmake --build /tmp/build-win -j8
                                         13 个 PE32+ 可执行文件与三个示例 .dll 交叉编译通过
                                          （/tmp/mingw-openssl 为交叉编译静态 OpenSSL 前缀，步骤见 native-server/README.md）
（Wine 冒烟）4 个无参数用例直接运行，另 6 个按 native-server/README.md 传 winepath 参数
                                         10/10 passed（Wine 5.0，Windows 构建产物；非真实 Windows）
cd native-server/build && ctest --output-on-failure
                                         10/10 passed（本机 ctest 3.16 不支持 --test-dir，须先进入构建目录，否则会以 0 个测试「通过」）
PLUGMESH_REAL_STACK_URL=http://127.0.0.1:18888 npm run stack:streams
                                         1 passed（SSE 首帧 data: sample-plugin、WebSocket 回显 hello-ws、18 字节小文件直返、8 MiB 大文件经 R2 中转且用量归零）
PLUGMESH_REAL_STACK_URL=http://127.0.0.1:18888 npm run stack:browser
                                         1 passed（Chromium 经插件域名：首页 200、POST 透传、EventSource 首帧、WebSocket 回显、8 MiB 流式下载逐字节一致）
PLUGMESH_REAL_STACK_URL=http://127.0.0.1:18888 npm run stack:load
                                         1 passed（3 轮 × 300 请求/并发 100、40 条 SSE、40 条 WebSocket 驻留）
PLUGMESH_REAL_STACK_URL=http://127.0.0.1:18888 npm run stack:maintenance
                                         1 passed（请求配额耗尽 → 503 维护页、拒绝新 WebSocket、保留已建连接、审计与解除）
PLUGMESH_REAL_STACK_URL=http://127.0.0.1:18888 PLUGMESH_E2E_CONTAINER=plugmesh-e2e npm run stack:restart
                                         1 passed（容器重启后 isolate 缓存清空 → 回源 D1、服务器自动重连）
PLUGMESH_MULTI_ISOLATE_A_URL=http://127.0.0.1:18888 \
  PLUGMESH_MULTI_ISOLATE_B_URL=http://127.0.0.1:18889 \
  PLUGMESH_D1_SQLITE=/tmp/plugmesh-load-data2/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite \
  npm run stack:multi-isolate
                                         1 passed（两个 wrangler dev 共用同一 D1：A 命中 404 负缓存、B 立即回源 503、5 秒 TTL 后 A 收敛）
```

这些结果不代表真实 Cloudflare、GitHub、公网 SMTP（STARTTLS/SMTPS 与退信）、Windows 或生产网络已联通。

## 生产发布阻塞项

1. 创建真实 D1、R2 和 Durable Object 资源，替换占位 D1 ID，执行 migrations。本地已用全新 `--persist-to` 目录（`/tmp/plugmesh-fresh-data-*`）重放全部 6 个 migrations，再执行 `docs/local-e2e.md` 的管理端 seed SQL，随后用该库启动独立 `wrangler dev`（端口 18990）验证空库初始化：`/api/health` 200、`/api/me` 返回 seed 的 `super_admin`、`/api/servers` 只含 seed 的离线服务器、控制台根路径 200、seed 域名因服务器离线返回 503 维护页（2026-10-21）。真实 D1 创建与占位 ID 替换仍未进行。
2. 配置 `console` 与插件通配域名、DNS 和 Worker routes，并验证证书与 Host 路由。
3. 配置 GitHub OAuth、Cloudflare OAuth、`SESSION_SECRET` 和超级管理员白名单，执行真实登录与授权。
4. 配置真实 SMTP，验证邀请、测试邮件、维护通知、重试和退信处理。
5. 在 Windows 上构建并验证 DLL、Credential Manager、本地 UI 和重启恢复；在 macOS 上编译并验证 Keychain 分支与无钥匙串回退。
6. 使用已部署 Worker、本地 C++ 服务器和示例插件完成 HTTP、SSE、WebSocket、文件流、轮换、撤销和离线维护端到端验收；本地 `wrangler dev` 联调已覆盖 HTTP、SSE、WebSocket、文件流、插件域名路由、健康检查、离线维护和重启恢复，本地控制台的轮换、撤销和同进程重新绑定已联调通过，管理端经真实 C++ 服务器完成插件加载、启用和域名分配也已联调，仍缺已部署环境。
7. 对几百并发目标执行长连接、超时、R2 大文件和配额维护的持续压力测试；本地单机 workerd 已覆盖 64 并发乱序隔离、连接/响应大小/R2 配额边界，`npm run stack:load` 已在真实栈上跑 3 轮 × 300 请求（并发 100）、40 条并发 SSE 和 40 条 WebSocket 驻留；`npm run stack:maintenance` 在同一真实栈上验证了配额耗尽到维护模式、新长连接拒绝与解除。
8. 在 Windows 上验证插件宿主子进程、DLL 加载和管道协议；Linux 侧进程隔离已由 `plugin-manager-crash-smoke` 覆盖。
