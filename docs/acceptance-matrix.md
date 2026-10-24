# Plugmesh 当前验收矩阵

更新日期：2026-10-24

## 状态定义

- **本地已验证**：本仓库自动化已通过。
- **模块已验证**：使用确定性 Cloudflare/网络桩覆盖，尚未连接生产账号。
- **待生产验证**：实现和本地测试已完成，但需要真实部署环境。

## 核心能力

| 验收项 | 状态 | 证据与边界 |
| --- | --- | --- |
| 首次管理员密码初始化 | 本地已验证 | `worker/runtime/setup.test.ts` 验证未初始化页面/API 门禁、密码长度与确认校验、版本化 PBKDF2 派生结果、旧哈希兼容、生产数据形态下原子落库、失败回滚和 setup 关闭；`0009_password_auth.sql` 创建凭据表。缺少该表时健康检查、setup 和管理 API 返回结构化 `503 migration_required`，不泄漏为 Cloudflare 1101。 |
| 管理员密码登录与修改 | 本地已验证 | runtime 验证错误密码 401、成功签发 HttpOnly 会话、修改密码校验当前密码并撤销全部旧会话；Playwright 覆盖组件化登录页和设置页修改密码。 |
| 旧认证入口移除 | 本地已验证 | Worker 不再注册第三方登录、OAuth 设置和邀请接口；管理端无对应入口；历史表只用于升级兼容和初始化清理。 |
| Cloudflare Email + Global API Key | 模块已验证 | `cloudflare-credentials.test.ts` 与 `cloudflare-settings.test.ts` 覆盖 `/user` 验证、账号分页、唯一/指定账号、subscriptions、密文保存、GET 不回显、删除本地密文和 401/403/409/502。 |
| Cloudflare 多账号选择 | 本地已验证 | API 在 `account_ambiguous` 中返回账号列表；设置页使用 AntD Select 原地选择 Account ID 后重试，不离开设置页。 |
| DNS 与 Worker Route 自动配置 | 模块已验证 | runtime 覆盖 Zone 匹配、通配 DNS、Worker Route 创建/复用和冲突保护；真实 Cloudflare Zone 待联调。 |
| Cloudflare 官方用量 | 模块已验证 | `analytics.test.ts` 覆盖缓存、过期刷新、部分资源 403 时保留可读取数据、D1/KV/DO 明细和 subscriptions 免费额度。 |
| 平台本地用量 | 本地已验证 | 本地接口与官方接口独立；Cloudflare 未配置时本地统计仍返回 200。请求只计数，连接/R2 阈值可触发维护。 |
| 用量刷新交互 | 本地已验证 | Playwright 验证唯一刷新入口、自动加载期间仍可点击，并同时刷新官方与本地数据。 |
| 主站与插件 Host 分流 | 本地已验证 | runtime 和 smoke 覆盖显式 `CONSOLE_HOSTNAME`、D1 插件 Host、未知域名、动态后缀和离线维护页；未配置主站 Host 时只识别真实插件域名，避免主站误报 `Plugin domain not found`。 |
| 多工作区与角色 | 本地已验证 | runtime 覆盖工作区隔离、owner/operator/viewer 权限和超级管理员跨工作区；Playwright 覆盖切换、创建和成员角色管理。 |
| 注册码与服务器绑定 | 本地已验证 | runtime/smoke 覆盖注册码一次性原子消费、绑定令牌摘要、轮换、撤销、断线和重连。 |
| HTTP/SSE/WebSocket/文件流 | 本地已验证 | workerd runtime 与本地真实栈覆盖请求映射、并发隔离、取消、超时、响应大小、R2 中转及清理。 |
| SMTP 测试与维护通知 | 本地已验证 | runtime 启动真实本地 SMTP 服务，覆盖未保存配置测试、密钥回退、成功投递、三次失败重试和脱敏审计；公网 TLS/退信待验证。 |
| 管理端组件化与响应式 | 本地已验证 | 页面按外壳、数据 hook、功能面板拆分；Playwright 覆盖桌面/移动、深浅主题、axe、截图、图标和默认工作区对齐。 |
| 推送前本地 CI | 本地已验证 | `ci:local` 与 Actions web job 同序；Playwright 容器使用当前 UID/GID，避免产生 root-owned Vite 缓存。 |
| 部署 migration 门禁 | 本地已验证 | `deploy-worker.test.sh` 覆盖 D1/R2 创建、迁移先于发布、待迁移拒绝发布、Workers Builds 托管模式和只生成 `SESSION_SECRET`。 |
| 手动原生构建与 Release | 本地已验证 | workflow 支持平台/产物类型/构建类型选择；Linux 使用 Debian 11 兼容基线并随包携带 OpenSSL，Windows 随包 DLL；Release 要求 `v*` tag。真机仍需验收。 |

## 当前自动化基线

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

runtime 在 `node:22-bookworm` 容器中运行，避免宿主机 glibc 与 workerd 二进制基线不兼容。

## 生产待验收

1. 生产 D1 已应用 `0001` 至 `0009` 且复核无待执行 migration；仍需确认 Workers Builds Deploy command 为 `npm run deploy`。官方 Triggers GET 已定位，但当前 Wrangler OAuth 返回 403，需在 Dashboard 查看或使用 Workers CI Read 凭据读取。
2. 管理员密码已由用户完成初始化；仍需由用户使用真实密码验证登录、修改密码和修改后的旧会话撤销。
3. 在后台保存真实 Cloudflare Email、Global API Key 和 Account ID，验证 subscriptions、Analytics、Zone、DNS 与 Worker Route。
4. 未配置 `CONSOLE_HOSTNAME` 时，生产主站回退已验证；若需要显式隔离管理端 Host，仍需在部署环境配置该变量。插件域名应使用独立子域后缀。
5. 配置公网 SMTP，验证 STARTTLS/SMTPS、维护通知和退信处理。
6. 在真实 Windows 主机验证可执行程序首次绑定、配置失败后重试、插件宿主子进程和 DLL；在目标 Linux 发行版验证打包产物无需系统 OpenSSL 且兼容 glibc 2.31。
7. 在已部署 Worker 上完成 HTTP、SSE、WebSocket、大文件、断线恢复和持续并发压力测试。2026-10-24 只读清点确认生产服务器、插件、域名和请求日志均为 0；必须先由用户在真实主机注册服务器、加载插件并分配域名，当前没有可测试目标。
