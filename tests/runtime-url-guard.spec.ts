import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveConfig } from '../src/config.ts'
import { VisionToolkitRuntime } from '../src/runtime.ts'

let workspace: string

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'vision-cloud-url-guard-'))
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(workspace, { recursive: true, force: true })
})

function runtime(allowExtensionlessImageUrls = false): VisionToolkitRuntime {
  return new VisionToolkitRuntime({} as never, resolveConfig({
    model: { provider: 'test-provider', model: 'test-vision' },
    allowExtensionlessImageUrls,
  }))
}

function options(): { signal: AbortSignal; workspace: string } {
  return { signal: new AbortController().signal, workspace }
}

describe('vision_cloud_tool URL media guard', () => {
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
    let bodyRead = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        bodyRead = true
        controller.enqueue(new TextEncoder().encode('{"object":"list","data":[]}'))
        controller.close()
      },
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })))

    await expect(runtime(true).read(
      { images: ['https://new-api.abrdns.com/v1/models'], attachments: [] },
      undefined,
      options(),
    )).rejects.toMatchObject({ code: 'input' })

    expect(bodyRead).toBe(false)
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
    let bodyRead = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        bodyRead = true
        controller.enqueue(new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]))
        controller.close()
      },
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, {
      status: 200,
      headers: { 'content-type': 'video/mp4' },
    })))

    await expect(runtime(true).read(
      { images: ['https://example.com/media/signed-stream'], attachments: [] },
      undefined,
      options(),
    )).rejects.toMatchObject({ code: 'input' })

    expect(bodyRead).toBe(false)
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
