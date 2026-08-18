/**
 * The agent-facing tool guidance injected while the vision model is enabled.
 * The text is capability-conditional: image-capable models must answer from
 * visible image content themselves, while text-only models are instructed to
 * call `vision_cloud_tool` in the same turn. The exact per-image arguments
 * come from the dynamic `vision-cloud:images` runtime context.
 * @module dsh-vision-cloud/system-prompt
 */
export declare const VISION_TOOL_NAME = "vision_cloud_tool";
/** System-prompt section owned by this plugin (order 40). */
export declare const VISION_TOOL_SECTION_NAME = "vision-cloud:tool";
/** Runtime-context contribution listing the exact tool arguments. */
export declare const VISION_IMAGE_CONTEXT_NAME = "vision-cloud:images";
export type VisionCapability = 'image' | 'text' | 'unknown';
/** Build the capability-specific tool guidance section text. */
export declare function visionToolSectionText(capability: VisionCapability): string;
/** Model-agnostic fallback used when the current model's capability is unknown. */
export declare const VISION_TOOL_SYSTEM_PROMPT: string;
//# sourceMappingURL=system-prompt.d.ts.map