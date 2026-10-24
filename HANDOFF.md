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
- `v0.1.1` Release 已公开发布；三平台构建和 Release run `40050681670` 成功。

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

推送基线 `2f1ad78` 已有以下证据：

```text
npm run worker:typecheck                 通过
npm run build                            通过
npm run ui:conventions                   82 个 TSX，0 违规
npm run ui:css-audit                     467 条规则，0 死代码/重复定义
npm run worker:smoke                     22 个 smoke 脚本通过
npm run worker:runtime-test              17 个文件，80 个测试通过
npm run ui:smoke                         89 个测试通过
npm run deploy:worker:test               9 条部署路径通过
git diff --check                         通过
```

- Playwright 容器使用当前 UID/GID 和 `HOME=/tmp`，避免生成 root 所有权的 Vite 缓存。
- 推送 SHA：`2f1ad78ecd70642061927868deee79576e431d71`。
- 平台验收 run：`40088916661`，`changes`/`web` 成功，三个 native job 按路径过滤跳过。
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
5. 在真实 Windows 主机和目标 Linux 发行版验证 `v0.1.1` 产物。
6. 在已部署 Worker 上完成 HTTP、SSE、WebSocket、大文件、断线恢复和持续并发压力测试。

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
| `25c0b20` / `v0.1.1` | 当前原生发布版本 |
| `bf68565` | 缺少密码 migration 时返回结构化初始化状态 |
| `4ce207c` | 已推送验收基线，Actions run `40082466727` 成功 |
| `989188e` | 修复生产管理员密码初始化、版本化 PBKDF2 与原子写入 |
| `2f1ad78` | 管理员密码初始化修复验收基线，Actions run `40088916661` 成功 |
| `e8409ba` | 修复无主站 Host 绑定时管理端误入插件代理 |
| `680adb6` | 当前已推送验收基线，Actions run `40090177061` 成功 |

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
