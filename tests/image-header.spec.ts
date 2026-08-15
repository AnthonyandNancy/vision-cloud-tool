import { describe, expect, it } from 'vitest'
import { readImageHeader, sniffFormat } from '../src/image-header.ts'

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

const GIF_1x1 = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x01, 0x00, 0x01, 0x00])

// SOI + SOF0 with height=16, width=32.
const JPEG_32x16 = Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x20, 0x03,
  0x01, 0x22, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
])

// RIFF/WEBP/VP8X with canvas width=1, height=1.
const WEBP_VP8X_1x1 = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  0x56, 0x50, 0x38, 0x58, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
])

describe('image-header', () => {
  it('sniffs PNG, GIF, JPEG, and WebP signatures', () => {
    expect(sniffFormat(new Uint8Array(TINY_PNG))).toBe('png')
    expect(sniffFormat(new Uint8Array(GIF_1x1))).toBe('gif')
    expect(sniffFormat(new Uint8Array(JPEG_32x16))).toBe('jpeg')
    expect(sniffFormat(new Uint8Array(WEBP_VP8X_1x1))).toBe('webp')
    expect(sniffFormat(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBeUndefined()
  })

  it('reads PNG dimensions', () => {
    expect(readImageHeader(new Uint8Array(TINY_PNG))).toEqual({ format: 'png', width: 1, height: 1 })
  })

  it('reads GIF dimensions', () => {
    expect(readImageHeader(new Uint8Array(GIF_1x1))).toEqual({ format: 'gif', width: 1, height: 1 })
  })

  it('reads JPEG dimensions', () => {
    expect(readImageHeader(new Uint8Array(JPEG_32x16))).toEqual({ format: 'jpeg', width: 32, height: 16 })
  })

  it('reads WebP VP8X dimensions', () => {
    expect(readImageHeader(new Uint8Array(WEBP_VP8X_1x1))).toEqual({ format: 'webp', width: 1, height: 1 })
  })

  it('rejects unknown formats', () => {
    expect(() => readImageHeader(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow('unsupported image format')
  })
})
