/** Clipboard and drag-and-drop multi-image input for DSH Web. */
import { type ReactNode } from 'react';
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
export declare const PASTE_IMAGES_ROUTE = "/_dsh/vision-cloud/paste-images";
interface PasteRecord {
    ref: string;
    file: File;
    batch: PasteBatch;
    status: 'ready' | 'copying' | 'copied' | 'error';
    error?: string | undefined;
    absolutePath?: string | undefined;
    /** Final server-derived leaf (SHA-256 addressed after upload), if saved. */
    filename?: string | undefined;
}
interface PasteBatch {
    sessionId: string;
    records: PasteRecord[];
    inflight?: Promise<void> | undefined;
    unsubscribe?: (() => void) | undefined;
}
interface PasteOccurrence {
    occurrenceId: number;
    source: string;
    ref: string;
    offset: number;
    label: string;
}
type PasteDockProps = PropsRuntime<'conversation.input.dock'> & {
    controller: PasteImageController;
    remove: (occurrence: PasteOccurrence) => void;
};
/** Owns browser File objects until DSH serializes the corresponding text references. */
export declare class PasteImageController {
    private readonly ctx;
    private readonly records;
    private readonly listeners;
    private revision;
    /** Draft ids shown in the host's native in-card attachment rail for bridge records. */
    private readonly nativePreviews;
    private readonly previewUnsubscribes;
    private readonly submitGuards;
    constructor(ctx: ClientContext);
    subscribe: (listener: () => void) => (() => void);
    snapshot: () => number;
    private changed;
    private readonly VERDICT_MAX_AGE_MS;
    private readonly VERDICT_RETRY_MS;
    private verdicts;
    private routeAvailable;
    private routeRetryAt;
    private replaying;
    private lastBridgeNoticeAt;
    private readonly subscribedDirectories;
    private readonly reconciliations;
    /** Best-effort current model selector label (used only without modelDirectories). */
    private currentModelLabel;
    private modelDirectoriesService;
    /**
     * The composer's current model selection, freshest source first:
     * the live model-selection store (exact provider/model) followed by the
     * DOM selector label as a legacy fallback (subagent sessions throw here).
     */
    private currentPick;
    /** Flush cached verdicts and prefetch on selection changes (one per session). */
    private subscribeDirectory;
    private flushVerdicts;
    private verdictKey;
    /**
     * Fetch the takeover verdict for one selection. Resolves the effective
     * takeover (`true` = bridge, `false` = native) or `undefined` when the
     * verdict could not be obtained (fetch failure, route down, rate-limited
     * retry window) — callers then apply the text-safe bridge fallback (GA20).
     */
    private refreshVerdict;
    /**
     * Cached takeover for the current selection: `true`/`false` only for a
     * fresh verdict; `undefined` (or a stale/empty signal) leaves the event
     * held for the async decide-then-act flow.
     */
    private syncTakeover;
    /** Prefetch the paste/drop takeover verdict (called on composer focus/drag enter). */
    prefetch(): void;
    /**
     * One-way draft reconciliation: when the selected model becomes text-only
     * and the draft still carries native image ids from a multimodal paste,
     * convert those images to bridge references before the host rejects the
     * next send. No destructive fallback: if the verdict is unknown the draft
     * stays exactly as the user left it.
     */
    private reconcileDraftMedia;
    private conversationDraftService;
    /** Copy a draft File's bytes so they survive the host releasing the draft image. */
    private cloneDraftFile;
    private sameImageIds;
    private bridgeNativeDraft;
    source(): InputTriggerSource;
    recordsFor(occurrences: readonly PasteOccurrence[]): PasteRecord[];
    private inputFor;
    private insertText;
    /** One batch's cleanup: drop records once every occurrence referencing them is gone. */
    private bindBatchCleanup;
    /**
     * Insert object references for resolved records at `cursor`. `owned` lists
     * the records created by THIS insertion (rolled back and dropped on
     * failure); records reused from earlier uploads survive a failed insert.
     */
    private insertExistingRefs;
    private insertRecords;
    /** Whether a bridge record already has a resident native input-card preview. */
    private hasNativePreview;
    /**
     * Remove one native preview attachment without interpreting the removal as
     * an intentional bridge-record deletion (bookkeeping is already detached).
     */
    private detachNativePreview;
    /**
     * Drop display-only native preview ids immediately before the host snapshots
     * imageIds for a submit. The bridge occurrences stay untouched: they carry
     * the prompt the text-only model can actually read.
     */
    private dropNativePreviews;
    /**
     * Patch the host's single submit entry for a session shell. Both the
     * composer send control (shell.actions.submit) and the public facade
     * (ctx.conversation.input.for(...).submit) resolve through this method.
     */
    private armNativePreviewSubmit;
    /** Remove the bridge occurrence for one ref (native preview was removed). */
    private removeBridgeOccurrence;
    /**
     * Reconcile resident native previews with input state. A preview survives
     * only while its bridge occurrence AND image id are alive. If the user
     * removed it from the native rail, remove the bridge occurrence; if the
     * prompt was sent (occurrence gone), release the leftover preview draft.
     */
    private reconcileNativePreviews;
    private bindNativePreviewRemoval;
    /**
     * Show bridge records in the host's native in-card attachment rail. This is
     * display-only for text models: the submit guard removes these ids before
     * serialization, while the bridge path text remains the model payload.
     * Falls back to the plugin rail above the composer when the draft-image API
     * is unavailable (e.g. older harness builds).
     */
    private admitNativePreviews;
    /** Rail records not already represented by a native in-card preview. */
    recordsForDock(occurrences: readonly PasteOccurrence[]): PasteRecord[];
    /**
     * Insert the held paste through the paste-to-path bridge. Shared by the
     * cached-true fast path and the async hold-and-decide settle (GA3).
     */
    private finishBridge;
    /**
     * Bridge a held payload that may mix files with bridge-route URL text
     * (dragging a bridged tile: DSH materializes the image as a File and puts
     * its file-route URL into the drag text). The text is sanitized HERE so
     * the URL never reaches the draft; when the payload comes down to one
     * file whose URL names an upload this tab still owns, that record is
     * reused instead of uploading a duplicate copy (agentHome b98c935b,
     * 2026-08-16).
     */
    private finishPayload;
    /** Notify once per retry window that the bridge is unreachable (GA20). */
    private notifyBridgeDown;
    /**
     * Release the held event natively for a confirmed multimodal model.
     * Preferred: the conversation service's public image-draft API so the
     * attachment rail updates exactly like a trusted paste (GA21). Fallback:
     * one untrusted synthetic replay of the same event (guarded against
     * reentrancy); this degrades silently if the app gates on isTrusted.
     */
    private releaseNatively;
    private settlePaste;
    handlePaste(event: ClipboardEvent): boolean;
    handleDrop(event: DragEvent): boolean;
    remove(sessionId: string, occurrence: PasteOccurrence): void;
    /** A same-tab record whose uploaded workspace file is the dropped one. */
    private findUploadedRecord;
    /** Download one bridged image back over the session-authorized file route. */
    private fetchBridgeFile;
    /**
     * Re-materialize bridge file-route URLs as text-safe references: reuse a
     * same-tab uploaded record, otherwise download the bytes and treat them as
     * a fresh File (the ordinary bridge copies it at serialize time). The
     * dropped URL text itself is NEVER written into the draft.
     */
    private bridgeDroppedRefs;
    /** Multimodal verdict: give the model a real image block, not path text. */
    private materializeNativeDroppedRefs;
    /** Held URL payload: verdict false → native block; true/unavailable → bridge. */
    private settleDroppedRefs;
    private upload;
    private serialize;
}
/**
 * Fallback preview rail above the composer. Bridged images normally render in
 * the host’s native in-card attachment rail; this surface remains for copies,
 * errors, and harness builds whose guest input has no draft-image API.
 */
export declare function PasteImageDock(props: PasteDockProps): ReactNode;
/** Install capture interception, the text-reference codec, and composer feedback. */
export declare function installPasteImages(ctx: ClientContext): void;
export {};
//# sourceMappingURL=paste-images.d.ts.map