/**
 * @anionex/dsh-vision-cloud — online-only vision plugin.
 *
 * Registers a single `vision_cloud_tool` only when a vision model is selected
 * in Settings (default off). The tool reads images through the DSH app's
 * configured model via `ctx.llm` and returns modlens v2 structured evidence.
 * No Python, no local tools, no credential or endpoint configuration.
 * @module @anionex/dsh-vision-cloud
 */
import type { Context } from '@deepseek-ai/cordis';
import { Config, type VisionToolkitConfig } from './config.ts';
export declare const name = "@anionex/dsh-vision-cloud";
export { Config };
export declare const inject: string[];
/** Plugin entry: validate configuration, then mount the tool when enabled. */
export declare function apply(ctx: Context, config?: VisionToolkitConfig): () => void;
//# sourceMappingURL=index.d.ts.map