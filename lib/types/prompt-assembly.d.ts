/**
 * Post-waterfall prompt enrichment for `system-prompt/assemble`. The listener
 * runs after every other listener (including the agent's model selection), so
 * `assembled.variables.provider/model` and the final `assembled.tools` are
 * authoritative here.
 *
 * Hard gate: when `vision_cloud_tool` is not in `assembled.tools` for this
 * scope (agent preset allow/deny restrictions, code-mode collapse to
 * `run_code`, tool-order filtering, or scoped shadowing), the assembly is
 * returned exactly as built — no section, no context, no model lookup. Agent
 * presets that disallow tools are therefore never affected.
 * @module dsh-vision-cloud/prompt-assembly
 */
import type { Context } from '@deepseek-ai/cordis';
import type { AssembleContext, PromptAssembly } from '@deepseek-ai/dsh-system-prompt';
/** Whether the tool is visible for one scope through the registry (ignores presentation collapse). */
export declare function isVisionToolVisible(ctx: Context, scope: object | undefined): boolean;
/**
 * Enrich (or prune) one assembled prompt for the current scope. Mutates and
 * returns `assembled` — the waterfall contract makes the returned value
 * authoritative.
 */
export declare function applyVisionPromptEnrichment(ctx: Context, assembled: PromptAssembly, context: AssembleContext): Promise<PromptAssembly>;
//# sourceMappingURL=prompt-assembly.d.ts.map