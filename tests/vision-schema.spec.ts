import { describe, expect, it } from 'vitest'
import { missingSchemaFields, normalizeVisionResult, type VisionResult } from '../src/vision-schema.ts'

function validResult(): VisionResult {
  return {
    summary: 'A summary',
    ocr: { full_text: 'hello', lines: [{ text: 'hello', language: 'en' }] },
    layout: { regions: [{ type: 'paragraph', reading_order: 1, text: 'hello' }] },
    semantics: {
      scene: 'document',
      intent: 'inform',
      entities: [{ name: 'x', type: 'thing', evidence: 'seen' }],
      relations: [{ subject: 'a', predicate: 'b', object: 'c' }],
    },
    visual: { dominant_colors: ['#000000'], style: 'plain', notes: ['note'] },
    uncertainty: [],
  }
}

describe('vision-schema', () => {
  it('accepts a fully populated v2 result', () => {
    expect(missingSchemaFields(validResult())).toEqual([])
  })

  it('accepts the minimal required shape (optional fields omitted)', () => {
    const minimal = {
      summary: 's',
      ocr: { full_text: '', lines: [] },
      layout: { regions: [] },
      semantics: { scene: 'scene', entities: [] },
      visual: {},
      uncertainty: [],
    }
    expect(missingSchemaFields(minimal)).toEqual([])
  })

  it('reports every missing required top-level field', () => {
    const violations = missingSchemaFields({ summary: 'only summary' })
    expect(violations).toContain('ocr')
    expect(violations).toContain('layout')
    expect(violations).toContain('semantics')
    expect(violations).toContain('visual')
    expect(violations).toContain('uncertainty')
  })

  it('reports missing nested required fields', () => {
    const broken = validResult() as unknown as Record<string, unknown>
    delete (broken.ocr as Record<string, unknown>).full_text
    expect(missingSchemaFields(broken)).toContain('ocr.full_text')
  })

  it('rejects wrong types', () => {
    const broken = validResult() as unknown as Record<string, unknown>
    broken.summary = 42
    expect(missingSchemaFields(broken)).toContain('summary')
  })

  it('strips unknown top-level and nested fields while keeping declared fields', () => {
    const extra = validResult() as unknown as Record<string, unknown>
    extra.identity_analysis = { verdict: 'unknown' }
    ;(extra.semantics as Record<string, unknown>).faces = ['one face']
    const normalized = normalizeVisionResult(extra) as Record<string, unknown>
    expect(normalized).toMatchObject({
      summary: 'A summary',
      ocr: { full_text: 'hello', lines: [{ text: 'hello', language: 'en' }] },
      semantics: { scene: 'document', entities: [{ name: 'x', type: 'thing' }] },
    })
    expect('identity_analysis' in normalized).toBe(false)
    expect('faces' in (normalized.semantics as Record<string, unknown>)).toBe(false)
    expect(missingSchemaFields(normalized)).toEqual([])
  })

  it('leaves non-object payloads untouched so schema validation still reports them', () => {
    expect(normalizeVisionResult('nope')).toBe('nope')
    expect(normalizeVisionResult(42)).toBe(42)
    expect(missingSchemaFields(normalizeVisionResult('nope'))).toContain('(root)')
  })
})
