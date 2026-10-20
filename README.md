# Plugmesh 插件聚合管理平台

这是 Cloudflare 插件聚合管理平台的 MVP 基础仓库，当前包含管理端界面、Worker 路由骨架、D1 初始模型、Durable Object 桥接边界，以及跨平台 C++ 插件服务器基础层。

## 已完成

- 管理端 React + TypeScript 界面：总览、服务器、插件、域名、用量、审计和系统设置。
- 暗色、浅色、跟随系统三种主题，主题选择持久化到浏览器本地存储。
- 服务器绑定、插件加载、域名分配等核心操作的表单和反馈状态。
- Worker API 基础路由：健康检查、总览、服务器、插件和域名查询。
- 控制 WebSocket 接入边界和 Durable Object 插件桥接对象。
- D1 表结构：用户、服务器、插件实例、域名和审计日志。
- 控制 token 使用 SHA-256 摘要后与 D1 字段比对。
- C++20 跨平台基础：Linux `.so` / Windows `.dll` 动态库加载、ABI 版本检查和配置校验。

## 本地运行

```bash
npm install
npm run dev
```

管理端地址：`http://localhost:4173/`

验证命令：

```bash
npm run build
npm run worker:typecheck
cmake -S native-server -B native-server/build
cmake --build native-server/build --parallel 2
```

Worker 本地调试前需要把 `worker/wrangler.toml` 中的 D1、R2 和 Durable Object 配置替换为实际资源：

```bash
npm run worker:dev
```

## 当前边界

当前提交建立了可编译的 MVP 基础，但还没有把生产凭据放入仓库，也没有伪装成已完成以下能力：GitHub OAuth、Cloudflare OAuth、SMTP 发信、本地服务器 Web UI、完整 HTTP/WebSocket/SSE 流式桥接、R2 一次性对象和 Cloudflare Analytics 查询。这些功能应在现有协议、D1 模型和 ABI 边界上继续实现。

## 目录

- `src/`：管理端 SPA。
- `worker/`：Cloudflare Worker、Durable Object、D1 migration 和协议定义。
- `native-server/`：跨平台 C++ 服务器基础层和插件 C ABI。
