/** Workspace-local storage for images pasted into the DSH Web composer. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
/** Exact route used by the browser paste integration. */
export declare const PASTE_IMAGES_ROUTE = "/_dsh/vision-cloud/paste-images";
/** Read-only route that serves bridged images back to their owning session. */
export declare const PASTE_IMAGE_FILE_ROUTE = "/_dsh/vision-cloud/paste-images/file";
/** Convert an untrusted browser label into one portable leaf filename. */
export declare function safePastedImageName(raw: string, mediaType: string): string;
/**
 * Derive the final content-addressed leaf for one pasted image.
 * Meaningful original stems keep a readable suffix (`<hash>-login-page.png`);
 * generic placeholders such as `image.png` collapse to pure `<hash>.png`.
 * The extension follows the declared media type when it maps to a known
 * format, falling back to the sanitized browser-label extension otherwise.
 */
export declare function hashedPastedImageName(raw: string, mediaType: string, digest: string): string;
/** Reject a resolved path that is not rooted below the expected directory. */
export declare function ensurePathInside(root: string, target: string): void;
/** Runtime limit face kept separate for focused backend tests. */
export interface PasteImageRuntime {
    maxImageBytes(): number;
    pasteToPath(): boolean;
}
/** Same-origin, live-Session-bound image upload endpoint. */
export declare class PastedImageBackend {
    private readonly ctx;
    private readonly runtime;
    constructor(ctx: Context, runtime: PasteImageRuntime);
    /**
     * Whether the model behind a selector label is text-only (and therefore
     * needs a paste-to-path takeover). A match that declares image input vetoes
     * the takeover, so a multimodal model keeps its native paste.
     *
     * Priority (freshest signal first):
     * 1. The explicit provider/model pair sent by the client (from the live
     *    model-selection store) — freshest, and authoritative via
     *    `resolveModelInfo()` even for pi-ai dynamic routes.
     * 2. A definite catalog answer for the selector label — the composer label
     *    reflects the UI selection NOW, while `requestContext()` only reflects
     *    the last request/context event (stale until the next send).
     * 3. The live session's exact provider/model — last resort for custom
     *    models whose label matches nothing in the advisory catalog.
     * 4. No model information at all → leave the paste native.
     */
    private takeoverVerdict;
    /**
     * Scan the advisory model catalog for a model named by the selector label.
     * Returns a definite verdict only when the label matches a catalog entry
     * (image-capable → native, otherwise → takeover); `undefined` when the
     * label matches nothing (custom/pi-ai dynamic models are often absent).
     */
    private catalogScan;
    /** Read the exact provider/model from a live Session when one is available. */
    private currentModelFromSession;
    /**
     * Decide takeover for an exact provider/model. Explicit image input keeps the
     * native paste/drop path; anything else (text-only, absent capability, or a
     * resolution failure) falls back to the paste-to-path bridge.
     */
    private takeoverForExact;
    /**
     * Serve one bridged image back to its owning session (read-only, same-origin
     * inline display). The filename must be a single leaf within the session's
     * managed paste root; symlinks and escapes are re-resolved and rejected.
     */
    private handleImageFile;
    handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
}
//# sourceMappingURL=paste-images.d.ts.map