// Online vision smoke test: run the compiled VisionToolkitRuntime.read() against
// a real app-configured model (defaults to tabitoken/claude-opus-5) and print
// the modlens v2 result. Reads TABITOKEN_API_KEY from ~/.dsh/.credentials.yaml.
//
// Usage: node scripts/vision-smoke.mjs [image-path] [prompt]

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { VisionToolkitRuntime } from '../lib/runtime.js'
import { readImageHeader } from '../lib/image-header.js'

const MODEL = { provider: 'tabitoken', model: 'claude-opus-5' }
const BASE_URL = 'https://tabitoken.com/v1'
const IMAGE = resolve(process.argv[2] ?? 'assets/hero.png')
const PROMPT = process.argv[3] ?? '描述这张图片，并逐字转写其中的所有文字'

async function readCredential(name) {
  const env = process.env[name]
  if (env) return env
  try {
    const text = await readFile(join(homedir(), '.dsh', '.credentials.yaml'), 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*([A-Za-z0-9_]+)\s*:\s*["']?([^"'\r\n]+)["']?\s*$/u.exec(line)
      if (match?.[1] === name) return match[2]?.trim()
    }
  } catch {
    // fall through
  }
  throw new Error(`credential ${name} not found in environment or ~/.dsh/.credentials.yaml`)
}

const apiKey = await readCredential('TABITOKEN_API_KEY')

const stored = new Map()
const ctx = {
  attachments: {
    async saveImage({ data, mediaType, name }) {
      const header = readImageHeader(data)
      const attachmentId = `att-${randomUUID()}`
      stored.set(attachmentId, { data, mediaType })
      return { attachmentId, mediaType, bytes: data.length, width: header.width, height: header.height, name }
    },
  },
  llm: {
    async * stream(options) {
      const content = []
      for (const message of options.messages) {
        for (const block of message.content) {
          if (block.type === 'text') content.push({ type: 'text', text: block.text })
          else if (block.type === 'image') {
            const entry = stored.get(block.attachment.attachmentId)
            if (!entry) throw new Error(`missing attachment ${block.attachment.attachmentId}`)
            content.push({
              type: 'image_url',
              image_url: { url: `data:${entry.mediaType};base64,${Buffer.from(entry.data).toString('base64')}` },
            })
          }
        }
      }
      const response = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model: options.model, messages: [{ role: 'user', content }] }),
        signal: options.signal,
      })
      if (!response.ok) {
        throw new Error(`vision HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`)
      }
      const body = await response.json()
      const text = body.choices?.[0]?.message?.content ?? ''
      if (typeof text !== 'string' || text.trim() === '') throw new Error('vision model returned no text')
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'usage', usage: { inputTokens: body.usage?.prompt_tokens ?? 0, outputTokens: body.usage?.completion_tokens ?? 0 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  },
  logger: {
    info: (...args) => console.log('[info]', ...args),
    warn: (...args) => console.warn('[warn]', ...args),
    error: (...args) => console.error('[error]', ...args),
  },
}

const config = {
  model: MODEL,
  language: 'zh',
  timeoutMs: 120000,
  maxImageBytes: 10485760,
  maxImagePixels: 40000000,
  concurrency: 4,
  maxImages: 8,
  allowedDirs: [],
}

const runtime = new VisionToolkitRuntime(ctx, config)
const result = await runtime.read({ images: [IMAGE], attachments: [] }, PROMPT, {
  signal: new AbortController().signal,
  workspace: process.cwd(),
})

console.log('=== images ===')
console.log(JSON.stringify(result.images, null, 2))
console.log('=== result (modlens v2) ===')
console.log(JSON.stringify(result.result, null, 2))
console.log('=== meta ===')
console.log(JSON.stringify(result.meta, null, 2))
