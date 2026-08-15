/**
 * @anionex/dsh-vision-toolkit — online-only vision plugin.
 *
 * Registers a single `vision_cloud_tool` only when a vision model is selected
 * in Settings (default off). The tool reads images through the DSH app's
 * configured model via `ctx.llm` and returns modlens v2 structured evidence.
 * No Python, no local tools, no credential or endpoint configuration.
 * @module @anionex/dsh-vision-toolkit
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only import activates the optional systemPrompt Context declaration.
import type {} from '@deepseek-ai/dsh-system-prompt'
import {
  Config,
  VISION_TOOLKIT_SETTINGS_NAMESPACE,
  resolveConfig,
  type VisionToolkitConfig,
} from './config.ts'
import { VisionToolkitRuntime } from './runtime.ts'
import { createVisionCloudTool } from './tools.ts'
import { PLUGIN_VERSION } from './version.ts'
import { installVisionToolkitWeb, VisionToolkitWebBackend } from './web.ts'
import { PastedImageBackend } from './paste-images.ts'

export const name = '@anionex/dsh-vision-toolkit'

export { Config }

export const inject = ['tools', 'settings', 'llm', 'attachments', 'sessions', 'systemPrompt']

/** Plugin entry: validate configuration, then mount the tool when enabled. */
export function apply(ctx: Context, config: VisionToolkitConfig = {}): () => void {
  const settings = ctx.settings.register(VISION_TOOLKIT_SETTINGS_NAMESPACE, Config, {
    base: config,
    applies: 'live',
    validate: (value) => { resolveConfig(value) },
  })

  const lifecycle = new AbortController()
  let toolDisposer: (() => void) | undefined
  let promptDisposer: (() => void) | undefined
  let currentRuntime: VisionToolkitRuntime | undefined

  const ensureTool = (raw: VisionToolkitConfig): void => {
    toolDisposer?.()
    toolDisposer = undefined
    promptDisposer?.()
    promptDisposer = undefined
    currentRuntime = undefined
    const resolved = resolveConfig(raw)
    if (resolved.model === undefined) {
      ctx.logger.info('dsh-vision-toolkit %s: no vision model selected; vision_cloud_tool is not registered', PLUGIN_VERSION)
      return
    }
    currentRuntime = new VisionToolkitRuntime(ctx, resolved)
    toolDisposer = ctx.tools.register(createVisionCloudTool(currentRuntime, lifecycle.signal))
    promptDisposer = ctx.systemPrompt.section({
      name: 'vision-toolkit:tool',
      order: 40,
      text: 'To read or analyze an image (a workspace image path, an http(s) URL, or a pasted image attachment id), use the vision_cloud_tool: it reads images through the app\'s configured vision model and returns structured evidence, so it works even when you cannot accept image input yourself. Do not call read_image unless you are an image-capable model — read_image only hands the image back to a model that can see it.',
    })
    ctx.logger.info(
      'dsh-vision-toolkit %s: vision_cloud_tool registered (model %s/%s)',
      PLUGIN_VERSION,
      resolved.model.provider,
      resolved.model.model,
    )
  }

  try {
    ensureTool(settings.get() as VisionToolkitConfig)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ctx.logger.error('dsh-vision-toolkit %s: configuration rejected; vision_cloud_tool is not registered. %s', PLUGIN_VERSION, message)
  }

  const backend = new VisionToolkitWebBackend(ctx, () => currentRuntime)
  const pastedImages = new PastedImageBackend(ctx, {
    maxImageBytes: () => {
      try {
        return resolveConfig(settings.get() as VisionToolkitConfig).maxImageBytes
      } catch {
        return 10485760
      }
    },
    pasteToPath: () => {
      try {
        return resolveConfig(settings.get() as VisionToolkitConfig).pasteToPath
      } catch {
        return true
      }
    },
  })
  installVisionToolkitWeb(ctx, backend, pastedImages)

  const watch = settings.watch((next) => {
    try {
      ensureTool(next as VisionToolkitConfig)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      ctx.logger.error('dsh-vision-toolkit: keeping the previous configuration after a refused Settings change. %s', message)
    }
  })

  return () => {
    lifecycle.abort()
    toolDisposer?.()
    promptDisposer?.()
    watch()
  }
}
