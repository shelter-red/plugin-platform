# Plugmesh 插件聚合管理平台

这是 Cloudflare 插件聚合管理平台的 MVP 基础仓库，当前包含管理端界面、Worker 路由骨架、D1 初始模型、Durable Object 桥接边界，以及跨平台 C++ 插件服务器基础层。

## 已完成

- 管理端 React + TypeScript 界面：总览、服务器、插件、域名、用量、审计和系统设置。
- 暗色、浅色、跟随系统三种主题，主题选择持久化到浏览器本地存储。
- 服务器绑定、插件加载、域名分配等核心操作的表单和反馈状态。
- Worker API 基础路由：健康检查、总览、服务器、插件和域名查询。
- 控制 WebSocket 接入边界和 Durable Object 插件桥接对象，支持 HTTP/SSE/文件流响应及带 base64 二进制帧的公开 WebSocket 桥接；HTTP 控制帧的请求体和响应块也使用 base64 保护二进制数据，大文件流由 Worker 临时中转到 R2。
- D1 表结构：用户、服务器、插件实例、域名和审计日志。
- 控制 token 使用 SHA-256 摘要后与 D1 字段比对。
- SMTP 配置使用 `worker-mailer` 开源依赖，支持密文保存、脱敏读取和管理员测试发送。
- Cloudflare Analytics GraphQL 查询按 5 分钟写入 D1 缓存，权限错误和未配置状态会明确返回；D1、KV 和 Durable Object 官方用量也参与维护判定。
- 平台全局配额计数：请求窗口、活跃连接、R2 对象和字节用量；官方 Analytics 的 D1 查询、KV 操作和 Durable Object 请求达到阈值后同样自动进入维护模式。
- 维护模式支持全局暂停流量、停止新增域名/插件操作，并通过已配置 SMTP 向超级管理员发送带重试和审计记录的通知。
- Worker Cron 定时清理 30 天访问日志、180 天审计日志、过期邀请、会话和临时 R2 对象。
- 插件公开访问日志记录状态、耗时和错误摘要，并按用户隔离展示在管理端。
- Worker 静态资源绑定管理端 SPA，控制台、API、OAuth 和插件域名共用统一入口。
- Cloudflare OAuth Authorization Code 回调：管理员状态校验、一次性 state、令牌密文保存、账号自动发现和官方撤销。
- C++20 跨平台基础：Linux `.so` / Windows `.dll` 动态库加载、ABI v2/v3 版本检查、插件生命周期管理、公开 WebSocket 建立/关闭回调、Windows Credential Manager/macOS Keychain 系统凭据存储和 WebSocket++ 出站控制连接。插件运行在独立 `plugmesh-plugin-host` 子进程中，原生崩溃只终止宿主并标记插件失败，不会带走服务器。
- 独立本地 React + TypeScript 控制台：连接状态、插件 manifest、生命周期操作、诊断摘要、运行日志、首次绑定以及访问密钥轮换/绑定撤销。

## 本地运行

```bash
npm install
npm run dev
npm run native-ui:build
```

管理端地址：`http://localhost:4173/`
本地控制台开发地址：`http://localhost:4174/`（Vite `/api` 代理到 `127.0.0.1:8787`）。

管理端默认启用 GitHub OAuth；仅查看无后端的静态空态时可使用 `VITE_AUTH_ENABLED=false npm run dev`。

`npm run ui:smoke` 由两个 Playwright 项目组成：`preview`（4183，静态空态、主题、响应式和弹窗）与 `worker-mock`（4184，用拦截响应验证加载态、错误重试、Toast、维护状态，以及注册码生成、域名分配校验和插件加载等表单流程）。

验证命令：

```bash
npm run build
npm run ui:smoke
npm run native-ui:smoke
npm run stack:load
npm run stack:maintenance   # 需先启动 docs/local-e2e.md 中的本地真实栈
PLUGMESH_E2E_CONTAINER=plugmesh-e2e npm run stack:restart
npm run worker:typecheck
npm run worker:smoke
npm run worker:runtime-test
cmake -S native-server -B native-server/build
cmake --build native-server/build --parallel 2
cmake --build native-server/build --target test
```

完整的实现状态、验证证据和生产发布阻塞项见 [`docs/acceptance-matrix.md`](docs/acceptance-matrix.md)。

Worker 本地调试前需要把 `worker/wrangler.toml` 中的 D1、R2 和 Durable Object 配置替换为实际资源：

```bash
npx wrangler d1 create plugmesh
npx wrangler r2 bucket create plugmesh-blobs
# 将 d1 create 返回的 database_id 写入 worker/wrangler.toml
npm run worker:dev
```

部署前还需要在 Cloudflare 控制台或 CI 中配置以下 Worker 路由，并将示例域名替换为平台实际域名：

- `console.example.com/*`：管理端、管理 API 和 OAuth 回调。
- `*.plugins.example.com/*`：插件公开入口。

`worker/wrangler.toml` 中的 `database_id = "replace-with-d1-database-id"` 是故意保留的占位符；未替换前不要执行生产部署。部署前可先运行 `npx wrangler deploy --dry-run --config worker/wrangler.toml` 检查 bundle 和绑定配置。

GitHub OAuth 至少需要配置以下变量，回调地址必须与 GitHub OAuth App 完全一致：

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GITHUB_REDIRECT_URI`
- `GITHUB_ALLOWLIST`（超级管理员 GitHub 用户名或邮箱，逗号分隔）
- `SESSION_SECRET`

客户端 ID、回调地址和白名单可以作为 Worker 变量；客户端密钥和 `SESSION_SECRET` 应使用 `wrangler secret put` 写入，不要提交到仓库。Cloudflare OAuth 的变量见下节，SMTP 密码通过管理端密文保存，不作为仓库变量提交。

Cloudflare OAuth 使用官方 Authorization Code 流程。创建 OAuth client 时使用服务端客户端认证，回调地址必须与 `CLOUDFLARE_OAUTH_REDIRECT_URI` 完全一致；Worker 需要配置以下变量：

- `CLOUDFLARE_OAUTH_CLIENT_ID`
- `CLOUDFLARE_OAUTH_CLIENT_SECRET`
- `CLOUDFLARE_OAUTH_REDIRECT_URI`
- `CLOUDFLARE_OAUTH_SCOPE`（可选，默认 `workers-platform.read workers-platform.write`）
- `SESSION_SECRET`

官方端点为授权 `https://dash.cloudflare.com/oauth2/auth`、令牌 `https://dash.cloudflare.com/oauth2/token` 和撤销 `https://dash.cloudflare.com/oauth2/revoke`。回调成功后令牌不会返回浏览器，平台尝试通过 Cloudflare Accounts API 自动识别唯一账号；若授权范围无法得到唯一账号，管理端会明确显示未识别账号，不会伪造 Analytics 可用状态。

## 当前边界

当前提交建立了可编译的 MVP 基础，但还没有把生产凭据放入仓库。C++ 服务器已支持独立 sidecar `manifest.json` 校验、ABI v2/v3 插件生命周期、健康检查、文件流、出站控制连接、SSE 流、公开 WebSocket base64 二进制桥接，以及基于子进程的插件崩溃隔离；Worker 侧已具备 GitHub OAuth、Cloudflare OAuth、邀请会话、HTTP/SSE/文件流式响应、公开 WebSocket 桥接、R2 一次性对象、Cloudflare Analytics 查询和基于 `worker-mailer` 的 SMTP 测试发送能力；管理端已具备对应的 Cloudflare 和 SMTP 配置入口。平台本地用量快照按 Cron 保存 30 天，用于管理端请求趋势展示。这些功能仍需在真实 Cloudflare 资源、OAuth client 和本地服务器之间完成端到端联调。

上述 `worker:*:smoke` 使用本地 mock D1、Durable Object 和 OAuth 端点，只验证协议、权限边界和敏感字段处理。`npm run worker:runtime-test` 使用官方 `@cloudflare/vitest-plugin` 在 workerd/Miniflare 中加载 `worker/wrangler.toml`、真实 D1 迁移和真实 Durable Object 类，覆盖 Host 路由、HTTP 转发、并发 requestId 隔离、公开 WebSocket connectionId 隔离、断线维护、注册码并发消费、密钥轮换/撤销、SSE 活跃连接释放、超过 32 KiB 请求体被拒绝，以及大文件在真实 R2 模拟中的定长流/回退上传和读取后清理；GitHub OAuth 用例用 `outboundService` 桩替代 GitHub 端点，验证授权跳转、state 一次性消费、邀请领取后签发会话、未受邀身份拒绝和白名单管理员登录。其中 SMTP 用例会在本机启动真实 SMTP 服务端，经 `worker-mailer` 完成真实 TCP 会话、PLAIN 认证与投递并校验邮件内容，再断言测试邮件、邀请邮件和维护通知的成功/失败路径；它仍不代表真实 Cloudflare 账号、公网 SMTP、GitHub OAuth 或多地域网络已联通。

workerd 需要 glibc 2.35 或更高版本；在较旧的发行版（例如 Ubuntu 20.04）上可通过容器执行：

```bash
docker run --rm -v "$PWD:/app" -v /etc/ssl/certs:/etc/ssl/certs:ro -w /app node:22-bookworm-slim ./node_modules/.bin/vitest run --config vitest.workers.config.ts
```

## 目录

- `src/`：管理端 SPA。
- `worker/`：Cloudflare Worker、Durable Object、D1 migration 和协议定义。
- `native-server/`：跨平台 C++ 服务器基础层和插件 C ABI。
- `native-ui/`：本地服务器 React 控制台；构建产物由 C++ localhost HTTP 服务从 `native-ui/dist` 静态目录提供，不编译进二进制。
