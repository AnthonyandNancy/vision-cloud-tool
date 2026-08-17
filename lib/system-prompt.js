/**
 * The agent-facing tool guidance injected while the vision model is enabled.
 * v2 wording is capability-conditional: the model must only route through
 * `vision_cloud_tool` when the image content is NOT directly visible to it —
 * a text-only model, or any model handed only a path/URL/attachment reference.
 * A model that can see the image(s) itself must answer from them directly,
 * while URL/path/attachment cases keep the tool as the only available route.
 * @module dsh-vision-cloud/system-prompt
 */
export const VISION_TOOL_SYSTEM_PROMPT = 'To read or analyze an image that is NOT directly visible to you in this conversation (for example you are a text-only model, or the message carries only a workspace image path, an http(s) URL ending in .png/.jpg/.jpeg/.gif/.webp, or a pasted image attachment id), use the vision_cloud_tool: it reads images through the app\'s configured vision model and returns structured evidence. If the conversation already contains image content that you can see directly, analyze the image(s) yourself and do NOT call vision_cloud_tool for that image. Never call vision_cloud_tool for non-image URLs (bare domains or API endpoints such as /v1/models), for videos or audio, or for non-image files such as YAML/JSON/log/text documents — use the normal read/fetch tools for those. Do not call read_image unless you are an image-capable model — read_image only hands the image back to a model that can see it. A bridged pasted-image line ([Pasted image available at absolute path: "..."] is a workspace image path: pass it inside vision_cloud_tool.images, never to read_image.) If vision_cloud_tool reports a schema, validation, or read error, retry vision_cloud_tool or report that error to the user; never fall back to read_image or try to load the image yourself, because read_image fails for a text-only current model.';
//# sourceMappingURL=system-prompt.js.map