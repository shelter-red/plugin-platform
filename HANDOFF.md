# Plugmesh 平台交接（HANDOFF）

> 最后更新：2026-10-23（Asia/Shanghai）
> 状态：**进行中，未完成**
> 维护规则：每完成一个可验证步骤，先更新本文件，再提交一条可追溯的中文 Git 记录；未记录不得继续下一步。
> 本文件是后续上下文的优先事实来源。若 README、验收矩阵、旧注释或聊天摘要与本文冲突，以用户最新要求和实际代码为准；旧文档需在实现完成后同步重写，不能把旧 OAuth 行为当成目标。

## 一页恢复卡（压缩后先看这里）

- 仓库固定为 `/home/tc/work/plugin-platform`，分支固定为 `main`；不要从聊天猜仓库、分支或远端。
- 已完成基线提交 `2a32bfe docs: 固化会话问题总账与压缩恢复快照`，本地与 `origin/main` 一致；平台验收 run `39828876658`（#43）为 `completed/success`。
- 当前有 **10 个未提交代码文件 + 本 HANDOFF**，分两组，禁止混在一起提交，也禁止 `git add .`：
  - **5 个 UI/额度草稿**（保留 8 项额度与“平台请求不限”意图，但仍是旧 OAuth/`cloudflareQuotas` 假设）：
    ```text
    M src/features/overview/UsageResourcesPanel.tsx
    M src/features/usage/PlatformUsageSection.tsx
    M src/locales/en.ts
    M src/locales/zh-CN.ts
    M tests/console-worker.spec.ts
    ```
  - **5 个 Cloudflare Token 设置 API 改动**（设置接口已实现，但用量接口尚未迁移）：
    ```text
    M worker/src/index.ts
    M worker/src/cloudflare-token.ts
    M worker/runtime/cloudflare-settings.test.ts
    M worker/runtime/outbound-stub.ts
    M worker/runtime/analytics.test.ts
    ```
- **严禁** `git reset --hard`、`git clean`、`git checkout -- .`、`git add .` 或任何批量覆盖工作区命令。提交 HANDOFF 时只显式添加 `HANDOFF.md`。
- Cloudflare Token 设置 API 已完成但**尚未提交/推送**：`GET/PUT/DELETE /api/settings/cloudflare` 已切到长期 API Token；PUT 顺序为 verify → accounts 全分页 → 账号唯一性/指定账号校验 → subscriptions → 加密保存，GET 不回显 Token，DELETE 不调用 Cloudflare。settings + token 定向 runtime 测试 **14/14 通过**，`npm run worker:typecheck` 通过。
- **当前阻塞不是设置接口，而是用量接口**：`cloudflareUsageApi` 仍按旧 OAuth 密文读取 `accessToken`，无法读取新 `{kind:'api_token', apiToken, ...}` 密文；定向 `analytics.test.ts` 仅 1/5 通过，完整 runtime 为 **85 passed / 4 failed**（20/21 测试文件通过），4 个失败全部在 `analytics.test.ts` 并返回 500。旧 `worker:cloudflare-oauth-smoke` 也因仍 PUT `{accessToken}` 而 `400 !== 200`。
- 因此现在**不能推送这 5 个 Cloudflare 设置代码文件**。下一步先把 `cloudflareUsageApi` 改为先凭据后缓存、未配置立即短路，并删除旧 OAuth refresh/revoke/授权路由；再重写 smoke，之后才允许本地 CI 和推送。
- 用户反馈已完整归入下方 U01–U23 总账；若后续摘要只记得一句话，就记住：**Cloudflare 用长期 API Token、权限固定只读、免费额度从 subscriptions 读取、错误用 HTTP 留在设置页、平台统计不限、推送后必须盯 Actions 到成功。**

## 压缩恢复速查

恢复工作先执行：

```bash
cd /home/tc/work/plugin-platform
git status --short
git log -1 --oneline --decorate
git rev-parse HEAD origin/main
git diff
```

当前权威快照（2026-10-23）：

- 仓库：`/home/tc/work/plugin-platform`
- 分支：`main`
- 当前实际 HEAD：执行 `git log -1 --oneline`；本文档自身的提交会自然晚于“最近已验收提交”，不要照抄旧值。
- 最近已验收提交：`2a32bfe docs: 固化会话问题总账与压缩恢复快照`，平台验收 run `39828876658`（#43）为 `completed/success`。
- 最近已验收功能提交：`a0539fb feat(cloudflare): 增加 API Token 校验与凭据基础模块`，run `39827872017`（#42）成功。
- 本次 HANDOFF 整理提交会晚于上述提交；恢复时以 `git log -1 --oneline` 和 `git rev-parse HEAD origin/main` 为准。push 使用 `git@github-plugin-platform:shelter-red/plugin-platform.git`，fetch 使用 `https://github.com/shelter-red/plugin-platform.git`。
- 最近文档与功能成功链：`c32a587` 的 run `39826901281`（#41）、`e3cdb05` 的 run `39826112664`（#40）均为 `completed/success`。
- `0a5075d` 的 run `39824622514`（#38）、`0325530` 的 run `39823921091`（#37）、`70f62e3` 的 run `39822695994`（#35）、`abf05ca` 的 run `39820685855`（#34）均成功。`0325530` 同 SHA 的并发 run `39823919519`（#36）被取消，属于重复触发，不是失败。
- 已知失败反例（不能重复）：`fd80fa4` 的 run `39754896119`（#11）失败，web 的“管理端 UI smoke”失败；`1e4fd10` 的 run `39756824624`（#12）失败，web 的“管理端 UI smoke”失败，且该提交改动 workflow 后触发了 native 构建，linux/windows/macos 构建也失败。后续修复已由更晚提交覆盖，但历史失败不能从记录里删除。
- 恢复后仍须在每次推送时重复“本地验证 → 推送 → Actions 闭环”，不能沿用历史成功；本文档提交自身的 Actions run 不写入本文件，避免自我引用循环，推送后直接查 GitHub。
- 除本 HANDOFF 自身外，当前工作区有 10 个未提交代码文件，分为下列两组，**不能混提交**：
  - UI/额度草稿（5 个）：
    ```text
    M src/features/overview/UsageResourcesPanel.tsx
    M src/features/usage/PlatformUsageSection.tsx
    M src/locales/en.ts
    M src/locales/zh-CN.ts
    M tests/console-worker.spec.ts
    ```
    这些改动包含有用的 8 项额度展示和“平台请求不限”方向，但仍依赖旧的 `settings.cloudflareQuotas`、`authorizationExpired` 和 OAuth 接口，**不能原样提交**；应在 Token + subscriptions 实现时整合、改写或删除。
  - Cloudflare Token 设置 API 草稿（5 个）：
    ```text
    M worker/src/index.ts
    M worker/src/cloudflare-token.ts
    M worker/runtime/cloudflare-settings.test.ts
    M worker/runtime/outbound-stub.ts
    M worker/runtime/analytics.test.ts
    ```
    设置接口和定向测试已经成立，但同一份 `worker/src/index.ts` 里的 `cloudflareUsageApi`、旧 OAuth 路由和旧 smoke 尚未迁移；在 analytics 与 smoke 全绿前**不能推送**。
- 登录页组件拆分已在 `775384e`，侧栏/账号/工作区进一步拆分已在 `abf05ca`；`HANDOFF.md` 本次整理是独立文档步骤。不要再重复拆分登录页/侧栏/账号/工作区，先做视觉与交互验收。
- “默认工作区”过矮和按钮图标基线偏移已在 `1b39960` 修复：工作区/用户卡片改为内容自适应高度，图标容器改 flex 居中；当时用 18 张双主题三视口截图基线验证。后续仍要检查新增 UI 是否回归。
- Cloudflare Token 基础模块与设置 API 已成立：`worker/src/cloudflare-token.ts` 提供 verify、accounts 完整分页、账号唯一性校验、subscriptions/Free 判定、稳定错误类型、新密文格式和旧 OAuth 密文识别；`cloudflareSettingsApi` 已接入这些能力。**但用量接口、旧 OAuth 路由、前端和 smoke 尚未迁移，不能误判为整体完成。**
- **严禁用 `git reset --hard`、`git clean`、`git checkout -- .`、`git add .` 或任何批量覆盖操作处理这 10 个代码文件。**

下一步（按顺序）：

1. ✅ 已核对 Cloudflare 官方 subscriptions 文档（2026-10-23）：响应为 `{ result: Subscription[], errors, messages }`，每个订阅包含 `rate_plan.id`、`rate_plan.public_name`、`state`；端点接受 `Billing Read` / `Billing Write`。只有 `result` 中存在 `rate_plan.id === "free"` 时才可确认 Free，空结果或结构不符必须视为未确认。
2. ✅ `worker/src/cloudflare-token.ts` 与 `cloudflareSettingsApi` 已完成；settings + token 定向 runtime 测试 14/14 通过，`worker:typecheck` 通过；这些改动仍未提交。
3. 🔴 当前阻塞：重写 `cloudflareUsageApi`，用 `readStoredCloudflareCredential` 读取新 Token，先凭据后缓存，未配置立即返回 `{configured:false,cached:false}`；删除 refresh、`authorizationExpired`、revoke 和旧 OAuth Cookie/路由。先让 `analytics.test.ts` 5/5 与完整 runtime 通过。
4. 重写 `worker/cloudflare-oauth.smoke.ts`（或替换为 Token 设置/用量 smoke），删除 `worker:cloudflare-oauth-route-smoke` 等旧入口，确保 `npm run worker:smoke` 全绿。
5. 把 `oauth-settings.ts` 收缩到只服务 GitHub；从 `PlatformSettings` / `platformSettingsApi` / `usage.ts` 删除可编辑 `cloudflareQuotas`，接入只读 `limits`。
6. 改前端 Token 表单、固定权限、HTTP 错误留在当前设置页、8 项次数/百分比和刷新入口去重。
7. 清理异常文案、重复卡片/跳转、图标对齐，并做双主题 × 桌面/平板/手机实际检查。
8. 核验 Workers Builds 实际 Deploy command 和 migration，关闭 D1 `no such table: workspaces` 风险。
9. 新增仅手动触发的原生可执行文件/共享库构建 workflow，并在中英文帮助中心补使用教程。
10. 完整本地 CI、中文提交、推送、Actions 闭环；失败必须读取日志/失败产物并修到最新 run 成功。

## 最近动作

- 2026-10-23 18:20：再次整理 HANDOFF 当前快照，并验证 Cloudflare 设置阶段。设置 + Token 定向 runtime 14/14 通过、`worker:typecheck` 通过；完整 runtime 为 85/89 通过，4 个失败全在 `analytics.test.ts`（用例分别期望 200/200/502/200，实际均 500）；`worker:cloudflare-oauth-smoke` 因旧 `accessToken` 请求体返回 400 而失败。结论：设置 API 可保留，但用量/旧 OAuth 未迁移前禁止提交这组后端改动。
- 2026-10-23：完成“Cloudflare Token 设置 API 接入”步骤。`cloudflareSettingsApi` 已切换 `worker/src/cloudflare-token.ts`：GET 返回 `credentialKind/permissions/accountId 掩码/lastVerifiedAt/legacyCredential`，PUT 全链路校验后才加密保存并清理旧 `usage_cache`，DELETE 不调用 Cloudflare。runtime 覆盖空配置、固定权限、合法保存、无明文、无回显、缓存失效、无效 Token/权限不足/多账号/账号缺失、旧 OAuth 密文识别、DELETE 零外呼、`secret_missing`；settings 与 token 测试 14/14 通过，`npm run worker:typecheck` 通过。
- 2026-10-23：整理 HANDOFF 的一页恢复卡、最新 HEAD/Actions 快照、5 个未提交草稿保护和 U01–U23 总账；确认 `a0539fb` 已与 `origin/main` 一致，平台验收 run `39827872017`（#42）最终 `completed/success`，`changes`/`web` 成功，native 按路径过滤 skipped。本次只提交本文件。
- 2026-10-23：Cloudflare Token 基础模块完成并验证：`worker/src/cloudflare-token.ts` 实现固定只读权限常量、Token verify、accounts 完整分页、`account_missing`/`account_ambiguous`、subscriptions/Free 判定、真实 HTTP 稳定错误、API Token 密文存取和旧 OAuth 密文识别；`worker/runtime/cloudflare-token.test.ts` 8 项全部通过。宿主 GLIBC 2.31 无法启动当前 `workerd`，因此 runtime 测试通过 `node:22-bookworm` Docker 执行；`npm run worker:typecheck` 同时通过。本步骤尚未接线路由。
- 2026-10-23：开始实施下一步“Cloudflare API Token 后端模块”：新增 `worker/src/cloudflare-token.ts`，先完成 Token verify、accounts 完整分页、账号唯一性校验、subscriptions/Free 判定、稳定错误类型、新密文格式与旧 OAuth 密文识别，并用 runtime 测试验证；本步骤不改 API 路由和前端。
- 2026-10-23：核对分支、远端、工作区和 Actions；确认 `e3cdb05` 已推送，平台验收 run `39826112664`（#40）最终 `completed/success`；`5373f87` run `39825387738`、`0a5075d` run `39824622514`、`0325530` run `39823921091` 也成功。
- 2026-10-23：复核历史失败 run：`fd80fa4` run `39754896119`（#11）与 `1e4fd10` run `39756824624`（#12）均为真实失败；后者因改动 workflow 触发 native jobs，web 与三平台原生构建均失败。后续提交已覆盖修复，但保留为每次推送必须核对 Actions 的教训。
- 2026-10-23：核对 Cloudflare 官方 subscriptions 方法文档，确认响应结构、`rate_plan.id` 的 `free` 枚举、`rate_plan.public_name` 和 `Billing Read` 接受权限；可以开始实现 `worker/src/cloudflare-token.ts`。
- 2026-10-23：核对 Cloudflare 官方 API Token 权限文档，确认 `Account Settings Read`、`Account Analytics Read`、`Billing Read` 三项权限真实存在，并记录文档地址、日期和 Billing Read 的说明。
- 2026-10-23：完成 Cloudflare OAuth→API Token 迁移的代码级审计，并把后端事实、固定接口契约、测试替换范围和实施顺序补入本 HANDOFF。本次是文档整理提交，不夹带 5 个未提交草稿文件。
- 2026-10-23：确认 `abf05ca` 已推送且平台验收 run `39820685855` 成功。
- 2026-10-23：`abf05ca` 当时完整 `npm run ci:local` 通过：UI 约定、CSS 审计、Worker 类型检查、管理端构建、Worker smoke 全部通过，Playwright 81/81 passed；之后新增文档提交仍以各 run 的 web job 成功为证据，不能把旧本地结果冒充新代码结果。
- 2026-10-23：建立并持续整理本 HANDOFF，把用户从组件化、登录错误、setup、D1、Cloudflare OAuth/Token、额度监控、UI 文案到原生构建/帮助中心的全部反馈固化为用户问题总账和最终验收口径。
- 2026-10-23：`1e5fec7 docs: 记录平台迁移与组件化交接清单` 已推送，Actions run `39816813766` 成功；`4cc1b72 docs: 整理会话遗留问题与验收总账` 已推送，run `39817786882` 成功；`e4b8179 docs: 更新交接验收状态与 Actions 轮询说明` 已推送，run `39818997739` 成功。
- 2026-10-23：组件化收尾验证通过：`npm run ui:conventions`、`npm run ui:css-audit`、`npm run build`，以及账号页/工作区页两项 Playwright 用例（2 passed）。随后提交并推送 `abf05ca`，未夹带额度/OAuth 残留改动。
- 用户指出的 `1e4fd10`、`fd80fa4` 是更早的失败提交，保留为“推送后必须查 Actions”的反例；历史成功不能替代后续每次推送后的检查。

## 0. 先读这里：工作区与 Git 状态

- 精确 HEAD 不要抄本文档，执行 `git log -1 --oneline`；本文档自身提交可能晚于最近的功能提交。
- 当前环境没有 `gh`。使用 GitHub API 查询 run；需要日志时安装/配置 GitHub CLI 或使用已认证 GitHub API。
- 未认证 GitHub REST API 限额为每小时 60 次；曾因 15 秒高频轮询触发 403。轮询间隔至少 1 分钟，优先在预计完成后查询；额度耗尽时等 `X-RateLimit-Reset`，不要把 403 误判为 Actions 失败。
- 查询示例：
  ```bash
  curl -fsSL 'https://api.github.com/repos/shelter-red/plugin-platform/actions/runs?per_page=5' |
    node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{for(const r of JSON.parse(s).workflow_runs)console.log(r.head_sha.slice(0,7),r.status,r.conclusion??'-',r.id,r.display_title)})"
  ```
- 工作区存在未提交额度改动时，修改前先看 `git status` 和 `git diff`；不要用批量回滚命令掩盖或丢弃已有工作。

### 0.0 当前未提交改动的审查结论

- **UI/额度组（5 个）**：`UsageResourcesPanel` / `PlatformUsageSection` 已把平台请求改为“不限”，并补上 KV 删除/列举方向；提交版 `CloudflareUsageSection` 已展示 8 项官方额度，但上限来源仍是 `settings.cloudflareQuotas`。`src/locales/*` 仍混有 `authorizationExpired`、`reauthorize` 等 OAuth 文案；`tests/console-worker.spec.ts` 的 8 项百分比断言仍依赖旧设置和旧 OAuth mock。保留 UI 意图，但不能原样提交。
- **Cloudflare 设置组（5 个）**：`cloudflareSettingsApi` 已切到 API Token，`cloudflare-token.ts` 已提供完整校验/存取能力，settings + token 定向 runtime 14/14 通过；这是有效实现，不要回滚。
- **设置组为什么仍不能推送**：同一个 `worker/src/index.ts` 中，`cloudflareUsageApi` 仍用旧 `readCloudflareCredential` 读取 `accessToken`，但设置接口现在保存的是 `{kind:'api_token', apiToken, accountId, verifiedAt}`，所以配置后调用用量会返回 500。定向 `analytics.test.ts` 仅 1/5 通过；完整 runtime 85/89 通过，4 个失败全部来自这里。
- **旧 smoke 也证明接口契约未统一**：`worker/cloudflare-oauth.smoke.ts` 仍 PUT `{accessToken}`，运行 `npm run worker:cloudflare-oauth-smoke` 得到 `400 !== 200`。在 usage + smoke 改完前，不能提交设置组，更不能推送到 `main`。
- 处理原则：先保留设置实现，再完成用量迁移与测试替换；不能通过删断言、临时兼容旧字段或重新引入 OAuth 来制造绿色。

## 0.1 用户问题总账（按会话反馈整理）

状态图例：✅ 已实现并有验证证据；🟡 局部完成/待提交验证；⬜ 尚未开始或最终验收未通过。

| ID | 用户反馈或目标 | 必须达到的效果 | 当前状态 |
| --- | --- | --- | --- |
| U01 | “不是说全部重构成组件吗？登录页还是旧的” | 登录页及全站页面有清晰组件边界；登录页不重复重写；实际看视觉结果 | 🟡 登录页、侧栏、账号、工作区已完成组件拆分，构建与相关交互测试通过；多主题/多视口视觉检查仍未完成。 |
| U02 | 自行从会话历史读分支、提交、推送 | 每步有中文 Git 记录；不靠聊天上下文猜分支 | 🟡 `main` 已跟踪远端；HEAD `2a32bfe` 的 run #43 成功；Cloudflare Token 设置组当前未提交/未推送，必须先修完 usage 与 smoke。 |
| U03 | 推送时 Actions 老是失败 | 推送前跑完整本地 CI；推送后查 run；失败读日志/失败产物并修到成功 | 🟡 最新已推送提交 `2a32bfe` #43 成功；`fd80fa4` #11、`1e4fd10` #12 是已知失败反例。当前代码工作区完整 runtime 仍为 85/89，禁止直接推送。 |
| U04 | 错误状态为什么是 `/?auth_error=` | 授权/配置错误使用真实 HTTP status + JSON；不靠 URL 查询参数；不跳首页 | 🟡 GitHub 登录与 Cloudflare Token 设置保存/读取已使用 HTTP + JSON；旧 `/auth/cloudflare/*`、auth-result Cookie 和跳转仍在，必须删除。 |
| U05 | setup 失效为何单独返回 “Setup is not available” | `setupApi` 返回 `null` 时与其他非路由请求一致，不发明特殊响应 | ✅ 已按普通非路由路径处理；保留回归测试，Cloudflare 改造不能破坏。 |
| U06 | `D1_ERROR: no such table: workspaces` | 生产部署必须先应用 `0008_workspaces.sql` 及全部 migrations；pending migration 时构建失败 | 🟡 `scripts/deploy-worker.sh` 已包含 migration 检查；仍需核对 Workers Builds 实际 Deploy command 和生产接口，不能只修脚本。 |
| U07 | `invalid_scope`，不允许 `workers-platform.read` | 删除 OAuth scope 流程，使用长期 API Token；Token 权限固定为 Account Settings Read / Account Analytics Read / Billing Read | 🟡 设置 API 已完全使用 API Token 和固定三项权限；旧 OAuth exchange/refresh/revoke、授权路由和用量路径仍存在，删除后才算完成。 |
| U08 | Cloudflare 授权失败后为什么跳首页 | 错误留在系统设置页，显示 HTTP 状态、稳定错误码和可操作说明 | 🟡 Token 保存错误已留在 `PUT /api/settings/cloudflare`；旧 `/auth/cloudflare/*`、Cookie auth-result 和跳转逻辑尚未删除。 |
| U09 | 用户创建 OAuth 不知道给什么权限；取消勾选权限就没了 | 权限不可编辑、固定只读展示；用户不需要猜 scope；创建链接直接去 Token 页面 | 🟡 后端 GET 已固定返回三项只读权限且 PUT 不接受 scope；前端 Token 表单和直达链接尚未实现。Token 页面：`https://dash.cloudflare.com/profile/api-tokens`。 |
| U10 | “未识别唯一账号”也是权限问题 | verify → accounts → subscriptions 全链路校验；账号不唯一/不可见返回 409 `account_missing`/`account_ambiguous`，不猜第一个账号 | 🟡 已在设置 API 实现并由定向测试覆盖（14/14 中的相关用例通过），但改动未提交；需随完整 Token 迁移一起验收。 |
| U11 | 用量和配额为什么没有刷新按钮 | 用量页保留一个清晰的手动刷新入口；刷新不被自动加载禁用；按钮状态可观察 | ⬜ 当前存在多处刷新/重复入口，尚未完成最终清理。 |
| U12 | OAuth 里没有 `offline_access` | 彻底移除 `offline_access`、OAuth refresh 和“过期/重新授权”文案 | 🟡 设置接口已不涉及 OAuth；旧 `cloudflare-oauth.ts`、OAuth 路由和用量 refresh 仍在，必须整体删除。 |
| U13 | `configured:false` 为什么还能查 `/api/usage/local`，且返回 200 | 分清接口语义：未配置 Cloudflare 时 `/api/usage/cloudflare` 立即 `{"configured":false,"cached":false}`，不读缓存、不发外部请求；本地统计 `/api/usage/local?range=7d` 仍应 200 | 🟡 未配置短路用例已通过；配置 Token 后的 4 个 analytics 用例仍因 `cloudflareUsageApi` 未迁移而 500，必须先修复。 |
| U14 | `response_type` 等字段放错位置；CF OAuth 没有 PKCE 选项 | 旧 OAuth UI 中 `response_type` 若短暂保留也只能属于 OAuth 配置、值为 `code`；最终 Token 方案应直接移除 response_type/grant_type/PKCE 等全部客户端字段 | ⬜ 最终以“所有 OAuth 客户端字段消失”为验收，避免继续维护错误表单。 |
| U15 | `1e4fd10`、`fd80fa4` 两个提交 Actions 失败 | 每次失败修复后本地 CI、推送、Actions、失败产物全部闭环 | 🟡 最新已推送 HEAD `2a32bfe` 的 run #43 成功；当前代码工作区 runtime 未全绿，所以本阶段只能安全提交文档，代码组需修完再推送。 |
| U16 | 图标没对齐；左上角“默认工作区”很矮挡住文字 | 统一图标尺寸、按钮高度、gap、行高和垂直居中；双主题/多视口实际检查 | 🟡 `1b39960` 已修复工作区开关高度、文字裁切和 AntD 按钮图标基线，并用 18 张双主题三视口基线验证；新增页面/控件仍需最终回归审计。 |
| U17 | 配额少，D1 写入等所有有限制项目都要监控，显示次数和百分比 | Worker、D1 行读、D1 行写、KV 读/写/删/列表、DO 请求共 8 项；每项都有 used/limit/percentage | 🟡 提交版已展示 8 项和百分比，未提交改动补了总览与测试；但上限仍来自手填 `settings.cloudflareQuotas`，必须改为 subscriptions 的只读 `limits` 才算完成。 |
| U18 | 平台和监控分开；平台请求不限，CF 免费额度有限 | 平台请求只统计不设上限、不画上限百分比；Cloudflare 官方额度独立分组 | 🟡 平台/Cloudflare 分组和“不限”已实现；上限来源仍是手填设置，需和 U17/U20 一起改为 Cloudflare 读取。 |
| U19 | GitHub OAuth 没过期，为什么 CF OAuth 会过期；Token/API key 会不会过期；改成 Token | 不再暗示 OAuth 自然过期；改用 Cloudflare API Token（默认长期，可被撤销/策略限制）；界面、链接、错误文案同步改成 Token | 🟡 设置 API 和凭据格式已切到 Token；前端 Token 表单、旧 OAuth 路由/文案/文档仍待迁移。 |
| U20 | CF 免费额度为什么能在系统设置配置；应该从 CF 读取 | 删除 `cloudflareQuotas` 手填；调用 `GET /accounts/{account_id}/subscriptions`；只有明确 Free 才展示官方基线，否则“未读取” | 🟡 设置保存时已校验 subscriptions，Token 模块可解析 Free；usage 响应/UI 尚未接入只读 limits，`cloudflareQuotas` 仍存在。 |
| U21 | 界面文案诡异、莫名卡片、同页多个按钮跳同一页面 | 通读中英文文案；清理重复说明、技术黑话、无信息量卡片和重复跳转；每个页面只保留必要主入口 | ⬜ 已知用量页至少三个刷新入口、概览卡片重复跳 `/usage`；尚需全站审计。 |
| U22 | Actions 增加手动构建插件服务器：可选可执行文件/库文件、目标平台 | 新增仅 `workflow_dispatch` 的 workflow；构建真正共享库及可执行程序；目标平台/架构明确；artifact、SHA256、依赖说明完整；不与 tag release 冲突 | ⬜ 尚未新增。 |
| U23 | 帮助中心说明二进制插件服务器/库文件怎么用 | 中英文帮助中心覆盖下载、SHA256、启动/注册、环境变量、插件目录/主机、库链接、OpenSSL 运行依赖、常见错误 | ⬜ 尚未新增；现有帮助仍偏旧 OAuth FAQ。 |

> 总账完整性：以上 U01–U23 已覆盖本会话中用户提出的组件化、登录页、HTTP 错误、setup、D1、Cloudflare OAuth/Token、固定权限、账号识别、刷新按钮、`configured:false`、`response_type`/PKCE、用量 8 项与百分比、平台/Cloudflare 分组、设置来源、诡异文案/重复卡片/重复跳转、图标对齐、Actions、原生手动构建和帮助中心要求。后续若新增反馈，继续追加编号，不覆盖旧条目。

### 0.2 当前不能误判为“已完成”的事项

- 登录页“看起来旧”不代表组件化失败；先把组件结构、视觉和实际交互一起验收。
- **设置 API 14/14 通过不等于 Token 迁移完成**：`cloudflareUsageApi` 仍读旧 OAuth 密文，配置 Token 后 analytics 返回 500；旧 OAuth 路由/Cookie/refresh/revoke 也仍在。
- **完整 runtime 85/89 不等于可推送**：4 个失败集中在 `analytics.test.ts`，且旧 Cloudflare OAuth smoke 仍为 400；必须让 runtime 与 `worker:smoke` 全绿。
- 静态免费额度常量不等于从 Cloudflare 读取；只有 subscriptions 明确确认 Free 套餐后才有资格展示官方基线。
- `/api/usage/local` 返回 200 是预期行为，不代表 Cloudflare 未配置也能查询云端数据；两个接口必须分开验证。
- 历史 Actions 成功不代表后续安全；每次推送后以最新 run 的状态和日志为准。

### 0.3 代码级审计事实（2026-10-23 18:20）

以下内容是恢复后可直接定位的当前事实，不是建议：

- `worker/src/cloudflare-token.ts` 已提供固定三项权限、Token verify、accounts 全分页、账号唯一性、subscriptions/Free 判定、稳定错误、API Token 密文存取和旧 OAuth 密文识别；8/8 runtime 测试通过。
- `worker/src/index.ts` 已导入 `cloudflare-token.ts`；`cloudflareSettingsApi` 已完成 verify → accounts → subscriptions → 加密保存，GET 不回显 Token，DELETE 不调用 Cloudflare，settings 6/6 测试通过。
- `worker/src/index.ts` 仍同时导入旧 `cloudflare-oauth.ts`；`cloudflareUsageApi` 仍调用 `readCloudflareCredential` / `refreshCloudflareCredential`，只认 `accessToken`，因此读不到 `{kind:'api_token', apiToken, ...}`。这是 analytics 4 个 500 失败的直接原因。
- `worker/src/index.ts` 的 `cloudflareUsageApi` 仍先读 `usage_cache` 再读凭据，仍保留 401 后 refresh、`authorizationExpired`、OAuth 错误语义和手填 `cloudflareQuotas` 维护判断。
- `worker/src/index.ts` 仍注册 `/auth/cloudflare/start`、`/auth/cloudflare/callback` 和 `/api/settings/cloudflare/auth-result`，并在 scheduled maintenance 中清理 `cloudflare_oauth_states`。
- `worker/src/cloudflare-auth-result.ts` 仍通过一次性 Cookie `plugmesh_cf_auth` 传递授权结果；Token 方案落地时必须整体删除。
- `worker/src/oauth-settings.ts` 仍混合 GitHub 与 Cloudflare OAuth，公开 `clientId`、`redirectUri`、`scope`、`scopeNames`、`responseType`、`grantType`、`tokenAuthMethod`；最终只能保留 GitHub。
- `worker/src/cloudflare-oauth.ts` 仍导出 exchange/refresh/discover/revoke/read；`discoverCloudflareAccountId` 仍只取 `per_page=2`，不能用于账号唯一性判断。
- `worker/src/index.ts` 的 `platformSettingsApi` 仍接受并持久化 `cloudflareQuotas`；`worker/src/types.ts` 与 `worker/src/usage.ts` 也仍包含它。
- `worker/src/usage.ts` 的 `defaultCloudflareQuotas` 仍是可编辑设置/默认值来源；迁移后只能作为“subscriptions 已确认 Free”后的只读官方基线。
- `worker/cloudflare-oauth.smoke.ts` 仍 PUT `{accessToken}`；实测 `npm run worker:cloudflare-oauth-smoke` 因新设置接口返回 400 而失败。`package.json` 的 `worker:smoke` 仍包含两个旧 Cloudflare OAuth smoke。
- 当前 `.github/workflows/` 只有 `platform-ci.yml` 和 `release.yml`；尚无仅 `workflow_dispatch` 的原生“可执行文件/共享库”构建 workflow。
- 当前 `native-server/CMakeLists.txt` 的 `plugmesh_core` 是 `STATIC`，只有 `add_executable(plugmesh-server ...)`；真正的共享库 target 和构建开关尚未实现，不能把静态库改扩展名冒充共享库。

### 0.3.1 Cloudflare 官方文档核对记录（2026-10-23）

- 官方 API Token 权限列表：https://developers.cloudflare.com/fundamentals/api/reference/permissions/
- 该页确认 `Account Settings Read`、`Account Analytics Read`、`Billing Read` 都是真实权限，不再使用不存在的 `workers-platform.read`、`offline_access`。
- 该页对 `Billing Read` 的说明是：可读取 billing profile、subscriptions，并可访问 invoices/entitlements；这支持用它读取订阅，但实际账号响应和错误边界仍需按下面的官方端点文档核对。
- 账号订阅端点文档：https://developers.cloudflare.com/api/resources/accounts/subresources/subscriptions/
- 该页的 Markdown 版本：https://developers.cloudflare.com/api/resources/accounts/subresources/subscriptions/index.md
- 曾尝试 `https://api.cloudflare.com/client/v4/openapi.json`，返回 HTTP 400；**不能**把该地址当作官方 schema 依据。
- `GET /accounts/{account_id}/subscriptions` 已确认返回 `{ result: Subscription[], errors, messages }`；订阅模型包含 `id`、`currency`、`current_period_start/end`、`frequency`、`price`、`rate_plan`、`state`，其中 `rate_plan.id` 的官方枚举包含 `free`，`rate_plan.public_name` 是完整套餐名。
- 该端点“Accepted Permissions”明确接受 `Billing Read` 或 `Billing Write`。Free 判定只允许在 `result` 中实际找到 `rate_plan.id === "free"` 时成立；空结果、缺少 `rate_plan` 或响应结构不可解析时都必须返回未确认，不能猜。

### 0.4 后续不得偏离的硬约束

- 不能“把 OAuth 字段换个名字”继续保留 OAuth；目标是从路由、Cookie、配置、刷新、撤销、文案到测试全部移除 Cloudflare OAuth。
- 不能保存明文 Token；GET 设置接口永远不能回显 Token。旧 OAuth 密文只能被识别为旧格式并提示重新录入 API Token，不能 refresh、revoke 或继续查询。
- 不能因为 Billing Read 读取 subscriptions 出现权限问题就删掉该固定权限；应先核对 Cloudflare 官方文档和真实响应，把 401/403/404/其他错误准确映射给用户。
- 不能在未确认 Free 套餐时展示 8 项固定上限；无法读取/确认时 `limits` 必须为 `null`，UI 显示“未读取”。
- 不能把平台请求套上 Cloudflare Worker 请求上限；平台统计只计数、不拦截，Cloudflare 官方额度独立分组。
- 不能恢复 `/?auth_error=`、Cloudflare auth-result Cookie、跳首页或 “Setup is not available” 等特例。
- 不能用牺牲测试覆盖、删除断言、只改文案或手写 mock 的方式制造绿色；每个稳定错误码和未配置短路都要有真实请求边界测试。
- 不要批量回滚当前 10 个未提交代码文件：5 个 UI 草稿包含 8 项额度展示和平台请求“不限”的有用意图；5 个设置组包含已验证的 Token 设置 API。两组都应在 usage/limits 数据模型落地后整合，而不是丢弃。

### 0.5 关键提交地图（避免重复劳动）

| 提交 | 已证明的内容 | 恢复时不要重复做什么 |
| --- | --- | --- |
| `775384e` | 登录页拆成 `LoginPage` / `AuthFrame` / 品牌 / 加载页 | 不要再把登录页整体重写一遍 |
| `7ab4c90` | 侧栏与顶栏从外壳拆出 | 不要重新拆分基础外壳 |
| `cc42ddb` | Cloudflare 面板拆成授权区与 OAuth 客户端区 | 这是旧 OAuth 结构，迁移 Token 时要替换下半区，不是继续加字段 |
| `1b39960` | 工作区开关高度、文字遮挡、AntD 按钮图标基线修复；18 张双主题三视口基线通过 | 不要回退成固定 32px 高或重做旧的像素基线 |
| `742640e` | 平台请求不限；Cloudflare 8 项额度与百分比；平台/Cloudflare 分组 | 不要重新引入平台请求上限，也不要漏掉 D1 写入/KV 删除/列举 |
| `12e7aae` | 用量页拆为状态提示、额度分组、数据源、分布部件 | 不要继续把页面逻辑堆回 `UsagePage` |
| `abf05ca` | 侧栏品牌、工作区切换、导航、页脚、账号/工作区页进一步组件化 | 不要再重复拆同名组件 |
| `70f62e3` → `e3cdb05` | HANDOFF 固化、Cloudflare 官方权限与 subscriptions 响应核对 | 不要把旧 OAuth 事实当成当前目标 |

### 0.6 Actions 失败与排查台账

- `fd80fa4`（run `39754896119`，#11，`failure`）：web job 的“管理端 UI smoke”失败；native jobs 本次为 skipped。该提交属于旧 OAuth 修复尝试，不能拿来做最终方案。
- `1e4fd10`（run `39756824624`，#12，`failure`）：web job 的“管理端 UI smoke”失败；linux/windows/macos native 构建也失败。提交信息包含“刷新按钮不被自动加载禁用，并补上 CI 失败产物上传”，但失败本身证明只改 UI/测试/工作流还不够。
- `c32a587`（run `39826901281`，#41）与 `a0539fb`（run `39827872017`，#42）：`changes` 与 `web` job 均为 success，最终 run 为 `completed/success`；native jobs 按路径过滤 skipped，这是预期行为。
- `e3cdb05`（run `39826112664`，#40）：`changes` 与 `web` job 均为 success，最终 run 为 `completed/success`；native jobs 按路径过滤 skipped，这是预期行为。
- 排查顺序：先看最新 run 的 `status/conclusion`，再看 `/actions/runs/{id}/jobs` 的失败 step；未认证环境下载完整日志可能返回 403，不能把 403 当成代码失败，改用 `gh run view --log-failed` 或带认证的 GitHub API。失败产物必须检查，不能只看 job 名称。
- 推送前至少执行 `git diff --check`；涉及运行时代码时必须跑第 6 节完整命令。改动 `.github/workflows/platform-ci.yml` 会触发 native 路径过滤，必须预计并验证三平台 job，而不是只盯 web。

## 1. 用户最新要求（验收口径）

### 1.1 Cloudflare 必须从短效 OAuth 迁移为长期 API Token

- Cloudflare API Token 默认不过期；创建时若显式设置 TTL 才会过期。界面不要再暗示“和 GitHub OAuth 一样会自然过期”。
- 系统设置只录入：
  - Cloudflare API Token（密码框，保存后不回显）
  - Account ID（可选；账号不唯一时必须填写）
- “创建 Token”链接改为：`https://dash.cloudflare.com/profile/api-tokens`
- 删除整个 Cloudflare OAuth 客户端配置流程，不再要求用户创建 OAuth Client：
  - 不出现 Client ID / Client Secret
  - 不出现回调地址
  - 不出现 `response_type` / `grant_type` / token endpoint auth method / PKCE
  - 不出现可编辑 scope、`offline_access`、`workers-platform.read`
- 权限必须固定、只读展示，不能勾选/取消，不能让用户自行猜测：
  - `Account Settings Read`
  - `Account Analytics Read`
  - `Billing Read`
- 不再创建 OAuth 授权链接；不再有 `/auth/cloudflare/start` 回调授权流程。
- 保存 Token 前服务端必须校验，不能只加密落库：
  1. `GET https://api.cloudflare.com/client/v4/user/tokens/verify` 验证 Token。
  2. `GET https://api.cloudflare.com/client/v4/accounts?per_page=...` 发现/校验 Account ID。
  3. `GET https://api.cloudflare.com/client/v4/accounts/{account_id}/subscriptions` 验证 `Billing Read` 并读取套餐。
  4. 全部成功后加密保存 Token、Account ID、验证时间和可用的 token metadata。
- 错误必须是真实 HTTP 状态并把错误留在系统设置页，不允许：
  - `302 /?auth_error=...`
  - 跳回首页
  - 用 Cookie 传 Cloudflare 授权结果
  - 在授权不可用/未配置时返回特殊文案 “Setup is not available”
- 建议稳定错误映射：
  - Token 无效：HTTP 401，`token_invalid`
  - Token 缺少固定权限：HTTP 403，`token_permission_denied`
  - Token 可见账号不唯一且未填 Account ID，或指定账号不可见：HTTP 409，`account_missing` / `account_ambiguous`
  - `SESSION_SECRET` 缺失：HTTP 503，`secret_missing`
- 删除配置只删除本地密文和 `usage_cache`，不要调用 OAuth revoke；Token 由用户自行到 Cloudflare 后台撤销。
- 旧 OAuth 密文要兼容读取以便识别，但必须在 UI 标成“旧版 OAuth 凭据，请重新录入 API Token”，不能静默当成有效 Token。

#### 1.1.1 建议固定 API 契约（实现时以此收敛前后端）

设置接口 `GET/PUT/DELETE /api/settings/cloudflare`：

```ts
// GET
{
  configured: boolean
  credentialKind: 'api_token' | 'legacy_oauth' | null
  accountIdConfigured: boolean
  accountId: string | null // 只返回掩码，例如 abcd...wxyz
  permissions: string[] // 固定三项只读展示，不接受前端修改
  updatedAt: string | null
  lastVerifiedAt: string | null
  legacyCredential: boolean
}

// PUT
{ apiToken: string; accountId?: string }
```

- `PUT` 的 `apiToken` 不得为空；编辑时若产品允许不重新输入 Token，必须明确使用已保存密文并重新 verify，不能跳过校验。
- `PUT` 只有 `verify → accounts 全分页 → account 唯一性/指定账号匹配 → subscriptions` 全部成功后才落库。失败响应至少包含真实 HTTP status、稳定 `code`、可展示 `message`，字段错误可附 `field`。
- `DELETE` 只删除 `cloudflare_credentials`，同时删除 `usage_cache` 中该账号/全局 Cloudflare key；不调用任何 Cloudflare 外部接口。
- `GET` 解密旧 OAuth 结构时返回 `configured:false`、`legacyCredential:true` 或等价明确状态，不得回显旧 access/refresh token。
- 任何 Cloudflare 设置错误都留在系统设置页当前面板显示；不得 302、不得写 `auth_error` 查询参数、不得用 Cookie 传结果。

稳定错误映射：

| HTTP | code | 场景 |
| --- | --- | --- |
| 400 | `token_required` | 首次保存缺少 Token，或请求体不合法 |
| 401 | `token_invalid` | `/user/tokens/verify` 返回未验证/无效 Token |
| 403 | `token_permission_denied` | verify 通过，但 accounts 或 subscriptions 因固定权限不足而拒绝 |
| 409 | `account_missing` | 无可见账号、指定 Account ID 不可见/不存在 |
| 409 | `account_ambiguous` | 未填写 Account ID 且完整分页后发现多个可见账号 |
| 502 | `cloudflare_upstream_error` | Cloudflare 5xx、网络失败或响应结构无法解析 |
| 503 | `secret_missing` | `SESSION_SECRET` 缺失，无法安全存取 Token |

订阅响应字段和 Free 识别方式已于 2026-10-23 按官方文档确认：只认 `result[].rate_plan.id === "free"`；实现时仍需用真实响应边界测试空结果、非 Free 和结构错误，不能靠 mock 猜测。

### 1.2 Cloudflare 免费额度只能从 Cloudflare 读取

- 用户不能在系统设置手填 Cloudflare 免费额度。
- 从 `GET /accounts/{account_id}/subscriptions` 读取套餐；响应为 `{ result: Subscription[], errors, messages }`，**只有 `result[].rate_plan.id === "free"` 明确确认是免费计划时**，才显示官方免费基线。
- 无法读取订阅、无法确认套餐或权限不足时显示“未读取”，不能把静态常量伪装成账号实时返回值。
- 当前官方免费基线（2026-10 核对，显示时注明“官方免费基线，已确认 Free 套餐”）：
  - Worker 请求：100,000 / 日
  - D1 行读：5,000,000 / 日
  - D1 行写：100,000 / 日
  - KV 读：100,000 / 日
  - KV 写：1,000 / 日
  - KV 删除：1,000 / 日
  - KV 列表：1,000 / 日
  - Durable Object 请求：100,000 / 日
- 所有有上限的项目必须同时显示“已用次数”和“百分比”，尤其不能漏掉 D1 行写入。总计 8 项。
- 平台自己的统计和 Cloudflare 官方额度必须分组展示：
  - 平台请求只统计，不设上限，也不画上限百分比。
  - 平台本地统计不依赖 Cloudflare Token。
- 未配置 Cloudflare 时，`GET /api/usage/cloudflare` 必须直接返回：

```json
{"configured":false,"cached":false}
```

同时满足：
  - 不先读缓存
  - 不请求 Cloudflare 外部 API
  - 不凭旧缓存显示“已查到”
  - `/api/usage/local?range=7d` 仍可返回 200 和本地统计

- 配置了 Token 后的缓存顺序必须是：先读并解密凭据，再读 `usage_cache`；不能在未配置时命中缓存。
- 用量响应建议包含只读字段：

```ts
{
  configured: true,
  plan: { id?: string; name?: string; free: boolean; confirmed: boolean },
  limitSource: 'cloudflare_subscriptions_free_baseline' | 'unavailable',
  limits: {
    workerRequests: number
    d1RowsRead: number
    d1RowsWritten: number
    kvRead: number
    kvWrite: number
    kvDelete: number
    kvList: number
    doRequests: number
  } | null
}
```

- 前端只能使用响应里的 `limits`，不能继续读 `settings.cloudflareQuotas`。

### 1.3 setup、错误状态和路由语义

- `setupApi` 返回 `null` 时，请求继续走普通非路由处理；不要单独返回 “Setup is not available”，也不要为 setup 发明不同于其他非路由路径的行为。
- GitHub 登录错误已经改为 HTTP 错误页；Cloudflare Token 迁移后不存在授权回调，设置保存错误必须使用 HTTP status + JSON，由当前设置面板展示。
- 任何“重新授权”“授权已过期”的文案都要清理，改成 Token 无效/权限不足/检查配置。

### 1.4 组件化和界面质量

- 所有页面继续组件化。不要因为“登录页还是旧的”就无脑重写：当前登录页已经拆分：
  - `src/features/auth/LoginPage.tsx`
  - `AuthFrame.tsx`
  - `AuthBrand.tsx`
  - `AuthLoadingScreen.tsx`
  - `GithubMark.tsx`
  - 下一步是实际视觉检查和修正，而不是重复拆一遍。
- 侧栏已拆为 `SidebarBrand`、`SidebarWorkspaceSwitcher`、`SidebarNavigation`、`SidebarFooter`、`sidebar-nav.ts`；保留并完成测试。
- 清理“像压缩上下文后生成”的异常文案：重复说明、技术黑话、前后矛盾、无信息量卡片。
- 清理同一页面重复功能：
  - 用量页目前“刷新用量”至少出现在 `PageHeader`、`UsageStatusAlert`、`UsageSourcesPanel`；只保留一个主刷新入口，避免三个按钮做同一件事。
  - 概览 `UsageResourcesPanel` 右上角详情按钮和底部“查看全部配额”都跳 `/usage`；删除同一卡片内重复出口。
  - 检查 MetricCard、快速开始等是否存在同页多个按钮跳同一页面。
- “默认工作区”切换器不能过矮遮挡文字；统一检查图标尺寸、按钮高度、gap、文字行高和垂直居中。
- 至少在双主题 × 桌面/平板/手机视口下实际检查登录、总览、用量、设置、工作区、账号页。

### 1.5 生产 D1 `workspaces` 表缺失

- migration `worker/migrations/0008_workspaces.sql` 已存在；曾排查到生产环境直接用了 `wrangler versions upload`，绕过 `npm run deploy` 的 migrations。
- 远端缺失表当年已人工补齐，但这不能代替流程修复。
- 必须确保 Cloudflare Workers Builds 的 Deploy command 是 `npm run deploy`（或等价地先执行 `wrangler d1 migrations apply DB --remote` 再发布）。
- 保留并验证部署脚本的 migration 遗留检查：有 pending migration 时必须让构建失败，不能上线缺表版本。
- 验证 0008 及全部 migration 后，生产接口不再出现 `D1_ERROR: no such table: workspaces`。

### 1.6 GitHub Actions 手动构建插件服务器

- 新增一个 **仅手动触发** 的 workflow（建议 `.github/workflows/build-plugin-server.yml`，`on: workflow_dispatch`）。不要和 tag 发布 workflow 混淆。
- 输入至少包括：
  - 产物类型：可执行程序 / 库文件
  - 目标平台：Linux、Windows、macOS；需要明确 x64/arm64 中哪些 runner 实际支持
- 可执行程序产物继续包含 `plugmesh-server`、运行依赖和 README。
- 库文件产物需要真正构建动态/共享库，而不是把现有 STATIC `plugmesh_core` 改个文件名：
  - 在 `native-server/CMakeLists.txt` 增加明确开关，例如 `PLUGMESH_BUILD_SERVER`、`PLUGMESH_BUILD_CORE_SHARED`
  - 输出共享库 `plugmesh_core`
  - 打包公共头文件、库文件、OpenSSL/运行时依赖说明、README 和校验和
- Windows 要处理 OpenSSL DLL/applocal；macOS/Linux 要处理 OpenSSL 查找和 RPATH/部署边界。
- 工作流要上传 artifact，并生成 SHA256；可选产物名要和用户选择一致。
- 当前 `release.yml` 是 tag/workflow_dispatch 发可执行文件；新增手动 workflow 后避免与 release 重复发布同一 tag。

### 1.7 帮助中心补二进制服务器/库服务器用法

必须同时更新中英文，并让内容按用户操作路径写，不能只列技术栈：

- `src/content/help.zh-CN.md`
- `src/content/help.en.md`
- `native-server/README.md` / 根 README 视情况同步

至少覆盖：
- 从哪里下载可执行程序和校验和
- 如何校验 SHA256
- 如何运行 `plugmesh-server --register ...`
- 如何配置 `PLUGMESH_PLUGIN_DIRECTORY`、`PLUGMESH_PLUGIN_HOST`
- 如何启动、绑定服务器、加载插件
- 库文件如何被宿主程序链接/嵌入
- 需要哪些头文件、库文件和 OpenSSL 运行库
- 可执行文件与库文件两种部署边界和常见错误

## 2. 当前实现状态（不要重复劳动）

### 已完成/已提交

- `a0539fb` 提交了 `worker/src/cloudflare-token.ts` 基础模块及 8 项 runtime 测试：固定权限常量、Token verify、accounts 全分页、账号唯一性、subscriptions/Free 判定、稳定错误和 API Token 密文存取；平台验收 #42 成功。
- 总览、列表、工作区、Cloudflare 设置、用量页做过一轮组件拆分；侧栏/账号/工作区已在 `abf05ca` 进一步拆分并提交。
- GitHub 登录错误已使用 HTTP 错误页，不再使用 `?auth_error=`。
- `setupApi` 返回 `null` 后会继续普通请求处理，不再返回 “Setup is not available”。
- `scripts/deploy-worker.sh` 已包含构建、D1/R2 准备、migrations apply、pending migration 检查和发布。
- `platform-ci.yml` 已固定 Playwright 镜像并上传 UI 失败产物。

### 已完成/未提交（当前工作区）

- `GET/PUT/DELETE /api/settings/cloudflare` 已切到长期 API Token：
  - GET 返回 `credentialKind`、固定只读权限、Account ID 掩码、`updatedAt`、`lastVerifiedAt`、`legacyCredential`，永不回显 Token。
  - PUT 完整执行 verify → accounts 全分页 → 账号唯一性/指定账号校验 → subscriptions → 加密保存，并清理旧 `usage_cache`。
  - DELETE 只删除本地密文与 `usage_cache`，不调用 Cloudflare。
  - 旧 OAuth 密文只识别为 `legacy_oauth`，不返回 access/refresh token。
- `worker/runtime/cloudflare-settings.test.ts` 6 项与 `worker/runtime/cloudflare-token.test.ts` 8 项，共 14/14 通过；`npm run worker:typecheck` 通过。
- 5 个 UI/额度草稿包含 8 项展示、D1 写入/KV 删除/KV 列举、平台请求“不限”的有用方向，但尚未接入只读 `limits`。

### 当前阻塞（未完成）

- `cloudflareUsageApi` 仍使用旧 `readCloudflareCredential`，只认 `accessToken`；读不到新 `{kind:'api_token', apiToken, accountId, verifiedAt}`，配置后 analytics 返回 500。
- `cloudflareUsageApi` 仍先读缓存、后读凭据，仍保留 OAuth refresh、`authorizationExpired` 和旧错误语义。
- 定向 `analytics.test.ts` 仅 1/5 通过；完整 runtime 为 **85 passed / 4 failed**，失败全在 analytics。旧 `worker:cloudflare-oauth-smoke` 也返回 `400 !== 200`。
- `/auth/cloudflare/*`、auth-result Cookie、旧 OAuth client/scope 配置、refresh/revoke 和 scheduled OAuth state 清理仍在。
- `cloudflareQuotas` 仍在 PlatformSettings、平台设置 API、usage 默认值和前端设置/测试中。
- `oauth-settings.ts` 仍混合 GitHub 与 Cloudflare OAuth。
- Cloudflare 设置页仍要求 OAuth Client ID/Secret、回调、协议字段和可编辑 scope；前端尚未切到 Token 表单和固定权限展示。
- 用量响应没有只读 `plan` / `limitSource` / `limits`；UI 仍不能从 subscriptions 得到 8 项上限。
- 用量页仍有多个刷新入口；概览仍可能重复跳 `/usage`；异常文案、重复卡片和图标对齐尚未完成最终审计。
- `README.md`、`docs/acceptance-matrix.md`、`docs/local-e2e.md` 仍描述旧 OAuth/手填额度。
- 手动原生构建 workflow、共享库 target 和中英文二进制服务器/库文件帮助尚未新增。

### 当前验证证据（2026-10-23 18:20）

```text
npm run worker:typecheck                              PASS
settings + token runtime                              14/14 PASS
analytics.test.ts                                     1/5 PASS（4 FAIL，均 500）
full worker runtime                                   85/89 PASS（20/21 files）
npm run worker:cloudflare-oauth-smoke                 FAIL 400 !== 200
git diff --check                                      PASS
```

结论：**设置 API 可以保留，但当前工作区不是可推送状态。** 先修 usage、删除 OAuth、重写 smoke；之后跑完整 runtime、worker smoke 和本地 CI。

## 3. 代码修改地图

### Worker / 数据模型

- `worker/src/cloudflare-oauth.ts`
  - 当前仍是 OAuth exchange/refresh/revoke；只是设置 API 已不再依赖它。
  - `cloudflare-token.ts` 已提供 verify、accounts、subscriptions、credential 类型和稳定错误类型；下一步删除旧模块及其调用方。
- `worker/src/index.ts`
  - ✅ `cloudflareSettingsApi` 已重写为 API Token 校验/保存，DELETE 不 revoke（未提交）。
  - 🔴 `cloudflareUsageApi` 仍用旧 OAuth 凭据与 refresh，且先读缓存；必须先凭据、后缓存，未配置立即返回 `{configured:false,cached:false}`。
  - 删除 `/auth/cloudflare/start`、`/auth/cloudflare/callback` 的导入和路由。
  - 删除 `/api/settings/cloudflare/auth-result`。
  - 删除 `startCloudflareAuth`、`finishCloudflareAuth`、`redirectWithCloudflareAuthResult`。
  - `platformSettingsApi` 删除 `cloudflareQuotas` 入参和输出。
- `worker/src/types.ts`
  - 从 `PlatformSettings` 删除 `cloudflareQuotas`。
  - 删除 `CloudflareQuotas` 的平台设置含义，改成 usage 响应中的只读 `limits`。
  - 删除 `CLOUDFLARE_OAUTH_*` env。
- `worker/src/usage.ts`
  - 删除 `defaultCloudflareQuotas` 作为持久化设置来源和 platform settings 字段。
  - 保留 `cloudflareQuotaReason` 逻辑，但调用方传入运行时读取到的官方 `limits`。
  - 官方基线可作为“已确认 Free 套餐后的 fallback 常量”，不能作为用户可编辑设置。
- `worker/src/oauth-settings.ts`
  - 仅保留 GitHub OAuth；所有 Cloudflare OAuth 协议/scope 输出删除。
- `worker/src/cloudflare-auth-result.ts`
  - 整体删除。
- `worker/src/scheduled.ts` / 相关清理
  - 搜索并处理 `cloudflare_oauth_states` 等旧表清理逻辑；迁移可保留历史表，但不再产生新 state。
- `worker/migrations/0008_workspaces.sql`
  - 不改写已发布 migration；保证部署流程应用它。
- `scripts/deploy-worker.sh`
  - 继续作为唯一部署入口；检查 Workers Builds Deploy command 文档和测试。

### 前端

- `src/api.ts`
  - 删除 `CloudflareOauthSettings`、`CloudflareAuthResult`、`fetchCloudflareAuthResult`。
  - `OauthSettings` / `OauthSettingsInput` 只剩 GitHub。
  - `PlatformSettings` 删除 `cloudflareQuotas`。
  - `CloudflareUsage` 增加 `plan`、`limitSource`、只读 `limits`；删除 `authorizationExpired`。
- `src/app/useConsoleData.ts`
  - 删除 Cloudflare auth-result Cookie useEffect 和 diagnosis 状态；保留 GitHub 登录态路径。
- `src/features/settings/`
  - 删除/重写这些旧 OAuth 文件：
    - `CloudflareAuthorizeSection.tsx`
    - `CloudflareAccountCard.tsx`
    - `CloudflareClientSection.tsx`
    - `CloudflareClientFields.tsx`
    - `CloudflareProtocolFields.tsx`
    - `CloudflareScopeList.tsx`
    - `CloudflareAuthDiagnostics.tsx`
    - `useCloudflareAuthorization.ts`
    - `useCloudflareClientForm.ts`
    - `cloudflare-auth.ts`
  - 新组件建议：`CloudflareTokenForm`、`CloudflareTokenStatus`、`CloudflarePermissionList`、`useCloudflareTokenForm`。
  - `CloudflarePanel` 只保留 Token 表单、固定权限、校验状态和当前面板错误。
  - `MaintenancePanel` / `QuotaSettings` / `useMaintenanceSettings` 只编辑平台阈值（连接、R2 bytes、R2 objects）；免费额度改成只读或移出设置页。
- `src/features/usage/`
  - `CloudflareUsageSection` 和 `UsageResourcesPanel` 从 usage 响应读 `limits`，不读 settings。
  - `UsageStatusAlert` 删除“授权过期/重新授权”；只保留 Token 无效、权限不足、账号缺失、配置入口。
  - 用量页只保留一个刷新入口。
- `src/locales/zh-CN.ts` / `en.ts`
  - 同步 Token、固定权限、配额来源、错误文案。
  - 用户明确说现有若干文案诡异；通读修改，不保留重复解释和错位卡片。
- `src/content/help.*.md`
  - 加二进制服务器/库服务器指南，删除旧 Cloudflare OAuth FAQ。

### GitHub Actions / 原生

- 现有：
  - `.github/workflows/platform-ci.yml`：web + native tests，native 只按路径触发。
  - `.github/workflows/release.yml`：tag/release，构建可执行程序。
- 新增手动 workflow；必要时调整 `native-server/CMakeLists.txt` 的 target/options。
- 不要破坏现有 `native-ui:smoke`、ctest 和 release。

## 4. 必须补/改的测试

- ✅ `worker/runtime/cloudflare-settings.test.ts`：stub verify/accounts/subscriptions，覆盖空配置、固定权限、合法保存、无明文/无回显、缓存失效、401/403/409/503、旧 OAuth 密文、DELETE 零外呼；当前 6/6 通过。
- ✅ `worker/runtime/cloudflare-token.test.ts`：Token 校验、账号分页/唯一性、订阅 Free 判定、稳定错误和密文存取；当前 8/8 通过。
- 🔴 `worker/runtime/analytics.test.ts`：不 PUT `cloudflareQuotas`；未配置不得访问外部 API/读缓存；缓存检查发生在凭据检查之后；配置 Token 后 Analytics 成功与缓存；订阅非 Free 时 `limits=null`，Free 确认后返回 8 项基线。当前 1/5 通过。
- 🔴 `worker/runtime/outbound-stub.ts`：verify/accounts/subscriptions stub 已补，但仍混有旧 OAuth token/revoke stub；Token 迁移完成后删除旧分支。
- 🔴 `worker/cloudflare-usage.smoke.ts`：覆盖 8 项额度、次数和百分比来源。
- 🔴 `worker/cloudflare-oauth*.smoke.ts`：删除或改造成 Token/设置/用量 smoke；当前旧 smoke 已实测失败。
- 🔴 `worker/oauth-settings.smoke.ts`：只验证 GitHub，不再输出 Cloudflare 协议字段。
- 🔴 `tests/console-worker.spec.ts`：Token 表单、固定权限、错误留在设置页、不出现 PKCE/response_type/offline_access；刷新入口去重。
- 🔴 `tests/console-real-stack.spec.ts`：删除 `cloudflareQuotas` PUT/恢复断言，改成平台阈值 + 只读官方额度。
- 🔴 新增 workflow 测试或至少 workflow lint/手动 dispatch 验证。

清理搜索必须最终无命中（或只剩解释性历史迁移代码）：

```bash
rg -n "offline_access|workers-platform\.read|response_type|grant_type|PKCE|cloudflareQuotas|auth_error|Setup is not available" worker/src src tests README.md docs
```

## 5. 推荐实施顺序

1. **当前恢复点**：保留 5 个 UI 草稿和 5 个设置组文件；先只提交/推送本 HANDOFF 文档，禁止夹带代码。
2. ✅ **Token 基础与设置 API**：基础模块、设置路由和定向测试已完成；等待与用量一起提交。
3. 🔴 **解除当前阻塞**：重写 `cloudflareUsageApi`，用 `readStoredCloudflareCredential` 读取 Token；未配置立即返回，先凭据后缓存；删除 refresh/`authorizationExpired`；让 analytics 5/5 和完整 runtime 89/89 通过。
4. **移除 OAuth 全链路**：删除 `/auth/cloudflare/*`、auth-result Cookie、Cloudflare OAuth 配置、refresh/revoke、scheduled state 清理；把 `oauth-settings.ts` 收缩为仅 GitHub。
5. **只读额度**：从 `PlatformSettings`/`platformSettingsApi`/`usage.ts` 删除 `cloudflareQuotas`；usage 从 subscriptions 得到 `plan`/`limitSource`/`limits`；只有确认 Free 才给 8 项基线。
6. **前端 Token 化**：Token 表单、固定三项权限、创建 Token 直达链接、HTTP 错误留在设置页；删除所有 OAuth/PKCE/response_type/grant_type 文案。
7. **UI 品质清理**：8 项次数/百分比、平台/Cloudflare 分组、单一刷新入口、重复卡片/跳转、异常文案、图标对齐，双主题 × 桌面/平板/手机实际检查。
8. **部署链路**：确认 Workers Builds Deploy command 是 `npm run deploy`；验证 migrations 无 pending；复查 `no such table: workspaces`。
9. **原生手动构建**：CMake 可执行/共享库开关 + 仅 `workflow_dispatch` workflow + artifact/SHA256。
10. **帮助文档**：中英文二进制服务器/库服务器教程；同步 README、验收矩阵、local-e2e。
11. **完整验收、提交、推送、盯 Actions**：只有 runtime、smoke、CI 全绿才推代码；推送后查到最新 run 成功。

## 6. 本地验收与推送流程

推送前必须执行完整本地 CI：

```bash
npm run ci:local
```

**当前（2026-10-23 18:20）不得直接执行后推送代码组**：`npm run worker:runtime-test` 当前 85/89，`npm run worker:cloudflare-oauth-smoke` 当前失败，说明 Cloudflare 设置/用量契约尚未统一。先完成第 5 节第 3–5 步，再跑完整链路。仅修改本 HANDOFF 的文档提交可按文档流程单独提交。

涉及 Worker 运行时或 Cloudflare 时还必须：

```bash
npm run worker:runtime-test
npm run deploy:worker:test
```

涉及 native/CMake 时还必须：

```bash
cmake -S native-server -B native-server/build -DCMAKE_BUILD_TYPE=Release
cmake --build native-server/build --parallel
ctest --test-dir native-server/build --output-on-failure
```

推送要求：
- 不要把未验证的代码直接推 `main`。
- 提交信息按逻辑拆分，例如：
  1. `refactor(ui): 完成登录、侧栏、账号与工作区组件化`（已实现，登录页仅剩视觉检查）
  2. `feat(cloudflare): 迁移到 API Token 并移除 OAuth 配置`
  3. `feat(usage): 从 Cloudflare 订阅读取免费额度并展示百分比`
  4. `ci(native): 增加可执行文件与库文件手动构建`
  5. `docs(help): 补充二进制插件服务器与库文件部署说明`
- 推送后不能只看“已 push”：必须查 workflow 到完成；失败就拉日志继续修。
- 当前宿主 GLIBC 2.31 低于 `@cloudflare/workerd-linux-64` 要求；本地 runtime 测试使用 `docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD:/workspace" -w /workspace node:22-bookworm npx vitest run --config vitest.workers.config.ts ...`，不要因为 workerd 启动报 GLIBC 缺失而误判测试失败。
- 当前无 `gh` 时，可用：

```bash
curl -fsSL 'https://api.github.com/repos/shelter-red/plugin-platform/actions/runs?per_page=10'
```

需要完整日志时安装/配置 `gh`，或使用带认证的 GitHub API。

## 7. 最终验收清单

- [ ] 登录页实际视觉检查通过，组件结构保留且没有旧页面残留。
- [ ] 侧栏“默认工作区”文字不遮挡，图标/文字对齐。
- [ ] 系统设置只出现 Cloudflare API Token 和可选 Account ID，不出现任何 OAuth 客户端字段。
- [ ] 权限固定为 Account Settings Read / Account Analytics Read / Billing Read，只读不可取消。
- [ ] “创建 Token”跳到 `https://dash.cloudflare.com/profile/api-tokens`。
- [ ] Token 保存前 verify、账号发现、subscriptions 校验全部完成；失败用 HTTP 状态并在当前面板显示。
- [ ] 不再出现 `auth_error`、`offline_access`、`workers-platform.read`、PKCE、`response_type`、`grant_type` 等旧内容。
- [ ] setup 返回 null 时与其他非路由行为一致，没有 “Setup is not available”。
- [ ] 未配置 Cloudflare 时 `/api/usage/cloudflare` 返回 `{"configured":false,"cached":false}`，无外部请求，无旧缓存命中；`/api/usage/local` 仍 200。
- [ ] Cloudflare 免费额度从 subscriptions 读取，只有确认 Free 才显示官方基线；不可确认显示未读取。
- [ ] Worker、D1 行读/行写、KV 读/写/删/列表、DO 请求共 8 项均显示次数和百分比。
- [ ] 平台统计与 Cloudflare 额度分组；平台请求不设上限。
- [ ] 设置页无手填 Cloudflare 免费额度。
- [ ] 用量页只有一个刷新入口；概览无同目的重复按钮；异常文案/空卡片已清理。
- [ ] 生产部署应用 0008 及全部 migrations，`workspaces` 表存在，`npm run deploy` 是 Workers Builds 实际部署入口。
- [ ] 手动 Actions 可选可执行程序/库文件、目标平台，并上传 artifact + SHA256。
- [ ] 帮助中心中英文都有二进制插件服务器与库文件插件的完整使用说明。
- [ ] `npm run ci:local`、Worker runtime tests、deploy test、native ctest 全部通过。
- [ ] 推送后 Actions 完成且成功；失败已定位、修复并重新验证。

## 8. 已知风险与边界

- Cloudflare API Token 长期有效不等于永久有效：用户可撤销、Token 可被策略阻止、账号权限可变，因此运行时要稳定处理 401/403；但不要把它描述成 OAuth 自然过期。
- 官方 subscriptions 方法文档已确认接受 `Billing Read`；实际账号仍可能出现 401/403/404，必须区分 Token 无效、权限不足、账号不可见和上游错误，不能统一报“授权过期”。
- 免费基线是官方公布值，可能随 Cloudflare 政策变化；只有在订阅明确为 Free 时展示，最好在 UI 标注核对日期和数据来源。
- 账号发现与多账号场景要避免猜测：无法唯一确定且用户未填 Account ID 时返回 409，不要随便选第一个账号。
- 迁移旧 OAuth 密文只能用于识别和提示重新录入，不能继续 refresh/revoke。
- 旧的 `cloudflare_oauth_states`、usage cache、环境变量和 README 可能残留；实现后逐项搜索清理。
- 不要为了“组件化”把所有东西拆成无意义小组件；组件边界应能独立命名、测试和理解。
