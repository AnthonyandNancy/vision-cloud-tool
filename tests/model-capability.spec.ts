import { describe, expect, it } from 'vitest'
import { resolveModelCapability } from '../src/model-capability.ts'

function llm(overrides: Record<string, unknown> = {}): unknown {
  return {
    resolveModelInfo: async () => ({ inputModalities: ['text'] }),
    listModels: async () => [],
    ...overrides,
  }
}

describe('resolveModelCapability', () => {
  it('returns image when the exact model has image input', async () => {
    await expect(resolveModelCapability({ resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }) }, 'p', 'm'))
      .resolves.toBe('image')
  })

  it('returns text when exact input modalities are non-empty without image', async () => {
    await expect(resolveModelCapability({ resolveModelInfo: async () => ({ inputModalities: ['text'] }) }, 'p', 'm'))
      .resolves.toBe('text')
  })

  it('returns unknown for missing or empty modalities', async () => {
    await expect(resolveModelCapability({ resolveModelInfo: async () => ({}) }, 'p', 'm')).resolves.toBe('unknown')
    await expect(resolveModelCapability({ resolveModelInfo: async () => ({ inputModalities: [] }) }, 'p', 'm')).resolves.toBe('unknown')
  })

  it('uses an exact catalog entry when resolveModelInfo is unavailable', async () => {
    await expect(resolveModelCapability({ listModels: async () => [{ id: 'm', inputModalities: ['image'] }] }, 'p', 'm'))
      .resolves.toBe('image')
    await expect(resolveModelCapability({ listModels: async () => [{ name: 'm', inputModalities: ['text'] }] }, 'p', 'm'))
      .resolves.toBe('text')
  })

  it('uses catalog data when exact resolution fails', async () => {
    await expect(resolveModelCapability({
      resolveModelInfo: async () => { throw new Error('unsupported') },
      listModels: async () => [{ id: 'm', inputModalities: ['image'] }],
    }, 'p', 'm')).resolves.toBe('image')
  })

  it('returns unknown for unavailable, malformed, or failed capability data', async () => {
    await expect(resolveModelCapability(undefined, 'p', 'm')).resolves.toBe('unknown')
    await expect(resolveModelCapability(llm({ resolveModelInfo: async () => ({ inputModalities: 'image' }) }), 'p', 'm')).resolves.toBe('unknown')
    await expect(resolveModelCapability(llm({ resolveModelInfo: async () => { throw new Error('down') }, listModels: async () => { throw new Error('down') } }), 'p', 'm')).resolves.toBe('unknown')
  })

  it('recognizes only the exact model in the catalog, not a partial name', async () => {
    await expect(resolveModelCapability({ listModels: async () => [{ id: 'm-long', inputModalities: ['image'] }] }, 'p', 'm'))
      .resolves.toBe('unknown')
  })

  it('passes provider, model, and signal to the exact resolver', async () => {
    const signal = new AbortController().signal
    const resolveModelInfo = async (...args: unknown[]) => {
      expect(args).toEqual(['provider', 'model', signal])
      return { inputModalities: ['image'] }
    }
    await expect(resolveModelCapability({ resolveModelInfo }, 'provider', 'model', signal)).resolves.toBe('image')
  })
})
