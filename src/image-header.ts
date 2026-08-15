/**
 * Pure-JS image header parsing for PNG/JPEG/GIF/WebP: magic bytes, intrinsic
 * encoded dimensions, and canonical format. Replaces Pillow probing — no full
 * decode, so no Python and no native dependencies.
 * @module dsh-vision-cloud/image-header
 */

export type ImageFormat = 'png' | 'jpeg' | 'gif' | 'webp'

export interface ImageHeader {
  format: ImageFormat
  width: number
  height: number
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let out = ''
  for (let index = start; index < start + length; index += 1) {
    out += String.fromCharCode(bytes[index] ?? 0)
  }
  return out
}

function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, false)
}

function u16le(view: DataView, offset: number): number {
  return view.getUint16(offset, true)
}

function u16be(view: DataView, offset: number): number {
  return view.getUint16(offset, false)
}

function pngHeader(view: DataView): ImageHeader {
  return { format: 'png', width: u32(view, 16), height: u32(view, 20) }
}

function gifHeader(view: DataView): ImageHeader {
  return { format: 'gif', width: u16le(view, 6), height: u16le(view, 8) }
}

function jpegHeader(view: DataView): ImageHeader {
  let offset = 2
  while (offset + 9 < view.byteLength) {
    if (view.getUint8(offset) !== 0xff) break
    const marker = view.getUint8(offset + 1)
    if (marker === 0xff) { offset += 1; continue }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { offset += 2; continue }
    const length = u16be(view, offset + 2)
    if (length < 2) break
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { format: 'jpeg', width: u16be(view, offset + 7), height: u16be(view, offset + 5) }
    }
    offset += 2 + length
  }
  throw new Error('JPEG header does not contain a start-of-frame marker')
}

function webpHeader(view: DataView): ImageHeader {
  const chunk = ascii(new Uint8Array(view.buffer, view.byteOffset, view.byteLength), 12, 4)
  if (chunk === 'VP8 ') {
    return { format: 'webp', width: u16le(view, 26) & 0x3fff, height: u16le(view, 28) & 0x3fff }
  }
  if (chunk === 'VP8L') {
    const b0 = view.getUint8(21)
    const b1 = view.getUint8(22)
    const b2 = view.getUint8(23)
    const b3 = view.getUint8(24)
    const width = 1 + (((b1 & 0x3f) << 8) | b0)
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6))
    return { format: 'webp', width, height }
  }
  if (chunk === 'VP8X') {
    const width = 1 + (view.getUint8(24) | (view.getUint8(25) << 8) | (view.getUint8(26) << 16))
    const height = 1 + (view.getUint8(27) | (view.getUint8(28) << 8) | (view.getUint8(29) << 16))
    return { format: 'webp', width, height }
  }
  throw new Error('WebP header does not contain a supported chunk')
}

/** Recognized image signature for content-vs-extension agreement. */
export function sniffFormat(bytes: Uint8Array): ImageFormat | undefined {
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  if (bytes.length >= 6 && (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a')) return 'gif'
  if (bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'webp'
  return undefined
}

/** Parse intrinsic encoded dimensions and canonical format from bytes. */
export function readImageHeader(bytes: Uint8Array): ImageHeader {
  const format = sniffFormat(bytes)
  if (format === undefined) throw new Error('unsupported image format')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  switch (format) {
    case 'png': return pngHeader(view)
    case 'gif': return gifHeader(view)
    case 'jpeg': return jpegHeader(view)
    case 'webp': return webpHeader(view)
  }
}
