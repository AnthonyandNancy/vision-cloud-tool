// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ComponentType } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { Context, Service } from '@deepseek-ai/cordis'
import {
  installPasteImages,
  PASTE_IMAGES_ROUTE as CLIENT_PASTE_IMAGES_ROUTE,
  PasteImageController,
} from '../src/client/paste-images.tsx'
import { PASTE_IMAGES_ROUTE as SERVER_PASTE_IMAGES_ROUTE } from '../src/paste-images.ts'

interface Occurrence {
  occurrenceId: number
  source: string
  ref: string
  offset: number
  label: string
  clipboardText: string
}

function inputMachine(initial = '') {
  let state = {
    draft: initial,
    draftRev: 0,
    phase: 'plain' as const,
    imageIds: [] as string[],
    occurrences: [] as Occurrence[],
    queue: [],
  }
  const listeners = new Set<() => void>()
  const publish = (next: typeof state) => {
    state = next
    for (const listener of listeners) listener()
  }
  return {
    state: {
      getSnapshot: () => state,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    setDraft: vi.fn((draft: string) => {
      const positions: number[] = []
      for (let index = 0; index < draft.length; index += 1) if (draft[index] === '\uFFFC') positions.push(index)
      const occurrences = state.occurrences.slice(0, positions.length).map((row, index) => ({ ...row, offset: positions[index] }))
      publish({ ...state, draft, draftRev: state.draftRev + 1, occurrences })
    }),
    insertReference: vi.fn((reference: Omit<Occurrence, 'occurrenceId' | 'offset'>, span: { start: number; end: number; draftRev: number }) => {
      if (span.draftRev !== state.draftRev || span.start !== span.end) return false
      const occurrence = { ...reference, occurrenceId: state.occurrences.length + 1, offset: span.start }
      const shifted = state.occurrences.map(row => row.offset >= span.start ? { ...row, offset: row.offset + 1 } : row)
      publish({
        ...state,
        draft: state.draft.slice(0, span.start) + '\uFFFC' + state.draft.slice(span.end),
        draftRev: state.draftRev + 1,
        occurrences: [...shifted, occurrence].sort((a, b) => a.offset - b.offset),
      })
      return true
    }),
    addImages: vi.fn((ids: string[]) => {
      publish({ ...state, imageIds: [...state.imageIds, ...ids] })
      return true
    }),
removeImage: vi.fn((id: string) => {
        publish({ ...state, imageIds: state.imageIds.filter(value => value !== id) })
      }),
    insertText: vi.fn((text: string, span: { start: number; end: number; draftRev: number }) => {
      if (span.draftRev !== state.draftRev || span.start > span.end) return false
      const draft = state.draft.slice(0, span.start) + text + state.draft.slice(span.end)
      const delta = text.length - (span.end - span.start)
      const occurrences = state.occurrences
        .filter(row => row.offset < span.start || row.offset >= span.end)
        .map(row => row.offset >= span.end ? { ...row, offset: row.offset + delta } : row)
      publish({ ...state, draft, draftRev: state.draftRev + 1, occurrences })
      return true
    }),
    notify: vi.fn(),
  }
}

type TriggerService = 'slash' | 'inputTriggers'

const benches: Array<() => void> = []

function fakeClient(initial = '', triggerServices: readonly TriggerService[] = ['slash'], aliasTriggers = false, extras: Record<string, unknown> = {}) {
  const input = inputMachine(initial)
  const effects: Array<() => void> = []
  const registrations: Array<{
    options: Record<string, unknown>
    component: ComponentType<Record<string, unknown>>
  }> = []
  let source: ReturnType<PasteImageController['source']> | undefined
  const createTriggerRegistry = () => {
    const dispose = vi.fn(() => { source = undefined })
    return {
      dispose,
      registerSource: vi.fn((next: ReturnType<PasteImageController['source']>) => {
        source = next
        return dispose
      }),
    }
  }
  const triggerRegistries = {
    slash: createTriggerRegistry(),
    inputTriggers: createTriggerRegistry(),
  }
  const ctx: Record<string, unknown> = {
    sessions: {
      list: { getSnapshot: () => ({ current: 'session-1' }) },
      scope: () => ({}),
    },
    conversation: { input: { for: () => input } },
    slots: {
      inject: vi.fn((_name: string, callback: () => unknown) => { callback() }),
      register: vi.fn((options: Record<string, unknown>, component: ComponentType<Record<string, unknown>>) => {
        registrations.push({ options, component })
        return () => {}
      }),
    },
    effect: vi.fn((setup: () => void | (() => void)) => {
      const dispose = setup()
      if (typeof dispose === 'function') effects.push(dispose)
    }),
    get: vi.fn((name: string) => extras[name]),
  }
  for (const service of triggerServices) {
    ctx[service] = aliasTriggers ? triggerRegistries.slash : triggerRegistries[service]
  }
  ctx.inject = vi.fn((services: string[], callback: (scope: typeof ctx) => void) => {
    if (services.every(service => ctx[service] !== undefined)) callback(ctx)
  })
  installPasteImages(ctx as never)
  const bench = {
    ctx,
    input,
    registrations,
    source: () => source,
    triggerRegistries,
    disposeEffect: (index: number) => {
      const dispose = effects[index]
      if (dispose === undefined) return
      effects[index] = () => {}
      dispose()
    },
    dispose: () => {
      for (const fn of effects.splice(0).reverse()) fn()
    },
  }
  benches.push(bench.dispose)
  return bench
}

function file(name: string, type: string, bytes: number[]): File {
  const value = new File([Uint8Array.from(bytes)], name, { type })
  Object.defineProperty(value, 'arrayBuffer', { value: async () => Uint8Array.from(bytes).buffer })
  return value
}

function clipboardEvent(text: string, files: File[]): ClipboardEvent {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
  const data = {
    items: files.map(value => ({ kind: 'file', type: value.type, getAsFile: () => value })),
    files,
    getData: (type: string) => type === 'text/plain' ? text : '',
  }
  Object.defineProperty(event, 'clipboardData', { value: data })
  return event
}

function dropEvent(text: string, files: File[]): DragEvent {
  const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
  const data = {
    items: files.map(value => ({ kind: 'file', type: value.type, getAsFile: () => value })),
    files,
    getData: (type: string) => type === 'text/plain' ? text : '',
  }
  Object.defineProperty(event, 'dataTransfer', { value: data })
  return event
}

function composer(): HTMLTextAreaElement {
  const card = document.createElement('div')
  card.dataset.composerCard = ''
  const textarea = document.createElement('textarea')
  card.appendChild(textarea)
  document.body.appendChild(card)
  const selector = document.createElement('button')
  selector.setAttribute('aria-label', '选择模型 · DeepSeek-V4-Flash')
  document.body.appendChild(selector)
  return textarea
}

/** Fire the focusin prefetch and wait for the paste-takeover verdict to cache. */
async function armTakeover(): Promise<void> {
  document.dispatchEvent(new FocusEvent('focusin'))
  await new Promise(resolve => setTimeout(resolve, 10))
}

/** Drain pending microtasks so held paste settlements can run to completion. */
async function flushTasks(times = 8): Promise<void> {
  for (let count = 0; count < times; count += 1) await Promise.resolve()
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      return new Response(JSON.stringify({
        ok: true,
        value: { absolutePath: '/workspace/.dsh-vision-cloud/tmp/pasted-images/a/default.png' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ takeover: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
})

afterEach(() => {
  for (const dispose of benches.splice(0)) dispose()
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('clipboard image client', () => {
  it('uses the exact Web route registered by the server', () => {
    expect(CLIENT_PASTE_IMAGES_ROUTE).toBe(SERVER_PASTE_IMAGES_ROUTE)
  })

  it('registers the reference codec through the legacy inputTriggers service', () => {
    const bench = fakeClient('', ['inputTriggers'])
    expect(bench.source()?.name).toBe('vision-cloud-pasted-image')
    expect(bench.ctx.inject).toHaveBeenCalledWith(['slash'], expect.any(Function))
    expect(bench.ctx.inject).toHaveBeenCalledWith(['inputTriggers'], expect.any(Function))
    bench.dispose()
  })

  it('registers both distinct trigger-service generations in a transitional runtime', () => {
    const bench = fakeClient('', ['slash', 'inputTriggers'])
    expect(bench.triggerRegistries.slash.registerSource).toHaveBeenCalledTimes(1)
    expect(bench.triggerRegistries.inputTriggers.registerSource).toHaveBeenCalledTimes(1)
    bench.dispose()
  })

  it('registers once when a compatibility adapter aliases both service names', () => {
    const bench = fakeClient('', ['slash', 'inputTriggers'], true)
    expect(bench.triggerRegistries.slash.registerSource).toHaveBeenCalledTimes(1)
    expect(bench.triggerRegistries.inputTriggers.registerSource).not.toHaveBeenCalled()
    bench.disposeEffect(0)
    expect(bench.source()?.name).toBe('vision-cloud-pasted-image')
    expect(bench.triggerRegistries.slash.dispose).not.toHaveBeenCalled()
    bench.disposeEffect(1)
    expect(bench.source()).toBeUndefined()
    expect(bench.triggerRegistries.slash.dispose).toHaveBeenCalledTimes(1)
    bench.dispose()
  })

  it('keeps an aliased registry live across real Cordis service removal and re-provision', async () => {
    const ctx = new Context()
    const unregister = vi.fn()
    const registerSource = vi.fn(() => unregister)
    class TriggerRegistryService extends Service {
      constructor(serviceCtx: Context) {
        super(serviceCtx, 'inputTriggers')
      }

      registerSource(): () => void {
        return registerSource()
      }
    }
    const mountAdapter = async () => {
      const fiber = ctx.plugin({
        inject: ['inputTriggers'],
        apply(scope: Context) {
          scope.provide('slash', (scope as Context & { inputTriggers: TriggerRegistryService }).inputTriggers)
        },
      })
      await fiber.await()
      return fiber
    }
    ctx.provide('sessions', {
      list: { getSnapshot: () => ({ current: 'session-1' }) },
      scope: () => ({}),
    })
    ctx.provide('conversation', { input: { for: () => inputMachine() } })
    ctx.provide('slots', {
      inject: (_name: string, callback: () => unknown) => { callback() },
      register: () => () => {},
    })
    let providerFiber = ctx.plugin(TriggerRegistryService)
    await providerFiber.await()
    let adapterFiber = await mountAdapter()
    const pasteFiber = ctx.plugin({ apply: scope => { installPasteImages(scope as never) } })
    await pasteFiber.await()
    await vi.waitFor(() => { expect(registerSource).toHaveBeenCalledTimes(1) })

    await adapterFiber.dispose()
    expect(unregister).not.toHaveBeenCalled()
    adapterFiber = await mountAdapter()
    expect(registerSource).toHaveBeenCalledTimes(1)

    await providerFiber.dispose()
    await vi.waitFor(() => { expect(unregister).toHaveBeenCalledTimes(1) })

    providerFiber = ctx.plugin(TriggerRegistryService)
    await providerFiber.await()
    await vi.waitFor(() => { expect(registerSource).toHaveBeenCalledTimes(2) })
    await adapterFiber.dispose()
    expect(unregister).toHaveBeenCalledTimes(1)
    await providerFiber.dispose()
    await vi.waitFor(() => { expect(unregister).toHaveBeenCalledTimes(2) })
    await pasteFiber.dispose()
  })

  it('preserves pasted text, inserts every image as a text reference, and blocks the native ImageBlock path', async () => {
    const bench = fakeClient('prefix ')
    const textarea = composer()
    textarea.value = 'prefix '
    textarea.setSelectionRange(7, 7)
    const nativePaste = vi.fn()
    textarea.addEventListener('paste', nativePaste)
    await armTakeover()
    const request = vi.fn(async (url: string, init: RequestInit) => {
      expect(init.body).toBeInstanceOf(File)
      const index = request.mock.calls.length - 1
      return new Response(JSON.stringify({
        ok: true,
        value: { absolutePath: index === 0
          ? '/workspace/.dsh-vision-cloud/tmp/pasted-images/a/image-01.png'
          : '/workspace/.dsh-vision-cloud/tmp/pasted-images/a/image-02.webp' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', request)

    const event = clipboardEvent('caption\uFFFC', [
      file('one.png', 'image/png', [1]),
      file('notes.txt', 'text/plain', [9]),
      file('two.webp', 'image/webp', [2, 3]),
    ])
    textarea.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(nativePaste).not.toHaveBeenCalled()
    expect(bench.input.state.getSnapshot().draft).toContain('prefix caption')
    expect(bench.input.state.getSnapshot().draft.match(/\uFFFC/gu)).toHaveLength(2)
    expect(bench.input.state.getSnapshot().occurrences).toHaveLength(2)
    expect(bench.input.state.getSnapshot().imageIds).toEqual([])

    const codec = bench.source()?.codec
    if (codec === undefined) throw new Error('paste source was not registered')
    const refs = bench.input.state.getSnapshot().occurrences.map(row => row.ref)
    const serialized = await Promise.all(refs.map(ref => codec.serialize(ref, new AbortController().signal)))
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls.every(([url]) => String(url).startsWith('/_dsh/vision-cloud/paste-images?'))).toBe(true)
    expect(serialized).toEqual([
      '[Pasted image available at absolute path: "/workspace/.dsh-vision-cloud/tmp/pasted-images/a/image-01.png"]\n\n![one.png](</_dsh/vision-cloud/paste-images/file?sessionId=session-1&name=image-01.png>)',
      '[Pasted image available at absolute path: "/workspace/.dsh-vision-cloud/tmp/pasted-images/a/image-02.webp"]\n\n![two.webp](</_dsh/vision-cloud/paste-images/file?sessionId=session-1&name=image-02.webp>)',
    ])
    bench.dispose()
  })

  it('prefers the server-returned hashed filename in the serialized bridge and copy chip', async () => {
    const bench = fakeClient('')
    const textarea = composer()
    const request = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== 'POST') return new Response(JSON.stringify({ takeover: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
      return new Response(JSON.stringify({
        ok: true,
        value: {
          absolutePath: ['D:', 'workspace', '.dsh-vision-cloud', 'tmp', 'pasted-images', 'a', '0123456789abcdef.png'].join(String.fromCharCode(92)),
          filename: '0123456789abcdef.png',
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', request)
    await armTakeover()

    textarea.dispatchEvent(clipboardEvent('', [file('image.png', 'image/png', [1])]))
    const snapshot = bench.input.state.getSnapshot()
    const codec = bench.source()?.codec
    if (codec === undefined) throw new Error('paste source was not registered')
    const [serialized] = await Promise.all(snapshot.occurrences.map(row => codec.serialize(row.ref, new AbortController().signal)))

    expect(serialized).toContain('0123456789abcdef.png')
    expect(serialized).toContain('</_dsh/vision-cloud/paste-images/file?sessionId=session-1&name=0123456789abcdef.png>')
    expect(serialized).not.toContain('![image.png]')
    const dock = bench.registrations.find(row => row.options.id === 'vision-cloud-pasted-images')
    if (dock === undefined) throw new Error('paste dock was not registered')
    const injected = (dock.options.inject as ((sessionId: string) => {
      controller: PasteImageController
      remove: (row: Occurrence) => void
    }))('session-1')
    render(createElement(dock.component, { input: bench.input.state.getSnapshot(), ...injected }))
    expect(screen.getByRole('button', { name: '预览 0123456789abcdef.png' })).toBeTruthy()
    expect(screen.queryByText('0123456789abcdef.png')).toBeNull()
    expect(screen.queryByText('image.png')).toBeNull()
    bench.dispose()
  })

  it('converts dropped images to text references for a confirmed text-only model and blocks the native ImageBlock path', async () => {
    const bench = fakeClient('prefix ')
    const textarea = composer()
    textarea.value = 'prefix '
    textarea.setSelectionRange(7, 7)
    const nativeDrop = vi.fn()
    textarea.addEventListener('drop', nativeDrop)
    await armTakeover()
    const request = vi.fn(async (url: string, init: RequestInit) => {
      expect(init.body).toBeInstanceOf(File)
      const index = request.mock.calls.length - 1
      return new Response(JSON.stringify({
        ok: true,
        value: { absolutePath: index === 0
          ? '/workspace/.dsh-vision-cloud/tmp/pasted-images/a/drop-01.png'
          : '/workspace/.dsh-vision-cloud/tmp/pasted-images/a/drop-02.webp' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', request)

    const event = dropEvent('caption', [
      file('one.png', 'image/png', [1]),
      file('notes.txt', 'text/plain', [9]),
      file('two.webp', 'image/webp', [2, 3]),
    ])
    textarea.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(nativeDrop).not.toHaveBeenCalled()
    expect(bench.input.state.getSnapshot().draft).toContain('prefix caption')
    expect(bench.input.state.getSnapshot().draft.match(/\uFFFC/gu)).toHaveLength(2)
    expect(bench.input.state.getSnapshot().occurrences).toHaveLength(2)
    expect(bench.input.state.getSnapshot().imageIds).toEqual([])

    const codec = bench.source()?.codec
    if (codec === undefined) throw new Error('paste source was not registered')
    const refs = bench.input.state.getSnapshot().occurrences.map(row => row.ref)
    const serialized = await Promise.all(refs.map(ref => codec.serialize(ref, new AbortController().signal)))
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls.every(([url]) => String(url).startsWith('/_dsh/vision-cloud/paste-images?'))).toBe(true)
    expect(serialized).toEqual([
      '[Pasted image available at absolute path: "/workspace/.dsh-vision-cloud/tmp/pasted-images/a/drop-01.png"]\n\n![one.png](</_dsh/vision-cloud/paste-images/file?sessionId=session-1&name=drop-01.png>)',
      '[Pasted image available at absolute path: "/workspace/.dsh-vision-cloud/tmp/pasted-images/a/drop-02.webp"]\n\n![two.webp](</_dsh/vision-cloud/paste-images/file?sessionId=session-1&name=drop-02.webp>)',
    ])
    bench.dispose()
  })

  it('leaves dropped images native when the model is not confirmed text-only', async () => {
    const bench = fakeClient('')
    const textarea = composer()
    const nativeDrop = vi.fn()
    textarea.addEventListener('drop', nativeDrop)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ takeover: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))
    await armTakeover()
    const event = dropEvent('', [file('one.png', 'image/png', [1])])

    textarea.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(nativeDrop).toHaveBeenCalledTimes(1)
    expect(bench.input.state.getSnapshot().draft).toBe('')
    expect(bench.input.state.getSnapshot().occurrences).toEqual([])
    bench.dispose()
  })

  it('bridges pasted images with no model signal instead of releasing them natively (A25, harness agent composer)', async () => {
    const bench = fakeClient('')
    // Composer WITHOUT the model-selector button and no modelDirectories
    // service: the picker has no signal. That must take the text-safe bridge,
    // because a native release would insert a raw image block that pi-ai
    // text-only models reject with UNSUPPORTED_CONTENT (agentHome 41683fc5).
    const card = document.createElement('div')
    card.dataset.composerCard = ''
    const textarea = document.createElement('textarea')
    card.appendChild(textarea)
    document.body.appendChild(card)
    const nativePaste = vi.fn()
    textarea.addEventListener('paste', nativePaste)
    const request = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.body).toBeInstanceOf(File)
      return new Response(JSON.stringify({
        ok: true,
        value: { absolutePath: '/workspace/.dsh-vision-cloud/tmp/pasted-images/a/no-signal-01.png' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', request)

    const event = clipboardEvent('', [file('one.png', 'image/png', [1])])
    textarea.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(nativePaste).not.toHaveBeenCalled()
    const snapshot = bench.input.state.getSnapshot()
    expect(snapshot.draft.match(/\uFFFC/gu)).toHaveLength(1)
    expect(snapshot.occurrences).toHaveLength(1)
    expect(snapshot.imageIds).toEqual([])

    await flushTasks()
    const codec = bench.source()?.codec
    if (codec === undefined) throw new Error('paste source was not registered')
    const refs = snapshot.occurrences.map(row => row.ref)
    const [serialized] = await Promise.all(refs.map(ref => codec.serialize(ref, new AbortController().signal)))
    expect(serialized).toContain('[Pasted image available at absolute path: "/workspace/.dsh-vision-cloud/tmp/pasted-images/a/no-signal-01.png"]')
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls.every(([url]) => String(url).startsWith('/_dsh/vision-cloud/paste-images?'))).toBe(true)
    bench.dispose()
  })

  it('bridges dropped images with no model signal instead of releasing them natively (A25 drop, harness agent composer)', async () => {
    const bench = fakeClient('')
    const card = document.createElement('div')
    card.dataset.composerCard = ''
    const textarea = document.createElement('textarea')
    card.appendChild(textarea)
    document.body.appendChild(card)
    const nativeDrop = vi.fn()
    textarea.addEventListener('drop', nativeDrop)

    const event = dropEvent('caption', [file('one.png', 'image/png', [1])])
    textarea.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(nativeDrop).not.toHaveBeenCalled()
    const snapshot = bench.input.state.getSnapshot()
    expect(snapshot.draft).toContain('caption')
    expect(snapshot.draft.match(/\uFFFC/gu)).toHaveLength(1)
    expect(snapshot.occurrences).toHaveLength(1)
    expect(snapshot.imageIds).toEqual([])
    await flushTasks()
    const codec = bench.source()?.codec
    if (codec === undefined) throw new Error('paste source was not registered')
    const refs = snapshot.occurrences.map(row => row.ref)
    const [serialized] = await Promise.all(refs.map(ref => codec.serialize(ref, new AbortController().signal)))
    expect(serialized).toContain('[Pasted image available at absolute path:')
    bench.dispose()
  })

  // ---- A27/A28: URL-only drops/pastes (dragging a bridged tile back) ----

  const TILE_URL = (sessionId: string, name: string) =>
    `http://127.0.0.1:57631/_dsh/vision-cloud/paste-images/file?sessionId=${sessionId}&name=${encodeURIComponent(name)}`

  function urlDropEvent(urls: string[], text = ''): DragEvent {
    const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
    const data = {
      items: [] as Array<Record<string, unknown>>,
      files: [] as File[],
      types: ['text/uri-list', 'text/plain'],
      getData: (type: string) => type === 'text/uri-list' ? urls.join('\n') : text,
    }
    Object.defineProperty(event, 'dataTransfer', { value: data })
    return event
  }

  function fetchWith(fileBytes: Record<string, number[] | 'missing'>, takeover: boolean, uploadLeaf: string) {
    return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url)
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({
          ok: true,
          value: { absolutePath: `/workspace/.dsh-vision-cloud/tmp/pasted-images/a/${uploadLeaf}` },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (target.includes('/paste-images/file?')) {
        const name = new URL(target, 'http://local.test').searchParams.get('name') ?? ''
        const entry = fileBytes[name]
        if (entry === undefined || entry === 'missing') return new Response('missing', { status: 404 })
        return new Response(Uint8Array.from(entry), { status: 200, headers: { 'Content-Type': 'image/png' } })
      }
      return new Response(JSON.stringify({ takeover }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
  }

  it('bridges a dropped bridge-URL back into the composer instead of leaking text (A27 drop, no model signal)', async () => {
    const bench = fakeClient('')
    const card = document.createElement('div')
    card.dataset.composerCard = ''
    const textarea = document.createElement('textarea')
    card.appendChild(textarea)
    document.body.appendChild(card)
    const nativeDrop = vi.fn()
    textarea.addEventListener('drop', nativeDrop)
    const name = '746d1eff-1505-4a6a-970c-e35927b0bfc9-moe.png'
    const request = fetchWith({ [name]: [137, 80, 78, 71] }, true, 're-dropped-tile.png')
    vi.stubGlobal('fetch', request)

    const event = urlDropEvent([TILE_URL('session-1', name)])
    textarea.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(nativeDrop).not.toHaveBeenCalled()
    await flushTasks()
    const snapshot = bench.input.state.getSnapshot()
    expect(snapshot.draft).not.toContain('/_dsh/')
    expect(snapshot.draft).not.toContain('127.0.0.1')
    expect(snapshot.draft.match(/\uFFFC/gu)).toHaveLength(1)
    expect(snapshot.occurrences).toHaveLength(1)
    expect(snapshot.imageIds).toEqual([])

    const codec = bench.source()?.codec
    if (codec === undefined) throw new Error('paste source was not registered')
    const [serialized] = await Promise.all(snapshot.occurrences.map(row => codec.serialize(row.ref, new AbortController().signal)))
    expect(serialized).toContain('[Pasted image available at absolute path: "/workspace/.dsh-vision-cloud/tmp/pasted-images/a/re-dropped-tile.png"]')
    expect(request.mock.calls.some(([url]) => String(url).includes('/paste-images/file?'))).toBe(true)
    bench.dispose()
  })

  it('reuses the uploaded record when the same tile is dropped again (A27 reuse)', async () => {
    const bench = fakeClient('')
    const textarea = composer()
    vi.stubGlobal('fetch', fetchWith({}, true, 'drop-01.png'))
    await armTakeover()

    textarea.dispatchEvent(dropEvent('', [file('drop-01.png', 'image/png', [1])]))
    await flushTasks()
    const codec = bench.source()?.codec
    if (codec === undefined) throw new Error('paste source was not registered')
    const first = bench.input.state.getSnapshot().occurrences
    expect(first).toHaveLength(1)
    const [firstSerialized] = await Promise.all(first.map(row => codec.serialize(row.ref, new AbortController().signal)))
    expect(firstSerialized).toContain('[Pasted image available at absolute path: "/workspace/.dsh-vision-cloud/tmp/pasted-images/a/drop-01.png"]')

    const fetchNow = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url)
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({
          ok: true,
          value: { absolutePath: '/workspace/.dsh-vision-cloud/tmp/pasted-images/a/drop-01.png' },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (target.includes('/paste-images/file?')) return new Response('missing', { status: 404 })
      return new Response(JSON.stringify({ takeover: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchNow)

    const event = urlDropEvent([TILE_URL('session-1', 'drop-01.png')])
    textarea.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    await flushTasks()
    const snapshot = bench.input.state.getSnapshot()
    expect(snapshot.draft.match(/\uFFFC/gu)).toHaveLength(2)
    const second = snapshot.occurrences.find(row => row.occurrenceId === 2)
    if (second === undefined) throw new Error('second occurrence was not inserted')
    const [secondSerialized] = await Promise.all([codec.serialize(second.ref, new AbortController().signal)])
    expect(secondSerialized).toContain('[Pasted image available at absolute path: "/workspace/.dsh-vision-cloud/tmp/pasted-images/a/drop-01.png"]')
    // Reused records resolve without a new download or a second upload POST.
    expect(fetchNow.mock.calls.some(([url]) => String(url).includes('/paste-images/file?'))).toBe(false)
    expect(fetchNow.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
    bench.dispose()
  })

  it('gives a confirmed multimodal model a real image block when a bridged tile is dropped back (A28 native)', async () => {
    const bench = fakeClient('')
    const textarea = composer()
    const nativeDrop = vi.fn()
    textarea.addEventListener('drop', nativeDrop)
    const name = 'tile.png'
    vi.stubGlobal('fetch', fetchWith({ [name]: [137, 80, 78, 71] }, false, 'unused.png'))
    await armTakeover()

    const event = urlDropEvent([TILE_URL('session-1', name)])
    textarea.dispatchEvent(event)

    // The URL is never released as text, even when the verdict is native.
    expect(event.defaultPrevented).toBe(true)
    expect(bench.input.state.getSnapshot().draft).toBe('')
    await flushTasks()
    expect(nativeDrop).toHaveBeenCalledTimes(1)
    const drop = nativeDrop.mock.calls[0]?.[0] as DragEvent | undefined
    const droppedFiles = drop === undefined ? [] : Array.from(drop.dataTransfer?.files ?? [])
    expect(droppedFiles).toHaveLength(1)
    expect(droppedFiles[0]?.name).toBe(name)
    expect(bench.input.state.getSnapshot().occurrences).toEqual([])
    bench.dispose()
  })

  it('notifies instead of leaking text when the tile can no longer be fetched (A28 fallback)', async () => {
    const bench = fakeClient('')
    const textarea = composer()
    await armTakeover()
    vi.stubGlobal('fetch', fetchWith({}, true, 'unused.png'))

    const event = urlDropEvent([TILE_URL('session-1', 'gone.png')])
    textarea.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    await flushTasks()
    expect(bench.input.notify).toHaveBeenCalledWith('error', expect.stringContaining('no longer available'))
    expect(bench.input.state.getSnapshot().draft).toBe('')
    expect(bench.input.state.getSnapshot().occurrences).toEqual([])
    bench.dispose()
  })

  it('leaves ordinary text drops native when the payload has no bridge route (A28c)', () => {
    const bench = fakeClient('')
    const textarea = composer()
    const nativeDrop = vi.fn()
    textarea.addEventListener('drop', nativeDrop)

    const event = urlDropEvent(['https://example.com/not-a-bridge.txt'], 'plain text drag')
    textarea.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(nativeDrop).toHaveBeenCalledTimes(1)
    expect(bench.input.state.getSnapshot().draft).toBe('')
    bench.dispose()
  })

  it('bridges a pasted bridge-URL instead of leaking text into the draft (A27 paste, no model signal)', async () => {
    const bench = fakeClient('')
    const card = document.createElement('div')
    card.dataset.composerCard = ''
    const textarea = document.createElement('textarea')
    card.appendChild(textarea)
    document.body.appendChild(card)
    const nativePaste = vi.fn()
    textarea.addEventListener('paste', nativePaste)
    const name = 'pasted.png'
    vi.stubGlobal('fetch', fetchWith({ [name]: [137, 80, 78, 71] }, true, 'pasted-tile.png'))

    const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(event, 'clipboardData', {
      value: {
        items: [] as Array<Record<string, unknown>>,
        files: [] as File[],
        types: ['text/plain'],
        getData: () => TILE_URL('session-1', name),
      },
    })
    textarea.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(nativePaste).not.toHaveBeenCalled()
    await flushTasks()
    const snapshot = bench.input.state.getSnapshot()
    expect(snapshot.draft).not.toContain('/_dsh/')
    expect(snapshot.draft.match(/\uFFFC/gu)).toHaveLength(1)
    expect(snapshot.occurrences).toHaveLength(1)
    bench.dispose()
  })

  // ---- A29: tile drags carrying BOTH files and bridge-route URL text ----

  function fileUrlDropEvent(url: string, files: File[], text = ''): DragEvent {
    const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent
    const data = {
      items: files.map(value => ({ kind: 'file', type: value.type, getAsFile: () => value })),
      files,
      types: ['text/uri-list', 'text/plain', 'Files'],
      getData: (type: string) => type === 'text/uri-list' ? url : type === 'text/plain' ? text : '',
    }
    Object.defineProperty(event, 'dataTransfer', { value: data })
    return event
  }

  function fileUrlPasteEvent(url: string, files: File[], text = ''): ClipboardEvent {
    const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    const data = {
      items: files.map(value => ({ kind: 'file', type: value.type, getAsFile: () => value })),
      files,
      types: ['text/uri-list', 'text/plain', 'Files'],
      getData: (type: string) => type === 'text/uri-list' ? url : type === 'text/plain' ? text : '',
    }
    Object.defineProperty(event, 'clipboardData', { value: data })
    return event
  }

  it('strips the file-route URL out of a tile drag that also carries files (A29 drop)', async () => {
    const bench = fakeClient('')
    const textarea = composer()
    const nativeDrop = vi.fn()
    textarea.addEventListener('drop', nativeDrop)
    const name = 'e313d5f3-4b06-461d-9032-aef10ff480f8-file.png'
    vi.stubGlobal('fetch', fetchWith({}, true, 're-uploaded.png'))

    const mark = `url-${name.slice(0, name.lastIndexOf('.'))} [Pasted image available at absolute path: "D:\\\\agentHome\\\\.dsh-vision-cloud\\\\tmp\\\\pasted-images\\\\a\\\\${name}"] ![file.png](<${TILE_URL('session-1', name)}>) ${TILE_URL('session-1', name)}`
    const event = fileUrlDropEvent(TILE_URL('session-1', name), [file('file.png', 'image/png', [1])], mark)
    textarea.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(nativeDrop).not.toHaveBeenCalled()
    await flushTasks()
    const snapshot = bench.input.state.getSnapshot()
    expect(snapshot.draft).not.toContain('/_dsh/')
    expect(snapshot.draft).not.toContain('127.0.0.1')
    expect(snapshot.draft).not.toContain('url-')
    expect(snapshot.draft).not.toContain('[pasted image:')
    expect(snapshot.draft).not.toContain('Pasted image available at absolute path')
    expect(snapshot.draft.match(/\uFFFC/gu)).toHaveLength(1)
    expect(snapshot.occurrences).toHaveLength(1)
    expect(snapshot.imageIds).toEqual([])

    const codec = bench.source()?.codec
    if (codec === undefined) throw new Error('paste source was not registered')
    const [serialized] = await Promise.all(snapshot.occurrences.map(row => codec.serialize(row.ref, new AbortController().signal)))
    expect(serialized).toContain('[Pasted image available at absolute path: "/workspace/.dsh-vision-cloud/tmp/pasted-images/a/re-uploaded.png"]')
    bench.dispose()
  })

  it('keeps a real caption while stripping the tile URL (A29 caption)', async () => {
    const bench = fakeClient('')
    const textarea = composer()
    vi.stubGlobal('fetch', fetchWith({}, true, 'captioned.png'))
    await armTakeover()

    const event = fileUrlDropEvent(TILE_URL('session-1', 'tile.png'), [file('file.png', 'image/png', [1])], '帮我看看')
    textarea.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    await flushTasks()
    const snapshot = bench.input.state.getSnapshot()
    expect(snapshot.draft).toContain('帮我看看')
    expect(snapshot.draft).not.toContain('/_dsh/')
    expect(snapshot.draft.match(/\uFFFC/gu)).toHaveLength(1)
    expect(snapshot.occurrences).toHaveLength(1)
    bench.dispose()
  })

  it('reuses the uploaded record when a tile drag URL names it (A29 reuse)', async () => {
    const bench = fakeClient('')
    const textarea = composer()
    vi.stubGlobal('fetch', fetchWith({}, true, 'drop-01.png'))
    await armTakeover()

    textarea.dispatchEvent(dropEvent('', [file('drop-01.png', 'image/png', [1])]))
    await flushTasks()
    const codec = bench.source()?.codec
    if (codec === undefined) throw new Error('paste source was not registered')
    const first = bench.input.state.getSnapshot().occurrences
    expect(first).toHaveLength(1)
    await Promise.all(first.map(row => codec.serialize(row.ref, new AbortController().signal)))

    const fetchNow = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url)
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({
          ok: true,
          value: { absolutePath: '/workspace/.dsh-vision-cloud/tmp/pasted-images/a/drop-01.png' },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({ takeover: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchNow)

    // Tile drag: files carry the same image; the text carries the file-route URL.
    textarea.dispatchEvent(fileUrlDropEvent(TILE_URL('session-1', 'drop-01.png'), [file('file.png', 'image/png', [1])]))
    await flushTasks()

    const snapshot = bench.input.state.getSnapshot()
    expect(snapshot.draft).not.toContain('/_dsh/')
    expect(snapshot.draft.match(/\uFFFC/gu)).toHaveLength(2)
    expect(snapshot.occurrences).toHaveLength(2)
    expect(snapshot.occurrences[1]?.ref).toBe(snapshot.occurrences[0]?.ref)
    expect(fetchNow.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
    bench.dispose()
  })

  it('strips the URL out of a tile paste that also carries files (A29 paste)', async () => {
    const bench = fakeClient('')
    const textarea = composer()
    const nativePaste = vi.fn()
    textarea.addEventListener('paste', nativePaste)
    vi.stubGlobal('fetch', fetchWith({}, true, 'pasted-tile.png'))
    await armTakeover()

    const event = fileUrlPasteEvent(TILE_URL('session-1', 'pasted-name.png'), [file('file.png', 'image/png', [1])])
    textarea.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(nativePaste).not.toHaveBeenCalled()
    await flushTasks()
    const snapshot = bench.input.state.getSnapshot()
    expect(snapshot.draft).not.toContain('/_dsh/')
    expect(snapshot.draft.match(/\uFFFC/gu)).toHaveLength(1)
    expect(snapshot.occurrences).toHaveLength(1)
    bench.dispose()
  })

  it('strips bridge markup from a mixed file+URL paste on a confirmed multimodal verdict (A29 native paste)', async () => {
    const bench = fakeClient('')
    const textarea = composer()
    const nativePaste = vi.fn()
    textarea.addEventListener('paste', nativePaste)
    const name = 'tile.png'
    const mark = `[Pasted image available at absolute path: "D:\\agentHome\\.dsh-vision-cloud\\tmp\\pasted-images\\a\\${name}"]\n\n![file.png](<${TILE_URL('session-1', name)}>)`
    vi.stubGlobal('fetch', fetchWith({}, false, 'unused.png'))
    await armTakeover()

    const event = fileUrlPasteEvent(TILE_URL('session-1', name), [file('file.png', 'image/png', [1])], mark)
    textarea.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    await flushTasks()
    const snapshot = bench.input.state.getSnapshot()
    expect(snapshot.draft).not.toContain('Pasted image available')
    expect(snapshot.draft).not.toContain('/_dsh/')
    expect(nativePaste).toHaveBeenCalledTimes(1)
    const pasted = nativePaste.mock.calls[0]?.[0] as ClipboardEvent | undefined
    const pastedText = pasted?.clipboardData?.getData('text/plain') ?? ''
    expect(pastedText).not.toContain('Pasted image available')
    expect(pastedText).not.toContain('/_dsh/')
    expect(pasted?.clipboardData?.files).toHaveLength(1)
    bench.dispose()
  })

  it('strips bridge markup from a mixed file+URL drop on a confirmed multimodal verdict (A29 native drop)', async () => {
    const bench = fakeClient('')
    const textarea = composer()
    const nativeDrop = vi.fn()
    textarea.addEventListener('drop', nativeDrop)
    const name = 'tile.png'
    const mark = `[Pasted image available at absolute path: "D:\\agentHome\\.dsh-vision-cloud\\tmp\\pasted-images\\a\\${name}"]\n\n![file.png](<${TILE_URL('session-1', name)}>)`
    vi.stubGlobal('fetch', fetchWith({}, false, 'unused.png'))
    await armTakeover()

    const event = fileUrlDropEvent(TILE_URL('session-1', name), [file('file.png', 'image/png', [1])], mark)
    textarea.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    await flushTasks()
    const snapshot = bench.input.state.getSnapshot()
    expect(snapshot.draft).not.toContain('Pasted image available')
    expect(snapshot.draft).not.toContain('/_dsh/')
    expect(nativeDrop).toHaveBeenCalledTimes(1)
    const dropped = nativeDrop.mock.calls[0]?.[0] as DragEvent | undefined
    const droppedText = dropped?.dataTransfer?.getData('text/plain') ?? ''
    expect(droppedText).not.toContain('Pasted image available')
    expect(droppedText).not.toContain('/_dsh/')
    expect(dropped?.dataTransfer?.files).toHaveLength(1)
    bench.dispose()
  })

  it('ignores non-image clipboard files so ordinary text paste remains native', () => {
    const bench = fakeClient('before ')
    const textarea = composer()
    const nativePaste = vi.fn()
    textarea.addEventListener('paste', nativePaste)
    const event = clipboardEvent('plain text', [file('notes.txt', 'text/plain', [1])])

    textarea.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(nativePaste).toHaveBeenCalledTimes(1)
    expect(bench.input.state.getSnapshot().draft).toBe('before ')
    expect(bench.input.state.getSnapshot().occurrences).toEqual([])
    bench.dispose()
  })

  it('preserves same-paste text when image admission fails', async () => {
    const bench = fakeClient('before ')
    const textarea = composer()
    textarea.value = 'before '
    textarea.setSelectionRange(7, 7)
    const images = Array.from({ length: 21 }, (_, index) => file(`${index}.png`, 'image/png', [index]))
    const event = clipboardEvent('caption', images)

    await armTakeover()
    textarea.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(bench.input.state.getSnapshot().draft).toBe('before caption')
    expect(bench.input.state.getSnapshot().occurrences).toEqual([])
    expect(bench.input.notify).toHaveBeenCalledWith('error', 'Paste at most 20 images at a time')
    bench.dispose()
  })

  it('removes references through insertText so later occurrence offsets stay current', async () => {
    const bench = fakeClient('')
    const textarea = composer()
    await armTakeover()
    textarea.dispatchEvent(clipboardEvent('', [
      file('one.png', 'image/png', [1]),
      file('two.png', 'image/png', [2]),
      file('three.png', 'image/png', [3]),
    ]))
    const dock = bench.registrations.find(row => row.options.id === 'vision-cloud-pasted-images')
    if (dock === undefined) throw new Error('paste dock was not registered')
    const injected = (dock.options.inject as ((sessionId: string) => {
      controller: PasteImageController
      remove: (row: Occurrence) => void
    }))('session-1')
    const original = bench.input.state.getSnapshot().occurrences
    const first = original[0]
    if (first === undefined) throw new Error('first occurrence was not inserted')
    const firstRev = bench.input.state.getSnapshot().draftRev

    injected.remove(first)

    expect(bench.input.insertText).toHaveBeenLastCalledWith('', {
      start: first.offset,
      end: first.offset + 1,
      draftRev: firstRev,
    })
    const afterFirst = bench.input.state.getSnapshot().occurrences
    expect(afterFirst.map(row => row.ref)).toEqual(original.slice(1).map(row => row.ref))
    expect(afterFirst.map(row => row.offset)).toEqual([1, 3])

    const staleLater = original[2]
    const currentLater = afterFirst[1]
    if (staleLater === undefined || currentLater === undefined) throw new Error('later occurrence was not retained')
    const laterRev = bench.input.state.getSnapshot().draftRev
    injected.remove(staleLater)

    expect(bench.input.insertText).toHaveBeenLastCalledWith('', {
      start: currentLater.offset,
      end: currentLater.offset + 1,
      draftRev: laterRev,
    })
    expect(bench.input.state.getSnapshot().occurrences.map(row => row.ref)).toEqual([original[1]?.ref])
    expect(injected.controller.recordsFor(original)).toHaveLength(1)
    bench.dispose()
  })

  it('retains a pasted image record when the occurrence-aware removal is rejected', async () => {
    const bench = fakeClient('')
    const textarea = composer()
    await armTakeover()
    textarea.dispatchEvent(clipboardEvent('', [file('one.png', 'image/png', [1])]))
    const dock = bench.registrations.find(row => row.options.id === 'vision-cloud-pasted-images')
    if (dock === undefined) throw new Error('paste dock was not registered')
    const injected = (dock.options.inject as ((sessionId: string) => {
      controller: PasteImageController
      remove: (row: Occurrence) => void
    }))('session-1')
    const occurrence = bench.input.state.getSnapshot().occurrences[0]
    if (occurrence === undefined) throw new Error('paste occurrence was not inserted')
    bench.input.insertText.mockReturnValueOnce(false)

    injected.remove(occurrence)

    expect(bench.input.state.getSnapshot().occurrences).toEqual([occurrence])
    expect(injected.controller.recordsFor([occurrence])).toHaveLength(1)
    bench.dispose()
  })

  it('reuses successful workspace paths and retries only records still missing a path', async () => {
    const bench = fakeClient('')
    const textarea = composer()
    await armTakeover()
    let secondAttempts = 0
    const request = vi.fn(async (url: string) => {
      const name = new URL(String(url), 'http://localhost').searchParams.get('name')
      if (name === 'one.png') {
        return new Response(JSON.stringify({
          ok: true,
          value: { absolutePath: '/workspace/.dsh-vision-cloud/tmp/pasted-images/a/stable-one.png' },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      secondAttempts += 1
      if (secondAttempts === 1) {
        return new Response(JSON.stringify({
          ok: false,
          error: { message: 'second copy failed' },
        }), { status: 409, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        ok: true,
        value: { absolutePath: '/workspace/.dsh-vision-cloud/tmp/pasted-images/a/retried-two.png' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', request)
    textarea.dispatchEvent(clipboardEvent('', [
      file('one.png', 'image/png', [1]),
      file('two.png', 'image/png', [2]),
    ]))
    const occurrences = bench.input.state.getSnapshot().occurrences
    const first = occurrences[0]
    const second = occurrences[1]
    if (first === undefined || second === undefined) throw new Error('paste occurrences were not inserted')
    const codec = bench.source()?.codec
    if (codec === undefined) throw new Error('paste source was not registered')

    await expect(codec.serialize(first.ref, new AbortController().signal)).rejects.toThrow('second copy failed')
    expect(request).toHaveBeenCalledTimes(2)

    const secondText = await codec.serialize(second.ref, new AbortController().signal)
    expect(request).toHaveBeenCalledTimes(3)
    const names = request.mock.calls.map(([url]) => new URL(String(url), 'http://localhost').searchParams.get('name'))
    expect(names).toEqual(['one.png', 'two.png', 'two.png'])
    expect(secondText).toBe('[Pasted image available at absolute path: "/workspace/.dsh-vision-cloud/tmp/pasted-images/a/retried-two.png"]\n\n![two.png](</_dsh/vision-cloud/paste-images/file?sessionId=session-1&name=retried-two.png>)')

    const firstText = await codec.serialize(first.ref, new AbortController().signal)
    expect(request).toHaveBeenCalledTimes(3)
    expect(firstText).toBe('[Pasted image available at absolute path: "/workspace/.dsh-vision-cloud/tmp/pasted-images/a/stable-one.png"]\n\n![one.png](</_dsh/vision-cloud/paste-images/file?sessionId=session-1&name=stable-one.png>)')
    bench.dispose()
  })

  it('keeps failed serialization out of the model send and exposes retry/removal feedback', async () => {
    const bench = fakeClient('')
    const textarea = composer()
    await armTakeover()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: false,
      error: { message: 'workspace copy failed' },
    }), { status: 409, headers: { 'Content-Type': 'application/json' } })))
    textarea.dispatchEvent(clipboardEvent('', [file('broken.png', 'image/png', [1])]))
    const occurrence = bench.input.state.getSnapshot().occurrences[0]
    if (occurrence === undefined) throw new Error('paste occurrence was not inserted')
    const codec = bench.source()?.codec
    if (codec === undefined) throw new Error('paste source was not registered')
    const modelSink = vi.fn()
    const send = async () => { modelSink(await codec.serialize(occurrence.ref, new AbortController().signal)) }

    await expect(send()).rejects.toThrow('workspace copy failed')
    expect(modelSink).not.toHaveBeenCalled()
    const dock = bench.registrations.find(row => row.options.id === 'vision-cloud-pasted-images')
    expect(dock).toBeDefined()

    const injected = (dock?.options.inject as ((sessionId: string) => { controller: PasteImageController; remove: (row: Occurrence) => void }))('session-1')
    const controller = injected.controller
    expect(controller.recordsFor([occurrence])[0]?.status).toBe('error')
    if (dock === undefined) throw new Error('paste dock was not registered')
    render(createElement(dock.component, { input: bench.input.state.getSnapshot(), ...injected }))
    const preview = screen.getByRole('button', { name: '预览 broken.png' })
    expect(preview.getAttribute('title')).toBe('workspace copy failed')
    const remove = screen.getByRole('button', { name: '移除 broken.png' })
    expect(screen.queryByText('broken.png')).toBeNull()
    expect(screen.queryByText('workspace copy failed')).toBeNull()
    fireEvent.click(remove)
    expect(bench.input.state.getSnapshot().occurrences).toEqual([])
    expect(controller.recordsFor([occurrence])).toEqual([])
    bench.dispose()
  })

  it('sends the exact provider/model pair from the live model-selection store and refetches on selection changes (A2)', async () => {
    let current: { provider: string; model: string } | null = { provider: 'abrdns', model: 'DeepSeek-V4-Pro-0813' }
    const listeners = new Set<() => void>()
    const directory = {
      store: {
        getSnapshot: () => ({ current }),
        subscribe: (listener: () => void) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      },
    }
    const bench = fakeClient('', ['slash'], false, {
      modelDirectories: { directoryFor: vi.fn(() => directory) },
    })
    composer()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ takeover: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await armTakeover()
    const paramsOf = (index: number) => new URL(String(fetchMock.mock.calls[index]?.[0]), 'http://localhost').searchParams
    expect(paramsOf(0).get('provider')).toBe('abrdns')
    expect(paramsOf(0).get('model')).toBe('DeepSeek-V4-Pro-0813')
    expect(paramsOf(0).get('sessionId')).toBe('session-1')

    current = { provider: 'abrdns', model: 'Qwen3.8-Max' }
    for (const listener of listeners) listener()
    await flushTasks()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(paramsOf(1).get('provider')).toBe('abrdns')
    expect(paramsOf(1).get('model')).toBe('Qwen3.8-Max')

    // The refreshed verdict cache now decides for the NEW selection.
    const textarea = document.querySelector<HTMLTextAreaElement>('[data-composer-card] textarea')
    if (textarea === null) throw new Error('composer textarea missing')
    textarea.dispatchEvent(clipboardEvent('', [file('one.png', 'image/png', [1])]))
    expect(bench.input.state.getSnapshot().occurrences).toHaveLength(1)
    bench.dispose()
  })

  it('falls back to the DOM selector label when modelDirectories rejects the session (A2b/E21)', async () => {
    const bench = fakeClient('', ['slash'], false, {
      modelDirectories: { directoryFor: () => { throw new Error('subagent composer') } },
    })
    composer()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ takeover: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await armTakeover()
    const params = new URL(String(fetchMock.mock.calls[0]?.[0]), 'http://localhost').searchParams
    expect(params.has('provider')).toBe(false)
    expect(params.get('model')).toContain('DeepSeek-V4-Flash')
    bench.dispose()
  })
it('reconciles native draft images into bridge refs after switching to a text-only model (issue 1)', async () => {
    let current: { provider: string; model: string } = { provider: 'abrdns', model: 'Qwen3.8-Max' }
    const listeners = new Set<() => void>()
    const directory = {
      store: {
        getSnapshot: () => ({ current }),
        subscribe: (listener: () => void) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      },
    }
    const native = file('native.png', 'image/png', [1, 2, 3])
    const draftFace = {
      draftImages: vi.fn(() => [{ id: 'draft-native', file: native, previewUrl: 'blob:native-preview' }]),
      releaseDraftImages: vi.fn(),
    }
    const bench = fakeClient('描述这张图', ['slash'], false, {
      modelDirectories: { directoryFor: vi.fn(() => directory) },
      conversation: draftFace,
    })
    composer()
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({
          ok: true,
          value: { absolutePath: 'D:\\workspace\\.dsh-vision-cloud\\tmp\\pasted-images\\a\\native.png' },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      const params = new URL(String(url), 'http://localhost').searchParams
      return new Response(JSON.stringify({ takeover: params.get('model') === 'DeepSeek-V4-Pro-0813' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    await armTakeover() // registers the per-session model-store subscription
    bench.input.addImages(['draft-native'])
    expect(bench.input.state.getSnapshot().imageIds).toEqual(['draft-native'])

    current = { provider: 'abrdns', model: 'DeepSeek-V4-Pro-0813' }
    for (const listener of listeners) listener()
    await flushTasks()

    expect(bench.input.state.getSnapshot().imageIds).toEqual([])
    expect(bench.input.removeImage).toHaveBeenCalledWith('draft-native')
    expect(draftFace.draftImages).toHaveBeenCalledWith(['draft-native'])
    expect(draftFace.releaseDraftImages).toHaveBeenCalledTimes(1)
    expect(bench.input.state.getSnapshot().occurrences).toHaveLength(1)
    expect(bench.input.state.getSnapshot().draft).toContain('描述这张图')
      expect(bench.input.state.getSnapshot().draft.endsWith('\uFFFC')).toBe(true)
    expect(bench.input.state.getSnapshot().draft.match(/\uFFFC/gu)).toHaveLength(1)
    expect(bench.input.notify).not.toHaveBeenCalledWith('info', expect.stringContaining('converted to workspace paths'))

    const codec = bench.source()?.codec
    if (codec === undefined) throw new Error('paste source was not registered')
    const occurrence = bench.input.state.getSnapshot().occurrences[0]
    if (occurrence === undefined) throw new Error('bridge occurrence missing')
    const serialized = await codec.serialize(occurrence.ref, new AbortController().signal)
    expect(serialized).toContain('[Pasted image available at absolute path:')
    expect(serialized).toContain('native.png')
    bench.dispose()
  })

  it('cleans leaked bridge markup from the draft when switching native images to bridge refs', async () => {
    let current: { provider: string; model: string } = { provider: 'abrdns', model: 'Qwen3.8-Max' }
    const listeners = new Set<() => void>()
    const directory = {
      store: {
        getSnapshot: () => ({ current }),
        subscribe: (listener: () => void) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      },
    }
    const native = file('native.png', 'image/png', [1, 2, 3])
    const draftFace = {
      draftImages: vi.fn(() => [{ id: 'draft-native', file: native, previewUrl: 'blob:native-preview' }]),
      releaseDraftImages: vi.fn(),
    }
    const name = 'native.png'
    const dirty = `描述一下 [Pasted image available at absolute path: "D:\\tmp\\pasted-images\\${name}"]\n\n![native.png](<${TILE_URL('session-1', name)}>)`
    const bench = fakeClient(dirty, ['slash'], false, {
      modelDirectories: { directoryFor: vi.fn(() => directory) },
      conversation: draftFace,
    })
    composer()
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({
          ok: true,
          value: { absolutePath: 'D:\\workspace\\.dsh-vision-cloud\\tmp\\pasted-images\\a\\native.png' },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      const params = new URL(String(url), 'http://localhost').searchParams
      return new Response(JSON.stringify({ takeover: params.get('model') === 'DeepSeek-V4-Pro-0813' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    await armTakeover()
    bench.input.addImages(['draft-native'])
    current = { provider: 'abrdns', model: 'DeepSeek-V4-Pro-0813' }
    for (const listener of listeners) listener()
    await flushTasks()

    const snapshot = bench.input.state.getSnapshot()
    expect(snapshot.imageIds).toEqual([])
    expect(snapshot.occurrences).toHaveLength(1)
    expect(snapshot.draft).toContain('描述一下')
    expect(snapshot.draft).not.toContain('Pasted image available')
    expect(snapshot.draft).not.toContain('/_dsh/')
    expect(snapshot.draft.match(/\uFFFC/gu)).toHaveLength(1)
    bench.dispose()
  })

  it('keeps native draft images when the fresh model verdict is unknown', async () => {
    let current: { provider: string; model: string } = { provider: 'abrdns', model: 'Qwen3.8-Max' }
    const listeners = new Set<() => void>()
    const directory = {
      store: {
        getSnapshot: () => ({ current }),
        subscribe: (listener: () => void) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      },
    }
    const draftFace = { draftImages: vi.fn(), releaseDraftImages: vi.fn() }
    const bench = fakeClient('不要丢图', ['slash'], false, {
      modelDirectories: { directoryFor: vi.fn(() => directory) },
      conversation: draftFace,
    })
    composer()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('bridge down') }))

    await armTakeover()
    bench.input.addImages(['draft-native'])
    current = { provider: 'abrdns', model: 'DeepSeek-V4-Pro-0813' }
    for (const listener of listeners) listener()
    await flushTasks()

    expect(bench.input.state.getSnapshot().imageIds).toEqual(['draft-native'])
    expect(bench.input.state.getSnapshot().occurrences).toEqual([])
    expect(bench.input.notify).toHaveBeenCalledWith(
      'error',
      'The image bridge is temporarily unreachable; native draft images were left unchanged.',
    )
    bench.dispose()
  })

  it('migrates cached-true native ids from the guarded submit path even when the switch reconciler missed them (issue 1)', async () => {
    const directory = {
      store: {
        getSnapshot: () => ({ current: { provider: 'abrdns', model: 'DeepSeek-V4-Pro-0813' } }),
        subscribe: () => () => {},
      },
    }
    const native = file('native.png', 'image/png', [1, 2, 3])
    const draftFace = {
      draftImages: vi.fn(() => [{ id: 'draft-native', file: native, previewUrl: 'blob:native-preview' }]),
      releaseDraftImages: vi.fn(),
    }
    const bench = fakeClient('图', ['slash'], false, {
      modelDirectories: { directoryFor: vi.fn(() => directory) },
      conversation: draftFace,
    })
    const original = vi.fn(() => {})
    ;(bench.input as unknown as { submit?: (mode?: string) => void }).submit = original
    composer()

    await armTakeover() // prefetch also arms the submit guard through currentPick/inputFor
    bench.input.addImages(['draft-native'])
    ;(bench.input as unknown as { submit?: (mode?: string) => void }).submit?.()

    // bridgeNativeDraft mutates synchronously but the guarded submit forwards through the settled promise.
    expect(draftFace.draftImages).toHaveBeenCalledWith(['draft-native'])
    expect(original).not.toHaveBeenCalled()
    await flushTasks()

    expect(original).toHaveBeenCalledTimes(1)
    expect(bench.input.state.getSnapshot().imageIds).toEqual([])
    expect(bench.input.state.getSnapshot().occurrences).toHaveLength(1)
    expect(bench.input.notify).not.toHaveBeenCalledWith('info', expect.stringContaining('converted to workspace paths'))
    bench.dispose()
  })

  it('does not leave display-only preview ids on submit-triggered migration (issue 1 regression)', async () => {
    const directory = {
      store: {
        getSnapshot: () => ({ current: { provider: 'abrdns', model: 'DeepSeek-V4-Pro-0813' } }),
        subscribe: () => () => {},
      },
    }
    const native = file('native.png', 'image/png', [1, 2, 3])
    const draftFace = {
      draftImages: vi.fn(() => [{ id: 'draft-native', file: native, previewUrl: 'blob:native-preview' }]),
      createDraftImages: vi.fn((files: readonly File[]) => files.map((value, index) => ({
        id: `preview-${index}`,
        file: value,
        previewUrl: `blob:preview-${index}`,
      }))),
      releaseDraftImages: vi.fn(),
      releaseDraftImage: vi.fn(),
    }
    const bench = fakeClient('图', ['slash'], false, {
      modelDirectories: { directoryFor: vi.fn(() => directory) },
      conversation: draftFace,
    })
    const original = vi.fn(() => {})
    ;(bench.input as unknown as { submit?: (mode?: string) => void }).submit = original
    composer()

    await armTakeover()
    bench.input.addImages(['draft-native'])
    ;(bench.input as unknown as { submit?: (mode?: string) => void }).submit?.()

    expect(original).not.toHaveBeenCalled()
    await flushTasks()

    expect(original).toHaveBeenCalledTimes(1)
    // The submit-triggered migration must not leave display-only preview ids behind.
    expect(bench.input.state.getSnapshot().imageIds).toEqual([])
    expect(bench.input.state.getSnapshot().occurrences).toHaveLength(1)
    expect(bench.input.notify).not.toHaveBeenCalledWith('info', expect.stringContaining('converted to workspace paths'))
    bench.dispose()
  })

  it('forwards native draft images untouched from the guarded submit path on a fresh multimodal verdict (issue 1)', async () => {
    const directory = {
      store: {
        getSnapshot: () => ({ current: { provider: 'abrdns', model: 'Qwen3.8-Max' } }),
        subscribe: () => () => {},
      },
    }
    const bench = fakeClient('图', ['slash'], false, {
      modelDirectories: { directoryFor: vi.fn(() => directory) },
    })
    const original = vi.fn(() => {})
    ;(bench.input as unknown as { submit?: (mode?: string) => void }).submit = original
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ takeover: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))
    composer()

    await armTakeover()
    bench.input.addImages(['draft-native'])
    ;(bench.input as unknown as { submit?: (mode?: string) => void }).submit?.()

    // The guard must not delay a confirmed native-capable submit.
    expect(original).toHaveBeenCalledTimes(1)
    expect(bench.input.state.getSnapshot().imageIds).toEqual(['draft-native'])
    bench.dispose()
  })

  it('holds a submit until the undecided verdict resolves true, then migrates native images (issue 1)', async () => {
    const directory = {
      store: {
        getSnapshot: () => ({ current: { provider: 'abrdns', model: 'DeepSeek-V4-Pro-0813' } }),
        subscribe: () => () => {},
      },
    }
    const native = file('native.png', 'image/png', [1, 2, 3])
    const draftFace = {
      draftImages: vi.fn(() => [{ id: 'draft-native', file: native, previewUrl: 'blob:native-preview' }]),
      releaseDraftImages: vi.fn(),
    }
    const bench = fakeClient('图', ['slash'], false, {
      modelDirectories: { directoryFor: vi.fn(() => directory) },
      conversation: draftFace,
    })
    const original = vi.fn(() => {})
    ;(bench.input as unknown as { submit?: (mode?: string) => void }).submit = original
    let resolveFetch: (response: Response) => void = () => {}
    const fetchMock = vi.fn(async () => new Promise<Response>(resolve => { resolveFetch = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    composer()

    await armTakeover() // starts, but never resolves, the model-capability verdict
    bench.input.addImages(['draft-native'])
    ;(bench.input as unknown as { submit?: (mode?: string) => void }).submit?.()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(original).not.toHaveBeenCalled()
    expect(draftFace.draftImages).not.toHaveBeenCalled()

    resolveFetch(new Response(JSON.stringify({ takeover: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    await flushTasks()

    expect(original).toHaveBeenCalledTimes(1)
    expect(draftFace.draftImages).toHaveBeenCalledWith(['draft-native'])
    expect(bench.input.state.getSnapshot().imageIds).toEqual([])
    expect(bench.input.state.getSnapshot().occurrences).toHaveLength(1)
    bench.dispose()
  })

  it('holds an undecided paste, then releases it natively when the verdict arrives false (A18)', async () => {
    const bench = fakeClient('')
    const textarea = composer()
    const nativePaste = vi.fn()
    textarea.addEventListener('paste', nativePaste)
    let resolveVerdict: (body: { takeover: boolean }) => void = () => {}
    const fetchMock = vi.fn(async () => {
      const body = await new Promise<{ takeover: boolean }>(resolve => { resolveVerdict = resolve })
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const event = clipboardEvent('caption', [file('one.png', 'image/png', [1])])
    textarea.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true) // held before any verdict
    expect(nativePaste).not.toHaveBeenCalled()
    expect(bench.input.state.getSnapshot().draft).toBe('')
    expect(bench.input.state.getSnapshot().occurrences).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveVerdict({ takeover: false })
    await flushTasks()

    expect(nativePaste).toHaveBeenCalledTimes(1)
    expect(bench.input.state.getSnapshot().occurrences).toEqual([])
    const replayed = nativePaste.mock.calls[0]?.[0] as ClipboardEvent
    expect(replayed.clipboardData?.getData('text/plain')).toBe('caption')
    expect(replayed.clipboardData?.files[0]?.name).toBe('one.png')
    bench.dispose()
  })

  it('holds an undecided paste, then bridges it when the verdict arrives true (A19)', async () => {
    const bench = fakeClient('')
    const textarea = composer()
    const nativePaste = vi.fn()
    textarea.addEventListener('paste', nativePaste)
    let resolveVerdict: (body: { takeover: boolean }) => void = () => {}
    const fetchMock = vi.fn(async () => {
      const body = await new Promise<{ takeover: boolean }>(resolve => { resolveVerdict = resolve })
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const event = clipboardEvent('caption', [file('one.png', 'image/png', [1])])
    textarea.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(bench.input.state.getSnapshot().occurrences).toEqual([])

    resolveVerdict({ takeover: true })
    await flushTasks()

    expect(nativePaste).not.toHaveBeenCalled()
    expect(bench.input.state.getSnapshot().draft).toContain('caption')
    expect(bench.input.state.getSnapshot().occurrences).toHaveLength(1)
    bench.dispose()
  })

  it('bridges text-safe and notifies once when the verdict fetch fails (A20)', async () => {
    const bench = fakeClient('')
    const textarea = composer()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('bridge unreachable') }))

    textarea.dispatchEvent(clipboardEvent('', [file('one.png', 'image/png', [1])]))
    expect(bench.input.state.getSnapshot().occurrences).toEqual([])
    await flushTasks()
    expect(bench.input.state.getSnapshot().occurrences).toHaveLength(1)
    expect(bench.input.notify).toHaveBeenCalledTimes(1)
    expect(String(bench.input.notify.mock.calls[0]?.[1])).toContain('bridge is temporarily unreachable')

    textarea.dispatchEvent(clipboardEvent('', [file('two.png', 'image/png', [2])]))
    await flushTasks()
    expect(bench.input.state.getSnapshot().occurrences).toHaveLength(2)
    expect(bench.input.notify).toHaveBeenCalledTimes(1) // one-time notice per retry window
    bench.dispose()
  })

  it('prefers the public image-draft API over synthetic replay when releasing natively (A21)', async () => {
    const createDraftImages = vi.fn((files: readonly File[]) => files.map(file => ({ id: `draft-${file.name}` })))
    const bench = fakeClient('', ['slash'], false, {
      conversation: { createDraftImages },
    })
    const textarea = composer()
    const nativePaste = vi.fn()
    textarea.addEventListener('paste', nativePaste)
    let resolveVerdict: (body: { takeover: boolean }) => void = () => {}
    const fetchMock = vi.fn(async () => {
      const body = await new Promise<{ takeover: boolean }>(resolve => { resolveVerdict = resolve })
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    textarea.dispatchEvent(clipboardEvent('caption', [file('one.png', 'image/png', [1])]))
    resolveVerdict({ takeover: false })
    await flushTasks()

    expect(createDraftImages).toHaveBeenCalledTimes(1)
    expect(bench.input.addImages).toHaveBeenCalledWith(['draft-one.png'])
    expect(bench.input.state.getSnapshot().imageIds).toEqual(['draft-one.png'])
    expect(bench.input.state.getSnapshot().draft).toBe('caption')
    expect(bench.input.state.getSnapshot().occurrences).toEqual([])
    expect(nativePaste).not.toHaveBeenCalled()
    bench.dispose()
  })

  it('keeps the conversation receiver bound when admitting draft images (A21b)', async () => {
    let receiver: unknown
    const conversation = {
      createDraftImages: function (this: unknown, files: readonly File[]) {
        receiver = this
        return files.map(value => ({ id: `draft-${value.name}` }))
      },
    }
    const bench = fakeClient('', ['slash'], false, { conversation })
    const textarea = composer()
    const nativePaste = vi.fn()
    textarea.addEventListener('paste', nativePaste)
    let resolveVerdict: (body: { takeover: boolean }) => void = () => {}
    const fetchMock = vi.fn(async () => {
      const body = await new Promise<{ takeover: boolean }>(resolve => { resolveVerdict = resolve })
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    textarea.dispatchEvent(clipboardEvent('caption', [file('one.png', 'image/png', [1])]))
    resolveVerdict({ takeover: false })
    await flushTasks()

    // The draft-admission method reads internal state off its receiver;
    // a detached call would run with `this === undefined` and throw.
    expect(receiver).toBe(conversation)
    expect(bench.input.addImages).toHaveBeenCalledWith(['draft-one.png'])
    expect(bench.input.state.getSnapshot().draft).toBe('caption')
    expect(nativePaste).not.toHaveBeenCalled()
    bench.dispose()
  })

  it('shows bridged images in the host native rail and strips display ids before submit (issue 3)', async () => {
    const releaseDraftImage = vi.fn()
    const conversation = {
      createDraftImages: (files: readonly File[]) => files.map(value => ({
        id: `preview-${value.name}`,
        file: value,
        previewUrl: `blob:preview-${value.name}`,
      })),
      releaseDraftImage,
      releaseDraftImages: vi.fn(),
    }
    const bench = fakeClient('描述', ['slash'], false, { conversation })
    const submitted = vi.fn(() => {})
    ;(bench.input as unknown as { submit?: (mode?: string) => void }).submit = submitted
    const textarea = composer()

    textarea.dispatchEvent(clipboardEvent('', [file('one.png', 'image/png', [1])]))
    await flushTasks()

    expect(bench.input.addImages).toHaveBeenCalledWith(['preview-one.png'])
    expect(bench.input.state.getSnapshot().imageIds).toEqual(['preview-one.png'])
    expect(bench.input.state.getSnapshot().occurrences).toHaveLength(1)

    ;(bench.input as unknown as { submit?: (mode?: string) => void }).submit?.()
    expect(submitted).toHaveBeenCalledTimes(1)
    expect(bench.input.state.getSnapshot().imageIds).toEqual([])
    expect(bench.input.state.getSnapshot().occurrences).toHaveLength(1)
    expect(releaseDraftImage).toHaveBeenCalledWith('preview-one.png')
    bench.dispose()
  })

  it('drops the bridge reference when the native-rail preview is removed (issue 3)', async () => {
    const conversation = {
      createDraftImages: (files: readonly File[]) => files.map(value => ({
        id: `preview-${value.name}`,
        file: value,
        previewUrl: `blob:preview-${value.name}`,
      })),
      releaseDraftImage: vi.fn(),
      releaseDraftImages: vi.fn(),
    }
    const bench = fakeClient('描述', ['slash'], false, { conversation })
    const textarea = composer()

    textarea.dispatchEvent(clipboardEvent('', [file('one.png', 'image/png', [1])]))
    await flushTasks()
    expect(bench.input.state.getSnapshot().imageIds).toEqual(['preview-one.png'])
    expect(bench.input.state.getSnapshot().draft).toContain('描述')
    expect(bench.input.state.getSnapshot().draft).toContain('￼')

    bench.input.removeImage('preview-one.png')
    await flushTasks()

    expect(bench.input.state.getSnapshot().imageIds).toEqual([])
    expect(bench.input.state.getSnapshot().occurrences).toEqual([])
    expect(bench.input.state.getSnapshot().draft.trim()).toBe('描述')
    bench.dispose()
  })


  it('registers low-priority shadows for the user and steering chat-node keys', () => {
    const bench = fakeClient('')
    const shadows = bench.registrations.filter(row => row.options.name === 'conversation.chat.node')
    expect(shadows.map(row => row.options.key)).toEqual(['user', 'steering'])
    for (const row of shadows) {
      expect(row.options.priority).toBe(-1000)
      expect(row.options.locale).toBe('conversation')
    }
    bench.dispose()
  })

  it('retries the verdict route after a 404 instead of disabling it forever (A17)', async () => {
    vi.useFakeTimers()
    try {
      const bench = fakeClient('')
      const textarea = composer()
      let down = true
      const fetchMock = vi.fn(async () => down
        ? new Response(JSON.stringify({ error: 'no bridge' }), { status: 404 })
        : new Response(JSON.stringify({ takeover: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      vi.stubGlobal('fetch', fetchMock)
      const paste = (name: string) => { textarea.dispatchEvent(clipboardEvent('', [file(name, 'image/png', [1])])) }

      paste('first.png')
      expect(fetchMock).toHaveBeenCalledTimes(1)
      await flushTasks()
      expect(bench.input.state.getSnapshot().occurrences).toHaveLength(1)

      paste('second.png')
      await flushTasks()
      expect(fetchMock).toHaveBeenCalledTimes(1) // inside the retry window
      expect(bench.input.state.getSnapshot().occurrences).toHaveLength(2)

      down = false
      await vi.advanceTimersByTimeAsync(31_000)
      paste('third.png')
      await flushTasks()
      expect(fetchMock).toHaveBeenCalledTimes(2) // probe recovered the route
      expect(bench.input.state.getSnapshot().occurrences).toHaveLength(3)
      bench.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders a named clickable image rail above the composer and revokes its blob on unmount (A10)', async () => {
    const createObjectURL = vi.fn(() => 'blob:preview')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true })
    try {
      const bench = fakeClient('')
      const textarea = composer()
      await armTakeover()
      textarea.dispatchEvent(clipboardEvent('', [file('one.png', 'image/png', [1])]))
      const dock = bench.registrations.find(row => row.options.id === 'vision-cloud-pasted-images')
      if (dock === undefined) throw new Error('paste dock was not registered')
      const injected = (dock.options.inject as ((sessionId: string) => {
        controller: PasteImageController
        remove: (row: Occurrence) => void
      }))('session-1')

      const { container, unmount } = render(createElement(dock.component, {
        input: bench.input.state.getSnapshot(),
        ...injected,
      }))
      const thumb = container.querySelector('img.dvt-paste-preview-img')
      expect(thumb?.getAttribute('src')).toBe('blob:preview')
      expect(container.querySelector('img')?.getAttribute('alt')).toBe('one.png')
      expect(container.textContent).not.toContain('one.png')
      expect(createObjectURL).toHaveBeenCalledTimes(1)

      // The rail behaves like the native rail: click opens a full preview.
      fireEvent.click(container.querySelector('button.dvt-paste-preview') as Element)
      const dialog = screen.getByRole('dialog')
      expect(dialog.querySelector('img')?.getAttribute('src')).toBe('blob:preview')

      unmount()
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview')
      bench.dispose()
    } finally {
      delete (URL as { createObjectURL?: unknown; revokeObjectURL?: unknown }).createObjectURL
      delete (URL as { createObjectURL?: unknown; revokeObjectURL?: unknown }).revokeObjectURL
    }
  })
})
