/**
 * modlens v2 vision result contract. Six required top-level fields; no pixel
 * bbox and no numeric confidence (vision models fabricate both, so v2 dropped
 * them). Ported from liustack/modlens (MIT).
 * @module dsh-vision-cloud/vision-schema
 */

export interface VisionOcrLine {
  text: string
  language?: string
}

export interface VisionOcr {
  full_text: string
  lines: VisionOcrLine[]
}

export interface VisionRegion {
  /** Open string kind; prefer a common label where one fits. */
  type: string
  reading_order: number
  text: string
}

export interface VisionLayout {
  regions: VisionRegion[]
}

export interface VisionEntity {
  name: string
  type: string
  evidence?: string
}

export interface VisionRelation {
  subject: string
  predicate: string
  object: string
}

export interface VisionSemantics {
  scene: string
  intent?: string
  entities: VisionEntity[]
  relations: VisionRelation[]
}

export interface VisionVisual {
  dominant_colors: string[]
  style: string
  notes: string[]
}

/** The modlens v2 structured evidence object every read returns. */
export interface VisionResult {
  summary: string
  ocr: VisionOcr
  layout: VisionLayout
  semantics: VisionSemantics
  visual: VisionVisual
  uncertainty: string[]
}

interface JsonSchemaNode {
  type?: string
  properties?: Record<string, JsonSchemaNode>
  required?: readonly string[]
  items?: JsonSchemaNode
  enum?: readonly string[]
  description?: string
}

/**
 * JSON schema for the modlens v2 result. `layout.regions[].type` is an open
 * string, not a closed enum; the common vocabulary lives in the field's
 * `description` so any provider enforcing the schema server-side still gets
 * the guidance.
 */
export const VISION_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    ocr: {
      type: 'object',
      properties: {
        full_text: { type: 'string' },
        lines: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              language: { type: 'string' },
            },
            required: ['text'],
          },
        },
      },
      required: ['full_text', 'lines'],
    },
    layout: {
      type: 'object',
      properties: {
        regions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                description:
                  'A short kind for this region. Prefer a common one where it fits: title, heading, paragraph, list, table, chart, form, code, image, icon, link, nav, button, search. Any other short label is fine when none of those describe it.',
              },
              reading_order: { type: 'number' },
              text: { type: 'string' },
            },
            required: ['type', 'reading_order', 'text'],
          },
        },
      },
      required: ['regions'],
    },
    semantics: {
      type: 'object',
      properties: {
        scene: { type: 'string' },
        intent: { type: 'string' },
        entities: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              type: { type: 'string' },
              evidence: { type: 'string' },
            },
            required: ['name', 'type'],
          },
        },
        relations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              subject: { type: 'string' },
              predicate: { type: 'string' },
              object: { type: 'string' },
            },
            required: ['subject', 'predicate', 'object'],
          },
        },
      },
      required: ['scene', 'entities'],
    },
    visual: {
      type: 'object',
      properties: {
        dominant_colors: { type: 'array', items: { type: 'string' } },
        style: { type: 'string' },
        notes: { type: 'array', items: { type: 'string' } },
      },
    },
    uncertainty: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'ocr', 'layout', 'semantics', 'visual', 'uncertainty'],
} as const

function schemaViolations(schema: JsonSchemaNode, value: unknown, path: string): string[] {
  const label = path || '(root)'

  if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return [label]
    const record = value as Record<string, unknown>
    const violations: string[] = []
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      const childPath = path ? `${path}.${key}` : key
      const required = schema.required?.includes(key) ?? false
      if (!(key in record) || record[key] === undefined) {
        if (required) violations.push(childPath)
        continue
      }
      violations.push(...schemaViolations(childSchema, record[key], childPath))
    }
    return violations
  }

  if (schema.type === 'array') {
    if (!Array.isArray(value)) return [label]
    if (!schema.items) return []
    return value.flatMap((item, index) =>
      schemaViolations(schema.items!, item, `${path}[${index}]`),
    )
  }

  if (schema.type === 'string') {
    if (typeof value !== 'string') return [label]
    return schema.enum && !schema.enum.includes(value) ? [label] : []
  }

  if (schema.type === 'number') {
    return typeof value === 'number' && Number.isFinite(value) ? [] : [label]
  }

  return []
}

/**
 * Paths where a result violates the vision contract. Empty means it matches.
 * This portable check runs after every read, so a structurally broken payload
 * fails loudly instead of reaching the model as if it were evidence.
 */
export function missingSchemaFields(result: unknown): string[] {
  return schemaViolations(VISION_RESULT_SCHEMA as unknown as JsonSchemaNode, result, '')
}
