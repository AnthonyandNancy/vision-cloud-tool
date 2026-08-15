/**
 * Optional Web-profile routes: the minimal Settings endpoint (model list, save,
 * test read) plus the paste-images route. No secrets, no health/credential
 * surface — the DSH app owns the model's endpoint and key.
 * @module dsh-vision-cloud/web
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { type SettingsDescriptor } from '@deepseek-ai/dsh-settings'
// Type-only import activates the optional webServer Context declaration.
import type {} from '@deepseek-ai/dsh-host-webserver'
import { PastedImageBackend, PASTE_IMAGES_ROUTE } from './paste-images.ts'
import {
  resolveConfig,
  VISION_TOOLKIT_SETTINGS_NAMESPACE,
  type VisionToolkitConfig,
} from './config.ts'
import type { VisionToolkitRuntime } from './runtime.ts'
import { PLUGIN_VERSION } from './version.ts'
import { sameOriginPost } from './web-request.ts'

/** Exact route used by the browser Settings page. */
export const SETTINGS_ROUTE = '/_dsh/vision-cloud/settings'

/** One selectable model under one registered provider route. */
export interface VisionModelEntry {
  id: string
  name: string
  inputModalities: string[]
  reasoningEfforts: string[]
}

/** One provider route and its advertised models. */
export interface VisionProviderEntry {
  provider: string
  name: string
  models: VisionModelEntry[]
}

/** Public Settings snapshot; no credential values are possible here. */
export interface VisionToolkitSettingsSnapshot {
  schemaVersion: 1
  writable: boolean
  pluginVersion: string
  enabled: boolean
  pasteToPath: boolean
  settings: {
    value: VisionToolkitConfig
    revision: number
    applies: 'live'
  }
  providers: VisionProviderEntry[]
}

interface SaveRequest {
  action: 'save'
  expectedRevision: number
  value: VisionToolkitConfig
}

interface TestRequest {
  action: 'testRead'
}

type SettingsRequest = SaveRequest | TestRequest

interface JsonError {
  ok: false
  error: { code: string; message: string }
}

interface JsonSuccess<T> {
  ok: true
  value: T
}

type JsonResponse<T> = JsonSuccess<T> | JsonError

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function descriptorOf(ctx: Context): SettingsDescriptor {
  const descriptor = ctx.settings.describe().find(row => row.ns === VISION_TOOLKIT_SETTINGS_NAMESPACE)
  if (descriptor === undefined) throw new Error('vision-cloud Settings namespace is not registered')
  return descriptor
}

function responseJson<T>(res: ServerResponse, status: number, body: JsonResponse<T>): void {
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

async function readJson(req: IncomingMessage, maxBytes = 64 * 1024): Promise<unknown> {
  const contentType = req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') throw new TypeError('Content-Type must be application/json')
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += part.length
    if (bytes > maxBytes) throw new RangeError(`request body exceeds ${maxBytes} bytes`)
    chunks.push(part)
  }
  if (chunks.length === 0) throw new TypeError('request body is empty')
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function parseRequest(value: unknown): SettingsRequest {
  if (!isRecord(value) || typeof value.action !== 'string') throw new TypeError('request action is required')
  if (value.action === 'testRead') return { action: 'testRead' }
  if (value.action === 'save') {
    if (!Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 0) {
      throw new TypeError('save.expectedRevision must be a non-negative integer')
    }
    if (!isRecord(value.value)) throw new TypeError('save.value must be an object')
    return {
      action: 'save',
      expectedRevision: value.expectedRevision as number,
      value: value.value as VisionToolkitConfig,
    }
  }
  throw new TypeError(`unsupported action: ${value.action}`)
}

function publicMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** Same-origin Settings handler. */
export class VisionToolkitWebBackend {
  constructor(
    private readonly ctx: Context,
    private readonly runtimeSource: () => VisionToolkitRuntime | undefined,
  ) {}

  private async providers(): Promise<VisionProviderEntry[]> {
    const out: VisionProviderEntry[] = []
    for (const info of this.ctx.llm.listProviders()) {
      let models: VisionModelEntry[] = []
      try {
        const listed = await this.ctx.llm.listModels(info.id)
        models = await Promise.all(listed.map(async (model) => {
          let reasoningEfforts: string[] = []
          try {
            const resolved = await this.ctx.llm.resolveModelInfo(info.id, model.id)
            reasoningEfforts = (resolved.reasoning?.efforts ?? []).map(effort => String(effort.id))
          } catch {
            reasoningEfforts = []
          }
          return {
            id: model.id,
            name: model.name,
            inputModalities: [...(model.inputModalities ?? [])],
            reasoningEfforts,
          }
        }))
      } catch {
        models = []
      }
      out.push({ provider: info.id, name: info.name, models })
    }
    return out
  }

  /** Build the current settings/model snapshot without secrets. */
  async snapshot(): Promise<VisionToolkitSettingsSnapshot> {
    const descriptor = descriptorOf(this.ctx)
    const value = descriptor.value as VisionToolkitConfig
    return {
      schemaVersion: 1,
      writable: this.ctx.settings.writable,
      pluginVersion: PLUGIN_VERSION,
      enabled: resolveConfig(value).model !== undefined,
      pasteToPath: resolveConfig(value).pasteToPath,
      settings: {
        value,
        revision: descriptor.revision,
        applies: 'live',
      },
      providers: await this.providers(),
    }
  }

  private async save(request: SaveRequest): Promise<VisionToolkitSettingsSnapshot> {
    if (!this.ctx.settings.writable) throw new Error('settings provider is read-only')
    await this.ctx.settings.replace(
      VISION_TOOLKIT_SETTINGS_NAMESPACE,
      request.value as object,
      request.expectedRevision,
    )
    return this.snapshot()
  }

  private async testRead(): Promise<VisionToolkitSettingsSnapshot> {
    const runtime = this.runtimeSource()
    if (runtime === undefined) throw new Error('no vision model selected; save a model first')
    const controller = new AbortController()
    await runtime.selfTest({
      signal: controller.signal,
      workspace: process.cwd(),
      sessionId: 'vision-cloud-settings',
    })
    return this.snapshot()
  }

  /** Handle the exact Settings route. */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === 'GET') {
      try {
        responseJson(res, 200, { ok: true, value: await this.snapshot() })
      } catch (error) {
        this.ctx.logger.warn('dsh-vision-cloud Settings snapshot failed: %s', publicMessage(error))
        requestError(res, 503, 'settings-unavailable', 'Vision Cloud Settings are unavailable')
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
    let parsed: SettingsRequest
    try {
      parsed = parseRequest(await readJson(req))
    } catch (error) {
      requestError(res, error instanceof RangeError ? 413 : 400, 'invalid-request', publicMessage(error))
      return
    }
    try {
      if (parsed.action === 'testRead') {
        responseJson(res, 200, { ok: true, value: await this.testRead() })
      } else {
        responseJson(res, 200, { ok: true, value: await this.save(parsed) })
      }
    } catch (error) {
      this.ctx.logger.warn('dsh-vision-cloud Web action=%s failed: %s', parsed.action, publicMessage(error))
      requestError(res, 400, 'settings-rejected', publicMessage(error))
    }
  }
}

/**
 * Attach optional Web routes whenever a webServer service is present.
 * @param ctx - plugin context owning route effects.
 * @param backend - Settings handler.
 * @param pastedImages - paste-image upload handler.
 */
export function installVisionToolkitWeb(
  ctx: Context,
  backend: VisionToolkitWebBackend,
  pastedImages: PastedImageBackend,
): void {
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => {
      const disposeSettings = webCtx.webServer.register({
        kind: 'exact',
        path: SETTINGS_ROUTE,
        handler: (req, res) => backend.handle(req, res),
      })
      const disposePasteImages = webCtx.webServer.register({
        kind: 'exact',
        path: PASTE_IMAGES_ROUTE,
        handler: (req, res) => pastedImages.handle(req, res),
      })
      return () => {
        disposePasteImages()
        disposeSettings()
      }
    }, 'dsh-vision-cloud: Web routes')
  })
}
