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
- 多工作区与三角色权限：`workspaces`/`workspace_members` 记录 owner、operator、viewer 三种角色，服务器、插件实例、域名、访问日志、注册码和审计日志均按 `workspace_id` 隔离；管理端顶栏可切换工作区，`/api/workspaces` 提供创建、重命名、删除与成员角色管理，viewer 的写操作在前端禁用、后端 403；`super_admin` 可跨工作区查看但需显式切换，平台级设置仍由超级管理员维护。
- 控制 token 使用 SHA-256 摘要后与 D1 字段比对。
- SMTP 配置使用 `worker-mailer` 开源依赖，支持密文保存、脱敏读取和管理员测试发送。
- Cloudflare Analytics GraphQL 查询按 5 分钟写入 D1 缓存，权限错误和未配置状态会明确返回；D1、KV 和 Durable Object 官方用量也参与维护判定。
- 平台全局配额计数：请求窗口、活跃连接、R2 对象和字节用量；官方 Analytics 的 D1 查询、KV 操作和 Durable Object 请求达到阈值后同样自动进入维护模式。
- 维护模式支持全局暂停流量、停止新增域名/插件操作，并通过已配置 SMTP 向超级管理员发送带重试和审计记录的通知。
- Worker Cron 定时清理 30 天访问日志、180 天审计日志、过期会话、注册码和临时 R2 对象。
- 插件公开访问日志记录状态、耗时和错误摘要，并按用户隔离展示在管理端。
- Worker 静态资源绑定管理端 SPA，控制台、API 和插件域名共用统一入口。
- 一键部署脚本自动准备 D1/R2、执行迁移、生成基础设施 Secret 并发布 Worker；SMTP 和 Cloudflare 业务凭据在管理后台完成。
- 一次性 `/setup` 初始化入口：未配置时所有管理页面进入初始化页，首次设置至少 12 个字符的管理员密码，后续只使用该密码登录；密码以 PBKDF2 派生结果保存。
- Cloudflare Global API Key：使用 Cloudflare Email、Global API Key 和 Account ID 验证账号，从 subscriptions 确认 Free 计划和官方额度，并在保存插件域名后缀时自动同步 DNS 与 Worker Route；密钥只以 AES-GCM 密文保存且永不回显。
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

管理端默认启用管理员密码登录；仅查看无后端的静态空态时可使用 `VITE_AUTH_ENABLED=false npm run dev`。

`npm run ui:smoke` 由五个 Playwright 项目组成：`preview`（4183，静态空态、主题、响应式和弹窗）、`a11y`（4183，axe 逐页扫描 13 个页面 × 深浅主题）、`screenshots`（4183，双主题 × 1440/1024/390 截图矩阵）、`worker-mock`（4184，用拦截响应验证加载态、错误重试、Toast、维护状态，以及注册码生成、域名分配校验和插件加载等表单流程）与 `auth`（4185，初始化、密码登录与窄窗口布局、axe 扫描和截图基线）。

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

> **唯一部署必填项：连接 Cloudflare Workers Builds 账号。** 本仓库没有额外部署变量。D1/R2 ID、`SESSION_SECRET`、管理员密码、Cloudflare 业务凭据、SMTP、配额和维护策略都不需要出现在部署页。

| 部署方式 | 必填 | 可选 |
| --- | --- | --- |
| Cloudflare 部署按钮 | Cloudflare 账号授权 | 无 |
| 本地一条命令 | `CLOUDFLARE_API_TOKEN`（仅供 Wrangler 部署） | `CLOUDFLARE_ACCOUNT_ID`（仅多账号） |

本地令牌至少需要 Workers Scripts: Edit、D1: Edit、Workers R2 Storage: Edit。

### 方式一：Cloudflare 部署按钮

点击 README 顶部的 Deploy to Cloudflare 按钮并授权账号后：

1. 授权 Cloudflare 账号；
2. 确认 Workers Builds 预填的命令为 `npm run build` 和 `npm run deploy`；
3. 部署脚本自动创建并绑定 D1 `plugmesh`、R2 `plugmesh-blobs` 和 Durable Object；
4. 脚本自动执行全部 migrations、生成基础设施 Secret 并发布 Worker；
5. 打开 Worker 地址进入 `/setup` 设置管理员密码。

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
5. 首次缺失时生成 `SESSION_SECRET`，已有值不轮换；
6. 发布 Worker。

部署统一由 Cloudflare Workers Builds 触发（`WORKERS_CI=1` 时脚本自动进入托管模式），仓库不再保留 `deploy.yml` 部署工作流；本地或自有 CI 仍可直接执行 `npm run deploy`，只需配置 `CLOUDFLARE_API_TOKEN`，多账号环境再设置 `CLOUDFLARE_ACCOUNT_ID`。

### 部署故障排查：接口报 `no such table`

出现 `D1_ERROR: no such table: workspaces` 之类的错误，说明当前 Worker 版本已经发布、但远端 D1 还停在旧 schema（多数情况是 Deploy command 没走 `npm run deploy`）。先补齐迁移，再把 Deploy command 改成 `npm run deploy`：

```bash
npx wrangler d1 migrations list plugmesh --remote   # 列出待应用 migration
npx wrangler d1 migrations apply plugmesh --remote  # 补齐后重新发布即可
```

### 部署后只做一次业务初始化

先使用 Cloudflare 提供的默认地址 `https://<worker-name>.<workers-subdomain>.workers.dev/setup`，自定义域名可以稍后再绑定。

首次访问 `/setup` 设置管理员密码。密码至少 12 个字符，并需要重复输入确认；校验失败时页面保留并允许立即重新输入。保存成功后 `/setup` 关闭，后续使用该密码登录。未完成初始化前，所有管理页面都会进入 `/setup`，管理 API 返回 `503 setup_required`。若新代码已发布但密码 migration 尚未应用，`/api/health`、setup 和管理 API 会返回结构化 `503 migration_required`，不会退化成 Cloudflare 1101。

以下配置全部在登录后的管理后台完成，不需要重新部署：

| 配置项 | 管理后台位置 |
| --- | --- |
| 管理员密码修改 | 系统设置 → 管理员密码 |
| Cloudflare Email、Global API Key、账号与官方用量 | 系统设置 → Cloudflare |
| SMTP 和测试发送 | 系统设置 → 邮件 SMTP |
| 配额、维护策略、插件域名后缀 | 系统设置 → 维护、域名与配额 |

管理员密码创建后 `/setup` 关闭。修改密码会撤销全部已有登录会话，需要使用新密码重新登录。`SESSION_SECRET` 必须保留，不能随意轮换，否则已有密文将无法解密。

### 登录失败排查

密码错误时登录接口返回 `401 invalid_password` 并停留在登录页。尚未初始化时登录接口返回 `503 setup_required`，浏览器管理入口会进入 `/setup`。若初始化保存失败并提示检查 D1 migration，请先执行 `npx wrangler d1 migrations apply plugmesh --remote`，确认 `0009_password_auth.sql` 已应用后重试。

### Cloudflare Global API Key

平台只接受 Cloudflare 账号 Email、Global API Key 和 Account ID，不使用 OAuth 或 API Token。Global API Key 是账号级密钥，不需要创建权限模板或选择 scope；可在 Cloudflare Dashboard 的 **My Profile → API Tokens → Global API Key** 查看。该密钥权限较高，应仅由平台超级管理员录入。

保存时平台先通过 `/user` 验证 Email 与 Global API Key，再读取账号列表和 subscriptions。未填写 Account ID 且账号不唯一时，接口返回 `409 account_ambiguous` 并在当前表单列出可选账号；选择后再次保存即可。保存插件域名后缀时，平台使用同一凭据查找 Zone、写入通配 DNS 记录并创建 Worker Route，无需手动配置 DNS。

Global API Key 只以 AES-GCM 密文保存在 D1，GET 设置接口永远不回显明文。Cloudflare 拒绝凭据时，平台保留真实 HTTP 状态和错误码；删除平台保存的凭据只清除本地密文和用量缓存，不会改动 Cloudflare 账号中的密钥。

用量页唯一的“刷新用量”按钮会重新读取官方 Analytics；免费额度只能从 subscriptions 读取，未确认 Free 计划时不会展示或允许手填八项上限。用量页同时分开显示平台本地统计与 Cloudflare 官方监控：平台请求只计数、不设上限，因此 `/api/usage/cloudflare` 返回 `configured=false` 时 `/api/usage/local` 仍返回 200 和本地数据。

### 自定义域名与插件域名

默认 `workers.dev` 地址可以直接用于初始化、登录和后台管理。保存插件域名后缀后，平台会通过 Global API Key 自动配置插件通配域名的 DNS 和 Worker Route；管理端自定义域名仍需按部署环境配置对应入口，例如：

- `console.example.com/*`：管理端和管理 API；
- `*.plugins.example.com/*`：插件公开入口。

随后在后台把插件域名后缀设为 `plugins.example.com`。插件后缀不要使用包含管理端主站的父域名：例如主站是 `platform.example.com` 时，不要填写 `example.com`，应使用 `plugins.example.com`。新增插件域名会立即使用该后缀，不需要修改环境变量或重新部署。`PLUGIN_DOMAIN_SUFFIX` 仅用于本地测试和旧数据兼容回退，不是部署必填项。

如果错误后缀已经让主站返回 `Plugin domain not found`，可先在 Cloudflare Dashboard → D1 → `plugmesh` → Console 执行下面的应急更新，把 `plugins.example.com` 替换为实际插件后缀；恢复访问后再从系统设置保存一次，让平台用 Global API Key 自动同步 DNS 和 Worker Route：

```sql
UPDATE platform_settings
SET value_json = json_set(value_json, '$.pluginDomainSuffix', '.plugins.example.com'),
    updated_at = datetime('now')
WHERE key = 'platform';
```

### 校验与高级选项

```bash
npm run deploy -- --dry-run     # 只构建并校验 bundle，不访问云端、不写密钥、不发布
npm run deploy -- --skip-build  # 复用已有 dist，只做资源准备与发布
npm run deploy -- --help
```

`--dry-run` 不需要 D1 ID 或云端凭据。真实部署时脚本会自动创建或复用资源；通常不需要设置 `SESSION_SECRET` 或任何 Cloudflare 业务凭据/SMTP 环境变量。

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

## 手动构建插件服务器

打开 GitHub Actions 的「手动构建插件服务器」workflow，选择：

- 产物类型：`executable`（`plugmesh-server`）或 `shared`（`libplugmesh-server` / 平台对应的共享库）。
- 目标平台：Linux、Windows 或 macOS。
- 构建类型：`Release` 或 `Debug`。

workflow 只接受手动触发，不会因为普通推送重复构建。每个 artifact 包含所选服务器产物、`plugmesh-plugin-host`、插件 ABI 公共头、`server_api.h`（共享库）和构建说明，并附带 `SHA256SUMS`。共享库通过 `native-server/include/plugmesh/server_api.h` 提供稳定 C ABI；可执行程序仍使用 `--register` 或环境变量完成绑定。

下载 artifact 后先在根目录校验 `SHA256SUMS`（Linux：`sha256sum -c SHA256SUMS`；macOS：`shasum -a 256 -c SHA256SUMS`），再按 [`src/content/help.zh-CN.md`](src/content/help.zh-CN.md) 或 [`native-server/README.md`](native-server/README.md) 绑定服务器、设置 `PLUGMESH_PLUGIN_DIRECTORY` 并加载插件。可执行 artifact 已包含 `native-ui/dist`，未注册时双击 `plugmesh-server` 会自动打开首次绑定页；共享库不是独立程序，也不包含 setup UI，宿主必须链接 `server_api.h` C ABI 并负责保存已绑定凭据。

## 发布原生端

推送 `v*` tag 会在 Ubuntu、Windows 和 macOS runner 上构建 `plugmesh-server`，并发布到对应 GitHub Release。也可以手动运行「发布原生端」workflow，但必须填写 `v*` 格式的 `release_tag`；需要手动选择可执行文件/共享库、平台或 Debug/Release 时，请使用上面的「手动构建插件服务器」workflow：

| 产物 | 说明 |
| --- | --- |
| `plugmesh-server-linux.zip` | Linux x86_64，内含兼容 glibc 2.31 基线的 OpenSSL 3 |
| `plugmesh-server-windows.zip` | Windows x64，内含随包 OpenSSL DLL |
| `plugmesh-server-macos.zip` | macOS，运行时需 `brew install openssl@3` |
| `SHA256SUMS` | 三个 zip 的 SHA-256 校验和 |

产物不做代码签名。下载后先校验再运行：

```bash
sha256sum -c SHA256SUMS
```

也可以按 [`native-server/README.md`](native-server/README.md) 从源码构建，自行确认工具链与依赖版本。

## 当前边界

当前提交建立了可编译的 MVP 基础，但没有把生产凭据放入仓库。C++ 服务器已支持独立 sidecar `manifest.json` 校验、ABI v2/v3/v4 插件生命周期、健康检查、文件流、出站控制连接、SSE 流及 ABI v4 协作式取消、公开 WebSocket base64 二进制桥接，以及基于子进程的插件崩溃隔离；Worker 侧已具备管理员密码认证、Cloudflare Global API Key 凭据、HTTP/SSE/文件流式响应、公开 WebSocket 桥接、R2 一次性对象、Cloudflare Analytics 查询和基于 `worker-mailer` 的 SMTP 测试发送能力；管理端已具备对应的 Cloudflare 和 SMTP 配置入口。平台本地用量快照按 Cron 保存 30 天，用于管理端请求趋势展示。这些功能仍需在真实 Cloudflare 资源、SMTP 和本地服务器之间完成端到端联调。

上述 `worker:*:smoke` 使用本地 mock D1、Durable Object 和外部端点，只验证协议、权限边界和敏感字段处理。`npm run worker:runtime-test` 使用官方 `@cloudflare/vitest-plugin` 在 workerd/Miniflare 中加载根目录 `wrangler.toml`、真实 D1 迁移和真实 Durable Object 类，覆盖管理员密码初始化与登录、Host 路由、HTTP 转发、并发 requestId 隔离、公开 WebSocket connectionId 隔离、断线维护、注册码并发消费、密钥轮换/撤销、SSE 正常结束与客户端主动断开后的即时释放、超过 32 KiB 请求体被拒绝、插件 25 秒无响应返回 504 并释放连接与 R2 中转，以及大文件在真实 R2 模拟中的定长流/回退上传和读取后清理。Cloudflare 用例使用 `outboundService` 桩模拟 `/user`、accounts、subscriptions、Analytics、Zone、DNS 与 Worker Route 端点，覆盖 Email + Global API Key 验证、账号全分页与唯一账号校验、Free 计划确认、凭据密文保存、GET 不回显、真实 HTTP 错误和八项免费额度。SMTP 用例会在本机启动真实 SMTP 服务端，经 `worker-mailer` 完成真实 TCP 会话、PLAIN 认证与投递并校验邮件内容，再断言测试邮件和维护通知的成功/失败路径；它仍不代表真实 Cloudflare 账号、公网 SMTP 或多地域网络已联通。

workerd 需要 glibc 2.35 或更高版本；在较旧的发行版（例如 Ubuntu 20.04）上可通过容器执行：

```bash
docker run --rm -v "$PWD:/app" -v /etc/ssl/certs:/etc/ssl/certs:ro -w /app node:22-bookworm-slim ./node_modules/.bin/vitest run --config vitest.workers.config.ts
```

## 目录

- `src/`：管理端 SPA。
- `worker/`：Cloudflare Worker、Durable Object、D1 migration 和协议定义。
- `native-server/`：跨平台 C++ 服务器基础层和插件 C ABI。
- `native-ui/`：本地服务器 React 控制台；构建产物由 C++ localhost HTTP 服务从 `native-ui/dist` 静态目录提供，不编译进二进制。
