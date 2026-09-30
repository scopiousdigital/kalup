'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { Halftone } from './halftone'
import { useInView, useReducedMotion } from './hooks'
import { CropMarks } from './primitives'

/** A use case as a halftone card. Move the cursor over it and the dots part around it. */
export function UseCaseCard({
  href,
  title,
  line,
  image,
  path,
}: {
  href: string
  title: string
  line: string
  image: string
  path: string
}) {
  return (
    <Link href={href} className="group relative grid gap-4 border border-line-strong bg-paper p-5 outline-offset-4">
      <CropMarks />
      <Halftone src={image} label={`${title}: halftone`} />
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="display text-h3">{title}</h3>
        <span className="font-mono text-xs text-muted">{path}</span>
      </div>
      <p className="text-[15px] text-graphite">{line}</p>
      <span className="font-mono text-[13px] group-hover:text-molten">Read the flow →</span>
    </Link>
  )
}

// The four keys of a delete, as the released CLI checks them.
const KEYS = [
  { name: 'Tombstone', detail: 'kalup rm writes it to kalup/removed.ts' },
  { name: 'Ownership', detail: 'state shows Kalup created or adopted it in this portal' },
  { name: 'Policy', detail: 'the target sets allowDestroy: true' },
  { name: 'A person', detail: 'at a terminal, typing the count' },
]

/** The four keys a delete needs. They turn one at a time when the row scrolls into view. */
export function FourKeys() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, 0.5)
  const reduce = useReducedMotion()
  const [turned, setTurned] = useState(KEYS.length)

  useEffect(() => {
    if (!inView || reduce) return
    setTurned(0)
    const timers = KEYS.map((_, n) => setTimeout(() => setTurned(n + 1), 500 + n * 550))
    return () => timers.forEach(clearTimeout)
  }, [inView, reduce])

  return (
    <div ref={ref} className="grid gap-4">
      <ol className="grid gap-px border border-line-strong bg-line-strong sm:grid-cols-4">
        {KEYS.map((key, n) => {
          const on = n < turned
          return (
            <li key={key.name} className="grid gap-3 bg-paper p-5">
              <span className="font-mono text-xs text-muted">key {n + 1}</span>
              <svg viewBox="0 0 40 40" className="size-10" aria-hidden="true">
                <rect
                  x="6"
                  y="17"
                  width="28"
                  height="19"
                  className={cn('transition-colors duration-500', on ? 'fill-molten' : 'fill-paper')}
                  stroke="var(--color-ink)"
                  strokeWidth="1.5"
                />
                <path
                  d={on ? 'M12 17v-5a8 8 0 0 1 15-4' : 'M12 17v-5a8 8 0 0 1 16 0v5'}
                  fill="none"
                  stroke="var(--color-ink)"
                  strokeWidth="1.5"
                />
              </svg>
              <span className="font-semibold">{key.name}</span>
              <span className="text-sm text-graphite">{key.detail}</span>
            </li>
          )
        })}
      </ol>
      <p className="font-mono text-[13px] text-muted" aria-live="polite">
        {turned < KEYS.length
          ? `${turned} of 4 keys. Nothing is deleted.`
          : 'All four keys. Only then can a delete run.'}
      </p>
    </div>
  )
}

/** A label edited in the HubSpot UI after an apply, and the plan holding it as drift instead of reverting it. */
export function DriftDemo() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, 0.5)
  const reduce = useReducedMotion()
  const [label, setLabel] = useState('Billing state')

  useEffect(() => {
    if (!inView || reduce) return
    const from = 'Billing status'
    const to = 'Billing state'
    let text = from
    setLabel(from)
    const steps: string[] = []
    while (!to.startsWith(text)) {
      text = text.slice(0, -1)
      steps.push(text)
    }
    for (const ch of to.slice(text.length)) {
      text += ch
      steps.push(text)
    }
    const timers = steps.map((s, n) => setTimeout(() => setLabel(s), 900 + n * 110))
    return () => timers.forEach(clearTimeout)
  }, [inView, reduce])

  const edited = label === 'Billing state'
  return (
    <div ref={ref} className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="relative border border-line-strong bg-paper p-5">
        <CropMarks />
        <span className="eyebrow">In your files</span>
        <pre className="mt-3 overflow-x-auto font-mono text-[13px] leading-[1.7] text-graphite">
          {"billingStatus: p.enum('billing_status', {\n  label: "}
          <span className="text-safe">'Billing status'</span>
          {',\n  ...\n})'}
        </pre>
      </div>
      <div className="relative border border-line-strong bg-panel p-5">
        <span className="eyebrow">In the HubSpot UI, edited by a colleague</span>
        <div className="mt-3 grid gap-1.5">
          <span className="text-xs text-muted">Property label</span>
          <span className="flex h-10 items-center border border-line-strong bg-paper px-3 text-[15px]">
            {label}
            {!edited && <span className="ml-px inline-block h-5 w-px animate-blink bg-ink" />}
          </span>
        </div>
      </div>
      <div
        className={cn(
          'border border-line-strong p-4 font-mono text-[13px] leading-normal transition-opacity duration-500 [overflow-wrap:anywhere] md:col-span-2',
          'bg-[repeating-linear-gradient(-45deg,transparent_0_8px,color-mix(in_oklab,var(--color-risky)_10%,transparent)_8px_16px)]',
          edited ? 'opacity-100' : 'opacity-30',
        )}
      >
        <span className="font-semibold text-risky-ink">held · drift</span>
        <span className="text-muted"> property:companies/billing_status#label</span>
        <br />
        config "Billing status" · portal "{label}" · not written
      </div>
    </div>
  )
}
