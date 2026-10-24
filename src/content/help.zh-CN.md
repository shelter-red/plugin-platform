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

### 使用二进制插件服务器

从 GitHub Actions 的「手动构建插件服务器」下载与你的系统和产物类型匹配的 artifact。`executable` 是可直接启动的 `plugmesh-server`，并包含 `native-ui/dist`；未注册时双击会自动打开首次绑定页。`shared` 是供其他程序嵌入的共享库，不是独立可执行文件，也不提供 setup UI。Linux artifact 已包含以 glibc 2.31 兼容基线构建的 `libssl.so.3` 和 `libcrypto.so.3`，Windows artifact 已包含 OpenSSL DLL；macOS 从源码构建时需要 `brew install openssl@3`。下载后先校验 `SHA256SUMS`：Linux 使用 `sha256sum -c SHA256SUMS`，macOS 使用 `shasum -a 256 -c SHA256SUMS`，Windows PowerShell 用 `Get-FileHash` 对照文件中的 SHA-256。不要混用不同操作系统构建出的插件库或服务器。

插件目录必须按“一个插件一个子目录”组织，每个子目录至少包含 `manifest.json` 和与当前平台匹配的动态库，例如 Linux：

```text
plugins/
└── sample.plugin/
    ├── manifest.json
    └── libsample.so
```

`manifest.json` 至少声明 `id`、`name`、`version`、`abiVersion`、`library`、`healthPath`、`capabilities` 和 `permissions`；`abiVersion` 支持 2、3、4，`library` 只能指向同一插件目录内的 `.so`、`.dylib` 或 `.dll`。插件 ABI 公共头文件随构建 artifact 提供，具体字段和回调见仓库的 `native-server/README.md`。

在管理端「插件服务器」生成一次性注册码，然后在解压后的服务器目录执行绑定。Linux/macOS 示例：

```bash
PLUGMESH_CREDENTIAL_PASSWORD='本地凭据口令' \
PLUGMESH_REGISTRATION_CODE='一次性注册码' \
./plugmesh-server --register https://platform.example.com '边缘服务器' ~/.config/plugmesh/credentials.json
```

Windows PowerShell 示例：

```powershell
$env:PLUGMESH_CREDENTIAL_PASSWORD = '本地凭据口令'
$env:PLUGMESH_REGISTRATION_CODE = '一次性注册码'
.\plugmesh-server.exe --register https://platform.example.com '边缘服务器' "$env:USERPROFILE\.plugmesh\credentials.json"
```

绑定后启动服务器。`plugmesh-plugin-host` 放在 `plugmesh-server` 同一目录时可以省略 `PLUGMESH_PLUGIN_HOST`；否则必须指定它。可执行 artifact 会从可执行文件同目录的 `native-ui/dist` 提供本机管理界面；`PLUGMESH_LOCAL_UI_DIRECTORY` 只用于源码运行或自定义界面目录。

```bash
PLUGMESH_CREDENTIAL_FILE="$HOME/.config/plugmesh/credentials.json" \
PLUGMESH_CREDENTIAL_PASSWORD='本地凭据口令' \
PLUGMESH_PLUGIN_DIRECTORY="$PWD/plugins" \
PLUGMESH_PLUGIN_HOST="$PWD/plugmesh-plugin-host" \
./plugmesh-server
```

服务器在管理端显示在线后，到「插件实例」执行加载、启用，再执行健康检查；健康检查通过后，在「公开域名」分配前缀。服务器本地默认只监听 `127.0.0.1:8787`，可用 `PLUGMESH_LOCAL_PORT` 修改端口。`PLUGMESH_WORKER_URL`、`PLUGMESH_PLUGIN_DIRECTORY`、`PLUGMESH_PLUGIN_HOST`、`PLUGMESH_CREDENTIAL_FILE`、`PLUGMESH_CREDENTIAL_PASSWORD` 和 `PLUGMESH_LOCAL_UI_DIRECTORY` 都可以用环境变量配置；不要把访问令牌或凭据文件提交到代码仓库。

### 使用共享库嵌入宿主

共享库 artifact 只提供服务器运行库、`plugmesh-plugin-host`、`server_api.h` 和构建说明。宿主程序需要自行保存凭据，并通过 `plugmesh_server_config` 传入已绑定的 Worker 地址、服务器 ID、访问令牌、插件目录和宿主可执行文件路径；共享库不提供 `--register` 或本地 UI setup。调用方链接对应平台的 `libplugmesh-server.so`、`libplugmesh-server.dylib` 或 Windows `plugmesh-server.dll`/导入库，并随程序提供 OpenSSL 3 运行库。

最小 C ABI 生命周期如下：

```c
#include "plugmesh/server_api.h"

plugmesh_server_config config = {
    "https://platform.example.com",
    "server-id",
    "access-token",
    "/opt/plugmesh/plugins",
    "/opt/plugmesh/plugmesh-plugin-host",
};
char error[256];
plugmesh_server* server = plugmesh_server_create(&config, error, sizeof(error));
if (!server || !plugmesh_server_start(server)) {
    /* 记录 plugmesh_server_last_error(server) 或 error 后处理失败。 */
}
/* 宿主进程存活期间保持 server 运行。 */
plugmesh_server_stop(server);
plugmesh_server_destroy(server);
```

`server_api.h` 是跨 C/C++ 宿主的稳定 C ABI，不要让 STL 类型跨越边界；插件自身仍按 `plugin_api.h` 的 ABI v2/v3/v4 导出入口。`plugmesh_server_create` 会复制配置字符串，停止时必须按 `stop` → `destroy` 顺序释放。跨平台的导入库、RPATH、OpenSSL 和插件目录布局见 [`native-server/README.md`](https://github.com/shelter-red/plugin-platform/blob/main/native-server/README.md)。

如果服务器没有发现插件，先检查 `PLUGMESH_PLUGIN_DIRECTORY`、子目录中的 `manifest.json`、`library` 扩展名和 `PLUGMESH_PLUGIN_HOST`；如果健康检查失败，先在本机查看 `/api/diagnostics` 与 `/api/logs`，再检查服务器到 Worker 的 HTTPS 出站连接。

## 支持范围

本仓库为自托管插件平台，不提供托管服务。反馈问题时请附上访问日志、审计日志与部署方式。
