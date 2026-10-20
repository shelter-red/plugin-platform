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
- `PLUGMESH_CREDENTIAL_FILE`
- `PLUGMESH_CREDENTIAL_PASSWORD`
- `PLUGMESH_LOCAL_PORT`（可选，默认 `8787`，仅绑定 `127.0.0.1`）

本地管理端点仅监听回环地址：

- `GET /api/health`、`GET /api/status`：服务和控制连接状态。
- `GET /api/plugins`：已发现插件的 manifest 与生命周期状态。
- `GET /api/diagnostics`：插件数量、加载状态和失败数量摘要。
- `POST /api/plugins/{pluginId}/{load|unload|enable|disable|reload}`：执行插件生命周期操作。

凭据文件使用 OpenSSL AES-256-GCM 加密，口令通过 PBKDF2-HMAC-SHA256 派生密钥；文件只保存加密 envelope，不保存明文 access token。Linux 下文件权限收紧为用户可读写。生产部署应通过本地配置 UI 或受保护的进程环境提供口令，当前版本尚未接入系统密钥链。

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

网络传输层复用 `worker/src/protocol.ts` 的协议字段约定；当前已接入控制 WebSocket 和 HTTP 回调，SSE、文件流、公开 WebSocket 的二进制回传及本地 Web UI 仍未完成。
