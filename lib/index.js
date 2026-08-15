/**
 * dsh-vision-cloud — online-only vision plugin.
 *
 * Registers a single `vision_cloud_tool` only when a vision model is selected
 * in Settings (default off). The tool reads images through the DSH app's
 * configured model via `ctx.llm` and returns modlens v2 structured evidence.
 * No Python, no local tools, no credential or endpoint configuration.
 * @module dsh-vision-cloud
 */
import { Config, VISION_TOOLKIT_SETTINGS_NAMESPACE, resolveConfig, } from "./config.js";
import { VisionToolkitRuntime } from "./runtime.js";
import { createVisionCloudTool } from "./tools.js";
import { PLUGIN_VERSION } from "./version.js";
import { installVisionToolkitWeb, VisionToolkitWebBackend } from "./web.js";
import { PastedImageBackend } from "./paste-images.js";
export const name = 'dsh-vision-cloud';
export { Config };
export const inject = ['tools', 'settings', 'llm', 'attachments', 'sessions', 'systemPrompt'];
/** Plugin entry: validate configuration, then mount the tool when enabled. */
export function apply(ctx, config = {}) {
    const settings = ctx.settings.register(VISION_TOOLKIT_SETTINGS_NAMESPACE, Config, {
        base: config,
        applies: 'live',
        validate: (value) => { resolveConfig(value); },
    });
    const lifecycle = new AbortController();
    let toolDisposer;
    let promptDisposer;
    let currentRuntime;
    const ensureTool = (raw) => {
        toolDisposer?.();
        toolDisposer = undefined;
        promptDisposer?.();
        promptDisposer = undefined;
        currentRuntime = undefined;
        const resolved = resolveConfig(raw);
        if (resolved.model === undefined) {
            ctx.logger.info('dsh-vision-cloud %s: no vision model selected; vision_cloud_tool is not registered', PLUGIN_VERSION);
            return;
        }
        currentRuntime = new VisionToolkitRuntime(ctx, resolved);
        toolDisposer = ctx.tools.register(createVisionCloudTool(currentRuntime, lifecycle.signal));
        promptDisposer = ctx.systemPrompt.section({
            name: 'vision-cloud:tool',
            order: 40,
            text: 'To read or analyze an image (an image file in the workspace, an http(s) URL that points directly to a PNG/JPEG/GIF/WebP image, or a pasted image attachment id), use the vision_cloud_tool: it reads images through the app\'s configured vision model and returns structured evidence, so it works even when you cannot accept image input yourself. Never call vision_cloud_tool for non-image URLs (for example API endpoints), for videos or audio, or for non-image files such as YAML/JSON/log/text documents — use the normal read/fetch tools for those. Do not call read_image unless you are an image-capable model — read_image only hands the image back to a model that can see it.',
        });
        ctx.logger.info('dsh-vision-cloud %s: vision_cloud_tool registered (model %s/%s)', PLUGIN_VERSION, resolved.model.provider, resolved.model.model);
    };
    try {
        ensureTool(settings.get());
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.logger.error('dsh-vision-cloud %s: configuration rejected; vision_cloud_tool is not registered. %s', PLUGIN_VERSION, message);
    }
    const backend = new VisionToolkitWebBackend(ctx, () => currentRuntime);
    const pastedImages = new PastedImageBackend(ctx, {
        maxImageBytes: () => {
            try {
                return resolveConfig(settings.get()).maxImageBytes;
            }
            catch {
                return 10485760;
            }
        },
        pasteToPath: () => {
            try {
                return resolveConfig(settings.get()).pasteToPath;
            }
            catch {
                return true;
            }
        },
    });
    installVisionToolkitWeb(ctx, backend, pastedImages);
    const watch = settings.watch((next) => {
        try {
            ensureTool(next);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            ctx.logger.error('dsh-vision-cloud: keeping the previous configuration after a refused Settings change. %s', message);
        }
    });
    return () => {
        lifecycle.abort();
        toolDisposer?.();
        promptDisposer?.();
        watch();
    };
}
//# sourceMappingURL=index.js.map