# Plugmesh Server

这是跨 Linux / Windows 的本地服务器基础层。当前阶段固定了两项运行时边界：

- `plugin_api.h` 定义兼容的 C ABI v2/v3：v2 通过 `plugmesh_plugin_get_api_v2` 导出 HTTP、WebSocket、SSE 和文件流能力，v3 额外提供公开 WebSocket 的建立与关闭回调。
- `PluginLoader` 负责按平台加载 `.so` / `.dll`，校验 ABI 版本和必需入口。
- `plugmesh-plugin-host` 是可执行宿主进程，按 `<library>` 参数加载单个插件动态库，并通过 stdin/stdout 的逐行 JSON 协议响应父进程请求。支持的操作为 `describe`、`start`、`stop`、`health`、`http`、`sse`、`file`、`websocket.open`、`websocket.data`、`websocket.close` 和 `shutdown`；二进制数据统一使用 Base64。
- `PluginManager` 负责扫描包含 `manifest.json` 的插件目录、校验 manifest 与 C ABI v2/v3 描述、编排加载/启停/重载、健康检查、文件流和 WebSocket 生命周期。每个已加载插件对应一个 `PluginHostClient` 子进程；插件发生访问违规等原生崩溃时只终止宿主进程，管理器把插件标记为 `failed` 并记录 `last_error`，服务器进程本身继续运行。
- `ControlClient` 使用 WebSocket++、standalone Asio 和 nlohmann/json 建立出站控制连接；生产地址使用 `wss`，localhost 开发地址可使用 `ws`。控制连接处理注册、心跳、插件命令、健康检查和 HTTP 请求帧，注册描述来自已校验的 manifest。
- `examples/sample_plugin.cpp`、`examples/lifecycle_plugin.cpp` 和对应 smoke 测试验证动态库导出、ABI 检查、基本生命周期以及 WebSocket 建立/关闭回调。`examples/crashing_plugin.cpp` 故意触发空指针崩溃，由 `plugin-manager-crash-smoke` 验证宿主隔离和失败标记。

部署时 `plugmesh-server` 与 `plugmesh-plugin-host` 需要放在同一目录，或通过 `PLUGMESH_PLUGIN_HOST` 指定宿主路径。宿主调用是同步的：插件回调长时间阻塞会阻塞控制面的对应请求，这段边界尚未改为异步或超时模型。

启动配置可以由环境变量提供；当连接参数缺失且指定了凭据文件时，服务器会使用口令解密持久化凭据：

- `PLUGMESH_WORKER_URL`
- `PLUGMESH_SERVER_ID`
- `PLUGMESH_ACCESS_TOKEN`
- `PLUGMESH_PLUGIN_DIRECTORY`
- `PLUGMESH_PLUGIN_HOST`（可选，`plugmesh-plugin-host` 路径；留空时查找与服务器可执行文件同目录的宿主）
- `PLUGMESH_CREDENTIAL_FILE`（Linux 等无系统凭据存储时使用的加密文件路径；留空时 Windows/macOS 优先使用系统凭据存储）
- `PLUGMESH_CREDENTIAL_PASSWORD`
- `PLUGMESH_LOCAL_PORT`（可选，默认 `8787`，仅绑定 `127.0.0.1`）
- `PLUGMESH_LOCAL_UI_DIRECTORY`（可选，默认 `native-ui/dist`）

本地管理端点仅监听回环地址：

- `GET /api/health`、`GET /api/status`：服务和控制连接状态。
- `GET /api/plugins`：已发现插件的 manifest 与生命周期状态。
- `GET /api/diagnostics`：插件数量、加载状态和失败数量摘要。
- `GET /api/logs`：读取最近的本地插件日志，最多保留 200 条。
- `GET /api/plugins/{pluginId}/health`：执行已启用插件的 ABI 健康检查。
- `POST /api/plugins/{pluginId}/{load|unload|enable|disable|reload}`：执行插件生命周期操作。
- `POST /api/register`：仅在连接配置缺失时可用，调用 Worker 注册并把长期凭据加密保存到本地。
- `POST /api/credentials/rotate`：通过当前控制连接轮换 Worker 访问令牌，并立即更新系统凭据或加密凭据文件。
- `POST /api/credentials/revoke`：撤销 Worker 侧服务器绑定、删除本地凭据并重新进入 setup mode。
- `GET /`、`GET /assets/*`：提供 `native-ui/dist` 中的 React 本地控制台；非资源路径回退到 `index.html`。

当 Worker 地址、服务器 ID 或访问令牌缺失时，`plugmesh-server` 不会直接退出，而是进入 setup mode 并等待 localhost 控制台提交一次性注册码。注册成功后当前进程继续启动控制连接；注册接口在正常运行态关闭。已绑定状态可以在本地控制台轮换访问令牌或撤销绑定；撤销完成后当前进程清空内存配置并重新打开 setup mode。CLI `--register` 仍作为无浏览器环境的备用入口。

Windows 使用 Credential Manager、macOS 使用 Keychain 保存系统凭据；当前 Linux 构建未检测到 Secret Service 开发依赖，因此使用 OpenSSL AES-256-GCM 加密文件回退。文件回退的口令通过 PBKDF2-HMAC-SHA256 派生密钥，文件只保存加密 envelope，不保存明文 access token，Linux 下权限收紧为用户可读写。

凭据存储回归测试：

```bash
native-server/build/plugmesh-credential-store-smoke
```

首次绑定可以使用 CLI fallback。管理端生成注册码后，在本地执行：

```bash
PLUGMESH_CREDENTIAL_PASSWORD='本地口令' \
PLUGMESH_REGISTRATION_CODE='一次性注册码' \
native-server/build/plugmesh-server --register https://console.example.com '工作站插件服务器' ~/.config/plugmesh/credentials.json
```

注册成功后，服务器启动时设置 `PLUGMESH_CREDENTIAL_FILE`、`PLUGMESH_CREDENTIAL_PASSWORD` 和 `PLUGMESH_PLUGIN_DIRECTORY`，即可从加密凭据文件恢复长期连接参数。注册码和口令也可以在交互提示中输入，不必放在环境变量中。

网络传输层复用 `worker/src/protocol.ts` 的协议字段约定；当前已接入控制 WebSocket、HTTP 回调、SSE/文件流和公开 WebSocket 的 base64 二进制桥接。HTTP 请求体和响应块使用 `bodyEncoding`/`encoding: "base64"` 传输二进制数据；未编码的错误块保留为 UTF-8 文本。文件流响应通过 `fileStream: true` 标记，大于 1 MiB 时由 Worker 临时写入 R2 并在响应消费或 15 分钟超时后回收。服务器重连后会按管理端保存的期望状态恢复插件；启用态插件必须重新通过健康检查，公开域名才会恢复在线。域名首次分配前同样会执行健康检查。本地服务器日志环与 `/api/logs` 已接入；插件主动日志回传尚未定义独立控制帧。
