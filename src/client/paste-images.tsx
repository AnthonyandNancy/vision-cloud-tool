/** Clipboard and drag-and-drop multi-image input for DSH Web. */

import { useEffect, useSyncExternalStore, useState, type ReactNode } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ImageLightbox, UserMessageShadowBoundary } from './user-message-view.tsx'

const SOURCE = 'vision-cloud-pasted-image'
export const PASTE_IMAGES_ROUTE = '/_dsh/vision-cloud/paste-images'
const MAX_IMAGES = 20
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_BATCH_BYTES = 80 * 1024 * 1024

interface PasteRecord {
  ref: string
  file: File
  batch: PasteBatch
  status: 'ready' | 'copying' | 'copied' | 'error'
  error?: string | undefined
  absolutePath?: string | undefined
  /** Final server-derived leaf (SHA-256 addressed after upload), if saved. */
  filename?: string | undefined
}

interface PasteBatch {
  sessionId: string
  records: PasteRecord[]
  inflight?: Promise<void> | undefined
  unsubscribe?: (() => void) | undefined
}

interface PasteResponse {
  ok: boolean
  value?: { absolutePath?: string; filename?: string }
  error?: { message?: string }
}

interface PasteOccurrence {
  occurrenceId: number
  source: string
  ref: string
  offset: number
  /**
   * Inline display span of the reference. Older builds mint a single
   * placeholder glyph; rc8 mints the full `@label` display text and reports
   * its length here.
   */
  length?: number | undefined
  label: string
}

interface VerdictEntry {
  takeover?: boolean | undefined
  at: number
  pending: boolean
  task?: Promise<boolean | undefined> | undefined
}

interface ModelDirectoryStore {
  getSnapshot(): { current?: { provider?: string; model?: string } | null }
  subscribe(listener: () => void): () => void
}

interface ModelDirectoriesService {
  directoryFor(sessionId: string): { store: ModelDirectoryStore } | undefined
}

interface ModelPick {
  provider?: string | undefined
  model?: string | undefined
  label: string
}

/** Browser-owned draft image plus its original File, as exposed by the conversation service. */
interface DraftMediaAttachment {
  id: string
  file: File
  previewUrl: string
}

interface ConversationDraftFace {
  createDraftImages?: (files: readonly File[]) => readonly DraftMediaAttachment[]
  draftImages?: (ids: readonly string[]) => readonly DraftMediaAttachment[]
  releaseDraftImages?: (attachments: readonly DraftMediaAttachment[]) => void
  releaseDraftImage?: (id: string) => void
}

type PasteDockProps = PropsRuntime<'conversation.input.dock'> & {
  controller: PasteImageController
  remove: (occurrence: PasteOccurrence) => void
}

interface ReferenceSourceRegistry {
  registerSource: (source: InputTriggerSource) => () => void
}

interface ReferenceSourceRegistration {
  dispose: () => void
  owners: number
}

interface LegacyTriggerContext {
  inputTriggers: ReferenceSourceRegistry
}

interface LegacySlashContext {
  slash: ReferenceSourceRegistry
}

const CORDIS_ORIGINAL = Symbol.for('cordis.original')

function registryIdentity(registry: ReferenceSourceRegistry): object {
  let current: object = registry
  while (true) {
    const original = (current as Record<symbol, unknown>)[CORDIS_ORIGINAL]
    if ((typeof original !== 'object' && typeof original !== 'function') || original === null || original === current) {
      return current
    }
    current = original
  }
}

let fallbackId = 0

function id(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  fallbackId += 1
  return `paste-${Date.now()}-${fallbackId}`
}

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function imageFiles(data: DataTransfer | null): File[] {
  if (data === null) return []
  const itemFiles = Array.from(data.items)
    .filter(item => item.kind === 'file')
    .map(item => item.getAsFile())
    .filter((file): file is File => file !== null)
  const candidates = itemFiles.length > 0 ? itemFiles : Array.from(data.files)
  return candidates.filter(file => file.type.toLowerCase().startsWith('image/'))
}

/** One bridged file resolved out of a drag/clipboard payload (file route URL). */
interface DroppedBridgeRef {
  sessionId: string
  name: string
}

/**
 * Extract our bridge file-route URLs from every drag/clipboard flavor.
 * Dragging a rendered tile out of a bridged bubble carries no files — the
 * payload is the (browser-absolutized) file-route URL as uri-list/text/html.
 * Scanning those flavors catches the drop before the textarea swallows the
 * raw markup (session evidence: agentHome b98c935b, 2026-08-16).
 */
function bridgeRefsFromPayload(data: DataTransfer | null): DroppedBridgeRef[] {
  if (data === null) return []
  const chunks: string[] = []
  const types = Array.isArray((data as { types?: unknown }).types) ? ((data as { types: readonly string[] }).types) : []
  for (const type of types) {
    if (type === 'Files') continue
    let value = ''
    try { value = data.getData(type) } catch { value = '' }
    if (value !== '') chunks.push(value)
  }
  const refs: DroppedBridgeRef[] = []
  const seen = new Set<string>()
  for (const chunk of chunks) {
    for (const match of chunk.matchAll(/\/_dsh\/vision-cloud\/paste-images\/file\?[^\s"'<>()]+/gu)) {
      const url = match[0]
      if (seen.has(url)) continue
      seen.add(url)
      let sessionId: string | undefined
      let name: string | undefined
      for (const pair of url.slice(url.indexOf('?') + 1).split('&')) {
        const eq = pair.indexOf('=')
        if (eq < 0) continue
        const key = pair.slice(0, eq)
        const value = pair.slice(eq + 1)
        if (key === 'sessionId') sessionId = decodeURIComponent(value)
        else if (key === 'name') name = decodeURIComponent(value)
      }
      if (sessionId !== undefined && name !== undefined && sessionId !== '' && name !== '') {
        refs.push({ sessionId, name })
      }
    }
  }
  return refs
}

/**
 * Strip this plugin's own bridge markup out of a drop/paste text payload.
 * Dragging a bridged tile produces a "File + URL text" payload: the DSH
 * message drag materializes the image as a File and puts the file-route URL
 * (plus adjacent bridge markup) into the drag text. Without stripping, the
 * URL leaks into the draft and then into the sent message. Returns '' when
 * the payload carried only bridge markup.
 */
function sanitizeBridgeText(text: string): string {
  if (text.includes('/_dsh/vision-cloud/paste-images/file?')) {
    // The payload came from one of our bridged bubbles. Besides the markup
    // stripped below, the DSH message drag sometimes prefixes the URL with a
    // materialized-file label ("url-<uuid>-<name>.<ext>"); drop that token so
    // the whole line collapses (agentHome b98c935b, 2026-08-16).
    text = text.replace(/url-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:-[^.\s"'<>]*)?(?:\.[a-z0-9]{2,5})?(?=[\s"'<>()[\]\\]|$)/giu, '')
  }
  let value = text
  value = value.replace(/!\[[^\]]*\]\(<[^)]+>\)/gu, '')
  value = value.replace(/https?:\/\/[^\s"'<>]*\/_dsh\/vision-cloud\/paste-images\/file\?[^\s"'<>()]+/gu, '')
  value = value.replace(/\/_dsh\/vision-cloud\/paste-images\/file\?[^\s"'<>()]+/gu, '')
  value = value.replace(/\[Pasted image available at absolute path: "[^"]*"\]/gu, '')
  value = value.replace(/\[pasted image: [^\]]*\]/gu, '')
  return value.replace(/\s+/gu, ' ').trim()
}

/**
 * Remove leaked bridge serialization markup from a draft while preserving the
 * user's real text. Used defensively during model-switch reconciliation: a
 * multimodal paste/drop of a bridged tile can leave the raw path+markdown in
 * the draft, and the subsequent native→bridge migration must not keep it.
 */
function stripBridgeMarkup(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\(<[^)]+>\)/gu, '')
    .replace(/https?:\/\/[^\s"'<>]*\/_dsh\/vision-cloud\/paste-images\/file\?[^\s"'<>()]+/gu, '')
    .replace(/\/_dsh\/vision-cloud\/paste-images\/file\?[^\s"'<>()]+/gu, '')
    .replace(/\[Pasted image available at absolute path: "[^"]*"\]/gu, '')
    .replace(/\[pasted image: [^\]]*\]/gu, '')
    .replace(/url-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:-[^.\s"'<>]*)?(?:\.[a-z0-9]{2,5})?(?=[\s"'<>()[\]\\]|$)/giu, '')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

function validateImages(files: readonly File[]): void {
  if (files.length > MAX_IMAGES) throw new Error(`Paste at most ${MAX_IMAGES} images at a time`)
  let total = 0
  for (const file of files) {
    if (!file.type.toLowerCase().startsWith('image/')) throw new Error(`${file.name || 'clipboard item'} is not an image`)
    if (file.size <= 0) throw new Error(`${file.name || 'clipboard image'} is empty`)
    if (file.size > MAX_IMAGE_BYTES) throw new Error(`${file.name || 'clipboard image'} exceeds ${humanBytes(MAX_IMAGE_BYTES)}`)
    total += file.size
  }
  if (total > MAX_BATCH_BYTES) throw new Error(`Pasted images exceed ${humanBytes(MAX_BATCH_BYTES)} in total`)
}

async function responseJson(response: Response): Promise<PasteResponse> {
  const body = await response.json() as PasteResponse
  if (!response.ok || body.ok !== true) throw new Error(body.error?.message ?? `Image copy failed (${response.status})`)
  return body
}

function pasteLabel(file: File, index: number, saved?: string | undefined): string {
  return saved?.trim() || file.name.trim() || `clipboard-image-${index + 1}`
}

/**
 * Read the occurrence table as this plugin's structural view. The host type
 * gained the inline display `length` after the dependency floor, so the field
 * is read structurally and treated as optional.
 */
function occurrencesOf(snapshot: { occurrences: readonly unknown[] }): readonly PasteOccurrence[] {
  return snapshot.occurrences as readonly PasteOccurrence[]
}

/** Owns browser File objects until DSH serializes the corresponding text references. */
export class PasteImageController {
  private readonly records = new Map<string, PasteRecord>()
  private readonly listeners = new Set<() => void>()
  private revision = 0

  /** Draft ids shown in the host's native in-card attachment rail for bridge records. */
  private readonly nativePreviews = new Map<string, { sessionId: string; ref: string }>()
  private readonly previewUnsubscribes = new Map<string, () => void>()
  private readonly submitGuards = new WeakSet<object>()
  private readonly pendingSubmitGuards = new WeakSet<object>()

  constructor(private readonly ctx: ClientContext) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  snapshot = (): number => this.revision

  private changed(): void {
    this.revision += 1
    for (const listener of this.listeners) listener()
  }

  private readonly VERDICT_MAX_AGE_MS = 60000
  private readonly VERDICT_RETRY_MS = 30000
  private verdicts = new Map<string, VerdictEntry>()
  private routeAvailable = true
  private routeRetryAt = 0
  private replaying = false
  private lastBridgeNoticeAt = 0
  private readonly subscribedDirectories = new Set<string>()
  private readonly reconciliations = new Map<string, Promise<void>>()

  /** Best-effort current model selector label (used only without modelDirectories). */
  private currentModelLabel(): string {
    const buttons = document.querySelectorAll('button[aria-label]')
    for (const button of buttons) {
      const label = button.getAttribute('aria-label') ?? ''
      if (/选择模型|select model|current model|当前模型/i.test(label)) return label
    }
    return ''
  }

  private modelDirectoriesService(): ModelDirectoriesService | undefined {
    const ctx = this.ctx as ClientContext & { get?: (name: string) => unknown }
    const service = typeof ctx.get === 'function' ? ctx.get('modelDirectories') : undefined
    if (service === undefined || typeof (service as ModelDirectoriesService).directoryFor !== 'function') return undefined
    return service as ModelDirectoriesService
  }

  /**
   * The composer's current model selection, freshest source first:
   * the live model-selection store (exact provider/model) followed by the
   * DOM selector label as a legacy fallback (subagent sessions throw here).
   */
  private currentPick(sessionId: string): ModelPick {
    this.tryArmSubmitGuard(sessionId)
    const service = this.modelDirectoriesService()
    if (service !== undefined) {
      try {
        const directory = service.directoryFor(sessionId)
        if (directory?.store) {
          this.subscribeDirectory(sessionId, directory.store)
          const current = directory.store.getSnapshot().current
          if (current !== null && current !== undefined
            && typeof current.provider === 'string' && typeof current.model === 'string'
            && current.provider !== '' && current.model !== '') {
            return { provider: current.provider, model: current.model, label: current.model }
          }
        }
      } catch {
        // Subagent composers or unknown scopes: fall back to the DOM label.
      }
    }
    return { label: this.currentModelLabel() }
  }

  /** Flush cached verdicts and prefetch on selection changes (one per session). */
  private subscribeDirectory(sessionId: string, store: ModelDirectoryStore): void {
    if (this.subscribedDirectories.has(sessionId)) return
    this.subscribedDirectories.add(sessionId)
    if (typeof store.subscribe !== 'function') return
    try {
      store.subscribe(() => {
        this.flushVerdicts(sessionId)
        this.prefetch()
        void this.reconcileDraftMedia(sessionId)
      })
    } catch {
      // Keep the DOM label fallback when the store rejects listeners.
    }
  }

  private flushVerdicts(sessionId: string): void {
    const prefix = `${sessionId}\u0000`
    for (const key of this.verdicts.keys()) if (key.startsWith(prefix)) this.verdicts.delete(key)
  }

  private verdictKey(sessionId: string, pick: ModelPick): string | undefined {
    if (pick.provider !== undefined && pick.model !== undefined && pick.provider !== '' && pick.model !== '') {
      return `${sessionId}\u0000p\u0000${pick.provider}\u0000${pick.model}`
    }
    if (pick.label.trim() === '') return undefined
    return `${sessionId}\u0000l\u0000${pick.label}`
  }

  /**
   * Fetch the takeover verdict for one selection. Resolves the effective
   * takeover (`true` = bridge, `false` = native) or `undefined` when the
   * verdict could not be obtained (fetch failure, route down, rate-limited
   * retry window) — callers then apply the text-safe bridge fallback (GA20).
   */
  private refreshVerdict(sessionId: string, pick: ModelPick): Promise<boolean | undefined> {
    const key = this.verdictKey(sessionId, pick)
    if (key === undefined) return Promise.resolve(false)
    if (!this.routeAvailable && Date.now() < this.routeRetryAt) return Promise.resolve(undefined)
    const cached = this.verdicts.get(key)
    if (cached?.pending && cached.task !== undefined) return cached.task
    const entry: VerdictEntry = { takeover: cached?.takeover, at: cached?.at ?? 0, pending: true, task: undefined }
    this.verdicts.set(key, entry)
    entry.task = (async () => {
      // Optimistic probe: a 404 marks the route down only for a retry window,
      // after which refreshVerdict re-checks instead of giving up forever (GA6).
      this.routeAvailable = true
      try {
        const query = new URLSearchParams({ sessionId })
        if (pick.provider !== undefined && pick.model !== undefined) {
          query.set('provider', pick.provider)
          query.set('model', pick.model)
        } else {
          query.set('model', pick.label)
        }
        const res = await fetch(`${PASTE_IMAGES_ROUTE}?${query.toString()}`)
        if (res.status === 404) {
          this.routeAvailable = false
          this.routeRetryAt = Date.now() + this.VERDICT_RETRY_MS
          return undefined
        }
        if (!res.ok) return undefined
        const body = await res.json() as { takeover?: unknown }
        entry.takeover = body.takeover === true
        entry.at = Date.now()
        entry.pending = false
        return entry.takeover
      } catch {
        return undefined
      } finally {
        entry.pending = false
      }
    })()
    return entry.task
  }

  /**
   * Cached takeover for the current selection: `true`/`false` only for a
   * fresh verdict; `undefined` (or a stale/empty signal) leaves the event
   * held for the async decide-then-act flow.
   */
  private syncTakeover(sessionId: string): boolean | undefined {
    const pick = this.currentPick(sessionId)
    const key = this.verdictKey(sessionId, pick)
    // No model signal is NOT a native verdict: returning `false` here would
    // pass the event straight through to the native handler without a
    // preventDefault, inserting a raw image block that pi-ai text-only
    // models reject with UNSUPPORTED_CONTENT (the harness agent composer has
    // no model picker at all). Hold instead; the decide-then-act flow below
    // routes the no-signal case to the text-safe bridge.
    if (key === undefined) return undefined
    const cached = this.verdicts.get(key)
    if (cached !== undefined && !cached.pending && cached.takeover !== undefined
      && cached.at > 0 && Date.now() - cached.at <= this.VERDICT_MAX_AGE_MS) {
      return cached.takeover
    }
    return undefined
  }

  /** Prefetch the paste/drop takeover verdict (called on composer focus/drag enter). */
  prefetch(): void {
    const sessionId = this.ctx.sessions.list.getSnapshot().current
    if (sessionId === undefined) return
    const pick = this.currentPick(String(sessionId))
    if (this.verdictKey(String(sessionId), pick) === undefined) return
    void this.refreshVerdict(String(sessionId), pick)
  }

  /**
   * One-way draft reconciliation: when the selected model becomes text-only
   * and the draft still carries native image ids from a multimodal paste,
   * convert those images to bridge references before the host rejects the
   * next send. No destructive fallback: if the verdict is unknown the draft
   * stays exactly as the user left it.
   */
  private reconcileDraftMedia(sessionId: string): Promise<void> {
    const previous = this.reconciliations.get(sessionId)
    if (previous !== undefined) return previous
    const task = (async () => {
      try {
        const pick = this.currentPick(sessionId)
        const key = this.verdictKey(sessionId, pick)
        if (key === undefined) return

        let input: ReturnType<PasteImageController['inputFor']>
        try {
          input = this.inputFor(sessionId)
        } catch {
          return // Subagent/no composer scope has no draft rail to reconcile.
        }

        const before = input.state.getSnapshot()
        if (before.phase !== 'plain' || before.imageIds.length === 0) return

        const verdict = await this.refreshVerdict(sessionId, pick)
        if (verdict === undefined) {
          input.notify('error', 'The image bridge is temporarily unreachable; native draft images were left unchanged.')
          return
        }
        if (verdict !== true) return
        // The selection may have changed again while the GET was in flight.
        if (this.verdictKey(sessionId, this.currentPick(sessionId)) !== key) return

        const snapshot = input.state.getSnapshot()
        if (snapshot.phase !== 'plain' || snapshot.imageIds.length === 0) return
        await this.bridgeNativeDraft(sessionId, input, snapshot.imageIds)
      } catch (error) {
        console.warn('dsh-vision-cloud could not reconcile draft images with the selected model', error)
      } finally {
        this.reconciliations.delete(sessionId)
      }
    })()
    this.reconciliations.set(sessionId, task)
    return task
  }

  private conversationDraftService(): ConversationDraftFace | undefined {
    const ctx = this.ctx as ClientContext & { get?: (name: string) => unknown }
    const service = typeof ctx.get === 'function' ? ctx.get('conversation') : undefined
    if (typeof service !== 'object' || service === null) return undefined
    return service as ConversationDraftFace
  }

  /** Copy a draft File's bytes so they survive the host releasing the draft image. */
  private cloneDraftFile(file: File, fallbackName: string): File {
    return new File([file], file.name.trim() || fallbackName, { type: file.type || 'image/png' })
  }

  private sameImageIds(left: readonly unknown[], right: readonly unknown[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index])
  }

  private async bridgeNativeDraft(
    sessionId: string,
    input: ReturnType<PasteImageController['inputFor']>,
    imageIds: readonly string[],
    admitPreviews = true,
  ): Promise<boolean> {
    const face = this.conversationDraftService()
    const shell = input as unknown as { removeImage?: (id: string) => void }
    if (typeof face?.draftImages !== 'function' || typeof shell.removeImage !== 'function') {
      input.notify('error', 'The composer draft-image API is unavailable; remove the image and paste it again after selecting a text-only model.')
      return false
    }

    // Display-only previews created for bridge records must NOT be re-bridged:
    // they already have a live bridge occurrence in the draft.
    const previewIds = new Set<string>()
    for (const [id, preview] of this.nativePreviews) {
      if (preview.sessionId === sessionId) previewIds.add(id)
    }
    const nativeImageIds = imageIds.filter(id => !previewIds.has(id))
    if (nativeImageIds.length === 0) return false

    const attachments = face.draftImages!(nativeImageIds)
    if (attachments.length !== nativeImageIds.length || !this.sameImageIds(nativeImageIds, attachments.map(attachment => attachment.id))) {
      input.notify('error', 'Some native draft images are no longer available; removed them and paste again.')
      return false
    }
    const files = attachments.map((attachment, index) =>
      this.cloneDraftFile(attachment.file, attachment.file.name || `clipboard-image-${index + 1}`))
    validateImages(files)

    // Re-check immediately before the mutation: insert first so a failed CAS
    // rollback leaves the original native ids untouched.
    let snapshot = input.state.getSnapshot()
    const cleanedDraft = stripBridgeMarkup(snapshot.draft)
    if (cleanedDraft !== snapshot.draft) {
      input.setDraft(cleanedDraft)
      snapshot = input.state.getSnapshot()
    }
    if (!this.sameImageIds(snapshot.imageIds.filter(id => !previewIds.has(id)), nativeImageIds)) return false
    const cursor = snapshot.draft.length
    this.insertRecords(sessionId, input, files, cursor, admitPreviews)

    for (const id of nativeImageIds) shell.removeImage!(id)
    try { face.releaseDraftImages?.(attachments) } catch {
      // The migrated bridge records are independent File copies already.
    }
    return true
  }

  source(): InputTriggerSource {
    return {
      trigger: '@',
      name: SOURCE,
      order: 1000,
      candidates: () => Promise.resolve([]),
      onPick: () => undefined,
      codec: {
        clipboardText: (ref) => {
          const record = this.records.get(ref)
          return `[pasted image: ${record === undefined ? ref : pasteLabel(record.file, 0, record.filename)}]`
        },
        serialize: (ref, signal) => this.serialize(ref, signal),
      },
    }
  }

  recordsFor(occurrences: readonly PasteOccurrence[]): PasteRecord[] {
    return occurrences
      .filter(occurrence => occurrence.source === SOURCE)
      .map(occurrence => this.records.get(occurrence.ref))
      .filter((record): record is PasteRecord => record !== undefined)
  }

  private inputFor(sessionId: string) {
    const actx = this.ctx.sessions.scope(sessionId as never)
    if (actx === undefined) throw new Error('Open a live session before pasting images')
    const input = this.ctx.conversation.input.for(actx)
    this.armSubmitGuard(sessionId, input)
    return input
  }

  private insertText(input: ReturnType<PasteImageController['inputFor']>, text: string, start: number, end = start): number {
    if (text === '') return start
    const snapshot = input.state.getSnapshot()
    input.setDraft(snapshot.draft.slice(0, start) + text + snapshot.draft.slice(end))
    return start + text.length
  }

  /** One batch's cleanup: drop records once every occurrence referencing them is gone. */
  private bindBatchCleanup(batch: PasteBatch, input: ReturnType<PasteImageController['inputFor']>): void {
    batch.unsubscribe = input.state.subscribe(() => {
      const alive = new Set(input.state.getSnapshot().occurrences
        .filter(occurrence => occurrence.source === SOURCE)
        .map(occurrence => occurrence.ref))
      let changed = false
      for (const record of batch.records) {
        if (alive.has(record.ref) || record.batch.inflight !== undefined) continue
        changed = this.records.delete(record.ref) || changed
      }
      if (batch.records.every(record => !this.records.has(record.ref)) && batch.inflight === undefined) {
        batch.unsubscribe?.()
        batch.unsubscribe = undefined
      }
      if (changed) this.changed()
    })
  }

  /**
   * Insert object references for resolved records at `cursor`. `owned` lists
   * the records created by THIS insertion (rolled back and dropped on
   * failure); records reused from earlier uploads survive a failed insert.
   */
  private insertExistingRefs(
    input: ReturnType<PasteImageController['inputFor']>,
    records: readonly PasteRecord[],
    owned: readonly PasteRecord[],
    cursor: number,
  ): number {
    const draftBeforeReferences = input.state.getSnapshot().draft
    try {
      const before = input.state.getSnapshot().draft.slice(0, cursor)
      if (before !== '' && !/\s$/u.test(before)) cursor = this.insertText(input, ' ', cursor)
      for (const [index, record] of records.entries()) {
        const label = pasteLabel(record.file, index, record.filename)
        const snapshot = input.state.getSnapshot()
        const accepted = input.insertReference({
          source: SOURCE,
          ref: record.ref,
          label,
          // Decorates the chip with the file glyph on builds that support
          // reference appearances; older builds ignore the extra field.
          appearance: 'file',
          clipboardText: `[pasted image: ${label}]`,
        } as Parameters<typeof input.insertReference>[0], { start: cursor, end: cursor, draftRev: snapshot.draftRev })
        if (!accepted) throw new Error('The composer changed before pasted images could be inserted')
        // The host owns the inline display span: older builds mint one
        // placeholder glyph, rc8 mints the whole `@label` text. Advancing by a
        // hardcoded 1 would put the separator below INSIDE the reference range,
        // and a host that drops any occurrence an edit intersects would discard
        // the occurrence — losing both the chip and the submit-time serialization.
        const minted = occurrencesOf(input.state.getSnapshot())
          .find(row => row.source === SOURCE && row.ref === record.ref)
        cursor += minted?.length ?? 1
        const hasNext = index + 1 < records.length
        const suffix = input.state.getSnapshot().draft.slice(cursor)
        // rc8 already appends its own separating gap; only add one when the
        // reference is not followed by whitespace already.
        if (hasNext || suffix !== '') {
          if (!/^\s/u.test(suffix)) cursor = this.insertText(input, ' ', cursor)
          else cursor += 1
        }
      }
      this.changed()
      return cursor
    } catch (error) {
      input.setDraft(draftBeforeReferences)
      for (const record of owned) this.records.delete(record.ref)
      throw error
    }
  }

  private insertRecords(
    sessionId: string,
    input: ReturnType<PasteImageController['inputFor']>,
    files: readonly File[],
    cursor: number,
    admitPreviews = true,
  ): number {
    const batch: PasteBatch = { sessionId, records: [] }
    for (const file of files) {
      const record: PasteRecord = { ref: id(), file, batch, status: 'ready' }
      batch.records.push(record)
      this.records.set(record.ref, record)
    }
    const next = this.insertExistingRefs(input, batch.records, batch.records, cursor)
    this.bindBatchCleanup(batch, input)

    // Prefer the host’s native in-card attachment rail; the custom dock above the composer
    // stays available as an error/fallback surface when the draft-image API is absent.
    // Submit-triggered migrations pass false: the message is leaving immediately, so
    // re-adding display-only previews would only race with the submit guard.
    if (admitPreviews) this.admitNativePreviews(sessionId, input, batch.records)
    return next
  }

  /** Whether a bridge record already has a resident native input-card preview. */
  private hasNativePreview(ref: string): boolean {
    for (const preview of this.nativePreviews.values()) {
      if (preview.ref === ref) return true
    }
    return false
  }

  /**
   * Remove one native preview attachment without interpreting the removal as
   * an intentional bridge-record deletion (bookkeeping is already detached).
   */
  private detachNativePreview(
    id: string,
    input: ReturnType<PasteImageController['inputFor']>,
    face: ConversationDraftFace | undefined,
  ): void {
    const unsubscribe = this.previewUnsubscribes.get(id)
    if (unsubscribe !== undefined) {
      unsubscribe()
      this.previewUnsubscribes.delete(id)
    }
    this.nativePreviews.delete(id)
    const shell = input as unknown as { removeImage?: (id: string) => void }
    if ((input.state.getSnapshot().imageIds as unknown as readonly string[]).includes(id)) shell.removeImage?.(id)
    try { face?.releaseDraftImage?.(id) } catch {
      // The preview attachment may already have been released by the host rail.
    }
  }

  /**
   * Drop display-only native preview ids immediately before the host snapshots
   * imageIds for a submit. The bridge occurrences stay untouched: they carry
   * the prompt the text-only model can actually read.
   */
  private dropNativePreviews(
    sessionId: string,
    input: ReturnType<PasteImageController['inputFor']>,
    face: ConversationDraftFace,
  ): void {
    for (const [id, preview] of this.nativePreviews) {
      if (preview.sessionId !== sessionId) continue
      this.detachNativePreview(id, input, face)
    }
  }

  /**
   * Try to arm the shell's single submit entry for a session. currentPick
   * invokes this on paste/drop and model-directory refreshes, so the guard is
   * present as soon as the composer is known — including the issue-1 path
   * where a multimodal paste never admitted a display preview.
   */
  private tryArmSubmitGuard(sessionId: string): void {
    try { this.inputFor(sessionId) } catch {
      // No live composer scope for this session yet.
    }
  }

  /**
   * Patch the host's single submit entry for a session shell. Both the
   * composer send control (shell.actions.submit) and the public facade
   * (ctx.conversation.input.for(...).submit) resolve through this method.
   *
   * This wrapper is the last-line guarantee for issue 1: the Host validates
   * the outgoing content synchronously at prompt time and refuses the whole
   * request as MODEL_DOES_NOT_SUPPORT_IMAGES whenever a native image block
   * accompanies a text-only selection. Model-store reconciliation is async by
   * contract, so a fast model-switch + send can beat the migration. Here the
   * wrapper strips display-only preview ids, then:
   * - fresh takeover=false: keep native images and submit untouched;
   * - fresh takeover=true: migrate the remaining native ids to bridge refs
   *   and submit only after the mutation succeeds;
   * - unknown/pending: hold this submit, fetch the verdict, migrate on true,
   *   submit untouched on false, and stop rather than hand the Host an image
   *   block it is known to reject when the bridge is unreachable.
   */
  private armSubmitGuard(sessionId: string, input: ReturnType<PasteImageController['inputFor']>): void {
    if (this.submitGuards.has(input as object)) return
    const shell = input as unknown as { submit?: (mode?: string) => void }
    if (typeof shell.submit !== 'function') return
    this.submitGuards.add(input as object)
    const original = shell.submit
    shell.submit = (mode?: string): void => { this.guardedSubmit(sessionId, input, shell, original, mode) }
  }

  /** Re-enable and forward a guarded submit, then clear its pending flag. */
  private releaseSubmit(
    sessionId: string,
    input: ReturnType<PasteImageController['inputFor']>,
    shell: unknown,
    original: (this: unknown, mode?: string) => void,
    mode: string | undefined,
  ): void {
    // Safety net: never forward display-only preview ids to the host submit.
    // A submit-triggered migration may have just re-added them; they must be
    // stripped before the text-only model sees the request.
    const face = this.conversationDraftService()
    if (face !== undefined) this.dropNativePreviews(sessionId, input, face)

    this.pendingSubmitGuards.delete(input as object)
    if (input.state.getSnapshot().phase !== 'plain') return
    original.call(shell, mode)
  }

  /** Migrate cached-true native ids and submit exactly once on success. */
  private submitBridged(
    sessionId: string,
    input: ReturnType<PasteImageController['inputFor']>,
    shell: unknown,
    original: (this: unknown, mode?: string) => void,
    mode: string | undefined,
    nativeIds: readonly string[],
  ): void {
    if (this.pendingSubmitGuards.has(input as object)) return
    this.pendingSubmitGuards.add(input as object)
    const release = (): void => this.releaseSubmit(sessionId, input, shell, original, mode)
    void this.bridgeNativeDraft(sessionId, input, nativeIds, false).then(
      (ok: boolean) => {
        if (ok) release()
        else this.pendingSubmitGuards.delete(input as object)
      },
      (error: unknown) => {
        this.pendingSubmitGuards.delete(input as object)
        input.notify('error', message(error))
      },
    )
  }

  /**
   * One guarded submit pass. It never forwards a native image block to a
   * model that the current capability verdict says is text-only.
   */
  private guardedSubmit(
    sessionId: string,
    input: ReturnType<PasteImageController['inputFor']>,
    shell: unknown,
    original: (this: unknown, mode?: string) => void,
    mode: string | undefined,
  ): void {
    const face = this.conversationDraftService()
    if (face !== undefined) this.dropNativePreviews(sessionId, input, face)
    const snapshot = input.state.getSnapshot()
    if (snapshot.phase !== 'plain') { original.call(shell, mode); return }

    const pick = this.currentPick(sessionId)
    const key = this.verdictKey(sessionId, pick)
    if (key === undefined) { original.call(shell, mode); return }

    const previewIds = new Set<string>()
    for (const [id, preview] of this.nativePreviews) {
      if (preview.sessionId === sessionId) previewIds.add(id)
    }
    const imageIds = snapshot.imageIds as unknown as readonly string[]
    const nativeIds = imageIds.filter(id => !previewIds.has(id))
    if (nativeIds.length === 0) { original.call(shell, mode); return }

    const cached = this.verdicts.get(key)
    if (cached !== undefined && !cached.pending && cached.takeover !== undefined
      && cached.at > 0 && Date.now() - cached.at <= this.VERDICT_MAX_AGE_MS) {
      if (cached.takeover) this.submitBridged(sessionId, input, shell, original, mode, nativeIds)
      else original.call(shell, mode)
      return
    }

    // Unknown capability: don't leak the native block into prompt validation.
    if (this.pendingSubmitGuards.has(input as object)) return
    this.pendingSubmitGuards.add(input as object)
    void (async () => {
      try {
        const verdict = await this.refreshVerdict(sessionId, pick)
        // The selection may have changed while the verdict was in flight.
        if (this.verdictKey(sessionId, this.currentPick(sessionId)) !== key) return
        const now = input.state.getSnapshot()
        if (now.phase !== 'plain') return
        const nowImageIds = now.imageIds as unknown as readonly string[]
        const nowNativeIds = nowImageIds.filter(id => !previewIds.has(id))
        if (nowNativeIds.length === 0) { this.releaseSubmit(sessionId, input, shell, original, mode); return }
        if (verdict === undefined) { this.notifyBridgeDown(input); return }
        if (verdict !== true) { this.releaseSubmit(sessionId, input, shell, original, mode); return }
        const migrated = await this.bridgeNativeDraft(sessionId, input, nowNativeIds, false)
        if (!migrated) return
        this.releaseSubmit(sessionId, input, shell, original, mode)
      } catch (error) {
        this.pendingSubmitGuards.delete(input as object)
        input.notify('error', message(error))
      } finally {
        this.pendingSubmitGuards.delete(input as object)
      }
    })().catch(error => {
      this.pendingSubmitGuards.delete(input as object)
      input.notify('error', message(error))
    })
  }

  /** Remove the bridge occurrence for one ref (native preview was removed). */
  private removeBridgeOccurrence(
    sessionId: string,
    input: ReturnType<PasteImageController['inputFor']>,
    ref: string,
  ): void {
    const occurrence = input.state.getSnapshot().occurrences.find(candidate =>
      candidate.source === SOURCE && candidate.ref === ref)
    if (occurrence !== undefined) {
      this.remove(sessionId, occurrence)
      return
    }
    if (this.records.delete(ref)) this.changed()
  }

  /**
   * Reconcile resident native previews with input state. A preview survives
   * only while its bridge occurrence AND image id are alive. If the user
   * removed it from the native rail, remove the bridge occurrence; if the
   * prompt was sent (occurrence gone), release the leftover preview draft.
   */
  private reconcileNativePreviews(
    sessionId: string,
    input: ReturnType<PasteImageController['inputFor']>,
  ): void {
    if (this.nativePreviews.size === 0) return
    const snapshot = input.state.getSnapshot()
    const pending: Array<{ id: string; ref: string; occurrenceAlive: boolean; imageAlive: boolean }> = []
    for (const [id, preview] of this.nativePreviews) {
      if (preview.sessionId !== sessionId) continue
      pending.push({
        id,
        ref: preview.ref,
        occurrenceAlive: snapshot.occurrences.some(candidate => candidate.source === SOURCE && candidate.ref === preview.ref),
        imageAlive: (snapshot.imageIds as unknown as readonly string[]).includes(id),
      })
    }
    for (const entry of pending) {
      if (entry.occurrenceAlive && entry.imageAlive) continue
      this.detachNativePreview(entry.id, input, this.conversationDraftService())
      if (!entry.imageAlive && entry.occurrenceAlive) {
        this.removeBridgeOccurrence(sessionId, input, entry.ref)
      }
    }
  }

  private bindNativePreviewRemoval(
    sessionId: string,
    input: ReturnType<PasteImageController['inputFor']>,
    id: string,
  ): void {
    const unsubscribe = input.state.subscribe(() => {
      this.reconcileNativePreviews(sessionId, input)
    })
    this.previewUnsubscribes.set(id, unsubscribe)
  }

  /**
   * Show bridge records in the host's native in-card attachment rail. This is
   * display-only for text models: the submit guard removes these ids before
   * serialization, while the bridge path text remains the model payload.
   * Falls back to the plugin rail above the composer when the draft-image API
   * is unavailable (e.g. older harness builds).
   */
  private admitNativePreviews(
    sessionId: string,
    input: ReturnType<PasteImageController['inputFor']>,
    records: readonly PasteRecord[],
  ): boolean {
    const face = this.conversationDraftService()
    const shell = input as unknown as {
      addImages?: (ids: readonly string[]) => boolean
      removeImage?: (id: string) => void
    }
    if (typeof face?.createDraftImages !== 'function' || typeof shell.addImages !== 'function') return false
    const pending = records.filter(record => !this.hasNativePreview(record.ref))
    if (pending.length === 0) return true
    try {
      const attachments = face.createDraftImages!(pending.map(record => record.file))
      if (attachments.length !== pending.length) {
        if (attachments.length > 0) face.releaseDraftImages?.(attachments)
        return false
      }
      const ids = attachments.map(attachment => attachment.id)
      if (!shell.addImages(ids)) {
        face.releaseDraftImages?.(attachments)
        return false
      }
      this.armSubmitGuard(sessionId, input)
      for (const [index, record] of pending.entries()) {
        const id = ids[index]!
        this.nativePreviews.set(id, { sessionId, ref: record.ref })
        this.bindNativePreviewRemoval(sessionId, input, id)
      }
      return true
    } catch (error) {
      console.warn('dsh-vision-cloud could not show pasted images in the native composer rail', error)
      return false
    }
  }

  /** Rail records not already represented by a native in-card preview. */
  recordsForDock(occurrences: readonly PasteOccurrence[]): PasteRecord[] {
    const records = this.recordsFor(occurrences)
    return records.filter(record => !this.hasNativePreview(record.ref))
  }
  /**
   * Insert the held paste through the paste-to-path bridge. Shared by the
   * cached-true fast path and the async hold-and-decide settle (GA3).
   */
  private finishBridge(
    sessionId: string,
    input: ReturnType<PasteImageController['inputFor']>,
    files: readonly File[],
    text: string,
    start: number,
    end: number,
    target: HTMLTextAreaElement,
    dragEnd = false,
  ): void {
    if (dragEnd) window.dispatchEvent(new Event('dragend'))
    const snapshot = input.state.getSnapshot()
    const safeStart = Math.max(0, Math.min(start, snapshot.draft.length))
    const safeEnd = Math.max(safeStart, Math.min(end, snapshot.draft.length))
    let cursor = this.insertText(input, text, safeStart, safeEnd)
    validateImages(files)
    cursor = this.insertRecords(sessionId, input, files, cursor)
    requestAnimationFrame(() => {
      target.focus({ preventScroll: true })
      target.setSelectionRange(cursor, cursor)
    })
  }

  /**
   * Bridge a held payload that may mix files with bridge-route URL text
   * (dragging a bridged tile: DSH materializes the image as a File and puts
   * its file-route URL into the drag text). The text is sanitized HERE so
   * the URL never reaches the draft; when the payload comes down to one
   * file whose URL names an upload this tab still owns, that record is
   * reused instead of uploading a duplicate copy (agentHome b98c935b,
   * 2026-08-16).
   */
  private finishPayload(
    sessionId: string,
    input: ReturnType<PasteImageController['inputFor']>,
    files: readonly File[],
    refs: readonly DroppedBridgeRef[],
    text: string,
    start: number,
    end: number,
    target: HTMLTextAreaElement,
    dragEnd = false,
  ): void {
    // The payload text is sanitized HERE: dragging a bridged tile carries the
    // file-route URL (plus adjacent bridge markup) in the drag text, and it
    // must never leak into the draft (agentHome b98c935b, 2026-08-16).
    const clean = sanitizeBridgeText(text)
    if (files.length === 1 && refs.length === 1 && clean === '') {
      const existing = this.findUploadedRecord(refs[0]!)
      if (existing !== undefined) {
        if (dragEnd) window.dispatchEvent(new Event('dragend'))
        const snapshot = input.state.getSnapshot()
        const safeStart = Math.max(0, Math.min(start, snapshot.draft.length))
        const safeEnd = Math.max(safeStart, Math.min(end, snapshot.draft.length))
        const cursorStart = this.insertText(input, '', safeStart, safeEnd)
        const cursor = this.insertExistingRefs(input, [existing], [], cursorStart)
        this.admitNativePreviews(sessionId, input, [existing])
        requestAnimationFrame(() => {
          target.focus({ preventScroll: true })
          target.setSelectionRange(cursor, cursor)
        })
        return
      }
    }
    this.finishBridge(sessionId, input, files, clean, start, end, target, dragEnd)
  }

  /** Notify once per retry window that the bridge is unreachable (GA20). */
  private notifyBridgeDown(input: ReturnType<PasteImageController['inputFor']>): void {
    if (Date.now() - this.lastBridgeNoticeAt < this.VERDICT_RETRY_MS) return
    this.lastBridgeNoticeAt = Date.now()
    input.notify('error', 'The image bridge is temporarily unreachable; pasted images were routed through it as a text-safe fallback.')
  }

  /**
   * Release the held event natively for a confirmed multimodal model.
   * Preferred: the conversation service's public image-draft API so the
   * attachment rail updates exactly like a trusted paste (GA21). Fallback:
   * one untrusted synthetic replay of the same event (guarded against
   * reentrancy); this degrades silently if the app gates on isTrusted.
   */
  private releaseNatively(
    input: ReturnType<PasteImageController['inputFor']>,
    files: readonly File[],
    text: string,
    start: number,
    end: number,
    target: HTMLElement,
    kind: 'paste' | 'drop',
  ): void {
    if (this.replaying) return
    const ctx = this.ctx as ClientContext & { get?: (name: string) => unknown }
    const conversation = typeof ctx.get === 'function' ? ctx.get('conversation') : undefined
    const face = conversation as {
      createDraftImages?: (files: readonly File[]) => Array<{ id: string }>
    } | undefined
    const shell = input as unknown as { addImages?: (ids: readonly string[]) => boolean }
    if (typeof face?.createDraftImages === 'function' && typeof shell.addImages === 'function') {
      try {
        // Call as a method: `createDraftImages` reads internal state off its
        // receiver (`this.draftAttachments`), so a detached call throws
        // "Cannot read properties of undefined".
        const images = face.createDraftImages(files)
        if (shell.addImages(images.map(image => image.id))) {
          const snapshot = input.state.getSnapshot()
          const safeStart = Math.max(0, Math.min(start, snapshot.draft.length))
          const safeEnd = Math.max(safeStart, Math.min(end, snapshot.draft.length))
          this.insertText(input, text, safeStart, safeEnd)
          return
        }
      } catch (error) {
        input.notify('error', message(error))
        return
      }
    }

    this.replaying = true
    try {
      const event = new Event(kind, { bubbles: true, cancelable: true }) as ClipboardEvent
      const data = {
        items: files.map(file => ({ kind: 'file', type: file.type, getAsFile: () => file })),
        files,
        getData: (mediaType: string) => mediaType === 'text/plain' ? text : '',
      }
      Object.defineProperty(event, kind === 'drop' ? 'dataTransfer' : 'clipboardData', { value: data })
      target.dispatchEvent(event)
    } finally {
      this.replaying = false
    }
  }

  private async settlePaste(
    sessionId: string,
    pick: ModelPick,
    input: ReturnType<PasteImageController['inputFor']>,
    files: readonly File[],
    refs: readonly DroppedBridgeRef[],
    text: string,
    start: number,
    end: number,
    target: HTMLTextAreaElement,
    kind: 'paste' | 'drop',
  ): Promise<void> {
    try {
      const verdict = await this.refreshVerdict(sessionId, pick)
      if (verdict === undefined) {
        // Verdict unavailable: bridge is the text-safe direction for a
        // possibly text-only model, plus a one-time notice (GA20).
        this.notifyBridgeDown(input)
        if (input.state.getSnapshot().phase !== 'plain') return
        this.finishPayload(sessionId, input, files, refs, text, start, end, target, kind === 'drop')
        return
      }
      if (verdict === true) {
        if (input.state.getSnapshot().phase !== 'plain') return
        this.finishPayload(sessionId, input, files, refs, text, start, end, target, kind === 'drop')
        return
      }
      if (input.state.getSnapshot().phase !== 'plain') return
      this.releaseNatively(input, files, sanitizeBridgeText(text), start, end, target, kind)
    } catch (error) {
      input.notify('error', message(error))
    }
  }

  handlePaste(event: ClipboardEvent): boolean {
    if (this.replaying) return false
    const target = event.target
    if (!(target instanceof HTMLTextAreaElement) || target.closest('[data-composer-card]') === null) return false

    const sessionId = this.ctx.sessions.list.getSnapshot().current
    if (sessionId === undefined) return false

    const files = imageFiles(event.clipboardData)
    const refs = bridgeRefsFromPayload(event.clipboardData)
    if (files.length === 0 && refs.length === 0) return false

    // A fresh cached verdict decides synchronously so a native (multimodal)
    // paste still reaches the app handlers untouched.
    const cached = this.syncTakeover(String(sessionId))

    // A bridged file-route URL pasted as text: hold it and re-materialize
    // the image through the same verdict chain as the drop counterpart.
    if (files.length === 0 && refs.length > 0) {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      const input = this.inputFor(sessionId)
      const snapshot = input.state.getSnapshot()
      const start = Math.max(0, Math.min(target.selectionStart ?? snapshot.draft.length, snapshot.draft.length))
      const end = Math.max(start, Math.min(target.selectionEnd ?? start, snapshot.draft.length))
      const session = String(sessionId)
      if (cached === false) {
        void this.materializeNativeDroppedRefs(input, refs, start, end, target, 'paste')
          .catch(error => input.notify('error', message(error)))
        return true
      }
      const pick = this.currentPick(session)
      if (cached === true || this.verdictKey(session, pick) === undefined) {
        if (snapshot.phase !== 'plain') return true
        void this.bridgeDroppedRefs(session, input, refs, start, end, target)
          .catch(error => input.notify('error', message(error)))
        return true
      }
      void this.settleDroppedRefs(session, pick, input, refs, start, end, target, 'paste')
      return true
    }

    const input = this.inputFor(sessionId)
    const snapshot = input.state.getSnapshot()
    const start = Math.max(0, Math.min(target.selectionStart ?? snapshot.draft.length, snapshot.draft.length))
    const end = Math.max(start, Math.min(target.selectionEnd ?? start, snapshot.draft.length))
    const text = (event.clipboardData?.getData('text/plain') ?? '').replaceAll('\uFFFC', '')

    if (cached === false) {
      // Confirmed multimodal: let the host add the image natively, but never
      // let a bridged-tile payload leak its raw path/markdown into the draft
      // (A29 mixed payload on the native verdict path).
      if (refs.length === 0) return false
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      if (snapshot.phase !== 'plain') return true
      try {
        this.releaseNatively(input, files, sanitizeBridgeText(text), start, end, target, 'paste')
      } catch (error) {
        input.notify('error', message(error))
      }
      return true
    }

    if (cached === true) {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      if (snapshot.phase !== 'plain') return true
      try {
        this.finishPayload(String(sessionId), input, files, refs, text, start, end, target)
      } catch (error) {
        input.notify('error', message(error))
      }
      return true
    }

    // Unknown verdict: hold the event — it must not reach the native handler
    // with an unconfirmed text-only model — then decide asynchronously (GA3).
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    const pick = this.currentPick(String(sessionId))
    if (this.verdictKey(String(sessionId), pick) === undefined) {
      // No model signal at all — e.g. the harness agent composer has no model
      // picker — so bridge: the text-safe direction. A native release here
      // puts an image block straight into the message and pi-ai text-only
      // models reject the whole request with UNSUPPORTED_CONTENT (session
      // evidence: agentHome 41683fc5, 2026-08-16).
      if (snapshot.phase !== 'plain') return true
      try {
        this.finishPayload(String(sessionId), input, files, refs, text, start, end, target)
      } catch (error) {
        input.notify('error', message(error))
      }
      return true
    }
    void this.settlePaste(String(sessionId), pick, input, files, refs, text, start, end, target, 'paste')
    return true
  }

  handleDrop(event: DragEvent): boolean {
    if (this.replaying) return false

    // Find the composer textarea the drop landed on, falling back to the
    // focused composer when the drop target is a decorative child.
    const target = event.target
    const card = target instanceof Element ? target.closest('[data-composer-card]') : null
    const textarea = card?.querySelector('textarea')
      ?? (document.activeElement instanceof HTMLTextAreaElement
        && document.activeElement.closest('[data-composer-card]') !== null
        ? document.activeElement
        : null)
      ?? document.querySelector<HTMLTextAreaElement>('[data-composer-card] textarea')
    if (!(textarea instanceof HTMLTextAreaElement)) return false

    const sessionId = this.ctx.sessions.list.getSnapshot().current
    if (sessionId === undefined) return false

    const files = imageFiles(event.dataTransfer)
    const refs = bridgeRefsFromPayload(event.dataTransfer)
    if (files.length === 0 && refs.length === 0) return false

    // A fresh cached verdict decides synchronously so a native (multimodal)
    // file drop still reaches the app handlers untouched.
    const cached = this.syncTakeover(String(sessionId))

    // URL-only drop of a bridged tile: hold it — never let the textarea
    // swallow the raw file-route URL/markup (agentHome b98c935b) — then
    // re-materialize through the same verdict chain as a file drop.
    if (files.length === 0 && refs.length > 0) {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      window.dispatchEvent(new Event('dragend'))
      const input = this.inputFor(sessionId)
      const snapshot = input.state.getSnapshot()
      const start = Math.max(0, Math.min(textarea.selectionStart ?? snapshot.draft.length, snapshot.draft.length))
      const end = Math.max(start, Math.min(textarea.selectionEnd ?? start, snapshot.draft.length))
      const session = String(sessionId)
      if (cached === false) {
        // Confirmed multimodal: fetch the bytes and insert a real image
        // block (direct vision, native bubble) instead of path text.
        void this.materializeNativeDroppedRefs(input, refs, start, end, textarea, 'drop')
          .catch(error => input.notify('error', message(error)))
        return true
      }
      const pick = this.currentPick(session)
      if (cached === true || this.verdictKey(session, pick) === undefined) {
        // Bridged text model (cached) or no model signal at all (harness
        // agent composer): bridge, the text-safe direction.
        if (snapshot.phase !== 'plain') return true
        void this.bridgeDroppedRefs(session, input, refs, start, end, textarea)
          .catch(error => input.notify('error', message(error)))
        return true
      }
      void this.settleDroppedRefs(session, pick, input, refs, start, end, textarea, 'drop')
      return true
    }

    const input = this.inputFor(sessionId)
    const snapshot = input.state.getSnapshot()
    const start = Math.max(0, Math.min(textarea.selectionStart ?? snapshot.draft.length, snapshot.draft.length))
    const end = Math.max(start, Math.min(textarea.selectionEnd ?? start, snapshot.draft.length))
    const text = (event.dataTransfer?.getData('text/plain') ?? '').replaceAll('\uFFFC', '')

    if (cached === false) {
      // Confirmed multimodal: let the host add the image natively, but never
      // let a bridged-tile payload leak its raw path/markdown into the draft
      // (A29 mixed payload on the native verdict path).
      if (refs.length === 0) return false
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      window.dispatchEvent(new Event('dragend'))
      if (snapshot.phase !== 'plain') return true
      try {
        this.releaseNatively(input, files, sanitizeBridgeText(text), start, end, textarea, 'drop')
      } catch (error) {
        input.notify('error', message(error))
      }
      return true
    }

    // The native DSH drop handler normally resets its drag overlay here; since
    // this capture-phase takeover stops that handler, tell it to reset now.
    if (cached === true) {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      window.dispatchEvent(new Event('dragend'))
      if (snapshot.phase !== 'plain') return true
      try {
        this.finishPayload(String(sessionId), input, files, refs, text, start, end, textarea, true)
      } catch (error) {
        input.notify('error', message(error))
      }
      return true
    }

    // Unknown verdict: hold the drop, then decide asynchronously (GA3).
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    window.dispatchEvent(new Event('dragend'))
    const pick = this.currentPick(String(sessionId))
    if (this.verdictKey(String(sessionId), pick) === undefined) {
      // No model signal at all: bridge, the text-safe direction (see the
      // paste counterpart above).
      if (snapshot.phase !== 'plain') return true
      try {
        this.finishPayload(String(sessionId), input, files, refs, text, start, end, textarea, true)
      } catch (error) {
        input.notify('error', message(error))
      }
      return true
    }
    void this.settlePaste(String(sessionId), pick, input, files, refs, text, start, end, textarea, 'drop')
    return true
  }

  remove(sessionId: string, occurrence: PasteOccurrence): void {
    const record = this.records.get(occurrence.ref)
    if (record?.batch.inflight !== undefined) return
    const input = this.inputFor(sessionId)
    const snapshot = input.state.getSnapshot()
    if (snapshot.phase !== 'plain') return
    const current = occurrencesOf(snapshot).find(candidate =>
      candidate.source === SOURCE
      && candidate.occurrenceId === occurrence.occurrenceId
      && candidate.ref === occurrence.ref)
    if (current === undefined) return
    const accepted = (input as typeof input & {
      insertText: (text: string, span: { start: number; end: number; draftRev: number }) => boolean
    }).insertText('', {
      start: current.offset,
      end: current.offset + (current.length ?? 1),
      draftRev: snapshot.draftRev,
    })
    if (!accepted) return
    this.records.delete(occurrence.ref)
    this.changed()
  }

  /** A same-tab record whose uploaded workspace file is the dropped one. */
  private findUploadedRecord(ref: DroppedBridgeRef): PasteRecord | undefined {
    for (const record of this.records.values()) {
      if (record.batch.sessionId !== ref.sessionId) continue
      if (record.absolutePath === undefined) continue
      if (record.absolutePath.split(/[\\/]/u).pop() === ref.name) return record
    }
    return undefined
  }

  /** Download one bridged image back over the session-authorized file route. */
  private async fetchBridgeFile(ref: DroppedBridgeRef): Promise<File> {
    const url = `${PASTE_IMAGES_ROUTE}/file?sessionId=${encodeURIComponent(ref.sessionId)}&name=${encodeURIComponent(ref.name)}`
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) throw new Error(`Pasted image is no longer available in this workspace (${response.status})`)
    const mediaType = (response.headers.get('content-type') ?? 'image/png').split(';')[0]?.trim() ?? 'image/png'
    const ext = /\.(png|jpe?g|gif|webp)\b/iu.exec(ref.name)?.[1] ?? ''
    const type = mediaType.toLowerCase().startsWith('image/') ? mediaType : `image/${ext || 'png'}`
    const bytes = new Uint8Array(await response.arrayBuffer())
    return new File([bytes], ref.name, { type })
  }

  /**
   * Re-materialize bridge file-route URLs as text-safe references: reuse a
   * same-tab uploaded record, otherwise download the bytes and treat them as
   * a fresh File (the ordinary bridge copies it at serialize time). The
   * dropped URL text itself is NEVER written into the draft.
   */
  private async bridgeDroppedRefs(
    sessionId: string,
    input: ReturnType<PasteImageController['inputFor']>,
    refs: readonly DroppedBridgeRef[],
    start: number,
    end: number,
    target: HTMLTextAreaElement,
  ): Promise<void> {
    const snapshot = input.state.getSnapshot()
    const safeStart = Math.max(0, Math.min(start, snapshot.draft.length))
    const safeEnd = Math.max(safeStart, Math.min(end, snapshot.draft.length))
    const cursorStart = this.insertText(input, '', safeStart, safeEnd)
    const batch: PasteBatch = { sessionId, records: [] }
    const records: PasteRecord[] = []
    for (const ref of refs) {
      const existing = this.findUploadedRecord(ref)
      if (existing !== undefined) {
        records.push(existing)
        continue
      }
      const fetched = await this.fetchBridgeFile(ref)
      const record: PasteRecord = { ref: id(), file: fetched, batch, status: 'ready' }
      batch.records.push(record)
      this.records.set(record.ref, record)
      records.push(record)
    }
    const cursor = this.insertExistingRefs(input, records, batch.records, cursorStart)
    if (batch.records.length > 0) this.bindBatchCleanup(batch, input)
    this.admitNativePreviews(sessionId, input, records)
    requestAnimationFrame(() => {
      target.focus({ preventScroll: true })
      target.setSelectionRange(cursor, cursor)
    })
  }

  /** Multimodal verdict: give the model a real image block, not path text. */
  private async materializeNativeDroppedRefs(
    input: ReturnType<PasteImageController['inputFor']>,
    refs: readonly DroppedBridgeRef[],
    start: number,
    end: number,
    target: HTMLTextAreaElement,
    kind: 'paste' | 'drop',
  ): Promise<void> {
    if (input.state.getSnapshot().phase !== 'plain') return
    const files = await Promise.all(refs.map(ref => this.fetchBridgeFile(ref)))
    this.releaseNatively(input, files, '', start, end, target, kind)
  }

  /** Held URL payload: verdict false → native block; true/unavailable → bridge. */
  private async settleDroppedRefs(
    sessionId: string,
    pick: ModelPick,
    input: ReturnType<PasteImageController['inputFor']>,
    refs: readonly DroppedBridgeRef[],
    start: number,
    end: number,
    target: HTMLTextAreaElement,
    kind: 'paste' | 'drop',
  ): Promise<void> {
    try {
      const verdict = await this.refreshVerdict(sessionId, pick)
      if (verdict === false) {
        if (input.state.getSnapshot().phase !== 'plain') return
        const files = await Promise.all(refs.map(ref => this.fetchBridgeFile(ref)))
        this.releaseNatively(input, files, '', start, end, target, kind)
        return
      }
      if (verdict === undefined) this.notifyBridgeDown(input)
      if (input.state.getSnapshot().phase !== 'plain') return
      await this.bridgeDroppedRefs(sessionId, input, refs, start, end, target)
    } catch (error) {
      input.notify('error', message(error))
    }
  }

  private async upload(batch: PasteBatch, signal: AbortSignal): Promise<void> {
    if (batch.inflight !== undefined) return batch.inflight
    const active = batch.records.filter(record => this.records.get(record.ref) === record)
    if (active.length === 0) throw new Error('Pasted images were removed before sending')
    const pending = active.filter(record => record.absolutePath === undefined)
    if (pending.length === 0) return
    const task = (async () => {
      for (const record of pending) {
        record.status = 'copying'
        record.error = undefined
      }
      this.changed()
      try {
        const failures = await Promise.all(pending.map(async (record) => {
          try {
            if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
            const query = new URLSearchParams({
              sessionId: batch.sessionId,
              name: record.file.name || 'clipboard-image',
              size: String(record.file.size),
            })
            const body = await responseJson(await fetch(`${PASTE_IMAGES_ROUTE}?${query.toString()}`, {
              method: 'POST',
              headers: { 'Content-Type': record.file.type },
              body: record.file,
              signal,
            }))
            const absolutePath = body.value?.absolutePath
            if (typeof absolutePath !== 'string' || absolutePath === '') {
              throw new Error('Image copy response contained an invalid path')
            }
            record.absolutePath = absolutePath
            const filename = body.value?.filename
            if (typeof filename === 'string' && filename.trim() !== '') record.filename = filename.trim()
            record.status = 'copied'
            record.error = undefined
            return undefined
          } catch (error) {
            const failure = error instanceof Error ? error : new Error(message(error))
            record.status = 'error'
            record.error = failure.message
            return failure
          }
        }))
        this.changed()
        const failure = failures.find((error): error is Error => error !== undefined)
        if (failure !== undefined) throw failure
      } finally {
        batch.inflight = undefined
        this.changed()
      }
    })()
    batch.inflight = task
    return task
  }

  private async serialize(ref: string, signal: AbortSignal): Promise<string> {
    const record = this.records.get(ref)
    if (record === undefined) throw new Error('Pasted image is no longer available in this browser tab')
    await this.upload(record.batch, signal)
    if (record.absolutePath === undefined) throw new Error('Pasted image was not copied into the workspace')
    const leaf = record.absolutePath.split(/[\\/]/u).pop() ?? 'pasted-image'
    const label = (record.filename ?? record.file.name).trim().replace(/[[\]]/g, '') || leaf
    const fileUrl =
      `${PASTE_IMAGES_ROUTE}/file?sessionId=${encodeURIComponent(record.batch.sessionId)}&name=${encodeURIComponent(leaf)}`
    return `[Pasted image available at absolute path: ${JSON.stringify(record.absolutePath)}]\n\n![${label}](<${fileUrl}>)`
  }
}

/** One bridged image in the composer rail: large clickable thumbnail, no visible filename. */
function PasteImagePreview(props: {
  file: File
  name: string
  status: PasteRecord['status']
  error?: string | undefined
  disabled: boolean
  onRemove: () => void
}): ReactNode {
  const [url, setUrl] = useState('')
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return undefined
    const objectUrl = URL.createObjectURL(props.file)
    setUrl(objectUrl)
    setFailed(false)
    return () => { URL.revokeObjectURL(objectUrl) }
  }, [props.file])

  const removeLabel = `移除 ${props.name}`
  const previewLabel = `预览 ${props.name}`

  return <div className="dvt-paste-item" data-status={props.status}>
    <button
      type="button"
      className="dvt-paste-preview"
      data-status={props.status}
      disabled={failed || url === ''}
      title={props.status === 'error' ? props.error ?? props.name : props.name}
      aria-label={previewLabel}
      onClick={() => { setOpen(true) }}
    >
      {url === '' || failed
        ? <span className="dvt-paste-img-text">{failed ? '图片加载失败' : null}</span>
        : <img className="dvt-paste-preview-img" src={url} alt={props.name} onError={() => { setFailed(true) }} />}
      {props.status === 'copying' ? <span className="dvt-paste-status" aria-hidden="true">复制中…</span> : null}
      {props.status === 'error' ? <span className="dvt-paste-status" data-kind="error" aria-hidden="true">!</span> : null}
    </button>
    <button
      type="button"
      className="dvt-paste-remove"
      aria-label={removeLabel}
      disabled={props.disabled}
      onClick={props.onRemove}
    >×</button>
    {open && <ImageLightbox src={url} alt={props.name} dialog="图片预览" close="关闭预览" onClose={() => { setOpen(false) }} />}
  </div>
}

/**
 * Fallback preview rail above the composer. Bridged images normally render in
 * the host’s native in-card attachment rail; this surface remains for copies,
 * errors, and harness builds whose guest input has no draft-image API.
 */
export function PasteImageDock(props: PasteDockProps): ReactNode {
  useSyncExternalStore(props.controller.subscribe, props.controller.snapshot)
  const occurrences = props.input.occurrences.filter(occurrence => occurrence.source === SOURCE)
  const records = props.controller.recordsForDock(occurrences)
  if (records.length === 0) return null
  return <div className="dvt-paste-dock" role="status" aria-label="已添加的图片">
    {occurrences.map((occurrence) => {
      const record = props.controller.recordsFor([occurrence])[0]
      if (record === undefined) return null
      const name = record.filename?.trim() || record.file.name.trim() || 'clipboard image'
      return <PasteImagePreview
        key={occurrence.occurrenceId}
        file={record.file}
        name={name}
        status={record.status}
        error={record.error}
        disabled={props.input.phase !== 'plain' || record.status === 'copying'}
        onRemove={() => { props.remove(occurrence) }}
      />
    })}
  </div>
}

/** Install capture interception, the text-reference codec, and composer feedback. */
export function installPasteImages(ctx: ClientContext): void {
  const controller = new PasteImageController(ctx)
  const registered = new WeakMap<object, ReferenceSourceRegistration>()
  const register = (scope: ClientContext, registry: ReferenceSourceRegistry): void => {
    scope.effect(() => {
      const identity = registryIdentity(registry)
      let registration = registered.get(identity)
      if (registration === undefined) {
        registration = { dispose: registry.registerSource(controller.source()), owners: 0 }
        registered.set(identity, registration)
      }
      registration.owners += 1
      return () => {
        if (registered.get(identity) !== registration) return
        registration.owners -= 1
        if (registration.owners > 0) return
        registered.delete(identity)
        registration.dispose()
      }
    }, 'dsh-vision-cloud: pasted image reference codec')
  }
  ctx.inject(['slash'], (scope: ClientContext) => {
    register(scope, (scope as unknown as LegacySlashContext).slash)
  })
  ctx.inject(['inputTriggers'], (scope: ClientContext) => {
    register(scope, (scope as unknown as LegacyTriggerContext).inputTriggers)
  })
  ctx.effect(() => {
    const listener = (event: ClipboardEvent): void => { controller.handlePaste(event) }
    const onDrop = (event: DragEvent): void => { controller.handleDrop(event) }
    const onFocus = (): void => { controller.prefetch() }
    const onDragEnter = (event: DragEvent): void => {
      if (event.dataTransfer?.types.includes('Files') ?? false) controller.prefetch()
    }
    document.addEventListener('paste', listener, true)
    document.addEventListener('drop', onDrop, true)
    document.addEventListener('dragenter', onDragEnter, true)
    document.addEventListener('focusin', onFocus, true)
    return () => {
      document.removeEventListener('paste', listener, true)
      document.removeEventListener('drop', onDrop, true)
      document.removeEventListener('dragenter', onDragEnter, true)
      document.removeEventListener('focusin', onFocus, true)
    }
  }, 'dsh-vision-cloud: image capture')
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'vision-cloud-pasted-images',
    order: 6,
    inject: sessionId => ({
      controller,
      remove: (occurrence: PasteOccurrence) => { controller.remove(String(sessionId), occurrence) },
    }),
  }, PasteImageDock))
  // Shadow the product's keyed user/steering message views at a very low
  // priority (DSH renders the lowest-priority live entry per keyed cell).
  // While installed, bridged paste-to-path messages render as image tiles plus
  // clean text instead of leaking the model-facing path markup, and every
  // other user message is re-rendered to match the product bubble. The error
  // boundary keeps this entry mounted even if a host UI primitive is missing,
  // so the product's raw-text view cannot take the seat back.
  ctx.slots.inject('conversation.chat.node', () => {
    const disposeUser = ctx.slots.register({
      name: 'conversation.chat.node',
      key: 'user',
      priority: -1000,
      locale: 'conversation',
    }, UserMessageShadowBoundary)
    const disposeSteering = ctx.slots.register({
      name: 'conversation.chat.node',
      key: 'steering',
      priority: -1000,
      locale: 'conversation',
    }, UserMessageShadowBoundary)
    return () => { disposeSteering(); disposeUser() }
  })
}
