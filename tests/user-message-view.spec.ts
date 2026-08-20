// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  extractBridgeMarkup,
  singleFit,
  splitContent,
  UserMessageNodeShadow,
  type NativeAttachmentView,
} from '../src/client/user-message-view.tsx'

function text(text: string): { type: 'text'; text: string } {
  return { type: 'text', text }
}

function imageBlock(attachment: NativeAttachmentView): { type: 'image'; attachment: NativeAttachmentView } {
  return { type: 'image', attachment }
}

const BRIDGE_PATH = '[Pasted image available at absolute path: "D:\\tmp\\pasted\\pic.png"]'
const BRIDGE_URL = '/_dsh/vision-cloud/paste-images/file?sessionId=sess-1&name=pic.png'

describe('bridge markup extraction', () => {
  it('strips the absolute-path line and the bridge image link from display text', () => {
    const result = extractBridgeMarkup(`${BRIDGE_PATH}\n\n![pic](<${BRIDGE_URL}>)\n\n这张图是什么？`)
    expect(result.text).toBe('这张图是什么？')
    expect(result.images).toEqual([{ url: BRIDGE_URL, alt: 'pic' }])
  })

  it('handles adjacent multi-image serialization without line-anchored assumptions', () => {
    const result = extractBridgeMarkup(
      `${BRIDGE_PATH}\n\n![a](<${BRIDGE_URL.slice(0, -7)}a.png>) ${BRIDGE_PATH}\n\n![b](<${BRIDGE_URL.slice(0, -7)}b.png>) 描述文字`,
    )
    expect(result.images.map(image => image.alt)).toEqual(['a', 'b'])
    expect(result.text).toBe('描述文字')
  })

  it('leaves non-bridge markdown untouched', () => {
    const foreign = '看这个 [文件](C:\\tmp\\doc.md) 和 ![](https://x/y.png)'
    const result = extractBridgeMarkup(foreign)
    expect(result.text).toBe(foreign)
    expect(result.images).toEqual([])
  })

  it('collapses the whitespace left behind by stripped lines', () => {
    const result = extractBridgeMarkup(`${BRIDGE_PATH}\n\n![pic](<${BRIDGE_URL}>)\n\n\n\nHello`)
    expect(result.text).toBe('Hello')
  })

  it('returns the input unchanged when no bridge markers exist', () => {
    const result = extractBridgeMarkup('普通文字')
    expect(result.text).toBe('普通文字')
    expect(result.images).toEqual([])
  })
})

describe('content splitting', () => {
  it('joins text blocks, collects image blocks, and shelters the rest', () => {
    const attachment = { attachmentId: 'sha256:x', mediaType: 'image/png', name: 'a.png' }
    const restBlock = { type: 'tool', whatever: true }
    const result = splitContent([text('先 '), imageBlock(attachment), text(' 后'), restBlock])
    expect(result.text).toBe('先  后')
    expect(result.images).toEqual([attachment])
    expect(result.rest).toEqual([restBlock])
  })

  it('ignores null and malformed blocks instead of rendering them as JsonBlock extras', () => {
    const result = splitContent([null, 42, { type: 'image', attachment: null }])
    expect(result.text).toBe('')
    expect(result.images).toEqual([])
    expect(result.rest).toEqual([])
  })
})

describe('single image fit', () => {
  it('uses a 240px long edge with the ratio clamped to [0.25, 4]', () => {
    expect(singleFit(400, 300)).toMatchObject({ width: 240, height: 180, objectPosition: 'center' })
    expect(singleFit(300, 400)).toMatchObject({ width: 180, height: 240 })
    expect(singleFit(2000, 100)).toMatchObject({ width: 240, height: 60, objectPosition: 'left center' })
    expect(singleFit(100, 2000)).toMatchObject({ width: 60, height: 240, objectPosition: 'center top' })
  })

  it('never upscales past the natural size', () => {
    expect(singleFit(100, 80)).toMatchObject({ width: 100, height: 80 })
  })
})

describe('UserMessageNodeShadow', () => {
  afterEach(() => { document.body.replaceChildren() })

  const testT = (key: string, params?: Record<string, unknown>): string => {
    if (key === 'image.openOriginalLabel') return `${String((params ?? {})['label'])}，点击查看原图`
    if (key === 'copy') return '复制'
    if (key === 'copied') return '已复制'
    if (key === 'image.loading') return '图片加载中…'
    if (key === 'image.loadFailed') return '图片加载失败，点击重试'
    return key
  }

  const renderNode = (
    content: unknown[],
    time: number | null = 1,
    load: (attachment: unknown) => Promise<string> = async () => 'blob:native',
  ) => {
    const data: Record<string, unknown> = { content }
    if (time !== null) data['time'] = time
    const props = { node: { data }, loadImage: load, t: testT }
    return render(createElement(UserMessageNodeShadow, props as never))
  }

  it('renders bridged path text as a real image tile and hides the model-facing markup', () => {
    const { container } = renderNode([text(`${BRIDGE_PATH}\n\n![pic](<${BRIDGE_URL}>)\n\n这张图是什么？`)])
    const img = container.querySelector('img')
    expect(img?.getAttribute('src')).toBe(BRIDGE_URL)
    expect(container.textContent).not.toContain('Pasted image available at absolute path')
    expect(container.textContent).not.toContain('/_dsh/vision-cloud/paste-images/file')
    expect(container.textContent).toContain('这张图是什么？')
  })

  it('renders native image blocks through the session-authorized loader', async () => {
    const load = vi.fn(async () => 'blob:native')
    const { container } = renderNode([
      imageBlock({ attachmentId: 'sha256:n', mediaType: 'image/png', name: 'photo.png', width: 400, height: 300 }),
      text('看图'),
    ], 1, load)
    await vi.waitFor(() => {
      expect(load).toHaveBeenCalledTimes(1)
      expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:native')
    })
    expect(container.textContent).toContain('看图')
  })

  it('shows a retry control when the native loader fails', async () => {
    const load = vi.fn(async () => { throw new Error('boom') })
    const { container } = renderNode([imageBlock({ attachmentId: 'sha256:f', mediaType: 'image/png' })], 1, load)
    await vi.waitFor(() => { expect(container.querySelector('button.dvt-img-error')).not.toBeNull() })
    expect(container.textContent).toContain('图片加载失败，点击重试')
  })

  it('renders non-text blocks as JsonBlock extras', () => {
    const { container } = renderNode([text('先看'), { type: 'weird', value: 1 }])
    expect(container.querySelector('[data-primitives="json-block"]')).not.toBeNull()
    expect(container.textContent).toContain('先看')
  })

  it('decorates skill and agent references as chips', () => {
    const { container } = renderNode([text('用 /analyze 和 @worker 看看')])
    const chips = Array.from(container.querySelectorAll('span.dvt-ref-chip'))
    expect(chips.map(chip => chip.textContent)).toEqual([' /analyze', ' @worker'])
  })

  it('switches to tiling when several images live in one message', async () => {
    const { container } = renderNode([
      imageBlock({ attachmentId: 'sha256:a', mediaType: 'image/png' }),
      imageBlock({ attachmentId: 'sha256:b', mediaType: 'image/png' }),
    ])
    await vi.waitFor(() => { expect(container.querySelectorAll('.dvt-img-frame[data-variant="tile"]')).toHaveLength(2) })
  })

  it('copies the visible text and flips to the copied state on demand', async () => {
    const { container } = renderNode([text('纯文本')])
    const copy = container.querySelector('button.dvt-msg-action')
    expect(copy).not.toBeNull()
    fireEvent.click(copy as Element)
    await vi.waitFor(() => { expect(container.querySelector('[data-icon="check"]')).not.toBeNull() })
  })

  it('omits the time marker when the message has no timestamp', () => {
    const { container } = renderNode([text('无时间戳')], null)
    expect(container.querySelector('.dvt-msg-time')).toBeNull()
    expect(container.querySelector('button.dvt-msg-action')).not.toBeNull()
  })

  it('opens a lightbox portal when a loaded image is clicked', async () => {
    const { container } = renderNode([imageBlock({ attachmentId: 'sha256:l', mediaType: 'image/png', name: 'p.png' })])
    await vi.waitFor(() => { expect(container.querySelector('img')).not.toBeNull() })
    fireEvent.click(container.querySelector('img') as Element)
    expect(screen.getByRole('dialog')).not.toBeNull()
  })
})