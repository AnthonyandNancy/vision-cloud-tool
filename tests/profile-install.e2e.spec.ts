import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa, execaSync } from 'execa'
import { afterEach, describe, expect, it } from 'vitest'

/** Keyless real-profile acceptance: clean DSH_HOME install → boot → tool exposure → uninstall. */

const pluginDir = fileURLToPath(new URL('../', import.meta.url))
const repoRoot = pluginDir
const REQUIRED_DSH_VERSION = '0.1.0-rc.6'
const TOOL_NAME = 'vision_cloud_tool'

interface ScriptedLlmRequest {
  body: unknown
}

function hasPnpm(): boolean {
  try {
    execaSync('pnpm', ['--version'], { timeout: 10_000 })
    return true
  } catch {
    return false
  }
}

function hasCompatibleDsh(): boolean {
  try {
    return execaSync('dsh', ['--version'], { timeout: 10_000 }).stdout.trim() === REQUIRED_DSH_VERSION
  } catch {
    return false
  }
}

function packPlugin(destination: string): string {
  const result = execaSync('npm', ['pack', '--ignore-scripts', '--pack-destination', destination, '--json'], {
    cwd: pluginDir,
    timeout: 120_000,
  })
  const rows = JSON.parse(result.stdout) as Array<{ filename?: unknown }>
  const filename = rows[0]?.filename
  if (typeof filename !== 'string' || filename.length === 0) {
    throw new Error(`npm pack returned no filename: ${result.stdout}`)
  }
  return join(destination, filename)
}

async function runDsh(
  args: readonly string[],
  env: Readonly<Record<string, string>>,
  cwd = repoRoot,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const childEnv = Object.fromEntries(
    Object.entries({ ...process.env, ...env })
      .filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
  const result = await execa('dsh', args, {
    input: '',
    timeout: 120_000,
    killSignal: 'SIGKILL',
    reject: false,
    env: childEnv,
    extendEnv: false,
    cwd,
  })
  if (result.timedOut) {
    throw new Error(`dsh did not exit within 120s. stdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  }
  return { stdout: result.stdout, stderr: result.stderr, code: result.exitCode ?? -1 }
}

async function startScriptedLlmServer(text: string) {
  const requests: ScriptedLlmRequest[] = []
  const server = createServer((request, response) => {
    if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end('{"error":"not found"}')
      return
    }
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      let body: unknown
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        body = null
      }
      requests.push({ body })
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
      })
      const write = (payload: unknown): void => {
        response.write(`data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`)
      }
      write({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })
      write({
        choices: [{ index: 0, delta: { content: '' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: Array.from(text).length },
      })
      write('[DONE]')
      response.end()
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address() as AddressInfo
  return {
    baseURL: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error === undefined ? resolve() : reject(error))
      server.closeAllConnections()
    }),
  }
}

function requestToolNames(request: ScriptedLlmRequest | undefined): string[] {
  const body = request?.body as {
    tools?: Array<{ function?: { name?: unknown } }>
  } | undefined
  return body?.tools
    ?.map(tool => tool.function?.name)
    .filter((name): name is string => typeof name === 'string') ?? []
}

function fixturePatch(home: string, withModel: boolean): string {
  const path = join(home, 'fixture-patch.yml')
  const lines = ['- id: vision-cloud']
  if (withModel) {
    lines.push(
      '  config:',
      '    model:',
      '      provider: deepseek-official',
      '      model: fixture-model',
      '    language: en',
    )
  }
  lines.push('', '')
  writeFileSync(path, lines.join('\n'))
  return path
}

const profileE2eAvailable = hasCompatibleDsh() && hasPnpm()
if (process.env.DSH_VISION_REQUIRE_PROFILE_E2E === '1' && !profileE2eAvailable) {
  throw new Error(`DSH_VISION_REQUIRE_PROFILE_E2E=1 requires dsh ${REQUIRED_DSH_VERSION} and pnpm on PATH`)
}

describe.skipIf(!profileE2eAvailable)('dsh-vision-cloud profile install (keyless e2e)', () => {
  const homes: string[] = []

  afterEach(() => {
    for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
  })

  it('registers vision_cloud_tool only when a model is selected, and uninstalls cleanly', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-vt-profile-'))
    homes.push(home)
    const packageDir = join(home, 'package')
    mkdirSync(packageDir)
    const tarball = packPlugin(packageDir)

    try {
      const add = await runDsh(['plugin', '--profile', 'headless', 'add', tarball], { DSH_HOME: home })
      expect(add.code, add.stderr).toBe(0)

      const dump = await runDsh(['--profile', 'headless', '--dump-config'], { DSH_HOME: home })
      expect(dump.stdout).toContain('- id: vision-cloud')
      expect(dump.stdout).toContain("name: 'dsh-vision-cloud'")

      // With a model selected, the tool must be present in the model request.
      const enabledPatch = fixturePatch(home, true)
      const enabledServer = await startScriptedLlmServer('enabled ok')
      try {
        const enabled = await runDsh([
          '--profile', 'headless', '--patch', enabledPatch,
          'say ok',
        ], {
          DSH_HOME: home,
          DSH_TELEMETRY_DISABLED: '1',
          DEEPSEEK_API_KEY: 'mock-e2e-key',
          DEEPSEEK_BASE_URL: enabledServer.baseURL,
        })
        expect(enabled.code, enabled.stderr).toBe(0)
        expect(enabled.stdout).toBe('enabled ok')
        expect(requestToolNames(enabledServer.requests[0])).toContain(TOOL_NAME)
      } finally {
        await enabledServer.close()
      }

      // Without a model, the tool must be absent.
      const disabledPatch = fixturePatch(home, false)
      const disabledServer = await startScriptedLlmServer('disabled ok')
      try {
        const disabled = await runDsh([
          '--profile', 'headless', '--patch', disabledPatch,
          'say ok',
        ], {
          DSH_HOME: home,
          DSH_TELEMETRY_DISABLED: '1',
          DEEPSEEK_API_KEY: 'mock-e2e-key',
          DEEPSEEK_BASE_URL: disabledServer.baseURL,
        })
        expect(disabled.code, disabled.stderr).toBe(0)
        expect(disabled.stdout).toBe('disabled ok')
        expect(requestToolNames(disabledServer.requests[0])).not.toContain(TOOL_NAME)
      } finally {
        await disabledServer.close()
      }

      const remove = await runDsh(['plugin', '--profile', 'headless', 'remove', 'dsh-vision-cloud'], {
        DSH_HOME: home,
      })
      expect(remove.code, remove.stderr).toBe(0)
      const dumpAfter = await runDsh(['--profile', 'headless', '--dump-config'], { DSH_HOME: home })
      expect(dumpAfter.stdout).not.toContain('vision-cloud')
    } finally {
      // Best-effort cleanup of the headless profile created by `dsh plugin`.
      void home
    }
  }, 300_000)
})
