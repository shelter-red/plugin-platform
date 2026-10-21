import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const serverBinary = path.join(repoRoot, 'native-server/build/plugmesh-server')

const localUiPassword = 'console-e2e-password'
const credentialPassword = 'console-e2e-credential'

export type RealServer = {
  name: string
  stop: () => Promise<void>
}

async function runRegistration(workerUrl: string, name: string, code: string, credentialFile: string) {
  const child = spawn(serverBinary, ['--register', workerUrl, name, credentialFile], {
    env: {
      ...process.env,
      PLUGMESH_REGISTRATION_CODE: code,
      PLUGMESH_LOCAL_UI_PASSWORD: localUiPassword,
      PLUGMESH_CREDENTIAL_PASSWORD: credentialPassword,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { output += chunk })
  const timeout = setTimeout(() => child.kill('SIGKILL'), 20_000)
  const [exitCode] = await once(child, 'exit')
  clearTimeout(timeout)
  if (exitCode !== 0) throw new Error(`plugmesh-server --register 失败（退出码 ${exitCode}）：${output.trim()}`)
}

export async function startRealServer(workerUrl: string, registrationCode: string): Promise<RealServer> {
  const directory = await mkdtemp(path.join(tmpdir(), 'plugmesh-console-e2e-'))
  const credentialFile = path.join(directory, 'credentials.json')
  const name = `控制台真实栈 ${Date.now()}-${Math.random().toString(16).slice(2, 6)}`
  await runRegistration(workerUrl, name, registrationCode, credentialFile)

  const server = spawn(serverBinary, [], {
    env: {
      ...process.env,
      PLUGMESH_CREDENTIAL_FILE: credentialFile,
      PLUGMESH_CREDENTIAL_PASSWORD: credentialPassword,
      PLUGMESH_PLUGIN_DIRECTORY: path.join(repoRoot, 'native-server/build/plugins'),
      PLUGMESH_LOCAL_PORT: String(18800 + Math.floor(Math.random() * 90)),
      PLUGMESH_LOCAL_UI_DIRECTORY: path.join(repoRoot, 'native-ui/dist'),
    },
    stdio: 'ignore',
  })
  return {
    name,
    stop: async () => {
      if (server.exitCode === null) {
        server.kill('SIGTERM')
        await Promise.race([once(server, 'exit'), new Promise((resolve) => setTimeout(resolve, 5_000))])
      }
      await rm(directory, { recursive: true, force: true })
    },
  }
}
