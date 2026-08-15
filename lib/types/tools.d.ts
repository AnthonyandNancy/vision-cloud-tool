/**
 * The single model-facing tool: `vision_cloud_tool`. Registered directly with
 * the DSH tool registry (no skill, no progressive exposure) exactly like the
 * modlens reference plugin. Output is the modlens v2 structured evidence plus
 * per-image and routing facts.
 * @module dsh-vision-cloud/tools
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { VisionToolkitRuntime } from './runtime.ts';
/**
 * Build the `vision_cloud_tool` definition bound to one runtime.
 * @param runtime - the live online runtime.
 * @param lifecycleSignal - plugin lifetime; aborting it cancels active calls.
 */
export declare function createVisionCloudTool(runtime: VisionToolkitRuntime, lifecycleSignal?: AbortSignal): ReturnType<typeof defineTool>;
//# sourceMappingURL=tools.d.ts.map