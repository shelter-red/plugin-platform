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
- 一键部署脚本自动准备 D1/R2、执行迁移、生成基础设施 Secret 并发布 Worker；OAuth、SMTP 等业务配置在管理后台完成。
- 一次性 `/setup` 初始化入口：部署令牌保护，首个 GitHub 白名单账号成为超级管理员，创建用户后永久锁定。
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
npm run stack:streams       # SSE / WebSocket / 文件流桥接，需先启动 docs/local-e2e.md 中的本地真实栈
npm run stack:load
npm run stack:maintenance   # 需先启动 docs/local-e2e.md 中的本地真实栈
PLUGMESH_E2E_CONTAINER=plugmesh-e2e npm run stack:restart
npm run stack:multi-isolate   # 双 isolate 缓存验证，需按 docs/local-e2e.md 启动两个实例
npm run worker:typecheck
npm run worker:smoke
npm run worker:runtime-test
cmake -S native-server -B native-server/build
cmake --build native-server/build --parallel 2
cmake --build native-server/build --target test
```

完整的实现状态、验证证据和生产发布阻塞项见 [`docs/acceptance-matrix.md`](docs/acceptance-matrix.md)。

## 一键部署（Cloudflare Workers）

部署 Worker 时只保留一个基础配置：`CLOUDFLARE_API_TOKEN`。D1、R2、Durable Object、`SESSION_SECRET`、`SETUP_TOKEN`、数据库迁移和 Worker 发布都由部署流程自动完成；GitHub OAuth、Cloudflare OAuth、SMTP、配额和插件域名后缀都在部署后的页面中配置，不需要重新部署。

### 方式一：Cloudflare 一键部署按钮

仓库公开到 GitHub 后，把下面地址中的 `<OWNER>/<REPO>` 换成实际仓库：

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/<OWNER>/<REPO>)
```

点击按钮后，Cloudflare 会克隆仓库并启动 Workers Builds：

1. 自动执行 `npm ci` 和 `npm run build`；
2. 自动创建并绑定 D1 与 R2；
3. 执行 `npm run deploy`，应用数据库迁移、生成基础设施 Secret 并发布 Worker；
4. 首次部署的 `SETUP_TOKEN` 会显示在该次构建日志的「初始化令牌」一行。

当前仓库尚未配置公开 Git remote，因此 README 不写死会失效的按钮地址；公开发布后只需替换上面的仓库地址。

### 方式二：本地一条命令部署

准备一个 Cloudflare API Token，至少包含：

- Workers Scripts: Edit
- D1: Edit
- Workers R2 Storage: Edit

然后执行：

```bash
npm ci
export CLOUDFLARE_API_TOKEN=...
# 可选：账号多于一个时设置
export CLOUDFLARE_ACCOUNT_ID=...
npm run deploy
```

`npm run deploy` 会自动完成：

1. 构建管理端；
2. 创建或复用 D1 `plugmesh`，并回填 `database_id`；
3. 创建或复用 R2 `plugmesh-blobs`；
4. 应用 `worker/migrations/` 下的全部迁移；
5. 发布 Worker；
6. 仅在远端缺失时生成 `SESSION_SECRET`，已有值绝不轮换；
7. 仅在远端缺失时生成一次性 `SETUP_TOKEN`，并保存到 `.wrangler/plugmesh-setup-token`（权限 `0600`）。

GitHub Actions 使用同一个脚本，只需配置 Secret `CLOUDFLARE_API_TOKEN`；`CLOUDFLARE_ACCOUNT_ID` 是多账号环境下的可选 Variable。首次初始化令牌会写入 Actions 的 Job Summary。

### 部署后初始化

先使用 Cloudflare 提供的默认地址 `https://<worker-name>.<workers-subdomain>.workers.dev/setup`，自定义域名可以稍后再绑定。

1. 在 GitHub 创建 OAuth App，回调地址填写 `https://<当前访问域名>/auth/github/callback`；
2. 打开 `/setup`，填写构建日志或 `.wrangler/plugmesh-setup-token` 中的初始化令牌；
3. 填写 GitHub Client ID、Client Secret 和管理员白名单；
4. 完成 GitHub 授权，白名单中的首个账号会成为 `super_admin`；
5. 登录管理后台，在「系统设置」中继续配置 Cloudflare OAuth、SMTP、配额和维护策略；
6. 在「系统设置 → 维护、域名与配额」中设置插件域名后缀，例如 `plugins.example.com`。

首个用户创建后 `/setup` 永久锁定。确认管理员可以正常登录后，可删除 Worker 的 `SETUP_TOKEN` Secret。`SESSION_SECRET` 用于加密后台保存的凭据，必须保留，不能随意轮换，否则已有密文将无法解密。

### 自定义域名与插件域名

默认 `workers.dev` 地址可以直接用于初始化、登录和后台管理。要让插件公开域名工作，需要在 Cloudflare 中一次性配置 DNS 和 Worker Route，例如：

- `console.example.com/*`：管理端、管理 API 和 OAuth 回调；
- `*.plugins.example.com/*`：插件公开入口。

随后在后台把插件域名后缀设为 `plugins.example.com`。新增插件域名会立即使用该后缀，不需要修改环境变量或重新部署。`PLUGIN_DOMAIN_SUFFIX` 仅用于本地测试和旧数据兼容回退，不是部署必填项。

### 校验与高级选项

```bash
npm run deploy -- --dry-run     # 只构建并校验 bundle，不访问云端、不写密钥、不发布
npm run deploy -- --skip-build  # 复用已有 dist，只做资源准备与发布
npm run deploy -- --help
```

`--dry-run` 不需要 D1 ID 或云端凭据。真实部署时脚本会自动创建或复用资源；通常不需要设置 `SESSION_SECRET`、`SETUP_TOKEN` 或任何 OAuth/SMTP 环境变量。

### 本地 Worker 调试

本地调试使用 Miniflare 模拟的本地 D1/R2：

```bash
npx wrangler d1 migrations apply DB --local --config wrangler.toml
npm run worker:dev
```

本地开发可以传固定测试密钥：

```bash
npx wrangler dev --config wrangler.toml --var SESSION_SECRET:local-only-session-secret
```

该值只用于本地 Miniflare，不要用于生产。

## 当前边界

当前提交建立了可编译的 MVP 基础，但还没有把生产凭据放入仓库。C++ 服务器已支持独立 sidecar `manifest.json` 校验、ABI v2/v3 插件生命周期、健康检查、文件流、出站控制连接、SSE 流、公开 WebSocket base64 二进制桥接，以及基于子进程的插件崩溃隔离；Worker 侧已具备 GitHub OAuth、Cloudflare OAuth、邀请会话、HTTP/SSE/文件流式响应、公开 WebSocket 桥接、R2 一次性对象、Cloudflare Analytics 查询和基于 `worker-mailer` 的 SMTP 测试发送能力；管理端已具备对应的 Cloudflare 和 SMTP 配置入口。平台本地用量快照按 Cron 保存 30 天，用于管理端请求趋势展示。这些功能仍需在真实 Cloudflare 资源、OAuth client 和本地服务器之间完成端到端联调。

上述 `worker:*:smoke` 使用本地 mock D1、Durable Object 和 OAuth 端点，只验证协议、权限边界和敏感字段处理。`npm run worker:runtime-test` 使用官方 `@cloudflare/vitest-plugin` 在 workerd/Miniflare 中加载根目录 `wrangler.toml`、真实 D1 迁移和真实 Durable Object 类，覆盖 Host 路由、HTTP 转发、并发 requestId 隔离、公开 WebSocket connectionId 隔离、断线维护、注册码并发消费、密钥轮换/撤销、SSE 活跃连接释放、超过 32 KiB 请求体被拒绝、插件 25 秒无响应返回 504 并释放连接与 R2 中转，以及大文件在真实 R2 模拟中的定长流/回退上传和读取后清理；GitHub OAuth 用例用 `outboundService` 桩替代 GitHub 端点，验证授权跳转、state 一次性消费、邀请领取后签发会话、未受邀身份拒绝和白名单管理员登录；Cloudflare OAuth 用例同样用该桩模拟令牌与账号端点，覆盖回调兑换、账号自动发现、凭据加密落库、state 重放拒绝，以及临近过期刷新、Analytics 401 后刷新重试和刷新失败回滚。其中 SMTP 用例会在本机启动真实 SMTP 服务端，经 `worker-mailer` 完成真实 TCP 会话、PLAIN 认证与投递并校验邮件内容，再断言测试邮件、邀请邮件和维护通知的成功/失败路径；它仍不代表真实 Cloudflare 账号、公网 SMTP、GitHub OAuth 或多地域网络已联通。

workerd 需要 glibc 2.35 或更高版本；在较旧的发行版（例如 Ubuntu 20.04）上可通过容器执行：

```bash
docker run --rm -v "$PWD:/app" -v /etc/ssl/certs:/etc/ssl/certs:ro -w /app node:22-bookworm-slim ./node_modules/.bin/vitest run --config vitest.workers.config.ts
```

## 目录

- `src/`：管理端 SPA。
- `worker/`：Cloudflare Worker、Durable Object、D1 migration 和协议定义。
- `native-server/`：跨平台 C++ 服务器基础层和插件 C ABI。
- `native-ui/`：本地服务器 React 控制台；构建产物由 C++ localhost HTTP 服务从 `native-ui/dist` 静态目录提供，不编译进二进制。
