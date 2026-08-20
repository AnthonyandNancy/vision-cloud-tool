import { describe, expect, it } from 'vitest'
import { normalizeDshFileReference } from '../src/file-references.ts'

describe('normalizeDshFileReference', () => {
  it.each([
    ['image.png', 'image.png'],
    ['./image.png', './image.png'],
    ['/path/image.png', '/path/image.png'],
    ['~/Pictures/image.png', '~/Pictures/image.png'],
    ['@image.png', 'image.png'],
    ['@./image.png', './image.png'],
    ['@~/Pictures/image.png', '~/Pictures/image.png'],
    ['@"image with spaces.png"', 'image with spaces.png'],
    ['@"./screenshots/foo bar.png"', './screenshots/foo bar.png'],
    ['@src/App.vue', 'src/App.vue'],
  ])('normalizes %s to a file reference', (raw, value) => {
    expect(normalizeDshFileReference(raw)).toEqual({ kind: 'file', value })
  })

  it('does not strip a structured DSH session reference into a path', () => {
    const raw = '@[session](dsh-session:abc123)'
    expect(normalizeDshFileReference(raw)).toEqual({ kind: 'session', value: raw })
  })

  it.each(['@agent', '@session', '@unknown-token'])('keeps unclassified %s plain', raw => {
    expect(normalizeDshFileReference(raw)).toEqual({ kind: 'plain', value: raw })
  })

  it('preserves ordinary paths without an @ prefix', () => {
    expect(normalizeDshFileReference('folder/image.png')).toEqual({ kind: 'file', value: 'folder/image.png' })
  })
})
