import { describe, expect, it } from 'vitest'
import { findImageRef, type VisionSession } from '../src/runtime.ts'

function ref(attachmentId: string, name?: string) {
  return {
    attachmentId,
    mediaType: 'image/png',
    bytes: 100,
    width: 10,
    height: 10,
    ...(name === undefined ? {} : { name }),
  }
}

describe('findImageRef (recursive session scan)', () => {
  it('finds a top-level data.content image block (legacy shape)', () => {
    const session: VisionSession = {
      events: [{
        data: { content: [{ type: 'image', attachment: ref('sha256:top') }] },
      }],
    }
    expect(findImageRef(session, 'sha256:top')?.attachmentId).toBe('sha256:top')
  })

  it('finds a block nested under data.message.content', () => {
    const session: VisionSession = {
      events: [{
        data: {
          message: {
            content: [{ type: 'image', attachment: ref('sha256:nested') }],
          },
        },
      }],
    }
    expect(findImageRef(session, 'sha256:nested')?.attachmentId).toBe('sha256:nested')
  })

  it('finds a block nested inside a tool-result wrapper', () => {
    const session: VisionSession = {
      events: [{
        data: {
          content: [{
            type: 'tool-result',
            result: {
              content: [{ type: 'image', attachment: ref('sha256:tool-result', 'x.png') }],
            },
          }],
        },
      }],
    }
    const found = findImageRef(session, 'sha256:tool-result')
    expect(found?.attachmentId).toBe('sha256:tool-result')
    expect(found?.name).toBe('x.png')
  })

  it('returns undefined for a missing id, an empty session, or non-image blocks', () => {
    expect(findImageRef(undefined, 'sha256:no')).toBeUndefined()
    expect(findImageRef({ events: [] }, 'sha256:no')).toBeUndefined()
    const session: VisionSession = {
      events: [{
        data: {
          content: [
            { type: 'text', text: 'no image here' },
            { type: 'image', attachment: { attachmentId: 42 } },
          ],
        },
      }],
    }
    expect(findImageRef(session, '42')).toBeUndefined()
  })
})
