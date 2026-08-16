import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: string
  variant?: string
  children?: ReactNode
}

/** Test-only HTML substitute for the host button component. */
export function Button({ size, variant, ...props }: ButtonProps): ReactNode {
  return <button data-size={size} data-variant={variant} {...props} />
}

/** Test-only HTML substitute for the host input component. */
export function Input(props: InputHTMLAttributes<HTMLInputElement>): ReactNode {
  return <input {...props} />
}

/** Test-only plain-text span (host MessageText carries the typography). */
export function MessageText({ text }: { text: string }): ReactNode {
  return <span data-primitives="message-text">{text}</span>
}

/** Test-only JsonBlock substitute. */
export function JsonBlock({ label, payload }: { label: string; payload: unknown }): ReactNode {
  return <details data-primitives="json-block"><summary>{label}</summary><pre>{JSON.stringify(payload)}</pre></details>
}

/** Test-only Tooltip substitute: wraps the anchor with a title attribute. */
export function Tooltip({ label, children }: { label: string | (() => string); children: ReactNode }): ReactNode {
  return <span data-primitives="tooltip" title={typeof label === 'string' ? label : ''}>{children}</span>
}

/** Test-only icon substitutes. */
export function IconCopyOutline16({ className }: { className?: string }): ReactNode {
  return <svg data-primitives="icon" data-icon="copy" className={className} />
}

export function IconCheckOutline16({ className }: { className?: string }): ReactNode {
  return <svg data-primitives="icon" data-icon="check" className={className} />
}

export function IconCloseOutline16({ className }: { className?: string }): ReactNode {
  return <svg data-primitives="icon" data-icon="close" className={className} />
}

/** Clipboard writes are user-visible side effects; tests stub them explicitly. */
export function writeClipboard(_text: string): Promise<void> {
  return Promise.resolve()
}