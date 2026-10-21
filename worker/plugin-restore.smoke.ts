import { strict as assert } from 'node:assert'
import { restorePluginState, type PluginCommandResult, type RestorablePluginState } from './src/plugin-restore.ts'

async function run(desiredState: RestorablePluginState, results: PluginCommandResult[]) {
  const commands: string[] = []
  const state = await restorePluginState('sample.plugin', desiredState, async (type, pluginId) => {
    commands.push(`${type}:${pluginId}`)
    return results.shift() ?? { ok: false }
  })
  return { commands, state }
}

assert.deepEqual(await run('loaded', [{ ok: true }]), {
  commands: ['plugin.load:sample.plugin'],
  state: 'loaded',
})

assert.deepEqual(await run('disabled', [{ ok: true }, { ok: true }]), {
  commands: ['plugin.load:sample.plugin', 'plugin.disable:sample.plugin'],
  state: 'disabled',
})

assert.deepEqual(await run('enabled', [{ ok: true }, { ok: true, status: 204 }]), {
  commands: ['plugin.enable:sample.plugin', 'plugin.health:sample.plugin'],
  state: 'enabled',
})

assert.deepEqual(await run('enabled', [{ ok: true }, { ok: true, status: 500 }]), {
  commands: ['plugin.enable:sample.plugin', 'plugin.health:sample.plugin'],
  state: 'failed',
})

assert.deepEqual(await run('enabled', [{ ok: true }, { ok: true }]), {
  commands: ['plugin.enable:sample.plugin', 'plugin.health:sample.plugin'],
  state: 'failed',
})

assert.deepEqual(await run('enabled', [{ ok: false }]), {
  commands: ['plugin.enable:sample.plugin'],
  state: 'failed',
})

console.log('plugin restore smoke test passed')
