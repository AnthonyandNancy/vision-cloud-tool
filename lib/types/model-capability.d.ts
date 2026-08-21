/** Capability detection shared by host prompt and paste integrations. */
export type ModelCapability = 'image' | 'text' | 'unknown';
/** Resolve one model's input modality without relying on DSH release versions. */
export declare function resolveModelCapability(llm: unknown, provider: string, model: string, signal?: AbortSignal): Promise<ModelCapability>;
//# sourceMappingURL=model-capability.d.ts.map