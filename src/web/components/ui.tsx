import { useState, type ReactNode } from 'react'
import type { Level, Severity } from '../../shared/rules.ts'
import { href, onLinkClick, type Route } from '../router.ts'

export const LEVEL_LABEL: Record<Level, string> = { red: 'At risk', amber: 'Look', green: 'Safe', quiet: 'Muted', unknown: 'No report' }

export const LEVEL_TEXT: Record<Level, string> = {
  red: 'text-red',
  amber: 'text-amber',
  green: 'text-green',
  quiet: 'text-quiet',
  unknown: 'text-ink-400',
}

const LAMP: Record<Level | Severity, string> = {
  red: 'lamp-red',
  amber: 'lamp-amber',
  green: 'lamp-green',
  quiet: 'bg-quiet/60',
  unknown: 'bg-unknown',
  info: 'bg-ink-400',
}

export function Lamp({ level, size = 'md', className = '' }: { level: Level | Severity; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const dims = size === 'sm' ? 'size-1.5' : size === 'lg' ? 'size-3.5' : 'size-2.5'
  return <span aria-hidden className={`inline-block shrink-0 rounded-full ${dims} ${LAMP[level]} ${className}`} />
}

export function Link({ to, className = '', children, title }: { to: Route; className?: string; children: ReactNode; title?: string }) {
  return (
    <a href={href(to)} onClick={onLinkClick} className={className} title={title}>
      {children}
    </a>
  )
}

export function Button({
  children,
  onClick,
  kind = 'ghost',
  disabled,
  title,
}: {
  children: ReactNode
  onClick?: () => void
  kind?: 'ghost' | 'solid' | 'danger'
  disabled?: boolean
  title?: string
}) {
  const styles = {
    ghost: 'border border-ink-600 text-ink-200 hover:border-ink-300 hover:text-ink-100 disabled:opacity-40',
    solid: 'bg-ink-100 text-ink-950 hover:bg-white disabled:opacity-40',
    danger: 'border border-red-dim text-red hover:border-red disabled:opacity-40',
  }[kind]
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} className={`rounded-sm px-3 py-1.5 font-mono text-[11px] tracking-wide uppercase transition-colors ${styles}`}>
      {children}
    </button>
  )
}

export function Kicker({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`font-mono text-[10px] tracking-[0.18em] uppercase text-ink-400 ${className}`}>{children}</div>
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-md border border-ink-700 bg-ink-900/70 ${className}`}>{children}</section>
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-dashed border-ink-700 px-6 py-12 text-center text-sm text-ink-400">{children}</div>
}

/** A shell command with a button that copies it. */
export function Command({ children }: { children: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(children)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="flex items-stretch overflow-hidden rounded-sm border border-ink-700 bg-ink-950">
      <code className="flex-1 overflow-x-auto px-3 py-2.5 font-mono text-xs whitespace-pre text-ink-100">
        <span className="select-none text-ink-400">$ </span>
        {children}
      </code>
      <button
        type="button"
        onClick={() => void copy()}
        className="shrink-0 border-l border-ink-700 px-3 font-mono text-[10px] uppercase tracking-wide text-ink-300 transition-colors hover:bg-ink-800 hover:text-ink-100"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

/** The counts of a device or a group, one small lamp each; zeroes are left out. */
export function Counts({ counts }: { counts: Partial<Record<Level, number>> }) {
  const shown = (['red', 'amber', 'green', 'quiet'] as const).filter((level) => (counts[level] ?? 0) > 0)
  return (
    <span className="flex items-center gap-3 font-mono text-[11px] text-ink-300">
      {shown.map((level) => (
        <span key={level} className="flex items-center gap-1.5" title={LEVEL_LABEL[level]}>
          <Lamp level={level} size="sm" />
          {counts[level]}
        </span>
      ))}
    </span>
  )
}
