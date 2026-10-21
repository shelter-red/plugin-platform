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
| 通配 Host 路由、管理 API 优先级、未知域名和离线维护页 | 本地已验证 | `public-route`、`public-proxy` smoke，覆盖插件 Host、未知域名、API 路径和桥接离线响应。 |
| 一次性注册码原子消费 | 模块已验证 | `registration-race` smoke 强制并发消费同一注册码。 |
| 控制连接注册、心跳、断线、重连和旧断线竞态 | 模块已验证 | `durable-object-lifecycle` smoke 覆盖 manifest 注册以及断线/重连交错；C++ `control-client` smoke 覆盖连接重试。未连接真实 Durable Object。 |
| 密钥轮换和绑定撤销 | 部分实现 | Worker 控制帧、C++ 持久化和本地 UI 操作均已实现；没有 Worker 与真实本地服务器的端到端轮换测试。 |
| Durable Object 请求映射和并发隔离 | 部分实现 | HTTP、命令、流和连接映射有模块 smoke；真实 Durable Object isolate 并发与休眠恢复未验证。 |
| HTTP 方法、状态、响应头、Cookie 和二进制请求/响应 | 本地已验证 | `public-proxy`、`response-validation`、C++ `control-client` smoke。 |
| SSE、公开 WebSocket 和文件流桥接 | 本地已验证 | Worker 流式 smoke 与 C++ WebSocket 生命周期测试覆盖协议路径；真实公网长连接未验证。 |
| 请求超时、帧大小、响应大小和活跃连接上限 | 模块已验证 | Durable Object 中有硬限制和超时；配额 smoke 覆盖计数边界，尚未做持续压力测试。 |
| R2 上传、一次性读取、过期和删除 | 部分实现 | `blob-stream` 与 `durable-object-stream` smoke 覆盖流式消费、一次性读取和删除；`blob-expiry` smoke 覆盖过期对象清理、24 小时陈旧对象清理、重试三次、删除失败后回滚占用和用量释放。真实 R2 一致性与费用仍未验证。 |
| D1/KV 路由缓存读穿和配置写穿 | 部分实现 | Host 路由内存缓存和更新失效逻辑已接入；真实多 isolate 缓存传播未验证，当前实现没有独立 KV 业务缓存。 |
| 总配额触发全局维护模式 | 模块已验证 | 本地计数和官方 Analytics 阈值逻辑已实现；未在真实账号用量上触发。 |
| SMTP 测试发送、维护通知、失败重试和审计 | 模块已验证 | `maintenance-email` smoke 注入发送器验证第三次成功、最终失败、审计和敏感字段不落日志；`worker-mailer` 真实传输和外部 SMTP 仍未联调。 |
| Cloudflare Analytics/GraphQL 缓存、权限错误和过期 | 模块已验证 | `cloudflare-usage` smoke；未使用真实账号 token 查询。 |
| 30 天用量/访问日志和 180 天审计清理 | 模块已验证 | `scheduled-maintenance` smoke 验证保留时间边界及邀请、会话、OAuth state、注册码清理；真实 Cron 调度未验证。 |
| Wrangler bundle 和资源绑定 | 本地已验证 | `wrangler deploy --dry-run` 通过；D1 ID 仍为占位符，没有生产部署。 |

## C++ 本地服务器

| 验收项 | 状态 | 证据与边界 |
| --- | --- | --- |
| Linux 构建、启动和 localhost UI | 本地已验证 | CMake 构建、CTest `8/8`、`native-ui:smoke` 通过。 |
| Windows 构建与启动 | 未验证 | 代码包含 DLL、Credential Manager 和 Winsock 路径；当前环境没有执行 Windows 构建。 |
| 首次 UI 设置本地口令和一次性注册码绑定 | 本地已验证 | Native UI Playwright smoke 覆盖绑定表单、localhost 服务重启和新口令登录；注册码交换仍由本地 mock handler 承载，未连接已部署 Worker。 |
| 长期密钥持久化和重启恢复 | 部分实现 | Linux 加密文件保存/读取有 CTest；真实 Worker 重连恢复未做端到端测试。 |
| Windows Credential Manager、macOS Keychain | 未验证 | 平台实现存在，当前 Linux 环境未执行。 |
| 加密凭据文件回退 | 本地已验证 | AES-256-GCM、PBKDF2 和文件权限由 `credential-store` CTest 覆盖。 |
| 重新绑定、撤销和密钥轮换 | 部分实现 | 本地 API/UI 和控制协议已实现；缺少部署环境端到端验证。 |
| 仅监听 localhost、本地会话口令和登录限速 | 本地已验证 | `local-http-server` CTest 与 Native UI Playwright smoke。 |
| 无浏览器 CLI 注册入口 | 模块已验证 | `--register` 路径可构建，注册 client 有本地 WebSocket smoke；完整 CLI 进程流程未连接已部署 Worker。 |
| manifest 校验和目录越界防护 | 本地已验证 | `plugin-manager`、`plugin-loader` CTest。 |
| `.so` 动态加载和 C ABI v2/v3 | 本地已验证 | Linux 示例插件和 ABI/lifecycle CTest。 |
| `.dll` 动态加载 | 未验证 | Windows 分支存在，当前环境未构建或加载 DLL。 |
| 插件加载、卸载、启停、重载和健康检查 | 本地已验证 | `plugin-manager` CTest 和本地 UI 操作接口。 |
| HTTP、SSE、文件流和 WebSocket 回调 | 本地已验证 | C++ manager/control client/WebSocket lifecycle 测试。 |
| 协议错误和网络断线恢复 | 本地已验证 | 控制帧校验、nonce/时间窗以及 reconnect smoke。 |
| 插件原生崩溃隔离 | 部分实现 | 回调返回错误可处理；插件动态库与主进程同进程运行，访问违规等原生崩溃仍会终止服务器。生产前需决定进程隔离或接受监督重启策略。 |

## 管理端与本地 UI

| 验收项 | 状态 | 证据与边界 |
| --- | --- | --- |
| 暗色、浅色、系统主题和持久化 | 本地已验证 | 管理端 Playwright 覆盖默认暗色、浅色切换、`prefers-color-scheme` 跟随和 localStorage 持久化；Native UI Playwright 覆盖深色→浅色→系统三态循环及系统偏好切换。 |
| 桌面、移动和窄窗口响应式布局 | 本地已验证 | 管理端 1440px/390px smoke；Native UI 1440px/390px smoke。 |
| 服务器、插件、域名、用量和维护空态 | 本地已验证 | 页面使用真实 API 空数据，不注入伪造业务数据；管理端 Playwright 在桌面和 390px 窄窗口逐页断言服务器、插件实例、公开域名、访问日志、审计日志、用量与系统设置的空态，并校验设置页维护/授权状态在未连接时显示“未读取/未连接”。 |
| 加载态、错误态、连接变化和 Toast | 本地已验证 | `console-worker` Playwright 项目用拦截的 Worker 响应验证：访问日志加载态→空态、服务器/插件/域名 500 后的“数据读取失败”与重试恢复、刷新成功 Toast、未连接/已连接切换和维护状态展示。边界：响应为测试夹具，不是已部署 Worker。 |
| 表单校验、注册码、本地口令、轮换和撤销确认 | 部分实现 | UI 与本地 API 有覆盖；完整 Worker 联调未验证。 |
| 表格、图表和弹窗移动布局 | 部分实现 | 各页面在 390px 下断言无横向溢出；弹窗在 390px 下断言宽度不超出视口并可用 Escape 关闭；尚无逐页面视觉回归基线。 |
| 中文优先和国际化预留 | 部分实现 | 当前界面为中文优先；尚未接入 i18n 资源系统。 |

## 当前自动化基线

在当前 Linux 环境中已通过：

```text
npm run build
npm run ui:smoke                         10 passed（preview 6 + worker-mock 4）
npm run native-ui:smoke                  3 passed
npm run worker:typecheck
npm run worker:smoke                     22 smoke checks passed
npx wrangler deploy --dry-run --config worker/wrangler.toml
cmake --build native-server/build --parallel 2
ctest --output-on-failure                 8/8 passed
```

这些结果不代表真实 Cloudflare、GitHub、SMTP、Windows 或生产网络已联通。

## 生产发布阻塞项

1. 创建真实 D1、R2 和 Durable Object 资源，替换占位 D1 ID，执行 migrations。
2. 配置 `console` 与插件通配域名、DNS 和 Worker routes，并验证证书与 Host 路由。
3. 配置 GitHub OAuth、Cloudflare OAuth、`SESSION_SECRET` 和超级管理员白名单，执行真实登录与授权。
4. 配置真实 SMTP，验证邀请、测试邮件、维护通知、重试和退信处理。
5. 在 Windows 上构建并验证 DLL、Credential Manager、本地 UI 和重启恢复。
6. 使用已部署 Worker、本地 C++ 服务器和示例插件完成 HTTP、SSE、WebSocket、文件流、轮换、撤销和离线维护端到端验收。
7. 对几百并发目标执行长连接、超时、R2 大文件和配额维护压力测试。
8. 明确原生插件崩溃策略；若要求服务器进程不中断，需要增加插件进程隔离与监督重启。
