/**
 * modlens v2 vision result contract. Six required top-level fields; no pixel
 * bbox and no numeric confidence (vision models fabricate both, so v2 dropped
 * them). Ported from liustack/modlens (MIT).
 * @module dsh-vision-cloud/vision-schema
 */
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
                                description: 'A short kind for this region. Prefer a common one where it fits: title, heading, paragraph, list, table, chart, form, code, image, icon, link, nav, button, search. Any other short label is fine when none of those describe it.',
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
};
/**
 * Keep only fields declared by the schema, recursively. Vision models
 * frequently add plausible extras (`identity_analysis`, `faces`, ...) even
 * when the prompt forbids them; stripping those fields here keeps the strict
 * tool output schema (`additionalProperties: false`) from rejecting an
 * otherwise-valid read and pushing the caller model into wrong fallbacks.
 */
export function normalizeVisionResult(value) {
    function normalize(schema, candidate) {
        if (schema.type === 'object') {
            if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate))
                return candidate;
            const record = candidate;
            const out = {};
            for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
                if (!(key in record) || record[key] === undefined)
                    continue;
                out[key] = normalize(childSchema, record[key]);
            }
            return out;
        }
        if (schema.type === 'array') {
            if (!Array.isArray(candidate))
                return candidate;
            if (schema.items === undefined)
                return candidate;
            return candidate.map(item => normalize(schema.items, item));
        }
        return candidate;
    }
    return normalize(VISION_RESULT_SCHEMA, value);
}
function schemaViolations(schema, value, path) {
    const label = path || '(root)';
    if (schema.type === 'object') {
        if (typeof value !== 'object' || value === null || Array.isArray(value))
            return [label];
        const record = value;
        const violations = [];
        for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
            const childPath = path ? `${path}.${key}` : key;
            const required = schema.required?.includes(key) ?? false;
            if (!(key in record) || record[key] === undefined) {
                if (required)
                    violations.push(childPath);
                continue;
            }
            violations.push(...schemaViolations(childSchema, record[key], childPath));
        }
        return violations;
    }
    if (schema.type === 'array') {
        if (!Array.isArray(value))
            return [label];
        if (!schema.items)
            return [];
        return value.flatMap((item, index) => schemaViolations(schema.items, item, `${path}[${index}]`));
    }
    if (schema.type === 'string') {
        if (typeof value !== 'string')
            return [label];
        return schema.enum && !schema.enum.includes(value) ? [label] : [];
    }
    if (schema.type === 'number') {
        return typeof value === 'number' && Number.isFinite(value) ? [] : [label];
    }
    return [];
}
/**
 * Paths where a result violates the vision contract. Empty means it matches.
 * This portable check runs after every read, so a structurally broken payload
 * fails loudly instead of reaching the model as if it were evidence.
 */
export function missingSchemaFields(result) {
    return schemaViolations(VISION_RESULT_SCHEMA, result, '');
}
//# sourceMappingURL=vision-schema.js.map