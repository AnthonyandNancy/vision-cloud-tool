/**
 * DSH Vision Cloud browser plugin: a minimal Settings section (pick an app
 * model + test read) plus the paste/drop-to-path image bridge. No tool cards, no
 * artifact previews, no credentials.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
declare const en: {
    readonly nav: "Vision Cloud";
    readonly settingsTitle: "Vision Cloud";
    readonly settingsIntro: "Pick a model configured in DSH so vision_cloud_tool can read images through it.";
    readonly model: "Vision model";
    readonly modelHint: "Leave \"Off\" to keep vision_cloud_tool unregistered. Selecting a model registers the tool immediately.";
    readonly off: "Off (disabled)";
    readonly provider: "Provider";
    readonly modelName: "Model";
    readonly testRead: "Test read";
    readonly testing: "Testing…";
    readonly save: "Save and apply";
    readonly saving: "Saving…";
    readonly reload: "Reload";
    readonly saved: "Settings saved.";
    readonly readOnly: "Settings are read-only.";
    readonly advanced: "Advanced";
    readonly advancedHint: "Output language and resource limits.";
    readonly language: "Output language";
    readonly timeout: "Request timeout (ms)";
    readonly maxBytes: "Maximum image bytes";
    readonly maxPixels: "Maximum image pixels";
    readonly concurrency: "Concurrent calls per session";
    readonly maxImages: "Maximum images per call";
    readonly allowedDirs: "Additional allowed directories";
    readonly allowedDirsHint: "One path per line. The session workspace is always allowed.";
    readonly pluginVersion: "Plugin";
    readonly positiveInteger: "{field} must be a positive integer.";
    readonly testOk: "Test read succeeded.";
    readonly testFailed: "Test read failed";
    readonly noModel: "Select a vision model and save before testing.";
    readonly pasteToPath: "Paste/drop-to-path bridge";
    readonly pasteToPathHint: "Convert pasted or dropped images into workspace paths for text-only models. Leave off to keep image input native.";
    readonly reasoningEffort: "Thinking effort";
    readonly reasoningDefault: "Default (model default)";
};
type LocaleKey = keyof typeof en;
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        'vision-cloud': LocaleKey;
    }
}
interface SettingsValue {
    model?: {
        provider?: string;
        model?: string;
        reasoningEffort?: string;
    };
    language?: 'zh' | 'en';
    timeoutMs?: number;
    maxImageBytes?: number;
    maxImagePixels?: number;
    concurrency?: number;
    maxImages?: number;
    allowedDirs?: string[];
    pasteToPath?: boolean;
}
interface VisionModelEntry {
    id: string;
    name: string;
    inputModalities: string[];
    reasoningEfforts: string[];
}
interface VisionProviderEntry {
    provider: string;
    name: string;
    models: VisionModelEntry[];
}
interface SettingsSnapshot {
    schemaVersion: 1;
    writable: boolean;
    pluginVersion: string;
    enabled: boolean;
    pasteToPath: boolean;
    settings: {
        value: SettingsValue;
        revision: number;
        applies: 'live';
    };
    providers: VisionProviderEntry[];
}
interface SettingsState {
    status: 'idle' | 'loading' | 'ready' | 'error';
    snapshot?: SettingsSnapshot | undefined;
    action?: 'save' | 'test' | undefined;
    message?: string | undefined;
    error?: string | undefined;
}
/** Small external store shared by the Settings route and pushed invalidations. */
export declare class VisionSettingsController {
    private state;
    private listeners;
    private generation;
    subscribe: (listener: () => void) => (() => void);
    snapshot: () => SettingsState;
    private set;
    load(): Promise<void>;
    refreshIfLoaded(): void;
    save(value: SettingsValue, expectedRevision: number): Promise<boolean>;
    testRead(): Promise<void>;
}
/** Required client services. */
export declare const inject: string[];
/** Register the Vision Settings section and the paste/drop-to-path bridge. */
export declare function apply(ctx: ClientContext): void;
export {};
//# sourceMappingURL=index.d.ts.map