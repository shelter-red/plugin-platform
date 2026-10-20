# Plugmesh Server

这是跨 Linux / Windows 的本地服务器基础层。当前阶段固定了两项运行时边界：

- `plugin_api.h` 定义稳定 C ABI，插件通过 `plugmesh_plugin_get_api_v1` 导出能力。
- `PluginLoader` 负责按平台加载 `.so` / `.dll`，校验 ABI 版本和必需入口。

配置由环境变量提供，便于后续接入本地 Web UI、系统密钥链和一次性注册码流程：

- `PLUGMESH_WORKER_URL`
- `PLUGMESH_SERVER_ID`
- `PLUGMESH_ACCESS_TOKEN`
- `PLUGMESH_PLUGIN_DIRECTORY`
- `PLUGMESH_CREDENTIAL_FILE`

网络传输层会复用 `worker/src/protocol.ts` 的协议字段约定；这一阶段不引入第三方网络库，避免在 ABI 和配置边界未稳定前锁定实现细节。
