# Plugmesh Server

这是跨 Linux / Windows 的本地服务器基础层。当前阶段固定了两项运行时边界：

- `plugin_api.h` 定义稳定 C ABI，插件通过 `plugmesh_plugin_get_api_v1` 导出能力。
- `PluginLoader` 负责按平台加载 `.so` / `.dll`，校验 ABI 版本和必需入口。
- `PluginManager` 负责扫描包含 `manifest.json` 的插件目录、校验 manifest 与 C ABI 描述、编排加载/启停/重载和健康检查生命周期。
- `ControlClient` 使用 WebSocket++、standalone Asio 和 nlohmann/json 建立 `wss` 出站连接，处理注册、心跳、插件命令和 HTTP 请求帧；注册描述来自已校验的 manifest。
- `examples/sample_plugin.cpp` 和 `tests/plugin_loader_smoke.cpp` 验证动态库导出、ABI 检查和基本生命周期。

启动配置可以由环境变量提供；当连接参数缺失且指定了凭据文件时，服务器会使用口令解密持久化凭据：

- `PLUGMESH_WORKER_URL`
- `PLUGMESH_SERVER_ID`
- `PLUGMESH_ACCESS_TOKEN`
- `PLUGMESH_PLUGIN_DIRECTORY`
- `PLUGMESH_CREDENTIAL_FILE`（Linux 等无系统凭据存储时使用的加密文件路径；留空时 Windows/macOS 优先使用系统凭据存储）
- `PLUGMESH_CREDENTIAL_PASSWORD`
- `PLUGMESH_LOCAL_PORT`（可选，默认 `8787`，仅绑定 `127.0.0.1`）
- `PLUGMESH_LOCAL_UI_DIRECTORY`（可选，默认 `native-ui/dist`）

本地管理端点仅监听回环地址：

- `GET /api/health`、`GET /api/status`：服务和控制连接状态。
- `GET /api/plugins`：已发现插件的 manifest 与生命周期状态。
- `GET /api/diagnostics`：插件数量、加载状态和失败数量摘要。
- `GET /api/plugins/{pluginId}/health`：执行已启用插件的 ABI 健康检查。
- `POST /api/plugins/{pluginId}/{load|unload|enable|disable|reload}`：执行插件生命周期操作。
- `POST /api/register`：仅在连接配置缺失时可用，调用 Worker 注册并把长期凭据加密保存到本地。
- `GET /`、`GET /assets/*`：提供 `native-ui/dist` 中的 React 本地控制台；非资源路径回退到 `index.html`。

当 Worker 地址、服务器 ID 或访问令牌缺失时，`plugmesh-server` 不会直接退出，而是进入 setup mode 并等待 localhost 控制台提交一次性注册码。注册成功后当前进程继续启动控制连接；注册接口在正常运行态关闭。CLI `--register` 仍作为无浏览器环境的备用入口。

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

网络传输层复用 `worker/src/protocol.ts` 的协议字段约定；当前已接入控制 WebSocket、HTTP 回调、SSE 流和公开 WebSocket 的 base64 二进制桥接。文件流和插件级日志回传仍未完成。
