/** Capability detection shared by host prompt and paste integrations. */
function classify(input) {
    if (!Array.isArray(input))
        return 'unknown';
    const modalities = input.filter((value) => typeof value === 'string' && value.trim() !== '');
    if (modalities.length === 0)
        return 'unknown';
    return modalities.includes('image') ? 'image' : 'text';
}
function exactCatalogCapability(value, model) {
    if (!Array.isArray(value))
        return 'unknown';
    for (const entry of value) {
        if (typeof entry?.id !== 'string' && typeof entry?.name !== 'string')
            continue;
        if (entry.id !== model && entry.name !== model)
            continue;
        return classify(entry.inputModalities);
    }
    return 'unknown';
}
/** Resolve one model's input modality without relying on DSH release versions. */
export async function resolveModelCapability(llm, provider, model, signal) {
    if (typeof llm !== 'object' || llm === null)
        return 'unknown';
    const surface = llm;
    // Preserve the two call shapes exposed by the rc6/rc7 resolver surfaces:
    // callers without a signal use the legacy two-argument form, while callers
    // that explicitly pass an optional signal retain the three-argument form.
    const hasSignalArgument = arguments.length >= 4;
    if (typeof surface.resolveModelInfo === 'function') {
        try {
            const info = hasSignalArgument
                ? await surface.resolveModelInfo(provider, model, signal)
                : await surface.resolveModelInfo(provider, model);
            const capability = classify(info?.inputModalities);
            if (capability !== 'unknown')
                return capability;
        }
        catch {
            // Fall back to the exact catalog entry when available.
        }
    }
    if (typeof surface.listModels === 'function') {
        try {
            return exactCatalogCapability(await surface.listModels(provider), model);
        }
        catch {
            return 'unknown';
        }
    }
    return 'unknown';
}
//# sourceMappingURL=model-capability.js.map