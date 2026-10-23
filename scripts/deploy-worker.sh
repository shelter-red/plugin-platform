#!/usr/bin/env bash
# 一键部署 Cloudflare Worker：构建管理端、补齐 D1/R2 资源、执行迁移、初始化基础设施密钥并发布。
# GitHub OAuth、Cloudflare API Token、SMTP 等业务配置不通过环境变量注入，部署完成后在管理后台填写。
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

CONFIG=wrangler.toml
DB_NAME=plugmesh
BUCKET_NAME=plugmesh-blobs
SETUP_TOKEN_FILE=.wrangler/plugmesh-setup-token
DRY_RUN=0
SKIP_BUILD=0
CLOUDFLARE_BUILD=0
if [[ "${WORKERS_CI:-}" == "1" ]]; then
  CLOUDFLARE_BUILD=1
fi

usage() {
  cat <<'USAGE'
用法：npm run deploy [-- 选项]
  --dry-run     只构建并校验 bundle，不访问云端、不写密钥、不发布
  --skip-build  复用已有 dist，不重新构建管理端
  --cloudflare-builds
                按 Cloudflare Workers Builds 方式部署；WORKERS_CI=1 时自动启用
  -h, --help    显示本帮助

基础配置（真实部署必填）：
  CLOUDFLARE_API_TOKEN    Cloudflare API Token，需 Workers Scripts、D1、R2 编辑权限
  CLOUDFLARE_ACCOUNT_ID   可选；账号多于一个时填写

脚本自动处理：
  - 创建或复用 D1 数据库 plugmesh，并回填 wrangler.toml
  - 创建或复用 R2 存储桶 plugmesh-blobs
  - 应用全部 D1 migrations
  - 首次缺失时生成 SESSION_SECRET（已有值绝不轮换）
  - 首次缺失时生成 SETUP_TOKEN，并保存到 .wrangler/plugmesh-setup-token（0600）
  - 发布 Worker

高级覆盖（通常不需要）：
  SESSION_SECRET   远端缺失时使用指定值；远端已有时不会覆盖
  SETUP_TOKEN      显式重置一次性初始化令牌；会写入并更新本地令牌文件
USAGE
}

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    --cloudflare-builds) CLOUDFLARE_BUILD=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数：$arg" >&2; usage >&2; exit 2 ;;
  esac
done

WRANGLER_BIN=${WRANGLER_BIN:-./node_modules/.bin/wrangler}
wrangler() { "$WRANGLER_BIN" "$@"; }
fail() { echo "部署失败：$*" >&2; exit 1; }
random_secret() { node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))'; }

[[ -x "$WRANGLER_BIN" ]] || fail "未找到 wrangler，请先执行 npm install"
[[ -f "$CONFIG" ]] || fail "缺少 $CONFIG"

read_worker_name() {
  node -e 'const m = require("node:fs").readFileSync(process.argv[1], "utf8").match(/^name = "([^"]+)"/m); process.stdout.write(m ? m[1] : "")' "$CONFIG"
}

read_database_id() {
  node -e 'const m = require("node:fs").readFileSync(process.argv[1], "utf8").match(/^database_id = "([^"]*)"/m); process.stdout.write(m ? m[1] : "")' "$CONFIG"
}

write_database_id() {
  node -e 'const fs = require("node:fs"); const id = process.argv[2]; const path = process.argv[1]; const line = `database_id = "${id}"`; let text = fs.readFileSync(path, "utf8"); if (/^database_id = "[^"]*"$/m.test(text)) text = text.replace(/^database_id = "[^"]*"$/m, line); else text = text.replace(/^(database_name = "plugmesh"\n)/m, `$1${line}\n`); fs.writeFileSync(path, text)' "$CONFIG" "$1"
}

find_database_id() {
  local listed
  listed=$(wrangler d1 list --json) || fail "无法读取 D1 列表，请检查 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID"
  printf '%s' "$listed" | node -e 'let raw = ""; process.stdin.on("data", (chunk) => raw += chunk).on("end", () => { const found = JSON.parse(raw).find((db) => db.name === process.argv[1]); process.stdout.write(found ? found.uuid : "") })' "$DB_NAME"
}

load_secret_names() {
  local listed
  listed=$(wrangler secret list --config "$CONFIG" --format json) || fail "无法读取 Worker Secret 列表"
  SECRET_NAMES=$(printf '%s' "$listed" | node -e 'let raw = ""; process.stdin.on("data", (chunk) => raw += chunk).on("end", () => { const rows = JSON.parse(raw); process.stdout.write((Array.isArray(rows) ? rows : []).map((row) => row.name).filter(Boolean).join("\n")) })')
}

has_secret() {
  printf '\n%s\n' "$SECRET_NAMES" | grep -Fxq "$1"
}

put_secret() {
  local name=$1 value=$2
  if ! printf '%s' "$value" | wrangler secret put "$name" --config "$CONFIG" >/dev/null; then
    fail "写入 Worker Secret $name 失败"
  fi
}

save_setup_token() {
  umask 077
  mkdir -p "$(dirname "$SETUP_TOKEN_FILE")"
  chmod 700 "$(dirname "$SETUP_TOKEN_FILE")"
  printf '%s\n' "$1" > "$SETUP_TOKEN_FILE.tmp"
  chmod 600 "$SETUP_TOKEN_FILE.tmp"
  mv "$SETUP_TOKEN_FILE.tmp" "$SETUP_TOKEN_FILE"
}

require_secret_length() {
  local name=$1 value=$2
  [[ ${#value} -ge 24 ]] || fail "$name 至少需要 24 个字符"
}

echo "==> 构建管理端静态资源"
if [[ $SKIP_BUILD -eq 1 ]]; then
  echo "    已跳过（--skip-build）"
elif [[ $CLOUDFLARE_BUILD -eq 1 && -s dist/index.html ]]; then
  echo "    Workers Builds 已执行项目 build，跳过重复构建"
else
  [[ $CLOUDFLARE_BUILD -eq 1 ]] && echo "    Workers Builds 未发现有效 dist，执行兜底构建"
  npm run build
fi

if [[ $DRY_RUN -eq 1 ]]; then
  echo "==> 校验 Worker bundle（dry-run，不写入 Cloudflare）"
  wrangler deploy --config "$CONFIG" --dry-run
  echo "dry-run 通过：未创建资源、未写入密钥、未发布。"
  exit 0
fi

WORKER_NAME=$(read_worker_name)
[[ -n "$WORKER_NAME" ]] || fail "无法从 $CONFIG 读取 Worker 名称"

PROVISION_ON_DEPLOY=0
if [[ $CLOUDFLARE_BUILD -eq 1 ]]; then
  echo "==> Cloudflare Workers Builds：使用平台自动创建并绑定的 D1 / R2 资源"
  database_id=$(read_database_id)
  if [[ -z "$database_id" || "$database_id" == replace-with-* ]]; then
    PROVISION_ON_DEPLOY=1
  fi
else
  [[ -n "${CLOUDFLARE_API_TOKEN:-}" ]] || fail "缺少 CLOUDFLARE_API_TOKEN。真实部署只需这一项基础凭据，请先按 README 创建 API Token。"

  echo "==> 验证 Cloudflare 凭据"
  wrangler whoami >/dev/null || fail "Cloudflare 凭据无效，或账号不唯一；请检查 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID"

  echo "==> 准备 D1 数据库 $DB_NAME"
  database_id=$(read_database_id)
  if [[ -z "$database_id" || "$database_id" == replace-with-* ]]; then
    database_id=$(find_database_id)
    if [[ -z "$database_id" ]]; then
      wrangler d1 create "$DB_NAME" >/dev/null
      database_id=$(find_database_id)
    fi
    [[ -n "$database_id" ]] || fail "无法创建或复用 D1 数据库 $DB_NAME"
    write_database_id "$database_id"
    echo "    已写入 ${CONFIG}：database_id = $database_id"
  else
    echo "    复用 ${CONFIG} 中已有 database_id = $database_id"
  fi

  echo "==> 准备 R2 存储桶 $BUCKET_NAME"
  if wrangler r2 bucket list | grep -Eq "(^|[[:space:]])${BUCKET_NAME}([[:space:]]|$)"; then
    echo "    已存在，跳过创建"
  else
    wrangler r2 bucket create "$BUCKET_NAME"
  fi
fi

DEPLOY_ARGS=(--config "$CONFIG")
if [[ $CLOUDFLARE_BUILD -eq 1 ]]; then
  DEPLOY_ARGS+=(--x-provision)
fi

if [[ $PROVISION_ON_DEPLOY -eq 1 ]]; then
  echo "==> 首次发布 Worker $WORKER_NAME（触发 D1 / R2 自动创建并绑定）"
  wrangler deploy "${DEPLOY_ARGS[@]}"
  # 平台创建的 D1 只在发布后才确定 UUID；解析回来写进配置，保证迁移和后续发布都指向同一个库。
  database_id=$(find_database_id || true)
  [[ -n "$database_id" ]] || fail "无法解析 --x-provision 绑定到的 D1 数据库 $DB_NAME，迁移无法执行"
  write_database_id "$database_id"
  echo "    已写入 ${CONFIG}：database_id = $database_id"
fi

echo "==> 应用远端 D1 migrations"
wrangler d1 migrations apply DB --remote --config "$CONFIG"

echo "==> 校验远端 D1 没有遗留 migration"
pending_migrations=$(wrangler d1 migrations list DB --remote --config "$CONFIG" | grep -cE '\.sql' || true)
[[ "$pending_migrations" == "0" ]] || fail "远端 D1 仍有 $pending_migrations 个待应用 migration，已终止发布；请检查 migrations apply 输出后重试"

if [[ $PROVISION_ON_DEPLOY -eq 0 ]]; then
  echo "==> 发布 Worker $WORKER_NAME"
  wrangler deploy "${DEPLOY_ARGS[@]}"
fi

echo "==> 检查基础设施 Secret"
load_secret_names

if has_secret SESSION_SECRET; then
  echo "    SESSION_SECRET 已存在，保持原值（不会轮换）"
else
  session_secret="${SESSION_SECRET:-$(random_secret)}"
  require_secret_length SESSION_SECRET "$session_secret"
  put_secret SESSION_SECRET "$session_secret"
  echo "    已生成并写入 SESSION_SECRET"
fi

if [[ -n "${SETUP_TOKEN:-}" ]]; then
  require_secret_length SETUP_TOKEN "$SETUP_TOKEN"
  put_secret SETUP_TOKEN "$SETUP_TOKEN"
  save_setup_token "$SETUP_TOKEN"
  echo "    已按显式 SETUP_TOKEN 重置初始化令牌"
elif has_secret SETUP_TOKEN; then
  if [[ -f "$SETUP_TOKEN_FILE" ]]; then
    echo "    SETUP_TOKEN 已存在；本地令牌文件：$SETUP_TOKEN_FILE"
  else
    echo "    警告：远端已有 SETUP_TOKEN，但本地令牌文件不存在，为避免破坏初始化流程不会覆盖。" >&2
    echo "    如已确认需要重置：SETUP_TOKEN='新令牌（至少 24 字符）' npm run deploy:worker" >&2
  fi
else
  setup_token=$(random_secret)
  put_secret SETUP_TOKEN "$setup_token"
  save_setup_token "$setup_token"
  echo "    已生成 SETUP_TOKEN，并保存到 $SETUP_TOKEN_FILE（权限 0600）"
  if [[ $CLOUDFLARE_BUILD -eq 1 ]]; then
    echo "    Cloudflare Workers Builds 初始化令牌：$setup_token"
  fi
fi

cat <<'NEXT_STEPS'

部署完成。基础 Cloudflare 资源和 Worker Secret 已就绪。

下一步：
  1. 打开 Cloudflare 提供的默认地址 https://<worker-name>.<workers-subdomain>.workers.dev/setup
     自定义控制台域名和插件通配域名可以稍后再配置。
  2. 初始化令牌来源：
     - 本地 / GitHub Actions：.wrangler/plugmesh-setup-token（Actions 还会写入 Job Summary）
     - Cloudflare Workers Builds：本轮构建日志中的“初始化令牌”一行
  3. 在初始化页填写 GitHub OAuth App 的 Client ID、Client Secret 和管理员白名单。
     回调地址由当前访问域名自动生成，无需手填。
  4. 完成 GitHub 登录后，在管理后台配置 Cloudflare API Token、SMTP、平台阈值和插件域名后缀。

部署阶段不会写入 GitHub OAuth、Cloudflare API Token、SMTP 或插件域名后缀；这些均在后台配置并加密保存。
NEXT_STEPS
