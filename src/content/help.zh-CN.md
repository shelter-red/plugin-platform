## 快速开始

1. 首次部署后访问 `/setup`，用初始化令牌写入 GitHub OAuth App 配置。
2. 使用 GitHub 账号登录；平台只允许被邀请的身份进入。
3. 在「插件服务器」生成一次性注册码，并在服务器上执行 `plugmesh-server --register <code>`。
4. 服务器上线后，在「插件实例」加载并启用插件。
5. 健康检查通过后，在「公开域名」分配前缀，公开入口立即可用。

## 常用操作

- **主题与语言**：顶部栏下拉即时切换，选择会写入本地存储。
- **搜索与跳转**：按 ⌘K / Ctrl+K 打开命令面板，可检索页面、设置分区、服务器、插件、域名、访问日志和审计事件。
- **导出日志**：访问日志与审计日志页可导出带 UTF-8 BOM 的 CSV。
- **维护模式**：在「系统设置 → 维护、域名与配额」暂停平台入口，公开请求会收到维护页。

## 常见问题

### 为什么服务器一直显示离线？

服务器需要能主动出站连接 Worker。请检查注册码是否已被使用、服务器时间是否准确，以及控制连接是否被防火墙阻断。

### 为什么不能分配域名？

域名只能分配给已启用且健康检查通过的插件；前缀必须唯一，且不能使用平台保留字。

### Cloudflare API Token 读取失败怎么办？

配置 Cloudflare 不需要创建 OAuth 客户端。请在「系统设置 → Cloudflare」点击「创建 API Token」，按页面固定清单授予 `Account Settings Read`、`Account Analytics Read` 和 `Billing Read` 三项只读权限，然后粘贴回来保存。平台会先验证 Token、读取可见账号，再读取 subscriptions；这三项权限不需要也无法在平台内勾选或取消。

- `401 token_invalid`：Token 无效、已被撤销，或你设置了过期时间且已经到期；请重建 Token。
- `403 token_permission_denied`：Token 缺少上述任一权限；请修改权限或重新创建 Token。
- `409 account_missing` / `409 account_ambiguous`：Token 看不到账号，或能看到多个账号；请在表单中填写目标 Account ID。
- `502 cloudflare_upstream_error`：Cloudflare 或网络暂时异常；可稍后在用量页点击唯一的「刷新用量」重试。

错误会保留在当前设置或用量页面并显示 HTTP 状态、错误码和原始消息。Cloudflare 免费额度只从 subscriptions 读取；未确认 Free 计划时页面显示「未读取」，不能手工填写。

## 支持范围

本仓库为自托管插件平台，不提供托管服务。反馈问题时请附上访问日志、审计日志与部署方式。
