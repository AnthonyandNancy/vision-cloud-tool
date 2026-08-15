/**
 * @anionex/dsh-vision-toolkit — online-only vision plugin.
 *
 * Registers a single `vision_cloud_tool` only when a vision model is selected
 * in Settings (default off). The tool reads images through the DSH app's
 * configured model via `ctx.llm` and returns modlens v2 structured evidence.
 * No Python, no local tools, no credential or endpoint configuration.
 * @module @anionex/dsh-vision-toolkit
 */
import { Config, VISION_TOOLKIT_SETTINGS_NAMESPACE, resolveConfig, } from "./config.js";
import { VisionToolkitRuntime } from "./runtime.js";
import { createVisionCloudTool } from "./tools.js";
import { PLUGIN_VERSION } from "./version.js";
import { installVisionToolkitWeb, VisionToolkitWebBackend } from "./web.js";
import { PastedImageBackend } from "./paste-images.js";
export const name = '@anionex/dsh-vision-toolkit';
export { Config };
export const inject = ['tools', 'settings', 'llm', 'attachments', 'sessions'];
/** Plugin entry: validate configuration, then mount the tool when enabled. */
export function apply(ctx, config = {}) {
    const settings = ctx.settings.register(VISION_TOOLKIT_SETTINGS_NAMESPACE, Config, {
        base: config,
        applies: 'live',
        validate: (value) => { resolveConfig(value); },
    });
    const lifecycle = new AbortController();
    let toolDisposer;
    let currentRuntime;
    const ensureTool = (raw) => {
        toolDisposer?.();
        toolDisposer = undefined;
        currentRuntime = undefined;
        const resolved = resolveConfig(raw);
        if (resolved.model === undefined) {
            ctx.logger.info('dsh-vision-toolkit %s: no vision model selected; vision_cloud_tool is not registered', PLUGIN_VERSION);
            return;
        }
        currentRuntime = new VisionToolkitRuntime(ctx, resolved);
        toolDisposer = ctx.tools.register(createVisionCloudTool(currentRuntime, lifecycle.signal));
        ctx.logger.info('dsh-vision-toolkit %s: vision_cloud_tool registered (model %s/%s)', PLUGIN_VERSION, resolved.model.provider, resolved.model.model);
    };
    try {
        ensureTool(settings.get());
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.logger.error('dsh-vision-toolkit %s: configuration rejected; vision_cloud_tool is not registered. %s', PLUGIN_VERSION, message);
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
    });
    installVisionToolkitWeb(ctx, backend, pastedImages);
    const watch = settings.watch((next) => {
        try {
            ensureTool(next);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            ctx.logger.error('dsh-vision-toolkit: keeping the previous configuration after a refused Settings change. %s', message);
        }
    });
    return () => {
        lifecycle.abort();
        toolDisposer?.();
        watch();
    };
}
//# sourceMappingURL=index.js.map