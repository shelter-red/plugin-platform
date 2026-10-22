### 收集的数据

- GitHub 身份：`github_id`、显示名与已验证邮箱，用于登录和权限判断。
- 会话：HttpOnly Cookie 保存会话标识，服务端只存哈希。
- 运行数据：服务器心跳、插件清单、公开请求日志与审计事件。
- 配置：GitHub OAuth 客户端凭据、SMTP 密码与 Cloudflare API Token 经 AES-GCM 加密后存入 D1；GET 接口不回显密钥。

### 数据用途

仅用于登录鉴权、路由转发、用量统计、审计与维护通知。

### 保留期限

- 访问日志保留 30 天。
- 审计日志保留 180 天。
- 过期会话、GitHub OAuth state、注册码与临时对象由定时任务清理。

### 第三方

- GitHub：OAuth 登录。
- Cloudflare：通过 API Token 查询 Workers、D1、R2 与账号用量；Token 不用于登录。
- SMTP 服务商：邀请与维护邮件。

### 你的选择

可在「账号」页退出登录；部署者可随时删除 D1 与 R2 中的数据。
