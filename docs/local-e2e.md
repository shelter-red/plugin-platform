# 本地真实栈端到端验收

本流程用真实 `wrangler dev`（miniflare/workerd）、真实 D1/R2 模拟、真实 C++ `plugmesh-server` 和示例插件验证公开入口。它补充 smoke 与 workerd 运行时测试，不替代已部署 Cloudflare 环境。

## 前提

- Linux、Docker 可用。
- 本机 glibc 2.31 无法直接运行 workerd，`wrangler` 统一在 `node:22-bookworm-slim` 容器内执行并挂载 `/etc/ssl/certs`。
- 已构建 `native-server/build/plugmesh-server`、`native-server/build/plugins` 和 `native-ui/dist`。

## 启动 Worker

```bash
docker run -d --name plugmesh-e2e \
  --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -p 127.0.0.1:18888:18888 \
  -v "$PWD":/app \
  -v /tmp/plugmesh-e2e-data:/data \
  -v /etc/ssl/certs:/etc/ssl/certs:ro \
  -w /app node:22-bookworm-slim \
  sh -c "npx wrangler d1 migrations apply plugmesh --config worker/wrangler.toml --local --persist-to /data && \
         npx wrangler dev --config worker/wrangler.toml --ip 0.0.0.0 --port 18888 --persist-to /data"
```

- `--user "$(id -u):$(id -g)" -e HOME=/tmp`：容器进程与宿主使用同一 UID，且把 `HOME` 指向可写的 `/tmp`；否则 `wrangler` 写 `worker/.wrangler/tmp` 会因权限不足报 `EACCES`。
- `/etc/ssl/certs` 只读挂载：workerd 拉取远端资源时需要容器内可用的 CA 证书，缺少时会报证书校验失败。
- `/tmp/plugmesh-e2e-data` 是本地 D1/R2 的持久目录，可换成其它路径；换目录后需重新执行迁移和下文的管理端 seed。

migrations 只需执行一次，之后重启容器可去掉前半段。`wrangler dev` 默认端口 8787 可能被占用，因此显式使用 18888。

容器重启后继续使用同一数据目录：

```bash
docker start plugmesh-e2e
```

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

## 管理端控制台真实数据（可选）

管理端页面可以用同一套 Worker + D1 验证真实数据读取和表单提交。先按上一节写入超级管理员会话，并补充一条离线服务器、插件和域名记录：

```sql
INSERT OR REPLACE INTO servers (id, user_id, name, token_hash, status, last_seen_at, created_at)
VALUES ('srv-real', 'u-e2e', '真实栈服务器', 'deadbeef', 'offline', '2026-10-21T12:00:00Z', '2026-10-01T00:00:00Z');

INSERT OR REPLACE INTO plugin_instances (id, user_id, server_id, plugin_id, name, version, state, desired_state, manifest_json, created_at, updated_at)
VALUES ('plg-real', 'u-e2e', 'srv-real', 'real.plugin', '真实栈插件', '1.0.0', 'disabled', 'disabled',
  '{"id":"real.plugin","name":"真实栈插件","version":"1.0.0","abiVersion":"3","library":"libreal.so","capabilities":{"http":true,"websocket":false,"sse":false,"fileStream":false},"permissions":[],"healthPath":"/health"}',
  '2026-10-01T00:00:00Z', '2026-10-21T00:00:00Z');

INSERT OR REPLACE INTO domains (id, user_id, plugin_instance_id, hostname, status, created_at)
VALUES ('dom-real', 'u-e2e', 'plg-real', 'real.plugins.example.com', 'offline', '2026-10-01T00:00:00Z');
```

`dist` 必须使用默认配置构建（不要设置 `VITE_AUTH_ENABLED=false`），否则管理端不会请求 `/api/me`，超级管理员入口和邀请面板不会出现。

```bash
npm run build
PLUGMESH_REAL_STACK_URL=http://127.0.0.1:18888 npm run ui:real-stack
```

该 Playwright 项目会携带 `plugmesh_session` Cookie 直接打开 Worker 提供的控制台，断言：

- 插件服务器、插件实例和公开域名页面显示上面写入的真实记录；
- 在系统设置中创建 GitHub 邀请后返回邀请链接，并在列表中读到该记录；
- 非法 GitHub 用户名提交后显示服务端校验错误；
- 打开“绑定插件服务器”弹窗后从 `/api/registration-codes` 取得一次性注册码；
- 第三条用例用一次性注册码启动真实 `plugmesh-server`，在管理端加载并启用 `sample.plugin`、分配以 `console-` 开头的唯一域名，再从该域名请求插件得到 `200` 和 `ok`。

第三条用例要求已构建 `native-server/build/plugmesh-server`、`native-server/build/plugins` 与 `native-ui/dist`。它自行完成注册、启动和退出清理：每次运行生成新的服务器名与域名前缀，结束后向子进程发送 `SIGTERM` 并删除临时凭据目录，因此可以在同一份 D1 上重复执行（历史服务器与域名记录会累积，不影响断言）。

期望结果：`3 passed`。它验证的是管理端到真实 Worker/D1 与真实 C++ 服务器的链路，不依赖已部署 Cloudflare。

## 注册并启动本地服务器

1. 通过 `POST /api/registration-codes` 获取一次性注册码。
2. 用 CLI 绑定，凭据写入加密文件：

```bash
PLUGMESH_CREDENTIAL_PASSWORD='本地口令' \
PLUGMESH_REGISTRATION_CODE='一次性注册码' \
native-server/build/plugmesh-server --register http://127.0.0.1:18888 'E2E Server' /tmp/plugmesh-e2e-creds.json
```

也可以完全交互式执行（无参数，逐项提示，适合无浏览器环境）：

```bash
native-server/build/plugmesh-server --register
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

对应管理 API 命令示例（`<plugin-id>` 为 `/api/plugins` 返回的实例 id）：

```bash
curl -s -X POST -H 'Cookie: plugmesh_session=e2e-session-token' http://127.0.0.1:18888/api/registration-codes
curl -s -H 'Cookie: plugmesh_session=e2e-session-token' http://127.0.0.1:18888/api/plugins
curl -s -X POST -H 'Cookie: plugmesh_session=e2e-session-token' http://127.0.0.1:18888/api/plugins/<plugin-id>/load
curl -s -X POST -H 'Cookie: plugmesh_session=e2e-session-token' http://127.0.0.1:18888/api/plugins/<plugin-id>/enable
curl -s -X POST -H 'Cookie: plugmesh_session=e2e-session-token' -H 'content-type: application/json' \
  -d '{"pluginInstanceId":"<plugin-id>","prefix":"e2e"}' http://127.0.0.1:18888/api/domains
```

`load` 返回 `{"state":"loaded","accepted":true}`，`enable` 返回 `{"state":"enabled","accepted":true}`，域名分配在通过健康检查后返回 `{"hostname":"e2e.plugins.example.com","status":"online"}`。

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

## 并发与长连接压力验证

`npm run stack:load` 用 `tests/load-stack.spec.ts` 在同一个真实栈（`wrangler dev` + 真实 `plugmesh-server` + `sample.plugin`）上跑并发场景：自动生成注册码、启动服务器、加载并启用插件、分配唯一域名，然后依次施加 HTTP 并发、SSE 并发和 WebSocket 驻留压力，并在结束后断言 `activeConnections` 归零。

```bash
PLUGMESH_REAL_STACK_URL=http://127.0.0.1:18888 \
PLUGMESH_REAL_STACK_TOKEN=e2e-session-token \
npm run stack:load
```

可通过环境变量调整强度：`PLUGMESH_LOAD_HTTP_REQUESTS`（默认 300）、`PLUGMESH_LOAD_HTTP_CONCURRENCY`（默认 100）、`PLUGMESH_LOAD_ROUNDS`（默认 3）、`PLUGMESH_LOAD_STREAMS`（默认 40）、`PLUGMESH_LOAD_WEBSOCKETS`（默认 40）。WebSocket 数量必须低于平台 `activeConnections` 配额（默认 100），否则会按设计触发维护模式。

2026-10-21 在本机 `wrangler dev`（miniflare/workerd 单 isolate）+ 真实 `plugmesh-server` 上的实测结果：

```text
HTTP 3 轮 × 300 请求 / 并发 100：1.6s / 1.5s / 1.6s，900 次全部 200 "ok"
HTTP 延迟：p50 479 ms，p95 666 ms，max 729 ms（含 miniflare 单线程排队）
SSE：40 条并发流全部收到首帧
WebSocket：40 条连接同时驻留并逐条回显，关闭后 activeConnections 归零
```

`sample.plugin` 的 SSE 处理器写完一帧就结束，无法让连接驻留，因此 SSE 只验证并发建立与首帧到达；连接驻留上限由 WebSocket 场景覆盖。这仍是单机 miniflare，不代表已部署 Cloudflare 的多 isolate、跨地域调度或真实网络抖动。

## 配额耗尽与维护模式验证

`npm run stack:maintenance` 用 `tests/maintenance-stack.spec.ts` 在同一真实栈上验证「总配额耗尽 → 全局维护模式」：

```bash
PLUGMESH_REAL_STACK_URL=http://127.0.0.1:18888 \
PLUGMESH_REAL_STACK_TOKEN=e2e-session-token \
npm run stack:maintenance
```

用例先用一次性注册码拉起真实 `plugmesh-server`、加载并启用 `sample.plugin`、分配域名并确认公开入口返回 200，再建立一条常驻 WebSocket；随后通过 `PUT /api/settings/platform` 把 `quotas.requests` 压到 1（当前窗口计数已远超 1），并断言：

- 下一次公开请求返回 503 维护页，`content-type: text/html`、`retry-after: 300`，正文含「平台维护中」；
- 新的公开 WebSocket 升级被拒绝为 503，已建立的长连接仍能回显（维护模式只拦新流量）；
- 维护中 `POST /api/registration-codes`、插件命令、`POST /api/domains` 均返回 503；
- `audit_log` 留下 `maintenance.email.skipped`，`reason` 为 `request quota reached`（本机未配置 `SESSION_SECRET`，因此标注为未发送而非静默跳过）；
- 解除维护（`maintenance: false` + 恢复原配额）后公开入口恢复 200、可重新建连，关闭连接后 `activeConnections` 归零。

2026-10-21 实测：`1 passed`。边界：单机 miniflare 单 isolate，未验证多 isolate 下的维护状态传播和已部署环境的配额阈值。

## Worker 重启恢复验证

路由缓存是 isolate 内存，Worker 重启后必须回源 D1 重建。用例先预热缓存，再重启承载 `wrangler dev` 的容器，确认新 isolate 在没有任何内存路由时仍能把公开请求转发给自动重连的真实服务器：

```bash
PLUGMESH_REAL_STACK_URL=http://127.0.0.1:18888 \
PLUGMESH_REAL_STACK_TOKEN=e2e-session-token \
PLUGMESH_E2E_CONTAINER=plugmesh-e2e \
npm run stack:restart
```

用例断言：重启前公开入口返回 200；`docker restart` 后 `/api/health` 恢复 200；公开入口重新返回 200 且正文含 `ok`（此时新 isolate 缓存必然为空，只能由 D1 回源）；服务器记录回到 `online`（真实 `plugmesh-server` 自动重连）。2026-10-21 实测 `1 passed`。

边界：单容器单 isolate，只验证本 isolate 的冷回源；跨 isolate 的缓存独立性见下一节。

## 多 isolate 路由缓存验证

路由缓存是每个 isolate 自己的内存 Map，按设计不跨 isolate 共享，靠 5 秒 TTL 回源 D1 收敛。用两个 `wrangler dev` 进程共享同一 D1 持久目录即可模拟两个 isolate（宿主机持久目录以首个实例的 `--persist-to` 为准，下例为 `/tmp/plugmesh-load-data2`）：

```bash
docker run -d --name plugmesh-e2e-b \
  --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -p 127.0.0.1:18889:18889 \
  -v "$PWD":/app \
  -v /tmp/plugmesh-load-data2:/data \
  -v /etc/ssl/certs:/etc/ssl/certs:ro \
  -w /app node:22-bookworm-slim \
  sh -c "npx wrangler dev --config worker/wrangler.toml --ip 0.0.0.0 --port 18889 --persist-to /data"
```

两个进程各自持有独立 workerd isolate，但读写同一份 D1 SQLite 文件。本地 D1 文件路径：

```bash
find /tmp/plugmesh-load-data2/v3/d1 -name '*.sqlite' ! -name 'metadata.sqlite'
```

运行用例：

```bash
PLUGMESH_MULTI_ISOLATE_A_URL=http://127.0.0.1:18888 \
PLUGMESH_MULTI_ISOLATE_B_URL=http://127.0.0.1:18889 \
PLUGMESH_D1_SQLITE=/tmp/plugmesh-load-data2/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite \
npm run stack:multi-isolate
```

用例用 Node 标准库 `node:sqlite` 直接写 D1，绕开任一 isolate 的失效逻辑：

- A 先请求未知域名得到 404，建立 5 秒负缓存；
- 写入 `domains` 行后，A 立即再次请求仍是 404，说明缓存没有跨 isolate 失效；
- B 首次请求该域名，只能回源 D1，立即得到 503（种子服务器离线）；
- 6 秒后 A 的 TTL 到期，回源 D1 收敛为与 B 相同的 503。

2026-10-21 实测 `1 passed`。边界：两个实例在同一台机器，只模拟 isolate 之间不共享缓存；真实 Cloudflare 多地域传播与 D1 跨地域读一致性仍未验证。

## 清理

```bash
docker rm -f plugmesh-e2e
pkill -f 'build/plugmesh[-]server'
```

`/tmp/plugmesh-e2e-data` 与 `/tmp/plugmesh-e2e-creds.json` 仅用于本地验收，不进入仓库。

## 边界

- 当前为本地 miniflare/workerd 与本地 D1/R2 模拟，不是已部署 Cloudflare；未验证真实 DNS、证书、Worker routes 和公网长连接。
- 未连接真实 GitHub OAuth、Cloudflare OAuth 和 SMTP。
- 本地服务器的轮换、撤销和同进程重新绑定已在本地真实栈上用本地控制台联调通过；`worker:runtime-test` 与 Native UI smoke 仍覆盖对应逻辑边界。
- Windows 的构建、DLL 和 Credential Manager 只在 Wine 下验证过，真实 Windows 主机仍未验证。
