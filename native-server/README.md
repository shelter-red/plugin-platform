# Plugmesh Server

这是跨 Linux / Windows 的本地服务器基础层。当前阶段固定了两项运行时边界：

- `plugin_api.h` 定义唯一的 C ABI v1：插件导出 `plugmesh_plugin_get_api`，由同一张平铺入口表声明 HTTP、WebSocket、SSE、文件流及其生命周期回调。插件 manifest 的 `abiVersion` 必须为 `1`；旧 ABI 插件需要使用当前头文件重新编译。
- `PluginLoader` 负责按平台加载 `.so` / `.dylib` / `.dll`，校验 ABI 版本和必需入口。
- `plugmesh-plugin-host` 是可执行宿主进程，按 `<library>` 参数加载单个插件动态库，并通过 stdin/stdout 的逐行 JSON 协议响应父进程请求。支持的操作为 `describe`、`start`、`stop`、`health`、`http`、`sse`、`sse.cancel`、`file`、`websocket.open`、`websocket.data`、`websocket.close` 和 `shutdown`；二进制数据统一使用 Base64。
- `PluginManager` 负责扫描包含 `manifest.json` 的插件目录、校验 manifest 与唯一 C ABI 描述、编排加载/启停/重载、健康检查、文件流、SSE 取消和 WebSocket 生命周期。每个已加载插件对应一个 `PluginHostClient` 子进程；插件发生访问违规等原生崩溃时只终止宿主进程，管理器把插件标记为 `failed` 并记录 `last_error`，服务器进程本身继续运行。
- `ControlClient` 使用 WebSocket++、standalone Asio 和 nlohmann/json 建立出站控制连接；生产地址使用 `wss`，localhost 开发地址可使用 `ws`。控制连接处理注册、心跳、插件命令、健康检查和 HTTP 请求帧，注册描述来自已校验的 manifest。收到 `server.sync` 时，客户端通过 `server.register` 的 `syncRequestId` 关联本次同步，不在注册落库前提前返回成功。
- TLS 使用系统信任路径并强制校验 Worker 主机名；发布包提供 `ca-certificates.crt` 时会同时加载随包根证书，Windows 还从系统 `ROOT` 证书库加载受信任根证书。不会关闭证书或主机名验证。
- `examples/sample_plugin.cpp`、`examples/lifecycle_plugin.cpp`、`examples/cancellable_plugin.cpp` 和对应 smoke 测试验证单一 ABI 动态库导出、基本生命周期、WebSocket 建立/关闭回调以及 SSE 协作式取消。`examples/crashing_plugin.cpp` 故意触发空指针崩溃，由 `plugin-manager-crash-smoke` 验证宿主隔离和失败标记。

非 MSVC 构建默认启用 `-Wall -Wextra`；`third_party/include` 以 SYSTEM 方式包含，第三方头文件的警告不会混入自家源码。

部署时 `plugmesh-server` 与 `plugmesh-plugin-host` 需要放在同一目录，或通过 `PLUGMESH_PLUGIN_HOST` 指定宿主路径。SSE 请求由 `ControlClient` 放入独立工作线程调度，插件宿主把 SSE 回调放入独立 job；`handle_sse_cancel` 可在该回调运行时并发调用。取消是协作式的：插件必须自行观察取消并尽快返回，宿主不会强杀插件内部的同步计算。HTTP、文件流等其他同步边界还没有因本次改动全面异步化。

启动配置可以由环境变量提供；当连接参数缺失且指定了凭据文件时，服务器会使用口令解密持久化凭据：

- `PLUGMESH_WORKER_URL`
- `PLUGMESH_SERVER_ID`
- `PLUGMESH_ACCESS_TOKEN`
- `PLUGMESH_PLUGIN_DIRECTORY`（可选；可执行程序留空时使用同目录的 `plugins`，共享库调用方仍须显式传入）
- `PLUGMESH_PLUGIN_HOST`（可选，`plugmesh-plugin-host` 路径；留空时查找与服务器可执行文件同目录的宿主）
- `PLUGMESH_CREDENTIAL_FILE`（Linux 等无系统凭据存储时使用的加密文件路径；留空时 Windows/macOS 优先使用系统凭据存储）
- `PLUGMESH_CREDENTIAL_PASSWORD`
- `PLUGMESH_LOCAL_PORT`（可选，默认从 `8787` 开始，仅绑定 `127.0.0.1`；占用时自动递增）
- `PLUGMESH_LOCAL_UI_DIRECTORY`（可选，指定 UI 解出目录；默认 Windows `%LOCALAPPDATA%/Plugmesh/native-ui/dist`、macOS `~/Library/Application Support/Plugmesh/native-ui/dist`、Linux/Termux `$XDG_DATA_HOME/plugmesh/native-ui/dist` 或 `~/.local/share/plugmesh/native-ui/dist`）
- `PLUGMESH_LOG_FILE`（可选；默认 Linux 写入 `$XDG_STATE_HOME/plugmesh` 或 `~/.local/state/plugmesh`，macOS 写入 `~/Library/Logs/Plugmesh`，Windows 写入 `%LOCALAPPDATA%/Plugmesh/logs`；单文件 1 MiB、保留 3 个轮转文件）

本地管理端点仅监听回环地址：

- `GET /api/health`、`GET /api/status`：服务和控制连接状态。
- `GET /api/plugins`：已发现插件的 manifest 与生命周期状态。
- `GET /api/diagnostics`：插件数量、加载状态和失败数量摘要。
- `GET /api/logs`：读取最近 200 条本地日志；重启后从 JSONL 日志恢复。Worker 通信只记录连接状态、帧类型和拒绝原因，不记录帧 payload、请求头或凭据。
- `GET /api/plugins/{pluginId}/health`：执行已启用插件的 ABI 健康检查。
- `POST /api/plugins/{pluginId}/{load|unload|enable|disable|reload}`：执行插件生命周期操作。
- `POST /api/register`：仅在连接配置缺失时可用，调用 Worker 注册并把长期凭据加密保存到本地。
- `POST /api/credentials/rotate`：通过当前控制连接轮换 Worker 访问令牌，并立即更新系统凭据或加密凭据文件。
- `POST /api/credentials/revoke`：撤销 Worker 侧服务器绑定、删除本地凭据并重新进入 setup mode。
- `GET /`、`GET /assets/*`：提供服务器二进制内嵌的 React 本地控制台；每次启动都会覆盖刷新 UI 解出目录，非资源路径回退到 `index.html`。

当 Worker 地址、服务器 ID 或访问令牌缺失时，`plugmesh-server` 不会直接退出，而是进入 setup mode，并自动打开 `http://127.0.0.1:<port>/` 等待本地控制台提交一次性注册码。注册成功后当前进程继续启动控制连接；注册接口在正常运行态关闭。已绑定状态可以在本地控制台轮换访问令牌或撤销绑定；撤销完成后当前进程清空内存配置并重新打开 setup mode。CLI `--register` 仍作为无浏览器环境的备用入口。

Windows 使用 Credential Manager、macOS 使用 Keychain 保存系统凭据。macOS 会先通过 `SecItemCopyMatching` 只读探测默认钥匙串；无钥匙串、锁定或无权访问时，首次绑定界面会要求填写凭据文件路径和口令，改用 OpenSSL AES-256-GCM 加密文件。当前 Linux 构建未检测到 Secret Service 开发依赖，因此直接使用同一套加密文件回退。文件回退的口令通过 PBKDF2-HMAC-SHA256 派生密钥，文件只保存加密 envelope，不保存明文 access token，POSIX 下权限收紧为用户可读写。

凭据存储回归测试：

```bash
native-server/build/plugmesh-credential-store-smoke
```

首次绑定可以使用 CLI fallback。管理端生成注册码后，在本地执行：

```bash
# 查看完整参数和环境变量说明
./plugmesh-server --help

PLUGMESH_CREDENTIAL_PASSWORD='本地口令' \
PLUGMESH_REGISTRATION_CODE='一次性注册码' \
./plugmesh-server --register https://console.example.com '工作站插件服务器' ~/.config/plugmesh/credentials.json
```

CLI 注册失败时默认会打印阶段和底层错误分类；排查 TLS 时可临时设置 `PLUGMESH_DEBUG_TLS=1` 获取 OpenSSL 诊断。该输出不包含注册码、访问令牌或凭据口令。`https://` 地址必须是 Worker 的实际 HTTPS 主机名，不能填管理控制台页面路径、带尾部 API 路径的 URL 或自签名证书地址。

如果 Linux 上访问 `workers.dev` 超时或握手被重置，而浏览器或其他平台正常，优先比较同一设备的 DNS 解析、代理/防火墙和 IPv4/IPv6 出口；可用 `curl -v https://<worker-host>/api/health` 检查网络路径。底层原因可能是网络重置而非证书链错误；使用该网络可达且已配置的 Worker HTTPS 主机名，并保留证书和主机名校验，不要关闭 TLS 验证。

注册成功后，服务器启动时设置 `PLUGMESH_CREDENTIAL_FILE` 和 `PLUGMESH_CREDENTIAL_PASSWORD`，即可从加密凭据文件恢复长期连接参数。插件放在服务器同目录的 `plugins` 时无需设置 `PLUGMESH_PLUGIN_DIRECTORY`；自定义目录时再显式设置。

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

`.github/workflows/build-plugin-server.yml` 只接受手动触发。选择 `executable` 时，artifact 名称形如 `plugmesh-plugin-server-linux-executable-Release`，包含 `plugmesh-server`、`plugmesh-plugin-host`、`plugin_api.h`、README、构建信息和归档校验和；UI 已编译进服务器二进制。选择 `shared` 时还包含 Linux 的 `libplugmesh-server.so`、macOS 的 `libplugmesh-server.dylib` 或 Windows 的 DLL/导入库，以及 `server_api.h`，共享库不提供本地 setup 流程。下载后在 artifact 根目录执行 `sha256sum -c SHA256SUMS`（macOS 使用 `shasum -a 256 -c SHA256SUMS`），确认归档未被替换后再解压。

Linux 产物在兼容 glibc 2.31 的基线中构建，随包提供以同一基线构建的 OpenSSL 3 和静态 C++ 运行时，不要把其他系统的 `libssl.so.3` 或 `libcrypto.so.3` 替换进包内；macOS 产物从源码构建时需要 `brew install openssl@3`；Windows 产物会随包复制构建所需的 vcpkg DLL。所有平台都需要把 `plugmesh-plugin-host` 与服务器放在同一目录，或设置 `PLUGMESH_PLUGIN_HOST`。可执行 artifact 的 UI 已嵌入 `plugmesh-server`，启动时总是覆盖刷新到对应的用户数据目录；源码构建须先生成 `native-ui/dist` 再配置 CMake，自定义解出目录可用 `PLUGMESH_LOCAL_UI_DIRECTORY` 指定。无浏览器环境可以直接使用上面的 `--register` CLI。

构建产物中的 `plugin_api.h` 是插件动态库 ABI，`server_api.h` 是共享库嵌入接口，二者用途不同。插件目录仍按一个插件一个子目录放置 `manifest.json` 和 `.so`/`.dylib`/`.dll`，服务器只会发现 manifest 中 `library` 位于该子目录内的插件。

正式 Release 压缩包不提供独立映射程序。TCP 隧道监听、配置和生命周期集成在 `plugmesh-server` 中；登录本地控制台后在“端口映射”管理目标服务器与监听。协议标签用于流量标注，所有映射均以原始 TCP 字节流经 Worker WebSocket 隧道双向转发。首次目标授权只通过 Worker 中继一次性挑战证明，不传输本地 UI 明文口令。操作说明见 `PORT-MAPPING.md`。

## 共享库嵌入

CMake 的 `plugmesh-server-shared` target 会生成真正的共享库：Linux 为 `libplugmesh-server.so`，macOS 为 `libplugmesh-server.dylib`，Windows 为 `plugmesh-server.dll`。公共头文件 `include/plugmesh/server_api.h` 只暴露 C ABI，避免把 C++ STL 类型跨越动态库边界。

共享库接收已经注册的 Worker 参数，不包含命令行注册和本地 UI setup 流程。调用方负责安全保存凭据，并在 `plugin_host_executable` 中提供 `plugmesh-plugin-host` 的路径；该路径为空时由现有 `PLUGMESH_PLUGIN_HOST` 规则解析。Linux 二进制包会在服务器和共享库旁边附带 `libssl.so.3`、`libcrypto.so.3`，无需再安装系统 OpenSSL 3；从源码运行时仍需安装 OpenSSL 3。`plugmesh_server_create` 会复制配置字符串，最小生命周期如下：

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

库文件和可执行文件都需要 OpenSSL 3 运行库；Linux 发布包会随包提供兼容基线构建的运行库。共享库还需要调用方链接本项目导出的 C ABI，并把插件宿主放在可执行文件旁或显式传入路径。手动构建入口会把共享库、插件宿主、公共头和构建说明一起打包。

## Android Termux CLI 构建

Android 首版使用 Termux 的命令行环境，不提供 APK，也不需要安装 Android App。Termux 自带的 clang、CMake、OpenSSL 和 zlib 负责构建与运行；不要使用 `scripts/build-linux-native.sh`，那个脚本针对 Debian/glibc x86_64 基线。

在 Termux 中安装依赖并从仓库根目录构建：

```bash
pkg update
pkg upgrade
pkg install clang cmake make openssl zlib tar coreutils nodejs
npm ci
npm run native-ui:build
bash scripts/build-termux-native.sh
```

默认 `ALL` 构建包含服务器可执行文件并要求先生成 `native-ui/dist`；仅构建共享库时可以省略 Node.js 和 UI：

```bash
bash scripts/build-termux-native.sh --artifact-type SHARED
```

脚本不修改 `/etc/apt`，不下载或编译 x86_64 OpenSSL，也不执行 glibc ABI 检查。它使用 `$PREFIX` 下的 Android/Termux 原生库，本地默认生成 `dist/plugmesh-server-termux.tar.gz` 和 `dist/plugmesh-server-termux.tar.gz.sha256`；正式 Release 名称会附加 tag，例如 `plugmesh-server-termux-v0.3.6.tar.gz` 及同名 `.sha256` sidecar。归档保留构建时 `ca-certificates.crt` 作为离线 fallback；launcher 优先使用显式 `PLUGMESH_CA_BUNDLE`，否则使用当前 Termux `$PREFIX/etc/tls/cert.pem`、备用 `$PREFIX/etc/tls/certs/ca-bundle.crt`，最后才回退包内 CA，因此更新 `ca-certificates` 后立即生效。遇到 `unable to get local issuer certificate` 时先运行 `pkg update && pkg upgrade ca-certificates`；私有 CA 应通过 `PLUGMESH_CA_BUNDLE=/path/to/ca.pem` 提供正确 PEM 根证书，不要关闭证书或主机名校验。普通构建归档携带匹配的 `libc++_shared.so`；`plugmesh-server` 与 `plugmesh-plugin-host` 是同目录启动器，会先把包目录放到 `LD_LIBRARY_PATH` 最前面，再启动旁边的 `.bin` ELF。全静态构建则把 libc++、libc++abi、libunwind、OpenSSL 静态归入 ELF，不依赖设备的 `libc++_shared.so`，因此旧设备上的全局 libc++ 不会抢先加载。不会复制 Debian Linux 包中的 `.so` 或 glibc 运行库。校验并解压后直接通过命令行启动：

```bash
(cd dist && sha256sum -c plugmesh-server-termux.tar.gz.sha256)
tar -xzf dist/plugmesh-server-termux.tar.gz
cd plugmesh-server-termux
./plugmesh-server
```

Termux 包内的 `plugmesh-server`、`plugmesh-server.bin`、`plugmesh-plugin-host`、`plugmesh-plugin-host.bin`、`libc++_shared.so` 和 `plugins/` 必须保持相对位置；运行时继续使用 Termux 的 OpenSSL/zlib，不应把 Debian Linux 包中的 `.so` 或 glibc 运行库复制进来。端口映射、SSH/大文件流和本地 UI 的行为与其它原生构建一致。


## 开机自启常驻服务

服务器本身保持前台进程模型；服务管理器负责开机启动、异常重启和日志生命周期。先完成一次绑定并确认凭据文件/系统凭据可被目标用户读取，再安装服务。不要把注册码、访问令牌或凭据口令写入服务脚本。

- Linux：`bash ./plugmesh-service.sh install --executable "$PWD/plugmesh-server"` 安装并启动用户级 `systemd` unit，开机登录后启动、异常退出后重启；`start`、`stop`、`status`、`uninstall` 管理生命周期。
- macOS：同一脚本安装 `~/Library/LaunchAgents/com.shelter-red.plugmesh-server.plist`，登录时启动并由 `launchd` 保持运行；支持相同的生命周期命令。
- Termux：安装 `termux-services` 后脚本注册 runit 服务，使用 `sv up/down/status` 管理；未安装时注册 `~/.termux/boot/plugmesh-server`，需安装 Termux:Boot，脚本仍提供 `start`、`stop`、`status` PID 控制。
- Windows 7 及更高版本：在 PowerShell 执行 `.\install-plugmesh-service.ps1 -Action install -Executable C:\Plugmesh\plugmesh-server.exe`，通过当前用户登录触发器启动 Task Scheduler 任务；非零退出后每分钟重启，最多 999 次。该方式需要用户登录，不是登录前运行的系统服务；`uninstall` 删除任务。Windows 脚本不接受 `-EnvironmentFile`，请配置当前用户或系统环境变量。

Linux、macOS 和 Termux 的 `--env-file` 接受 `KEY=VALUE` 行，空行和 `#` 注释会忽略；环境文件应限制为服务用户可读（例如 `chmod 600`）。服务安装不会注册服务器，也不会绕过 TLS 校验；使用已注册凭据启动，首次绑定仍通过 CLI 完成。

### MSVC

需要 Visual Studio 2019 或更高版本、CMake 3.16 以上，以及 64 位 OpenSSL 3（推荐 `vcpkg install openssl:x64-windows`）：

```bash
cmake -S native-server -B build-win -G "Visual Studio 17 2022" -A x64 \
  -DCMAKE_TOOLCHAIN_FILE=%VCPKG_ROOT%/scripts/buildsystems/vcpkg.cmake
cmake --build build-win --config Release
```

### Windows 7 兼容性

原生 Windows 目标将 Win32 API 最低版本固定为 Windows 7（`_WIN32_WINNT=0x0601`、`WINVER=0x0601`）。Release 提供独立的 `plugmesh-server-windows7-v<version>.zip`，使用 MinGW-w64 和静态 Win7 OpenSSL；普通 `plugmesh-server-windows-v<version>.zip` 仍面向现代 Windows，不宣称兼容 Windows 7。


没有 Windows 主机时，可用 MinGW-w64 在 Linux 上交叉编译，检查 Windows 分支能否编译和链接：

```bash
# 1. 安装 posix 线程模型工具链（websocketpp 在该模型下使用 std::thread）
sudo apt-get install g++-mingw-w64-x86-64-posix

# 2. 交叉编译静态 OpenSSL（示例版本 3.0.20）；前缀用任意可写目录即可，无需 root
curl -LO https://deb.debian.org/debian/pool/main/o/openssl/openssl_3.0.20.orig.tar.gz
tar xzf openssl_3.0.20.orig.tar.gz && cd openssl-3.0.20
./Configure mingw64 no-shared no-tests no-asm --cross-compile-prefix=x86_64-w64-mingw32- --prefix=/tmp/mingw-openssl --libdir=lib
make -j"$(nproc)" && make install_sw
cd ..

# 3. 构建并打包 Windows 7 版本（包含静态 OpenSSL 许可证）
npm ci && npm run native-ui:build
OPENSSL_ROOT_DIR=/tmp/mingw-openssl \
OPENSSL_SOURCE_DIR="$PWD/openssl-3.0.20" \
bash scripts/build-windows7-native.sh
```

Release workflow 会用 OpenSSL 3.0.20 源码构建静态 MinGW 库并生成 `plugmesh-server-windows7-v<version>.zip`。本地构建时，项目根目录的 `scripts/build-windows7-native.sh` 也会打包同一格式；必须设置 `OPENSSL_ROOT_DIR`（含 `lib/libssl.a` 与 `lib/libcrypto.a`）和 `OPENSSL_SOURCE_DIR`（含上游 `LICENSE.txt`，打包后命名为 `LICENSE.openssl.txt`）。普通 MSVC/vcpkg ZIP 仍不是 Win7 包；不要通过复制新的 `kernel32.dll` 修复系统。

Win7 ZIP 包含 `plugmesh-server.exe`、`plugmesh-plugin-host.exe`、嵌入式本地 UI、示例插件 `libplugmesh-sample.dll`、`LICENSE.openssl.txt`、服务安装脚本和文档。`CMAKE_BUILD_TYPE` 必须是 `Release`：未优化时 websocketpp/Asio 模板实例化会超过 MinGW COFF 单节大小上限。

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
