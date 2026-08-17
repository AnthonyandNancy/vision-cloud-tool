/**
 * Stable error vocabulary shared by the runtime and tools.
 * @module dsh-vision-cloud/errors
 */
/** Discriminant tag for every Vision Tools failure. */
export const VISION_TOOLKIT_ERROR_CODES = [
    'config',
    'input',
    'capacity',
    'service',
    'runtime',
    'output',
    'timeout',
    'cancelled',
    'path',
];
/** Error with a stable category; safe to surface to the model. */
export class VisionToolkitError extends Error {
    code;
    constructor(code, message, options) {
        super(message, options);
        this.name = 'VisionToolkitError';
        this.code = code;
    }
}
//# sourceMappingURL=errors.js.map