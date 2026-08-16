import { describe, expect, it } from 'vitest'
import { VISION_TOOL_SYSTEM_PROMPT } from '../src/system-prompt.ts'

describe('vision tool system prompt (A9)', () => {
  const lowered = VISION_TOOL_SYSTEM_PROMPT.toLowerCase()

  it('tells models that can see the image directly NOT to call the tool', () => {
    expect(lowered).toContain('do not call vision_cloud_tool')
    expect(lowered).toContain('see directly')
    expect(lowered).toMatch(/can see directly/im)
  })

  it('routes only not-directly-visible media through the tool, keeping the URL/path/attachment cases', () => {
    expect(lowered).toContain('not directly visible')
    expect(lowered).toContain('use the vision_cloud_tool')
    expect(lowered).toMatch(/\burl\b/)
    expect(lowered).toContain('workspace image path')
    expect(lowered).toContain('attachment id')
    // The exception explicitly preserves tool routing for text-only models.
    expect(lowered).toContain('text-only model')
  })

  it('keeps the guardrails for non-image inputs and read_image misuse', () => {
    expect(lowered).toContain('never call vision_cloud_tool for non-image urls')
    expect(lowered).toContain('do not call read_image unless you are an image-capable model')
  })
})