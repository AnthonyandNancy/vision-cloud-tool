/** Workspace-local storage for images pasted into the DSH Web composer. */

import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session'
import { sameOriginPost } from './web-request.ts'

/** Exact route used by the browser paste integration. */
export const PASTE_IMAGES_ROUTE = '/_dsh/vision-cloud/paste-images'

/** Read-only route that serves bridged images back to their owning session. */
export const PASTE_IMAGE_FILE_ROUTE = '/_dsh/vision-cloud/paste-images/file'

const MAX_NAME_BYTES = 180

/** Leading digest characters used for content-addressed paste filenames. */
const HASH_PREFIX_LENGTH = 16

/**
 * Browser/app drag sources commonly supply placeholder labels such as
 * `image.png` or `截图.png`. A matching stem carries no human meaning, so the
 * hashed filename omits it and keeps the pure `<hash>.<ext>` shape.
 */
const GENERIC_IMAGE_STEM_RE = /^(?:image|img|picture|photo|screenshot|screen[-_. ]?shot|screencap|paste|pasted[-_. ]?image|clipboard[-_. ]?image|clipboard|untitled|noname|no[-_. ]?name|未命名|无标题|图片|截图|屏幕截图|截屏)(?:[-_. ]*\d{0,4})?$/iu

/** Media types served by the read-only bridged-image file route. */
const FORMAT_MEDIA_TYPE_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

interface PasteImageResponse {
  ok: true
  value: { absolutePath: string; filename: string; bytes: number }
}

interface PasteImageFailure {
  ok: false
  error: { code: string; message: string }
}

type PasteImageResult = PasteImageResponse | PasteImageFailure

function responseJson(res: ServerResponse, status: number, body: PasteImageResult): void {
  const bytes = Buffer.from(JSON.stringify(body))
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', String(bytes.length))
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
  res.writeHead(status)
  res.end(bytes)
}

function requestError(res: ServerResponse, status: number, code: string, message: string): void {
  responseJson(res, status, { ok: false, error: { code, message } })
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function singleQuery(url: URL, key: string): string {
  const values = url.searchParams.getAll(key)
  if (values.length !== 1 || values[0] === undefined || values[0] === '') {
    throw new TypeError(`${key} is required exactly once`)
  }
  return values[0]
}

function declaredSize(url: URL): number {
  const value = Number(singleQuery(url, 'size'))
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('size must be a positive safe integer')
  return value
}

function imageMediaType(req: IncomingMessage): string {
  const value = req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
  if (value === undefined || !value.startsWith('image/')) throw new TypeError('Content-Type must be image/*')
  return value
}

function extensionFor(mediaType: string): string {
  switch (mediaType) {
    case 'image/jpeg': return '.jpg'
    case 'image/png': return '.png'
    case 'image/gif': return '.gif'
    case 'image/webp': return '.webp'
    case 'image/bmp': return '.bmp'
    case 'image/tiff': return '.tiff'
    case 'image/avif': return '.avif'
    case 'image/heic': return '.heic'
    case 'image/heif': return '.heif'
    case 'image/svg+xml': return '.svg'
    default: return '.img'
  }
}

/** Convert an untrusted browser label into one portable leaf filename. */
export function safePastedImageName(raw: string, mediaType: string): string {
  const leaf = basename(raw.replaceAll('\\', '/')).normalize('NFC')
  let cleaned = leaf
    .replace(/[<>:"|?*\u0000-\u001f/\\]/gu, '_')
    .replace(/\s+/gu, ' ')
    .replace(/^\.+/u, '')
    .trim()
    .replace(/[. ]+$/u, '')
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(cleaned)) cleaned = `_${cleaned}`
  const fallback = `clipboard-image${extensionFor(mediaType)}`
  const candidate = cleaned === '' || cleaned === '.' || cleaned === '..' ? fallback : cleaned
  if (Buffer.byteLength(candidate) <= MAX_NAME_BYTES) return candidate
  const extension = extname(candidate).slice(0, 20)
  const budget = Math.max(1, MAX_NAME_BYTES - Buffer.byteLength(extension))
  let stem = candidate.slice(0, Math.max(1, candidate.length - extension.length))
  while (Buffer.byteLength(stem) > budget) stem = stem.slice(0, -1)
  return `${stem}${extension}`
}


/**
 * Derive the final content-addressed leaf for one pasted image.
 * Meaningful original stems keep a readable suffix (`<hash>-login-page.png`);
 * generic placeholders such as `image.png` collapse to pure `<hash>.png`.
 * The extension follows the declared media type when it maps to a known
 * format, falling back to the sanitized browser-label extension otherwise.
 */
export function hashedPastedImageName(raw: string, mediaType: string, digest: string): string {
  if (!/^[0-9a-f]{16,}$/iu.test(digest)) throw new TypeError('hashedPastedImageName requires a SHA-256 hex digest')
  const prefix = digest.slice(0, HASH_PREFIX_LENGTH).toLowerCase()
  const sanitized = safePastedImageName(raw, mediaType)
  const sourceExtension = extname(sanitized).slice(0, 20)
  const declaredExtension = extensionFor(mediaType)
  const extension = declaredExtension !== '.img' ? declaredExtension : sourceExtension.toLowerCase() || declaredExtension
  let stem = sourceExtension === '' ? sanitized : sanitized.slice(0, sanitized.length - sourceExtension.length)
  stem = stem.replace(/[. ]+$/u, '')

  // Re-bridging a rendered tile feeds the previous hashed leaf back as the
  // browser File name; the same bytes then hash to the same prefix and the
  // old prefix would otherwise be prefixed a second time.
  const previousPrefix = `${prefix}-`
  if (stem.toLowerCase().startsWith(previousPrefix)) stem = stem.slice(previousPrefix.length)

  if (stem === '' || GENERIC_IMAGE_STEM_RE.test(stem)) return `${prefix}${extension}`
  const stemBudget = Math.max(1, MAX_NAME_BYTES - Buffer.byteLength(`${previousPrefix}${extension}`))
  while (Buffer.byteLength(stem) > stemBudget) stem = stem.slice(0, -1)
  return `${previousPrefix}${stem}${extension}`
}

/** Reject a resolved path that is not rooted below the expected directory. */
export function ensurePathInside(root: string, target: string): void {
  const rel = relative(root, target)
  if (rel !== '' && (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))) {
    throw new Error(`resolved pasted-image path escapes its workspace root: ${target}`)
  }
}

interface PasteRoot {
  writeRoot: string
  visibleRoot: string
}

async function ensureManagedDirectory(workspace: string, path: string): Promise<string> {
  try {
    await mkdir(path, { mode: 0o700 })
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
  }
  const entry = await lstat(path)
  if (entry.isSymbolicLink()) {
    throw new Error(`resolved pasted-image path escapes its workspace root: symbolic link ${path}`)
  }
  if (!entry.isDirectory()) throw new Error(`pasted-image path is not a directory: ${path}`)
  const canonical = await realpath(path)
  ensurePathInside(workspace, canonical)
  return canonical
}

async function sessionPasteRoot(ctx: Context, sessionId: string): Promise<PasteRoot> {
  const session = ctx.sessions.get(sessionId as never)
  if (session === undefined) throw new Error(`live Session not found: ${sessionId}`)
  const cwd = session.header.cwd
  if (cwd === undefined || !isAbsolute(cwd)) throw new Error(`Session has no absolute workspace: ${sessionId}`)

  const visibleWorkspace = resolve(cwd)
  const workspace = await realpath(visibleWorkspace)
  const pluginRoot = join(visibleWorkspace, '.dsh-vision-cloud')
  await ensureManagedDirectory(workspace, pluginRoot)
  const temporaryRoot = join(pluginRoot, 'tmp')
  await ensureManagedDirectory(workspace, temporaryRoot)
  const requestedRoot = join(temporaryRoot, 'pasted-images')
  const root = await ensureManagedDirectory(workspace, requestedRoot)

  const sessionKey = createHash('sha256').update(sessionId).digest('hex').slice(0, 20)
  const requestedSessionRoot = join(requestedRoot, sessionKey)
  const sessionRoot = await ensureManagedDirectory(root, requestedSessionRoot)
  ensurePathInside(root, sessionRoot)
  return { writeRoot: sessionRoot, visibleRoot: requestedSessionRoot }
}

interface WrittenPastedImage {
  path: string
  filename: string
}

/**
 * Publish a fully written staging file into its content-addressed slot.
 * When the target already exists its digest equals ours (hash collision is
 * cryptographically negligible), so the existing copy is kept instead of
 * overwriting identical bytes. A concurrent upload of the same content may
 * publish first; we then discard the staging copy as well.
 */
async function publishStagedImage(stagingPath: string, finalPath: string): Promise<void> {
  try {
    const existing = await lstat(finalPath)
    if (!existing.isFile()) throw new Error(`pasted-image target is not a regular file: ${finalPath}`)
    await rm(stagingPath, { force: true })
    return
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  }

  try {
    await rename(stagingPath, finalPath)
  } catch (error) {
    const code = (error as { code?: unknown })?.code
    if (code !== 'EEXIST' && code !== 'EPERM') throw error
    const existing = await lstat(finalPath)
    if (!existing.isFile()) throw error
    await rm(stagingPath, { force: true }).catch(() => {})
  }
}

async function writeImage(
  req: IncomingMessage,
  directory: string,
  rawName: string,
  mediaType: string,
  expectedBytes: number,
  maxBytes: number,
): Promise<WrittenPastedImage> {
  if (expectedBytes > maxBytes) throw new RangeError(`image exceeds the ${maxBytes}-byte paste limit`)
  const id = randomUUID()
  const stagingPath = join(directory, `.${id}.partial`)
  ensurePathInside(directory, stagingPath)

  const handle = await open(stagingPath, 'wx', 0o600)
  const digest = createHash('sha256')
  let received = 0
  try {
    for await (const chunk of req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      received += bytes.length
      if (received > expectedBytes || received > maxBytes) throw new RangeError('pasted image body exceeds its declared size')
      digest.update(bytes)
      await handle.write(bytes)
    }
    if (received !== expectedBytes) {
      throw new Error(`pasted image body size mismatch: expected ${expectedBytes}, received ${received}`)
    }
    await handle.sync()
    await handle.close()

    const filename = hashedPastedImageName(rawName, mediaType, digest.digest('hex'))
    const finalPath = join(directory, filename)
    ensurePathInside(directory, finalPath)
    await publishStagedImage(stagingPath, finalPath)
    return { path: finalPath, filename }
  } catch (error) {
    await handle.close().catch(() => {})
    await rm(stagingPath, { force: true }).catch(() => {})
    throw error
  }
}

/** Runtime limit face kept separate for focused backend tests. */
export interface PasteImageRuntime {
  maxImageBytes(): number
  pasteToPath(): boolean
}

/** Same-origin, live-Session-bound image upload endpoint. */
export class PastedImageBackend {
  constructor(
    private readonly ctx: Context,
    private readonly runtime: PasteImageRuntime,
  ) {}

  /**
   * Whether the model behind a selector label is text-only (and therefore
   * needs a paste-to-path takeover). A match that declares image input vetoes
   * the takeover, so a multimodal model keeps its native paste.
   *
   * Priority (freshest signal first):
   * 1. The explicit provider/model pair sent by the client (from the live
   *    model-selection store) — freshest, and authoritative via
   *    `resolveModelInfo()` even for pi-ai dynamic routes.
   * 2. A definite catalog answer for the selector label — the composer label
   *    reflects the UI selection NOW, while `requestContext()` only reflects
   *    the last request/context event (stale until the next send).
   * 3. The live session's exact provider/model — last resort for custom
   *    models whose label matches nothing in the advisory catalog.
   * 4. No model information at all → leave the paste native.
   */
  private async takeoverVerdict(
    sessionId: string | undefined,
    label: string,
    pair?: { provider: string; model: string },
  ): Promise<boolean> {
    const llm = this.ctx.llm

    if (pair !== undefined && pair.provider !== '' && pair.model !== '') {
      if (llm === undefined) return true
      return this.takeoverForExact(pair.provider, pair.model)
    }

    const hasCatalog =
      llm !== undefined
      && typeof llm.listProviders === 'function'
      && typeof llm.listModels === 'function'
    if (label.trim() !== '' && hasCatalog) {
      const byLabel = await this.catalogScan(label)
      if (byLabel !== undefined) return byLabel
    }

    const exact = sessionId === undefined ? undefined : this.currentModelFromSession(sessionId)
    if (exact !== undefined) {
      if (llm === undefined) return true
      return this.takeoverForExact(exact.provider, exact.model)
    }

    // No model information at all: bridge, the text-safe direction (3.9).
    // A native verdict here puts a raw image block into the request, which
    // pi-ai text-only models reject outright with UNSUPPORTED_CONTENT; the
    // bridge degrades a possible multimodal model to path text + the vision
    // tool instead — safe in both directions.
    return true
  }

  /**
   * Scan the advisory model catalog for a model named by the selector label.
   * Returns a definite verdict only when the label matches a catalog entry
   * (image-capable → native, otherwise → takeover); `undefined` when the
   * label matches nothing (custom/pi-ai dynamic models are often absent).
   */
  private async catalogScan(label: string): Promise<boolean | undefined> {
    const llm = this.ctx.llm
    if (llm === undefined || typeof llm.listProviders !== 'function' || typeof llm.listModels !== 'function') {
      return undefined
    }
    const lowered = label.toLowerCase()
    for (const info of llm.listProviders()) {
      const providerId = info?.id
      if (providerId === undefined) continue
      let models: Array<{ id?: string; name?: string; inputModalities?: readonly string[] }>
      try {
        models = await llm.listModels(providerId) as unknown as typeof models
      } catch {
        continue
      }
      for (const model of models) {
        const modalities = model?.inputModalities
        for (const candidate of [model?.name, model?.id]) {
          if (typeof candidate !== 'string' || candidate.length < 3) continue
          if (!lowered.includes(candidate.toLowerCase())) continue
          if (Array.isArray(modalities) && modalities.includes('image')) return false
          return true
        }
      }
    }
    return undefined
  }

  /** Read the exact provider/model from a live Session when one is available. */
  private currentModelFromSession(sessionId: string): { provider: string; model: string } | undefined {
    const sessions = this.ctx.sessions as unknown as {
      get?: (id: string) => {
        requestContext?(): { provider?: string; model?: string } | undefined
        requestHeader?(): { config?: { provider?: string; model?: string } } | undefined
      } | undefined
    }
    if (typeof sessions?.get !== 'function') return undefined
    const session = sessions.get(sessionId)
    if (session === undefined) return undefined

    const requestContext = typeof session.requestContext === 'function' ? session.requestContext() : undefined
    if (requestContext?.provider && requestContext?.model) {
      return { provider: requestContext.provider, model: requestContext.model }
    }

    const requestHeader = typeof session.requestHeader === 'function' ? session.requestHeader() : undefined
    const config = requestHeader?.config
    if (config?.provider && config?.model) {
      return { provider: config.provider, model: config.model }
    }
    return undefined
  }

  /**
   * Decide takeover for an exact provider/model. Explicit image input keeps the
   * native paste/drop path; anything else (text-only, absent capability, or a
   * resolution failure) falls back to the paste-to-path bridge.
   */
  private async takeoverForExact(provider: string, model: string): Promise<boolean> {
    const llm = this.ctx.llm
    try {
      if (typeof llm.resolveModelInfo === 'function') {
        const resolved = await llm.resolveModelInfo(provider, model) as {
          inputModalities?: readonly string[]
        }
        if (Array.isArray(resolved?.inputModalities) && resolved.inputModalities.includes('image')) return false
        return true
      }
    } catch {
      // Fall through to the catalog scan, then to a safe takeover default.
    }

    try {
      const models = await llm.listModels(provider) as Array<{
        id?: string
        name?: string
        inputModalities?: readonly string[]
      }>
      for (const entry of models) {
        if (entry?.id !== model && entry?.name !== model) continue
        if (Array.isArray(entry?.inputModalities) && entry.inputModalities.includes('image')) return false
        return true
      }
    } catch {
      // Ignore catalog failures; the exact-model lookup above is authoritative.
    }

    return true
  }

  /**
   * Serve one bridged image back to its owning session (read-only, same-origin
   * inline display). The filename must be a single leaf within the session's
   * managed paste root; symlinks and escapes are re-resolved and rejected.
   */
  private async handleImageFile(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET')
      requestError(res, 405, 'method-not-allowed', 'Use GET')
      return
    }
    try {
      const sessionId = singleQuery(url, 'sessionId')
      const name = singleQuery(url, 'name')
      if (name !== basename(name) || name === '.' || name === '..') {
        throw new TypeError('name must be a single file leaf')
      }
      const extension = extname(name).toLowerCase()
      const mediaType = FORMAT_MEDIA_TYPE_BY_EXTENSION[extension]
      if (mediaType === undefined) {
        throw new TypeError(`unsupported image extension "${extension || '(none)'}"; supported: .png, .jpg, .jpeg, .gif, .webp`)
      }
      const directory = await sessionPasteRoot(this.ctx, sessionId)
      const candidate = join(directory.writeRoot, name)
      ensurePathInside(directory.writeRoot, candidate)
      let target: string
      try {
        target = await realpath(candidate)
      } catch (error) {
        const code = (error as { code?: unknown })?.code
        if (code === 'ENOENT') throw new RangeError(`pasted image not found: ${name}`)
        throw error
      }
      ensurePathInside(directory.writeRoot, target)
      const data = await readFile(target)
      res.writeHead(200, {
        'content-type': mediaType,
        'content-length': String(data.length),
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      })
      res.end(data)
    } catch (error) {
      const status = error instanceof RangeError ? 404 : 400
      this.ctx.logger.warn('dsh-vision-cloud pasted image read rejected: %s', message(error))
      requestError(res, status, 'paste-image-read-rejected', message(error))
    }
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? PASTE_IMAGES_ROUTE, 'http://dsh.internal')
    if (url.pathname === PASTE_IMAGE_FILE_ROUTE) {
      if (!this.runtime.pasteToPath()) {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'paste-to-path disabled' }))
        return
      }
      await this.handleImageFile(req, res, url)
      return
    }
    if (url.pathname !== PASTE_IMAGES_ROUTE) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'not found' }))
      return
    }
    if (!this.runtime.pasteToPath()) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'paste-to-path disabled' }))
      return
    }
    if (req.method === 'GET') {
      try {
        const provider = url.searchParams.get('provider')?.trim()
        const modelParam = url.searchParams.get('model') ?? ''
        const sessionId = url.searchParams.get('sessionId') ?? undefined
        // With an explicit provider the `model` parameter carries the exact
        // model id; without one it stays the legacy selector display label.
        const pair = provider !== undefined && provider !== '' && modelParam.trim() !== ''
          ? { provider, model: modelParam.trim() }
          : undefined
        const label = pair === undefined ? modelParam : pair.model
        const takeover = await this.takeoverVerdict(sessionId, label, pair)
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ takeover }))
      } catch (error) {
        this.ctx.logger.warn('dsh-vision-cloud paste verdict failed: %s', message(error))
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ takeover: true }))
      }
      return
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST')
      requestError(res, 405, 'method-not-allowed', 'Use GET or POST')
      return
    }
    if (!sameOriginPost(req)) {
      requestError(res, 403, 'origin-rejected', 'The request must originate from this DSH Web application')
      return
    }

    try {
      const sessionId = singleQuery(url, 'sessionId')
      const size = declaredSize(url)
      const mediaType = imageMediaType(req)
      const rawName = singleQuery(url, 'name')
      const contentLength = req.headers['content-length']
      if (contentLength !== undefined && Number(contentLength) !== size) {
        throw new TypeError('Content-Length does not match the declared size')
      }
      const directory = await sessionPasteRoot(this.ctx, sessionId)
      const written = await writeImage(req, directory.writeRoot, rawName, mediaType, size, this.runtime.maxImageBytes())
      const absolutePath = join(directory.visibleRoot, basename(written.path))
      responseJson(res, 201, { ok: true, value: { absolutePath, filename: written.filename, bytes: size } })
    } catch (error) {
      const status = error instanceof RangeError ? 413 : 400
      this.ctx.logger.warn('dsh-vision-cloud pasted image rejected: %s', message(error))
      requestError(res, status, 'paste-image-rejected', message(error))
    }
  }
}
