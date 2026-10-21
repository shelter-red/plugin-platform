#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/scripts" "$TMP/worker" "$TMP/state"
cp "$ROOT/scripts/deploy-worker.sh" "$TMP/scripts/"
cp "$ROOT/worker/wrangler.toml" "$TMP/worker/"

cat > "$TMP/fake-wrangler" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
state=$FAKE_STATE
printf '%s\n' "$*" >> "$state/commands.log"
case "$*" in
  whoami)
    ;;
  'd1 list --json')
    printf '[{"name":"plugmesh","uuid":"test-database-id"}]\n'
    ;;
  'r2 bucket list')
    printf 'name\nplugmesh-blobs\n'
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

run_deploy() {
  (cd "$TMP" && \
    CLOUDFLARE_API_TOKEN=test-token \
    WRANGLER_BIN="$TMP/fake-wrangler" \
    FAKE_STATE="$TMP/state" \
    "$@" ./scripts/deploy-worker.sh --skip-build)
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
grep -q 'test-database-id' "$TMP/worker/wrangler.toml"
[[ $(grep -c '^database_id = ' "$TMP/worker/wrangler.toml") -eq 1 ]]
! grep -Eq 'GITHUB|CLOUDFLARE_OAUTH|SMTP' "$TMP/state/puts.log"
printf 'ok：首次部署生成基础设施密钥，且不输出明文\n'

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
printf '[]\n' > "$TMP/state-cloud/secrets.json"
cloud_output=$(cd "$TMP" && \
  env -u CLOUDFLARE_API_TOKEN \
  WORKERS_CI=1 \
  WRANGLER_BIN="$TMP/fake-wrangler" \
  FAKE_STATE="$TMP/state-cloud" \
  ./scripts/deploy-worker.sh)
grep -Fxq 'd1 migrations apply DB --remote --config worker/wrangler.toml' "$TMP/state-cloud/commands.log"
grep -Fxq 'deploy --config worker/wrangler.toml' "$TMP/state-cloud/commands.log"
! grep -Eq '^(whoami|d1 create|r2 bucket)' "$TMP/state-cloud/commands.log"
grep -Fxq 'SESSION_SECRET' "$TMP/state-cloud/puts.log"
grep -Fxq 'SETUP_TOKEN' "$TMP/state-cloud/puts.log"
[[ "$cloud_output" == *'Cloudflare Workers Builds 初始化令牌：'* ]]
printf 'ok：Workers Builds 无需 API Token，跳过资源创建并在构建日志提供初始化令牌\n'
