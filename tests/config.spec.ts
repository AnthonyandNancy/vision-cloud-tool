import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.ts'

describe('config', () => {
  it('applies defaults with no model selected', () => {
    const config = resolveConfig()
    expect(config.model).toBeUndefined()
    expect(config.language).toBe('zh')
    expect(config.timeoutMs).toBe(180000)
    expect(config.maxImageBytes).toBe(10485760)
    expect(config.maxImagePixels).toBe(40000000)
    expect(config.concurrency).toBe(4)
    expect(config.maxImages).toBe(8)
    expect(config.allowedDirs).toEqual([])
    expect(config.allowExtensionlessImageUrls).toBe(false)
  })

  it('keeps an absent model off', () => {
    expect(resolveConfig({ model: {} }).model).toBeUndefined()
    expect(resolveConfig({ model: { provider: '', model: '' } }).model).toBeUndefined()
  })

  it('resolves a selected model', () => {
    const config = resolveConfig({ model: { provider: ' deepseek-official ', model: ' model-x ' } })
    expect(config.model).toEqual({ provider: 'deepseek-official', model: 'model-x' })
  })

  it('rejects a half-set model', () => {
    expect(() => resolveConfig({ model: { provider: 'p' } })).toThrow(/requires both/)
    expect(() => resolveConfig({ model: { model: 'm' } })).toThrow(/requires both/)
  })

  it('rejects out-of-range limits', () => {
    expect(() => resolveConfig({ timeoutMs: 10 })).toThrow(/timeoutMs/)
    expect(() => resolveConfig({ maxImageBytes: 1 })).toThrow(/maxImageBytes/)
    expect(() => resolveConfig({ maxImagePixels: 0 })).toThrow(/maxImagePixels/)
    expect(() => resolveConfig({ concurrency: 0 })).toThrow(/concurrency/)
    expect(() => resolveConfig({ maxImages: 9 })).toThrow(/maxImages/)
  })
})
