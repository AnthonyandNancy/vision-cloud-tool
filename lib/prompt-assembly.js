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
import { VISION_IMAGE_CONTEXT_NAME, VISION_TOOL_NAME, VISION_TOOL_SECTION_NAME, visionToolSectionText } from "./system-prompt.js";
import { resolveModelCapability } from "./model-capability.js";
import { collectImageInputs, EMPTY_VISION_IMAGE_INPUTS, renderVisionImageContext, } from "./vision-context.js";
/** Whether the tool is visible for one scope through the registry (ignores presentation collapse). */
export function isVisionToolVisible(ctx, scope) {
    try {
        const definition = scope === undefined
            ? ctx.tools.get(VISION_TOOL_NAME)
            : ctx.tools.get(VISION_TOOL_NAME, scope);
        return definition !== undefined;
    }
    catch {
        return false;
    }
}
/** The tool schema list for one assembly, before any post-waterfall mutation. */
function hasNativeVisionTool(assembled) {
    return assembled.tools.some(tool => tool.name === VISION_TOOL_NAME);
}
function removeVisionContributions(assembled) {
    assembled.tools = assembled.tools.filter(tool => tool.name !== VISION_TOOL_NAME);
    const sectionIndex = assembled.sections.findIndex(section => section.name === VISION_TOOL_SECTION_NAME);
    if (sectionIndex >= 0)
        assembled.sections.splice(sectionIndex, 1);
    const contextIndex = assembled.contexts.findIndex(context => context.name === VISION_IMAGE_CONTEXT_NAME);
    if (contextIndex >= 0)
        assembled.contexts.splice(contextIndex, 1);
}
function conversationModel(assembled) {
    const provider = assembled.variables.provider;
    const model = assembled.variables.model;
    if (provider === undefined || provider === '' || model === undefined || model === '')
        return undefined;
    return { provider, model };
}
/** Resolve the current conversation model's image capability; failures fall back to model-agnostic. */
async function resolveCapability(ctx, assembled, signal) {
    const selected = conversationModel(assembled);
    if (selected === undefined)
        return 'unknown';
    return resolveModelCapability(ctx.llm, selected.provider, selected.model, signal);
}
/** Inputs the model still needs the tool for: an image-capable model skips native blocks it can see. */
function routeInputs(inputs, capability) {
    if (capability !== 'image')
        return inputs;
    return { attachments: [], paths: inputs.paths, urls: inputs.urls };
}
/**
 * Enrich (or prune) one assembled prompt for the current scope. Mutates and
 * returns `assembled` — the waterfall contract makes the returned value
 * authoritative.
 */
export async function applyVisionPromptEnrichment(ctx, assembled, context) {
    if (!hasNativeVisionTool(assembled)) {
        removeVisionContributions(assembled);
        return assembled;
    }
    const capability = await resolveCapability(ctx, assembled, context.signal);
    const agent = context.agent;
    const session = agent?.session;
    const inputs = session === undefined ? structuredClone(EMPTY_VISION_IMAGE_INPUTS) : collectImageInputs(session);
    if (capability === 'image'
        && inputs.attachments.length > 0
        && inputs.paths.length === 0
        && inputs.urls.length === 0) {
        removeVisionContributions(assembled);
        return assembled;
    }
    const routable = routeInputs(inputs, capability);
    const sectionIndex = assembled.sections.findIndex(section => section.name === VISION_TOOL_SECTION_NAME);
    if (sectionIndex >= 0) {
        assembled.sections[sectionIndex].text = visionToolSectionText(capability);
    }
    else {
        assembled.sections.push({ name: VISION_TOOL_SECTION_NAME, text: visionToolSectionText(capability) });
    }
    const contextText = renderVisionImageContext(routable, capability);
    const contextIndex = assembled.contexts.findIndex(item => item.name === VISION_IMAGE_CONTEXT_NAME);
    if (contextText === '') {
        if (contextIndex >= 0)
            assembled.contexts.splice(contextIndex, 1);
    }
    else if (contextIndex >= 0) {
        assembled.contexts[contextIndex].text = contextText;
    }
    else {
        assembled.contexts.push({ name: VISION_IMAGE_CONTEXT_NAME, text: contextText });
    }
    return assembled;
}
//# sourceMappingURL=prompt-assembly.js.map