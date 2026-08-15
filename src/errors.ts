/**
 * Stable error vocabulary shared by the runtime and tools.
 * @module dsh-vision-toolkit/errors
 */

/** Discriminant tag for every Vision Toolkit failure. */
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
] as const

/** Stable machine-readable error category. */
export type VisionToolkitErrorCode = typeof VISION_TOOLKIT_ERROR_CODES[number]

/** Error with a stable category; safe to surface to the model. */
export class VisionToolkitError extends Error {
  readonly code: VisionToolkitErrorCode

  constructor(code: VisionToolkitErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'VisionToolkitError'
    this.code = code
  }
}
