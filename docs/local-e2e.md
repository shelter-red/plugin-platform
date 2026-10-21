# 本地真实栈端到端验收

本流程用真实 `wrangler dev`（miniflare/workerd）、真实 D1/R2 模拟、真实 C++ `plugmesh-server` 和示例插件验证公开入口。它补充 smoke 与 workerd 运行时测试，不替代已部署 Cloudflare 环境。

## 前提

- Linux、Docker 可用。
- 本机 glibc 2.31 无法直接运行 workerd，`wrangler` 统一在 `node:22-bookworm-slim` 容器内执行并挂载 `/etc/ssl/certs`。
- 已构建 `native-server/build/plugmesh-server`、`native-server/build/plugins` 和 `native-ui/dist`。

## 启动 Worker

```bash
docker run -d --name plugmesh-e2e \
  -p 127.0.0.1:18888:18888 \
  -v "$PWD":/app \
  -v /tmp/plugmesh-e2e-data:/data \
  -v /etc/ssl/certs:/etc/ssl/certs:ro \
  -w /app node:22-bookworm-slim \
  sh -c "npx wrangler d1 migrations apply plugmesh --config worker/wrangler.toml --local --persist-to /data && \
         npx wrangler dev --config worker/wrangler.toml --ip 0.0.0.0 --port 18888 --persist-to /data"
```

migrations 只需执行一次，之后重启容器可去掉前半段。`wrangler dev` 默认端口 8787 可能被占用，因此显式使用 18888。

## 准备管理端会话（仅本地验收）

不启动 GitHub OAuth，直接向本地 D1 写入超级管理员和会话。`token_hash` 为会话令牌的 SHA-256：

```bash
printf 'e2e-session-token' | sha256sum
```

```sql
INSERT OR REPLACE INTO users (id, github_id, email, display_name, role, created_at)
VALUES ('u-e2e', 'gh-e2e', 'e2e@example.com', 'E2E Admin', 'super_admin', '2026-10-21T00:00:00Z');

INSERT OR REPLACE INTO sessions (id, user_id, token_hash, expires_at, created_at)
VALUES ('s-e2e', 'u-e2e',
        'd2581881b2376f14d09f94382ea7bf9c5aee067009e0519f4db8cf525c75710b',
        '2027-10-21T00:00:00Z', '2026-10-21T00:00:00Z');
```

之后管理端请求携带 `Cookie: plugmesh_session=e2e-session-token`。

## 注册并启动本地服务器

1. 通过 `POST /api/registration-codes` 获取一次性注册码。
2. 用 CLI 绑定，凭据写入加密文件：

```bash
PLUGMESH_CREDENTIAL_PASSWORD='本地口令' \
PLUGMESH_REGISTRATION_CODE='一次性注册码' \
native-server/build/plugmesh-server --register http://127.0.0.1:18888 'E2E Server' /tmp/plugmesh-e2e-creds.json
```

3. 启动服务器并连接 Worker：

```bash
PLUGMESH_CREDENTIAL_FILE=/tmp/plugmesh-e2e-creds.json \
PLUGMESH_CREDENTIAL_PASSWORD='本地口令' \
PLUGMESH_PLUGIN_DIRECTORY="$PWD/native-server/build/plugins" \
PLUGMESH_LOCAL_PORT=18787 \
PLUGMESH_LOCAL_UI_DIRECTORY="$PWD/native-ui/dist" \
./native-server/build/plugmesh-server
```

4. 通过管理 API 加载并启用 `sample.plugin`，再分配域名（示例为 `e2e.plugins.example.com`）。分配域名会先执行健康检查。

## 验收用例

以下命令中的 `e2e.plugins.example.com` 需替换为实际分配的域名。

| 用例 | 命令 | 期望 |
| --- | --- | --- |
| 插件根路径与 query | `curl -H 'Host: e2e.plugins.example.com' http://127.0.0.1:18888/hello?x=1` | 插件响应，状态 200 |
| POST 转发 | `curl -X POST -d ping -H 'Host: ...' http://127.0.0.1:18888/echo` | 插件响应，状态 200 |
| SSE | `curl -N -H 'Host: ...' -H 'accept: text/event-stream' http://127.0.0.1:18888/events` | `data: sample-plugin` |
| WebSocket 回显 | 见下方脚本 | 收到与服务端发送一致的文本帧 |
| 文件流 | `curl -H 'Host: ...' -H 'x-plugmesh-file-stream: true' http://127.0.0.1:18888/file` | `sample-file-stream`，`content-type: application/octet-stream` |
| 未知插件域名 | `curl -H 'Host: unknown.plugins.example.com' http://127.0.0.1:18888/` | 404 `Plugin domain not found` |
| 控制台静态资源 | `curl -H 'Host: console.example.com' http://127.0.0.1:18888/` | 控制台 HTML，`/assets/*.js` 返回 JavaScript |
| 服务器离线 | 停止 `plugmesh-server` 后请求插件域名 | 503 `插件暂时不可用`，服务器转 `offline` |
| 重启恢复 | 重新启动 `plugmesh-server` 后再请求插件域名 | 200；插件恢复 `enabled`，域名恢复 `online` |
| 用量与日志 | `GET /api/usage/local`、`GET /api/access-logs` | WebSocket 关闭后 `activeConnections` 为 0，文件流结束后 `r2Objects`/`r2Bytes` 为 0，访问日志包含上述请求 |

WebSocket 需要自定义 `Host` 头。仓库依赖树中已包含 `ws`，在仓库根目录可直接复用（Node 内置 `WebSocket` 不支持覆盖 `Host`）：

```js
const WebSocket = require('./node_modules/ws')
const socket = new WebSocket('ws://127.0.0.1:18888/echo', { headers: { Host: 'e2e.plugins.example.com' } })
socket.on('open', () => socket.send('hello-ws'))
socket.on('message', (data) => { console.log(data.toString()); socket.close() })
```

## 密钥轮换、撤销与重新绑定

本地控制台通过 `POST /api/credentials/*` 操作，需要先登录本地 UI 取得会话 Cookie：

```bash
curl -s -c /tmp/plugmesh-local-cookies -X POST -H 'content-type: application/json' \
  -d '{"password":"本地 UI 口令"}' http://127.0.0.1:18787/api/session

# 轮换访问密钥
curl -s -b /tmp/plugmesh-local-cookies -X POST -H 'content-type: application/json' \
  -d '{"credentialPassword":"凭据文件口令"}' http://127.0.0.1:18787/api/credentials/rotate

# 撤销绑定
curl -s -b /tmp/plugmesh-local-cookies -X POST -H 'content-type: application/json' \
  -d '{"credentialPassword":"凭据文件口令"}' http://127.0.0.1:18787/api/credentials/revoke
```

撤销后服务器进入本地设置模式，可继续用同一个进程重新绑定（注册码需重新生成）：

```bash
curl -s -X POST -H 'content-type: application/json' \
  -d '{"workerUrl":"http://127.0.0.1:18888","serverName":"E2E Server","registrationCode":"新注册码","localUiPassword":"新的本地 UI 口令","localUiPasswordConfirmation":"新的本地 UI 口令","credentialPassword":"凭据文件口令","credentialFile":"/tmp/plugmesh-e2e-creds.json"}' \
  http://127.0.0.1:18787/api/register
```

| 用例 | 期望 |
| --- | --- |
| 轮换密钥 | 返回 `{"ok":true,"storage":"file"}`；凭据文件内容变化，D1 `servers.token_hash` 同步变化，`/api/status` 保持 `connected`；重启 `plugmesh-server` 后自动重连 |
| 撤销绑定 | 返回 `{"ok":true,"rebindRequired":true}`；凭据文件被删除，`/api/session` 返回 `configured=false`；服务器转 `revoked`，插件转 `server_offline`，域名转 `offline`，公开入口返回 503 |
| 重新绑定 | 返回新 `serverId`；无需重启进程，本地 UI 恢复 `configured=true`，`/api/status` 返回 `connected=true`，管理端显示新服务器 `online` |

2026-10-21 在本地 `wrangler dev` + 真实 `plugmesh-server` 上按上述步骤执行通过。联调中发现：重新绑定成功后，本地设置服务器被主动关闭，`run()` 返回 `false` 被误判为启动失败，进程以退出码 2 结束。现改为只要注册完成即视为成功，并留出响应写回时间；退出码与重新绑定结果已在修复后复验。

## 清理

```bash
docker rm -f plugmesh-e2e
pkill -f 'build/plugmesh[-]server'
```

`/tmp/plugmesh-e2e-data` 与 `/tmp/plugmesh-e2e-creds.json` 仅用于本地验收，不进入仓库。

## 边界

- 当前为本地 miniflare/workerd 与本地 D1/R2 模拟，不是已部署 Cloudflare；未验证真实 DNS、证书、Worker routes 和公网长连接。
- 未连接真实 GitHub OAuth、Cloudflare OAuth 和 SMTP。
- 本地服务器的轮换与撤销仍以 CTest、`worker:runtime-test` 和 Native UI smoke 覆盖，尚未在真实栈上用本地控制台执行完整轮换流程。
- Windows 的构建、DLL 和 Credential Manager 未验证。
