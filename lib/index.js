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
import { applyVisionPromptEnrichment, isVisionToolVisible } from "./prompt-assembly.js";
import { VISION_TOOL_SECTION_NAME, VISION_TOOL_SYSTEM_PROMPT } from "./system-prompt.js";
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
        const disposeSection = ctx.systemPrompt.section({
            name: VISION_TOOL_SECTION_NAME,
            order: 40,
            // Scoped gate: the static guidance never renders for scopes whose preset
            // made the tool invisible. The assemble listener below is the final
            // authority and prunes this section when `assembled.tools` lacks it
            // (restrictions, code-mode collapse, tool-order filtering).
            text: (assemblyContext) => isVisionToolVisible(ctx, assemblyContext.scope) ? VISION_TOOL_SYSTEM_PROMPT : '',
        });
        const disposeAssembly = ctx.on('system-prompt/assemble', async (_assembly, assemblyContext, next) => {
            const assembled = await next();
            try {
                return await applyVisionPromptEnrichment(ctx, assembled, assemblyContext);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                ctx.logger.warn('dsh-vision-cloud %s: vision prompt enrichment skipped. %s', PLUGIN_VERSION, message);
                return assembled;
            }
        });
        promptDisposer = () => {
            disposeAssembly();
            disposeSection();
        };
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