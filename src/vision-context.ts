/**
 * Pure per-assembly helpers: scan the live session for image inputs the
 * conversation model cannot see directly, and render the `vision_cloud_tool`
 * argument list the model must pass. No Cordis dependencies — the scanner is
 * exercised by unit tests with plain session-shaped fixtures.
 * @module dsh-vision-cloud/vision-context
 */

import type { Session } from '@deepseek-ai/dsh-session'
import { normalizeDshFileReference } from './file-references.ts'

/** One native image attachment found in the session history. */
export interface NativeImageInput {
  id: string
  name?: string | undefined
  bytes?: number | undefined
  width?: number | undefined
  height?: number | undefined
}

/** Every image input a text-only conversation model must route through the tool. */
export interface VisionImageInputs {
  /** Native image blocks (only visible to image-capable models). */
  attachments: NativeImageInput[]
  /** Absolute workspace paths from `[Pasted image available at absolute path: "..."]` lines. */
  paths: string[]
  /** Direct image URLs appearing in user text. */
  urls: string[]
}

export const EMPTY_VISION_IMAGE_INPUTS: VisionImageInputs = {
  attachments: [],
  paths: [],
  urls: [],
}

/** The paste-to-path bridge marker the client writes into user text. */
export const PASTE_PATH_MARKER_PATTERN = /\[Pasted image available at absolute path:\s*"((?:[^"\\]|\\.)*)"\]/gu

/** Direct image URL shapes accepted by vision_cloud_tool. */
export const IMAGE_URL_PATTERN = /\b(https?:\/\/[^\s"'<>()[\]{}]+?\.(?:png|jpe?g|gif|webp)(?:[?#][^\s"'<>()[\]{}]*)?)/giu

/** Explicit DSH image-file references, with quoted names allowed to contain spaces. */
export const DSH_IMAGE_FILE_REFERENCE_PATTERN = /(?:^|\s)(@(?:"[^"]+"|[^\s@(){}<>:!?]+))/gu

/** How the current conversation model can consume image inputs. */
export type ConversationVisionCapability = 'image' | 'text' | 'unknown'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readAttachmentId(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  const id = value.attachmentId
  return typeof id === 'string' && id !== '' ? id : undefined
}

function unescapeJsonString(value: string): string {
  return value.replace(/\\(["\\])/gu, '$1')
}

function collectTextInputs(text: string, inputs: VisionImageInputs): void {
  for (const match of text.matchAll(PASTE_PATH_MARKER_PATTERN)) {
    const path = unescapeJsonString(match[1] ?? '').trim()
    if (path !== '' && !inputs.paths.includes(path)) inputs.paths.push(path)
  }
  for (const match of text.matchAll(DSH_IMAGE_FILE_REFERENCE_PATTERN)) {
    const raw = (match[1] ?? '').replace(/[.,;:!?]+$/u, '')
    const reference = normalizeDshFileReference(raw)
    if (reference.kind !== 'file' || !/\.(?:png|jpe?g|gif|webp)$/iu.test(reference.value)) continue
    if (!inputs.paths.includes(reference.value)) inputs.paths.push(reference.value)
  }
  for (const match of text.matchAll(IMAGE_URL_PATTERN)) {
    const url = (match[0] ?? '').replace(/[.,;:!?]+$/u, '')
    if (url !== '' && !inputs.urls.includes(url)) inputs.urls.push(url)
  }
}

/**
 * Recursively walk a session-shaped value for image blocks and user text.
 * Cyclic payloads are tolerated through a seen-set; non-object leaves stop
 * the walk. This is intentionally shape-tolerant because session events vary
 * between `data.content` and `data.message.content` across host versions.
 */
function walkSessionValue(
  value: unknown,
  inputs: VisionImageInputs,
  seen: WeakSet<object>,
  depth: number,
): void {
  if (depth <= 0) return
  if (Array.isArray(value)) {
    for (const item of value) walkSessionValue(item, inputs, seen, depth - 1)
    return
  }
  if (!isRecord(value) || seen.has(value)) return
  seen.add(value)

  if (value.type === 'image') {
    const id = readAttachmentId(value.attachment)
    if (id !== undefined && !inputs.attachments.some(entry => entry.id === id)) {
      const ref = value.attachment as Record<string, unknown> | undefined
      const readString = (key: string): string | undefined => {
        const raw = ref?.[key]
        return typeof raw === 'string' && raw !== '' ? raw : undefined
      }
      const readNumber = (key: string): number | undefined => {
        const raw = ref?.[key]
        return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined
      }
      inputs.attachments.push({
        id,
        ...(readString('name') === undefined ? {} : { name: readString('name') }),
        ...(readNumber('bytes') === undefined ? {} : { bytes: readNumber('bytes') }),
        ...(readNumber('width') === undefined ? {} : { width: readNumber('width') }),
        ...(readNumber('height') === undefined ? {} : { height: readNumber('height') }),
      })
    }
    // Image blocks have no nested text or attachments; stop here.
    return
  }

  if (typeof value.text === 'string' && value.text !== '') {
    collectTextInputs(value.text, inputs)
  }
  if (typeof value.clipboardText === 'string' && value.clipboardText !== '') {
    collectTextInputs(value.clipboardText, inputs)
  }

  for (const key of ['content', 'message', 'data', 'result', 'tool_result', 'events'] as const) {
    const nested: unknown = value[key]
    if (nested !== value && nested !== undefined && nested !== null) {
      walkSessionValue(nested, inputs, seen, depth - 1)
    }
  }
}

function isUserCarrier(event: unknown): boolean {
  if (!isRecord(event)) return false
  const type = event.type
  if (typeof type === 'string' && type.includes('user')) return true
  const data = event.data
  if (!isRecord(data)) return false
  if (data.kind !== undefined && data.kind !== 'user') return false
  return true
}

/** One message's content, tolerating `data.content` and `data.message.content`. */
function messageContentOf(event: unknown): unknown {
  if (!isRecord(event)) return undefined
  const data = event.data
  if (!isRecord(data)) return undefined
  const message = data.message
  if (isRecord(message) && 'content' in message) return message.content
  if ('content' in data) return data.content
  return undefined
}

/**
 * Collect the image inputs present in the session's user messages. Native
 * image blocks, paste-to-path bridge markers, and direct image URLs are all
 * collected; assistant/tool echoes are skipped so the model is not pushed to
 * re-read tool output.
 */
export function collectImageInputs(session: Session | undefined, depth = 24): VisionImageInputs {
  if (session === undefined || !Array.isArray(session.events)) return structuredClone(EMPTY_VISION_IMAGE_INPUTS)
  const inputs: VisionImageInputs = { attachments: [], paths: [], urls: [] }
  const seen = new WeakSet<object>()
  for (const event of session.events) {
    if (!isUserCarrier(event)) continue
    walkSessionValue(messageContentOf(event), inputs, seen, depth)
  }
  return inputs
}

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

function attachmentLabel(entry: NativeImageInput): string {
  const name = entry.name === undefined || entry.name === '' ? undefined : entry.name
  const dims = entry.width !== undefined && entry.height !== undefined ? `, ${entry.width}x${entry.height}` : ''
  const size = entry.bytes !== undefined ? `, ${humanBytes(entry.bytes)}` : ''
  return `"${entry.id}"${name === undefined ? '' : ` (${name}${dims}${size})`}`
}

/**
 * Render the runtime-context block listing the exact arguments the model must
 * pass. For an image-capable model native attachments are excluded (they are
 * directly visible), leaving only path/URL inputs.
 */
export function renderVisionImageContext(inputs: VisionImageInputs, capability: ConversationVisionCapability): string {
  const attachments = capability === 'image' ? [] : inputs.attachments
  const lines: string[] = []
  for (const path of inputs.paths) lines.push(`- ${JSON.stringify(path)}`)
  if (inputs.urls.length > 0) lines.push(...inputs.urls.map(url => `- ${url}`))
  if (lines.length === 0 && attachments.length === 0) return ''

  const head = capability === 'image'
    ? 'Some image inputs in this conversation are not directly visible to you. Read those with vision_cloud_tool before answering, using exactly the arguments below; analyze visible image content yourself and never re-read it through the tool.'
    : 'The image inputs below are present in this conversation and you cannot see them yourself. You MUST read them with vision_cloud_tool before answering the message that carries them, in this same turn — do not wait for a later turn or ask the user to repeat them.'

  const args: string[] = []
  if (lines.length > 0) args.push(`vision_cloud_tool.images:
${lines.join("\n")}`)
  if (attachments.length > 0) {
    args.push(`vision_cloud_tool.attachments:
${attachments.map(entry => `- ${attachmentLabel(entry)}`).join("\n")}`)
  }
  return `[Vision image inputs — readable only through vision_cloud_tool]
${head}
${args.join("\n")}`
}
