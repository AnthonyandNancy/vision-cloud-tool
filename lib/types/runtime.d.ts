/**
 * Online vision runtime: structured requests in, modlens v2 structured results
 * out. Resolves image bytes from a workspace path, an http(s) URL, or a pasted
 * image attachment; enforces byte/pixel limits through a pure-JS header parser;
 * stores/reads images via the DSH attachment service; and reads them with the
 * DSH app's configured model through `ctx.llm.stream`.
 * @module dsh-vision-cloud/runtime
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
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
/** Minimal live-Session surface used to resolve pasted image attachments. */
export interface VisionSession {
    events?: readonly unknown[];
}
/** Shared per-call execution options. */
export interface ToolCallOptions {
    signal: AbortSignal;
    timeoutMs?: number;
    workspace: string;
    /** Session identity for the per-session concurrency cap. */
    sessionId?: string;
    /** Live Session whose message history carries pasted image attachments. */
    session?: VisionSession;
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
/** Tool input: any mix of paths/URLs and pasted attachment ids. */
export interface VisionCloudRequest {
    images: string[];
    attachments: string[];
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
/**
 * Find a pasted image attachment's full reference in the session history.
 * Recursively scans `data.content`, `data.message.content`, nested
 * `tool-result` blocks and other wrappers so attachments do not go missing
 * when a host version nests message content one level deeper.
 */
export declare function findImageRef(session: VisionSession | undefined, attachmentId: string): ImageAttachmentRef | undefined;
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
    private resolveAttachmentBytes;
    private readBytes;
    private streamRead;
    /** Read one or more images (paths/URLs/attachments) through the app model. */
    read(request: VisionCloudRequest, prompt: string | undefined, options: ToolCallOptions): Promise<VisionCloudResult>;
    /** One tiny real read used by the Settings "test read" action. */
    selfTest(options: ToolCallOptions): Promise<VisionCloudResult>;
}
//# sourceMappingURL=runtime.d.ts.map