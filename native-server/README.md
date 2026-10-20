# Plugmesh Server

这是跨 Linux / Windows 的本地服务器基础层。当前阶段固定了两项运行时边界：

- `plugin_api.h` 定义稳定 C ABI，插件通过 `plugmesh_plugin_get_api_v1` 导出能力。
- `PluginLoader` 负责按平台加载 `.so` / `.dll`，校验 ABI 版本和必需入口。
- `PluginManager` 负责扫描插件目录、读取 C ABI 描述、编排加载/启停/重载和健康检查生命周期。
- `ControlClient` 使用 WebSocket++、standalone Asio 和 nlohmann/json 建立 `wss` 出站连接，处理注册、心跳、插件命令和 HTTP 请求帧；注册描述当前由 C ABI 字段生成。
- `examples/sample_plugin.cpp` 和 `tests/plugin_loader_smoke.cpp` 验证动态库导出、ABI 检查和基本生命周期。

配置由环境变量提供，便于后续接入本地 Web UI、系统密钥链和一次性注册码流程：

- `PLUGMESH_WORKER_URL`
- `PLUGMESH_SERVER_ID`
- `PLUGMESH_ACCESS_TOKEN`
- `PLUGMESH_PLUGIN_DIRECTORY`
- `PLUGMESH_CREDENTIAL_FILE`

网络传输层复用 `worker/src/protocol.ts` 的协议字段约定；当前已接入控制 WebSocket 和 HTTP 回调，SSE、文件流、公开 WebSocket 的二进制回传及本地 Web UI 仍未完成。
