import Link from 'next/link'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { AVAILABILITY_TEXT, type Availability, type Stage } from '@/lib/site-data'

// Outer gutter: where the rails sit. `.wrap` adds an inner gutter on top, so content clears the rails.
const GUTTER = 'clamp(16px,4vw,44px)'

function Arrow({ className }: { className: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M2 8h11M9 4l4 4-4 4" />
    </svg>
  )
}

const buttonTones = {
  ink: { base: 'bg-ink text-paper hover:text-ink focus-visible:text-ink', fill: 'bg-molten', arr: 'text-ink' },
  ghost: {
    base: 'text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:text-paper focus-visible:text-paper',
    fill: 'bg-ink',
    arr: 'text-paper',
  },
  paper: { base: 'bg-paper text-ink hover:text-paper focus-visible:text-paper', fill: 'bg-ink', arr: 'text-paper' },
}

export function ArrowButton({
  href,
  children,
  tone = 'ink',
}: {
  href: string
  children: ReactNode
  tone?: keyof typeof buttonTones
}) {
  const t = buttonTones[tone]
  const external = href.startsWith('http')
  return (
    <Link
      href={href}
      className={cn('arrow-btn', t.base)}
      {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
    >
      <span className={cn('fill', t.fill)} />
      <span>{children}</span>
      <span className={cn('arr', t.arr)}>
        <Arrow className="a1" />
        <Arrow className="a2" />
      </span>
    </Link>
  )
}

/** Crop-mark corners: the frame for anything cast. They replace rounded cards. */
export function CropMarks() {
  const mark = 'pointer-events-none absolute size-3.5 border-ink'
  return (
    <>
      <span aria-hidden className={cn(mark, '-top-px -left-px border-t-[1.5px] border-l-[1.5px]')} />
      <span aria-hidden className={cn(mark, '-top-px -right-px border-t-[1.5px] border-r-[1.5px]')} />
      <span aria-hidden className={cn(mark, '-bottom-px -left-px border-b-[1.5px] border-l-[1.5px]')} />
      <span aria-hidden className={cn(mark, '-right-px -bottom-px border-r-[1.5px] border-b-[1.5px]')} />
    </>
  )
}

function Plus({ side }: { side: 'left' | 'right' }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 13 13"
      className="pointer-events-none absolute -top-[6.5px] z-10 size-[13px] text-ink"
      style={{ [side]: `calc(${GUTTER} - 6.5px)` }}
    >
      <path d="M6.5 0v13M0 6.5h13" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

/** The layout rails: two hairlines on the content edges, with + marks where they meet a section border. */
export function Rails({ marks = true }: { marks?: boolean }) {
  return (
    <>
      <span aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-line" style={{ left: GUTTER }} />
      <span aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-line" style={{ right: GUTTER }} />
      {marks && (
        <>
          <Plus side="left" />
          <Plus side="right" />
        </>
      )}
    </>
  )
}

/** A page section: a hairline border on top, the rails on the content edges, paper or the dot field underneath. */
export function Section({
  children,
  id,
  className,
  dots = false,
  bleed = false,
}: {
  children: ReactNode
  id?: string
  className?: string
  dots?: boolean
  bleed?: boolean
}) {
  return (
    <section id={id} className={cn('relative border-t border-line', dots ? 'ground-dots' : 'bg-paper', className)}>
      <div className="wrap relative">
        <Rails />
        <div className={cn('relative', !bleed && 'py-[clamp(72px,10vw,136px)]')}>{children}</div>
      </div>
    </section>
  )
}

/** The eyebrow is a resource address, Kalup's own naming, so labels read as product rather than decoration. */
export function Address({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 font-mono text-[13px] leading-none text-ink">
      <span aria-hidden className="size-2 bg-molten" />
      {children}
    </span>
  )
}

export function SectionHead({
  address,
  title,
  lede,
  className,
}: {
  address: string
  title: ReactNode
  lede?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-[clamp(36px,5vw,64px)] grid items-end gap-x-12 gap-y-5 md:grid-cols-2', className)}>
      <div className="md:col-span-2">
        <Address>{address}</Address>
      </div>
      <h2 className="display text-h2">{title}</h2>
      {lede && <p className="max-w-[58ch] text-lede text-graphite">{lede}</p>}
    </div>
  )
}

export type Risk = 'safe' | 'risky' | 'destructive' | 'blocked' | 'manual'

const riskStyles: Record<Risk, string> = {
  safe: 'text-safe bg-[color-mix(in_oklab,var(--color-safe)_12%,var(--color-paper))] before:bg-current',
  risky: 'text-risky-ink bg-[color-mix(in_oklab,var(--color-risky)_22%,var(--color-paper))] before:bg-risky',
  destructive:
    'text-destructive bg-[color-mix(in_oklab,var(--color-destructive)_12%,var(--color-paper))] before:bg-current',
  blocked:
    'text-paper bg-[repeating-linear-gradient(-45deg,var(--color-ink)_0_6px,var(--color-graphite)_6px_12px)] before:bg-current',
  manual: 'text-ink shadow-[inset_0_0_0_1px_var(--color-ink)] before:shadow-[inset_0_0_0_1.5px_var(--color-ink)]',
}

const chipBase =
  "inline-flex items-center gap-[7px] whitespace-nowrap rounded-[3px] px-2 py-1.5 font-mono text-xs leading-none font-medium before:size-[7px] before:content-['']"

export function RiskChip({ risk }: { risk: Risk }) {
  return <span className={cn(chipBase, riskStyles[risk])}>{risk}</span>
}

// Shape carries the meaning as well as colour: a molten fill once released, a molten dot for a documented recipe, a
// hollow dot for next, a grey dot for later. The paper ground keeps the tag readable on the dark terminals too.
const availabilityStyles: Record<Availability, string> = {
  released: 'bg-molten text-ink before:bg-ink',
  design: 'bg-paper text-ink shadow-[inset_0_0_0_1px_var(--color-ink)] before:bg-molten',
  next: 'bg-paper text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] before:shadow-[inset_0_0_0_1.5px_var(--color-ink)]',
  later: 'bg-paper text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] before:bg-line-strong',
}

/** Marks where a capability stands: released in 0.1.0, a documented recipe, next, or later. */
export function AvailabilityTag({ stage }: { stage: Stage }) {
  const text = AVAILABILITY_TEXT[stage.availability]
  return (
    <span title={text.meaning} className={cn(chipBase, availabilityStyles[stage.availability])}>
      {text.label}
    </span>
  )
}

/** What the name means. Used in the hero and the footer. */
export function Meaning({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        'grid max-w-[520px] grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3.5 gap-y-1 border-t border-ink pt-3.5 text-sm text-graphite',
        className,
      )}
    >
      <dfn className="text-[22px] leading-none font-bold tracking-[-0.03em] text-ink not-italic">kalup</dfn>
      <span className="font-mono text-[13px] text-muted">/ˈka.lup/ · noun · Slovenian</span>
      <span className="col-span-2">
        A mould: the form you pour metal into. Your config is the mould. Kalup pours your portal into it.
      </span>
    </p>
  )
}

export function Logo() {
  return (
    <svg viewBox="0 0 26 26" className="size-[26px]" aria-hidden="true">
      <rect x="1.5" y="1.5" width="23" height="23" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <rect x="6" y="13" width="14" height="7" fill="var(--color-molten)" />
    </svg>
  )
}
