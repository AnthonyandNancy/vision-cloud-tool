/**
 * Pure per-assembly helpers: scan the live session for image inputs the
 * conversation model cannot see directly, and render the `vision_cloud_tool`
 * argument list the model must pass. No Cordis dependencies — the scanner is
 * exercised by unit tests with plain session-shaped fixtures.
 * @module dsh-vision-cloud/vision-context
 */
import type { Session } from '@deepseek-ai/dsh-session';
/** One native image attachment found in the session history. */
export interface NativeImageInput {
    id: string;
    name?: string | undefined;
    bytes?: number | undefined;
    width?: number | undefined;
    height?: number | undefined;
}
/** Every image input a text-only conversation model must route through the tool. */
export interface VisionImageInputs {
    /** Native image blocks (only visible to image-capable models). */
    attachments: NativeImageInput[];
    /** Absolute workspace paths from `[Pasted image available at absolute path: "..."]` lines. */
    paths: string[];
    /** Direct image URLs appearing in user text. */
    urls: string[];
}
export declare const EMPTY_VISION_IMAGE_INPUTS: VisionImageInputs;
/** The paste-to-path bridge marker the client writes into user text. */
export declare const PASTE_PATH_MARKER_PATTERN: RegExp;
/** Direct image URL shapes accepted by vision_cloud_tool. */
export declare const IMAGE_URL_PATTERN: RegExp;
/** How the current conversation model can consume image inputs. */
export type ConversationVisionCapability = 'image' | 'text' | 'unknown';
/**
 * Collect the image inputs present in the session's user messages. Native
 * image blocks, paste-to-path bridge markers, and direct image URLs are all
 * collected; assistant/tool echoes are skipped so the model is not pushed to
 * re-read tool output.
 */
export declare function collectImageInputs(session: Session | undefined, depth?: number): VisionImageInputs;
/**
 * Render the runtime-context block listing the exact arguments the model must
 * pass. For an image-capable model native attachments are excluded (they are
 * directly visible), leaving only path/URL inputs.
 */
export declare function renderVisionImageContext(inputs: VisionImageInputs, capability: ConversationVisionCapability): string;
//# sourceMappingURL=vision-context.d.ts.map