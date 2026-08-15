/**
 * Path fence for inputs: files must live in the workspace or an explicitly
 * authorized directory, resolved through realpath so symlinks cannot escape.
 * @module dsh-vision-cloud/paths
 */
/** Supported input image extensions. */
export declare const SUPPORTED_IMAGE_EXTENSIONS: readonly [".png", ".jpg", ".jpeg", ".gif", ".webp"];
/** Resolved path policy for one tool invocation. */
export interface PathPolicy {
    /** Real workspace root. */
    workspace: string;
    /** Real allowed roots: workspace plus configured extra directories. */
    allowedDirs: string[];
}
/** Whether `child` equals or lies under `parent` on the same path root. */
export declare function isWithin(parent: string, child: string): boolean;
/**
 * Build the per-invocation path policy: realpath the workspace and each
 * authorized directory. Outputs are no longer produced, so there is no
 * plugin-managed output directory.
 */
export declare function createPathPolicy(workspaceRaw: string, allowedDirs: readonly string[]): Promise<PathPolicy>;
/**
 * Validate one input image path and return its fence-checked absolute path and
 * byte size.
 * @param raw - image path, resolved against the workspace.
 * @param policy - active path fence.
 * @returns absolute path and file size.
 */
export declare function resolveInputFile(raw: string, policy: PathPolicy): Promise<{
    path: string;
    bytes: number;
}>;
//# sourceMappingURL=paths.d.ts.map