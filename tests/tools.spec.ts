import { describe, expect, it, vi } from 'vitest'
import { createVisionCloudTool } from '../src/tools.ts'

describe('vision_cloud_tool guidance', () => {
  it('documents native image routing, @file references, and session exclusions', () => {
    const tool = createVisionCloudTool({ read: vi.fn() } as never)
    expect(tool.description).toContain('inputModalities')
    expect(tool.description).toContain('@image.png')
    expect(tool.description).toContain('dsh-session:')
    expect(tool.description).toContain('text files')
    expect((tool.parameters.properties as Record<string, { description?: string }>).images?.description).toContain('@"image with spaces.png"')
  })
})
