# Plugmesh 平台交接（HANDOFF）

更新日期：2026-10-24（Asia/Shanghai）

本文件只记录当前事实、恢复步骤和未完成边界。历史方案与逐步操作过程由 Git 保存，不再把已废止实现保留为现行说明。

## 0. 恢复卡

### 仓库状态

```text
仓库：/home/tc/work/plugin-platform
分支：main
远端：origin
fetch：https://github.com/shelter-red/plugin-platform.git
push：git@github-plugin-platform:shelter-red/plugin-platform.git
已推送代码/文档基线：680adb6d3ac5c3c37513022d1df5cfecf94f17c4
基线 Actions：平台验收 run 40090177061，completed/success
```

恢复后先运行，不能用本文中的历史 SHA 代替实时 Git 状态：

```bash
cd /home/tc/work/plugin-platform
git status --short --branch
git rev-parse HEAD origin/main
git log --oneline --decorate -12
```

`680adb6` 之后若有提交，应当只是普通交接记录，按约定只提交、不重复推送。是否仍然如此必须以实时 Git 输出为准。

### 当前结论

- 当前工作项：修复本地服务器导航跟随、Linux CA 信任链和配对码复制反馈；完成跨插件服务器 TCP 隧道并集成到 `plugmesh-server`。不提供独立通用映射程序；映射配置与监听生命周期最终由插件服务器及其本地 UI 管理。当前未提交实现包含源端 CLI 映射器、Worker 路由和目标端 TCP 隧道雏形，尚未证明完整端到端可用；Release 至少包含服务器程序及运行依赖、插件宿主、`server_api.h` 与嵌入库、`plugin_api.h` 与可构建 SDK/sample，以及集成映射功能所需源码和使用说明。
- 新增日志要求：插件服务器到 Worker 的通信日志必须在本机磁盘持久保留，检查轮转/容量上限与敏感字段脱敏；不得保存 access token、注册码、密码、会话或转发请求正文。
- 登录只使用管理员密码。首次未配置时进入 `/setup`，不再使用 GitHub OAuth、邀请登录或 `SETUP_TOKEN`。
- Cloudflare 业务凭据只接受账号 Email、Global API Key 和 Account ID，不接受 Cloudflare OAuth 或 API Token。
- 生产 D1 已应用 `0001` 至 `0009`，Cloudflare 1101 已消失；管理员密码已由用户完成初始化，D1 中 `admin_credentials=1`。
- 缺少 `admin_credentials` 表时返回结构化 `503 migration_required`，不会泄漏为 Worker 1101；其他 D1 错误继续抛出。
- Workers Builds 的 Deploy command 必须是 `npm run deploy`，但生产实际值尚未取得可信证据。
- 最新推送的完整 SHA `680adb6d3ac5c3c37513022d1df5cfecf94f17c4` 已通过平台 Actions，并由 Workers Builds 自动部署为版本 `9ba7c6c5-71e2-4040-b9ff-31c4f4db68b4`。

## 1. 协作与 Git 约束

1. 每个新步骤先在本文件登记范围并提交中文 Git 记录；没有登记不得继续修改。
2. 每步完成后把结果、验证和剩余边界写回本文件并提交。
3. 普通记录只提交不推送；只有功能增减、bug 修复或重大变动才集中推送。
4. 推送前运行与 Actions 对齐的本地验证；推送后只按完整 SHA 查询对应 run。
5. Actions 查询间隔至少约一分钟，不重复触发、不因观察超时重启任务。
6. 不回滚不属于当前步骤的用户改动；提交时显式 stage 文件。
7. 有官方 API、标准库或成熟开源实现时直接使用，不自行仿造替代协议或解析器。
8. 删除失效代码、重复入口、过期注释和冲突文案，不把兼容残留当现行功能。
9. 不输出、提交或写入任何密码、Global API Key、API Token、OAuth token 或会话 Cookie。

## 2. 当前产品契约

### 2.1 初始化与登录

- 密码状态只有 `configured`、`unconfigured`、`migration_required`。
- `unconfigured`：管理页面 302 到 `/setup`；管理 API 返回 `503 setup_required`。
- `migration_required`：`/api/health`、setup 和管理 API 返回结构化 `503 migration_required`；setup 不显示可提交密码表单。
- `/setup` 接受至少 12 个字符的密码和确认密码；校验失败留在原页面并允许重新输入。
- 密码使用 Web Crypto PBKDF2-SHA-256 和随机 salt 派生；当前版本化格式使用 100000 次迭代以符合 Cloudflare Workers 生产限制，旧版无前缀的 310000 次哈希仍可校验，D1 不保存明文。
- 初始化完成后 setup 关闭；后续使用 `POST /auth/login` 登录。
- 修改管理员密码必须校验当前密码，并撤销全部旧会话。
- 已初始化后访问 `/setup` 按普通 SPA/非路由行为处理，不返回专属不可用文案。
- `/control/*` 与 `/blobs/*` 保持各自协议鉴权，不受 setup 页面重定向影响。

### 2.2 Cloudflare 业务凭据

平台后台固定使用：

- Cloudflare 账号 Email
- Global API Key
- Account ID（单账号自动确定，多账号原地选择）

行为约束：

- 使用 `X-Auth-Email` 和 `X-Auth-Key` 调用 Cloudflare 官方 API。
- 保存前依次验证 `/user`、分页账号列表和 subscriptions。
- 多账号返回 `409 account_ambiguous` 和账号列表，用户在当前设置页选择后重试。
- Global API Key 使用 `SESSION_SECRET` 派生密钥进行 AES-GCM 加密；GET 永不回显明文。
- 保存插件域名后缀时，使用同一凭据查找 Zone、创建或复用代理通配 DNS 和 Worker Route。
- 第三方 DNS 或其他 Worker Route 冲突返回 409，不覆盖现有配置。
- 删除平台凭据只删除 D1 密文和用量缓存，不修改 Cloudflare 账号中的 Global API Key。

这里的 Global API Key 与部署脚本使用的 `CLOUDFLARE_API_TOKEN` 完全不同：前者是平台业务配置，后者只供 Wrangler 部署 D1、R2 和 Worker。

### 2.3 用量与配额

- 平台统计与 Cloudflare 官方统计分开显示。
- 平台请求数只计数、不设上限；连接数、R2 字节和对象数使用平台阈值。
- Cloudflare 区显示 Worker、D1 行读写、KV 读写删除列举、Durable Object 等官方用量、上限和百分比。
- 免费额度只从 subscriptions 和官方接口读取，系统设置不可手填。
- 未配置 Cloudflare 时 `/api/usage/cloudflare` 返回 `{configured:false,cached:false}`；`/api/usage/local` 仍独立返回 200。
- 用量页只有一个刷新入口，自动加载期间仍可手动刷新官方与本地数据。

### 2.4 Host 与域名

- 配置 `CONSOLE_HOSTNAME` 时，该 Host 始终进入管理端。
- 未配置时，只把 D1 中真实存在的插件域名识别为插件 Host，不能用宽泛后缀覆盖主站。
- 插件域名后缀应使用独立子域，例如 `plugins.example.com`，不要使用包含主站的父域。
- `[assets] run_worker_first = true` 保证插件公开 Host 先进入 Worker。

### 2.5 原生插件服务器与 Release

- 手动 workflow 支持 executable/shared、Linux/Windows/macOS、Release/Debug。
- Linux 产物以 Debian 11/glibc 2.31 为兼容基线，携带 OpenSSL 3，并检查 GLIBC/GLIBCXX/CXXABI 上限。
- Windows 产物携带 OpenSSL DLL；未注册双击可执行文件会打开本地 setup，注册成功后服务继续运行。
- 交互式配置校验失败后必须原地重新输入，不能要求用户重启程序。
- `v0.1.4` Release 已公开发布；三平台构建和 Release run `40154576302` 成功，平台验收 run `40154576466` 全部成功。
- Windows `v0.1.3` 正式发布包已在真实 Windows 10 主机校验摘要、包内容和生产 WSS/TLS 业务拒绝路径；`v0.1.4` 的默认插件目录和端口回退已通过 Linux、MinGW/Wine 与 Actions，正式包真机复核仍待执行。

## 3. 部署与 migration

唯一正确部署入口：

```bash
npm run deploy
```

它负责构建、创建或复用 D1/R2、应用全部 migration、检查待执行项、初始化 `SESSION_SECRET` 后再发布。`npx wrangler deploy` 或 `wrangler versions upload` 不能替代该流程。

缺表应急命令必须使用 Wrangler 官方 migration：

```bash
npx wrangler d1 migrations list plugmesh --remote --config wrangler.toml
npx wrangler d1 migrations apply plugmesh --remote --config wrangler.toml
```

不能手写 SQL 代替仓库 migration，也不能改写历史 migration。

### Workers Builds 实际配置

- Cloudflare 官方只读端点：`GET /accounts/{account_id}/builds/workers/{external_script_id}/triggers`。
- `external_script_id` 是 Worker immutable tag，不是 Worker 名称；响应定义包含 `deploy_command`。
- 官方权限要求至少一个：Workers CI Read 或 Workers CI Write。
- 当前 Wrangler OAuth 可以通过 Workers scripts list 读取 `plugmesh-worker` 的 tag，但访问 Triggers 返回 403 `Authentication error`。
- 当前环境没有可用的 Cloudflare API Token、Global API Key 变量或 Dashboard 登录态。
- 独立 Dashboard 会话停在人工 Turnstile，未绕过且已关闭。
- 因此生产 Deploy command 仍未确认；不得把仓库脚本或成功部署反推为控制台配置证据。

若以后获得 Dashboard 登录态或 Workers CI Read 凭据，先只读确认。若值不是 `npm run deploy`，修改生产配置前必须另行登记写入步骤。

## 4. 验证基线

当前推送基线 `58ae66a` 已有以下证据：

```text
npm run worker:typecheck                 通过
npm run build                            通过
npm run ui:conventions                   82 个 TSX，0 违规
npm run ui:css-audit                     467 条规则，0 死代码/重复定义
npm run worker:smoke                     22 个 smoke 脚本通过
npm run worker:runtime-test              17 个文件，80 个测试通过
npm run ui:smoke                         89 个测试通过
npm run deploy:worker:test               9 条部署路径通过
native CTest                            12/12 通过
native UI smoke                         5/5 通过
git diff --check                         通过
```

- Playwright 容器使用当前 UID/GID 和 `HOME=/tmp`，避免生成 root 所有权的 Vite 缓存。
- 推送 SHA：`a192a669a61ee7c2b46490f879d00544f12b22c2`，tag `v0.1.4`。
- 平台验收 run `40154576466` 的 web 与 Linux/Windows/macOS native 全部成功；Release run `40154576302` 的三平台构建和发布全部成功。
- Worker runtime 80/80 与部署路径 9/9 来自最后一次 Worker 代码变更基线；此后到 `a192a66` 没有修改 Worker 运行时代码。
- Worker runtime 日志中的强制约束和连接中断是故障注入用例预期输出，以测试退出码和汇总为准。

代码再次变更后必须重新运行与风险范围匹配的验证，不能沿用上述结果。

## 5. 生产现状

已完成：

- 生产 D1 已应用 `0001` 至 `0009`，复核为 `No migrations to apply`。
- `/api/health` 返回 200。
- 管理员密码已由用户完成初始化，D1 中 `admin_credentials=1`。
- `/` 返回管理端 HTML 200，不再误入插件代理。
- 已关闭的 `/setup` 与普通 SPA 非路由一致，返回管理端 HTML 200。
- `/api/me` 未登录返回 401，认证门禁正常。
- 原 Cloudflare 1101 已消失。
- setup 保存修复已由 Workers Builds 自动部署为版本 `5354e2bc-c0c3-42d8-9819-ec5b2137f27c`（2026-10-24 11:12:22Z）。
- 初始化前曾验证 `/api/health` 200、`/setup` 200，短密码 POST 原地返回 400；当时 D1 中 `admin_credentials=0`、setup 审计为 0，外键检查无异常。
- 未代用户设置密码，未修改 Cloudflare 业务凭据、DNS 或 Worker Route。

需要真实环境继续验收：

1. 用户使用已设置的密码验证登录、修改密码和旧会话撤销。
2. 确认 Workers Builds Deploy command 为 `npm run deploy`。
3. 登录后保存真实 Email、Global API Key 和 Account ID，验证 subscriptions、Analytics、Zone、DNS 与 Worker Route。
4. 配置公网 SMTP，验证 STARTTLS/SMTPS、维护通知和退信处理。
5. Windows `v0.1.3` 发布包的摘要、内容、TLS 和无效注册码业务拒绝已在真实 Windows 10 验证；用户已完成有效注册码绑定，仍需用 `v0.1.4` 正式包复核默认插件目录、端口回退、Credential Manager 往返和插件宿主子进程，并在目标 Linux 发行版验证发布包。
6. 在已部署 Worker 上完成 HTTP、SSE、WebSocket、大文件、断线恢复和持续并发压力测试；最近只读状态为 `servers=1`、`online_servers=0`、`plugin_instances=0`、`domains=0`，需先让 `v0.1.4` 服务器上线并加载插件。

第 1 项涉及真实密码，只能由用户操作；不得读取、生成、猜测或代为设置。第 2 项当前缺少可用的 Dashboard 登录态或 Workers CI Read 凭据。后续各项开始前仍需按第 1 节登记。

## 6. 关键文件

| 范围 | 文件 |
| --- | --- |
| 当前方案 | `方案.md` |
| 验收矩阵 | `docs/acceptance-matrix.md` |
| 初始化/登录 | `worker/src/auth.ts`、`worker/src/setup.ts`、`worker/src/index.ts` |
| 密码 migration | `worker/migrations/0009_password_auth.sql` |
| Cloudflare 凭据与用量 | `worker/src/cloudflare-credentials.ts`、`worker/src/usage.ts`、`worker/src/index.ts` |
| 管理端数据与设置 | `src/app/useConsoleData.ts`、`src/features/settings/` |
| 部署脚本 | `scripts/deploy-worker.sh`、`scripts/deploy-worker.test.sh` |
| 本地 CI | `scripts/ci-local.sh` |
| 原生服务器 | `native-server/`、`native-ui/` |
| 平台 Actions | `.github/workflows/platform-ci.yml` |
| 手动原生构建 | `.github/workflows/build-plugin-server.yml` |
| Release | `.github/workflows/release.yml` |

## 7. 关键提交与发布

| 提交/版本 | 内容 |
| --- | --- |
| `def40c0` | 首次密码初始化与密码登录 |
| `b1e93e1` | 移除 GitHub OAuth/邀请，改用 Cloudflare Email + Global API Key |
| `0695e77` | 修复主站被插件域名后缀误判 |
| `5dd388c`、`3182307` | 原生交互、Windows 生命周期和 Linux ABI 兼容修复 |
| `25c0b20` / `v0.1.1` | 首个 Linux ABI 兼容修复发布版本 |
| `bf68565` | 缺少密码 migration 时返回结构化初始化状态 |
| `4ce207c` | 已推送验收基线，Actions run `40082466727` 成功 |
| `989188e` | 修复生产管理员密码初始化、版本化 PBKDF2 与原子写入 |
| `2f1ad78` | 管理员密码初始化修复验收基线，Actions run `40088916661` 成功 |
| `e8409ba` | 修复无主站 Host 绑定时管理端误入插件代理 |
| `680adb6` | 主站 Host 回退修复，Actions run `40090177061` 成功 |
| `7639710` | 修复跨平台 TLS 信任链与服务器绑定失败 |
| `58ae66a` / `v0.1.3` | 跨平台 TLS 绑定修复版本；真实 Windows 发布包已验收 |
| `a192a66` / `v0.1.4` | 当前原生发布版本；Release run `40154576302`、平台验收 `40154576466` 成功 |

## 8. 禁止回流的旧方案

以下内容只能存在于不可改写的历史 migration、兼容识别或“必须不存在”的测试断言中，不能重新出现在活跃 UI、路由、帮助文档或业务配置：

- GitHub OAuth 登录、邀请登录、白名单和回调。
- Cloudflare OAuth 的 Client ID/Secret、scope、PKCE、`response_type`、`offline_access`、refresh/revoke。
- Cloudflare API Token 权限模板、六项权限清单和创建 Token 入口。
- `SETUP_TOKEN` 和 “Setup is not available”。
- 通过 `/?auth_error=` 传递错误。
- 手填 Cloudflare 免费额度。

允许保留：

- `worker/migrations/0002_cloudflare_oauth.sql` 等历史 migration。
- `legacy_oauth` 数据识别，用于提示重新配置，不能刷新或调用。
- 部署使用的 `CLOUDFLARE_API_TOKEN`，它不是平台业务凭据。
- 测试中的负断言和历史兼容 fixture。

## 9. 最近动作

- 2026-10-24：生产应用 `0009_password_auth.sql`，复核无待执行 migration；公开入口从 1101 恢复到首次 setup 状态。
- 2026-10-24：`bf68565` 增加 `migration_required` 三态门禁及 CI 容器所有权修复。
- 2026-10-24：`4ce207c` 推送；平台验收 run `40082466727` 完成成功。
- 2026-10-24：通过 Cloudflare 官方 Workers scripts list 读取 Worker tag；官方 Triggers GET 因当前 Wrangler OAuth 返回 403，未执行任何生产写入。
- 2026-10-24：登记并执行本次交接文档去历史化整理；完成提交后，下一安全动作仍是等待用户完成生产 `/setup` 或提供 Workers Builds 的只读核验条件。
- 2026-10-24：下一步登记（凭据术语与原生产物文档清理）：把 Cloudflare runtime 测试中仍称“Token”的 Global API Key 标题/响应变量改为准确术语，并修正 `docs/local-e2e.md` 对 executable artifact 不包含 `native-ui/dist` 的过期说明；保留会话 token、插件控制 token、部署 `CLOUDFLARE_API_TOKEN`、历史 OAuth fixture 和负断言。只改测试命名与文档，不改运行时行为；定向 runtime、文档搜索和 `git diff --check` 通过并记录前不进入下一步。
- 2026-10-24：凭据术语与原生产物文档清理完成：Cloudflare 设置测试统一使用 Global API Key/凭据术语，响应变量不再误称 token；本地 E2E 文档明确 executable 自带 `native-ui/dist`、shared 不带 setup UI、示例插件需单独准备。两份 runtime 定向测试 12/12、最终 Cloudflare 设置测试 7/7、残留搜索和 `git diff --check` 均通过，没有运行时行为变更。
- 2026-10-24：生产只读复核仍为 `/api/health` 200、`/` 302 到 `/setup`、`/setup` 200、`/api/me` 503 `setup_required`、`/auth/login` 302 到 `/setup`；用户尚未设置管理员密码。环境仍无 Cloudflare 业务凭据或 Workers CI Read 凭据，Wrangler OAuth 权限未变化。代码/文案 TODO 与废止方案残留扫描无新增结果；没有执行生产写入。
- 2026-10-24：下一步登记（生产 setup 保存失败）：用户在生产 `/setup` 提交密码后收到“请检查 D1 migration”的 503。只读核验确认 `0001` 至 `0009` 无待执行项，相关九张表及索引存在，`PRAGMA foreign_key_check` 无异常，默认工作区、现有 super admin 与 owner 成员关系完整，`admin_credentials` 仍为 0 行；因此现有页面把所有异常归因于 migration 是错误的。下一步核对线上部署版本与运行时限制，重构初始化写入为可分类、可重试且避免部分成功的流程，增加生产数据形态回归；验证完成后再集中推送，不代用户写入密码。
- 2026-10-24：生产 setup 保存修复已实现：Cloudflare `workerd` 官方源码确认 PBKDF2 存在生产环境迭代上限，新凭据改为带算法和迭代数的 `pbkdf2-sha256$100000$...` 格式，并兼容旧版 310000 次无前缀哈希；管理员补建、默认工作区成员、凭据、旧认证清理和审计现在处于同一个 D1 batch，任一步失败都会回滚。setup 按密码派生/数据库写入阶段记录不含秘密的错误编号，不再伪报 migration。Debian 12 容器定向 runtime 9/9、Worker typecheck 和 `git diff --check` 通过；完整验证与生产部署仍待下一步。
- 2026-10-24：生产 setup 修复推送前完整验收通过：Worker runtime 17 个文件 80/80、Worker smoke 22/22、UI smoke 89/89、部署脚本 9/9，管理端构建、Worker typecheck、82 个 TSX 约定审计、467 条 CSS 审计和 `git diff --check` 全部通过。runtime 中的强制 D1 约束、网络中断与 SMTP 重试日志均来自预期故障注入；下一步一次性推送当前 `main`，按完整 SHA 低频查看 Actions，通过后用唯一部署入口 `npm run deploy` 发布生产并只读复核，仍不代用户提交密码。
- 2026-10-24：`2f1ad78` 已推送，平台验收 run `40088916661` 完成成功；`changes`/`web` 成功，三个未涉及的 native job 正常跳过。Workers Builds 在 11:12:22Z 自动部署版本 `5354e2bc-c0c3-42d8-9819-ec5b2137f27c`。本地 `npm run deploy` 因没有独立 `CLOUDFLARE_API_TOKEN` 在上传前按设计停止，未绕过门禁；自动部署已完成，无需重复发布。生产只读复核为 health 200、setup 200、短密码校验 400，D1 凭据和 setup 审计仍为 0、外键检查为空；下一步由用户自行重新设置管理员密码。
- 2026-10-24：下一步登记（无控制台 Host 绑定时主站误入插件代理）：用户已成功完成生产 setup，D1 `admin_credentials=1`，`/api/me` 正常进入未登录 401；但生产版本没有 `CONSOLE_HOSTNAME` 绑定，`platform.shelter.red/` 和已关闭的 `/setup` 都返回 `404 Plugin domain not found`。根因是入口的 `isPluginHostname()` 已正确把没有 D1 域名记录的 Host 判为管理端，路由末端却再次无条件调用 `proxyPublicHost()`。下一步让非插件 Host 的最终回退直接返回 `ASSETS`，保留真实 D1 插件域名的代理行为；增加“密码已配置 + 无 `CONSOLE_HOSTNAME`”回归，并清理 README 中把所有 setup 保存失败归因于 migration 的过期说明。定向与完整验证通过后再集中推送，由 Workers Builds 自动发布并复核生产，不修改用户密码或域名数据。
- 2026-10-24：主站误入插件代理修复已实现：生产只读确认插件后缀为 `.shelter.red`，主站匹配该宽后缀但 `domains` 中没有 `platform.shelter.red`。路由在入口已排除真实插件 Host 后，最终回退现在直接返回管理端 `ASSETS`；插件代理内部也复用同一管理端响应，不再重复分叉。public proxy smoke 新增“密码已配置、无 `CONSOLE_HOSTNAME`、主站匹配宽后缀但无 D1 域名记录”的根因回归，并覆盖已关闭 `/setup` 回到 SPA；真实插件 Host 行为保持不变。README 已删除手写 D1 SQL 恢复主站的过期方案，并只在明确 `migration_required` 时指导执行 migration。定向 public proxy smoke、Worker typecheck 和 `git diff --check` 通过，完整验证与推送待下一步。
- 2026-10-24：主站路由修复推送前完整验收通过：Worker runtime 17 个文件 80/80、Worker smoke 22/22、UI smoke 89/89、部署脚本 9/9，管理端构建、Worker typecheck、82 个 TSX 约定审计、467 条 CSS 审计和 `git diff --check` 全部通过。runtime 中的网络断连日志来自预期故障注入且测试进程退出码为 0；下一步仅一次性推送当前 `main`，按完整 SHA 低频查看 Actions，通过后等待 Workers Builds 自动部署并只读复核 `/`、`/setup` 与 `/api/me`，不修改生产密码、插件后缀、DNS 或 D1 域名。
- 2026-10-24：`680adb6d3ac5c3c37513022d1df5cfecf94f17c4` 已一次性推送，平台验收 run `40090177061` 完成成功；`changes`/`web` 成功，三个未涉及的 native job 正常跳过。Workers Builds 自动产生版本 `9ba7c6c5-71e2-4040-b9ff-31c4f4db68b4`（版本 147，2026-10-24 11:31:04Z）。生产只读复核为 `/` 200 管理端 HTML、`/setup` 200 管理端 HTML、`/api/me` 401、`/api/health` 200，均不含 `Plugin domain not found`；D1 `admin_credentials=1` 且查询 `rows_written=0`。未修改用户密码、插件后缀、DNS 或 D1 域名，问题已闭环。
- 2026-10-24：下一步登记（生产协议验收前置清点与文档校准）：只读统计生产 `servers`、`plugin_instances`、`domains` 与近期 `request_logs` 的数量和状态，判断是否已有可用于 HTTP/SSE/WebSocket/文件流验收的目标；不读取 token/hash/会话/密码，不写 D1，不自行创建生产实体。根据结果校准恢复卡、验收矩阵中的当前 SHA、Actions、版本、setup 状态和自动化数量；若无现成在线目标，则明确记录真实端到端验收所缺的外部前置条件，不用桩测试冒充生产验收。完成只读查询、文档一致性检查和 `git diff --check` 后提交，普通记录不推送。
- 2026-10-24：生产协议验收前置清点完成：通过 Wrangler/D1 官方接口只读查询，生产 `servers`、`plugin_instances`、`domains`、`request_logs` 均为 0，在线服务器、已启用插件、在线域名及近 24 小时请求也均为 0；成功查询元数据为 `rows_written=0`。当前没有可用于生产 HTTP/SSE/WebSocket/文件流与断线恢复测试的目标，继续验收需用户先在真实主机注册服务器、加载插件并分配域名，不能由维护过程擅自造生产数据。恢复卡和验收矩阵已校准到推送 SHA `680adb6`、Actions run `40090177061`、Worker 版本 147、已完成 setup 及 runtime 80/80；文档一致性检查和 `git diff --check` 通过后提交，普通记录不推送。
- 2026-10-24：下一步登记（Workers Builds 部署命令只读核验）：依据 Cloudflare 官方 Builds API 文档，只使用 `GET /accounts/{account}/workers/scripts` 读取 `plugmesh-worker` 的 tag，再使用 `GET /accounts/{account}/builds/workers/{tag}/triggers` 读取生产 trigger 的 `deploy_command`。复用 Wrangler 当前用户登录凭据但不输出或落盘其 token，不调用 PATCH/POST、不触发或取消构建；若官方 API 返回 403，则记录缺少 `Workers Builds Configuration` 权限这一外部条件，不猜测私有接口。核验后同步 HANDOFF 与验收矩阵，完成文档搜索和 `git diff --check` 后提交，普通记录不推送。
- 2026-10-24：Workers Builds 部署命令只读核验完成但权限不足：Cloudflare 官方 `GET /workers/scripts` 返回 200，并成功定位 `plugmesh-worker` 的 immutable tag；随后官方 `GET /builds/workers/{tag}/triggers` 返回 403、错误码 10000 `Authentication error`。`wrangler whoami` 确认当前 OAuth token 有 `workers_scripts` 但没有 `workers_builds` scope，与官方文档要求的用户级 `Workers Builds Configuration` 权限缺口一致。未输出 token，未调用任何 PATCH/POST，也未触发构建。生产自动部署成功不能证明 trigger 的 `deploy_command` 必然是 `npm run deploy`；要闭环只能在 Dashboard 查看，或提供具有 `Workers Builds Configuration` 权限的用户级 API token 后重试同一 GET。
- 2026-10-24：下一步登记（真实 Windows 发布包基础验收）：通过 WSL/Win32 桥接在实际 Windows 10 主机下载 GitHub Release `v0.1.1` 的 Windows zip，按 GitHub 发布摘要校验 SHA-256 并检查服务器、插件宿主、OpenSSL DLL 和 `native-ui/dist` 等必需文件；使用隔离临时目录和本地端口启动未注册可执行程序，验证进程持续存活、setup 状态 API 与 UI 可达，再用重定向输入验证短本地口令失败后原地重新提示。检查同期 Windows Application Error 后终止测试进程并删除临时文件；不使用生产注册码，不写 Credential Manager，不创建生产服务器。若发布包或运行行为有缺陷，先记录证据再进入修复，不能用源码构建或 Wine 结果替代发布包真机结论。
- 2026-10-24：真实 Windows `v0.1.1` 发布包基础验收完成并发现独立打包缺陷：Windows PowerShell 对下载文件计算的 SHA-256 与 GitHub 官方发布摘要 `cbf59d...e81a1` 一致；`plugmesh-server.exe`、OpenSSL DLL 和 `native-ui/dist/index.html` 存在，未注册进程在隔离端口持续存活，`/api/status` 返回 `configured=false`、系统凭据存储可用，UI 返回 HTML 200。CLI 输入短本地口令后实际出现第二次 `Local UI password` 提示及 `please enter it again`，无效注册码最终退出 1，未创建凭据文件；同期 Windows Application Error 为 0。测试进程已终止、临时目录已删除、未写 Credential Manager 或生产 D1。发布 zip 缺少 README 明确要求同目录存在的 `plugmesh-plugin-host.exe`，与 release workflow 的 Windows/macOS 打包漏复制一致；该缺陷待单独修复，不能把本次基础通过写成完整真机验收。
- 2026-10-24：下一步登记（生产服务器绑定失败诊断）：针对用户在本地 setup 提交后只看到“服务器绑定失败”，先通过 Wrangler/D1 官方接口只读统计注册码的有效、已用、过期状态，核对服务器行和 `server.registration_code.created`/`server.registered` 审计时间；不读取 `code_hash`、`token_hash`、密码或会话，不创建/消费注册码，不修改生产数据。同时核对本地 registration client、setup API 与 UI 错误传递链，区分注册码、Worker URL/TLS、网络和凭据保存阶段。取得证据后先记录根因，再修复具体错误被 `registration_failed` 统一吞掉的问题及已确认的实际故障；验证完成前不推送。
- 2026-10-24：生产服务器绑定失败根因已确认：生产 D1 只读查询显示当次注册码未消费、`servers` 为 0 且没有 `server.registered` 审计，查询均未写入；当前 Windows 构建在提交配置后以 `0xc0000005` 退出，Linux 构建对同一路径以 `SIGSEGV 139` 退出，均未生成凭据文件。两平台共同故障定位到 WSS 客户端的 socket init handler：`registration_client.cpp` 与 `control_client.cpp` 都在该阶段通过 `connection_hdl` 调用 `get_con_from_hdl()` 读取 URI，连接对象此时尚不能安全解引用。UI 同时把所有 `registration_failed` 固定显示为“服务器绑定失败”，掩盖注册码、网络、TLS 和凭据保存的真实阶段。诊断过程没有读取或输出真实注册码、token/hash、密码或会话，没有修改生产数据。
- 2026-10-24：下一步登记（修复 WSS 绑定崩溃与错误分类）：在创建 WebSocket 连接前使用 WebSocket++ URI 解析目标 hostname，TLS socket init handler 只捕获该稳定值并据此配置 hostname verification 与 SNI，不再从回调中的 `connection_hdl` 反查连接；注册和正式控制客户端同步修复。注册结果增加稳定错误分类，本地 API 返回可预测代码，native UI 通过中英文 locale 分别显示注册码无效或过期、无法连接 Worker、TLS 验证失败和凭据保存失败，不展示不可控底层英文。使用仓库现有 Asio/OpenSSL/WebSocket++ 增加本地 WSS 回归，并覆盖 API/UI 映射；Linux 本地构建还要对生产地址使用固定无效测试码确认得到业务拒绝而非崩溃，不能创建凭据。定向测试、完整 `ctest`、native UI smoke、Worker 回归和 `npm run ci:local` 全部通过后再集中推送；Windows 修复产物需真机确认不再访问冲突。
- 2026-10-24：服务器绑定修复已实现：注册与控制客户端均在建立连接前解析 hostname，TLS socket init handler 不再通过 `connection_hdl` 反查连接；Worker 注册响应和本地 `/api/register` 现在携带稳定错误码，native UI 已加入中英文的注册码、连接、TLS、响应和凭据保存提示。新增本地可信 WSS、注册码拒绝、主机名不匹配回归；Linux 修复构建对生产地址使用固定无效测试码以退出码 1 返回“Registration code is invalid or expired”，无 SIGSEGV 且无凭据文件。全量原生构建和 11/11 CTest、Worker registration race、隔离三插件目录 native UI 5/5 已通过；MinGW Windows 构建及 Windows 注册 smoke 通过且不再出现 `0xc0000005`，但该 Windows 进程访问生产地址时收到连接失败（当前主机网络路径限制），因此 Windows 的生产业务拒绝仍以 Linux 结果为准。下一步运行完整 `npm run ci:local`、复核 diff 后再推送，不能把 Windows 网络限制写成服务端注册码错误。
- 2026-10-24：提交后发现临时构建目录 `native-server/build-binding-fix` 不在原有忽略规则内，已从提交索引撤出并补充 `native-server/build-*/` 忽略规则；该目录只由本次本地验证生成，不属于源代码或发布物。
- 2026-10-24：下一步登记（修复正式 Release 原生包缺少插件宿主）：当前 `release.yml` 的 Windows/macOS 打包只复制 `plugmesh-server`、UI、README 和运行库，漏掉与服务器运行必需的 `plugmesh-plugin-host`；同时漏掉 README 已要求随包提供的 `plugin_api.h`。此前真实 Windows `v0.1.1` 包已证实缺少宿主，不能把手动构建 workflow 的正确打包当作正式 Release 已修复。下一步只统一 release workflow 的三平台可执行包内容与手动 artifact 契约，保留 shared 包的 `server_api.h` 边界；增加 workflow 静态打包断言或可执行的归档内容检查，完成 YAML 校验、定向构建/打包验证、`git diff --check` 和本地 CI 后提交。Actions 仍按低频检查，功能修复完成后再集中推送。
- 2026-10-24：正式 Release 打包修复已实现：Windows/macOS executable 包现在与 Linux 和手动 artifact 一致携带 `plugmesh-plugin-host` 与 `plugin_api.h`，没有改变 shared 包的 `server_api.h` 契约；新增 `scripts/release-workflow.test.sh` 及 `npm run release:workflow:test`，检查关键复制步骤和顺序，避免正式 Release 再次漏掉运行必需文件。定向契约测试和 `git diff --check` 已通过；下一步做 YAML 解析、完整 `npm run ci:local` 和原生打包相关验证后再提交/集中推送。
- 2026-10-24：下一步登记（将 Release 契约纳入 CI 门禁）：把 `npm run release:workflow:test` 加入 `scripts/ci-local.sh` 和平台验收 web job，使正式发布包的宿主/ABI 头文件复制约束在每次相关推送中自动检查；不引入新的 YAML 解析依赖，仍由 GitHub Actions 自身解析 workflow。修改前先完成本条记录，修改后运行定向契约测试、完整 `npm run ci:local`、`git diff --check` 并提交。
- 2026-10-24：Release 契约已纳入本地 CI 与平台 web job；`release:workflow:test` 通过，完整 `npm run ci:local` 通过（UI 约定、CSS 审计、Worker 类型检查、全部 Worker smoke、管理端 UI 89/89），本地归档内容核对确认包含 `plugmesh-server`、`plugmesh-plugin-host`、`plugin_api.h`、README 和 `native-ui/dist`。YAML 解析工具 Ruby 不在当前环境，未把工具缺失误报为通过；GitHub Actions 自身负责 workflow 解析。上一轮绑定修复 Actions run `40094580276` 已完成成功；正式 Release 修复待本次两个提交集中推送后由新 run 验证。
- 2026-10-24：下一步登记（发布服务器绑定修复版本）：只读确认 GitHub 已有 `v0.1.1` Release，但其三平台资产来自修复前 workflow，Windows 包已实测缺少 `plugmesh-plugin-host.exe`；当前 `package.json` 与 lockfile 版本仍为 `0.1.1`。本轮 WSS 绑定崩溃修复、错误分类、正式 Release 打包修复和 CI 契约门禁均已完成，下一步将版本更新为 `0.1.2`，提交后一次性推送 `main` 与 `v0.1.2` tag，触发正式 Release workflow 生成新资产；不覆盖旧 Release，不修改生产 D1、凭据或域名。发布完成后低频检查 Release Actions 及资产清单。
- 2026-10-24：`v0.1.2` 已发布：版本提交 `bb01c6a` 与 tag 已推送；正式 Release run `40096879998` 的标签校验、Linux、macOS、Windows 构建和创建 Release 全部成功，平台验收 run `40096880166` 也成功。GitHub Release 资产包含三个平台 zip 与 `SHA256SUMS`；实际下载核对确认 Windows 包包含 `plugmesh-server.exe`、`plugmesh-plugin-host.exe`、`plugin_api.h`、README 和 `native-ui/dist/index.html`，Linux/macOS 包同样包含服务器、插件宿主、ABI 头文件、README 和 UI。旧 `v0.1.1` 保留不覆盖；生产 D1、凭据和域名未修改。
- 2026-10-24：下一步登记（服务器绑定失败的跨平台 TLS 诊断与信任链修复）：用户仍报告“服务器绑定失败”，当前代码只调用 OpenSSL 默认根证书路径；Windows 发布包未携带 CA bundle，OpenSSL 可能无法使用 Windows 系统根证书，最终被 UI 归类为泛化绑定失败。下一步抽取仓库已有 TLS 初始化逻辑，使用 OpenSSL 官方 API 加载默认路径，并在 Windows 通过系统 ROOT 证书库补充信任证书；同时保留主机名校验和 SNI，不降低 TLS 验证强度。补充无根证书路径的可诊断失败、Linux/Windows 编译与 WSS smoke，更新错误传递和文档，先完成验证再集中推送；不读取或修改生产注册码、凭据、D1 或域名。
- 2026-10-24：服务器绑定 TLS 修复完成：新增共用 `tls_support`，Linux 继续使用 OpenSSL 默认信任路径，Windows 通过系统 `ROOT` 证书库把系统根证书加入 OpenSSL trust store；主机名校验与 SNI 仍强制启用，默认信任路径失败且没有可用 Windows 根证书时明确抛出诊断错误。注册客户端和控制客户端不再重复维护 TLS 初始化。新增 TLS context smoke；Linux 原生 CTest 12/12、可信 WSS/主机名不匹配注册 smoke、MinGW Windows `plugmesh-server`/注册 smoke/TLS smoke 编译和 Wine TLS smoke 均通过。原生 UI 首次验证发现测试仍期望 3 个插件而当前构建实际有 4 个，已同步断言并恢复 native UI 5/5；完整 `npm run ci:local` 通过（Worker smoke、管理端 UI 89/89、发布包契约、构建与审计）。本轮尚未推送，未访问或修改生产注册码、凭据、D1 或域名。
- 2026-10-24：下一步登记（发布跨平台 TLS 绑定修复）：当前 `v0.1.2` 资产不含 `7639710` 的 Windows 系统根证书加载修复，不能让用户继续下载旧包。下一步把 npm/package-lock 版本更新为 `0.1.3`，保留历史 `v0.1.2`，运行发布 workflow 契约、完整本地 CI、原生 Linux/MinGW 验证后，集中推送 `main` 与 `v0.1.3` tag；只按完整 SHA 检查平台验收和 Release run，不频繁轮询，不修改生产数据。
- 2026-10-24：`v0.1.3` 已发布：提交 `58ae66a` 与 tag 一次性推送；Release run `40100341851` 的标签校验、Linux/macOS/Windows 构建和创建 Release 全部成功，平台验收 run `40100341893` 的 web 与 Linux/macOS/Windows 原生 job 全部成功。公开 Release 含三平台 zip 和 `SHA256SUMS`；当前网络下载 GitHub 大文件 120 秒无数据后超时，因此未把本机解包冒充完成。使用同提交 MinGW 构建的 Windows `plugmesh-server.exe` 经 Wine 访问生产 `https://platform.shelter.red`，固定无效注册码已穿过 TLS/WSS 并收到业务层 `Registration code is invalid or expired`，退出码 1 且凭据文件不存在，证明本轮 TLS 信任链修复路径生效；未创建或消费有效注册码，未修改生产 D1、凭据或域名。
- 2026-10-24：下一步登记（真实 Windows 验收 `v0.1.3` 发布包）：生产只读统计仍为服务器、在线服务器、插件实例和域名均 0，查询元数据 `rows_written=0`；GitHub Release API 显示 `v0.1.3` 三平台资产均已上传但下载数仍为 0，因此尚无用户侧重试证据。下一步通过 WSL/Win32 桥接让真实 Windows 10 主机下载官方 Windows zip 和 `SHA256SUMS`，校验摘要并核对服务器、插件宿主、ABI 头、UI 与 OpenSSL DLL；在隔离目录用固定无效注册码访问生产 WSS，必须得到业务拒绝而非 TLS 失败/访问冲突，且不得创建凭据或生产服务器。核对同期 Application Error 后停止进程并清理临时文件；同时修正本节两条 TLS 记录的时间顺序。完成结果只提交 HANDOFF，不因验收记录再次推送。
- 2026-10-24：真实 Windows `v0.1.3` 发布包验收完成：Windows 10 IoT Enterprise LTSC `10.0.19044` 直连 GitHub Release 失败后，按桥接规范仅对下载使用 `gh-proxy.com` 镜像，并以 GitHub Release 官方 `SHA256SUMS` 校验；Windows zip 的 SHA-256 为 `ea1f83dc1424e88ab3337bc730888d39a976f9afd907675d643c7b971f509b04` 且匹配。包内 `plugmesh-server.exe`、`plugmesh-plugin-host.exe`、`plugin_api.h`、README、`native-ui/dist/index.html`、`libssl-3-x64.dll` 与 `libcrypto-3-x64.dll` 均存在。发布二进制使用固定无效注册码访问生产 WSS，明确返回 `Registration code is invalid or expired`、退出码 1、未生成凭据文件，同期 Windows Application Error 为 0；隔离目录已清理。随后生产 D1 只读复核 `servers=0`、`rows_written=0`，未创建或消费有效注册码，未修改凭据、插件或域名。当前绑定修复已在真实发布物闭环，下一步需用户下载 `v0.1.3`、生成新注册码并执行真实绑定，才能继续生产插件协议验收。
- 2026-10-24：下一步登记（校准原生发布验收文档）：当前 HANDOFF 产品契约和关键提交表仍把 `v0.1.1` 标为当前版本，`docs/acceptance-matrix.md` 仍称 Windows 发布物等待真机验收，`docs/local-e2e.md` 仍称 Windows 只经过 Wine，均与 `v0.1.3` 的真实 Windows 验收冲突。下一步仅更新现行状态和边界：记录 `v0.1.3`、Release/平台 Actions、原生 CTest 12/12、已验证的发布包内容/TLS/失败重试路径，并保留“真实有效注册码绑定、插件宿主进程、Credential Manager 往返、目标 Linux 真机”仍待验收；历史动作记录不改写。完成残留搜索和 `git diff --check` 后提交，普通文档不推送。
- 2026-10-24：原生发布验收文档校准完成：HANDOFF 产品契约、验证基线、生产待验收和关键版本表均更新到推送 SHA `58ae66a` / `v0.1.3`、Release run `40100341851`、平台验收 `40100341893` 和原生 CTest 12/12；验收矩阵新增“部分发布物已验证”状态，注册码绑定与 Release 条目记录真实 Windows 证据；`docs/local-e2e.md` 删除“Windows 只在 Wine 验证”的过期边界。现行文档一致保留有效注册码绑定、Credential Manager 往返、插件宿主子进程和目标 Linux 发布包仍待验证；搜索剩余 `v0.1.1`、11/11 和 Wine 描述均仅位于不可改写的历史动作记录。`git diff --check` 通过，纯文档结果只提交不推送。
- 2026-10-24：生产真实绑定前置条件连续第三次复核仍未满足：D1 只读统计 `servers=0`、`online_servers=0`、`plugin_instances=0`、`enabled_plugins=0`、`domains=0`、`online_domains=0`，查询元数据 `rows_written=0`；GitHub Release API 中 `v0.1.3` 三平台 zip 与校验和下载计数仍均为 0。代码修复、真实 Windows 发布包和生产 WSS/TLS 拒绝路径均已验证，继续生产 HTTP/SSE/WebSocket/文件流、Credential Manager 和插件宿主验收必须先由用户下载 `v0.1.3`、在管理端生成新注册码并完成有效绑定。维护过程不得代为生成/消费注册码或创建生产实体，当前目标按外部前置条件标记阻塞；用户完成绑定后从生产服务器状态只读复核继续。
- 2026-10-25：下一步登记（修复绑定后误入 setup、本地端口冲突与重复复制入口）：用户已完成真实服务器绑定，但原生进程仍因未设置 `PLUGMESH_PLUGIN_DIRECTORY` 输出 `entering local setup`；setup 页面明确允许插件目录留空，当前行为错误地把运行期插件目录校验和绑定凭据校验混为一体。下一步让可执行服务器在插件目录未显式配置时使用可执行文件同级 `plugins`，目录不存在时创建为空目录并以 0 插件正常启动，不放宽共享库 API 对调用方显式配置的契约；本地管理服务从首选端口（默认 `8787`）开始尝试绑定，占用时顺序递增至可用端口，浏览器和日志必须使用实际端口。管理端一次性配对码弹窗移除文本组件自带的第二个复制控件，只保留一个带错误处理的显式复制按钮。增加原生配置/启动端口回退和管理端唯一复制入口回归，完成 Linux CTest、native UI、MinGW 编译、完整本地 CI 与 diff 检查后集中推送并发布新原生版本；不读取或输出注册码、token/hash、密码或会话，不修改生产实体。
- 2026-10-25：绑定后启动、端口回退与配对码复制修复完成：独立可执行程序现在只用 Worker URL、服务器 ID 和访问令牌判断是否需要注册 setup，插件目录留空时创建并使用可执行文件同级 `plugins`；共享库 `validate_config` 仍要求宿主显式传入插件目录。真实 Linux 二进制在不设置 `PLUGMESH_PLUGIN_DIRECTORY` 时直接进入插件发现和本地 UI 路径，没有再次输出 `entering local setup`。本地 HTTP 服务先用 Asio 实际探测首选端口，占用或拒绝时顺序递增，状态、控制台提示和 setup 浏览器均使用实际监听端口；Linux CTest 与 MinGW/Wine 均用被占用端口验证回退后 API 可达。一次性注册码弹窗已移除 Ant Design 文本自带复制控件，只保留一个显式复制按钮，并增加唯一性断言。Linux 全量原生构建及 CTest 12/12、MinGW 全目标构建、Wine 端口 smoke、native UI 5/5、完整 `npm run ci:local`（Worker smoke、管理端 UI 89/89、构建与审计）和 `git diff --check` 全部通过。尚未发布新 Release；用户当前 `v0.1.3` 二进制不会自动获得修复，下一步单独升级版本并触发三平台 Release，低频检查 Actions 后再通知下载。
- 2026-10-25：下一步登记（发布原生启动与端口修复版本）：当前公开 `v0.1.3` 不包含提交 `0ad1336` 的默认插件目录、绑定状态判断、端口冲突自动递增和配对码单一复制入口修复。下一步把 npm/package-lock 版本更新为 `0.1.4`，保留历史 Release，运行发布 workflow 契约、版本一致性、`git diff --check` 和必要构建检查后，创建 `v0.1.4` tag 并与 `main` 一次性推送。推送后以完整提交 SHA 查找平台验收与 Release run，至少间隔约一分钟低频检查，不重复触发 workflow；三平台资产和 `SHA256SUMS` 齐全前不宣称发布完成，不修改生产 D1、注册码、凭据、插件或域名。
- 2026-10-25：`v0.1.4` 已发布：版本提交 `a192a669a61ee7c2b46490f879d00544f12b22c2` 与 tag 已一次性推送；Release run `40154576302` 的标签校验、Linux/macOS/Windows 构建和创建 Release 全部成功，平台验收 run `40154576466` 的 changes、web 与三平台原生 job 全部成功。公开 Release 目标提交与推送 SHA 一致，三平台 zip 和 `SHA256SUMS` 均为 `uploaded`；没有重复触发 workflow。发布过程未修改生产 D1、注册码、凭据、插件或域名。下一步由用户下载 `v0.1.4` 重启已绑定服务器，确认不再因插件目录为空进入 setup，并观察首选端口占用时控制台输出的实际本地 UI 地址。
- 2026-10-25：下一步登记（修复本地 UI 导航、Linux TLS 根证书和复制反馈）：用户反馈本地服务器左侧菜单不随右侧滚动更新，页面到底部时菜单不可见；Linux 绑定报告 TLS 证书验证失败但 Windows 正常；生成配对码后点击复制无成功反馈。实现计划是让桌面侧栏固定在视口并可独立滚动，用标准 IntersectionObserver 跟踪当前内容区并同步菜单状态，同时保留小屏横向导航；Linux Release 包携带 Debian 11 构建环境的 CA bundle，TLS 初始化优先加载随包根证书并继续验证主机名，不关闭证书校验；复制成功时显示可访问的短暂状态反馈。同步说明 `plugin_api.h` 是插件 ABI，插件不链接服务器库；shared artifact 的 `libplugmesh-server` 面向嵌入式宿主。通用多端口/多协议转发需另行定义 Worker 到插件服务器的隧道帧、路由配置和端口上报契约，本轮先评估现有协议边界并记录设计建议，不擅自改变线上协议。验证完成后记录 Linux/macOS/Windows 构建兼容性、UI 定向检查与打包清单，再集中发布；不修改生产实体或凭据。
- 2026-10-25：下一步登记（跨插件服务器的 TCP/WebSocket 隧道）：用户明确目标不是本机 TCP 转发，而是通用映射程序监听可配置本地 TCP 端口（例如 SSH 客户端连 `127.0.0.1:2222`），把任意二进制流经 WebSocket 发给 Worker；Worker 按用户选定的另一台插件服务器路由到该服务器；目标插件服务器依映射配置连接可配置目标地址/端口（例如 `127.0.0.1:22`），双向原样转发数据，连接关闭/错误沿原通道收敛。映射配置需选择由 Worker 发现并提供的在线目标插件服务器名称，不能硬编码服务器或 SSH 的端口/协议。当前控制协议只支持文本 JSON，Worker 通过单服务器 Durable Object 建立控制连接；目标发现 API、服务器间寻址、映射配置持久化/授权、二进制分帧与通道隔离、流控、大小限制、超时、重连及兼容旧版服务器均未设计。现有未提交 `plugmesh-port-mapper` 只是本机 TCP 转发器，不能作为此需求实现或发布。先基于现有 Worker `durable-object.ts`/`index.ts`、服务器 `ControlClient` 与映射程序确定端到端协议和测试边界；实现源端、Worker 路由、目标端 socket 与管理端配置/服务器发现的完整链路，补双端协议集成测试及断连/未授权/多路并发回归；Release 包继续包含源码与编译程序。完成全量本地 CI、Linux 原生测试和 Windows 交叉构建后再提交并推送，Actions 低频检查；不写生产 D1 或创建测试服务器。
- 2026-10-25：用户补充协议可为最终效果重设计，且尽量降低传输数据量、可压缩时允许压缩。实现选型：控制面只传会话 ID、目标服务器、地址/端口等小型控制字段；数据面使用每条 TCP 会话独立的 WebSocket 二进制通道，WebSocket message/frame 边界不定义 TCP 记录边界，接收端按序拼接并原样写入 socket，不将业务字节编码为 JSON/base64。HTTP、WebSocket、SSH/TCP 都是透明 TCP 字节流，协议标签用于配置/呈现；Worker 负责授权和会话配对，不能做无法支持的 raw TCP ingress。压缩按负载收益选择：SSH 已加密数据通常不可压缩，不应默认消耗 CPU/引入延迟；可评估协商式、逐块独立压缩，仅当编码后更小才发送，并限制解压大小与 CPU，未验证三平台可靠 codec 前保持不压缩。安全边界：源端服务器凭据不能任意驱使目标端连接任意公网/内网地址；目标地址必须有目标端允许列表，默认仅 loopback，以免映射功能变成 SSRF/内网扫描入口。初版 Worker 会话层已开始实现（目标发现、source/target WebSocket 配对、二进制原样转发），尚未接入原生映射器和目标 TCP socket，未完成不得发布。定向 Worker typecheck 通过；本地 Vitest/workerd 无法启动，当前系统 glibc 低于该 `workerd` 二进制所需的 GLIBC 2.32，runtime 测试未执行，不能误报通过。后续先复核 Worker DO 授权/生命周期/资源配额并补测试，再接原生两端及配置/目标名称选择，更新旧映射器说明；实现、测试与发布都尚未完成。
- 2026-10-25：用户进一步明确要求移除目标地址 loopback 限制，允许映射访问任意公网/内网地址，但每次/每条映射必须提供目标插件服务器登录密码作为授权。不得把源服务器控制令牌误当作目标登录密码；检查 `native-server` 本地 UI 密码验证/凭据存储边界，在目标插件服务器本地验证目标密码，Worker 只传递必要的会话挑战/授权结果，禁止落盘或写通信日志。经目标服务器密码验证后，目标 TCP 连接允许任意有效 IP/DNS 主机和端口。当前未提交实现仍有 Worker `isAllowedTunnelHost` 与目标 `ControlClient::handle_tunnel_open` 的 loopback 检查，下一步须按本授权要求一并移除并补任意主机的授权/拒绝回归。由于这会赋予隧道任意网络出口能力，仍须确保仅持有目标插件服务器登录密码的用户可发起连接、握手抗重放、速率/并发受控、错误和日志不泄漏密码；本条是用户确认的产品需求，不再采用默认 loopback 白名单作为最终行为。
- 2026-10-25：用户澄清目标服务器登录密码只在首次建立源服务器到目标服务器的信任时验证；后续隧道不重复验证，只有目标服务器轮换本机 UI 登录密码时才要求重新授权。设计应是目标插件服务器本地持久化 trusted source server ID 列表，并将其绑定到当前 local UI password verifier 的代际/指纹；成功首次验证才添加源 ID，检测到 verifier 改变时清空旧信任。密码和 verifier 都不能发送/保存到映射器或 Worker，持久信任数据不能与 verifier 一起泄漏；目标服务器在每次 tunnel.open 时仍须验证发起源身份属于当前 Worker 已认证/批准的同工作区映射关系，并限制速率/并发。须先检查 credential 文件、系统凭据存储、共享库环境配置各自适合的持久化边界，再实现跨重启有效、密码轮换失效的回归；不要将“一条 TCP 会话一次验证”误作最终生命周期。
- 2026-10-25：用户确认本机另有 WSL Ubuntu 26.04，glibc 满足 `workerd` 需要的 2.32+；此前当前 shell 的 GLIBC 版本不足只是当前发行版限制，不是不可用测试环境。下一步按 `wsl-windows-bridge` 技能核验 Ubuntu 26.04 是否可启动、仓库路径可访问及 Node 依赖可用，并优先在该发行版运行 `worker:runtime-test`/CI；若需从 Windows 路径桥接，按技能使用 `wslpath` 和非破坏性命令，不复制生产凭据或更改生产数据。测试尚未在 Ubuntu 26.04 实际运行前，不得记录为已验证。
- 2026-10-25：Ubuntu 26.04 运行环境核验：从 Ubuntu 20.04 WSL 通过 `/mnt/c/Windows/System32/wsl.exe` 成功启动 `Ubuntu-26.04`，确认系统为 Ubuntu 26.04.1、glibc 2.43；但该发行版未安装 Node/npm，且当前仓库位于 Ubuntu 20.04 的 `/home/tc/work/plugin-platform`，不能从 Ubuntu 26.04 直接访问。首次以共享 UNC 工作目录启动时出现路径翻译失败；改为 Windows 共享盘 `/mnt/c` 为启动目录后可正常执行目标发行版命令。尚未复制仓库、安装运行环境或执行 Worker runtime tests，不能记为测试通过。后续需在隔离的临时共享目录准备源码和 Node，再运行定向 runtime tests；不复制生产凭据、不修改生产数据，清理临时副本并记录结果后再继续。
- 2026-10-25：用户明确要求插件开发头文件增加足够的中文注释并统一 pretty format，风格为左大括号同行、长声明不折行；这是 `plugin_api.h` 插件动态库 ABI 的要求，不是给 `server_api.h` 服务器嵌入接口或第三方依赖头文件做格式化。当前 `plugin_api.h` 仅对 ABI v4 的 SSE cancel 有局部说明，缺少 ABI 版本兼容、宿主/插件生命周期、回调线程与缓冲区所有权等面向插件作者的契约说明。下一步仅完善 `plugin_api.h` 的准确中文注释和格式，并同步插件开发文档/示例说明；先核对实现调用位置以免虚构线程、生命周期或内存所有权约束，再执行 ABI 编译与 sample plugin 测试、发布包契约和 diff 检查，完成后单独提交并将实际验证写回 HANDOFF；在该步骤记录并提交前不进入下一项。
- 2026-10-25：插件 SDK 范围调整：用户明确不接受 `plugin_api.h` 中 v4/v3 嵌套和多个 ABI 版本共存，要求新版本直接重写完整头文件与插件协议。上一条“给现有多版本 ABI 补注释”的计划已被此要求取代；工作区曾开始的头文件注释修改尚未提交，必须随统一迁移一起重写，不能保留嵌套兼容入口。下一步盘点 ABI 版本识别、动态库导出符号、插件宿主 IPC、manifest、示例和测试的全部调用路径，设计单一当前 ABI 与单一插件协议后一次性迁移实现、开发文档和 Release SDK；不得维持 v2/v3/v4 的回退或并行协议。注释用中文，C/C++ 左大括号同行，长声明保持单行；保持 C ABI，不引入自定义替代现成工具。验收需覆盖 C 与 C++ 头文件编译、sample 插件完整加载/生命周期与请求协议、manifest 校验、Release 包 SDK 契约，以及全量原生测试和 `git diff --check`。每阶段先写此 HANDOFF 并提交，再继续后续阶段；Ubuntu 26.04 runtime 测试环境当前仍缺 Node/npm 且看不到工作区，不能将其记为已验证。
- 2026-10-25：单一插件 ABI 方案确定：使用平铺结构 `plugmesh_plugin_api`，唯一导出符号 `plugmesh_plugin_get_api`，当前 ABI 固定为 1；所有请求能力、WebSocket open/close 和 SSE cancel 回调位于同一个结构，不再使用 v2/v3/v4 类型、嵌套 `base`、版本化 getter 或 loader 回退。能力按同一结构中的可选函数指针声明，`start`、`stop`、`health` 必需；manifest `abiVersion` 只接受 `1`。插件宿主保留现有操作语义，但按单一 ABI 统一 describe 与分派，不做旧 IPC/ABI 兼容。旧版插件必须使用新头文件重编译，旧 manifest 被明确拒绝。阶段实现范围：重写 `plugin_api.h` 与 loader/host API 类型、迁移全部 sample 与 manifest 生成/测试，再统一 host IPC、manager 能力校验和文档；每个阶段验证、更新 HANDOFF 并提交后再进入下阶段。本方案来自对 loader、manifest、plugin-host 主循环、manager、sample 与 smoke 全仓搜索，不是只对头文件做外观改写。
- 2026-10-25：通用映射交付形态调整：用户明确要求不再单独提供通用程序，TCP 监听、映射配置、目标 socket 与 Worker 隧道能力必须集成进 `plugmesh-server`。此前 Release workflow/CMake 中的独立 `plugmesh-port-mapper` 目标、独立配置样例和命令行文档都不再是最终交付；当前工作区未提交的 `native-server/src/port_mapper.cpp` 与包配置要迁移为服务器内部模块/接口，不得只删目标造成需求缺失。实现设计需让服务器作为源端接收本地 TCP 并通过现有 Worker WebSocket 隧道转发，同时在目标服务器侧按授权配置连接目标地址/端口；设置和映射生命周期应归服务器进程与本地 UI 管理。移除独立可执行程序、单独运行说明和 Release 资产；发布包保留集成后的服务器及必要开发文件。此变更必须与上一条单一插件 ABI 迁移及测试边界协调，先完成并记录 ABI 阶段后再进入映射集成阶段。
- 2026-10-25：单一 ABI 首阶段验证现状：Linux 原生增量构建的 plugin-host、四个 sample 动态库、loader/host/manager/crash/WebSocket lifecycle smoke targets 均编译通过。当前 `native-server/build` 的 `ctest` 报 `No tests were found`，现有 CMake 构建目录未注册测试；尝试头文件 C++ 编译时本机 g++ 不识别 `-std=c++20`（提示支持 `c++2a`），因此 CTest 与 C++ 头文件验证尚未完成，不能记录为全套通过。应重新检查 `enable_testing`/构建配置并使用本机实际支持的 C++ 标准完成验证；C 头文件验证命令也需独立确认。
- 2026-10-25：单一插件 ABI v1 迁移完成：`plugin_api.h` 重写为中文注释、平铺结构和单一 `plugmesh_plugin_get_api` 符号；loader 删除所有 v2/v3/v4 getter、嵌套 API 和回退路径，manifest 只接受 `abiVersion: "1"`，host/manager 按同一 ABI 上报可选 WebSocket 生命周期与 SSE cancel 能力。所有 sample、CMake manifest、原生 smoke、Worker 测试 fixture、README 与中英文帮助已迁移；新增非当前 ABI manifest 拒绝回归。Linux 全量构建通过，原生 CTest 12/12；MinGW Windows plugin-host、四个 DLL 和 loader/host/manager 相关 smoke 全部编译通过，DLL 导出检查只有 `plugmesh_plugin_get_api`；头文件 C11 与本机支持的 C++2a 语法检查、`git diff --check` 通过。扫描到的旧 ABI 文本仅为负向测试 fixture，未保留运行时兼容。下一阶段转向映射功能集成：把现有独立 `port_mapper.cpp` 能力重构进 `plugmesh-server`，配置与监听生命周期由服务器/本地 UI 管理，目标端隧道连接仍遵循首次目标密码信任、轮换后重新授权和任意目标地址的产品约束；同步删除独立 mapper 二进制、CMake/Release 资产、示例配置和文档入口。该 ABI 步骤现已记录并提交前，不开始下一阶段。
- 2026-10-25：映射集成第 1 阶段登记（先把 TCP 映射运行时纳入服务器进程）：当前已确认 `native-server/src/port_mapper.cpp` 是独立 CLI，自己解析 JSON、创建 WebSocket++ 客户端、启动 detached 会话线程且没有停止接口；`ControlClient` 已有 Worker 下发到目标服务器的 TCP 隧道处理，`TunnelTrustStore` 已有基于当前 verifier 的持久信任雏形，但 source listener、配置/状态 API 与服务器主循环尚未集成。此阶段限定为将源端监听/单连接转发重构为服务器可持有、可 stop/wait 的模块，复用 Worker URL、server ID、access token 和现有 TLS 实现；由 `plugmesh-server` 生命周期拥有并启动/停止，配置暂从受保护的本地 JSON 配置文件加载，为后续本地 UI 管理建立服务接口。删除独立 `plugmesh-port-mapper` CMake/Release 可执行目标与独立 CLI 入口，不删除映射能力、Worker 隧道或必要配置格式；不新增另一个控制连接。增加端口冲突、坏配置、正常启动停止和一条本地 TCP 往返到 mock 隧道的定向测试，Linux 原生 CTest 和 MinGW Windows 编译必须通过。完成后更新本条验证结论并提交；提交前不得开展 UI/API 配置阶段。后续阶段再把映射 CRUD、目标服务器发现和 listener 状态接入本地认证 UI，并落实目标服务器首次口令信任/口令轮换失效与任意目标地址授权约束。
