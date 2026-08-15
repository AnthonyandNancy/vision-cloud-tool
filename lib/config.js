/**
 * Plugin configuration: an optional app-model selection, output language, and
 * limits. There are no secrets and no provider endpoints here — the DSH app
 * owns the configured model's URL and key.
 * @module dsh-vision-cloud/config
 */
import z from '@deepseek-ai/schemastery';
import { settingsNamespace } from '@deepseek-ai/dsh-settings';
import { VisionToolkitError } from "./errors.js";
/** Settings document namespace owned by this plugin. */
export const VISION_TOOLKIT_SETTINGS_NAMESPACE = settingsNamespace('vision-cloud');
/** Configuration schema with documented defaults. */
export const Config = z.object({
    model: z.object({
        provider: z.string(),
        model: z.string(),
    }),
    language: z.union(['zh', 'en']).default('zh'),
    timeoutMs: z.number().default(180000),
    maxImageBytes: z.number().default(10485760),
    maxImagePixels: z.number().default(40000000),
    concurrency: z.number().default(4),
    maxImages: z.number().default(8),
    allowedDirs: z.array(z.string()).default([]),
    allowExtensionlessImageUrls: z.boolean().default(false),
    pasteToPath: z.boolean().default(true),
});
const MAX_TIMEOUT_MS = 600000;
const MAX_IMAGE_BYTES = 268435456;
const MAX_IMAGE_PIXELS = 268435456;
const MAX_CONCURRENCY = 16;
const MAX_IMAGES = 8;
/**
 * Validate and normalize a config object (partial inputs receive the same
 * defaults the schemastery schema applies). A half-set `model` fails loud; an
 * absent or fully-empty `model` means the tool stays unregistered.
 */
export function resolveConfig(config = {}) {
    const language = config.language ?? 'zh';
    if (language !== 'zh' && language !== 'en') {
        throw new VisionToolkitError('config', 'language must be "zh" or "en"');
    }
    const timeoutMs = config.timeoutMs ?? 180000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > MAX_TIMEOUT_MS) {
        throw new VisionToolkitError('config', `timeoutMs must be an integer between 1000 and ${MAX_TIMEOUT_MS}`);
    }
    const maxImageBytes = config.maxImageBytes ?? 10485760;
    if (!Number.isInteger(maxImageBytes) || maxImageBytes < 1024 || maxImageBytes > MAX_IMAGE_BYTES) {
        throw new VisionToolkitError('config', `maxImageBytes must be an integer between 1024 and ${MAX_IMAGE_BYTES}`);
    }
    const maxImagePixels = config.maxImagePixels ?? 40000000;
    if (!Number.isInteger(maxImagePixels) || maxImagePixels < 1 || maxImagePixels > MAX_IMAGE_PIXELS) {
        throw new VisionToolkitError('config', `maxImagePixels must be an integer between 1 and ${MAX_IMAGE_PIXELS}`);
    }
    const concurrency = config.concurrency ?? 4;
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
        throw new VisionToolkitError('config', `concurrency must be an integer between 1 and ${MAX_CONCURRENCY}`);
    }
    const maxImages = config.maxImages ?? 8;
    if (!Number.isInteger(maxImages) || maxImages < 1 || maxImages > MAX_IMAGES) {
        throw new VisionToolkitError('config', `maxImages must be an integer between 1 and ${MAX_IMAGES}`);
    }
    const allowedDirs = (config.allowedDirs ?? []).map(dir => dir.trim()).filter(dir => dir.length > 0);
    const allowExtensionlessImageUrls = config.allowExtensionlessImageUrls ?? false;
    const pasteToPath = config.pasteToPath ?? true;
    let model;
    if (config.model !== undefined) {
        const provider = config.model.provider?.trim();
        const name = config.model.model?.trim();
        if (provider === undefined || provider.length === 0) {
            if (name !== undefined && name.length > 0) {
                throw new VisionToolkitError('config', 'model requires both "provider" and "model"');
            }
        }
        else if (name === undefined || name.length === 0) {
            throw new VisionToolkitError('config', 'model requires both "provider" and "model"');
        }
        else {
            const reasoningEffort = config.model.reasoningEffort?.trim();
            model = {
                provider,
                model: name,
                ...(reasoningEffort === undefined || reasoningEffort.length === 0 ? {} : { reasoningEffort }),
            };
        }
    }
    return {
        model,
        language,
        timeoutMs,
        maxImageBytes,
        maxImagePixels,
        concurrency,
        maxImages,
        allowedDirs,
        allowExtensionlessImageUrls,
        pasteToPath,
    };
}
//# sourceMappingURL=config.js.map