'use client'

import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { useReducedMotion } from './hooks'

const HOT = 7

/**
 * A statement that fills with molten orange as you scroll past it, then sets into ink.
 * The wrapper is tall and the text sticky, so the fill tracks the scroll.
 */
export function PourText({ text, children }: { text: string; children?: ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const [front, setFront] = useState<number | null>(null)
  const count = text.replace(/ /g, '').length

  useEffect(() => {
    if (reduce) {
      setFront(null)
      return
    }
    function update() {
      const r = (wrap.current as HTMLDivElement).getBoundingClientRect()
      const span = r.height - window.innerHeight
      const p = Math.min(1, Math.max(0, -r.top / (span || 1)))
      setFront(p * (count + HOT) * 1.02)
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [reduce, count])

  let i = 0
  const words = text.split(' ')
  return (
    <div ref={wrap} className={cn('relative', !reduce && 'h-[210vh]')}>
      <div className={cn('grid content-center gap-7 py-12', !reduce && 'sticky top-0 min-h-screen')}>
        <h2 className="display max-w-[15ch] text-statement" aria-label={text}>
          {words.map((word, w) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: words of a fixed sentence can repeat and never reorder
            <Fragment key={`${word}-${w}`}>
              <span aria-hidden className="inline-block whitespace-nowrap">
                {[...word].map((ch) => {
                  const n = i++
                  const state = front === null ? 'set' : n < front - HOT ? 'set' : n < front ? 'hot' : 'dim'
                  return (
                    <span
                      key={n}
                      className={cn(
                        'transition-colors duration-300',
                        state === 'set' && 'text-ink',
                        state === 'hot' && 'text-molten',
                        state === 'dim' && 'text-[color-mix(in_oklab,var(--color-ink)_13%,var(--color-paper))]',
                      )}
                    >
                      {ch}
                    </span>
                  )
                })}
              </span>{' '}
            </Fragment>
          ))}
        </h2>
        {children}
      </div>
    </div>
  )
}

/** A slow strip of real resource addresses. Texture, so it is hidden from assistive tech. */
export function AddressMarquee({ addresses }: { addresses: string[] }) {
  const items = [...addresses, ...addresses]
  return (
    <div
      aria-hidden
      className="overflow-hidden border-y border-line bg-paper py-3.5 [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]"
    >
      <div className="flex w-max animate-marquee gap-10 font-mono text-sm text-graphite hover:[animation-play-state:paused]">
        {items.map((a, n) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the list is doubled on purpose for a seamless loop
          <span key={`${a}-${n}`} className="inline-flex items-center gap-2.5 whitespace-nowrap">
            <span className={cn('size-1.5', n % 4 === 0 ? 'bg-molten' : 'bg-line-strong')} />
            {a}
          </span>
        ))}
      </div>
    </div>
  )
}
