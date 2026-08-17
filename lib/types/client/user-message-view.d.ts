/**
 * Shadow user/steering chat-node renderer (方案2).
 *
 * DSH renders the lowest-priority live entry of a keyed slot cell, so this
 * component is registered for the `user` and `steering` keys of
 * `conversation.chat.node` at priority -1 while the product registers the
 * same keys at priority 0. While the plugin runs this view replaces the
 * product's UserMessageNodeView; disposing the registration (or the slot
 * runtime abdicating this entry after a render error) restores it.
 *
 * Two duties:
 * 1. Reproduce the product's user bubble — image gallery for native image
 *    blocks (`loadImage`), plain-text bubble with `/skill` / `@agent` chips,
 *    JsonBlock extras, and the copy/time action row — so multimodal sessions
 *    look exactly like the default provider pipeline.
 * 2. Interpret the paste-to-path bridge's model-facing markers
 *    (`[Pasted image available at absolute path: "..."]` lines and
 *    `![name](</_dsh/vision-cloud/paste-images/file?...>)` links) as real
 *    image tiles and strip that markup from the visible text. The model still
 *    receives the full path text; only the rendering above it changes.
 */
import { type ReactNode } from 'react';
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client';
export declare const BRIDGE_FILE_PREFIX = "/_dsh/vision-cloud/paste-images/file";
export interface PastedBridgeImage {
    /** Session-authorized read-only file route (GET). */
    url: string;
    /** Image label captured from the bridge's markdown alt text. */
    alt: string;
}
export interface NativeAttachmentView {
    attachmentId?: unknown;
    mediaType?: unknown;
    name?: string | undefined;
    width?: number | undefined;
    height?: number | undefined;
    bytes?: number | undefined;
}
export interface SplitContent {
    /** All text blocks joined in source order. */
    text: string;
    /** Native `type:'image'` blocks. */
    images: NativeAttachmentView[];
    /** Blocks that are neither text nor images (rendered as JsonBlock). */
    rest: unknown[];
}
export interface ImageFit {
    width: number;
    height: number;
    objectPosition: 'center' | 'center top' | 'left center';
}
/**
 * Strip the paste-to-path bridge's model-facing markers from a message text
 * and collect the embedded image route. Non-bridge markdown images are left
 * untouched (user bubbles render plain text, like the product does).
 */
export declare function extractBridgeMarkup(text: string): {
    text: string;
    images: PastedBridgeImage[];
};
/** Split message content into the parts the product bubble renders. */
export declare function splitContent(content: readonly unknown[]): SplitContent;
/**
 * DeepSeek Chat lone-image box: long edge 240px, rendered aspect clamped to
 * [0.25, 4] with `object-fit: cover`, never upscaled past the natural size.
 */
export declare function singleFit(width: number, height: number): ImageFit;
/** Body-portal original-image preview; closes on Escape or backdrop press. Shared by chat bubbles and the composer paste rail. */
export declare function ImageLightbox(props: {
    src: string;
    alt: string;
    dialog: string;
    close: string;
    onClose: () => void;
}): ReactNode;
/**
 * Priority -1 shadow of the product's keyed `user` / `steering` chat-node
 * views. Props are the framework's composed slot props (node, loadImage, t,
 * session kit). A render error here abdicates the entry, handily restoring
 * the product view instead of leaving an empty row.
 */
export declare const UserMessageNodeShadow: import("react").MemoExoticComponent<(props: ChatNodeViewProps) => ReactNode>;
/**
 * Slot-safe wrapper around the shadow error boundary. The slot registry
 * accepts function components most reliably, so this memoized function is what
 * gets registered for the `user` / `steering` chat-node keys.
 */
export declare const UserMessageShadowBoundary: import("react").MemoExoticComponent<(props: ChatNodeViewProps) => ReactNode>;
//# sourceMappingURL=user-message-view.d.ts.map