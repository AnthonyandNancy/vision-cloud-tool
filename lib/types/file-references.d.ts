/** DSH file/session reference normalization without filesystem side effects. */
export type DshReference = {
    kind: 'file';
    value: string;
} | {
    kind: 'session';
    value: string;
} | {
    kind: 'plain';
    value: string;
};
/**
 * Normalize one DSH reference for the vision tool.
 *
 * Normal paths remain file references. DSH's `@file` marker is removed only for
 * file-shaped values; session references and unclassified @ tokens remain
 * distinguishable so callers do not accidentally read them from disk.
 */
export declare function normalizeDshFileReference(raw: string): DshReference;
//# sourceMappingURL=file-references.d.ts.map