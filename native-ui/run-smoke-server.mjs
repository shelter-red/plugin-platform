import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const executableName = process.platform === 'win32'
  ? 'plugmesh-local-ui-smoke-server.exe'
  : 'plugmesh-local-ui-smoke-server'
const candidates = [
  resolve(repositoryRoot, 'native-server', 'build', executableName),
  resolve(repositoryRoot, 'native-server', 'build', 'Debug', executableName),
  resolve(repositoryRoot, 'native-server', 'build', 'Release', executableName),
  resolve(repositoryRoot, 'native-server', 'build', 'RelWithDebInfo', executableName),
]
const executable = process.env.PLUGMESH_LOCAL_UI_SMOKE_SERVER
  || candidates.find((candidate) => existsSync(candidate))

if (!executable) {
  throw new Error('local UI smoke server executable was not built')
}

const child = spawn(executable, ['18771', resolve(repositoryRoot, 'native-ui', 'dist')], { stdio: 'inherit' })
let stopping = false

const stop = (signal) => {
  if (stopping) return
  stopping = true
  child.kill(signal)
}

process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))
child.on('error', (error) => {
  console.error(error.message)
  process.exitCode = 1
})
child.on('exit', (code, signal) => {
  if (!stopping && signal) console.error(`local UI smoke server stopped by ${signal}`)
  process.exitCode = code ?? (stopping ? 0 : 1)
})
