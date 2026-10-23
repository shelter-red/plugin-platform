# Plugmesh Server

这是跨 Linux / Windows 的本地服务器基础层。当前阶段固定了两项运行时边界：

- `plugin_api.h` 定义兼容的 C ABI v2/v3/v4：v2 通过 `plugmesh_plugin_get_api_v2` 导出 HTTP、WebSocket、SSE 和文件流能力，v3 额外提供公开 WebSocket 的建立与关闭回调，v4 在 v3 基础上增加 SSE 取消回调 `handle_sse_cancel`。
- `PluginLoader` 负责按平台加载 `.so` / `.dylib` / `.dll`，校验 ABI 版本和必需入口。
- `plugmesh-plugin-host` 是可执行宿主进程，按 `<library>` 参数加载单个插件动态库，并通过 stdin/stdout 的逐行 JSON 协议响应父进程请求。支持的操作为 `describe`、`start`、`stop`、`health`、`http`、`sse`、`sse.cancel`、`file`、`websocket.open`、`websocket.data`、`websocket.close` 和 `shutdown`；二进制数据统一使用 Base64。
- `PluginManager` 负责扫描包含 `manifest.json` 的插件目录、校验 manifest 与 C ABI v2/v3/v4 描述、编排加载/启停/重载、健康检查、文件流、SSE 取消和 WebSocket 生命周期。每个已加载插件对应一个 `PluginHostClient` 子进程；插件发生访问违规等原生崩溃时只终止宿主进程，管理器把插件标记为 `failed` 并记录 `last_error`，服务器进程本身继续运行。
- `ControlClient` 使用 WebSocket++、standalone Asio 和 nlohmann/json 建立出站控制连接；生产地址使用 `wss`，localhost 开发地址可使用 `ws`。控制连接处理注册、心跳、插件命令、健康检查和 HTTP 请求帧，注册描述来自已校验的 manifest。收到 `server.sync` 时，客户端通过 `server.register` 的 `syncRequestId` 关联本次同步，不在注册落库前提前返回成功。
- `examples/sample_plugin.cpp`、`examples/lifecycle_plugin.cpp`、`examples/cancellable_plugin.cpp` 和对应 smoke 测试验证动态库导出、ABI 检查、基本生命周期、WebSocket 建立/关闭回调以及 ABI v4 SSE 协作式取消。`examples/crashing_plugin.cpp` 故意触发空指针崩溃，由 `plugin-manager-crash-smoke` 验证宿主隔离和失败标记。

非 MSVC 构建默认启用 `-Wall -Wextra`；`third_party/include` 以 SYSTEM 方式包含，第三方头文件的警告不会混入自家源码。

部署时 `plugmesh-server` 与 `plugmesh-plugin-host` 需要放在同一目录，或通过 `PLUGMESH_PLUGIN_HOST` 指定宿主路径。SSE 请求由 `ControlClient` 放入独立工作线程调度，插件宿主把 SSE 回调放入独立 job，因此控制协议仍可接收 `sse.cancel` 并并发触发 ABI v4 的 `handle_sse_cancel`。取消是协作式的：插件必须自行观察取消并尽快返回，宿主不会强杀插件内部的同步计算。HTTP、文件流等其他同步边界还没有因本次改动全面异步化。

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

Windows 使用 Credential Manager、macOS 使用 Keychain 保存系统凭据。macOS 会先通过 `SecItemCopyMatching` 只读探测默认钥匙串；无钥匙串、锁定或无权访问时，首次绑定界面会要求填写凭据文件路径和口令，改用 OpenSSL AES-256-GCM 加密文件。当前 Linux 构建未检测到 Secret Service 开发依赖，因此直接使用同一套加密文件回退。文件回退的口令通过 PBKDF2-HMAC-SHA256 派生密钥，文件只保存加密 envelope，不保存明文 access token，POSIX 下权限收紧为用户可读写。

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

注册成功后，服务器启动时设置 `PLUGMESH_CREDENTIAL_FILE`、`PLUGMESH_CREDENTIAL_PASSWORD` 和 `PLUGMESH_PLUGIN_DIRECTORY`，即可从加密凭据文件恢复长期连接参数。

所有参数都可以省略，交给交互式提示（无浏览器环境的备用入口）：

```bash
native-server/build/plugmesh-server --register
# Worker URL: https://console.example.com
# Server name: 工作站插件服务器
# Credential file: ~/.config/plugmesh/credentials.json
# Registration code: 一次性注册码
# Local UI password: ********
# Confirm local UI password: ********
# Credential file password: ********
```

省略的参数依次从 `PLUGMESH_WORKER_URL`、`PLUGMESH_SERVER_NAME`、`PLUGMESH_CREDENTIAL_FILE` 读取，注册码与口令分别使用 `PLUGMESH_REGISTRATION_CODE`、`PLUGMESH_LOCAL_UI_PASSWORD`（及 `PLUGMESH_LOCAL_UI_PASSWORD_CONFIRMATION`）、`PLUGMESH_CREDENTIAL_PASSWORD`；环境变量优先于提示，输入会去掉首尾空白，本地 UI 口令至少 8 位。

## 使用 GitHub Actions 构建产物

`.github/workflows/build-plugin-server.yml` 只接受手动触发。选择 `executable` 时，artifact 名称形如 `plugmesh-plugin-server-linux-executable-Release`，包含 `plugmesh-server`、`plugmesh-plugin-host`、`plugin_api.h`、README、构建信息和归档校验和；选择 `shared` 时还包含 Linux 的 `libplugmesh-server.so`、macOS 的 `libplugmesh-server.dylib` 或 Windows 的 DLL/导入库，以及 `server_api.h`。下载后在 artifact 根目录执行 `sha256sum -c SHA256SUMS`（macOS 使用 `shasum -a 256 -c SHA256SUMS`），确认归档未被替换后再解压。

Linux 和 macOS 产物需要系统可用的 OpenSSL 3 运行库；Windows 产物会随包复制构建所需的 vcpkg DLL。所有平台都需要把 `plugmesh-plugin-host` 与服务器放在同一目录，或设置 `PLUGMESH_PLUGIN_HOST`。artifact 不包含 `native-ui/dist`，需要本地控制台时先执行 `npm run native-ui:build`，再设置 `PLUGMESH_LOCAL_UI_DIRECTORY`；无浏览器环境可以直接使用上面的 `--register` CLI。

构建产物中的 `plugin_api.h` 是插件动态库 ABI，`server_api.h` 是共享库嵌入接口，二者用途不同。插件目录仍按一个插件一个子目录放置 `manifest.json` 和 `.so`/`.dylib`/`.dll`，服务器只会发现 manifest 中 `library` 位于该子目录内的插件。

## 共享库嵌入

CMake 的 `plugmesh-server-shared` target 会生成真正的共享库：Linux 为 `libplugmesh-server.so`，macOS 为 `libplugmesh-server.dylib`，Windows 为 `plugmesh-server.dll`。公共头文件 `include/plugmesh/server_api.h` 只暴露 C ABI，避免把 C++ STL 类型跨越动态库边界。

共享库接收已经注册的 Worker 参数，不包含命令行注册和本地 UI setup 流程。调用方负责安全保存凭据，并在 `plugin_host_executable` 中提供 `plugmesh-plugin-host` 的路径；该路径为空时由现有 `PLUGMESH_PLUGIN_HOST` 规则解析。`plugmesh_server_create` 会复制配置字符串，最小生命周期如下：

```c
#include "plugmesh/server_api.h"

plugmesh_server_config config = {
    "https://console.example.com",
    "server-id",
    "access-token",
    "/opt/plugmesh/plugins",
    "/opt/plugmesh/plugmesh-plugin-host",
};
char error[256];
plugmesh_server* server = plugmesh_server_create(&config, error, sizeof(error));
if (!server || !plugmesh_server_start(server)) {
    /* error contains a validation or startup message. */
}
/* Keep the server alive while the host application is running. */
plugmesh_server_stop(server);
plugmesh_server_destroy(server);
```

库文件和可执行文件都需要 OpenSSL 3 运行库；共享库还需要调用方链接本项目导出的 C ABI，并把插件宿主放在可执行文件旁或显式传入路径。手动构建入口会把共享库、插件宿主、公共头和构建说明一起打包。

## Windows 构建

### MSVC

需要 Visual Studio 2019 或更高版本、CMake 3.16 以上，以及 64 位 OpenSSL 3（推荐 `vcpkg install openssl:x64-windows`）：

```bash
cmake -S native-server -B build-win -G "Visual Studio 17 2022" -A x64 \
  -DCMAKE_TOOLCHAIN_FILE=%VCPKG_ROOT%/scripts/buildsystems/vcpkg.cmake
cmake --build build-win --config Release
```

### MinGW-w64 交叉编译

没有 Windows 主机时，可用 MinGW-w64 在 Linux 上交叉编译，检查 Windows 分支能否编译和链接：

```bash
# 1. 安装 posix 线程模型工具链（websocketpp 在该模型下使用 std::thread）
sudo apt-get install g++-mingw-w64-x86-64-posix

# 2. 交叉编译静态 OpenSSL（示例版本 3.0.20）；前缀用任意可写目录即可，无需 root
curl -LO https://deb.debian.org/debian/pool/main/o/openssl/openssl_3.0.20.orig.tar.gz
tar xzf openssl_3.0.20.orig.tar.gz && cd openssl-3.0.20
./Configure mingw64 no-shared no-tests --cross-compile-prefix=x86_64-w64-mingw32- --prefix=/tmp/mingw-openssl
make -j"$(nproc)" && make install_sw
cd ..

# 3. 交叉编译服务器
cmake -S native-server -B /tmp/build-win \
  -DCMAKE_TOOLCHAIN_FILE="$PWD/native-server/cmake/mingw-w64-toolchain.cmake" \
  -DOPENSSL_ROOT_DIR=/tmp/mingw-openssl \
  -DCMAKE_BUILD_TYPE=Release
cmake --build /tmp/build-win -j"$(nproc)"
```

产物为 `plugmesh-server.exe`、`plugmesh-plugin-host.exe`、本地 UI smoke 服务器、各 smoke 测试和示例插件 `libplugmesh-*.dll`。`CMAKE_BUILD_TYPE` 必须是 `Release`：未优化时 websocketpp/Asio 模板实例化会超过 MinGW COFF 单节大小上限。

产物默认静态链接 MinGW 运行时，只依赖 `ADVAPI32`、`KERNEL32`、`MSWSOCK`、`WS2_32` 等系统 DLL，不需要附带 `libstdc++`/`libgcc`/`libwinpthread`。

### 在 Wine 下运行冒烟用例

没有 Windows 主机时可以用 `wine64` 运行交叉编译产物，检查启动、`.dll` 加载和 Credential Manager 调用路径：

```bash
export WINEPREFIX="$HOME/.wine-plugmesh"
cd /tmp/build-win
PLUGMESH_TEST_SYSTEM_CREDENTIALS=required wine64 plugmesh-credential-store-smoke.exe
wine64 plugmesh-control-protocol-smoke.exe
wine64 plugmesh-local-http-server-smoke.exe
wine64 plugmesh-registration-client-smoke.exe
wine64 plugmesh-plugin-loader-smoke.exe "$(winepath -w libplugmesh-sample.dll)"
wine64 plugmesh-plugin-host-smoke.exe "$(winepath -w plugmesh-plugin-host.exe)" \
  "$(winepath -w libplugmesh-sample.dll)" "$(winepath -w libplugmesh-crashing-sample.dll)"
wine64 plugmesh-plugin-manager-smoke.exe "$(winepath -w plugmesh-plugin-host.exe)" "$(winepath -w plugins)"
wine64 plugmesh-plugin-manager-crash-smoke.exe "$(winepath -w plugmesh-plugin-host.exe)" "$(winepath -w plugins)"
wine64 plugmesh-plugin-websocket-lifecycle-smoke.exe "$(winepath -w plugmesh-plugin-host.exe)" "$(winepath -w plugins)"
wine64 plugmesh-control-client-smoke.exe "$(winepath -w plugmesh-plugin-host.exe)" "$(winepath -w plugins)"
PLUGMESH_LOCAL_PORT=8899 PLUGMESH_LOCAL_UI_DIRECTORY="$(winepath -w ../native-ui/dist)" \
  wine64 plugmesh-server.exe &
curl -s http://127.0.0.1:8899/api/health
```

### 在 Wine 下运行本地 UI 冒烟用例

`native-ui/run-wine-smoke.sh`（等价于 `npm run native-ui:smoke:wine`）会用 Wine 启动两个 `plugmesh-local-ui-smoke-server.exe` 实例（认证端口 18771、首次绑定端口 18772），再把 `native-ui` 的 Playwright 用例指向它们，覆盖首次绑定、会话流程、主题切换和语言切换：

```bash
native-ui/run-wine-smoke.sh            # 默认使用 native-server/build-win
native-ui/run-wine-smoke.sh /tmp/build-win
```

脚本通过 `PLUGMESH_NATIVE_UI_SMOKE_URL`、`PLUGMESH_NATIVE_UI_SETUP_URL` 复用外部服务（此时 Playwright 不再自行拉起 Linux smoke 服务器），并用 `PLUGMESH_SMOKE_PLUGIN_DIRECTORY` 把插件目录换成 Windows 构建产物里的 `.dll`。

崩溃隔离用例会让插件宿主故意触发空指针崩溃，Wine 会打印 `page fault` 日志，属于预期现象。Wine 不是 Windows：真实 Win32 API 行为、注册表凭据存储、服务账户和多用户场景仍需要在 Windows 主机上验证。

网络传输层复用 `worker/src/protocol.ts` 的协议字段约定；当前已接入控制 WebSocket、HTTP 回调、SSE/文件流和公开 WebSocket 的 base64 二进制桥接。HTTP 请求体和响应块使用 `bodyEncoding`/`encoding: "base64"` 传输二进制数据；未编码的错误块保留为 UTF-8 文本。文件流响应通过 `fileStream: true` 标记，大于 1 MiB 时由 Worker 临时写入 R2 并在响应消费或 15 分钟超时后回收。服务器重连后会按管理端保存的期望状态恢复插件；启用态插件必须重新通过健康检查，公开域名才会恢复在线。域名首次分配前同样会执行健康检查。本地服务器日志环与 `/api/logs` 已接入；插件主动日志回传尚未定义独立控制帧。
