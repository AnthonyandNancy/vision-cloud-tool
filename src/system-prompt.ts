/**
 * The agent-facing tool guidance injected while the vision model is enabled.
 * The text is capability-conditional: image-capable models must answer from
 * visible image content themselves, while text-only models are instructed to
 * call `vision_cloud_tool` in the same turn. The exact per-image arguments
 * come from the dynamic `vision-cloud:images` runtime context.
 * @module dsh-vision-cloud/system-prompt
 */

export const VISION_TOOL_NAME = 'vision_cloud_tool'

/** System-prompt section owned by this plugin (order 40). */
export const VISION_TOOL_SECTION_NAME = 'vision-cloud:tool'

/** Runtime-context contribution listing the exact tool arguments. */
export const VISION_IMAGE_CONTEXT_NAME = 'vision-cloud:images'

export type VisionCapability = 'image' | 'text' | 'unknown'

const COMMON_RULES = [
  'Call vision_cloud_tool only for image inputs, never for non-image URLs (bare domains or API endpoints such as /v1/models), videos or audio, or non-image files such as YAML/JSON/log/text documents — use the regular read/fetch tools for those.',
  'Pass workspace image paths and direct http(s) image URLs in the vision_cloud_tool images argument; pass pasted image attachment ids (e.g. sha256:...) in the attachments argument. DSH @file references such as @image.png, @./screenshots/error.png, @~/Pictures/image.png, or @"image with spaces.png" are visual file references and belong in images after removing only the leading @ marker. A @[session](dsh-session:...) reference is a session reference, not a file; ordinary text files such as @README.md stay on the regular read path. Multiple images belonging to one question go in a single call so they can be compared together.',
  'A bridged [Pasted image available at absolute path: "..."] line is a workspace image path: pass that path inside vision_cloud_tool.images, never to read_image.',
  'Do not call read_image unless you are an image-capable model — read_image only hands the image back to a model that can see it, so it fails for a text-only current model.',
  'If vision_cloud_tool reports a schema, validation, or read error, retry vision_cloud_tool or report that error to the user; never fall back to read_image or try to load the image yourself.',
]

const CAPABILITY_PREFIX: Record<VisionCapability, string> = {
  text: [
    'You are a text-only model: you cannot see any image content yourself. Whenever this conversation contains image inputs (workspace image paths, DSH @file references such as @image.png or @"image with spaces.png", direct image URLs, [Pasted image available at absolute path: ...] lines, or image attachment ids such as sha256:...), you MUST read them with vision_cloud_tool before answering, in this same turn.',
    'Do not claim you can see the images, do not ask the user to repeat or re-upload them, and do not wait for a later turn. The "vision-cloud:images" runtime context (when present) lists the exact arguments to pass.',
  ].join(' '),
  image: [
    'You are an image-capable model. Image content that is directly visible in this conversation must be analyzed by you directly — do NOT call vision_cloud_tool for it.',
    'Only when a message carries image inputs that are not directly visible to you (only a workspace path, an image URL, a [Pasted image available at absolute path: ...] line, or an image attachment id) call vision_cloud_tool for exactly those inputs, in this same turn, using the arguments listed in the "vision-cloud:images" runtime context.',
  ].join(' '),
  unknown: [
    'For every image input in this conversation that is not directly visible to you (for example you are a text-only model, or the message carries only a workspace image path, an http(s) image URL, a [Pasted image available at absolute path: ...] line, or an image attachment id), you MUST read it with vision_cloud_tool before answering, in this same turn.',
    'If image content is directly visible to you, analyze it yourself and do NOT call vision_cloud_tool for that image. The "vision-cloud:images" runtime context (when present) lists the exact arguments to pass.',
  ].join(' '),
}

/** Build the capability-specific tool guidance section text. */
export function visionToolSectionText(capability: VisionCapability): string {
  return [CAPABILITY_PREFIX[capability], ...COMMON_RULES].join('\n')
}

/** Model-agnostic fallback used when the current model's capability is unknown. */
export const VISION_TOOL_SYSTEM_PROMPT = visionToolSectionText('unknown')
