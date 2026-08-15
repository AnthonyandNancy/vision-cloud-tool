/**
 * Plugin configuration: an optional app-model selection, output language, and
 * limits. There are no secrets and no provider endpoints here — the DSH app
 * owns the configured model's URL and key.
 * @module dsh-vision-toolkit/config
 */

import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { VisionToolkitError } from './errors.ts'

/** Settings document namespace owned by this plugin. */
export const VISION_TOOLKIT_SETTINGS_NAMESPACE = settingsNamespace('vision-toolkit')

/** Full user-facing configuration; every limit defaults at the schema boundary. */
export interface VisionToolkitConfig {
  /** Selected app model; absent (or empty) means the tool is not registered. */
  model?: {
    provider?: string
    model?: string
  }
  /** Vision output language (`zh` or `en`). */
  language?: 'zh' | 'en'
  /** Whole-operation deadline in milliseconds. */
  timeoutMs?: number
  /** Encoded-byte limit per input image. */
  maxImageBytes?: number
  /** Decoded-pixel limit per input image. */
  maxImagePixels?: number
  /** In-flight tool execution cap per session. */
  concurrency?: number
  /** Maximum images accepted per call. */
  maxImages?: number
  /** Extra directories (besides the workspace) inputs may come from. */
  allowedDirs?: string[]
}

/** Configuration schema with documented defaults. */
export const Config: Schema<VisionToolkitConfig> = z.object({
  model: z.object({
    provider: z.string(),
    model: z.string(),
  }),
  language: z.union(['zh', 'en'] as const).default('zh'),
  timeoutMs: z.number().default(60000),
  maxImageBytes: z.number().default(10485760),
  maxImagePixels: z.number().default(40000000),
  concurrency: z.number().default(4),
  maxImages: z.number().default(8),
  allowedDirs: z.array(z.string()).default([]),
})

/** Configuration after static validation, with every default materialized. */
export interface ResolvedVisionToolkitConfig {
  model: { provider: string; model: string } | undefined
  language: 'zh' | 'en'
  timeoutMs: number
  maxImageBytes: number
  maxImagePixels: number
  concurrency: number
  maxImages: number
  allowedDirs: string[]
}

const MAX_TIMEOUT_MS = 600000
const MAX_IMAGE_BYTES = 268435456
const MAX_IMAGE_PIXELS = 268435456
const MAX_CONCURRENCY = 16
const MAX_IMAGES = 8

/**
 * Validate and normalize a config object (partial inputs receive the same
 * defaults the schemastery schema applies). A half-set `model` fails loud; an
 * absent or fully-empty `model` means the tool stays unregistered.
 */
export function resolveConfig(config: VisionToolkitConfig = {}): ResolvedVisionToolkitConfig {
  const language = config.language ?? 'zh'
  if (language !== 'zh' && language !== 'en') {
    throw new VisionToolkitError('config', 'language must be "zh" or "en"')
  }
  const timeoutMs = config.timeoutMs ?? 60000
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new VisionToolkitError('config', `timeoutMs must be an integer between 1000 and ${MAX_TIMEOUT_MS}`)
  }
  const maxImageBytes = config.maxImageBytes ?? 10485760
  if (!Number.isInteger(maxImageBytes) || maxImageBytes < 1024 || maxImageBytes > MAX_IMAGE_BYTES) {
    throw new VisionToolkitError('config', `maxImageBytes must be an integer between 1024 and ${MAX_IMAGE_BYTES}`)
  }
  const maxImagePixels = config.maxImagePixels ?? 40000000
  if (!Number.isInteger(maxImagePixels) || maxImagePixels < 1 || maxImagePixels > MAX_IMAGE_PIXELS) {
    throw new VisionToolkitError('config', `maxImagePixels must be an integer between 1 and ${MAX_IMAGE_PIXELS}`)
  }
  const concurrency = config.concurrency ?? 4
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
    throw new VisionToolkitError('config', `concurrency must be an integer between 1 and ${MAX_CONCURRENCY}`)
  }
  const maxImages = config.maxImages ?? 8
  if (!Number.isInteger(maxImages) || maxImages < 1 || maxImages > MAX_IMAGES) {
    throw new VisionToolkitError('config', `maxImages must be an integer between 1 and ${MAX_IMAGES}`)
  }
  const allowedDirs = (config.allowedDirs ?? []).map(dir => dir.trim()).filter(dir => dir.length > 0)

  let model: ResolvedVisionToolkitConfig['model']
  if (config.model !== undefined) {
    const provider = config.model.provider?.trim()
    const name = config.model.model?.trim()
    if (provider === undefined || provider.length === 0) {
      if (name !== undefined && name.length > 0) {
        throw new VisionToolkitError('config', 'model requires both "provider" and "model"')
      }
    } else if (name === undefined || name.length === 0) {
      throw new VisionToolkitError('config', 'model requires both "provider" and "model"')
    } else {
      model = { provider, model: name }
    }
  }

  return {
    model,
    language,
    timeoutMs,
    maxImageBytes,
    maxImagePixels,
    concurrency,
    maxImages,
    allowedDirs,
  }
}
