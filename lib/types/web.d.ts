/**
 * Optional Web-profile routes: the minimal Settings endpoint (model list, save,
 * test read) plus the paste-images route. No secrets, no health/credential
 * surface — the DSH app owns the model's endpoint and key.
 * @module dsh-vision-toolkit/web
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import { PastedImageBackend } from './paste-images.ts';
import { type VisionToolkitConfig } from './config.ts';
import type { VisionToolkitRuntime } from './runtime.ts';
/** Exact route used by the browser Settings page. */
export declare const SETTINGS_ROUTE = "/_dsh/vision-toolkit/settings";
/** One selectable model under one registered provider route. */
export interface VisionModelEntry {
    id: string;
    name: string;
    inputModalities: string[];
}
/** One provider route and its advertised models. */
export interface VisionProviderEntry {
    provider: string;
    name: string;
    models: VisionModelEntry[];
}
/** Public Settings snapshot; no credential values are possible here. */
export interface VisionToolkitSettingsSnapshot {
    schemaVersion: 1;
    writable: boolean;
    pluginVersion: string;
    enabled: boolean;
    pasteToPath: boolean;
    settings: {
        value: VisionToolkitConfig;
        revision: number;
        applies: 'live';
    };
    providers: VisionProviderEntry[];
}
/** Same-origin Settings handler. */
export declare class VisionToolkitWebBackend {
    private readonly ctx;
    private readonly runtimeSource;
    constructor(ctx: Context, runtimeSource: () => VisionToolkitRuntime | undefined);
    private providers;
    /** Build the current settings/model snapshot without secrets. */
    snapshot(): Promise<VisionToolkitSettingsSnapshot>;
    private save;
    private testRead;
    /** Handle the exact Settings route. */
    handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
}
/**
 * Attach optional Web routes whenever a webServer service is present.
 * @param ctx - plugin context owning route effects.
 * @param backend - Settings handler.
 * @param pastedImages - paste-image upload handler.
 */
export declare function installVisionToolkitWeb(ctx: Context, backend: VisionToolkitWebBackend, pastedImages: PastedImageBackend): void;
//# sourceMappingURL=web.d.ts.map