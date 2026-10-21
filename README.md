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
- C++20 跨平台基础：Linux `.so` / Windows `.dll` 动态库加载、ABI v2/v3 版本检查、插件生命周期管理、公开 WebSocket 建立/关闭回调、Windows Credential Manager/macOS Keychain 系统凭据存储和 WebSocket++ 出站控制连接。
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

验证命令：

```bash
npm run build
npm run worker:typecheck
npm run worker:github-auth-smoke
npm run worker:registration-race-smoke
npm run worker:durable-object-stream-smoke
cmake -S native-server -B native-server/build
cmake --build native-server/build --parallel 2
cmake --build native-server/build --target test
```

Worker 本地调试前需要把 `worker/wrangler.toml` 中的 D1、R2 和 Durable Object 配置替换为实际资源：

```bash
npm run worker:dev
```

Cloudflare OAuth 使用官方 Authorization Code 流程。创建 OAuth client 时使用服务端客户端认证，回调地址必须与 `CLOUDFLARE_OAUTH_REDIRECT_URI` 完全一致；Worker 需要配置以下变量：

- `CLOUDFLARE_OAUTH_CLIENT_ID`
- `CLOUDFLARE_OAUTH_CLIENT_SECRET`
- `CLOUDFLARE_OAUTH_REDIRECT_URI`
- `CLOUDFLARE_OAUTH_SCOPE`（可选，默认 `workers-platform.read workers-platform.write`）
- `SESSION_SECRET`

官方端点为授权 `https://dash.cloudflare.com/oauth2/auth`、令牌 `https://dash.cloudflare.com/oauth2/token` 和撤销 `https://dash.cloudflare.com/oauth2/revoke`。回调成功后令牌不会返回浏览器，平台尝试通过 Cloudflare Accounts API 自动识别唯一账号；若授权范围无法得到唯一账号，管理端会明确显示未识别账号，不会伪造 Analytics 可用状态。

## 当前边界

当前提交建立了可编译的 MVP 基础，但还没有把生产凭据放入仓库。C++ 服务器已支持独立 sidecar `manifest.json` 校验、ABI v2/v3 插件生命周期、健康检查、文件流、出站控制连接、SSE 流和公开 WebSocket base64 二进制桥接；Worker 侧已具备 GitHub OAuth、Cloudflare OAuth、邀请会话、HTTP/SSE/文件流式响应、公开 WebSocket 桥接、R2 一次性对象、Cloudflare Analytics 查询和基于 `worker-mailer` 的 SMTP 测试发送能力；管理端已具备对应的 Cloudflare 和 SMTP 配置入口。平台本地用量快照按 Cron 保存 30 天，用于管理端请求趋势展示。这些功能仍需在真实 Cloudflare 资源、OAuth client 和本地服务器之间完成端到端联调。

## 目录

- `src/`：管理端 SPA。
- `worker/`：Cloudflare Worker、Durable Object、D1 migration 和协议定义。
- `native-server/`：跨平台 C++ 服务器基础层和插件 C ABI。
- `native-ui/`：本地服务器 React 控制台；构建产物由 C++ localhost HTTP 服务从 `native-ui/dist` 静态目录提供，不编译进二进制。
