import { describe, expect, it } from 'vitest'
import {
  VISION_TOOL_SYSTEM_PROMPT,
  visionToolSectionText,
  VISION_TOOL_NAME,
  VISION_TOOL_SECTION_NAME,
  VISION_IMAGE_CONTEXT_NAME,
} from '../src/system-prompt.ts'

describe('vision tool system prompt (A9, strengthened)', () => {
  it('exports the names shared with the assembly gate', () => {
    expect(VISION_TOOL_NAME).toBe('vision_cloud_tool')
    expect(VISION_TOOL_SECTION_NAME).toBe('vision-cloud:tool')
    expect(VISION_IMAGE_CONTEXT_NAME).toBe('vision-cloud:images')
  })

  describe('model-agnostic fallback', () => {
    const lowered = VISION_TOOL_SYSTEM_PROMPT.toLowerCase()

    it('orders the model to read invisible image inputs in the same turn', () => {
      expect(lowered).toContain('must read it with vision_cloud_tool before answering')
      expect(lowered).toContain('same turn')
      expect(lowered).toContain('text-only model')
    })

    it('tells models that can see the image directly NOT to call the tool', () => {
      expect(lowered).toContain('do not call vision_cloud_tool')
      expect(lowered).toContain('analyze it yourself')
    })

    it('keeps the guardrails for non-image inputs and read_image misuse', () => {
      expect(lowered).toContain('never for non-image urls')
      expect(lowered).toContain('do not call read_image unless you are an image-capable model')
      expect(lowered).toContain('never fall back to read_image')
      expect(lowered).toContain('retry vision_cloud_tool')
    })

    it('spells out the exact argument routing', () => {
      expect(lowered).toContain('images argument')
      expect(lowered).toContain('attachments argument')
      expect(lowered).toContain('sha256:')
      expect(lowered).toContain('pass that path inside vision_cloud_tool.images')
    })
  })

  it('text-only capability is imperative and forbids stalling', () => {
    const lowered = visionToolSectionText('text').toLowerCase()
    expect(lowered).toContain('you are a text-only model')
    expect(lowered).toContain('must read them with vision_cloud_tool before answering')
    expect(lowered).toContain('do not wait for a later turn')
    expect(lowered).toContain('do not ask the user to repeat')
  })

  it('image capability routes only not-visible inputs through the tool', () => {
    const lowered = visionToolSectionText('image').toLowerCase()
    expect(lowered).toContain('you are an image-capable model')
    expect(lowered).toContain('do not call vision_cloud_tool for it')
    expect(lowered).toContain('not directly visible')
    expect(lowered).toContain('call vision_cloud_tool for exactly those inputs')
  })
})
