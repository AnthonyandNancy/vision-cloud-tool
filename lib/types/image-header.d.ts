/**
 * Pure-JS image header parsing for PNG/JPEG/GIF/WebP: magic bytes, intrinsic
 * encoded dimensions, and canonical format. Replaces Pillow probing — no full
 * decode, so no Python and no native dependencies.
 * @module dsh-vision-toolkit/image-header
 */
export type ImageFormat = 'png' | 'jpeg' | 'gif' | 'webp';
export interface ImageHeader {
    format: ImageFormat;
    width: number;
    height: number;
}
/** Recognized image signature for content-vs-extension agreement. */
export declare function sniffFormat(bytes: Uint8Array): ImageFormat | undefined;
/** Parse intrinsic encoded dimensions and canonical format from bytes. */
export declare function readImageHeader(bytes: Uint8Array): ImageHeader;
//# sourceMappingURL=image-header.d.ts.map