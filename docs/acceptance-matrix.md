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
| GitHub OAuth 登录、邀请过期、身份匹配、并发领取和权限隔离 | 模块已验证 | `github-auth`、`github-oauth`、`invite-claim`、`api-permission` smoke；未连接真实 GitHub OAuth App。 |
| Cloudflare OAuth 回调、管理员权限、state、凭据加密、刷新和撤销 | 模块已验证 | `cloudflare-oauth` 与 `cloudflare-oauth-route` smoke；未连接真实 Cloudflare OAuth client。 |
| 通配 Host 路由、管理 API 优先级、未知域名和离线维护页 | 本地已验证 | `public-route`、`public-proxy` smoke，覆盖插件 Host、未知域名、API 路径和桥接离线响应。另以真实 `wrangler dev` + 本地 C++ 服务器 + 示例插件联调：`Host: e2e.plugins.example.com` 的 `GET /`、带 query 的 GET 和 POST 均转达插件并返回 200，未知插件 Host 返回 404 `Plugin domain not found`，控制台 Host 仍返回 SPA HTML。联调首次暴露静态资源层会截获插件域名根路径，现由 `[assets] run_worker_first = true` 保证请求先经 Worker 路由；仍是本地 miniflare/workerd，不是已部署 Cloudflare。 |
| 一次性注册码原子消费 | 本地已验证 | `worker:runtime-test` 对真实 D1 并发三次提交同一注册码，仅一次 201、两次 401，并核对服务端只新增一条记录；`registration-race` smoke 覆盖并发消费逻辑。 |
| 控制连接注册、心跳、断线、重连和旧断线竞态 | 本地已验证 | `worker:runtime-test` 通过 workerd 中的真实 Durable Object 验证心跳置为在线、控制连接断开后插件转 `server_offline`、域名转 `offline` 且公开入口返回维护页；`durable-object-lifecycle` smoke 覆盖 manifest 注册与断线/重连交错；C++ `control-client` smoke 覆盖连接重试。本地真实栈重启验证：停止 `plugmesh-server` 后公开入口立即返回 503 维护页、服务器转 `offline`，重新启动后自动重连、插件恢复 `enabled`、域名恢复 `online` 且请求返回 200（步骤见 `docs/local-e2e.md`）。真实多地域网络未验证。 |
| 密钥轮换和绑定撤销 | 本地已验证 | `worker:runtime-test` 在 workerd 的真实 Durable Object 上执行 `server.rotate`/`server.revoke`：新 token 哈希落库、旧 token 被 401 拒绝、新 token 可重连、撤销后插件转 `server_offline`、域名转 `offline`、连接以 1000 关闭；`server-binding` smoke 另外覆盖重复撤销与撤销后轮换被拒。C++ 侧持久化和本地 UI 操作已有覆盖，本地真实栈端到端轮换与撤销见 `docs/local-e2e.md`。 |
| Durable Object 请求映射和并发隔离 | 本地已验证 | `worker:runtime-test` 在 workerd 中为同一服务器建立真实控制连接，并发 16 个公开 HTTP 请求并乱序回帧，验证响应按 `requestId` 一一对应；同时建立两条公开 WebSocket，验证 `connectionId` 隔离。未验证休眠恢复和多 isolate 场景。 |
| HTTP 方法、状态、响应头、Cookie 和二进制请求/响应 | 本地已验证 | `public-proxy`、`response-validation`、C++ `control-client` smoke。 |
| SSE、公开 WebSocket 和文件流桥接 | 本地已验证 | 真实 `wrangler dev` + C++ 服务器联调中，`accept: text/event-stream` 请求收到 `data: sample-plugin`；公开 WebSocket 经 Worker→Durable Object→C++→插件回显 `hello-ws`；`x-plugmesh-file-stream: true` 返回 18 字节 `sample-file-stream`，结束后 `r2Objects`/`r2Bytes` 归零（步骤见 `docs/local-e2e.md`）。 Worker 流式 smoke 与 C++ WebSocket 生命周期测试覆盖协议路径；`worker:runtime-test` 在 workerd 中验证 SSE 分块经真实 Durable Object 送达并在结束后释放活跃连接，1MB+ 文件在声明 `content-length` 时经真实 R2 定长流中转、缺少长度时回退一次性上传，且两种路径都会在读取后删除对象并归还用量。真实公网长连接未验证。 |
| 请求超时、帧大小、响应大小和活跃连接上限 | 模块已验证 | Durable Object 中有硬限制和超时；配额 smoke 覆盖计数边界，`worker:runtime-test` 验证超过 32 KiB 的公开请求体返回 413 并写入访问日志、SSE 结束后活跃连接数归零；尚未做持续压力测试。 |
| R2 上传、一次性读取、过期和删除 | 部分实现 | `blob-stream` 与 `durable-object-stream` smoke 覆盖流式消费、一次性读取和删除；`blob-expiry` smoke 覆盖过期对象清理、24 小时陈旧对象清理、重试三次、删除失败后回滚占用和用量释放；`worker:runtime-test` 用本地 R2 模拟验证大文件上传、读取后对象删除、`temp_objects` 清空与用量归零。真实 R2 一致性与费用仍未验证。 |
| D1/KV 路由缓存读穿和配置写穿 | 部分实现 | Host 路由内存缓存和更新失效逻辑已接入；`route-cache` smoke 覆盖读穿、负缓存、主动失效、5 秒 TTL 和 256 条上限淘汰；`worker:runtime-test` 用真实 D1 验证 Host 路由解析与未启用插件的维护页。真实多 isolate 缓存传播未验证。按设计不引入 KV 业务缓存：KV 最小过期粒度为 60 秒且跨地域最终一致，域名撤销或转移后可能继续命中旧路由，当前用 5 秒 isolate 缓存加 D1 回源保证正确性。 |
| 总配额触发全局维护模式 | 本地已验证 | `worker:runtime-test` 在真实 D1 上把请求配额设为 1：首个公开请求经 Durable Object 正常返回 200，第二个请求因配额耗尽返回 503 维护页并把 `platform_settings` 的 `maintenance` 置为 true，写入 `maintenance.email.skipped` 审计（原因 `request quota reached`），后续请求直接走维护页；官方 Analytics 阈值触发仍未在真实账号上验证。 |
| SMTP 测试发送、维护通知、失败重试和审计 | 模块已验证 | `maintenance-email` smoke 注入发送器验证第三次成功、最终失败、审计和敏感字段不落日志；`worker-mailer` 真实传输和外部 SMTP 仍未联调。 |
| Cloudflare Analytics/GraphQL 缓存、权限错误和过期 | 模块已验证 | `cloudflare-usage` smoke；未使用真实账号 token 查询。 |
| 30 天用量/访问日志和 180 天审计清理 | 模块已验证 | `scheduled-maintenance` smoke 验证保留时间边界及邀请、会话、OAuth state、注册码清理；真实 Cron 调度未验证。 |
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
| 无浏览器 CLI 注册入口 | 模块已验证 | `--register` 路径可构建，注册 client 有本地 WebSocket smoke；完整 CLI 进程流程未连接已部署 Worker。 |
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
| 加载态、错误态、连接变化和 Toast | 本地已验证 | `console-worker` Playwright 项目用拦截的 Worker 响应验证：访问日志加载态→空态、服务器/插件/域名 500 后的“数据读取失败”与重试恢复、刷新成功 Toast、未连接/已连接切换和维护状态展示。边界：响应为测试夹具，不是已部署 Worker。 |
| 表单校验、注册码、本地口令、轮换和撤销确认 | 部分实现 | 管理端 Playwright 覆盖注册码生成与弹窗内展示、域名前缀长度与空值校验、服务端校验错误回显、域名分配结果和插件加载命令提交；本地服务器口令、轮换和撤销有 CTest 与 Native UI smoke，本地真实栈已用管理 API 验证注册码生成、插件加载/启用、域名分配（含健康检查）和公开入口 200（`docs/local-e2e.md`）。边界：管理端表单本身仍由测试夹具驱动，未连接已部署 Worker。 |
| 表格、图表和弹窗移动布局 | 本地已验证 | 各页面在 390px 下断言无横向溢出；`console-worker` 项目用带数据的 Worker 夹具在 390px 下逐页断言服务器/插件/域名/访问日志/审计表格行可见、请求趋势图渲染，并断言插件详情弹窗宽度不超出视口。边界：详情弹窗已覆盖 Escape 关闭，视觉像素基线未覆盖。 |
| 中文优先和国际化预留 | 本地已验证 | 管理端与 C++ 本地 UI 均接入 i18next/react-i18next，默认中文、可切换 English；管理端语言写入 localStorage `plugmesh-language`，本地 UI 写入 `plugmesh-local-language`，两者都同步 `<html lang>`。Playwright 分别覆盖切换、刷新持久化和回切中文。边界：本地服务器返回的运行错误文本仍为中文。 |

## 当前自动化基线

在当前 Linux 环境中已通过：

```text
npm run build
npm run ui:smoke                         16 passed（preview 7 + worker-mock 9）
npm run native-ui:smoke                  4 passed
npm run worker:typecheck
npm run worker:smoke                     25 smoke checks passed
npm run worker:runtime-test              15 passed（workerd + 真实 D1/Durable Object/R2 模拟）
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
6. 使用已部署 Worker、本地 C++ 服务器和示例插件完成 HTTP、SSE、WebSocket、文件流、轮换、撤销和离线维护端到端验收；本地 `wrangler dev` 联调已覆盖 HTTP、SSE、WebSocket、文件流、插件域名路由、健康检查、离线维护和重启恢复，本地控制台的轮换、撤销和同进程重新绑定已联调通过，仍缺已部署环境。
7. 对几百并发目标执行长连接、超时、R2 大文件和配额维护压力测试。
8. 在 Windows 上验证插件宿主子进程、DLL 加载和管道协议；Linux 侧进程隔离已由 `plugin-manager-crash-smoke` 覆盖。
