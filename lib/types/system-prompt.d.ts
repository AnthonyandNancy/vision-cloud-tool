/**
 * The agent-facing tool guidance injected while the vision model is enabled.
 * v2 wording is capability-conditional: the model must only route through
 * `vision_cloud_tool` when the image content is NOT directly visible to it —
 * a text-only model, or any model handed only a path/URL/attachment reference.
 * A model that can see the image(s) itself must answer from them directly,
 * while URL/path/attachment cases keep the tool as the only available route.
 * @module dsh-vision-cloud/system-prompt
 */
export declare const VISION_TOOL_SYSTEM_PROMPT = "To read or analyze an image that is NOT directly visible to you in this conversation (for example you are a text-only model, or the message carries only a workspace image path, an http(s) URL ending in .png/.jpg/.jpeg/.gif/.webp, or a pasted image attachment id), use the vision_cloud_tool: it reads images through the app's configured vision model and returns structured evidence. If the conversation already contains image content that you can see directly, analyze the image(s) yourself and do NOT call vision_cloud_tool for that image. Never call vision_cloud_tool for non-image URLs (bare domains or API endpoints such as /v1/models), for videos or audio, or for non-image files such as YAML/JSON/log/text documents \u2014 use the normal read/fetch tools for those. Do not call read_image unless you are an image-capable model \u2014 read_image only hands the image back to a model that can see it.";
//# sourceMappingURL=system-prompt.d.ts.map