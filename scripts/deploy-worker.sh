#!/usr/bin/env bash
# 一键部署 Cloudflare Worker：构建管理端、补齐 D1/R2 资源、执行迁移、写入密钥并发布。
# 只调用官方 wrangler 子命令，不重复实现 Cloudflare API。
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

CONFIG=worker/wrangler.toml
DB_NAME=plugmesh
BUCKET_NAME=plugmesh-blobs
DRY_RUN=0
SKIP_BUILD=0

usage() {
  cat <<'EOF'
用法：npm run deploy:worker [-- 选项]
  --dry-run     只构建并校验 bundle，不创建资源、不写密钥、不发布
  --skip-build  复用已有 dist，不重新构建管理端
  -h, --help    显示本帮助

环境变量：
  CLOUDFLARE_API_TOKEN   非交互部署所需的 API Token（Workers / D1 / R2 编辑权限）
  CLOUDFLARE_ACCOUNT_ID  账号多于一个时必填
  SESSION_SECRET / GITHUB_CLIENT_SECRET / CLOUDFLARE_OAUTH_CLIENT_SECRET
                         存在时自动写入同名 Worker Secret
EOF
}

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数：$arg" >&2; usage >&2; exit 2 ;;
  esac
done

wrangler() { ./node_modules/.bin/wrangler "$@"; }
fail() { echo "部署失败：$*" >&2; exit 1; }

[[ -x node_modules/.bin/wrangler ]] || fail "未找到 wrangler，请先执行 npm install"

read_database_id() {
  node -e 'const m = require("node:fs").readFileSync(process.argv[1], "utf8").match(/^database_id = "([^"]*)"/m); process.stdout.write(m ? m[1] : "")' "$CONFIG"
}

write_database_id() {
  node -e 'const fs = require("node:fs"); const id = process.argv[2]; fs.writeFileSync(process.argv[1], fs.readFileSync(process.argv[1], "utf8").replace(/^database_id = "[^"]*"$/m, `database_id = "${id}"`))' "$CONFIG" "$1"
}

find_database_id() {
  local listed
  listed=$(wrangler d1 list --json) || fail "无法读取 D1 列表，请先 npx wrangler login 或设置 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID"
  printf '%s' "$listed" | node -e 'let raw = ""; process.stdin.on("data", (chunk) => raw += chunk).on("end", () => { const found = JSON.parse(raw).find((db) => db.name === process.argv[1]); process.stdout.write(found ? found.uuid : "") })' "$DB_NAME"
}

echo "==> 构建管理端静态资源"
if [[ $SKIP_BUILD -eq 1 ]]; then
  echo "    已跳过（--skip-build）"
else
  npm run build
fi

if [[ $DRY_RUN -eq 1 ]]; then
  echo "==> 校验 Worker bundle（dry-run，不写入 Cloudflare）"
  wrangler deploy --config "$CONFIG" --dry-run
  echo "dry-run 通过：未创建资源、未写入密钥、未发布。"
  exit 0
fi

echo "==> 准备 D1 数据库 $DB_NAME"
database_id=$(read_database_id)
if [[ -z "$database_id" || "$database_id" == replace-with-* ]]; then
  database_id=$(find_database_id)
  if [[ -z "$database_id" ]]; then
    wrangler d1 create "$DB_NAME"
    database_id=$(find_database_id)
  fi
  [[ -n "$database_id" ]] || fail "无法创建或复用 D1 数据库 $DB_NAME"
  write_database_id "$database_id"
  echo "    已写入 ${CONFIG}：database_id = $database_id"
else
  echo "    复用 ${CONFIG} 中已有 database_id = $database_id"
fi

echo "==> 准备 R2 存储桶 $BUCKET_NAME"
if wrangler r2 bucket list | grep -q "$BUCKET_NAME"; then
  echo "    已存在，跳过创建"
else
  wrangler r2 bucket create "$BUCKET_NAME"
fi

echo "==> 应用远端 D1 迁移"
wrangler d1 migrations apply "$DB_NAME" --remote --config "$CONFIG"

for secret in SESSION_SECRET GITHUB_CLIENT_SECRET CLOUDFLARE_OAUTH_CLIENT_SECRET; do
  value="${!secret:-}"
  if [[ -n "$value" ]]; then
    echo "==> 写入 Worker Secret $secret"
    printf '%s' "$value" | wrangler secret put "$secret" --config "$CONFIG"
  fi
done

echo "==> 发布 Worker"
wrangler deploy --config "$CONFIG"

cat <<'EOF'

部署完成。后续只需在 Cloudflare 控制台或 CI 中一次性配置：
  - 路由：console.example.com/*（管理端、管理 API、OAuth 回调）
  - 路由：*.plugins.example.com/*（插件公开入口）
  - 变量：GITHUB_CLIENT_ID / GITHUB_REDIRECT_URI / GITHUB_ALLOWLIST /
          CLOUDFLARE_OAUTH_CLIENT_ID / CLOUDFLARE_OAUTH_REDIRECT_URI
  - Secret：SESSION_SECRET、GITHUB_CLIENT_SECRET、CLOUDFLARE_OAUTH_CLIENT_SECRET（可在部署时用环境变量传入自动写入）
EOF
