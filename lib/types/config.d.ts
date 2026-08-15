/**
 * Plugin configuration: an optional app-model selection, output language, and
 * limits. There are no secrets and no provider endpoints here — the DSH app
 * owns the configured model's URL and key.
 * @module dsh-vision-cloud/config
 */
import type Schema from '@deepseek-ai/schemastery';
/** Settings document namespace owned by this plugin. */
export declare const VISION_TOOLKIT_SETTINGS_NAMESPACE: import("@deepseek-ai/dsh-settings").SettingsNamespace;
/** Full user-facing configuration; every limit defaults at the schema boundary. */
export interface VisionToolkitConfig {
    /** Selected app model; absent (or empty) means the tool is not registered. */
    model?: {
        provider?: string;
        model?: string;
        /** Optional reasoning effort id for this model (empty = model default). */
        reasoningEffort?: string;
    };
    /** Vision output language (`zh` or `en`). */
    language?: 'zh' | 'en';
    /** Whole-operation deadline in milliseconds. */
    timeoutMs?: number;
    /** Encoded-byte limit per input image. */
    maxImageBytes?: number;
    /** Decoded-pixel limit per input image. */
    maxImagePixels?: number;
    /** In-flight tool execution cap per session. */
    concurrency?: number;
    /** Maximum images accepted per call. */
    maxImages?: number;
    /** Extra directories (besides the workspace) inputs may come from. */
    allowedDirs?: string[];
    /**
     * Allow http(s) image URLs whose path has no image extension (e.g. signed
     * CDN URLs). Off by default so arbitrary API/web URLs are rejected before
     * any network request; even when enabled, Content-Type and magic bytes are
     * still enforced.
     */
    allowExtensionlessImageUrls?: boolean;
    /** Paste/drop-to-path bridge: convert pasted or dropped images to workspace paths for text-only models. */
    pasteToPath?: boolean;
}
/** Configuration schema with documented defaults. */
export declare const Config: Schema<VisionToolkitConfig>;
/** Configuration after static validation, with every default materialized. */
export interface ResolvedVisionToolkitConfig {
    model: {
        provider: string;
        model: string;
        reasoningEffort?: string;
    } | undefined;
    language: 'zh' | 'en';
    timeoutMs: number;
    maxImageBytes: number;
    maxImagePixels: number;
    concurrency: number;
    maxImages: number;
    allowedDirs: string[];
    allowExtensionlessImageUrls: boolean;
    pasteToPath: boolean;
}
/**
 * Validate and normalize a config object (partial inputs receive the same
 * defaults the schemastery schema applies). A half-set `model` fails loud; an
 * absent or fully-empty `model` means the tool stays unregistered.
 */
export declare function resolveConfig(config?: VisionToolkitConfig): ResolvedVisionToolkitConfig;
//# sourceMappingURL=config.d.ts.map