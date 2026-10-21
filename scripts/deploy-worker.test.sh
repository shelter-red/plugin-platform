#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/scripts" "$TMP/worker" "$TMP/state" "$TMP/bin"
cp "$ROOT/scripts/deploy-worker.sh" "$TMP/scripts/"
cp "$ROOT/wrangler.toml" "$TMP/wrangler.toml"

cat > "$TMP/bin/npm" <<'FAKE_NPM'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$NPM_LOG"
if [[ "$*" == 'run build' ]]; then
  mkdir -p "$FAKE_ROOT/dist"
  printf '<!doctype html>\n' > "$FAKE_ROOT/dist/index.html"
fi
FAKE_NPM
chmod +x "$TMP/bin/npm"

cat > "$TMP/fake-wrangler" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
state=$FAKE_STATE
printf '%s\n' "$*" >> "$state/commands.log"
case "$*" in
  whoami)
    ;;
  'd1 list --json')
    if [[ -f "$state/d1-empty" && ! -f "$state/d1-created" ]]; then
      printf '[]\n'
    else
      printf '[{"name":"plugmesh","uuid":"test-database-id"}]\n'
    fi
    ;;
  'd1 create plugmesh')
    touch "$state/d1-created"
    ;;
  'r2 bucket list')
    if [[ -f "$state/r2-empty" && ! -f "$state/r2-created" ]]; then
      printf 'name\n'
    else
      printf 'name\nplugmesh-blobs\n'
    fi
    ;;
  'r2 bucket create plugmesh-blobs')
    touch "$state/r2-created"
    ;;
  'd1 migrations apply '*)
    ;;
  'deploy '*)
    ;;
  'secret list '*)
    cat "$state/secrets.json"
    ;;
  'secret put '*)
    printf '%s\n' "$3" >> "$state/puts.log"
    cat > "$state/secret_$3"
    ;;
  *)
    echo "unexpected fake wrangler command: $*" >&2
    exit 1
    ;;
esac
FAKE
chmod +x "$TMP/fake-wrangler"

run_deploy_with_state() {
  local state=$1
  shift
  (cd "$TMP" && \
    CLOUDFLARE_API_TOKEN=test-token \
    WRANGLER_BIN="$TMP/fake-wrangler" \
    FAKE_STATE="$state" \
    PATH="$TMP/bin:$PATH" \
    NPM_LOG="$TMP/npm.log" \
    FAKE_ROOT="$TMP" \
    "$@" ./scripts/deploy-worker.sh --skip-build)
}

run_deploy() {
  run_deploy_with_state "$TMP/state" "$@"
}

printf '[]\n' > "$TMP/state/secrets.json"

first_output=$(run_deploy env)
[[ -s "$TMP/state/secret_SESSION_SECRET" ]]
[[ -s "$TMP/state/secret_SETUP_TOKEN" ]]
session_secret=$(cat "$TMP/state/secret_SESSION_SECRET")
setup_token=$(cat "$TMP/state/secret_SETUP_TOKEN")
[[ ${#session_secret} -ge 24 ]]
[[ ${#setup_token} -ge 24 ]]
[[ $(tr -d '\n' < "$TMP/.wrangler/plugmesh-setup-token") == "$setup_token" ]]
[[ $(stat -c %a "$TMP/.wrangler/plugmesh-setup-token") == 600 ]]
[[ "$first_output" != *"$session_secret"* ]]
[[ "$first_output" != *"$setup_token"* ]]
grep -q 'test-database-id' "$TMP/wrangler.toml"
[[ $(grep -c '^database_id = ' "$TMP/wrangler.toml") -eq 1 ]]
! grep -Eq 'GITHUB|CLOUDFLARE_OAUTH|SMTP' "$TMP/state/puts.log"
printf 'ok：首次部署生成基础设施密钥，且不输出明文\n'

for deploy_file in scripts/deploy-worker.sh wrangler.toml .github/workflows/deploy.yml; do
  ! grep -Eq '^(GITHUB_CLIENT|CLOUDFLARE_OAUTH_CLIENT|SMTP_|PLUGIN_DOMAIN_SUFFIX)[A-Z_]*[[:space:]]*[:=]' "$ROOT/$deploy_file"
done
printf 'ok：部署脚本、Wrangler 配置和 CI 均不包含 OAuth、SMTP 或插件域名后缀业务配置\n'

mkdir -p "$TMP/state-local-fresh"
cp "$ROOT/wrangler.toml" "$TMP/wrangler.toml"
printf '[]\n' > "$TMP/state-local-fresh/secrets.json"
touch "$TMP/state-local-fresh/d1-empty" "$TMP/state-local-fresh/r2-empty"
fresh_output=$(run_deploy_with_state "$TMP/state-local-fresh" env)
grep -Fxq 'd1 create plugmesh' "$TMP/state-local-fresh/commands.log"
grep -Fxq 'r2 bucket create plugmesh-blobs' "$TMP/state-local-fresh/commands.log"
grep -q 'test-database-id' "$TMP/wrangler.toml"
migration_line=$(grep -nFx 'd1 migrations apply DB --remote --config wrangler.toml' "$TMP/state-local-fresh/commands.log" | cut -d: -f1)
deploy_line=$(grep -nFx 'deploy --config wrangler.toml' "$TMP/state-local-fresh/commands.log" | cut -d: -f1)
[[ $migration_line -lt $deploy_line ]]
[[ $(grep -cFx 'deploy --config wrangler.toml' "$TMP/state-local-fresh/commands.log") -eq 1 ]]
[[ "$fresh_output" == *'准备 D1 数据库 plugmesh'* ]]
[[ "$fresh_output" == *'准备 R2 存储桶 plugmesh-blobs'* ]]
printf 'ok：本地首次部署自动创建 D1/R2、回填 ID、迁移后发布\n'

printf '[{"name":"SESSION_SECRET"},{"name":"SETUP_TOKEN"}]\n' > "$TMP/state/secrets.json"
cp "$TMP/state/secret_SESSION_SECRET" "$TMP/session-before"
cp "$TMP/state/secret_SETUP_TOKEN" "$TMP/setup-before"
: > "$TMP/state/puts.log"
rm "$TMP/.wrangler/plugmesh-setup-token"
second_output=$(run_deploy env SESSION_SECRET='this-override-must-not-rotate-session-secret' 2>&1)
cmp -s "$TMP/state/secret_SESSION_SECRET" "$TMP/session-before"
cmp -s "$TMP/state/secret_SETUP_TOKEN" "$TMP/setup-before"
[[ ! -s "$TMP/state/puts.log" ]]
[[ "$second_output" == *'SESSION_SECRET 已存在，保持原值'* ]]
[[ "$second_output" == *'远端已有 SETUP_TOKEN'* ]]
printf 'ok：已有密钥不被环境变量或重跑覆盖\n'

reset_token='0123456789abcdef01234567'
reset_output=$(run_deploy env SETUP_TOKEN="$reset_token")
[[ $(cat "$TMP/state/secret_SETUP_TOKEN") == "$reset_token" ]]
[[ $(tr -d '\n' < "$TMP/.wrangler/plugmesh-setup-token") == "$reset_token" ]]
[[ $(grep -c '^SETUP_TOKEN$' "$TMP/state/puts.log") -eq 1 ]]
[[ "$reset_output" == *'已按显式 SETUP_TOKEN 重置初始化令牌'* ]]
printf 'ok：显式 SETUP_TOKEN 可安全重置并更新本地文件\n'

mkdir -p "$TMP/state-cloud"
cp "$ROOT/wrangler.toml" "$TMP/wrangler.toml"
printf '[]\n' > "$TMP/state-cloud/secrets.json"
: > "$TMP/npm.log"
cloud_output=$(cd "$TMP" && \
  env -u CLOUDFLARE_API_TOKEN \
  WORKERS_CI=1 \
  WRANGLER_BIN="$TMP/fake-wrangler" \
  FAKE_STATE="$TMP/state-cloud" \
  PATH="$TMP/bin:$PATH" \
  NPM_LOG="$TMP/npm.log" \
  FAKE_ROOT="$TMP" \
  ./scripts/deploy-worker.sh)
grep -Fxq 'run build' "$TMP/npm.log"
grep -Fxq 'deploy --config wrangler.toml --x-provision' "$TMP/state-cloud/commands.log"
grep -Fxq 'd1 migrations apply DB --remote --config wrangler.toml' "$TMP/state-cloud/commands.log"
deploy_line=$(grep -nFx 'deploy --config wrangler.toml --x-provision' "$TMP/state-cloud/commands.log" | cut -d: -f1)
migration_line=$(grep -nFx 'd1 migrations apply DB --remote --config wrangler.toml' "$TMP/state-cloud/commands.log" | cut -d: -f1)
[[ $deploy_line -lt $migration_line ]]
[[ $(grep -cFx 'deploy --config wrangler.toml --x-provision' "$TMP/state-cloud/commands.log") -eq 1 ]]
! grep -Eq '^(whoami|d1 create|r2 bucket)' "$TMP/state-cloud/commands.log"
grep -Fxq 'SESSION_SECRET' "$TMP/state-cloud/puts.log"
grep -Fxq 'SETUP_TOKEN' "$TMP/state-cloud/puts.log"
[[ "$cloud_output" == *'首次发布 Worker plugmesh-worker（触发 D1 / R2 自动创建并绑定）'* ]]
[[ "$cloud_output" == *'Cloudflare Workers Builds 初始化令牌：'* ]]
printf 'ok：Workers Builds 缺少 dist 时先构建，并自动创建资源、迁移、生成密钥\n'

mkdir -p "$TMP/state-cloud-prebuilt"
cp "$ROOT/wrangler.toml" "$TMP/wrangler.toml"
printf '[]\n' > "$TMP/state-cloud-prebuilt/secrets.json"
mkdir -p "$TMP/dist"
printf '<!doctype html>\n' > "$TMP/dist/index.html"
: > "$TMP/npm.log"
prebuilt_output=$(cd "$TMP" && \
  env -u CLOUDFLARE_API_TOKEN \
  WORKERS_CI=1 \
  WRANGLER_BIN="$TMP/fake-wrangler" \
  FAKE_STATE="$TMP/state-cloud-prebuilt" \
  PATH="$TMP/bin:$PATH" \
  NPM_LOG="$TMP/npm.log" \
  FAKE_ROOT="$TMP" \
  ./scripts/deploy-worker.sh)
[[ ! -s "$TMP/npm.log" ]]
grep -Fxq 'deploy --config wrangler.toml --x-provision' "$TMP/state-cloud-prebuilt/commands.log"
[[ "$prebuilt_output" == *'Workers Builds 已执行项目 build，跳过重复构建'* ]]
printf 'ok：Workers Builds 已构建 dist 时不重复构建\n'

mkdir -p "$TMP/state-cloud-existing"
cp "$ROOT/wrangler.toml" "$TMP/wrangler.toml"
node -e 'const fs = require("node:fs"); const path = process.argv[1]; const text = fs.readFileSync(path, "utf8").replace(/^(database_name = "plugmesh"\n)/m, "$1database_id = \"existing-database-id\"\n"); fs.writeFileSync(path, text)' "$TMP/wrangler.toml"
printf '[]\n' > "$TMP/state-cloud-existing/secrets.json"
existing_output=$(cd "$TMP" && \
  env -u CLOUDFLARE_API_TOKEN \
  WORKERS_CI=1 \
  WRANGLER_BIN="$TMP/fake-wrangler" \
  FAKE_STATE="$TMP/state-cloud-existing" \
  PATH="$TMP/bin:$PATH" \
  NPM_LOG="$TMP/npm.log" \
  FAKE_ROOT="$TMP" \
  ./scripts/deploy-worker.sh)
grep -Fxq 'd1 migrations apply DB --remote --config wrangler.toml' "$TMP/state-cloud-existing/commands.log"
grep -Fxq 'deploy --config wrangler.toml --x-provision' "$TMP/state-cloud-existing/commands.log"
migration_line=$(grep -nFx 'd1 migrations apply DB --remote --config wrangler.toml' "$TMP/state-cloud-existing/commands.log" | cut -d: -f1)
deploy_line=$(grep -nFx 'deploy --config wrangler.toml --x-provision' "$TMP/state-cloud-existing/commands.log" | cut -d: -f1)
[[ $migration_line -lt $deploy_line ]]
[[ $(grep -cFx 'deploy --config wrangler.toml --x-provision' "$TMP/state-cloud-existing/commands.log") -eq 1 ]]
[[ "$existing_output" != *'首次发布 Worker'* ]]
printf 'ok：Workers Builds 已有 D1 ID 时先迁移，再启用资源校验并发布\n'
