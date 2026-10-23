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

在「系统设置 → Cloudflare」打开创建 API Token 链接，按三个下拉框填写固定权限：左侧范围选择 `账户 / Account`、`区域 / Zone` 或 `用户 / User`，中间选择权限组，右侧选择级别：

| 范围 / Scope | 权限组 / Permission | 级别 / Level |
| --- | --- | --- |
| 账户 / Account | 账户设置 / Account Settings | 读取 / Read |
| 账户 / Account | 账户分析 / Account Analytics | 读取 / Read |
| 账户 / Account | 账单 / Billing | 读取 / Read |
| 区域 / Zone | 区域 / Zone | 读取 / Read |
| 区域 / Zone | DNS | 写入 / Write |
| 区域 / Zone | Workers 路由 / Workers Routes | 编辑 / Edit |

`账户 / Account` 选择目标账号，`区域 / Zone` 选择插件域名所在 Zone，`用户 / User` 不使用。平台会验证 Token、读取可见账号和 subscriptions；本页的 Account ID 只用于多个可见账号时选择目标账号。返回设置页后，六项权限会分别显示“已验证”“缺少”或“未检测”。

保存「维护、域名与配额」中的插件域名后缀时，平台会用已保存 Token 找到对应 Zone，写入通配 DNS 记录并创建 Worker Route。插件后缀不要使用包含管理端主站的父域名，例如主站为 `platform.example.com` 时使用 `plugins.example.com`。已有其他 DNS 记录或 Worker 路由时会保留原配置并返回冲突，不能通过平台覆盖。

如果错误后缀已经让主站返回「Plugin domain not found」，可先在 Cloudflare Dashboard → D1 → `plugmesh` → Console 执行下面的应急更新，把 `plugins.example.com` 换成实际插件后缀；恢复访问后再从系统设置保存一次，让平台用 Token 自动同步 DNS 和 Worker Route：

```sql
UPDATE platform_settings
SET value_json = json_set(value_json, '$.pluginDomainSuffix', '.plugins.example.com'),
    updated_at = datetime('now')
WHERE key = 'platform';
```

- `401 token_invalid`：Token 无效、已被撤销，或你设置了过期时间且已经到期；请重建 Token。
- `403 token_permission_denied`：Token 缺少上述任一权限；请修改权限或重新创建 Token。
- `409 account_missing` / `409 account_ambiguous`：Token 看不到账号，或能看到多个账号；请在表单中填写目标 Account ID。
- `502 cloudflare_upstream_error`：Cloudflare 或网络暂时异常；可稍后在用量页点击唯一的「刷新用量」重试。

错误会保留在当前设置或用量页面并显示 HTTP 状态、错误码和原始消息。Cloudflare 免费额度只从 subscriptions 读取；未确认 Free 计划时页面显示「未读取」，不能手工填写。

## 支持范围

本仓库为自托管插件平台，不提供托管服务。反馈问题时请附上访问日志、审计日志与部署方式。
