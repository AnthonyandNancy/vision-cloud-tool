/**
 * Online vision runtime: structured requests in, modlens v2 structured results
 * out. Resolves image bytes (path or URL), enforces byte/pixel limits through a
 * pure-JS header parser, stores images via the DSH attachment service, and
 * reads them with the DSH app's configured model through `ctx.llm.stream`.
 * @module dsh-vision-toolkit/runtime
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ResolvedVisionToolkitConfig } from './config.ts';
import { type VisionResult } from './vision-schema.ts';
/** Validated image metadata retained in structured results and diagnostics. */
export interface ImageInfo {
    path: string;
    bytes: number;
    width: number;
    height: number;
    format: string;
}
/** Shared per-call execution options. */
export interface ToolCallOptions {
    signal: AbortSignal;
    timeoutMs?: number;
    workspace: string;
    /** Session identity for the per-session concurrency cap. */
    sessionId?: string;
}
/** Per-call routing and accounting facts. */
export interface VisionMeta {
    model: string;
    durationSeconds: number;
    attempts: number;
    warnings: string[];
}
/** The full tool result: modlens v2 evidence plus image and routing facts. */
export interface VisionCloudResult {
    images: ImageInfo[];
    result: VisionResult;
    meta: VisionMeta;
}
/** Per-invocation cancellation and timeout facts. */
export interface Deadline {
    signal: AbortSignal;
    timedOut: boolean;
    cancelled: boolean;
    cleanup(): void;
}
/** Combine a caller abort signal with one hard operation timeout. */
export declare function createDeadline(signal: AbortSignal, timeoutMs: number): Deadline;
/** FIFO bounded concurrency gate whose queued callers remain cancellable. */
export declare class Semaphore {
    private readonly limit;
    private active;
    private readonly waiters;
    constructor(limit: number);
    get idle(): boolean;
    acquire(signal: AbortSignal): Promise<void>;
    release(): void;
}
/** Runtime facade used by the `vision_cloud_tool` and the Settings self-test. */
export declare class VisionToolkitRuntime {
    private readonly ctx;
    private readonly config;
    private readonly semaphores;
    constructor(ctx: Context, config: ResolvedVisionToolkitConfig);
    /** The selected app model, when the tool is enabled. */
    get model(): {
        provider: string;
        model: string;
    } | undefined;
    private timeout;
    private semaphore;
    private run;
    private readBytes;
    private streamRead;
    /** Read one or more images through the app's configured model. */
    read(images: readonly string[], prompt: string | undefined, options: ToolCallOptions): Promise<VisionCloudResult>;
    /** One tiny real read used by the Settings "test read" action. */
    selfTest(options: ToolCallOptions): Promise<VisionCloudResult>;
}
//# sourceMappingURL=runtime.d.ts.map