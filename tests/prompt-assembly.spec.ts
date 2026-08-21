import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type { AssembleContext, PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import { applyVisionPromptEnrichment, isVisionToolVisible } from '../src/prompt-assembly.ts'
import { VISION_IMAGE_CONTEXT_NAME, VISION_TOOL_NAME, VISION_TOOL_SECTION_NAME } from '../src/system-prompt.ts'

interface ToolSchemaLike {
  name: string
}

function assembly(overrides: Partial<PromptAssembly> = {}): PromptAssembly {
  return {
    sections: [],
    contexts: [],
    tools: [],
    variables: {},
    ...overrides,
  }
}

const VISION_SCHEMA: ToolSchemaLike = { name: VISION_TOOL_NAME }

function fakeContext(llm: Context['llm'], scope?: unknown): Context {
  return {
    tools: {
      get: (name: string, requestedScope?: object) => {
        if (requestedScope === DENIED_SCOPE) return undefined
        return name === VISION_TOOL_NAME ? ({ name } as never) : undefined
      },
    },
    llm,
  } as unknown as Context
}

const DENIED_SCOPE = { denied: true }

describe('applyVisionPromptEnrichment: agent-preset tool gate', () => {
  it('leaves the assembly untouched when the final tool list lacks vision_cloud_tool, and prunes any pre-registered section', async () => {
    const resolveModelInfo = vi.fn()
    const ctx = fakeContext({ resolveModelInfo } as unknown as Context['llm'])
    const assembled = assembly({
      tools: [{ name: 'run_code' } as never, { name: 'other_tool' } as never],
      sections: [
        { name: VISION_TOOL_SECTION_NAME, text: 'stale guidance' },
        { name: 'other:section', text: 'keep' },
      ],
    })
    const result = await applyVisionPromptEnrichment(ctx, assembled, { scope: DENIED_SCOPE })
    expect(result).toBe(assembled)
    expect(result.sections.map(section => section.name)).toEqual(['other:section'])
    expect(result.contexts).toEqual([])
    // The model-capability lookup must not run for a scope without the tool.
    expect(resolveModelInfo).not.toHaveBeenCalled()
  })

  it('replaces the section text with text-only guidance and adds the argument context for a text model', async () => {
    const resolveModelInfo = vi.fn().mockResolvedValue({ inputModalities: ['text'] })
    const ctx = fakeContext({ resolveModelInfo } as unknown as Context['llm'])
    const events = [{
      type: 'user/message',
      data: {
        kind: 'user',
        content: [
          { type: 'text', text: '[Pasted image available at absolute path: "C:\\work\\a.png"]' },
          { type: 'image', attachment: { attachmentId: 'sha256:abc', mediaType: 'image/png', bytes: 100, width: 10, height: 10 } },
        ],
      },
    }]
    const agent = { session: { events } } as unknown as Agent
    const assembled = assembly({
      tools: [VISION_SCHEMA as never],
      sections: [{ name: VISION_TOOL_SECTION_NAME, text: 'fallback' }],
      variables: { provider: 'pi-ai', model: 'text-model' },
    })
    const result = await applyVisionPromptEnrichment(ctx, assembled, { scope: {}, agent })
    expect(resolveModelInfo).toHaveBeenCalledWith('pi-ai', 'text-model', undefined)
    const section = result.sections.find(entry => entry.name === VISION_TOOL_SECTION_NAME)
    expect(section?.text.toLowerCase()).toContain('you are a text-only model')
    const context = result.contexts.find(entry => entry.name === VISION_IMAGE_CONTEXT_NAME)
    expect(context?.text).toContain('"sha256:abc"')
    expect(context?.text).toContain('"C:\\\\work\\\\a.png"')
  })

  it('keeps native attachments out of the context when the model can see images itself', async () => {
    const resolveModelInfo = vi.fn().mockResolvedValue({ inputModalities: ['text', 'image'] })
    const ctx = fakeContext({ resolveModelInfo } as unknown as Context['llm'])
    const agent = {
      session: {
        events: [{
          type: 'user/message',
          data: {
            kind: 'user',
            content: [
              { type: 'image', attachment: { attachmentId: 'sha256:visible', mediaType: 'image/png', bytes: 100, width: 10, height: 10 } },
              { type: 'text', text: '[Pasted image available at absolute path: "C:\\work\\b.png"]' },
            ],
          },
        }],
      },
    } as unknown as Agent
    const assembled = assembly({
      tools: [VISION_SCHEMA as never],
      variables: { provider: 'vision', model: 'image-model' },
    })
    const result = await applyVisionPromptEnrichment(ctx, assembled, { scope: {}, agent })
    const context = result.contexts.find(entry => entry.name === VISION_IMAGE_CONTEXT_NAME)
    expect(context?.text).toContain('"C:\\\\work\\\\b.png"')
    expect(context?.text).not.toContain('sha256:visible')
    const section = result.sections.find(entry => entry.name === VISION_TOOL_SECTION_NAME)
    expect(section?.text.toLowerCase()).toContain('you are an image-capable model')
  })

  it('falls back to model-agnostic guidance without model variables and never calls resolveModelInfo', async () => {
    const resolveModelInfo = vi.fn()
    const ctx = fakeContext({ resolveModelInfo } as unknown as Context['llm'])
    const assembled = assembly({ tools: [VISION_SCHEMA as never] })
    const result = await applyVisionPromptEnrichment(ctx, assembled, {})
    expect(resolveModelInfo).not.toHaveBeenCalled()
    const section = result.sections.find(entry => entry.name === VISION_TOOL_SECTION_NAME)
    expect(section?.text).toContain('MUST read it with vision_cloud_tool')
    expect(result.contexts).toEqual([])
  })

  it('adds the section when another listener never registered it, and tolerates a throwing model lookup', async () => {
    const resolveModelInfo = vi.fn().mockRejectedValue(new Error('model unavailable'))
    const ctx = fakeContext({ resolveModelInfo } as unknown as Context['llm'])
    const assembled = assembly({ tools: [VISION_SCHEMA as never], variables: { provider: 'p', model: 'm' } })
    const result = await applyVisionPromptEnrichment(ctx, assembled, {})
    expect(result.sections.find(entry => entry.name === VISION_TOOL_SECTION_NAME)?.text.length).toBeGreaterThan(0)
  })

  it('removes the vision tool, section, and context when an image model has only native image blocks', async () => {
    const resolveModelInfo = vi.fn().mockResolvedValue({ inputModalities: ['text', 'image'] })
    const ctx = fakeContext({ resolveModelInfo } as unknown as Context['llm'])
    const agent = {
      session: {
        events: [{
          type: 'user/message',
          data: {
            kind: 'user',
            content: [{
              type: 'image',
              attachment: { attachmentId: 'sha256:native', mediaType: 'image/png', bytes: 10 },
            }],
          },
        }],
      },
    } as unknown as Agent
    const assembled = assembly({
      tools: [VISION_SCHEMA as never, { name: 'other_tool' } as never],
      sections: [
        { name: VISION_TOOL_SECTION_NAME, text: 'stale tool guidance' },
        { name: 'other:section', text: 'keep me' },
      ],
      contexts: [
        { name: VISION_IMAGE_CONTEXT_NAME, text: 'stale native attachment context' },
        { name: 'other:context', text: 'keep me' },
      ],
      variables: { provider: 'p', model: 'image-model' },
    })

    const result = await applyVisionPromptEnrichment(ctx, assembled, { scope: {}, agent })

    expect(result.tools.map(tool => tool.name)).toEqual(['other_tool'])
    expect(result.sections.map(section => section.name)).toEqual(['other:section'])
    expect(result.contexts.map(context => context.name)).toEqual(['other:context'])
    expect(resolveModelInfo).toHaveBeenCalledWith('p', 'image-model', undefined)
  })

  it('keeps the vision tool for an image model when a path or URL remains routable', async () => {
    const resolveModelInfo = vi.fn().mockResolvedValue({ inputModalities: ['image'] })
    const ctx = fakeContext({ resolveModelInfo } as unknown as Context['llm'])
    const agent = {
      session: {
        events: [{
          type: 'user/message',
          data: {
            kind: 'user',
            content: [
              { type: 'image', attachment: { attachmentId: 'sha256:native', mediaType: 'image/png' } },
              { type: 'text', text: '[Pasted image available at absolute path: "C:\\work\\external.png"] https://img.example/external.png' },
            ],
          },
        }],
      },
    } as unknown as Agent
    const assembled = assembly({
      tools: [VISION_SCHEMA as never],
      variables: { provider: 'p', model: 'image-model' },
    })

    const result = await applyVisionPromptEnrichment(ctx, assembled, { scope: {}, agent })

    expect(result.tools.map(tool => tool.name)).toContain(VISION_TOOL_NAME)
    expect(result.sections.some(section => section.name === VISION_TOOL_SECTION_NAME)).toBe(true)
    const context = result.contexts.find(context => context.name === VISION_IMAGE_CONTEXT_NAME)
    expect(context?.text).toContain('external.png')
    expect(context?.text).toContain('https://img.example/external.png')
    expect(context?.text).not.toContain('sha256:native')
  })

  it('removes stale plugin context as well as section when the final tool list is scoped away', async () => {
    const ctx = fakeContext({ resolveModelInfo: vi.fn() } as unknown as Context['llm'], DENIED_SCOPE)
    const assembled = assembly({
      tools: [{ name: 'run_code' } as never],
      sections: [{ name: VISION_TOOL_SECTION_NAME, text: 'stale' }],
      contexts: [{ name: VISION_IMAGE_CONTEXT_NAME, text: 'stale' }],
    })

    const result = await applyVisionPromptEnrichment(ctx, assembled, { scope: DENIED_SCOPE })

    expect(result.sections).toEqual([])
    expect(result.contexts).toEqual([])
  })
})

describe('isVisionToolVisible', () => {
  it('reports visibility per scope and tolerates registry errors', () => {
    const ctx = fakeContext({ resolveModelInfo: vi.fn() } as unknown as Context['llm'])
    expect(isVisionToolVisible(ctx, undefined)).toBe(true)
    expect(isVisionToolVisible(ctx, DENIED_SCOPE)).toBe(false)
    const throwing = { tools: { get: () => { throw new Error('scope gone') } } } as unknown as Context
    expect(isVisionToolVisible(throwing, {})).toBe(false)
  })
})
