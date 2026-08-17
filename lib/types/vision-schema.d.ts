/**
 * modlens v2 vision result contract. Six required top-level fields; no pixel
 * bbox and no numeric confidence (vision models fabricate both, so v2 dropped
 * them). Ported from liustack/modlens (MIT).
 * @module dsh-vision-cloud/vision-schema
 */
export interface VisionOcrLine {
    text: string;
    language?: string;
}
export interface VisionOcr {
    full_text: string;
    lines: VisionOcrLine[];
}
export interface VisionRegion {
    /** Open string kind; prefer a common label where one fits. */
    type: string;
    reading_order: number;
    text: string;
}
export interface VisionLayout {
    regions: VisionRegion[];
}
export interface VisionEntity {
    name: string;
    type: string;
    evidence?: string;
}
export interface VisionRelation {
    subject: string;
    predicate: string;
    object: string;
}
export interface VisionSemantics {
    scene: string;
    intent?: string;
    entities: VisionEntity[];
    relations: VisionRelation[];
}
export interface VisionVisual {
    dominant_colors: string[];
    style: string;
    notes: string[];
}
/** The modlens v2 structured evidence object every read returns. */
export interface VisionResult {
    summary: string;
    ocr: VisionOcr;
    layout: VisionLayout;
    semantics: VisionSemantics;
    visual: VisionVisual;
    uncertainty: string[];
}
/**
 * JSON schema for the modlens v2 result. `layout.regions[].type` is an open
 * string, not a closed enum; the common vocabulary lives in the field's
 * `description` so any provider enforcing the schema server-side still gets
 * the guidance.
 */
export declare const VISION_RESULT_SCHEMA: {
    readonly type: "object";
    readonly properties: {
        readonly summary: {
            readonly type: "string";
        };
        readonly ocr: {
            readonly type: "object";
            readonly properties: {
                readonly full_text: {
                    readonly type: "string";
                };
                readonly lines: {
                    readonly type: "array";
                    readonly items: {
                        readonly type: "object";
                        readonly properties: {
                            readonly text: {
                                readonly type: "string";
                            };
                            readonly language: {
                                readonly type: "string";
                            };
                        };
                        readonly required: readonly ["text"];
                    };
                };
            };
            readonly required: readonly ["full_text", "lines"];
        };
        readonly layout: {
            readonly type: "object";
            readonly properties: {
                readonly regions: {
                    readonly type: "array";
                    readonly items: {
                        readonly type: "object";
                        readonly properties: {
                            readonly type: {
                                readonly type: "string";
                                readonly description: "A short kind for this region. Prefer a common one where it fits: title, heading, paragraph, list, table, chart, form, code, image, icon, link, nav, button, search. Any other short label is fine when none of those describe it.";
                            };
                            readonly reading_order: {
                                readonly type: "number";
                            };
                            readonly text: {
                                readonly type: "string";
                            };
                        };
                        readonly required: readonly ["type", "reading_order", "text"];
                    };
                };
            };
            readonly required: readonly ["regions"];
        };
        readonly semantics: {
            readonly type: "object";
            readonly properties: {
                readonly scene: {
                    readonly type: "string";
                };
                readonly intent: {
                    readonly type: "string";
                };
                readonly entities: {
                    readonly type: "array";
                    readonly items: {
                        readonly type: "object";
                        readonly properties: {
                            readonly name: {
                                readonly type: "string";
                            };
                            readonly type: {
                                readonly type: "string";
                            };
                            readonly evidence: {
                                readonly type: "string";
                            };
                        };
                        readonly required: readonly ["name", "type"];
                    };
                };
                readonly relations: {
                    readonly type: "array";
                    readonly items: {
                        readonly type: "object";
                        readonly properties: {
                            readonly subject: {
                                readonly type: "string";
                            };
                            readonly predicate: {
                                readonly type: "string";
                            };
                            readonly object: {
                                readonly type: "string";
                            };
                        };
                        readonly required: readonly ["subject", "predicate", "object"];
                    };
                };
            };
            readonly required: readonly ["scene", "entities"];
        };
        readonly visual: {
            readonly type: "object";
            readonly properties: {
                readonly dominant_colors: {
                    readonly type: "array";
                    readonly items: {
                        readonly type: "string";
                    };
                };
                readonly style: {
                    readonly type: "string";
                };
                readonly notes: {
                    readonly type: "array";
                    readonly items: {
                        readonly type: "string";
                    };
                };
            };
        };
        readonly uncertainty: {
            readonly type: "array";
            readonly items: {
                readonly type: "string";
            };
        };
    };
    readonly required: readonly ["summary", "ocr", "layout", "semantics", "visual", "uncertainty"];
};
/**
 * Keep only fields declared by the schema, recursively. Vision models
 * frequently add plausible extras (`identity_analysis`, `faces`, ...) even
 * when the prompt forbids them; stripping those fields here keeps the strict
 * tool output schema (`additionalProperties: false`) from rejecting an
 * otherwise-valid read and pushing the caller model into wrong fallbacks.
 */
export declare function normalizeVisionResult(value: unknown): unknown;
/**
 * Paths where a result violates the vision contract. Empty means it matches.
 * This portable check runs after every read, so a structurally broken payload
 * fails loudly instead of reaching the model as if it were evidence.
 */
export declare function missingSchemaFields(result: unknown): string[];
//# sourceMappingURL=vision-schema.d.ts.map