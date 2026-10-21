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
| GitHub OAuth 登录、邀请过期、身份匹配、并发领取和权限隔离 | 部分/模块已验证 | `github-auth`、`github-oauth`、`invite-claim`、`api-permission` smoke；`worker:runtime-test` 用真实 D1 直接验证 `exchangeGithubCode`（只保留已验证邮箱、主邮箱优先、令牌/用户/邮箱异常与未配置返回 null）、`claimInvite`（邮箱和 GitHub 登录名大小写不敏感匹配、过期/已撤销/未知令牌拒绝、领取后 `used` 且不可重复使用）与 `upsertGithubUser`（按 `github_id` 去重并更新资料和角色）。未连接真实 GitHub OAuth App。 |
| Cloudflare OAuth 回调、管理员权限、state、凭据加密、刷新和撤销 | 部分/模块已验证 | `cloudflare-oauth` 与 `cloudflare-oauth-route` smoke 覆盖回调、state 校验和路由；`worker:runtime-test` 用真实 D1 验证 `/api/settings/cloudflare`：access token 与 account ID 加密落库且密文不含明文、读取只返回脱敏账号 `0123...cdef` 不回显 token、成员 403、缺少 token 400、删除后 `configured=false`，审计动作 `cloudflare.credentials.updated`/`revoked` 不含 token。未连接真实 Cloudflare OAuth client，也未用落库凭据发起真实 API 查询或刷新。 |
| 通配 Host 路由、管理 API 优先级、未知域名和离线维护页 | 本地已验证 | `public-route`、`public-proxy` smoke，覆盖插件 Host、未知域名、API 路径和桥接离线响应。另以真实 `wrangler dev` + 本地 C++ 服务器 + 示例插件联调：`Host: e2e.plugins.example.com` 的 `GET /`、带 query 的 GET 和 POST 均转达插件并返回 200，未知插件 Host 返回 404 `Plugin domain not found`，控制台 Host 仍返回 SPA HTML。联调首次暴露静态资源层会截获插件域名根路径，现由 `[assets] run_worker_first = true` 保证请求先经 Worker 路由；仍是本地 miniflare/workerd，不是已部署 Cloudflare。 |
| 一次性注册码原子消费 | 本地已验证 | `worker:runtime-test` 对真实 D1 并发三次提交同一注册码，仅一次 201、两次 401，并核对服务端只新增一条记录；`registration-race` smoke 覆盖并发消费逻辑。 |
| 控制连接注册、心跳、断线、重连和旧断线竞态 | 本地已验证 | `worker:runtime-test` 通过 workerd 中的真实 Durable Object 验证心跳置为在线、控制连接断开后插件转 `server_offline`、域名转 `offline` 且公开入口返回维护页；`durable-object-lifecycle` smoke 覆盖 manifest 注册与断线/重连交错；C++ `control-client` smoke 覆盖连接重试。本地真实栈重启验证：停止 `plugmesh-server` 后公开入口立即返回 503 维护页、服务器转 `offline`，重新启动后自动重连、插件恢复 `enabled`、域名恢复 `online` 且请求返回 200（步骤见 `docs/local-e2e.md`）。真实多地域网络未验证。 |
| 密钥轮换和绑定撤销 | 本地已验证 | `worker:runtime-test` 在 workerd 的真实 Durable Object 上执行 `server.rotate`/`server.revoke`：新 token 哈希落库、旧 token 被 401 拒绝、新 token 可重连、撤销后插件转 `server_offline`、域名转 `offline`、连接以 1000 关闭；`server-binding` smoke 另外覆盖重复撤销与撤销后轮换被拒。C++ 侧持久化和本地 UI 操作已有覆盖，本地真实栈端到端轮换与撤销见 `docs/local-e2e.md`。 |
| Durable Object 请求映射和并发隔离 | 本地已验证 | `worker:runtime-test` 在 workerd 中为同一服务器建立真实控制连接，并发 16 个公开 HTTP 请求并乱序回帧，验证响应按 `requestId` 一一对应；同时建立两条公开 WebSocket，验证 `connectionId` 隔离。未验证休眠恢复和多 isolate 场景。 |
| HTTP 方法、状态、响应头、Cookie 和二进制请求/响应 | 本地已验证 | `public-proxy`、`response-validation`、C++ `control-client` smoke；`worker:runtime-test` 在真实 Durable Object 链路上验证 POST 方法、查询串、自定义请求头与 `cookie` 原样转发，7 字节二进制请求体逐字节一致，插件返回 206、`content-type`、单个 `set-cookie` 与 4 字节二进制响应也逐字节透传。协议头是字符串映射，插件无法一次返回多个同名 `Set-Cookie`，此限制未在真实浏览器中测试。 |
| SSE、公开 WebSocket 和文件流桥接 | 本地已验证 | 真实 `wrangler dev` + C++ 服务器联调中，`accept: text/event-stream` 请求收到 `data: sample-plugin`；公开 WebSocket 经 Worker→Durable Object→C++→插件回显 `hello-ws`；`x-plugmesh-file-stream: true` 返回 18 字节 `sample-file-stream`，结束后 `r2Objects`/`r2Bytes` 归零（步骤见 `docs/local-e2e.md`）。 Worker 流式 smoke 与 C++ WebSocket 生命周期测试覆盖协议路径；`worker:runtime-test` 在 workerd 中验证 SSE 分块经真实 Durable Object 送达并在结束后释放活跃连接，1MB+ 文件在声明 `content-length` 时经真实 R2 定长流中转、缺少长度时回退一次性上传，且两种路径都会在读取后删除对象并归还用量。真实公网长连接未验证。 |
| 请求超时、帧大小、响应大小和活跃连接上限 | 本地已验证 | Durable Object 中有硬限制和超时；配额 smoke 覆盖计数边界。`worker:runtime-test` 在 workerd 中验证：超过 32 KiB 的公开请求体返回 413 并写入访问日志；64 个并发公开请求乱序回帧后各自拿到正确响应且活跃连接归零；活跃连接上限设为 2 时第三个公开 WebSocket 返回 503 并进入维护模式，关闭一个连接后额度释放且恢复维护开关后可重新连接；超过 16 MiB 的插件响应返回 502 `Plugin response is too large` 并释放缓冲；R2 配额为 0 时大文件流转返回 503 且删除已上传对象、用量归零。尚未在已部署环境做数百并发的持续压力测试。 |
| R2 上传、一次性读取、过期和删除 | 本地已验证 | `blob-stream` 与 `durable-object-stream` smoke 覆盖流式消费、一次性读取和删除；`blob-expiry` smoke 覆盖过期对象清理、24 小时陈旧对象清理、重试三次、删除失败后回滚占用和用量释放。`worker:runtime-test` 用 workerd + 本地 R2 验证：`POST /api/blobs` 必须以 `content-length` 声明长度（缺失返回 411，超 50 MiB 返回 413），上传后返回 `/blobs/<token>`，首次 GET 返回原始内容并删除对象、清空 `temp_objects`、归还 `r2_bytes`/`r2_objects`，重复 GET 返回 410；R2 配额为 0 时上传返回 503 且不残留对象；Durable Object 的定长流与缺长度回退两条文件流路径也会在读取后清理。真实 R2 一致性与费用仍未验证。 |
| D1/KV 路由缓存读穿和配置写穿 | 部分实现 | Host 路由内存缓存和更新失效逻辑已接入；`route-cache` smoke 覆盖读穿、负缓存、主动失效、5 秒 TTL 和 256 条上限淘汰；`worker:runtime-test` 用真实 D1 验证 Host 路由解析与未启用插件的维护页，并验证缓存命中期间直接改 D1 域名状态仍按旧路由转发、插件停用命令成功后立即失效并返回 503 不可用页。真实多 isolate 缓存传播未验证。按设计不引入 KV 业务缓存：KV 最小过期粒度为 60 秒且跨地域最终一致，域名撤销或转移后可能继续命中旧路由，当前用 5 秒 isolate 缓存加 D1 回源保证正确性。 |
| 总配额触发全局维护模式 | 本地已验证 | `worker:runtime-test` 在真实 D1 上把请求配额设为 1：首个公开请求经 Durable Object 正常返回 200，第二个请求因配额耗尽返回 503 维护页并把 `platform_settings` 的 `maintenance` 置为 true，写入 `maintenance.email.skipped` 审计（原因 `request quota reached`），后续请求直接走维护页；`worker:runtime-test` 另外用注入的 GraphQL 响应把 D1 查询配额设为 10，验证 Analytics 汇总达到阈值后进入维护模式并记录 `maintenance.email.skipped`（原因 `D1 query quota reached`）。真实 Cloudflare 账号的 Analytics 阈值触发仍未验证。 |
| SMTP 测试发送、维护通知、失败重试和审计 | 本地已验证 | `maintenance-email` smoke 注入发送器验证第三次成功、最终失败、审计和敏感字段不落日志。`worker:runtime-test` 用真实 D1 验证管理 API：SMTP 设置加密落库（密文不含密码与发件地址）、读取不回显密码、成员 403、非法端口 400、删除后 `configured=false`；测试发送经 `worker-mailer` 真实连接不可达服务器重试三次后返回 502 并写入脱敏 `smtp.test.failed` 审计；请求配额耗尽触发维护模式时向超级管理员发送通知，失败重试三次后记录 `maintenance.email.failed`；SMTP 不可达时创建邀请仍成功落库为 `pending`，响应 `emailSent=false`，`invite.email.failed` 重试三次且审计不含密码。真实 SMTP 服务器成功投递、退信和外部联通仍未验证。 |
| Cloudflare Analytics/GraphQL 缓存、权限错误和过期 | 模块已验证 | `cloudflare-usage` smoke；`worker:runtime-test` 直接调用 `cloudflareUsageApi` 并注入 GraphQL fetch：合并 D1 读写、KV 按 actionType 分类和 Durable Object 请求/CPU/存储用量，首次调用只发起两条 GraphQL 查询，第二次命中 `usage_cache` 且 TTL 五分钟、不再发起外部请求；HTTP 403 与 GraphQL errors 返回 502 且不写缓存；账号 ID 缺失时跳过查询；成员访问 403。缓存过期后的真实回源、真实 token 刷新与真实 Cloudflare 账号查询未验证。 |
| 30 天用量/访问日志和 180 天审计清理 | 本地已验证 | `scheduled-maintenance` smoke 覆盖保留时间边界；`worker:runtime-test` 在 workerd 中直接调用 scheduled 维护函数，用真实 D1 与本地 R2 验证：31 天前的访问日志、181 天前的审计删除而保留期内数据保留，过期邀请转 `expired`、过期会话 / OAuth state / Cloudflare OAuth state / 注册码删除，过期与 24 小时前已消费的临时对象连同 R2 对象删除并归还 `r2_bytes`/`r2_objects`，30 天前的用量快照清理并写入新快照。真实 Cron 触发时刻未验证。 |
| Wrangler bundle 和资源绑定 | 本地已验证 | `wrangler deploy --dry-run` 通过；`wrangler-config` smoke 断言 `[assets]` 的 `directory`、`binding`、`not_found_handling` 和 `run_worker_first = true`，防止插件域名根路径被静态资源层截获。D1 ID 仍为占位符，没有生产部署。 |

## C++ 本地服务器

| 验收项 | 状态 | 证据与边界 |
| --- | --- | --- |
| Linux 构建、启动和 localhost UI | 本地已验证 | CMake 构建、CTest `10/10`、`native-ui:smoke` 通过。 |
| Windows 构建与启动 | 未验证 | 代码包含 DLL、Credential Manager 和 Winsock 路径；当前环境没有执行 Windows 构建。 |
| 首次 UI 设置本地口令和一次性注册码绑定 | 本地已验证 | Native UI Playwright smoke 覆盖绑定表单、localhost 服务重启和新口令登录；注册码交换仍由本地 mock handler 承载，未连接已部署 Worker。 |
| 长期密钥持久化和重启恢复 | 本地已验证 | Linux 加密文件保存/读取有 CTest；本地真实栈中加密凭据文件重启 `plugmesh-server` 后自动重连 Worker，插件状态和域名恢复，公开入口返回 200（`docs/local-e2e.md`）。Windows 凭据存储未验证。 |
| Windows Credential Manager、macOS Keychain | 未验证 | 平台实现存在，当前 Linux 环境未执行。 |
| 加密凭据文件回退 | 本地已验证 | AES-256-GCM、PBKDF2 和文件权限由 `credential-store` CTest 覆盖。 |
| 重新绑定、撤销和密钥轮换 | 本地已验证 | 本地 `wrangler dev` + 真实 `plugmesh-server` 控制台流程：轮换后凭据文件与 D1 token 哈希同时更新、连接保持、重启后自动重连；撤销后凭据文件删除、服务器转 `revoked`、插件转 `server_offline`、域名转 `offline` 且公开入口 503；在同一进程内通过本地 UI 重新绑定后取得新 serverId 并恢复 `online`（步骤见 `docs/local-e2e.md`）。联调中发现并修复了重新绑定成功后进程误判启动失败而退出的缺陷。边界：本地 miniflare，未在已部署 Worker 上验证。 |
| 仅监听 localhost、本地会话口令和登录限速 | 本地已验证 | `local-http-server` CTest 与 Native UI Playwright smoke。 |
| 无浏览器 CLI 注册入口 | 本地已验证 | `--register` 路径可构建，注册 client 有本地 WebSocket smoke；`npm run ui:real-stack` 第三条用例通过 `plugmesh-server --register <worker> <name> <credentialFile>` 连接本地 `wrangler dev` 兑换一次性注册码并取得 serverId，随后同一凭据文件启动服务器并完成插件加载与域名访问。未连接已部署 Worker。 |
| manifest 校验和目录越界防护 | 本地已验证 | `plugin-manager`、`plugin-loader` CTest。 |
| `.so` 动态加载和 C ABI v2/v3 | 本地已验证 | Linux 示例插件和 ABI/lifecycle CTest。 |
| `.dll` 动态加载 | 未验证 | Windows 分支存在，当前环境未构建或加载 DLL。 |
| 插件加载、卸载、启停、重载和健康检查 | 本地已验证 | `plugin-manager` CTest 和本地 UI 操作接口。 |
| HTTP、SSE、文件流和 WebSocket 回调 | 本地已验证 | C++ manager/control client/WebSocket lifecycle 测试。 |
| 协议错误和网络断线恢复 | 本地已验证 | 控制帧校验、nonce/时间窗以及 reconnect smoke。 |
| 插件原生崩溃隔离 | 本地已验证 | 每个插件由独立 `plugmesh-plugin-host` 子进程加载，父子进程通过逐行 JSON 管道通信；`plugin-manager-crash-smoke` 让插件空指针崩溃后断言仅宿主退出、插件转 `failed` 并记录错误、服务器可继续服务其他插件且可重新加载。边界：Windows 子进程路径未构建验证；宿主内同步调用阻塞期间崩溃只能在下一次调用时被发现，崩溃后需要重新加载插件。 |

## 管理端与本地 UI

| 验收项 | 状态 | 证据与边界 |
| --- | --- | --- |
| 暗色、浅色、系统主题和持久化 | 本地已验证 | 管理端 Playwright 覆盖默认暗色、浅色切换、`prefers-color-scheme` 跟随和 localStorage 持久化；Native UI Playwright 覆盖深色→浅色→系统三态循环及系统偏好切换。 |
| 桌面、移动和窄窗口响应式布局 | 本地已验证 | 管理端 1440px/390px smoke；Native UI 1440px/390px smoke。 |
| 服务器、插件、域名、用量和维护空态 | 本地已验证 | 页面使用真实 API 空数据，不注入伪造业务数据；管理端 Playwright 在桌面和 390px 窄窗口逐页断言服务器、插件实例、公开域名、访问日志、审计日志、用量与系统设置的空态，并校验设置页维护/授权状态在未连接时显示“未读取/未连接”。 |
| 总览最近错误摘要 | 本地已验证 | `console-worker` Playwright 项目用拦截的 Worker 响应验证总览错误面板的加载态、空态和 5xx 数据态：只展示最近 30 天访问日志中状态码 ≥ 500 的前 3 条，包含入口、路径、方法、错误类型、状态码和时间，4xx 不计入；“查看访问日志”可跳转到完整日志页。边界：错误摘要来自访问日志接口夹具，未在已部署 Worker 上验证。 |
| 加载态、错误态、连接变化和 Toast | 本地已验证 | `console-worker` Playwright 项目用拦截的 Worker 响应验证：访问日志加载态→空态、服务器/插件/域名 500 后的“数据读取失败”与重试恢复、刷新成功 Toast、未连接/已连接切换和维护状态展示。边界：响应为测试夹具，不是已部署 Worker。 |
| 表单校验、注册码、本地口令、轮换和撤销确认 | 本地已验证 | 管理端 Playwright 覆盖注册码生成与弹窗内展示、域名前缀长度与空值校验、服务端校验错误回显、域名分配结果和插件加载命令提交；本地服务器口令、轮换和撤销有 CTest 与 Native UI smoke。`worker:runtime-test` 的 `admin.test.ts` 用真实 D1、会话 Cookie 和 Durable Object 串起管理 API：邀请参数校验与成员越权 403、创建/列出/撤销及审计，注册码生成后经 `/control/register` 只能兑换一次并核对令牌哈希，域名前缀/保留字/插件归属/服务器离线/健康检查/重复分配校验，配额保存回源与维护模式阻止注册码和域名分配。本地真实栈另已验证注册码、插件加载/启用、域名分配和公开入口 200（`docs/local-e2e.md`）。`npm run ui:real-stack` 用默认构建的管理端连接本地 `wrangler dev`，携带真实会话 Cookie 读取 D1 中的服务器/插件/域名记录，并通过页面创建邀请、回显邀请链接、展示非法 GitHub 用户名错误和生成注册码；同一套件的第三条用例再由测试进程用一次性注册码启动真实 `plugmesh-server`，经管理端表单加载并启用 `sample.plugin`、分配唯一前缀域名，并从该域名请求插件得到 `200` 与 `ok`（`docs/local-e2e.md`「管理端控制台真实数据」）。边界：仍为本地 miniflare/workerd 与本地 C++ 服务器，未连接已部署 Worker。 |
| 表格、图表和弹窗移动布局 | 本地已验证 | 各页面在 390px 下断言无横向溢出；`console-worker` 项目用带数据的 Worker 夹具在 390px 下逐页断言服务器/插件/域名/访问日志/审计表格行可见、请求趋势图渲染，并断言插件详情弹窗宽度不超出视口。详情弹窗已覆盖 Escape 关闭；`console-ui` 另以 `toHaveScreenshot` 锁定桌面暗色总览和 390px 系统设置两张像素基线（`tests/console-ui.spec.ts-snapshots/`，Linux 后缀），覆盖字体、间距和主题色回归。 |
| 中文优先和国际化预留 | 本地已验证 | 管理端与 C++ 本地 UI 均接入 i18next/react-i18next，默认中文、可切换 English；管理端语言写入 localStorage `plugmesh-language`，本地 UI 写入 `plugmesh-local-language`，两者都同步 `<html lang>`。Playwright 分别覆盖切换、刷新持久化和回切中文。边界：本地服务器返回的运行错误文本仍为中文。 |

## 当前自动化基线

在当前 Linux 环境中已通过：

```text
npm run build
npm run ui:smoke                         17 passed（preview 7 + worker-mock 10）
npm run native-ui:smoke                  4 passed
PLUGMESH_REAL_STACK_URL=http://127.0.0.1:18888 npm run ui:real-stack
                                         3 passed（需先启动本地 wrangler dev 并写入验收数据；第三条用例自动注册并启动真实 C++ 服务器）
npm run worker:typecheck
npm run worker:smoke                     25 smoke checks passed
npm run worker:runtime-test              43 passed（workerd + 真实 D1/Durable Object/R2 模拟）
  # 本机 glibc 2.31，经 node:22-bookworm-slim 容器执行；glibc ≥ 2.35 可直接运行
npx wrangler deploy --dry-run --config worker/wrangler.toml
cmake --build native-server/build --parallel 2
ctest --output-on-failure                 10/10 passed
```

这些结果不代表真实 Cloudflare、GitHub、SMTP、Windows 或生产网络已联通。

## 生产发布阻塞项

1. 创建真实 D1、R2 和 Durable Object 资源，替换占位 D1 ID，执行 migrations。
2. 配置 `console` 与插件通配域名、DNS 和 Worker routes，并验证证书与 Host 路由。
3. 配置 GitHub OAuth、Cloudflare OAuth、`SESSION_SECRET` 和超级管理员白名单，执行真实登录与授权。
4. 配置真实 SMTP，验证邀请、测试邮件、维护通知、重试和退信处理。
5. 在 Windows 上构建并验证 DLL、Credential Manager、本地 UI 和重启恢复。
6. 使用已部署 Worker、本地 C++ 服务器和示例插件完成 HTTP、SSE、WebSocket、文件流、轮换、撤销和离线维护端到端验收；本地 `wrangler dev` 联调已覆盖 HTTP、SSE、WebSocket、文件流、插件域名路由、健康检查、离线维护和重启恢复，本地控制台的轮换、撤销和同进程重新绑定已联调通过，管理端经真实 C++ 服务器完成插件加载、启用和域名分配也已联调，仍缺已部署环境。
7. 对几百并发目标执行长连接、超时、R2 大文件和配额维护的持续压力测试；本地单机 workerd 已覆盖 64 并发乱序隔离、连接/响应大小/R2 配额边界。
8. 在 Windows 上验证插件宿主子进程、DLL 加载和管道协议；Linux 侧进程隔离已由 `plugin-manager-crash-smoke` 覆盖。
