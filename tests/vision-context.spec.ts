import { describe, expect, it } from 'vitest'
import type { Session } from '@deepseek-ai/dsh-session'
import {
  collectImageInputs,
  renderVisionImageContext,
  type NativeImageInput,
  type VisionImageInputs,
} from '../src/vision-context.ts'

function imageBlock(id: string, name?: string): Record<string, unknown> {
  return {
    type: 'image',
    attachment: {
      attachmentId: id,
      mediaType: 'image/png',
      bytes: 2048,
      width: 100,
      height: 50,
      ...(name === undefined ? {} : { name }),
    },
  }
}

function userEvent(content: unknown): unknown {
  return { type: 'user/message', seq: 0, time: 0, data: { kind: 'user', source: { kind: 'user' }, content } }
}

function sessionOf(events: readonly unknown[]): Session {
  return { events } as unknown as Session
}

describe('collectImageInputs (vision context scanner)', () => {
  it('collects paste markers, image URLs, and native attachment ids from top-level content', () => {
    const session = sessionOf([
      userEvent([
        { type: 'text', text: 'look: [Pasted image available at absolute path: "D:\\work\\a.png"] and https://img.example/x.png?y=1' },
        imageBlock('sha256:abc', 'a.png'),
      ]),
    ])
    const inputs = collectImageInputs(session)
    expect(inputs.paths).toEqual(['D:\\work\\a.png'])
    expect(inputs.urls).toEqual(['https://img.example/x.png?y=1'])
    expect(inputs.attachments.map(entry => entry.id)).toEqual(['sha256:abc'])
    expect(inputs.attachments[0]).toMatchObject({ name: 'a.png', bytes: 2048, width: 100, height: 50 })
  })

  it('finds images nested under data.message.content and tool-result wrappers', () => {
    const session = sessionOf([
      {
        type: 'user/message',
        seq: 0,
        time: 0,
        data: {
          kind: 'user',
          message: {
            content: [
              {
                type: 'tool-result',
                result: { content: [imageBlock('sha256:nested', 'nested.png')] },
              },
              { type: 'text', text: '[Pasted image available at absolute path: "C:\\pics\\nested.png"]' },
            ],
          },
        },
      },
    ])
    const inputs = collectImageInputs(session)
    expect(inputs.attachments.map(entry => entry.id)).toEqual(['sha256:nested'])
    expect(inputs.paths).toEqual(['C:\\pics\\nested.png'])
  })

  it('skips assistant-role content and deduplicates repeats', () => {
    const assistantEvent = {
      type: 'assistant/message',
      seq: 0,
      time: 0,
      data: {
        kind: 'assistant',
        content: [{ type: 'text', text: 'the image is at [Pasted image available at absolute path: "C:\\x\\ghost.png"]' }],
      },
    }
    const session = sessionOf([
      userEvent([{ type: 'text', text: '[Pasted image available at absolute path: "C:\\x\\a.png"] and https://img.example/a.png' }]),
      assistantEvent,
      userEvent([{ type: 'text', text: 'again [Pasted image available at absolute path: "C:\\x\\a.png"] and https://img.example/a.png' }]),
    ])
    const inputs = collectImageInputs(session)
    expect(inputs.paths).toEqual(['C:\\x\\a.png'])
    expect(inputs.urls).toEqual(['https://img.example/a.png'])
  })

  it('returns empty inputs for an undefined or eventless session', () => {
    expect(collectImageInputs(undefined)).toEqual({ attachments: [], paths: [], urls: [] })
    expect(collectImageInputs(sessionOf([]))).toEqual({ attachments: [], paths: [], urls: [] })
  })
})

describe('renderVisionImageContext', () => {
  const inputs: VisionImageInputs = {
    attachments: [{ id: 'sha256:abc', name: 'a.png', bytes: 2048, width: 100, height: 50 }],
    paths: ['D:\\work\\a.png'],
    urls: ['https://img.example/x.png'],
  }

  it('renders empty for no inputs', () => {
    expect(renderVisionImageContext({ attachments: [], paths: [], urls: [] }, 'text')).toBe('')
    expect(renderVisionImageContext({ attachments: [], paths: [], urls: [] }, 'image')).toBe('')
  })

  it('lists images and attachments arguments for text-only models', () => {
    const text = renderVisionImageContext(inputs, 'text')
    expect(text).toContain('vision_cloud_tool.images:')
    expect(text).toContain('"D:\\\\work\\\\a.png"')
    expect(text).toContain('https://img.example/x.png')
    expect(text).toContain('vision_cloud_tool.attachments:')
    expect(text).toContain('"sha256:abc"')
    expect(text.toLowerCase()).toContain('must read them with vision_cloud_tool')
  })

  it('excludes native attachments for image-capable models but keeps path/url inputs', () => {
    const text = renderVisionImageContext(inputs, 'image')
    expect(text).not.toContain('sha256:abc')
    expect(text).not.toContain('vision_cloud_tool.attachments:')
    expect(text).toContain('vision_cloud_tool.images:')
    expect(text).toContain('"D:\\\\work\\\\a.png"')
  })

  it('renders attachment labels with dimensions when present', () => {
    const native: NativeImageInput = { id: 'sha256:dim', name: 'big.png', bytes: 2048, width: 1920, height: 1080 }
    const text = renderVisionImageContext({ attachments: [native], paths: [], urls: [] }, 'text')
    expect(text).toContain('"sha256:dim" (big.png, 1920x1080, 2.0 KB)')
  })
})
