/**
 * modlens vision prompt: instructs a vision-capable model to return one JSON
 * object matching the modlens v2 schema. Ported from liustack/modlens (MIT).
 * @module dsh-vision-cloud/vision-prompt
 */
export declare const JSON_TEMPLATE_INSTRUCTION = "Respond with ONE JSON object only, no markdown fences, no commentary. Fill this exact structure with your findings from the image (do not repeat this template literally, replace every value). Output exactly the fields in this template: do not add any extra top-level or nested field such as identity_analysis, faces, face_analysis, or confidence.\n{\"summary\":\"one paragraph describing the image\",\"ocr\":{\"full_text\":\"all visible text\",\"lines\":[{\"text\":\"one line\",\"language\":\"en\"}]},\"layout\":{\"regions\":[{\"type\":\"a short kind, e.g. title, heading, paragraph, list, table, chart, form, code, image, icon, link, nav, button, search, or any other short label that fits better\",\"reading_order\":1,\"text\":\"region text\"}]},\"semantics\":{\"scene\":\"what kind of scene\",\"intent\":\"what the image is for\",\"entities\":[{\"name\":\"entity\",\"type\":\"kind\",\"evidence\":\"where seen\"}],\"relations\":[{\"subject\":\"a\",\"predicate\":\"relates to\",\"object\":\"b\"}]},\"visual\":{\"dominant_colors\":[\"color\"],\"style\":\"visual style\",\"notes\":[\"notable visual detail\"]},\"uncertainty\":[\"anything unreadable or ambiguous\"]}";
export interface BuildVisionPromptOptions {
    language: 'zh' | 'en';
    extraPrompt?: string;
}
/** Build the inline-image analysis prompt that yields the modlens v2 schema. */
export declare function buildVisionPrompt(options: BuildVisionPromptOptions): string;
//# sourceMappingURL=vision-prompt.d.ts.map