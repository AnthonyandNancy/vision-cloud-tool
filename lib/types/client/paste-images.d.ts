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
    constructor(ctx: ClientContext);
    subscribe: (listener: () => void) => (() => void);
    snapshot: () => number;
    private changed;
    private readonly VERDICT_MAX_AGE_MS;
    private verdicts;
    private routeAvailable;
    /** Best-effort current model selector label (the host owns the real verdict). */
    private currentModelLabel;
    private refreshVerdict;
    /** Take over paste/drop only when the host confirmed a text-only model. */
    private shouldTakeover;
    /** Prefetch the paste/drop takeover verdict (called on composer focus/drag enter). */
    prefetch(): void;
    source(): InputTriggerSource;
    recordsFor(occurrences: readonly PasteOccurrence[]): PasteRecord[];
    private inputFor;
    private insertText;
    private insertRecords;
    handlePaste(event: ClipboardEvent): boolean;
    handleDrop(event: DragEvent): boolean;
    remove(sessionId: string, occurrence: PasteOccurrence): void;
    private upload;
    private serialize;
}
/** Minimal per-image progress, failure, and removal feedback above the composer. */
export declare function PasteImageDock(props: PasteDockProps): ReactNode;
/** Install capture interception, the text-reference codec, and composer feedback. */
export declare function installPasteImages(ctx: ClientContext): void;
export {};
//# sourceMappingURL=paste-images.d.ts.map