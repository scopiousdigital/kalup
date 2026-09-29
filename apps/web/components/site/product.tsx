import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { CropMarks, type Risk, RiskChip } from './primitives'

type Change = { unit: string; kind: 'add' | 'remove' | 'held'; detail: ReactNode }

/** One plan step, rendered the way an admin reads it: HubSpot's own words first, the address second. */
export function PlanStep({
  op,
  title,
  address,
  transport = 'public-api',
  risk,
  changes,
  expect,
  className,
}: {
  op: '+' | '~' | '-'
  title: string
  address: string
  transport?: string
  risk: Risk
  changes: Change[]
  expect?: string
  className?: string
}) {
  return (
    <div className={cn('relative min-w-0 border border-line-strong bg-paper text-sm', className)}>
      <CropMarks />
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3.5 border-b border-line p-4">
        <span className="grid size-[26px] place-items-center bg-ink font-mono text-sm font-semibold text-paper">
          {op}
        </span>
        <div>
          <div className="text-base font-semibold">{title}</div>
          <div className="font-mono text-xs leading-normal text-muted [overflow-wrap:anywhere]">
            {address} · {transport}
          </div>
        </div>
        <RiskChip risk={risk} />
      </div>
      {changes.map((c) => (
        <div
          key={c.unit}
          className={cn(
            'grid gap-0.5 border-b border-line px-4 py-3 font-mono text-[13px] leading-normal sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-3',
            c.kind === 'held' &&
              'bg-[repeating-linear-gradient(-45deg,transparent_0_8px,color-mix(in_oklab,var(--color-risky)_10%,transparent)_8px_16px)]',
          )}
        >
          <span className="text-muted [overflow-wrap:anywhere]">{c.unit}</span>
          <span className={cn(c.kind === 'add' && 'text-safe', c.kind === 'remove' && 'text-destructive')}>
            {c.detail}
          </span>
        </div>
      ))}
      {expect && <div className="px-4 py-3 font-mono text-xs leading-normal text-muted">{expect}</div>}
    </div>
  )
}

const KEYWORDS = /\b(import|export|const|type|from|typeof|default)\b/
const TOKEN = /(\/\/.*$|'[^']*'|\b(?:import|export|const|type|from|typeof|default)\b|\b[A-Z]\w*\b|\.\w+(?=\())/gm

/** A code block with a small highlighter: comments, strings, keywords, types and builder calls. */
export function Code({ code, file, className }: { code: string; file?: string; className?: string }) {
  const parts: ReactNode[] = []
  let last = 0
  for (const m of code.matchAll(TOKEN)) {
    const at = m.index ?? 0
    if (at > last) parts.push(code.slice(last, at))
    const tok = m[0]
    const cls = tok.startsWith('//')
      ? 'text-muted italic'
      : tok.startsWith("'")
        ? 'text-safe'
        : KEYWORDS.test(tok)
          ? 'text-[#b4530a]'
          : tok.startsWith('.')
            ? 'text-graphite font-semibold'
            : 'text-ink font-semibold'
    parts.push(
      <span key={at} className={cls}>
        {tok}
      </span>,
    )
    last = at + tok.length
  }
  parts.push(code.slice(last))
  return (
    <div className={cn('relative min-w-0 border border-line-strong bg-[#f6f6f2]', className)}>
      <CropMarks />
      {file && (
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 font-mono text-xs text-muted">
          <span aria-hidden className="size-2 bg-molten" />
          {file}
        </div>
      )}
      <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-[1.7] text-graphite">
        <code>{parts}</code>
      </pre>
    </div>
  )
}
