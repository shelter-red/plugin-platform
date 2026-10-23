# Plugmesh 插件聚合管理平台

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/shelter-red/plugin-platform)

> **一键部署：** 点击上方按钮并授权 Cloudflare 账号即可。部署页不填写任何业务变量；D1、R2、Durable Object、迁移、基础设施 Secret 和 Worker 发布全部自动完成。

这是 Cloudflare 插件聚合管理平台的 MVP 基础仓库，当前包含管理端界面、Worker 路由骨架、D1 初始模型、Durable Object 桥接边界，以及跨平台 C++ 插件服务器基础层。

## 已完成

- 管理端 React + TypeScript 界面：总览、服务器、插件、域名、用量、审计和系统设置。
- 暗色、浅色、跟随系统三种主题，主题选择持久化到浏览器本地存储。
- 服务器绑定、插件加载、域名分配等核心操作的表单和反馈状态。
- Worker API 基础路由：健康检查、总览、服务器、插件和域名查询。
- 控制 WebSocket 接入边界和 Durable Object 插件桥接对象，支持 HTTP/SSE/文件流响应及带 base64 二进制帧的公开 WebSocket 桥接；HTTP 控制帧的请求体和响应块也使用 base64 保护二进制数据，大文件流由 Worker 临时中转到 R2，SSE 客户端断开会立即归还连接配额并通知插件服务器关闭流。
- D1 表结构：用户、服务器、插件实例、域名和审计日志。
- 多工作区与三角色权限：`workspaces`/`workspace_members` 记录 owner、operator、viewer 三种角色，服务器、插件实例、域名、访问日志、注册码、邀请和审计日志均按 `workspace_id` 隔离；管理端顶栏可切换工作区，`/api/workspaces` 提供创建、重命名、删除与成员角色管理，viewer 的写操作在前端禁用、后端 403；`super_admin` 可跨工作区查看但需显式切换，平台级设置仍由超级管理员维护。
- 控制 token 使用 SHA-256 摘要后与 D1 字段比对。
- SMTP 配置使用 `worker-mailer` 开源依赖，支持密文保存、脱敏读取和管理员测试发送。
- Cloudflare Analytics GraphQL 查询按 5 分钟写入 D1 缓存，权限错误和未配置状态会明确返回；D1、KV 和 Durable Object 官方用量也参与维护判定。
- 平台全局配额计数：请求窗口、活跃连接、R2 对象和字节用量；官方 Analytics 的 D1 查询、KV 操作和 Durable Object 请求达到阈值后同样自动进入维护模式。
- 维护模式支持全局暂停流量、停止新增域名/插件操作，并通过已配置 SMTP 向超级管理员发送带重试和审计记录的通知。
- Worker Cron 定时清理 30 天访问日志、180 天审计日志、过期邀请、会话和临时 R2 对象。
- 插件公开访问日志记录状态、耗时和错误摘要，并按用户隔离展示在管理端。
- Worker 静态资源绑定管理端 SPA，控制台、API、GitHub OAuth 回调、插件域名共用统一入口。
- 一键部署脚本自动准备 D1/R2、执行迁移、生成基础设施 Secret 并发布 Worker；GitHub OAuth、SMTP 和 Cloudflare API Token 等业务配置在管理后台完成。
- 一次性 `/setup` 初始化入口：部署令牌保护，首个 GitHub 白名单账号成为超级管理员，创建用户后永久锁定。
- Cloudflare API Token：固定监控与域名配置权限、保存前验证 Token、完整分页发现账号、从 subscriptions 确认 Free 计划和八项官方额度，并在保存插件域名后缀时自动同步 DNS 与 Worker Route；Token 只以密文保存且永不回显。
- C++20 跨平台基础：Linux `.so` / macOS `.dylib` / Windows `.dll` 动态库加载、ABI v2/v3/v4 版本检查、插件生命周期管理、公开 WebSocket 建立/关闭回调、ABI v4 协作式 SSE 取消回调、Windows Credential Manager/macOS Keychain 系统凭据存储和 WebSocket++ 出站控制连接。插件运行在独立 `plugmesh-plugin-host` 子进程中，原生崩溃只终止宿主并标记插件失败，不会带走服务器。
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

`npm run ui:smoke` 由五个 Playwright 项目组成：`preview`（4183，静态空态、主题、响应式和弹窗）、`a11y`（4183，axe 逐页扫描 13 个页面 × 深浅主题）、`screenshots`（4183，双主题 × 1440/1024/390 截图矩阵）、`worker-mock`（4184，用拦截响应验证加载态、错误重试、Toast、维护状态，以及注册码生成、域名分配校验和插件加载等表单流程）与 `auth`（4185，登录/邀请/错误页与窄窗口布局、axe 扫描和截图基线）。

验证命令：

```bash
npm run ci:local            # 按 CI web job 顺序本地跑一遍；有 docker 时用同一 Playwright 镜像
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
cd native-server/build && ctest --output-on-failure
```

`.github/workflows/platform-ci.yml` 的 `web` job 依次执行 `ui:conventions`、`ui:css-audit`、`worker:typecheck`、`build`、`worker:smoke` 和 `ui:smoke`（`npm run ci:local` 与这六步同序，推送前跑一遍即可得到同样的结论）；Linux、Windows 和 macOS 原生验收 job 只在 `native-server/**` 或该工作流本身变化时触发（`dorny/paths-filter`），统一以 `ctest --output-on-failure -V` 运行，失败时上传 `Testing/Temporary` 日志 artifact。CI 不再强制 `PLUGMESH_TEST_SYSTEM_CREDENTIALS=required`：runner 缺少系统凭据时，凭据用例回退到加密凭据文件路径，系统凭据存储的完整往返仍需在真实 Windows 主机和 macOS Keychain 上单独验证。

完整的实现状态、验证证据和生产发布阻塞项见 [`docs/acceptance-matrix.md`](docs/acceptance-matrix.md)。

## 一键部署（Cloudflare Workers）

> **唯一部署必填项：连接 Cloudflare Workers Builds 账号。** 本仓库没有额外部署变量。D1/R2 ID、`SESSION_SECRET`、`SETUP_TOKEN`、OAuth、SMTP、配额和维护策略都不需要出现在部署页。

| 部署方式 | 必填 | 可选 |
| --- | --- | --- |
| Cloudflare 部署按钮 | Cloudflare 账号授权 | 无 |
| 本地一条命令 | `CLOUDFLARE_API_TOKEN` | `CLOUDFLARE_ACCOUNT_ID`（仅多账号） |

本地令牌至少需要 Workers Scripts: Edit、D1: Edit、Workers R2 Storage: Edit。

### 方式一：Cloudflare 部署按钮

点击 README 顶部的 Deploy to Cloudflare 按钮并授权账号后：

1. 授权 Cloudflare 账号；
2. 确认 Workers Builds 预填的命令为 `npm run build` 和 `npm run deploy`；
3. 部署脚本自动创建并绑定 D1 `plugmesh`、R2 `plugmesh-blobs` 和 Durable Object；
4. 脚本自动执行全部 migrations、生成基础设施 Secret 并发布 Worker；
5. 首次生成的 `SETUP_TOKEN` 显示在本次构建日志的「初始化令牌」一行。

不要填写任何业务变量。Deploy command 必须是 `npm run deploy`：改成 `npx wrangler deploy` 或平台默认的 `npx wrangler versions upload` 都只会发布代码，跳过 migrations 和 Secret 初始化，下一次 schema 变更后接口会直接报 `D1_ERROR: no such table`。

部署脚本会在发布前校验远端 D1 已没有待应用 migration，发现遗留会直接让构建失败，而不是把缺表的新版本推上线。
> 一键部署创建的仓库受 GitHub 安全限制，可能不包含本仓库的 Actions workflow。部署按钮和 GitHub Actions 是两条可选链路，不要同时配置。

### 方式二：本地一条命令

```bash
npm ci
export CLOUDFLARE_API_TOKEN=...
# 仅账号多于一个时设置
export CLOUDFLARE_ACCOUNT_ID=...
npm run deploy
```

`npm run deploy` 会自动完成：

1. 构建管理端；
2. 创建或复用 D1 `plugmesh`，并回填 `database_id`；
3. 创建或复用 R2 `plugmesh-blobs`；
4. 应用 `worker/migrations/` 下的全部 migrations；
5. 首次缺失时生成 `SESSION_SECRET` 和一次性 `SETUP_TOKEN`，已有值不轮换；
6. 发布 Worker，并把初始化令牌保存到 `.wrangler/plugmesh-setup-token`（权限 `0600`）。

部署统一由 Cloudflare Workers Builds 触发（`WORKERS_CI=1` 时脚本自动进入托管模式），仓库不再保留 `deploy.yml` 部署工作流；本地或自有 CI 仍可直接执行 `npm run deploy`，只需配置 `CLOUDFLARE_API_TOKEN`，多账号环境再设置 `CLOUDFLARE_ACCOUNT_ID`。

### 部署故障排查：接口报 `no such table`

出现 `D1_ERROR: no such table: workspaces` 之类的错误，说明当前 Worker 版本已经发布、但远端 D1 还停在旧 schema（多数情况是 Deploy command 没走 `npm run deploy`）。先补齐迁移，再把 Deploy command 改成 `npm run deploy`：

```bash
npx wrangler d1 migrations list plugmesh --remote   # 列出待应用 migration
npx wrangler d1 migrations apply plugmesh --remote  # 补齐后重新发布即可
```

### 部署后只做一次业务初始化

先使用 Cloudflare 提供的默认地址 `https://<worker-name>.<workers-subdomain>.workers.dev/setup`，自定义域名可以稍后再绑定。

`/setup` 不是部署环境配置，而是建立首个管理员登录闭环的一次性页面。页面只填写：

1. 构建日志或 `.wrangler/plugmesh-setup-token` 中的初始化令牌；
2. 在 GitHub 创建的 OAuth App 的 Client ID 和 Client Secret；
3. 允许登录的管理员 GitHub 用户名或已验证邮箱。

`/setup` 页面会直接给出需要填进 GitHub OAuth App 的两个地址：Homepage URL（站点根地址）和 Authorization callback URL（`/auth/github/callback`），无需手填。保存后完成 GitHub 授权，白名单中的首个账号会成为 `super_admin`。

以下配置全部在登录后的管理后台完成，不需要重新部署：

| 配置项 | 管理后台位置 |
| --- | --- |
| GitHub OAuth 修改 | 系统设置 → GitHub 登录 |
| Cloudflare API Token、账号与官方用量 | 系统设置 → Cloudflare |
| SMTP 和测试发送 | 系统设置 → 邮件 SMTP |
| 配额、维护策略、插件域名后缀 | 系统设置 → 维护、域名与配额 |

首个用户创建后 `/setup` 永久锁定。确认管理员可以正常登录后，可删除 Worker 的 `SETUP_TOKEN` Secret。`SESSION_SECRET` 必须保留，不能随意轮换，否则已有密文将无法解密。

### 登录失败排查

GitHub 回调失败时 Worker 直接返回对应 HTTP 状态（400/403/409/502/503）的错误页，不再回跳 `/?auth_error=`；页面会给出具体原因和“返回登录”入口：

| 提示 | 处理方式 |
| --- | --- |
| `GitHub 授权码换取令牌失败` | 核对 OAuth App 的 Client ID、Client Secret，以及 App 中填写的 Authorization callback URL 与 `/setup` 显示的地址完全一致；确认创建的是 **OAuth App** 而不是 GitHub App |
| `读取 GitHub 邮箱失败` | 确认 OAuth App 拥有 `user:email` 权限，且 GitHub 账号已授权该权限 |
| `读取 GitHub 用户信息失败（HTTP 403）` | GitHub 拒绝缺少 User-Agent 的请求或触发限流；确认 Worker 已更新到最新版本后重试，仍失败则查看提示中的 GitHub 原始信息 |
| `该 GitHub 账号没有已验证的邮箱` | 先在 GitHub 设置中验证至少一个邮箱 |
| `该 GitHub 身份未被邀请` | 把该 GitHub 用户名或已验证邮箱加入白名单，或使用有效邀请链接 |
| `OAuth 状态已过期` | 回到登录页重新发起授权，不要在同一个回调地址上重复刷新 |

回调地址格式为 `https://<你的域名>/auth/github/callback`，必须与 GitHub OAuth App 中登记的地址逐字符一致（协议、域名、路径都不能差）。除本地 `localhost` 外，GitHub 只接受 HTTPS 回调，系统保存时会把 `http://` 自动升级为 `https://`。

### Cloudflare API Token 所需权限（固定）

平台使用 Cloudflare API Token 读取账号/用量并配置插件域名；GitHub 登录使用单独的 OAuth App 配置。请从 **Cloudflare Dashboard → My Profile → API Tokens → Create Token** 创建自定义 Token：在创建页填写 Token 名称，选择下面的监控与域名权限，并在 `Account resources`、`Zone resources` 中限制到实际使用的资源。Token 名称是 Cloudflare 控制台标签，平台不读取或保存；系统设置 → Cloudflare 固定展示权限清单，不提供自定义范围入口：

| 官方权限名称 | 用途 |
| --- | --- |
| Account Settings Read | 读取账号列表，确认唯一 Account ID，并读取订阅信息 |
| Account Analytics Read | 读取账号级 Analytics，用于 Worker、D1、KV 与 Durable Object 用量 |
| Billing Read | 读取 subscriptions 与套餐信息，确认是否为 Cloudflare Free |
| Zone Read | 查找插件域名后缀对应的 Cloudflare Zone |
| DNS Write | 写入插件域名的通配 DNS 记录 |
| Workers Routes Edit | 创建或更新通配 Worker Route |

保存 Token 时平台依次调用 Token verify、accounts 全分页和 subscriptions；未填写 Account ID 且 Token 可见多个账号时，接口返回 `409 account_ambiguous`，需要填写目标 Account ID 后重新保存。保存插件域名后缀时，平台会使用同一 Token 查找 Zone、写入通配 DNS 记录并创建 Worker Route。

Token 只以 AES-GCM 密文保存在 D1，GET 设置接口永远不回显明文。Token 被撤销、权限被修改或用户设置了过期时间后，平台会返回真实 HTTP 错误并在当前 Cloudflare 设置面板显示：`401 token_invalid` 表示 Token 无效、已撤销或已过期；`403 token_permission_denied` 表示缺少上面的固定权限；`409 account_missing` / `account_ambiguous` 表示账号不可见或需要指定 Account ID；`502 cloudflare_upstream_error` 表示 Cloudflare 或网络异常。删除平台保存的 Token 只删除本地密文和用量缓存，不会替你撤销 Cloudflare 上的 Token。

用量页唯一的“刷新用量”按钮会重新读取官方 Analytics；免费额度只能从 subscriptions 读取，未确认 Free 计划时不会展示或允许手填八项上限。用量页同时分开显示平台本地统计与 Cloudflare 官方监控：平台请求只计数、不设上限，因此 `/api/usage/cloudflare` 返回 `configured=false` 时 `/api/usage/local` 仍返回 200 和本地数据。

### 自定义域名与插件域名

默认 `workers.dev` 地址可以直接用于初始化、登录和后台管理。保存插件域名后缀后，平台会通过 Token 自动配置插件通配域名的 DNS 和 Worker Route；管理端自定义域名仍需按部署环境配置对应入口，例如：

- `console.example.com/*`：管理端、管理 API 和 GitHub OAuth 回调；
- `*.plugins.example.com/*`：插件公开入口。

随后在后台把插件域名后缀设为 `plugins.example.com`。新增插件域名会立即使用该后缀，不需要修改环境变量或重新部署。`PLUGIN_DOMAIN_SUFFIX` 仅用于本地测试和旧数据兼容回退，不是部署必填项。

### 校验与高级选项

```bash
npm run deploy -- --dry-run     # 只构建并校验 bundle，不访问云端、不写密钥、不发布
npm run deploy -- --skip-build  # 复用已有 dist，只做资源准备与发布
npm run deploy -- --help
```

`--dry-run` 不需要 D1 ID 或云端凭据。真实部署时脚本会自动创建或复用资源；通常不需要设置 `SESSION_SECRET`、`SETUP_TOKEN` 或任何 GitHub OAuth/SMTP 环境变量。

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

## 发布原生端

推送 `v*` tag（或手动触发 `.github/workflows/release.yml`）会在 Ubuntu、Windows 和 macOS runner 上构建 `plugmesh-server`，并发布到对应 GitHub Release：

| 产物 | 说明 |
| --- | --- |
| `plugmesh-server-linux.zip` | Linux x86_64，需系统 OpenSSL 3 |
| `plugmesh-server-windows.zip` | Windows x64，内含随包 OpenSSL DLL |
| `plugmesh-server-macos.zip` | macOS，运行时需 `brew install openssl@3` |
| `SHA256SUMS` | 三个 zip 的 SHA-256 校验和 |

产物不做代码签名。下载后先校验再运行：

```bash
sha256sum -c SHA256SUMS
```

也可以按 [`native-server/README.md`](native-server/README.md) 从源码构建，自行确认工具链与依赖版本。

## 当前边界

当前提交建立了可编译的 MVP 基础，但还没有把生产凭据放入仓库。C++ 服务器已支持独立 sidecar `manifest.json` 校验、ABI v2/v3/v4 插件生命周期、健康检查、文件流、出站控制连接、SSE 流及 ABI v4 协作式取消、公开 WebSocket base64 二进制桥接，以及基于子进程的插件崩溃隔离；Worker 侧已具备 GitHub OAuth、Cloudflare API Token、邀请会话、HTTP/SSE/文件流式响应、公开 WebSocket 桥接、R2 一次性对象、Cloudflare Analytics 查询和基于 `worker-mailer` 的 SMTP 测试发送能力；管理端已具备对应的 Cloudflare API Token 和 SMTP 配置入口。平台本地用量快照按 Cron 保存 30 天，用于管理端请求趋势展示。这些功能仍需在真实 Cloudflare 资源、GitHub OAuth App、SMTP 和本地服务器之间完成端到端联调。

上述 `worker:*:smoke` 使用本地 mock D1、Durable Object 和外部端点，只验证协议、权限边界和敏感字段处理。`npm run worker:runtime-test` 使用官方 `@cloudflare/vitest-plugin` 在 workerd/Miniflare 中加载根目录 `wrangler.toml`、真实 D1 迁移和真实 Durable Object 类，覆盖 Host 路由、HTTP 转发、并发 requestId 隔离、公开 WebSocket connectionId 隔离、断线维护、注册码并发消费、密钥轮换/撤销、SSE 正常结束与客户端主动断开后的即时释放、超过 32 KiB 请求体被拒绝、插件 25 秒无响应返回 504 并释放连接与 R2 中转，以及大文件在真实 R2 模拟中的定长流/回退上传和读取后清理；GitHub OAuth 用例用 `outboundService` 桩替代 GitHub 端点，验证授权跳转、state 一次性消费、邀请领取与用户创建原子落库后签发会话、未受邀身份拒绝和白名单管理员登录；Cloudflare API Token 用例同样使用 `outboundService` 桩模拟 Token verify、accounts、subscriptions、Analytics、Zone、DNS 与 Worker Route 端点，覆盖固定六项权限、账号全分页与唯一账号校验、Free 计划确认、Token 密文保存、GET 不回显、旧凭据短路、真实 HTTP 错误和八项免费额度；删除 Token 不调用 Cloudflare 撤销。其中 SMTP 用例会在本机启动真实 SMTP 服务端，经 `worker-mailer` 完成真实 TCP 会话、PLAIN 认证与投递并校验邮件内容，再断言测试邮件、邀请邮件和维护通知的成功/失败路径；它仍不代表真实 Cloudflare 账号、公网 SMTP、GitHub OAuth 或多地域网络已联通。

workerd 需要 glibc 2.35 或更高版本；在较旧的发行版（例如 Ubuntu 20.04）上可通过容器执行：

```bash
docker run --rm -v "$PWD:/app" -v /etc/ssl/certs:/etc/ssl/certs:ro -w /app node:22-bookworm-slim ./node_modules/.bin/vitest run --config vitest.workers.config.ts
```

## 目录

- `src/`：管理端 SPA。
- `worker/`：Cloudflare Worker、Durable Object、D1 migration 和协议定义。
- `native-server/`：跨平台 C++ 服务器基础层和插件 C ABI。
- `native-ui/`：本地服务器 React 控制台；构建产物由 C++ localhost HTTP 服务从 `native-ui/dist` 静态目录提供，不编译进二进制。
