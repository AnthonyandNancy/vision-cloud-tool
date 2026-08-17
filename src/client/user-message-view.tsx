/**
 * Shadow user/steering chat-node renderer (方案2).
 *
 * DSH renders the lowest-priority live entry of a keyed slot cell, so this
 * component is registered for the `user` and `steering` keys of
 * `conversation.chat.node` at priority -1 while the product registers the
 * same keys at priority 0. While the plugin runs this view replaces the
 * product's UserMessageNodeView; disposing the registration (or the slot
 * runtime abdicating this entry after a render error) restores it.
 *
 * Two duties:
 * 1. Reproduce the product's user bubble — image gallery for native image
 *    blocks (`loadImage`), plain-text bubble with `/skill` / `@agent` chips,
 *    JsonBlock extras, and the copy/time action row — so multimodal sessions
 *    look exactly like the default provider pipeline.
 * 2. Interpret the paste-to-path bridge's model-facing markers
 *    (`[Pasted image available at absolute path: "..."]` lines and
 *    `![name](</_dsh/vision-cloud/paste-images/file?...>)` links) as real
 *    image tiles and strip that markup from the visible text. The model still
 *    receives the full path text; only the rendering above it changes.
 */

import { createPortal } from 'react-dom'
import { Component, memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  IconCheckOutline16,
  IconCloseOutline16,
  IconCopyOutline16,
  JsonBlock,
  MessageText,
  Tooltip,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

export const BRIDGE_FILE_PREFIX = '/_dsh/vision-cloud/paste-images/file'

export interface PastedBridgeImage {
  /** Session-authorized read-only file route (GET). */
  url: string
  /** Image label captured from the bridge's markdown alt text. */
  alt: string
}

export interface NativeAttachmentView {
  attachmentId?: unknown
  mediaType?: unknown
  name?: string | undefined
  width?: number | undefined
  height?: number | undefined
  bytes?: number | undefined
}

export interface SplitContent {
  /** All text blocks joined in source order. */
  text: string
  /** Native `type:'image'` blocks. */
  images: NativeAttachmentView[]
  /** Blocks that are neither text nor images (rendered as JsonBlock). */
  rest: unknown[]
}

export interface ImageFit {
  width: number
  height: number
  objectPosition: 'center' | 'center top' | 'left center'
}

const BRIDGE_PATH_RE = /\[Pasted image available at absolute path: "[^"]*"\]/gu
const BRIDGE_IMAGE_RE = /!\[([^\]]*)\]\(<([^)]+)>\)/gu
const CHIP_RE = /(^|\s)([/@][\w-]+)(?=\s|$)/gu
const FALLBACK_LABELS = {
  copy: '复制',
  copied: '已复制',
  image: '图片',
  open: '查看原图',
  loading: '图片加载中…',
  loadFailed: '图片加载失败，点击重试',
  preview: '图片预览',
  closePreview: '关闭预览',
  extra: '附加内容',
} as const
type ShadowTranslate = (key: string, params?: Record<string, unknown>) => string

function translate(t: ShadowTranslate | undefined, key: string, params?: Record<string, unknown>): string {
  if (typeof t === 'function') {
    try {
      const value = t(key, params)
      if (typeof value === 'string' && value !== '') return value
    } catch {
      // Fall through to the built-in label.
    }
  }
  const fallback = FALLBACK_LABELS[key as keyof typeof FALLBACK_LABELS]
  return fallback ?? key
}

/**
 * Strip the paste-to-path bridge's model-facing markers from a message text
 * and collect the embedded image route. Non-bridge markdown images are left
 * untouched (user bubbles render plain text, like the product does).
 */
export function extractBridgeMarkup(text: string): { text: string; images: PastedBridgeImage[] } {
  if (text === '') return { text: '', images: [] }
  const images: PastedBridgeImage[] = []
  const cleaned = text
    .replace(BRIDGE_PATH_RE, '')
    .replace(BRIDGE_IMAGE_RE, (whole: string, alt: string, url: string) => {
      if (!url.startsWith(BRIDGE_FILE_PREFIX) && url !== BRIDGE_FILE_PREFIX) return whole
      images.push({ url, alt: alt.trim() })
      return ''
    })
  const collapsed = cleaned.trim()
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
  return { text: collapsed, images }
}

/** Split message content into the parts the product bubble renders. */
export function splitContent(content: readonly unknown[]): SplitContent {
  let text = ''
  const images: NativeAttachmentView[] = []
  const rest: unknown[] = []
  for (const raw of content) {
    if (raw === null || typeof raw !== 'object') {
      rest.push(raw)
      continue
    }
    const block = raw as { type?: unknown; text?: unknown; attachment?: unknown }
    if (block.type === 'text' && typeof block.text === 'string') {
      text += block.text
    } else if (block.type === 'image' && block.attachment !== null && typeof block.attachment === 'object') {
      images.push(block.attachment as NativeAttachmentView)
    } else {
      rest.push(raw)
    }
  }
  return { text, images, rest }
}

/**
 * DeepSeek Chat lone-image box: long edge 240px, rendered aspect clamped to
 * [0.25, 4] with `object-fit: cover`, never upscaled past the natural size.
 */
export function singleFit(width: number, height: number): ImageFit {
  const natural = width / height
  const ratio = Math.min(4, Math.max(0.25, natural))
  const box = ratio >= 1 ? { width: 240, height: 240 / ratio } : { width: 240 * ratio, height: 240 }
  const scale = Math.min(1, width / box.width, height / box.height)
  return {
    width: Math.max(1, Math.round(box.width * scale)),
    height: Math.max(1, Math.round(box.height * scale)),
    objectPosition: natural < 0.25 ? 'center top' : natural > 4 ? 'left center' : 'center',
  }
}

interface ShadowLabels {
  loading: string
  loadFailed: string
  open: string
  openNamed: (label: string) => string
  preview: string
  closePreview: string
}

function resolveLabels(t: ShadowTranslate | undefined): ShadowLabels {
  return {
    loading: translate(t, 'image.loading'),
    loadFailed: translate(t, 'image.loadFailed'),
    open: translate(t, 'image.openOriginal'),
    openNamed: label => translate(t, 'image.openOriginalLabel', { label }),
    preview: translate(t, 'image.preview'),
    closePreview: translate(t, 'image.closePreview'),
  }
}

/** Body-portal original-image preview; closes on Escape or backdrop press. Shared by chat bubbles and the composer paste rail. */
export function ImageLightbox(props: { src: string; alt: string; dialog: string; close: string; onClose: () => void }): ReactNode {
  const { onClose } = props
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [onClose])
  return createPortal(
    <div className="dvt-lightbox" role="dialog" aria-modal="true" aria-label={props.dialog}>
      <div className="dvt-lightbox-mask" aria-hidden="true" onMouseDown={onClose} />
      <img className="dvt-lightbox-img" src={props.src} alt={props.alt} />
      <button type="button" className="dvt-lightbox-close" aria-label={props.close} onClick={onClose}>
        <IconCloseOutline16 />
      </button>
    </div>,
    document.body,
  )
}

/** Native image block: load through the session-authorized resolver. */
function NativeImageCell(props: {
  attachment: NativeAttachmentView
  name: string
  variant: 'single' | 'tile'
  load: (attachment: NativeAttachmentView) => Promise<string>
  labels: ShadowLabels
}): ReactNode {
  const { attachment } = props
  const [src, setSrc] = useState('')
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    setFailed(false)
    setSrc('')
    props.load(attachment).then((url) => {
      if (live) setSrc(url)
    }).catch(() => {
      if (live) setFailed(true)
    })
    return () => { live = false }
  }, [attachment, attempt, props.load])
  const fit = props.variant === 'single' && typeof attachment.width === 'number' && typeof attachment.height === 'number'
    ? singleFit(attachment.width, attachment.height)
    : undefined
  if (failed) {
    return <button
      type="button"
      className="dvt-img-frame dvt-img-error"
      data-variant={props.variant}
      onClick={() => { setAttempt(previous => previous + 1) }}
    ><span className="dvt-img-text">{props.labels.loadFailed}</span></button>
  }
  if (src === '') {
    return <div className="dvt-img-frame" data-variant={props.variant} style={fit === undefined ? undefined : { width: fit.width, height: fit.height }}>
      <span className="dvt-img-text">{props.labels.loading}</span>
    </div>
  }
  return <>
    <button
      type="button"
      className="dvt-img-frame"
      data-variant={props.variant}
      title={props.labels.open}
      aria-label={props.labels.openNamed(props.name)}
      style={fit === undefined ? undefined : { width: fit.width, height: fit.height }}
      onClick={() => { setOpen(true) }}
    >
      <img src={src} alt={props.name} style={fit === undefined ? undefined : { objectPosition: fit.objectPosition }} />
    </button>
    {open && <ImageLightbox src={src} alt={props.name} dialog={props.labels.preview} close={props.labels.closePreview} onClose={() => { setOpen(false) }} />}
  </>
}

/** Bridge image: served directly by the paste-image file route. */
function BridgeImageCell(props: {
  item: PastedBridgeImage
  name: string
  variant: 'single' | 'tile'
  labels: ShadowLabels
}): ReactNode {
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [open, setOpen] = useState(false)
  if (failed) {
    return <button
      type="button"
      className="dvt-img-frame dvt-img-error"
      data-variant={props.variant}
      onClick={() => { setFailed(false); setAttempt(previous => previous + 1) }}
    ><span className="dvt-img-text">{props.labels.loadFailed}</span></button>
  }
  return <>
    <button
      type="button"
      className="dvt-img-frame"
      data-variant={props.variant}
      title={props.labels.open}
      aria-label={props.labels.openNamed(props.name)}
      onClick={() => { setOpen(true) }}
    >
      {/* The file route is no-store, so a keyed remount re-fetches on retry. */}
      <img key={attempt} src={props.item.url} alt={props.name} onError={() => { setFailed(true) }} />
    </button>
    {open && <ImageLightbox src={props.item.url} alt={props.name} dialog={props.labels.preview} close={props.labels.closePreview} onClose={() => { setOpen(false) }} />}
  </>
}

type GalleryItem =
  | { kind: 'native'; attachment: NativeAttachmentView; name: string }
  | { kind: 'bridge'; item: PastedBridgeImage; name: string }

function ShadowGallery(props: {
  items: readonly GalleryItem[]
  load: ((attachment: NativeAttachmentView) => Promise<string>) | undefined
  t: ShadowTranslate | undefined
}): ReactNode {
  if (props.items.length === 0) return null
  const variant = props.items.length === 1 ? 'single' : 'tile'
  const labels = resolveLabels(props.t)
  return <div className="dvt-img-gallery" data-align="end">
    {props.items.map((item, index) => {
      if (item.kind === 'native') {
        if (props.load === undefined) {
          const name = item.name || `image-${index + 1}`
          return <span className="dvt-img-text" key={`${name}-${index}`}>{name}</span>
        }
        return <NativeImageCell
          key={`native-${String(item.attachment.attachmentId ?? index)}`}
          attachment={item.attachment}
          name={item.name}
          variant={variant}
          load={props.load}
          labels={labels}
        />
      }
      return <BridgeImageCell key={`bridge-${item.item.url}-${index}`} item={item.item} name={item.name} variant={variant} labels={labels} />
    })}
  </div>
}

/** Plain-text bubble fragment with `/skill` and `@agent` reference chips. */
function projectUserText(text: string): ReactNode {
  if (text === '') return null
  const pieces: ReactNode[] = []
  let cursor = 0
  CHIP_RE.lastIndex = 0
  for (let match = CHIP_RE.exec(text); match !== null; match = CHIP_RE.exec(text)) {
    const index = match.index
    if (index > cursor) pieces.push(<MessageText key={`text-${pieces.length}`} text={text.slice(cursor, index)} />)
    const token = match[2] ?? match[0].trim()
    const prefix = match[1] ?? ' '
    pieces.push(<span
      key={`chip-${pieces.length}`}
      className="dvt-ref-chip"
      data-kind={token.startsWith('@') ? 'agent' : 'skill'}
    >{prefix}{token}</span>)
    cursor = index + match[0].length
  }
  if (cursor < text.length) pieces.push(<MessageText key={`text-${pieces.length}`} text={text.slice(cursor)} />)
  return <>{pieces}</>
}

function MessageActions(props: { text: string; time: number | undefined; t: ShadowTranslate | undefined }): ReactNode {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => { if (timer.current !== undefined) clearTimeout(timer.current) }, [])
  useEffect(() => {
    if (!copied) return undefined
    timer.current = setTimeout(() => { setCopied(false) }, 1000)
    return () => { if (timer.current !== undefined) clearTimeout(timer.current) }
  }, [copied])
  const onCopy = useCallback(() => {
    writeClipboard(props.text).then(() => { setCopied(true) }, () => { setCopied(true) })
  }, [props.text])
  const copyLabel = copied ? translate(props.t, 'copied') : translate(props.t, 'copy')
  const clock = props.time === undefined ? null : new Date(props.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return <div className="dvt-msg-actions">
    {clock === null ? null : <span className="dvt-msg-time">{clock}</span>}
    <Tooltip label={copyLabel} side="bottom">
      <button type="button" className="dvt-msg-action" aria-label={copyLabel} onClick={onCopy}>
        {copied ? <IconCheckOutline16 /> : <IconCopyOutline16 />}
      </button>
    </Tooltip>
  </div>
}

type ShadowNodeData = {
  content?: readonly unknown[]
  time?: number
  pending?: boolean
}

/**
 * Priority -1 shadow of the product's keyed `user` / `steering` chat-node
 * views. Props are the framework's composed slot props (node, loadImage, t,
 * session kit). A render error here abdicates the entry, handily restoring
 * the product view instead of leaving an empty row.
 */
export const UserMessageNodeShadow = memo(function UserMessageNodeShadow(props: ChatNodeViewProps): ReactNode {
  const { node, loadImage, t } = props
  const data = (node?.data ?? {}) as ShadowNodeData
  const content = Array.isArray(data.content) ? data.content : []
  const split = useMemo(() => splitContent(content), [content])
  const bridge = useMemo(() => extractBridgeMarkup(split.text), [split.text])
  const items = useMemo<GalleryItem[]>(() => [
    ...split.images.map((attachment, index) => ({ kind: 'native' as const, attachment, name: attachment.name ?? `image-${index + 1}` })),
    ...bridge.images.map((item, index) => ({ kind: 'bridge' as const, item, name: item.alt || `pasted-image-${index + 1}` })),
  ], [split.images, bridge.images])
  const showBubble = bridge.text !== '' || split.rest.length > 0
  return <div className="dvt-user-row" data-pending-steering={data.pending === true ? 'true' : undefined} data-time-hover-root>
    <div className="dvt-user-stack">
      <ShadowGallery items={items} load={loadImage as unknown as ((attachment: NativeAttachmentView) => Promise<string>) | undefined} t={t as unknown as ShadowTranslate | undefined} />
      {showBubble && <div className="dvt-bubble">
        {projectUserText(bridge.text)}
        {split.rest.map((block, index) => <JsonBlock
          key={`rest-${index}`}
          label={translate(t as unknown as ShadowTranslate | undefined, 'extra')}
          payload={block}
        />)}
      </div>}
    </div>
    <MessageActions text={bridge.text} time={data.time} t={t as unknown as ShadowTranslate | undefined} />
  </div>
})

/**
 * Primitive-only fallback used when the full shadow renderer throws (for
 * example a host build missing an optional UI primitive). It still strips the
 * bridge path/markdown and shows the image, so the product's raw text never
 * leaks even in the error path.
 */
function FallbackUserMessage(props: ChatNodeViewProps): ReactNode {
  const data = (props.node?.data ?? {}) as ShadowNodeData
  const content = Array.isArray(data.content) ? data.content : []
  const split = splitContent(content)
  const bridge = extractBridgeMarkup(split.text)
  const items: GalleryItem[] = [
    ...split.images.map((attachment, index) => ({ kind: 'native' as const, attachment, name: attachment.name ?? `image-${index + 1}` })),
    ...bridge.images.map((item, index) => ({ kind: 'bridge' as const, item, name: item.alt || `pasted-image-${index + 1}` })),
  ]
  return <div className="dvt-user-row" data-time-hover-root>
    <div className="dvt-user-stack">
      {items.map((item, index) => {
        if (item.kind === 'bridge') {
          return <img
            key={`bridge-${index}`}
            className="dvt-img-frame"
            src={item.item.url}
            alt={item.name}
            style={{ maxWidth: 240, borderRadius: 14 }}
          />
        }
        return <span key={`native-${index}`} className="dvt-img-text">{item.name}</span>
      })}
      {bridge.text !== '' && <div className="dvt-bubble">{bridge.text}</div>}
    </div>
  </div>
}

/**
 * Error boundary around the shadow renderer. A render failure abdicates the
 * raw slot entry and silently restores the product's raw-text bubble, which is
 * exactly what we must avoid for bridged images. This boundary keeps the
 * plugin's clean user-message view mounted and falls back to a primitive-only
 * renderer instead of letting the product view leak bridge markup.
 */
class UserMessageShadowBoundaryClass extends Component<ChatNodeViewProps, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override componentDidCatch(error: unknown): void {
    console.warn('dsh-vision-cloud user message shadow failed; using fallback renderer', error)
  }

  override render(): ReactNode {
    if (this.state.failed) return <FallbackUserMessage {...this.props} />
    return <UserMessageNodeShadow {...this.props} />
  }
}

/**
 * Slot-safe wrapper around the shadow error boundary. The slot registry
 * accepts function components most reliably, so this memoized function is what
 * gets registered for the `user` / `steering` chat-node keys.
 */
export const UserMessageShadowBoundary = memo(function UserMessageShadowBoundary(props: ChatNodeViewProps): ReactNode {
  return <UserMessageShadowBoundaryClass {...props} />
})