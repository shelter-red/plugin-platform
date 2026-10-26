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

- 当前工作项：完成跨插件服务器 TCP 隧道并集成到 `plugmesh-server`。不提供独立通用映射程序；映射配置与监听生命周期由插件服务器及其本地认证 UI 管理。当前源端监听和 Worker/目标端隧道代码已进入服务器进程，但映射仍通过本地配置文件启动，UI 尚无 CRUD/目标发现，授权流程与持久配置尚待完成；不得称整体映射功能已完成。Release 包含服务器程序及运行依赖、插件宿主、开发 SDK/sample，以及随服务器交付的映射能力，不含独立 mapper。
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

## 10. 当前追加步骤登记

- 2026-10-26：Termux builder 镜像拉取连续在容器启动前因 layer `Verifying Checksum` 失败（runs `40212288376`、`40213267114`、`40214333438`、`40216624871`、`40217358211`）；改用用户提供的 Android 15/AArch64 Termux 设备原生构建。Termux clang 21.1.8、CMake 4.4.4、OpenSSL 3.6.3/zlib 均可用；`scripts/build-termux-native.sh --artifact-type ALL --build-type Release --include-ui` 成功，产物为 Android 24/AArch64，动态库均解析到设备 Termux/Bionic，归档 SHA-256 `a2ab6e54e5cab6b3d8ce75440a032209f7f56f584978ce22defef77f135f666b` 已在设备端和本地验证。Release workflow 正加上按标签读取且校验源提交的预构建资产分支，完成本地契约验证后推送、重建最终标签源对应包并发版；绝不把 Linux/glibc 包冒充 Termux 包。

## 9. 最近动作

- 2026-10-25：额度口径复核确认主仓 `ae10ee6` 与 `~/pay/cfpay` 的 `927cf60` 均已在代码中统一 D1 账户级自然日统计，但两仓均尚未推送/部署，因此线上首页与平台监控仍可能显示旧口径。本阶段先完成内置映射授权回归的编译与验证，再分别核对两仓测试和 `git diff --check`；不在未验证前推送或修改生产数据。

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
- 2026-10-25：Worker ABI 遗漏已修复：`SUPPORTED_PLUGIN_ABI_VERSIONS` 固定为 `['1']`，manifest smoke 改为接受 v1、拒绝 v2/v3/v4/v5；manifest、server-sync、完整 `npm run worker:smoke` 和 `npm run worker:typecheck` 均通过。根因修复后恢复映射集成第 1 阶段；该 ABI 补丁需与 HANDOFF 一起单独提交。
- 2026-10-25：映射交付形态更新：不单独提供通用端口映射程序，TCP 监听和隧道源端必须作为 `plugmesh-server` 的内置功能随服务器启动/停止。当前工作区已将映射运行时代码编入 `plugmesh_core` 并由服务器主循环持有；生产 CMake/Release 不生成或发布独立 mapper 可执行程序。现阶段仍通过 `PLUGMESH_PORT_MAPPINGS_FILE` 加载映射，目标服务器首次信任口令来自 `PLUGMESH_TARGET_PASSWORD`；映射 CRUD、Worker 目标服务器选择、信任状态管理尚未接入本地 UI，故“集成进服务器”已落实，但用户可配置/管理的完整工作流未完成。Release 应只发布内置能力随附的服务器、配置格式及文档，不得恢复独立 mapper 资产。验证：`npm run ci:local` 全部通过（Playwright 89/89）；Linux 原生 CTest 13/13，MinGW Windows 服务器与 smoke 构建通过，Wine 映射 smoke 通过；Worker runtime 18 个文件、82/82 通过，Worker smoke/typecheck 通过。提交映射功能前仍须完成本地 UI/API 管理和完整授权生命周期验证；本记录不代表映射整体完成，也不授权推送不完整功能。
- 2026-10-25：下一步登记（内置映射的本地管理界面与授权）：先复用 `LocalHttpServer` 的 Cookie 会话鉴权和现有 React 本地 UI，不创建独立程序或重复认证机制。为映射增加经过认证的 Worker 在线目标服务器发现、映射列表/创建/更新/删除、监听启停与运行状态 API；持久化配置由服务器进程管理并保证原子写入，不能依赖用户手工维护环境变量 JSON。UI 提供目标服务器选择、监听地址/端口、目标地址/端口和传输标签，显示冲突/授权/连接状态，并允许重新授权、删除映射。首次信任必须由目标服务器自身校验其本地 UI 登录密码；密码只用于首次验证，Worker 只转发端到端密码证明，不接收明文密码/可重放凭据；目标服务器信任持久化且绑定本机密码 verifier 代际，密码轮换后使信任失效。先检查已有密码 verifier 格式及 OpenSSL API，采用标准 HMAC/PBKDF2 等实现，不自创密码算法；若现有材料无法实现不向 Worker 泄露密码的挑战响应，先修正协议并补安全测试再接 UI。补 API 鉴权/输入校验/持久化失败/端口冲突/重启加载/目标离线/首次授权及密码轮换测试；原生 UI smoke 覆盖 CRUD 与失败提示，Worker runtime 覆盖同工作区目标发现与隧道生命周期。阶段开始前本记录已提交；完成后记录实际边界和验证并中文提交，验证通过后再判断是否与其它重大功能集中推送，不频繁触发 Actions。
- 2026-10-25：下一步登记（短生命周期状态内存化及自动刷新）：系统性盘点 Worker、Durable Object、本地插件服务器和管理 UI 的状态读写/刷新。凡可由当前连接、进程内计数或持久业务数据即时重建的运行态，不写入 D1；服务器 heartbeat 不得触发 D1 写入，插件服务器 WebSocket 断开即以内存态判为离线。服务器身份、token hash、插件期望状态、映射/域名配置和必要审计仍需跨重启保留，不得为追求内存化而丢失。服务器/插件/映射目标列表、操作可用性及公开路由必须统一依赖当前活动连接态，不能继续把 D1 中缓存的 `status` 当在线事实；DO 重启后未重连即视为离线。检查现有页面定时刷新是否覆盖服务器、插件和映射目标状态，增补自动刷新与请求去重/节流/组件卸载清理，避免形成高频 Workers/D1 请求。测试覆盖 heartbeat 零 D1 写、建立/替换/断开连接状态、DO 重启语义、列表/目标发现/路由一致性和自动刷新生命周期。先完成代码与测试、更新本条实际验证结果后选择性提交；工作区已有映射、TLS、SDK、Release 等未提交修改，严禁整体暂存/回退或未经功能闭环推送。
- 2026-10-25：运行态内存化与自动刷新阶段实现完成：heartbeat 只被接收，不再更新 D1；插件服务器 online/offline 以 Durable Object 当前 WebSocket 的 `/status` 为唯一实时来源，关闭时立即清除内存连接与 pending/public sockets，不写服务器/插件/域名离线批处理。服务器列表、概览、详情、插件操作、同步、域名分配及 Worker 隧道目标发现均读取实时连接状态；公开路由不再被陈旧 D1 online/offline 字段误拦，实际断线由代理 DO 即时返回离线。Cloudflare Analytics 五分钟可重建缓存从 D1 `usage_cache` 移入 isolate 内存，并移除凭据变更时为清缓存额外执行的 D1 删除。插件服务器本地 UI 维持 5 秒本地状态刷新，映射目标增加 15 秒静默刷新，含请求去重和卸载清理。新增 heartbeat 零 D1 写 smoke，更新路由、服务器同步、代理测试；旧的依赖 D1 断线批处理竞态测试已删除，其测试前提被新内存态语义取代。验证：Worker typecheck、Worker smoke 全部通过；native-ui TypeScript/Vite build 和 `git diff --check` 通过。`worker:runtime-test` 未运行成功：当前 Ubuntu 20.04 的 glibc 2.31 无法加载 workerd 所需 GLIBC_2.32+；不得记录 runtime Vitest 通过。提交后下一步审计仍会逐请求写 D1 的平台请求计数、SSE 活跃连接计数/快照等其他可重建运行态，并评估一致性边界，不得将全局限额改成不可靠的 isolate 本地硬限制。
- 2026-10-25：额度差异只读根因登记：`cfpay/src/cloudflare-analytics.ts` 将 D1 Analytics 按 `CLOUDFLARE_D1_DATABASE_ID` 限定到单个数据库，并展示 UTC 当天；平台 `worker/src/index.ts` 的 Resource Analytics 查询未限定 database ID，汇总账户下全部 D1，且按滚动 24 小时生成日期后将日期截断，D1 日期维度在跨 UTC 零点时包含两个日分组。两个项目的免费读写上限常量当前相同（500 万 rows read、10 万 rows written），但用量范围/窗口不同；故当前明确差异是已用量口径，不能据此断言 Cloudflare 实际额度单位。下一步先依据 Cloudflare 官方当前 D1 Analytics/Free limit 文档核实限额是账户还是数据库维度，再统一两个产品的 database scope、UTC 日切和刷新缓存显示；分别覆盖 UTC 零点、指定数据库过滤/账户汇总和额度百分比，不更改生产 Cloudflare 凭据或部署。此项属于独立后续步骤，修改前仍须先提交该 Handoff 登记。
- 2026-10-25：D1 免费额度官方口径已核实（Cloudflare 官方 [D1 Pricing](https://developers.cloudflare.com/d1/platform/pricing/) 与 [D1 Limits](https://developers.cloudflare.com/d1/platform/limits/)）：Free rows read 500 万/日、rows written 10 万/日均按账户累计；总 storage 5 GB 也按账户全部数据库汇总；日限额在 UTC 00:00 重置，超出账户每日读/写限额会使账户 D1 查询失败。官方 Analytics 文档同时提供按 `databaseId` 查询与 account-wide rows read/write 查询示例。下一步实施统一口径：cfpay 的 homepage D1 rows read/write 从单库查询改为 account-wide，不能再用单库用量除以账户级免费上限；平台 Worker 的 D1 rows read/write Analytics 固定查询当前 UTC 自然日，避免 rolling 24h 跨日后把两个 `date` 分组累加。Worker requests 保持其单独的 rolling-24h 口径并在 UI 保留明确 period 信息；D1 的 quota百分比仅使用同一 account-wide 当日数据。cfpay storage 应确认 Analytics 返回按数据库分组后逐库取最新小时再求和，满足 account-wide 5 GB 口径。测试需要覆盖 UTC 午夜边界、多数据库聚合、每库最新 storage 样本与行额度百分比；本地验证后分别提交两个仓库的中文可追溯记录，不调用生产部署或输出密钥。
- 2026-10-25：D1 额度显示口径已统一实现。cfpay 移除 Analytics 对单个 `databaseId` 的依赖，rows read/write 使用账号级查询；Storage 查询覆盖账号数据库并逐库取最新小时样本求和，百分比相对账号 5 GB 总限额。平台 Worker 在同一 Resource Analytics 请求新增 `d1Today` alias，按当前 UTC 日期取账号累计 rows read/write，Worker requests/KV/DO 仍按各自 rolling-24h 日期窗口；响应增加 `d1Period`，D1 两项 UI 明示统计 UTC 日期，避免把窗口差异混为同一数字。cfpay 不再需要 Worker runtime 的 `CLOUDFLARE_D1_DATABASE_ID` 配置，部署脚本使用的 `CFPAY_D1_DATABASE_ID` 自动发现/覆盖仍保留。验证：cfpay `npm run typecheck`、定向 analytics 3/3、全量 128 passed/2 skipped；主仓 `worker:typecheck`、全部 Worker smoke、`npm run build`、`git diff --check` 通过。主仓 `worker:runtime-test` 因当前 Ubuntu 20.04 glibc 2.31 不能运行需要 GLIBC_2.32+ 的 workerd 而未通过/未完成；编译和 smoke 不能替代 runtime 测试。两个仓库分别提交，均未推送或部署。后续仍须复核可重建的逐请求平台请求计数与连接计数写入，继续前先登记 Handoff。
- 2026-10-25：下一阶段登记（审计可重建运行态的 D1 写入）：当前代码证据显示 `worker/src/usage.ts` 的 `recordRequest()` 在公开代理路径逐请求写 `platform_usage.request_count`；`reserveActiveConnection()`/`releaseActiveConnection()` 在 SSE/WebSocket 生命周期更新 D1，且 reserve 以 D1 原子条件更新执行跨 Worker isolate 全局硬限额；`recordUsageSnapshot()` 定时读写 `usage_snapshots`，管理端用它显示 24h/7d/30d 趋势。实施前须继续核验公开请求日志 `recordAccessLog()` 是否已覆盖相同事件/范围以及 UI 对趋势快照的真实依赖，避免以重复计数替代审计或丢失可见功能。评估全局活跃连接限额时不得改成 isolate 局部计数；如采用集中 Durable Object，须证明并发原子预留、DO 重启/驱逐后存量连接计数恢复、关闭/异常释放和多 server DO 并发语义，并量化新增 DO 请求额度；只有达到这些条件才可替代 D1。R2 字节/对象计数继续保留跨 isolate 准入一致性，不能本地化；对象真实占用由 R2 可查询状态核对。请求累计若可由已有访问日志按同口径聚合，则删除重复 `request_count` 写入和相应表字段/快照数据；若无法满足低成本和趋势语义，先量化 D1 写入收益再决定。阶段范围仅限这一审计及可证实的 D1 写入削减，更新必要迁移、API、UI、测试和旧注释；覆盖请求量准确性、UTC/趋势边界、跨 isolate 并发连接限额、崩溃断连和刷新行为。先单独提交本 Handoff 登记，再修改代码；完成验证后更新结果并中文提交。本仓存在未提交的隧道、TLS、SDK、Release 等用户改动，提交时只暂存本阶段文件，严禁整体暂存、回退或未经重大功能闭环推送。当前主仓 `main` 本地领先 `origin/main` 14 个提交，cfpay `main` 本地领先 1 个提交；本阶段不推送。
- 2026-10-25：运行态 D1 写入审计实现完成。公开插件请求已经逐请求写 `request_logs`，删除重复的 `platform_usage.request_count` UPDATE 与 `request_count`/`request_window_started_at` 两列，也停止把 `/blobs` 上传混进公开插件请求数；监控卡片明确标为公开插件请求，24 小时数量直接从日志按同一采样边界统计。趋势仍保留 15 分钟快照，但滚动计数从上一快照增量更新，只扫描新增与刚过期的时间段；缺少 24 小时内基准时才完整扫描一次，避免把写入削减换成每 15 分钟全量扫描。删除仅在更改凭据时已不再维护的 D1 `usage_cache` 遗留表，增加 `0010`/`0011` 迁移；保留 `0001`/`0004` 历史迁移不变。DO 在线断开测试改查内存 `/status` 并断言服务器/插件/域名 D1 行不被改写；Cloudflare 缓存测试改为验证内存缓存和无 D1 表。`active_connections` 仍由 D1 原子 reserve/release，原因是其为跨 isolate 全局硬配额，尚无能证明 DO 重启后连接存量恢复且配额成本更低的内存方案；R2 实际存储计数保持原样。验证：Ubuntu 26.04 / glibc 2.43 完整 Worker runtime 18 个测试文件、83/83；`worker:typecheck`、全部 Worker smoke、前端 `npm run build`、`git diff --check` 均通过；本机 SQLite 迁移验证列出 `key, active_connections, r2_bytes, r2_objects, updated_at`。没有部署、没有推送；主仓仍有用户隧道、TLS、SDK、Release 未提交改动，提交只包含本阶段文件。下一阶段审计 `accessLogsApi()` 每次读日志都执行的过期日志 DELETE 与每 15 分钟定时任务重复清理，以及快照清理频率；先登记并提交该步骤方案，再改代码。
- 2026-10-25：访问日志清理重复写入已修复。`accessLogsApi()` GET 不再执行过期日志 DELETE，只用 `created_at >= now-30d` 过滤返回；过期日志统一由每 15 分钟 `runScheduledMaintenance()` 清理，避免每次打开访问日志页面都产生一次 D1 写入。新增 runtime 回归证明旧日志不出现在响应但仍保留在 D1，定时维护测试继续验证清理职责。验证：Ubuntu 26.04 / glibc 2.43 的 `worker/runtime/local-usage.test.ts` 3/3 通过；`worker:typecheck`、全部 Worker smoke、`git diff --check` 通过。未部署、未推送。下一步审计 Worker 管理 API 中仅用于页面展示的重复实时查询与请求刷新频率，先识别能复用单次 API 结果或 DO 内存状态的调用，再登记方案后修改；不要把跨 isolate 的连接/R2硬限制改成本地计数。
- 2026-10-25：下一阶段登记（控制台运行态自动刷新）：审计确认主控制台当前没有定时刷新，服务器/插件/域名列表和本地活跃连接只在首次加载、切换工作区或手动刷新时更新；这与 Worker 已采用 DO 内存在线态不一致。实现限定为运行态数据 `overview`、servers、plugins、domains、local usage`，页面可见时每 15 秒刷新一次；同一工作区只允许一个刷新请求在途，组件卸载、切换工作区和页面隐藏时清理/跳过，恢复可见后立即补一次。复用现有 `refreshData(false)`，不新增 API；Cloudflare Analytics、账户设置、审计和访问日志不做前端轮询，继续由手动刷新/Worker 定时任务提供，避免扩大 Cloudflare API 与 D1 读取。增加前端自动刷新生命周期/请求去重回归，验证构建与现有 UI smoke；不改变后端计数和跨 isolate 连接/R2配额语义。先单独提交本登记，再修改实现；完成后更新验证结果并中文提交，不推送。
- 2026-10-25：控制台运行态自动刷新实现完成：主控制台可见时每 15 秒静默刷新 overview、servers、plugins、domains 和 local usage；页面隐藏暂停，恢复可见立即刷新，组件卸载和工作区切换清理定时器。手动刷新与自动刷新共用一个在途请求，且响应绑定工作区代次，旧工作区的迟到响应不会覆盖新工作区数据；Cloudflare Analytics、审计、访问日志和账户设置仍不轮询。测试文案同步到“公开插件请求”。验证：`npm run ci:local` 全部通过，包含 UI 约定 82/82、CSS 审计 467/467、Worker smoke、管理端 UI 90/90、构建和发布包契约；定向控制台 Worker 测试 32/32，`git diff --check` 通过。未部署、未推送；本仓其它 native-server、隧道、TLS、SDK、Release 修改仍未纳入本阶段提交。
- 2026-10-25：下一步登记（内置映射授权回归补强）：现有 `plugmesh-tunnel-mapping-smoke` 只让 mock Worker 立即发送 `kReady` 并回显数据，尚未证明目标插件服务器首次要求本地 UI 密码、源端以 nonce/context 生成证明、授权后同一源服务器免重复验证，以及目标密码 verifier 轮换后信任失效。下一步仅补授权挑战/错误/重连回归和必要的无秘密日志断言，保持密码不落盘、不进入 Worker/D1、目标地址校验及二进制转发边界；同时修正 CTest 的真实执行记录，完成 Linux CTest、MinGW 编译、native UI、Worker runtime/smoke、`git diff --check` 后提交本阶段结果。未完成前不进入 Release 推送，不修改生产实体。
- 2026-10-25：内置映射授权回归已完成：`plugmesh-tunnel-mapping-smoke` 通过首次密码挑战、同源重连免重复验证、verifier 轮换撤销信任、密码不写入映射配置和端口冲突保护；Linux 原生全量构建与 CTest 13/13、MinGW 全目标构建、Native UI 6/6、Worker typecheck、Worker smoke、`git diff --check` 全部通过。`~/pay/cfpay` `npm run typecheck`、定向 Analytics 3/3、全量测试 128 passed/2 skipped 通过。额度统一修复仍未推送/部署，本阶段未修改生产实体；Worker runtime 未因本阶段仅改原生测试而重复运行，既有 Ubuntu 26.04 runtime 记录仍为 18 文件、84 tests passed。
- 2026-10-25：下一阶段登记（内置映射阶段收口与双端集成验收）：当前工作区已有本地 UI/API CRUD、在线目标发现、源端 TCP listener、Worker 二进制隧道和目标端 TCP socket/首次密码信任实现，但现有 smoke 主要是 mock Worker 回显，尚未证明真实 `plugmesh-server` 源端 PortMapper 经 Worker 控制连接驱动另一实例 `ControlClient`，再连接目标 TCP 服务并双向传输。先按现有单一 ABI 与内置映射边界审计未提交文件，完成一套本地 WebSocket mock Worker + 两端原生客户端 + 目标 TCP echo 的集成回归，覆盖目标离线、错误密码、密码轮换后重新授权、双向二进制数据和关闭传播；同时只修复验收中发现的配置校验/秘密落盘/线程生命周期问题。完成后再分别提交 ABI/映射相关文件与测试，更新实际验证结果；不创建独立 mapper、不写生产 D1、不推送未闭环功能。
- 2026-10-25：内置映射双端集成验收完成：新增真实本地 mock Worker、源端 `PortMapper`、目标端 `ControlClient` 与 TCP echo 的端到端回归，确认错误目标口令不会建立信任，首次正确口令完成挑战授权并双向转发包含 NUL/高位字节的二进制数据，已授权源服务器重连不重复输入口令，目标本地 UI verifier 轮换后旧信任失效并可用新口令重新授权；映射配置和日志断言未发现口令落盘或进入 Worker 帧。修复目标 TCP 尚未连接时的数据缓存竞态，连接成功后再泵送写队列。重新配置 CMake 后 Linux 原生 CTest `14/14` 通过（此前 `ctest --test-dir` 在系统 CTest 3.16 下不支持该参数，不能作为测试证据），MinGW 全目标构建通过；定向集成测试、`git diff --check`、Worker typecheck/smoke 及此前 Native UI 6/6 验证均通过。实现仍未推送或部署，未写生产 D1；下一步先审计并收口 Release 包与 Actions 门禁，再决定集中推送，不恢复独立 mapper。
- 2026-10-25：下一步登记（移除隧道短生命周期的 Durable Object Storage 读写）：`worker/src/tunnel-session.ts` 的源端/目标端配对只依赖同一个仍持有 WebSocket 的 Durable Object 实例，`targetServerId` 与 `sessionId` 在实例重启或连接丢失后本来也不能恢复；继续写 DO Storage 只增加 Cloudflare 存储读写，不提供有效恢复能力。下一步改为对象字段内存保存，DO 被驱逐/连接断开时会话直接失效，不写 D1 或 DO Storage；增加直接实例回归，使用会拒绝 `get/put` 的 storage stub 验证源端与目标端配对仍成功，并保留 Worker runtime 的目标不匹配/二进制转发回归。只修改隧道会话和对应测试/HANDOFF，不改变跨服务器授权、数据帧格式或生产数据；完成后运行 Worker typecheck、隧道 runtime 定向测试、Worker smoke 和 `git diff --check`，再提交中文记录。
- 2026-10-25：隧道会话内存化完成：`TunnelSession` 不再调用 Durable Object Storage，源端/目标端配对标识只保存在当前 DO 实例；实例驱逐或连接断开后会话直接失效，符合短生命周期状态语义。runtime 新增拒绝任何 `get/put` 的 storage stub 回归，并保留同工作区目标发现、二进制双向转发和无效控制令牌用例。Ubuntu 26.04 / glibc 2.43 真实 workerd 定向 runtime `3/3` 通过，主仓 Worker typecheck、全部 Worker smoke 和 `git diff --check` 通过；当前 Ubuntu 20.04 runtime 仍因 workerd 的 GLIBC 2.32+ 依赖无法启动，但不影响上述目标环境证据。临时源码、Node 运行时和依赖已清理计划外未纳入仓库；本阶段未写生产数据、未推送。下一步回到 Release 包与 Actions 门禁收口，仍须先登记再修改。
- 2026-10-25：下一阶段登记（统一 D1 存储免费额度显示）：`cfpay` 首页已按账户内每个数据库取最新 `d1StorageAdaptiveGroups` 样本求和并以 5 GB 计算百分比；平台监控目前只有 D1 读写行数，没有 D1 存储项，因此两处免费额度展示不完整。下一步在平台 Worker 的同一 Resource Analytics 请求中加入账户级 D1 存储查询，按 `databaseId` 去重取最新样本，API/UI/额度判断补齐 `d1StorageBytes` 与 `d1StorageBytes` 上限；保持 D1 读写为 UTC 自然日、存储为当前快照，不改平台本地 R2 阈值，不重复写 D1。覆盖多数据库、同库多小时、空数据、百分比和超限维护回归；先提交本登记，再修改代码，完成后仅提交相关文件，不推送未闭环功能。
- 2026-10-25：D1 存储额度统一实现完成：平台 Resource Analytics 增加账户级 `d1StorageAdaptiveGroups`，按数据库取最近小时样本后求和，API 的 `d1.storageBytes` 与 Free 计划 `d1StorageBytes=5_000_000_000` 上限进入统一百分比和维护判断；用量页与总览均新增 D1 存储项，并使用与 `cfpay` 相同的二进制容量格式。回归覆盖多数据库去重、D1 存储超限、Worker smoke、平台用量卡片和百分比。验证：Worker typecheck、全部 Worker smoke、前端 build、控制台 Playwright `32/32`、`git diff --check` 通过；Ubuntu 20.04 的 Workerd runtime 仍因 glibc 2.31 无法启动，未将其记为通过。主仓本阶段提交不包含 TLS、Release、原生 UI 等其它工作区修改，尚未推送或部署。
- 2026-10-25：下一阶段登记（原生 Release 与手动构建门禁收口）：当前未提交改动已补充部分 Linux CA、Windows/macOS/Linux Release 包内容和 workflow 契约，但远程 `release.yml` 仍缺少这些修改；现有发布 workflow 也没有独立的手动构建入口来选择 `executable/shared` 与 `linux/windows/macos/all`。本阶段先审计现有 CMake/脚本/包目录和 Actions 表达式，再补一个可手动运行、输入经过白名单校验、按目标平台和产物类型构建的 workflow；正式 Release 压缩包必须包含内置 `plugmesh-server`、插件宿主、随包运行库、SDK 头文件/库文件、示例插件、映射使用说明和校验和，禁止独立 mapper。Linux 运行库必须携带 CA bundle 且 TLS 继续校验主机名；帮助中心同步二进制/共享库使用边界。验证必须覆盖 workflow YAML 语法/静态契约、实际 Linux 包清单与 ABI 检查、CMake/CTest、MinGW 构建、Native UI smoke、完整 `ci:local`；不在未通过门禁前推送，不读取或修改生产凭据。
- 2026-10-25：下一阶段登记（统一 `cfpay` 首页与平台监控的免费额度口径）：用户发现 `~/pay/cfpay` 首页显示的 Cloudflare 免费额度与 `platform` 的平台监控不一致。先对两个仓库的额度来源、计划判定、资源上限、时间范围、单位/舍入和空数据状态做并列审计；统一使用 Cloudflare 账户级真实用量与 Free 计划基线，D1 存储按账户内数据库最新快照汇总，D1 读写按 Cloudflare 计费日统计，不能把平台本地 R2/业务 D1 额度混入 Cloudflare 卡片。API 返回结构、百分比计算、超限判断和首页/监控页面展示必须来自同一份口径，不能由前端各自硬编码；刷新应复用同一查询结果并保留清晰的“未配置/未读取/无数据”状态。覆盖两个仓库的多数据库、重复样本、计划未知、空数据、单位边界和超限回归；先提交本登记，再修改代码。完成后分别运行 `cfpay` 定向测试/类型检查、平台 Worker/前端验证和 `git diff --check`，仅提交相关文件，不读取或修改生产凭据。
- 2026-10-25：cfpay 三态计划与额度来源修复完成：`src/cloudflare-analytics.ts` 现在仅把显式 `CLOUDFLARE_D1_PLAN=free` 视为 Free，paid/unknown 不套用免费硬上限；返回 `limitSource`，未知计划的 rows read、rows written、storage limit 均为 null，缓存 key 缺省为 unknown。`admin-ui/src/lib/types.ts` 已同步 unknown 与 limitSource；新增未知计划回归测试。WSL Ubuntu 20.04 中 cfpay 定向测试 4/4、`npm run typecheck`、`git diff --check` 通过；仓库无 `build` script，执行 `npm run build` 明确返回 `npm error Missing script: "build"`，未将其误报为通过。平台本阶段未改代码，生产凭据/D1/部署未触碰。下一步分别提交 cfpay 三个实现/测试文件与本 HANDOFF 记录，普通记录不推送。- 2026-10-25：原生 Release 与 Actions 门禁收口完成：正式 `.github/workflows/release.yml` 的 `validate` job 现在先 checkout 并运行 `bash scripts/release-workflow.test.sh`，因此 tag/manual 发布路径不会绕过包内容契约；契约脚本新增 workflow 自身门禁断言，并继续覆盖正式/手动包的内置服务器、plugin-host、SDK、示例插件、映射文档、运行库、Linux CA bundle 和禁止独立 mapper。验证：`npm run release:workflow:test`、PyYAML 解析两个 workflow、`git diff --check` 通过；`npm run ci:local` 全部通过（UI conventions 82/82、CSS 467/467、Worker smoke/typecheck、Vite build、Playwright 90/90）。Debian 11 实际 Linux `ALL` 包构建成功，zip 清单 30 个条目包含服务器、plugin-host、OpenSSL 3、CA bundle、SDK 头文件/库、sample plugin、PORT-MAPPING、README 和 Native UI；服务器、plugin-host、主/SDK shared library 的最高 GLIBC 为 2.30，低于 2.31 基线且未泄漏 `GLIBCXX_`/`CXXABI_`，sample C++ 插件保留其预期 C++ runtime 依赖。root-owned ignored dist 已清理；未部署、未推送。当前阶段仅提交 Release/TLS/SDK/native UI/workflow 相关文件与本记录，排除未跟踪 transcript `10251647.md`；Windows/macOS 实机 Release 未在本环境运行，依赖 Actions 矩阵验证。下一步需重新登记后再进入其它功能阶段。
- 2026-10-25：下一阶段登记（内置映射授权与配置安全审计）：基于已完成的 `PortMapper`、Worker 隧道和 `ControlClient` 双端集成，逐项复核目标服务器发现、任意目标地址/端口授权、首次本地 UI 密码证明、源服务器信任持久化、密码 verifier 轮换失效、映射配置原子写入和本地 Cookie API 鉴权。重点检查是否仍残留 loopback 限制、是否有目标服务器 ID/名称混淆、重复或无效校验、密码进入配置/日志/Worker 帧、配置更新后旧 listener 继续运行，以及连接关闭和线程停止时的资源泄漏。只修复审计确认的问题，不重设计已验证的二进制隧道协议，不恢复独立 mapper，不写生产 D1/凭据。完成后覆盖映射定向 smoke、Linux CTest、必要 MinGW 编译、Worker typecheck/smoke、Native UI/build 和 `git diff --check`，更新本条实际结果并单独提交中文记录；未完成前不进入发布推送或其它功能阶段。
- 2026-10-25：原生 CTest smoke 注册阶段完成：审计确认 `native-server/CMakeLists.txt` 已有 `enable_testing()` 和 14 个 smoke `add_test` 注册，不需要重复添加构建代码；此前从仓库根目录使用 `ctest --test-dir native-server/build` 在当前 CTest 版本中仍解析根目录，才显示 `No tests were found!!!`。重新配置 `cmake -S native-server -B native-server/build` 后，在 `native-server/build` 目录执行 `ctest --output-on-failure`，14/14 全部通过（含映射、隧道集成、本地 HTTP、服务器 API）。无源码改动，本阶段只记录并提交 HANDOFF，不推送；后续运行 CTest 必须从构建目录执行。
- 2026-10-25：映射 API 密码长度边界修复完成：`native-server/src/port_mapper.cpp` 在 API 入口立即拒绝 `targetPassword.size() > 1024`，返回 `target server password is too long`，避免超长敏感字符串先进入内存；`native-server/tests/port_mapper_smoke.cpp` 新增 1025 字符 POST 回归，确认返回错误且结果为空。验证：密码边界 smoke 通过；在 `native-server/build` 执行 CTest 14/14 通过；`npm run ci:local` 通过（UI conventions 82/82、CSS 467/467、Worker smoke/typecheck、Vite build、Playwright 90/90）；`git diff --check` 通过。
- 2026-10-25：Cloudflare 订阅状态与免费额度修复完成：`worker/src/cloudflare-credentials.ts` 现在排除 `Cancelled`、`Failed`、`Expired` 的 Free 历史订阅，不再为终止订阅授予官方免费额度基线；`worker/runtime/cloudflare-credentials.test.ts` 增加三种终止状态回归。依据 Cloudflare 订阅状态契约，未改变有效订阅、未知状态和非 Free 的既有处理。验证：Worker typecheck 通过；Node/esbuild 定向断言通过；`npm run ci:local` 通过（Worker smoke、UI conventions 82/82、CSS 467/467、Vite build、Playwright 90/90）；`git diff --check` 通过。Worker runtime Vitest 受 Ubuntu 20.04 的 workerd 二进制要求 `GLIBC_2.32` 至 `GLIBC_2.35` 阻断，未将该环境错误误报为测试通过；不影响本次 Node 定向验证。仅提交本阶段 Worker、测试和 HANDOFF，不推送。
- 2026-10-25：下一阶段登记（原生 UI 目标服务器主动授权）：用户要求在原生插件服务器 UI 的目标服务器列表中，选择其它在线插件服务器并主动验证其 UI 密码，不再等到创建映射或首个请求时才发现密码错误。下一步复用现有 Worker 二进制隧道密码 challenge/proof 与 `ControlClient`，增加本地目标授权 API 和 UI 表格操作；验证成功后仅保存在 PortMapper 进程内存用于后续映射，绝不写入 mapping 配置、日志或 Worker 持久存储；失败时不保留密码。补充 native HTTP/PortMapper/UI 回归，运行原生 CTest、Worker checks、Native UI build 和 `git diff --check`，更新 HANDOFF 并提交中文记录，不推送。
- 2026-10-25：认证 JSON 请求体边界修复完成：`worker/src/index.ts`，超限返回 413，非法 JSON 返回既有 400 语义；`worker/runtime/setup.test.ts` 增加带大量无关字段的超大登录请求回归。验证：Worker typecheck、Worker smoke、独立 `npm run ui:smoke` 90/90、setup 回归经 esbuild 转译校验、`git diff --check` 通过；仅提交本阶段 Worker、测试与 HANDOFF，不推送。
- 2026-10-25：隧道失败状态线程同步修复完成：`native-server/src/port_mapper.cpp` 在 `run_tunnel` 等待网络状态后，先持有 `TunnelState::mutex` 复制 `failed` 与 `failure`，再停止并 join websocket 网络线程，消除主线程与回调之间的数据竞争；保留原有帧、超时和授权语义，并为无错误文本的失败状态提供通用错误。验证：映射与隧道集成 smoke 通过；在 `native-server/build` 执行 CTest 14/14 通过；`npm run ci:local` 通过（UI conventions 82/82、CSS 467/467、Worker smoke/typecheck、Vite build、Playwright 90/90）；`git diff --check` 通过。仅提交本阶段源码与 HANDOFF，不推送。
- 2026-10-25：服务器注册输入边界修复完成：`worker/src/index.ts` 为未认证 HTTP 注册入口增加 2048 字节 `Content-Length` 上限，并在 `createServerRegistration` 统一拒绝非字符串、超过 256 字符注册码和超过 128 字符服务器名称；WebSocket 注册复用同一字段校验，避免超大输入进入哈希或数据库。`worker/runtime/admin.test.ts` 增加错误类型和超大请求回归。验证：Worker typecheck、Worker smoke、独立 `npm run ui:smoke` 90/90、admin 回归经 esbuild 转译校验、`git diff --check` 通过；完整 CI 的像素基线仍受当前无 Docker 环境限制，未将其误报为通过。仅提交本阶段 Worker、测试与 HANDOFF，不推送。
- 2026-10-25：损坏管理员凭据的认证容错修复完成：`worker/src/auth.ts` 将非法 Base64、无效迭代次数、盐值异常或 PBKDF2 异常统一视为 `verifyPassword` 返回 `false`，避免登录和改密接口因损坏凭据抛出 Worker 500；有效凭据校验逻辑不变；`worker/runtime/setup.test.ts` 增加损坏凭据回归。验证：Worker typecheck、Worker smoke、Release 契约和 `git diff --check` 通过；独立 `npm run ui:smoke` 90/90 通过。完整 `npm run ci:local` 已完成 Worker/UI 前置阶段，但因当前环境没有 Docker，像素基线步骤退出 1，未将整套 CI 误报为通过；仅提交本阶段 auth、测试与 HANDOFF，不推送。
- 2026-10-25：管理员密码输入长度边界修复完成：`worker/src/auth.ts` 导出统一 `MAX_PASSWORD_LENGTH = 1024`；登录、密码修改和首次初始化入口在 PBKDF2 前拒绝超长输入，分别保持无效密码 401、字段级 400 和 setup 页面 400 语义；`worker/runtime/setup.test.ts` 增加初始化/登录超长密码回归。验证：Worker typecheck、Worker smoke、完整 `npm run ci:local` 和 `git diff --check` 通过；仅提交本阶段 auth/index/setup、测试与 HANDOFF，不推送。
- 2026-10-25：管理 API 路径段解码边界修复完成：`worker/src/index.ts` 增加统一的 `decodePathSegment` 安全 helper，服务器、插件和工作区路径参数在畸形百分号编码时稳定返回 404，不再抛出 `URIError`；数据库授权判断保持不变；`worker/runtime/admin.test.ts` 增加畸形服务器路径回归。验证：Worker typecheck、Worker smoke、完整 `npm run ci:local` 和 `git diff --check` 通过；仅提交本阶段 Worker、测试与 HANDOFF，不推送。
- 2026-10-25：公开 Blob token 解码边界修复完成：`worker/src/index.ts` 捕获畸形百分号编码并返回 404 Not found，避免 `URIError` 变成未处理的 Worker 500；`worker/runtime/blob-url.test.ts` 增加畸形 token 回归。合法 token 的一次性消费、R2 清理和额度回收语义保持不变。验证：Worker typecheck、Worker smoke、完整 `npm run ci:local` 和 `git diff --check` 通过；直接运行 `npx vitest run worker/runtime/blob-url.test.ts` 受当前普通 Vitest 配置无法解析 `cloudflare:test` 阻断，未将其误报为通过；Worker smoke 中的 Blob stream/expiry 检查通过。仅提交本阶段 Worker、测试与 HANDOFF，不推送。
- 2026-10-25：下一阶段登记（目标服务器插件与端口代理发现/一键映射）：用户要求原生插件服务器表不仅显示对方在线状态，还能看到对方已启动的插件和端口代理，并支持一键映射到本地端口；插件提供的 HTTP 服务继续通过插件域名访问，非 HTTP 服务通过现有 PortMapper 本地端口映射访问。下一步先核对 Worker 控制面已有插件/映射发现接口和权限边界，再扩展目标 discovery 数据契约、Native UI 表格和一键映射调用；不得把未授权目标的密码写入配置，继续使用进程内存凭据和现有隧道协议。补充 Worker/native/UI 回归，更新 HANDOFF 并提交中文记录，不推送。
- 2026-10-25：远端端口代理一键映射体验完成：Native UI 的非 HTTP 代理按钮现在直接调用现有 `/api/mappings` 创建并启动映射，自动从 `30000-30999` 范围选择未占用本地端口，生成合法映射名称，复用 PortMapper 已验证且仅驻留内存的目标凭据；未授权时显示先验证目标口令的明确提示，不要求用户手动输入命令或端口。未改变 HTTP 插件域名访问、SSH/文件流或隧道协议。验证：Native UI build、Worker typecheck、`git diff --check`、Native UI smoke 6/6 通过；随后仅提交 Native UI、文案、样式和 HANDOFF，不推送。
- 2026-10-25：下一阶段登记（远端端口代理一键映射体验）：下一步复用现有映射保存 API，在 Native UI 自动选择可用本地监听端口、填入目标参数，并优先使用本次进程内已授权的目标凭据；若目标尚未授权则明确提示先验证口令。不得把密码写入配置以外的新增持久化位置，不改变 SSH/文件流和现有隧道协议。补充 UI/native 回归，更新 HANDOFF 并提交中文记录，不推送。
- 2026-10-25：远端插件与端口代理发现/一键映射完成：Worker 目标 discovery 对在线同工作区目标查询该信息，并附带已分配插件域名，单个目标查询失败只回退为空数据，不影响其它目标；Native UI 目标表展示插件、HTTP 插件域名和非 HTTP 端口代理，端口代理按钮可复用现有映射表单一键准备本地映射。保留 `plugin.load` 原有控制分支，旧目标响应缺失新字段时前端按空数组兼容，未改变 SSH/大文件流和密码存储边界。验证：Worker typecheck/smoke 通过；原生服务器编译通过；CTest 14/14 通过；Native UI build 和 smoke 6/6 通过；`git diff --check` 通过。仅提交本阶段 Worker/native/UI/HANDOFF，不推送。
- 2026-10-25：TunnelSession 目标端握手超时修复完成：`worker/src/tunnel-session.ts`，目标端成功连接或任一端关闭时清理 timer，超时关闭隧道并释放源连接及 pending 缓冲；未改变鉴权、会话 ID 匹配或帧格式。验证：Worker typecheck、Worker smoke、完整 `npm run ci:local` 通过（UI conventions 82/82、CSS 467/467、Release 契约、Vite build、Playwright 90/90）；`git diff --check` 通过。仅提交本阶段 Worker 与 HANDOFF，不推送。
- 2026-10-25：文件流异步收尾取消修复完成：`worker/src/durable-object.ts` 为 `PendingResponse` 增加取消状态，在超时、服务器断连、响应拒绝和客户端取消时标记；`finishFileResponse` 在文件写入、R2 上传、R2 读取和临时对象登记等异步边界检查 pending 仍有效，取消后停止后续上传并清理 R2 对象、临时对象元数据和额度，避免客户端已收到失败响应后产生资源泄漏。保持原有 502/503 响应语义。验证：Worker typecheck、Worker smoke、完整 `npm run ci:local` 通过（UI conventions 82/82、CSS 467/467、Release 契约、Vite build、Playwright 90/90）；`git diff --check` 通过。仅提交本阶段 Worker 与 HANDOFF，不推送。
- 2026-10-25：Durable Object pending 请求清理修复完成：`worker/src/durable-object.ts` 在控制帧 `serverSocket.send()` 抛错时，现在清理 pending timer、删除 pending 项、清空缓冲、通过幂等的 `releasePendingConnection` 释放活动连接并丢弃可能的 R2 上传，保持 502 响应语义，避免超时回调重复释放同一额度。验证：Worker typecheck、`npm run worker:smoke`、`npm run ci:local` 通过（UI conventions 82/82、CSS 467/467、Worker smoke、Vite build、Playwright 90/90、Release 契约）；`git diff --check` 通过。仅提交本阶段 Worker 与 HANDOFF，不推送。
- 2026-10-25：本地 CI 的 Termux 契约收口完成：`scripts/ci-local.sh` 在原生 Release 契约之后执行 `npm run --silent native:termux:test`，日常回归与正式 Release validate 保持一致；不启动 Android 模拟，也未改变大数据流。验证：`bash -n scripts/ci-local.sh`、`npm run native:termux:test`、`npm run release:workflow:test`、`git diff --check` 通过。
- 2026-10-25：下一阶段登记（原生目标代理表格响应式体验）：审计发现目标服务器表格在窄窗口仍使用三列固定布局，密码输入和一键映射按钮会被压缩，影响移动端 Termux/原生 UI 使用。下一步仅增加窄屏下的目标行重排和按钮可点击尺寸，不改变映射 API、端口选择、凭据内存边界或大数据流；运行 Native UI build/smoke 和 `git diff --check`，更新 HANDOFF 并提交中文记录，不推送。
- 2026-10-25：Release 的 Termux CLI 契约门禁完成：`.github/workflows/release.yml` 的 `validate` job 现在执行 `bash scripts/termux-build.test.sh`，`scripts/release-workflow.test.sh` 同步断言该步骤；不在 Ubuntu runner 上伪造 Android 编译，也未改变 Windows/Linux/macOS 包逻辑。验证：`npm run release:workflow:test`、`npm run native:termux:test`、PyYAML 解析 release/build workflows、`git diff --check` 通过。
- 2026-10-25：下一阶段登记（远端代理重复映射体验）：审计发现目标表的一键映射按钮在同一代理已有本地映射时仍可重复提交，服务端随后返回重复映射错误。下一步仅在 Native UI 根据目标 ID、目标地址、目标端口和协议识别已有映射，将按钮显示为已映射并禁用；不改变 PortMapper 配置语义和端口冲突校验。补充 Native UI smoke、更新 HANDOFF 并提交中文记录，不推送。
- 2026-10-25：下一阶段登记（远端 HTTP 插件快捷访问）：目标表目前只显示 HTTP 插件域名文本，用户仍需手动复制地址。下一步将已分配域名渲染为安全的 HTTPS 新窗口链接，未分配域名继续显示本地化占位文本；不改变 Worker 域名授权、非 HTTP 端口映射、SSH/文件流或密码存储边界。运行 Native UI build/smoke 和 `git diff --check`，更新 HANDOFF 并提交中文记录，不推送。
- 2026-10-25：Termux CMake 运行时兼容修复完成：`native-server/CMakeLists.txt` 增加 `PLUGMESH_TERMUX` 开关，Termux 构建脚本传入 `-DPLUGMESH_TERMUX=ON`，Linux 专用 `$ORIGIN` RPATH 与 `-static-libstdc++ -static-libgcc` 不再应用到 Termux；Linux 默认构建行为保持不变。验证：`npm run native:termux:test`、两个脚本 `bash -n`、Linux 原生重建和从 `native-server/build` 执行 CTest 14/14 通过；另用宿主工具链配置 `-DPLUGMESH_TERMUX=ON -DPLUGMESH_BUILD_ARTIFACT=EXECUTABLE` 并成功编译 `plugmesh-server`，确认 CMake 分支有效；此前从错误目录执行 CTest 的路径错误不作为失败；`git diff --check` 通过。当前 WSL 仍无 Android Termux 工具链，未冒充现场 Android 编译结果。
- 2026-10-25：下一阶段登记（远端代理一键映射 UI 回归）：现有 Native UI smoke 只覆盖手动本地映射 CRUD，未验证目标表中的远端代理数据、自动本地端口选择和一键创建流程。下一步为现有本地 smoke server 增加最小远端插件/代理 fixture，并增加 Playwright 回归；不改变生产协议、端口范围、凭据内存边界或流式通道。运行 Native UI build/smoke、CTest 相关构建和 `git diff --check`，更新 HANDOFF 并提交中文记录，不推送。
README 的干净环境示例现在默认执行 `bash scripts/build-termux-native.sh`，不会因缺少 `native-ui/dist` 失败；需要 UI 时先构建 `native-ui` 再显式传 `--include-ui`，生成包内说明也标明 UI 为可选。契约测试同步断言该说明。验证：`npm run native:termux:test`、两个脚本 `bash -n`、`git diff --check` 通过；未改变 Android CLI 构建逻辑。
- 2026-10-25：原生 UI 主动授权 smoke fixture 回归完成：`native-server/tests/local_ui_smoke_server.cpp` 增加受控目标授权成功响应，`native-ui/session-ui.spec.ts` 覆盖输入目标口令、点击验证后显示“已授权”和“重新验证”。测试定位限定在 `.mapping-target-row`，避免与映射表单同名口令字段冲突。验证：`npm run native-ui:smoke` 7/7、Native UI build、`git diff --check` 通过；fixture 只验证 UI 状态，不替代真实 Worker challenge/proof。仅提交本阶段 smoke server、Playwright 测试与 HANDOFF，不推送。
当前 Native UI smoke server 模拟目标发现和映射 CRUD，但没有授权路由，导致授权成功后的“已授权/重新验证”状态缺少回归覆盖。下一步仅在本地 smoke fixture 增加受控 `POST /api/mappings/targets/<id>/authorize` 成功响应，并在 Playwright 断言状态切换；不模拟或替代真实 Worker challenge/proof。运行 Native UI build/smoke 和 `git diff --check`，更新 HANDOFF 并提交中文记录，不推送。
`native-ui/src/main.tsx` 现在仅以内存态记录在线目标的授权成功状态，目标刷新下线后清除；目标表显示“已授权”并提供“重新验证”按钮，密码仍在成功后立即清空。新增中英文文案，未写入配置、Worker 或日志。验证：`npm run native-ui:build`、`npm run native-ui:smoke` 7/7、`git diff --check` 通过；仅提交 Native UI、locale 与 HANDOFF，不推送。
现有目标表在密码验证成功后只显示一次提示，未保留可扫描的“已授权”状态；下一步仅在 Native UI 内存态增加目标授权标记，成功后显示已授权、目标下线或刷新后清除失效标记，不把密码或授权状态写入配置/Worker。补充 Native UI smoke、build 和 `git diff --check`，更新 HANDOFF 并提交中文记录，不推送。
- 2026-10-25：管理 API JSON 请求体边界修复完成：`worker/src/index.ts` 复用 Web Streams 标准读取器，以 32 KiB 上限保护工作区、成员、平台设置、SMTP、域名和 Cloudflare 设置等小型 JSON 接口；超限返回 413，非法 JSON 保持 400。注册接口同时改为流式读取，覆盖缺少 `Content-Length` 的请求。明确排除 `/api/blobs`、插件代理、文件流和隧道等大数据通道。验证：Worker typecheck、完整 Worker smoke、SMTP 定向 smoke、`git diff --check` 通过；仅提交 Worker 与 HANDOFF，不推送。
审计发现 `/command` 已校验服务身份，但仍直接调用 `request.json()`，未复用 Durable Object 现有 `readRequestBody` 限制；异常大的内部控制命令可能造成无界 JSON 读取。下一步限制控制命令 JSON 为 8 KiB，超限返回 413、非法 JSON 返回 400；不改变插件业务请求、文件流和隧道帧边界。补充定向 smoke、Worker typecheck/smoke、`npm run ci:local` 和 `git diff --check`，更新 HANDOFF 并提交中文记录，不推送。
`worker/durable-object-sync.smoke.ts` 现在分别验证缺少 `x-plugmesh-server-id` 和携带错误服务 ID 时均返回 403，同时保留合法 `server-1` 命令的同步回归。验证：定向 Durable Object server-sync smoke、`git diff --check` 通过；仅提交 smoke 与 HANDOFF，不推送。
在已完成 `/command` 服务 ID 授权修复基础上，补充错误 `x-plugmesh-server-id` 的 403 回归；确保不仅缺少身份头会被拒绝，跨服务器身份也不能向当前 Durable Object 下发命令。仅修改 Worker smoke 与 HANDOFF，运行定向 smoke 和 `git diff --check`，提交中文记录，不推送。
`worker/src/durable-object.ts` 的 `/command` 现在要求 POST 且 `x-plugmesh-server-id` 必须匹配当前连接服务器；未授权请求返回 403，既有 `plugin.info`、`plugin.*`、`server.sync` 内部调用保持不变。`worker/durable-object-sync.smoke.ts` 同步补充合法服务 ID 和未授权请求回归。验证：Worker typecheck、完整 Worker smoke、定向 server-sync smoke、`git diff --check` 通过；此前未带新请求头的 smoke 阻塞已修复并重新通过。仅提交本阶段 Worker 源码、smoke 和 HANDOFF，不推送。
- 2026-10-25：Durable Object `/command` 服务 ID 授权阶段记录：入口要求 POST 且 `x-plugmesh-server-id` 必须匹配当前连接服务器；未授权请求返回 403，既有 `plugin.info`、`plugin.*`、`server.sync` 内部调用保持不变。验证：Worker typecheck、完整 Worker smoke、定向 server-sync smoke、`git diff --check` 通过。
- 2026-10-25：远端目标信息缓存有界淘汰修复完成：`worker/src/index.ts` 在 10 秒 TTL 之外增加过期项清理和 256 条固定上限，达到上限时按 Map 插入顺序淘汰最早条目；workspace/server 缓存键、只缓存成功结果和不写入 Cloudflare 持久化存储的约束保持不变。验证：Worker typecheck/smoke、`npm run ci:local` 全部通过（UI conventions 82/82、CSS 467/467、Release/Termux 契约、Vite、Playwright 90/90）、`git diff --check` 通过。仅提交 Worker 与 HANDOFF，不推送。
审计确认现有 10 秒 TTL 仅在同一缓存键再次访问时删除过期项；长期运行的 Worker isolate 若持续访问大量工作区/服务器，过期 Map 项可能累积。下一步仅增加过期清理和固定最大条目数，保持 workspace/server 隔离、只缓存成功结果、不写入 D1/KV/R2；运行 Worker typecheck/smoke、完整本地 CI 和 `git diff --check`，更新 HANDOFF 并提交中文记录，不推送。
`worker/src/index.ts` 为在线目标的 `plugin.info` manifests、portMappings 和 pluginDomains 增加按 workspace/server 分组的 10 秒 Worker isolate 内存 TTL 缓存；仅缓存成功结果，过期或未命中仍查询 Durable Object 与 D1，离线目标仍返回空数据，不写入 D1/KV/R2。验证：Worker typecheck、Worker smoke、完整 `npm run ci:local` 通过（UI conventions 82/82、CSS 467/467、Release/Termux 契约、Vite、Playwright 90/90）；`git diff --check` 通过。仅提交 Worker 与 HANDOFF，不推送。
- 2026-10-25：请求体流读取异常降级修复完成：`worker/src/index.ts` 的 `readJsonBody` 在 Web Streams `reader.read()` reject 时返回既有非法请求结果，避免客户端中断或底层读取异常冒泡为 500；超出上限仍返回 413，JSON 解析失败仍返回 400。Durable Object `readRequestBody` 已有同等 catch 保护。验证：Worker typecheck、完整 Worker smoke、`git diff --check` 通过；文件流、Blob、插件代理和隧道业务流未改变。仅提交 Worker 与 HANDOFF，不推送。
- 2026-10-25：v0.1.5 发布触发后发现 `.github/workflows/release.yml` 校验 job 立即失败且没有生成 job；根因为 Termux 契约 step 与发布标签校验共用重复 `run` 键。已登记修复：拆分为独立的 Termux 契约 step 和发布标签校验 step，推送修复提交后重新触发同一 `v0.1.5` 标签，直到远端 Release 完整包生成并核验。
- 2026-10-27：阶段登记（Native UI 内嵌与 Termux JSON notfound、macOS runner 取消）：用户要求服务器二进制内嵌 Native UI，启动时无论目标目录是否存在都完整解出并覆盖，所有平台行为一致；Termux v0.2.3 实测用户页面返回 JSON notfound。实现方向：CMake 将构建后的 `native-ui/dist` 生成嵌入资源表，启动时提取到平台用户数据目录，保留 `PLUGMESH_LOCAL_UI_DIRECTORY` 显式覆盖；发布与手动构建均先生成 UI 并强制嵌入，包内不重复附带 `native-ui/dist`。原生 HTTP/CTest 验证提取覆盖行为；CI 和契约测试必须复跑。macOS 调查：v0.2.3 run `40352920204` 整体失败是因为 macOS job `121677623577` 被取消，而非编译错误；check-run annotation 表示 hosted runner 多次尝试仍未分配。发布 workflow 固定 `macos-15`，新 Release 必须验证 macOS job 成功。验证记录：`npm run ci:local` 90/90、原生 CTest 15/15、HTTP `/` 200 且 JS 资源可取、启动覆盖旧 index 并删除 stale 文件、Termux/Release 契约通过；CMake 空 UI 的可执行配置按预期失败，纯 SHARED 配置通过；可执行 CMake 默认启用 UI 嵌入。用户授权后已为 Termux 主机安装独立 SSH 公钥，BatchMode 登录成功，设备为 AArch64/Android 16；密码和私钥不得写入仓库或 HANDOFF。未完成：在用户 Termux 主机重新构建并验证页面、提交/push、完成新全平台 Release 并核验资产及 SHA256、清理临时 worktree/branch。本阶段禁止提交未跟踪 transcript `10251647.md`，不得在未验证远端标签前创建 tag；完成后更新此记录并提交。此前 v0.2.3 无 GitHub Release，不能作为成功发布陈述。
- 2026-10-27：Native UI 跨平台提取安全与构建新鲜度复核完成：`native-server/src/embedded_ui.cpp` 使用随机且仅 owner 可访问的 staging 目录；POSIX 通过 `openat`/`O_NOFOLLOW` 逐级打开，Windows 通过相对目录句柄 `NtCreateFile`/`FILE_OPEN_REPARSE_POINT` 写入，拒绝 symlink/reparse 逃逸；新增安全写入测试。`native-server/cmake/embed_native_ui.cmake` 改由 CMake build dependency 跟踪每个资源和脚本，内容不改文件名也会重生成，并由 CTest 覆盖。Termux `SHARED` 现在可在无 UI 资源时构建，包说明与实际产物一致；Windows 嵌入源以 UTF-8 编译。验证：`npm run ci:local` 全部通过（conventions 82、CSS 467、Worker smoke、Playwright 90/90），原生 CTest 17/17，Termux shared-only 契约通过，Native UI build 通过；MinGW 使用 `-std=c++2a -Wall -Wextra -Werror` 编译 Windows 实现和安全测试通过。尚未完成：在 Termux 主机进行真实构建与页面验证，MSVC/macOS 实际 runner 验证、提交/push、全平台 Release 与资产/SHA256 核验，清理临时 worktree/branch。继续排除未跟踪 transcript `10251647.md`，SSH 凭据不得记录。
- 2026-10-27：Termux 真机 `ALL` 构建与 Native UI HTTP smoke 完成；打包后 SHA256 校验通过（归档 1.7 MiB，服务器 3.3 MiB）。首次默认启动暴露 Android `/proc/<pid>/exe` 实际指向 `/apex/com.android.runtime/bin/linker64`，服务因此错误尝试在只读目录创建 `plugins`；使用包内显式 `PLUGMESH_PLUGIN_DIRECTORY` 启动后 `/` 返回 200、JS 200/330595 bytes、CSS 200/18542 bytes，且 stale 文件被覆盖/清除。修复：`native-server/src/main.cpp` 新增 Android `android_executable_path(argv0)` 规范化路径与 PATH 搜索，并由 main 传入 `argv[0]`；Termux 契约测试覆盖该路径。Termux README 更新为安装 nodejs、`npm ci`、构建 Native UI，默认 ALL 要求 dist，SHARED-only 可不带 Node/UI；SHA 校验改为实际 `.tar.gz.sha256`。Termux 脚本移除项目未启用的 C 编译器参数。Termux Android 路径修复已验证：commit `91a6edc` 从 clean cache 在 Android 16/AArch64 完成 `ALL` build；隔离启动不设置 `PLUGMESH_PLUGIN_DIRECTORY`，自动创建 `plugins` 并进入 setup；HTTP GET `/` 200、JS 200/330595 bytes、CSS 200/18542 bytes，stale 文件被清除，最终 `.tar.gz.sha256` 校验通过。本地完整 CI（82 conventions、467 CSS、Worker smoke、Playwright 90/90）、原生 CTest 17/17、MinGW `-Werror` Windows embed/safe-write 两个翻译单元通过。下一步：push `main` 并等待平台 CI；确认 `v0.2.4` 远端 tag 不存在后触发全平台 Release，核验所有资产/SHA256；清理临时 worktree/branch；继续排除未跟踪 `10251647.md`，不得记录 SSH 凭据。
- 2026-10-27：阶段登记（Windows 原生 CTest 登录认证失败诊断与修复）：当前 main `bb0679fd0aaba4ed426b062ed84e7704ea029fe6` 的平台 run `40375162030` 中，Windows job `121756162714` 的构建和 OpenSSL 部署通过，但 CTest 的 `plugmesh-local-http-server-smoke` 与 `plugmesh-tunnel-mapping-smoke` 失败；映射日志包含 `target plugin server rejected the login password`。本阶段先取得/补充具体失败阶段与 proof 诊断，再修复经证实的 Windows 回归，运行原生 CTest 与本地 CI，并 push 后等待该 SHA 的 Windows job 通过。Windows CTest 绿灯之前不得创建 `v0.2.4` tag 或发布；不记录凭据，排除未跟踪 transcript `10251647.md`，不改无关文件。
- 2026-10-27：Windows CTest portability 修复与本地验证完成（远端 runner 待复核）：`native-server/src/local_http_server.cpp` 在 Windows 不设置 `SO_REUSEADDR`，避免占用端口被复用；POSIX 设置不变。probe 与 listen 阶段均把 `address_in_use`/`access_denied` 当作冲突继续扫描。`native-server/src/tunnel_trust_store.cpp` 在覆盖前关闭读取流，Windows 使用 `MoveFileExW(..., MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)`，POSIX 保留 `std::filesystem::rename`。smoke 增加实际监听端口/错误、proof 长度与 verifier 轮换错误诊断，不输出口令或 proof 内容。验证：Linux 原生 CTest 17/17、MinGW `-Werror` 语法检查、`npm run ci:local`（UI conventions 82、CSS 467、Worker smoke、Playwright 90/90）通过。仍需 push 后确认 Windows job；若认证拒绝再次出现，利用 mock proof 诊断定位。不得在 Windows CTest 通过前创建 v0.2.4 tag。
- 2026-10-27：阶段登记（macOS CI runner provisioning 回退）：main `8c746a711410612994164df884f426e331129d88` 的平台 run `40383840970` 中，macOS job `121786846935` 排队 15 分钟后被取消；`runner_name` 为空且无步骤执行，属于 hosted runner 分配问题，不是编译/测试失败。Windows job `121786847108`、Linux 与 Web job 均成功。为完成用户要求的 macOS CTest 验收，计划将 `.github/workflows/platform-ci.yml`、`.github/workflows/release.yml`、`.github/workflows/build-plugin-server.yml` 的 macOS runner 从 `macos-15` 调整为 `macos-14`，同步更新 `scripts/release-workflow.test.sh`；之后运行合同测试和本地 CI，推送并重跑平台验收。新 main SHA 下需重新构建 Termux 包并更新 `termux-release-v0.2.4` 的 `SOURCE_COMMIT` 精确值与归档。macOS CTest 和 Windows CTest 均成功前不得创建 `v0.2.4` tag；排除未跟踪 `10251647.md`，不记录凭据。
