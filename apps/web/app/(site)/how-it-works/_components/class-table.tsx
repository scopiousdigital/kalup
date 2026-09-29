'use client'

import { useEffect, useRef, useState } from 'react'
import { useInView, useReducedMotion } from '@/components/site/hooks'
import { AvailabilityTag } from '@/components/site/primitives'
import { cn } from '@/lib/cn'
import { STAGE, type Stage } from '@/lib/site-data'

type Default = 'none' | 'write' | 'hold'

// The classes that need a base arrive with state; `stage` marks them.
const ROWS: {
  base: string
  config: string
  live: string
  cls: string
  def: Default
  says: string
  stage?: Stage
}[] = [
  {
    base: 'any',
    config: 'config equals live',
    live: '',
    cls: 'converged',
    def: 'none',
    says: 'Nothing to do.',
  },
  {
    base: 'yes',
    config: 'changed',
    live: 'same',
    cls: 'config-change',
    stage: STAGE.m3,
    def: 'write',
    says: 'You changed the file. Apply writes it.',
  },
  {
    base: 'yes',
    config: 'same',
    live: 'changed',
    cls: 'drift',
    stage: STAGE.m3,
    def: 'hold',
    says: 'Someone changed the portal. The plan reports it and leaves it.',
  },
  {
    base: 'yes',
    config: 'changed',
    live: 'changed',
    cls: 'conflict',
    stage: STAGE.m3,
    def: 'hold',
    says: 'Both sides changed. A person decides.',
  },
  {
    base: 'none',
    config: 'config differs from live',
    live: '',
    cls: 'diverged',
    def: 'hold',
    says: 'No record of the last apply, so no way to tell who changed what.',
  },
]

const DEFAULTS: Record<Default, string> = {
  none: 'text-muted shadow-[inset_0_0_0_1px_var(--color-line-strong)]',
  write: 'text-safe bg-[color-mix(in_oklab,var(--color-safe)_12%,var(--color-paper))]',
  hold: 'text-risky-ink bg-[repeating-linear-gradient(-45deg,color-mix(in_oklab,var(--color-risky)_22%,var(--color-paper))_0_5px,color-mix(in_oklab,var(--color-risky)_10%,var(--color-paper))_5px_10px)]',
}

/** The five classes. Rows arrive one at a time when the table scrolls into view. */
export function ClassTable() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, 0.35)
  const reduce = useReducedMotion()
  const [phase, setPhase] = useState<'rest' | 'hidden' | 'shown'>('rest')
  const started = useRef(false)

  // The run is tracked in a ref, not in the dependencies: depending on `phase` would re-run this
  // effect as soon as it sets `hidden`, and the cleanup would cancel the frame that shows the rows.
  useEffect(() => {
    if (!inView || reduce || started.current) return
    started.current = true
    setPhase('hidden')
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setPhase('shown'))
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [inView, reduce])

  return (
    <div ref={ref} className="overflow-x-auto border border-line-strong bg-paper">
      <table className="w-full min-w-[760px] border-collapse text-left text-[15px]">
        <thead>
          <tr className="border-b border-line-strong">
            {['Base', 'Config vs base', 'Live vs base', 'Class', 'Default', 'What it means'].map((h) => (
              <th key={h} scope="col" className="eyebrow px-4 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row, n) => (
            <tr
              key={row.cls}
              style={{ transitionDelay: phase === 'shown' ? `${n * 140}ms` : '0ms' }}
              className={cn(
                'border-b border-line transition-[opacity,transform] duration-500 ease-[var(--ease-out-soft)] last:border-b-0',
                phase === 'hidden' && 'translate-y-2 opacity-0',
              )}
            >
              <td className="px-4 py-3.5 font-mono text-[13px] text-graphite">{row.base}</td>
              <td className="px-4 py-3.5 font-mono text-[13px] text-graphite" colSpan={row.live ? 1 : 2}>
                {row.config}
              </td>
              {row.live && <td className="px-4 py-3.5 font-mono text-[13px] text-graphite">{row.live}</td>}
              <td className="px-4 py-3.5 font-mono text-[13px] font-semibold">
                <span className="flex items-center gap-2 whitespace-nowrap">
                  {row.cls}
                  {row.stage && <AvailabilityTag stage={row.stage} />}
                </span>
              </td>
              <td className="px-4 py-3.5">
                <span className={cn('rounded-[3px] px-2 py-1 font-mono text-xs', DEFAULTS[row.def])}>{row.def}</span>
              </td>
              <td className="px-4 py-3.5 text-sm text-graphite">{row.says}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
