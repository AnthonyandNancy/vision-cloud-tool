/**
 * Stable error vocabulary shared by the runtime and tools.
 * @module dsh-vision-cloud/errors
 */
/** Discriminant tag for every Vision Tools failure. */
export declare const VISION_TOOLKIT_ERROR_CODES: readonly ["config", "input", "capacity", "service", "runtime", "output", "timeout", "cancelled", "path"];
/** Stable machine-readable error category. */
export type VisionToolkitErrorCode = typeof VISION_TOOLKIT_ERROR_CODES[number];
/** Error with a stable category; safe to surface to the model. */
export declare class VisionToolkitError extends Error {
    readonly code: VisionToolkitErrorCode;
    constructor(code: VisionToolkitErrorCode, message: string, options?: {
        cause?: unknown;
    });
}
//# sourceMappingURL=errors.d.ts.map