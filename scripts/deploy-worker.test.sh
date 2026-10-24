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
  'd1 migrations list '*)
    if [[ -f "$state/pending-migration" ]]; then
      printf 'Migrations to be applied:\n│ 0009_pending.sql │\n'
    else
      printf '✅ No migrations to apply!\n'
    fi
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
session_secret=$(cat "$TMP/state/secret_SESSION_SECRET")
[[ ${#session_secret} -ge 24 ]]
[[ "$first_output" != *"$session_secret"* ]]
[[ "$first_output" == *'在初始化页设置至少 12 个字符的管理员密码'* ]]
[[ "$first_output" != *'再在 Cloudflare 配置一次 DNS / Worker Route'* ]]
[[ "$first_output" != *'SETUP_TOKEN'* ]]
grep -q 'test-database-id' "$TMP/wrangler.toml"
[[ $(grep -c '^database_id = ' "$TMP/wrangler.toml") -eq 1 ]]
! grep -Eq 'GITHUB|CLOUDFLARE_OAUTH|SETUP_TOKEN|SMTP' "$TMP/state/puts.log"
printf 'ok：首次部署生成基础设施密钥，且不输出明文\n'

for deploy_file in scripts/deploy-worker.sh wrangler.toml .github/workflows/platform-ci.yml .github/workflows/release.yml; do
  ! grep -Eq '^(GITHUB_CLIENT|CLOUDFLARE_OAUTH_CLIENT|SMTP_|PLUGIN_DOMAIN_SUFFIX)[A-Z_]*[[:space:]]*[:=]' "$ROOT/$deploy_file"
done
printf 'ok：部署脚本、Wrangler 配置和 CI 均不包含登录、Cloudflare 业务凭据、SMTP 或插件域名后缀配置\n'

node - "$ROOT" <<'NODE'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = process.argv[2]
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
assert.equal(pkg.scripts.deploy, 'bash scripts/deploy-worker.sh')
assert.equal(pkg.cloudflare, undefined, '部署页不应通过 package.json.cloudflare.bindings 追加输入项')
assert.equal(fs.existsSync(path.join(root, '.dev.vars.example')), false, '不应添加会出现在部署页的 .dev.vars.example')
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8')
for (const marker of [
  '[![Deploy to Cloudflare]',
  'https://deploy.workers.cloudflare.com/?url=https://github.com/shelter-red/plugin-platform',
  '唯一部署必填项：连接 Cloudflare Workers Builds 账号',
  '`npm run build`',
  '`npm run deploy`',
  '不要填写任何业务变量',
  '首次访问 `/setup` 设置管理员密码',
]) assert.ok(readme.includes(marker), `README 缺少最小部署约束：${marker}`)
assert.ok(!readme.includes('OWNER/REPO'), 'README 仍包含未替换的仓库占位符')
NODE
printf 'ok：README 与 package.json 锁定 Cloudflare Workers Builds 账号连接，且不声明额外输入项\n'

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

printf '[{"name":"SESSION_SECRET"}]\n' > "$TMP/state/secrets.json"
cp "$TMP/state/secret_SESSION_SECRET" "$TMP/session-before"
: > "$TMP/state/puts.log"
second_output=$(run_deploy env SESSION_SECRET='this-override-must-not-rotate-session-secret' 2>&1)
cmp -s "$TMP/state/secret_SESSION_SECRET" "$TMP/session-before"
[[ ! -s "$TMP/state/puts.log" ]]
[[ "$second_output" == *'SESSION_SECRET 已存在，保持原值'* ]]
printf 'ok：已有密钥不被环境变量或重跑覆盖\n'

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
! grep -Fxq 'SETUP_TOKEN' "$TMP/state-cloud/puts.log"
[[ "$cloud_output" == *'首次发布 Worker plugmesh-worker（触发 D1 / R2 自动创建并绑定）'* ]]
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

mkdir -p "$TMP/state-drift"
cp "$ROOT/wrangler.toml" "$TMP/wrangler.toml"
node -e 'const fs = require("node:fs"); const path = process.argv[1]; const text = fs.readFileSync(path, "utf8").replace(/^(database_name = "plugmesh"\n)/m, "$1database_id = \"existing-database-id\"\n"); fs.writeFileSync(path, text)' "$TMP/wrangler.toml"
printf '[]\n' > "$TMP/state-drift/secrets.json"
touch "$TMP/state-drift/pending-migration"
if drift_output=$(cd "$TMP" && \
  env -u CLOUDFLARE_API_TOKEN \
  WORKERS_CI=1 \
  WRANGLER_BIN="$TMP/fake-wrangler" \
  FAKE_STATE="$TMP/state-drift" \
  PATH="$TMP/bin:$PATH" \
  NPM_LOG="$TMP/npm.log" \
  FAKE_ROOT="$TMP" \
  ./scripts/deploy-worker.sh 2>&1); then
  echo '预期迁移遗留时部署失败，但脚本成功退出' >&2
  exit 1
fi
[[ "$drift_output" == *'仍有 1 个待应用 migration'* ]]
! grep -Fxq 'deploy --config wrangler.toml --x-provision' "$TMP/state-drift/commands.log"
printf 'ok：远端 D1 迁移未全部应用时拒绝发布并提示原因\n'
