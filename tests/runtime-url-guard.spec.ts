import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveConfig } from '../src/config.ts'
import { VisionToolkitRuntime } from '../src/runtime.ts'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

let workspace: string

const TINY_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
  0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xdd, 0x8d,
  0xb0, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
  0xae, 0x42, 0x60, 0x82,
])

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'vision-cloud-url-guard-'))
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(workspace, { recursive: true, force: true })
})

function runtime(allowExtensionlessImageUrls = false): VisionToolkitRuntime {
  const attachment = {
    saveImage: vi.fn(async (input: { data: Uint8Array; mediaType: string; name: string }) => ({
      attachmentId: `sha256:test-${input.name}`,
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 1,
      height: 1,
      name: input.name,
    } as ImageAttachmentRef)),
    readImage: vi.fn(),
  }
  const llm = {
    stream: vi.fn(async function* () {
      yield { type: 'text-delta', text: '{"summary":"ok","ocr":{"full_text":"","lines":[]},"layout":{"regions":[]},"semantics":{"scene":"","entities":[],"relations":[]},"visual":{"dominant_colors":[],"style":"","notes":[]},"uncertainty":[]}' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }),
  }
  return new VisionToolkitRuntime({ attachments: attachment, llm, logger: { info: vi.fn() } } as never, resolveConfig({
    model: { provider: 'test-provider', model: 'test-vision' },
    allowExtensionlessImageUrls,
  }))
}

function options(): { signal: AbortSignal; workspace: string } {
  return { signal: new AbortController().signal, workspace }
}

describe('vision_cloud_tool URL media guard', () => {
  it('accepts @-prefixed and quoted local image references', async () => {
    await writeFile(join(workspace, 'error screenshot.png'), TINY_PNG)

    const result = await runtime().read(
      { images: ['@"error screenshot.png"'], attachments: [] },
      undefined,
      options(),
    )

    expect(result.images).toMatchObject([{ format: 'png', width: 1, height: 1 }])
  })

  it('rejects a DSH session reference before filesystem resolution', async () => {
    await expect(runtime().read(
      { images: ['@[session](dsh-session:abc)'], attachments: [] },
      undefined,
      options(),
    )).rejects.toMatchObject({ code: 'input' })
  })

  it('rejects an unclassified @ reference before filesystem resolution', async () => {
    await expect(runtime().read(
      { images: ['@agent'], attachments: [] },
      undefined,
      options(),
    )).rejects.toMatchObject({ code: 'input' })
  })

  it('rejects a non-image URL extension before any network request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(runtime().read(
      { images: ['https://example.com/report.json'], attachments: [] },
      undefined,
      options(),
    )).rejects.toMatchObject({ code: 'input' })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an extensionless API URL before any network request by default', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(runtime().read(
      { images: ['https://new-api.abrdns.com/?api_key=sk-test'], attachments: [] },
      undefined,
      options(),
    )).rejects.toMatchObject({ code: 'input' })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a JSON API endpoint by content-type without reading its body when extensionless URLs are enabled', async () => {
    let response: Response | undefined
    vi.stubGlobal('fetch', vi.fn(async () => {
      response = new Response('{"object":"list","data":[]}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
      return response
    }))

    await expect(runtime(true).read(
      { images: ['https://new-api.abrdns.com/v1/models'], attachments: [] },
      undefined,
      options(),
    )).rejects.toMatchObject({ code: 'input' })

    expect(response).toBeDefined()
    expect(response?.bodyUsed).toBe(false)
  })

  it('rejects video URL extensions before any network request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(runtime().read(
      { images: ['https://example.com/media/clip.mp4'], attachments: [] },
      undefined,
      options(),
    )).rejects.toMatchObject({ code: 'input' })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects video content types without reading the body', async () => {
    let response: Response | undefined
    vi.stubGlobal('fetch', vi.fn(async () => {
      response = new Response(new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]), {
        status: 200,
        headers: { 'content-type': 'video/mp4' },
      })
      return response
    }))

    await expect(runtime(true).read(
      { images: ['https://example.com/media/signed-stream'], attachments: [] },
      undefined,
      options(),
    )).rejects.toMatchObject({ code: 'input' })

    expect(response).toBeDefined()
    expect(response?.bodyUsed).toBe(false)
  })

  it('rejects local video files before reading their bytes', async () => {
    const videoPath = join(workspace, 'clip.mp4')
    await writeFile(videoPath, Buffer.from('0000001866747970', 'hex'))

    await expect(runtime().read(
      { images: [videoPath], attachments: [] },
      undefined,
      options(),
    )).rejects.toMatchObject({ code: 'input' })
  })

  it('surfaces non-2xx image responses as service errors with the HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('missing', { status: 404, statusText: 'Not Found' })))

    await expect(runtime().read(
      { images: ['https://example.com/missing.png'], attachments: [] },
      undefined,
      options(),
    )).rejects.toMatchObject({ code: 'service', message: expect.stringContaining('404') as never })
  })

  it('rejects unsupported image/* content types before reading the body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<svg/>', {
      status: 200,
      headers: { 'content-type': 'image/svg+xml' },
    })))

    await expect(runtime(true).read(
      { images: ['https://example.com/vector.svg'], attachments: [] },
      undefined,
      options(),
    )).rejects.toMatchObject({ code: 'input' })
  })

  it('still rejects non-image bytes behind a misleading image content-type', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([0x00, 0x01, 0x02, 0x03]), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    })))

    await expect(runtime().read(
      { images: ['https://example.com/fake.png'], attachments: [] },
      undefined,
      options(),
    )).rejects.toMatchObject({ code: 'input' })
  })

  it('rejects non-http(s) URL schemes as input', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(runtime().read(
      { images: ['file:///etc/passwd'], attachments: [] },
      undefined,
      options(),
    )).rejects.toMatchObject({ code: 'input' })

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
