'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import type { Stage } from '@/lib/site-data'
import { useInView, useReducedMotion } from './hooks'
import { AvailabilityTag } from './primitives'

export type Tone = 'plain' | 'muted' | 'add' | 'hold' | 'error' | 'prompt'
export type Line = { text: string; tone?: Tone }[] | string

const tones: Record<Tone, string> = {
  plain: '',
  muted: 'text-[rgb(233_233_227/0.5)]',
  add: 'text-[#5bd18b]',
  hold: 'text-[#f2c94c]',
  error: 'text-[#ff7b72]',
  prompt: 'text-molten',
}

function render(line: Line) {
  if (typeof line === 'string') return line
  return line.map((part, n) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: parts of a fixed line never reorder
    <span key={n} className={tones[part.tone ?? 'plain']}>
      {part.text}
    </span>
  ))
}

/**
 * A scripted terminal session. The command types itself when the terminal scrolls into view,
 * then the output prints line by line. At rest (and with reduced motion) the full session shows.
 * A session for a command that is not released, or a design not yet run, carries its stage in the title bar.
 */
export function Terminal({
  title,
  command,
  output,
  stage,
  className,
}: {
  title: string
  command: string
  output: Line[]
  stage?: Stage
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, 0.45)
  const reduce = useReducedMotion()
  const [typed, setTyped] = useState(command.length)
  const [shown, setShown] = useState(output.length)
  const [run, setRun] = useState(0)
  const started = useRef(false)

  useEffect(() => {
    if (inView && !reduce && !started.current) {
      started.current = true
      setRun(1)
    }
  }, [inView, reduce])

  useEffect(() => {
    if (run === 0) return
    let cancelled = false
    const timers: ReturnType<typeof setTimeout>[] = []
    setTyped(0)
    setShown(0)
    let t = 0
    for (let c = 1; c <= command.length; c++) {
      t += 38 + ((c * 37) % 40)
      timers.push(setTimeout(() => !cancelled && setTyped(c), t))
    }
    t += 400
    for (let l = 1; l <= output.length; l++) {
      t += l === 1 ? 700 : 90
      timers.push(setTimeout(() => !cancelled && setShown(l), t))
    }
    return () => {
      cancelled = true
      timers.forEach(clearTimeout)
    }
  }, [run, command, output.length])

  const done = typed === command.length && shown === output.length
  return (
    <div
      ref={ref}
      className={cn(
        'min-w-0 overflow-hidden rounded-[10px] bg-ink font-mono text-[13.5px] leading-[1.65] text-[#e9e9e3]',
        className,
      )}
    >
      <div className="flex items-center gap-[7px] border-b border-white/10 px-3.5 py-3">
        <i className="size-2.5 rounded-full bg-white/15" />
        <i className="size-2.5 rounded-full bg-white/15" />
        <i className="size-2.5 rounded-full bg-white/15" />
        <span className="ml-2 text-xs text-white/50">{title}</span>
        {stage && (
          <span className="ml-3">
            <AvailabilityTag stage={stage} />
          </span>
        )}
        <button
          type="button"
          onClick={() => setRun((r) => r + 1)}
          className="ml-auto text-xs text-white/60 hover:text-white"
        >
          ↻ replay
        </button>
      </div>
      <pre
        className="min-h-[300px] px-[18px] pt-4 pb-5 font-mono whitespace-pre-wrap [overflow-wrap:anywhere]"
        aria-live="off"
      >
        <span className="text-molten">$</span> {command.slice(0, typed)}
        {typed < command.length && (
          <span className="inline-block h-[1.1em] w-[0.6em] animate-blink bg-molten align-[-0.2em]" />
        )}
        {output.slice(0, shown).map((line, n) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: output lines are fixed and never reorder
          <span key={n}>
            {'\n'}
            {render(line)}
          </span>
        ))}
        {done && (
          <>
            {'\n'}
            <span className="text-molten">$</span>{' '}
            <span className="inline-block h-[1.1em] w-[0.6em] animate-blink bg-molten align-[-0.2em]" />
          </>
        )}
      </pre>
    </div>
  )
}
