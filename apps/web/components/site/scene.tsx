'use client'

import { type ReactNode, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { useInView, useReducedMotion } from './hooks'
import { CropMarks } from './primitives'

/*
  Where Kalup sits: your files on the left, Kalup in the middle, your portals on the right.
  Four steps play in turn (pull, edit, plan, apply). Molten dots travel the way data moves in each step.
  Each step prints lines the CLI prints for this change against a simulated sandbox, abridged to fit, and the terminal
  says so.
*/

type Step = {
  id: 'pull' | 'edit' | 'plan' | 'apply'
  caption: string
  command: string
  output: { text: string; tone?: 'muted' | 'add' | 'ok' }[]
  flow: { left: 'in' | 'out' | 'idle'; right: 'in' | 'out' | 'idle' }
}

const STEPS: Step[] = [
  {
    id: 'pull',
    caption: 'Kalup reads your portal and writes what it finds into files. Nothing in the portal changes.',
    command: 'kalup pull --target sandbox',
    output: [
      { text: 'companies: 2 added, 0 changed, 1 unchanged, 0 missing in portal', tone: 'muted' },
      { text: '  added: property:companies/billing_status', tone: 'muted' },
      { text: '  added: group:companies/billing', tone: 'muted' },
      { text: 'wrote hubspot/objects/companies.ts' },
    ],
    flow: { left: 'in', right: 'in' },
  },
  {
    id: 'edit',
    caption: 'You, or your AI agent, change a file. Here: a new company property called Renewal date.',
    command: 'kalup validate',
    output: [{ text: 'Config valid (0 errors, 0 warnings)', tone: 'ok' }],
    flow: { left: 'out', right: 'idle' },
  },
  {
    id: 'plan',
    caption:
      'Kalup compares your files with the portal and lists every change in plain words. Still nothing is written to the portal.',
    command: 'kalup plan --target sandbox',
    output: [
      { text: 'Plan pl_8a2d43f85238 for target sandbox, portal 1111111 (SANDBOX, not protected)', tone: 'muted' },
      { text: 's1 safe Adopt property group "Billing" (billing) on companies' },
      { text: 's2 safe Adopt property "Billing status" (billing_status) on companies' },
      { text: 's3 safe Create property "Renewal date" (renewal_date) on companies', tone: 'add' },
    ],
    flow: { left: 'out', right: 'in' },
  },
  {
    id: 'apply',
    caption:
      'Apply plans again, shows you the steps and writes them once you type the target name, then reads each one back.',
    command: 'kalup apply --target sandbox',
    output: [
      { text: 'Type the target name to apply: sandbox', tone: 'muted' },
      { text: 'Applied plan pl_8a2d43f85238 on target sandbox, portal 1111111', tone: 'muted' },
      { text: 's1 done Adopt property group "Billing" (billing) on companies' },
      { text: 's2 done Adopt property "Billing status" (billing_status) on companies' },
      { text: 's3 done Create property "Renewal date" (renewal_date) on companies', tone: 'ok' },
    ],
    flow: { left: 'idle', right: 'out' },
  },
]

const STEP_MS = 5200

export function Scene() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, 0.35)
  const reduce = useReducedMotion()
  const [step, setStep] = useState(0)
  const [auto, setAuto] = useState(true)
  const [typed, setTyped] = useState(99)
  const s = STEPS[step]

  // advance through the steps while the scene is on screen, until someone picks a step
  // biome-ignore lint/correctness/useExhaustiveDependencies: step restarts the timer so each step gets its full time
  useEffect(() => {
    if (!inView || !auto || reduce) return
    const t = setTimeout(() => setStep((n) => (n + 1) % STEPS.length), STEP_MS)
    return () => clearTimeout(t)
  }, [inView, auto, reduce, step])

  // type the command for each step
  useEffect(() => {
    if (reduce) {
      setTyped(99)
      return
    }
    setTyped(0)
    const timers = Array.from({ length: STEPS[step].command.length }, (_, c) =>
      setTimeout(() => setTyped(c + 1), 250 + c * 45),
    )
    return () => timers.forEach(clearTimeout)
  }, [step, reduce])

  const commandDone = typed >= s.command.length
  const added = step >= 1

  return (
    <div ref={ref} className="relative border border-line-strong bg-paper">
      <CropMarks />
      <div className="grid gap-0 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_64px_minmax(0,1.05fr)_64px_minmax(0,1fr)] lg:items-stretch">
        {/* your files */}
        <Panel title="Your repository" sub="hubspot/objects/companies.ts" active={step <= 1}>
          <pre className="overflow-x-auto font-mono text-[12.5px] leading-[1.75] text-graphite">
            <Line on={step === 0}>{"defineObject('companies', {"}</Line>
            <Line on={step === 0}>{'  name: p.string(...),'}</Line>
            <Line on={step === 0}>{'  billingStatus: p.enum(...),'}</Line>
            {added && (
              <Line on={step === 1} added>
                {'  renewalDate: p.date(...),'}
              </Line>
            )}
            <Line on={step === 0}>{'})'}</Line>
          </pre>
          <p className="mt-3 font-mono text-xs text-muted">
            {step === 0
              ? 'written by kalup pull'
              : step === 1
                ? 'edited by you or your agent'
                : 'reviewed in a pull request'}
          </p>
        </Panel>

        <Flow state={s.flow.left} />

        {/* kalup */}
        <div className="grid min-w-0 grid-rows-[auto_1fr_auto] overflow-hidden rounded-[10px] bg-ink font-mono text-[13px] leading-[1.7] text-[#e9e9e3]">
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 text-xs text-white/55">
            <span aria-hidden className="size-2 bg-molten" />
            Kalup · on your machine or in CI · output abridged
          </div>
          <div className="min-h-[178px] px-4 py-4 [overflow-wrap:anywhere]" aria-live="off">
            <div>
              <span className="text-molten">$ </span>
              {s.command.slice(0, typed)}
              {!commandDone && (
                <span className="inline-block h-[1.05em] w-[0.55em] animate-blink bg-molten align-[-0.2em]" />
              )}
            </div>
            {commandDone &&
              s.output.map((line) => (
                <div
                  key={line.text}
                  className={cn(
                    line.tone === 'muted' && 'text-white/50',
                    line.tone === 'add' && 'text-[#5bd18b]',
                    line.tone === 'ok' && 'text-[#5bd18b]',
                  )}
                >
                  {line.text}
                </div>
              ))}
            {commandDone && step === 2 && (
              <div className="mt-3 inline-flex items-center gap-2 rounded-[3px] bg-molten px-2 py-1 text-xs text-ink">
                you review the plan
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-2.5 text-xs text-white/55">
            <span>writes to your portal</span>
            <span className={cn('tabular-nums', step === 3 ? 'text-molten' : 'text-white/80')}>
              {step === 3 ? '1 (sandbox)' : '0'}
            </span>
          </div>
        </div>

        <Flow state={s.flow.right} />

        {/* your portals */}
        <div className="grid content-start gap-3">
          <Portal name="sandbox" id="1111111" step={step} />
          <Portal name="production" id="2222222" step={step} protectedTarget />
        </div>
      </div>

      {/* the steps */}
      <ol className="grid border-t border-line-strong sm:grid-cols-4">
        {STEPS.map((st, n) => (
          <li key={st.id} className="border-line sm:border-l sm:first:border-l-0">
            <button
              type="button"
              onClick={() => {
                setAuto(false)
                setStep(n)
              }}
              aria-pressed={n === step}
              className={cn(
                'relative grid h-full w-full content-start gap-2 p-4 text-left transition-colors sm:p-5',
                n === step ? 'bg-panel' : 'hover:bg-panel/60',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'absolute inset-x-0 top-0 h-[3px] origin-left bg-molten',
                  n === step ? 'scale-x-100' : 'scale-x-0',
                  n === step && auto && inView && !reduce && 'animate-[scene-progress_5.2s_linear]',
                )}
              />
              <span className="flex flex-wrap items-center gap-2.5">
                <span className="font-mono text-xs text-muted">{n + 1}</span>
                <span className="display text-[28px]">{st.id}</span>
              </span>
              <span className={cn('text-sm leading-snug', n === step ? 'text-ink' : 'text-muted')}>{st.caption}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}

function Panel({ title, sub, active, children }: { title: string; sub: string; active: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        'grid min-w-0 content-start border bg-[#f6f6f2] p-4 transition-colors duration-500 lg:self-start',
        active ? 'border-ink' : 'border-line-strong',
      )}
    >
      <div className="mb-3 grid gap-0.5 border-b border-line pb-3">
        <span className="text-[15px] font-semibold">{title}</span>
        <span className="font-mono text-xs text-muted">{sub}</span>
      </div>
      {children}
    </div>
  )
}

function Line({ children, on, added }: { children: string; on?: boolean; added?: boolean }) {
  return (
    <div
      className={cn(
        '-mx-2 px-2 whitespace-pre transition-colors duration-700',
        added && 'bg-molten/15 text-ink',
        on && (added ? 'bg-molten/35' : 'bg-molten/10'),
      )}
    >
      {added && <span className="text-molten">+</span>}
      {added ? children.slice(1) : children}
    </div>
  )
}

/** The link between two columns. Molten dots travel in the direction data moves. */
function Flow({ state }: { state: 'in' | 'out' | 'idle' }) {
  const dots = 'stroke-molten [stroke-dasharray:0_10] [stroke-linecap:round] [stroke-width:4]'
  const run =
    state === 'idle'
      ? 'opacity-0'
      : state === 'out'
        ? 'animate-[scene-flow_0.6s_linear_infinite]'
        : 'animate-[scene-flow_0.6s_linear_infinite_reverse]'
  return (
    <div aria-hidden className="relative grid h-12 place-items-center lg:h-auto">
      <svg
        aria-hidden="true"
        viewBox="0 0 64 48"
        preserveAspectRatio="none"
        className="hidden h-12 w-16 self-center lg:block"
      >
        <line x1="4" y1="24" x2="60" y2="24" className="stroke-line-strong [stroke-width:1]" />
        <line x1="4" y1="24" x2="60" y2="24" className={cn(dots, run, 'transition-opacity')} />
      </svg>
      <svg aria-hidden="true" viewBox="0 0 48 48" className="h-12 w-12 lg:hidden">
        <line x1="24" y1="4" x2="24" y2="44" className="stroke-line-strong [stroke-width:1]" />
        <line x1="24" y1="4" x2="24" y2="44" className={cn(dots, run, 'transition-opacity')} />
      </svg>
    </div>
  )
}

function Portal({
  name,
  id,
  step,
  protectedTarget = false,
}: {
  name: string
  id: string
  step: number
  protectedTarget?: boolean
}) {
  // only the sandbox is in play; production waits for a merge and a person
  const live = !protectedTarget
  const reading = live && step === 0
  const planned = live && step === 2
  const created = live && step === 3
  return (
    <div
      className={cn(
        'grid gap-2.5 border bg-[#f6f6f2] p-4 transition-colors duration-500',
        reading || created ? 'border-ink' : 'border-line-strong',
        protectedTarget && 'opacity-70',
      )}
    >
      <div className="flex items-baseline justify-between gap-3 border-b border-line pb-2.5">
        <span className="text-[15px] font-semibold">Portal · {name}</span>
        <span className="font-mono text-xs text-muted">{id}</span>
      </div>
      <span className="eyebrow">Company properties</span>
      <ul className="grid gap-1 text-sm">
        {['Name', 'Billing status'].map((p) => (
          <li key={p} className={cn('flex justify-between px-1.5 py-0.5 transition-colors', reading && 'bg-molten/10')}>
            {p}
          </li>
        ))}
        {(planned || created) && (
          <li
            className={cn(
              'flex justify-between px-1.5 py-0.5',
              planned && 'border border-dashed border-line-strong text-muted',
              created && 'bg-molten/25',
            )}
          >
            Renewal date
            <span className="font-mono text-xs">{planned ? 'planned' : 'created'}</span>
          </li>
        )}
      </ul>
      {protectedTarget && (
        <p className="font-mono text-xs text-muted">protected · apply needs a person at a terminal or reviewed CI</p>
      )}
    </div>
  )
}
