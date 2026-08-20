/** DSH file/session reference normalization without filesystem side effects. */

export type DshReference =
  | { kind: 'file'; value: string }
  | { kind: 'session'; value: string }
  | { kind: 'plain'; value: string }

/** Structured Harness session references must be classified before stripping `@`. */
const SESSION_REFERENCE_PATTERN = /^@\[[\s\S]*\]\(dsh-session:[^)]+\)$/u
const QUOTED_FILE_PATTERN = /^@"([\s\S]*)"$/u
const PATH_PREFIX_PATTERN = /^(?:\.{1,2}[\\/]|~[\\/]|[\\/]|[A-Za-z]:[\\/])/u
const FILE_EXTENSION_PATTERN = /\.[A-Za-z0-9]{1,32}(?:[?#][\s\S]*)?$/u

function looksLikeFileReference(value: string): boolean {
  return PATH_PREFIX_PATTERN.test(value)
    || value.includes('/')
    || value.includes('\\')
    || FILE_EXTENSION_PATTERN.test(value)
}

/**
 * Normalize one DSH reference for the vision tool.
 *
 * Normal paths remain file references. DSH's `@file` marker is removed only for
 * file-shaped values; session references and unclassified @ tokens remain
 * distinguishable so callers do not accidentally read them from disk.
 */
export function normalizeDshFileReference(raw: string): DshReference {
  const value = raw.trim()
  if (SESSION_REFERENCE_PATTERN.test(value)) return { kind: 'session', value }
  if (!value.startsWith('@')) return { kind: 'file', value }

  const quoted = value.match(QUOTED_FILE_PATTERN)
  if (quoted !== null) {
    const inner = quoted[1] ?? ''
    if (inner === '') return { kind: 'plain', value }
    return { kind: 'file', value: inner.replace(/\\"/gu, '"') }
  }

  const unprefixed = value.slice(1)
  if (unprefixed !== '' && looksLikeFileReference(unprefixed)) {
    return { kind: 'file', value: unprefixed }
  }
  return { kind: 'plain', value }
}
