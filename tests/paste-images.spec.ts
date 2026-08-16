import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, readdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, relative, sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ensurePathInside,
  PASTE_IMAGE_FILE_ROUTE,
  PASTE_IMAGES_ROUTE,
  PastedImageBackend,
  safePastedImageName,
} from '../src/paste-images.ts'

const roots: string[] = []
const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => { server.close(() => { resolve() }) })))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dvt-paste-'))
  roots.push(root)
  return root
}

function inside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..')
}

async function setup(cwd: string, maxImageBytes = 1024) {
  const ctx = {
    sessions: { get: (sessionId: string) => sessionId === 'session-1' ? { header: { cwd } } : undefined },
    logger: { warn: vi.fn() },
  }
  const backend = new PastedImageBackend(ctx as never, { maxImageBytes: () => maxImageBytes, pasteToPath: () => true })
  const server = createServer((req, res) => { void backend.handle(req, res) })
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { resolve() })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('server did not bind')
  const base = `http://127.0.0.1:${address.port}`
  const upload = (name: string, type: string, bytes: Uint8Array, size = bytes.length) => {
    const query = new URLSearchParams({ sessionId: 'session-1', name, size: String(size) })
    return fetch(`${base}${PASTE_IMAGES_ROUTE}?${query}`, {
      method: 'POST',
      headers: { 'Content-Type': type, Origin: base },
      body: bytes,
    })
  }
  return { base, upload }
}

async function setupVerdict(ctx: unknown) {
  const backend = new PastedImageBackend(ctx as never, { maxImageBytes: () => 1024, pasteToPath: () => true })
  const server = createServer((req, res) => { void backend.handle(req, res) })
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { resolve() })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('server did not bind')
  const base = `http://127.0.0.1:${address.port}`
  return { base }
}

function sessionWithModel(cwd: string, provider: string, model: string) {
  return {
    header: { cwd },
    requestContext: () => ({ provider, model }),
  }
}

describe('pasted image Web backend', () => {
  it('copies every image from a multi-image paste into the live Session workspace', async () => {
    const cwd = await workspace()
    const { upload } = await setup(cwd)
    const responses = await Promise.all([
      upload('first.png', 'image/png', Uint8Array.of(1, 2, 3)),
      upload('second.webp', 'image/webp', Uint8Array.of(4, 5)),
    ])
    const values = await Promise.all(responses.map(async response => {
      expect(response.status).toBe(201)
      return (await response.json() as { value: { absolutePath: string } }).value
    }))

    expect(values).toHaveLength(2)
    expect(values.every(value => inside(cwd, value.absolutePath))).toBe(true)
    await expect(readFile(values[0]!.absolutePath)).resolves.toEqual(Buffer.from([1, 2, 3]))
    await expect(readFile(values[1]!.absolutePath)).resolves.toEqual(Buffer.from([4, 5]))
  })

  it('takes over paste/drop for a custom provider model that is not in the model catalog', async () => {
    const cwd = await workspace()
    const { base } = await setupVerdict({
      sessions: {
        get: (id: string) => id === 'session-1' ? sessionWithModel(cwd, 'pi-ai', 'DeepSeek-V4-Flash-0731') : undefined,
      },
      logger: { warn: vi.fn() },
      llm: {
        listProviders: () => [],
        listModels: async () => [],
        resolveModelInfo: async () => ({ inputModalities: [] }),
      },
    })
    const response = await fetch(`${base}${PASTE_IMAGES_ROUTE}?sessionId=session-1&model=DeepSeek-V4-Flash-0731`)
    const body = await response.json() as { takeover: boolean }
    expect(body.takeover).toBe(true)
  })

  it('keeps native paste/drop when the exact custom model explicitly supports image input', async () => {
    const cwd = await workspace()
    const { base } = await setupVerdict({
      sessions: {
        get: (id: string) => id === 'session-1' ? sessionWithModel(cwd, 'pi-ai', 'DeepSeek-V4-Flash-0731') : undefined,
      },
      logger: { warn: vi.fn() },
      llm: {
        listProviders: () => [],
        listModels: async () => [],
        resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }),
      },
    })
    const response = await fetch(`${base}${PASTE_IMAGES_ROUTE}?sessionId=session-1&model=DeepSeek-V4-Flash-0731`)
    const body = await response.json() as { takeover: boolean }
    expect(body.takeover).toBe(false)
  })

  it('fails safe to paste-to-path when exact custom model capability cannot be resolved', async () => {
    const cwd = await workspace()
    const { base } = await setupVerdict({
      sessions: {
        get: (id: string) => id === 'session-1' ? sessionWithModel(cwd, 'pi-ai', 'DeepSeek-V4-Flash-0731') : undefined,
      },
      logger: { warn: vi.fn() },
      llm: {
        listProviders: () => [],
        listModels: async () => [],
        resolveModelInfo: async () => { throw new Error('unknown model capability') },
      },
    })
    const response = await fetch(`${base}${PASTE_IMAGES_ROUTE}?sessionId=session-1&model=DeepSeek-V4-Flash-0731`)
    const body = await response.json() as { takeover: boolean }
    expect(body.takeover).toBe(true)
  })

  it('sanitizes clipboard names and keeps generated paths below the plugin temp root', async () => {
    const cwd = await workspace()
    const { upload } = await setup(cwd)
    const response = await upload('../../../../outside.png', 'image/png', Uint8Array.of(9))
    const value = (await response.json() as { value: { absolutePath: string; filename: string } }).value

    expect(response.status).toBe(201)
    expect(inside(cwd, value.absolutePath)).toBe(true)
    expect(value.filename).toBe('outside.png')
    expect(basename(value.absolutePath)).toMatch(/^[0-9a-f-]+-outside\.png$/u)
    expect(() => ensurePathInside(cwd, join(cwd, '..', 'escape.png'))).toThrow(/escapes/u)
    expect(safePastedImageName('..\\..\\bad:<name>.png', 'image/png')).toBe('bad__name_.png')
    expect(safePastedImageName('CON.png', 'image/png')).toBe('_CON.png')
    expect(safePastedImageName('trailing... ', 'image/png')).toBe('trailing')
  })

  it('rejects a symlinked plugin temp root that resolves outside the workspace', async () => {
    const cwd = await workspace()
    const outside = await workspace()
    await symlink(outside, join(cwd, '.dsh-vision-cloud'))
    const { upload } = await setup(cwd)
    const response = await upload('safe.png', 'image/png', Uint8Array.of(1))
    const body = await response.json() as { error: { message: string } }

    expect(response.status).toBe(400)
    expect(body.error.message).toMatch(/escapes its workspace root/u)
    await expect(readdir(outside)).resolves.toEqual([])
  })

  it('rejects non-images, missing Sessions, oversize bodies, and incomplete bodies', async () => {
    const cwd = await workspace()
    const { base, upload } = await setup(cwd, 2)
    expect((await upload('notes.txt', 'text/plain', Uint8Array.of(1))).status).toBe(400)
    expect((await upload('large.png', 'image/png', Uint8Array.of(1, 2, 3))).status).toBe(413)
    expect((await upload('short.png', 'image/png', Uint8Array.of(1), 2)).status).toBe(400)
    const missing = await fetch(`${base}${PASTE_IMAGES_ROUTE}?sessionId=missing&name=x.png&size=1`, {
      method: 'POST', headers: { 'Content-Type': 'image/png', Origin: base }, body: Uint8Array.of(1),
    })
    expect(missing.status).toBe(400)
  })

  it('prefers the explicit provider/model pair over a stale session requestContext (A3)', async () => {
    const cwd = await workspace()
    const resolveModelInfo = vi.fn(async (_provider: string, model: string) =>
      model === 'Qwen3.8-Max' ? { inputModalities: ['text', 'image'] } : { inputModalities: ['text'] })
    const { base } = await setupVerdict({
      sessions: {
        get: (id: string) => id === 'session-1'
          ? sessionWithModel(cwd, 'abrdns', 'Qwen3.8-Max') // stale: last request used the multimodal model
          : undefined,
      },
      logger: { warn: vi.fn() },
      llm: { resolveModelInfo },
    })
    const staleSession = await fetch(`${base}${PASTE_IMAGES_ROUTE}?sessionId=session-1`)
    expect(await staleSession.json()).toEqual({ takeover: false }) // session fallback still resolves

    const textPair = await fetch(`${base}${PASTE_IMAGES_ROUTE}?sessionId=session-1&provider=abrdns&model=DeepSeek-V4-Pro-0813`)
    expect(await textPair.json()).toEqual({ takeover: true }) // pair wins over stale multimodal context
    const imagePair = await fetch(`${base}${PASTE_IMAGES_ROUTE}?sessionId=session-1&provider=abrdns&model=Qwen3.8-Max`)
    expect(await imagePair.json()).toEqual({ takeover: false })
    expect(resolveModelInfo).toHaveBeenCalledWith('abrdns', 'DeepSeek-V4-Pro-0813')
    expect(resolveModelInfo).toHaveBeenCalledWith('abrdns', 'Qwen3.8-Max')
  })

  it('lets a definite catalog label match beat the stale session route (A4)', async () => {
    const cwd = await workspace()
    const { base } = await setupVerdict({
      sessions: {
        get: (id: string) => id === 'session-1'
          ? sessionWithModel(cwd, 'abrdns', 'Qwen3.8-Max') // stale multimodal last-request route
          : undefined,
      },
      logger: { warn: vi.fn() },
      llm: {
        listProviders: () => [{ id: 'abrdns' }],
        listModels: async () => [
          { id: 'Qwen3.8-Max', inputModalities: ['text', 'image'] },
          { id: 'DeepSeek-V4-Pro-0813', inputModalities: ['text'] },
        ],
        resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }),
      },
    })
    const textLabel = await fetch(`${base}${PASTE_IMAGES_ROUTE}?sessionId=session-1&model=DeepSeek-V4-Pro-0813`)
    expect(await textLabel.json()).toEqual({ takeover: true }) // fresh label beats stale session
    const imageLabel = await fetch(`${base}${PASTE_IMAGES_ROUTE}?sessionId=session-1&model=Qwen3.8-Max`)
    expect(await imageLabel.json()).toEqual({ takeover: false })
    const sessionOnly = await fetch(`${base}${PASTE_IMAGES_ROUTE}?sessionId=session-1`)
    expect(await sessionOnly.json()).toEqual({ takeover: false })
  })

  it('falls back to the session route for custom labels the catalog cannot match (GA2)', async () => {
    const cwd = await workspace()
    const { base } = await setupVerdict({
      sessions: {
        get: (id: string) => id === 'session-1'
          ? sessionWithModel(cwd, 'pi-ai', 'dynamic-route-with-images')
          : undefined,
      },
      logger: { warn: vi.fn() },
      llm: {
        listProviders: () => [],
        listModels: async () => [],
        resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }),
      },
    })
    const response = await fetch(`${base}${PASTE_IMAGES_ROUTE}?sessionId=session-1&model=dynamic-route-with-images`)
    expect(await response.json()).toEqual({ takeover: false })
  })

  it('returns the text-safe bridge verdict when both label and session model are absent (L4 reversed, 3.9)', async () => {
    const { base } = await setupVerdict({
      sessions: { get: () => undefined },
      logger: { warn: vi.fn() },
      llm: {
        listProviders: () => [],
        listModels: async () => [],
        resolveModelInfo: async () => ({ inputModalities: [] }),
      },
    })
    const response = await fetch(`${base}${PASTE_IMAGES_ROUTE}`)
    expect(await response.json()).toEqual({ takeover: true })
  })

  it('serves a bridged image back over the read-only file route (A8)', async () => {
    const cwd = await workspace()
    const { base, upload } = await setup(cwd)
    const response = await upload('preview.png', 'image/png', Uint8Array.of(1, 2, 3))
    const value = (await response.json() as { value: { absolutePath: string } }).value
    const served = await fetch(
      `${base}${PASTE_IMAGE_FILE_ROUTE}?sessionId=session-1&name=${encodeURIComponent(basename(value.absolutePath))}`,
    )
    expect(served.status).toBe(200)
    expect(served.headers.get('content-type')).toBe('image/png')
    expect(served.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await served.arrayBuffer()).toEqual(Uint8Array.of(1, 2, 3).buffer)
  })

  it('rejects traversals, foreign extensions, and missing images on the file route (A12/A14)', async () => {
    const cwd = await workspace()
    const { base, upload } = await setup(cwd)
    await upload('preview.png', 'image/png', Uint8Array.of(7))
    const traversal = await fetch(`${base}${PASTE_IMAGE_FILE_ROUTE}?sessionId=session-1&name=..%2Fpreview.png`)
    expect(traversal.status).toBe(400)
    const extension = await fetch(`${base}${PASTE_IMAGE_FILE_ROUTE}?sessionId=session-1&name=notes.txt`)
    expect(extension.status).toBe(400)
    const missing = await fetch(`${base}${PASTE_IMAGE_FILE_ROUTE}?sessionId=session-1&name=absent.png`)
    expect(missing.status).toBe(404)
    const method = await fetch(`${base}${PASTE_IMAGE_FILE_ROUTE}?sessionId=session-1&name=preview.png`, { method: 'DELETE' })
    expect(method.status).toBe(405)
  })

  it('isolates file reads to the owning session workspace (A13)', async () => {
    const cwd = await workspace()
    const other = await workspace()
    const { base, upload } = await setup(cwd)
    const response = await upload('preview.png', 'image/png', Uint8Array.of(5))
    const value = (await response.json() as { value: { absolutePath: string } }).value
    const foreign = await fetch(
      `${base}${PASTE_IMAGE_FILE_ROUTE}?sessionId=session-2&name=${encodeURIComponent(basename(value.absolutePath))}`,
    )
    expect(foreign.status).toBe(400) // session-2 is not a live session here
    const ctx = {
      sessions: {
        get: (sessionId: string) => sessionId === 'session-1'
          ? { header: { cwd } }
          : sessionId === 'session-2'
            ? { header: { cwd: other } }
            : undefined,
      },
      logger: { warn: vi.fn() },
    }
    const backend = new PastedImageBackend(ctx as never, { maxImageBytes: () => 1024, pasteToPath: () => true })
    const server = createServer((req, res) => { void backend.handle(req, res) })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { resolve() })
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('server did not bind')
    const base2 = `http://127.0.0.1:${address.port}`
    const liveForeign = await fetch(
      `${base2}${PASTE_IMAGE_FILE_ROUTE}?sessionId=session-2&name=${encodeURIComponent(basename(value.absolutePath))}`,
    )
    expect(liveForeign.status).toBe(404) // exists in session-1, absent from session-2
  })

  it('disables the file route while pasteToPath is off (A15)', async () => {
    const cwd = await workspace()
    const backend = new PastedImageBackend(
      {
        sessions: { get: (sessionId: string) => sessionId === 'session-1' ? { header: { cwd } } : undefined },
        logger: { warn: vi.fn() },
      } as never,
      { maxImageBytes: () => 1024, pasteToPath: () => false },
    )
    const server = createServer((req, res) => { void backend.handle(req, res) })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { resolve() })
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('server did not bind')
    const base = `http://127.0.0.1:${address.port}`
    const served = await fetch(`${base}${PASTE_IMAGE_FILE_ROUTE}?sessionId=session-1&name=anything.png`)
    expect(served.status).toBe(404)
  })
})
