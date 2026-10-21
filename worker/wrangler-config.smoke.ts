import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const config = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8')
const assetsSection = config.split(/^\[assets\]$/m)[1]?.split(/^\[/m)[0]
assert.ok(assetsSection, 'wrangler.toml must declare an [assets] section')
assert.match(assetsSection, /^directory\s*=\s*"\.\/dist"$/m)
assert.match(assetsSection, /^binding\s*=\s*"ASSETS"$/m)
assert.match(assetsSection, /^not_found_handling\s*=\s*"single-page-application"$/m)
assert.match(assetsSection, /^run_worker_first\s*=\s*true$/m, 'plugin hostnames must reach the Worker before static assets')

console.log('wrangler config smoke test passed')
