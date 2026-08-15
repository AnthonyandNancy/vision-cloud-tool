/**
 * Path fence for inputs: files must live in the workspace or an explicitly
 * authorized directory, resolved through realpath so symlinks cannot escape.
 * @module dsh-vision-toolkit/paths
 */

import { realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { VisionToolkitError } from './errors.ts'

/** Supported input image extensions. */
export const SUPPORTED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'] as const

/** Resolved path policy for one tool invocation. */
export interface PathPolicy {
  /** Real workspace root. */
  workspace: string
  /** Real allowed roots: workspace plus configured extra directories. */
  allowedDirs: string[]
}

/** Whether `child` equals or lies under `parent` on the same path root. */
export function isWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

function expandUserHome(raw: string): string {
  if (raw === '~') return homedir()
  if (raw.startsWith('~/') || raw.startsWith(`~${sep}`)) return join(homedir(), raw.slice(2))
  return raw
}

/**
 * Build the per-invocation path policy: realpath the workspace and each
 * authorized directory. Outputs are no longer produced, so there is no
 * plugin-managed output directory.
 */
export async function createPathPolicy(
  workspaceRaw: string,
  allowedDirs: readonly string[],
): Promise<PathPolicy> {
  let workspace: string
  try {
    workspace = await realpath(expandUserHome(workspaceRaw))
  } catch (error) {
    throw new VisionToolkitError('path', `workspace is not accessible: ${workspaceRaw}`, { cause: error })
  }
  const roots = [workspace]
  for (const raw of allowedDirs) {
    const candidate = expandUserHome(raw)
    const target = isAbsolute(candidate) ? candidate : resolve(workspace, candidate)
    try {
      roots.push(await realpath(target))
    } catch (error) {
      throw new VisionToolkitError('path', `allowedDirs entry is not accessible: ${raw}`, { cause: error })
    }
  }
  return { workspace, allowedDirs: roots }
}

/**
 * Validate one input image path and return its fence-checked absolute path and
 * byte size.
 * @param raw - image path, resolved against the workspace.
 * @param policy - active path fence.
 * @returns absolute path and file size.
 */
export async function resolveInputFile(raw: string, policy: PathPolicy): Promise<{ path: string; bytes: number }> {
  const candidate = expandUserHome(raw)
  const target = isAbsolute(candidate) ? candidate : resolve(policy.workspace, candidate)
  let real: string
  try {
    real = await realpath(target)
  } catch (error) {
    throw new VisionToolkitError('input', `image not found: ${raw}`, { cause: error })
  }
  if (!policy.allowedDirs.some(root => isWithin(root, real))) {
    throw new VisionToolkitError('path', `image escapes the allowed directories: ${raw}`)
  }
  let info
  try {
    info = await stat(real)
  } catch (error) {
    throw new VisionToolkitError('input', `image is not readable: ${raw}`, { cause: error })
  }
  if (!info.isFile()) throw new VisionToolkitError('input', `image is not a regular file: ${raw}`)
  const extension = extname(real).toLowerCase()
  if (!(SUPPORTED_IMAGE_EXTENSIONS as readonly string[]).includes(extension)) {
    throw new VisionToolkitError(
      'input',
      `unsupported image format "${extension || '(none)'}"; supported: ${SUPPORTED_IMAGE_EXTENSIONS.join(', ')}`,
    )
  }
  return { path: real, bytes: info.size }
}
