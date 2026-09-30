import Link from 'next/link'
import type { ReactNode } from 'react'
import { Drawing, type FigureName } from '@/components/site/drawing'
import { Halftone } from '@/components/site/halftone'
import {
  Address,
  ArrowButton,
  AvailabilityTag,
  CropMarks,
  Rails,
  Section,
  SectionHead,
} from '@/components/site/primitives'
import type { Stage } from '@/lib/site-data'

export type Persona = 'developers' | 'agents' | 'agencies'

export const PERSONAS: Record<Persona, { title: string; line: string; image: string; figure: FigureName }> = {
  developers: {
    title: 'Developers',
    line: 'Ship the property before the code that needs it.',
    image: '/images/braces.jpg',
    figure: 'cast',
  },
  agents: {
    title: 'Agents',
    line: 'Ask for the change. Read the plan.',
    image: '/images/prompt.jpg',
    figure: 'prompt',
  },
  agencies: {
    title: 'Agencies',
    line: 'Every client portal, documented and comparable.',
    image: '/images/tray.jpg',
    figure: 'fleet',
  },
}

/** `stage` only where a step's status differs from the rest, so a tag marks the exception. */
export type Step = { title: string; body: ReactNode; command?: string; stage?: Stage }

/**
 * One shape for all three personas: the hero, the daily flow as a numbered timeline,
 * the proof (terminals, plans, code), what Kalup does not do, the other two personas. The footer carries the call to
 * action.
 */
export function UseCasePage({
  persona,
  lede,
  flowTitle,
  flowLede,
  steps,
  proof,
  notFor,
}: {
  persona: Persona
  lede: ReactNode
  flowTitle: string
  flowLede: string
  steps: Step[]
  proof: ReactNode
  notFor: { title: string; body: ReactNode }[]
}) {
  const p = PERSONAS[persona]
  const others = (Object.keys(PERSONAS) as Persona[]).filter((k) => k !== persona)
  return (
    <>
      <section className="relative overflow-hidden">
        <div className="wrap relative">
          <Rails marks={false} />
          <div className="relative grid items-center gap-12 pt-10 pb-[clamp(56px,8vw,96px)] lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <div className="grid content-start gap-7">
              <Address>use-case:{persona}</Address>
              <h1 className="display text-hero">{p.line}</h1>
              <div className="max-w-[54ch] text-lede text-graphite">{lede}</div>
              <div className="flex flex-wrap gap-3">
                <ArrowButton href="/docs/getting-started">Get started</ArrowButton>
                <ArrowButton href="/how-it-works" tone="ghost">
                  How it works
                </ArrowButton>
              </div>
            </div>
            <CastAndDrawing persona={persona} />
          </div>
        </div>
      </section>

      <Section dots>
        <SectionHead address="flow:daily" title={flowTitle} lede={flowLede} />
        <ol className="relative grid gap-px border border-line-strong bg-line-strong">
          {steps.map((step, n) => (
            <li
              key={step.title}
              className="grid gap-x-8 gap-y-3 bg-paper p-5 md:grid-cols-[72px_minmax(0,1fr)_minmax(0,1.1fr)] md:p-6"
            >
              <span className="font-display text-[44px] leading-none font-extrabold text-molten tabular-nums">
                {String(n + 1).padStart(2, '0')}
              </span>
              <div className="grid content-start gap-2">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h3 className="text-lg font-semibold">{step.title}</h3>
                  {step.stage && <AvailabilityTag stage={step.stage} />}
                </div>
                {step.command && (
                  <code className="w-fit bg-ink px-2 py-1 font-mono text-[13px] text-paper [overflow-wrap:anywhere]">
                    <span className="text-molten">$ </span>
                    {step.command}
                  </code>
                )}
              </div>
              <div className="text-[15px] leading-relaxed text-graphite">{step.body}</div>
            </li>
          ))}
        </ol>
      </Section>

      <Section>{proof}</Section>

      <Section dots>
        <SectionHead
          address="scope:out"
          title="What Kalup does not do for you."
          lede="Knowing where it stops is part of trusting what it does."
        />
        <ul className="grid gap-px border border-line-strong bg-line-strong md:grid-cols-3">
          {notFor.map((item) => (
            <li key={item.title} className="grid content-start gap-2 bg-paper p-6">
              <span aria-hidden className="size-2 bg-ink" />
              <b className="font-semibold">{item.title}</b>
              <p className="text-[15px] text-graphite">{item.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section>
        <SectionHead address="use-cases" title="The other two ways in." />
        <div className="grid gap-4 md:grid-cols-2">
          {others.map((k) => (
            <Link
              key={k}
              href={`/use-cases/${k}`}
              className="group relative grid items-center gap-6 border border-line-strong bg-paper p-5 sm:grid-cols-[180px_minmax(0,1fr)]"
            >
              <CropMarks />
              <Drawing figure={PERSONAS[k].figure} />
              <div className="grid gap-2">
                <h3 className="display text-h3">{PERSONAS[k].title}</h3>
                <p className="text-[15px] text-graphite">{PERSONAS[k].line}</p>
                <span className="font-mono text-[13px] group-hover:text-molten">/use-cases/{k} →</span>
              </div>
            </Link>
          ))}
        </div>
      </Section>
    </>
  )
}

/**
 * Both art forms: the halftone is the part that was cast, the drawing is the sheet it was cast from,
 * pinned over its corner like a drawing clipped to a finished piece.
 */
function CastAndDrawing({ persona }: { persona: Persona }) {
  const p = PERSONAS[persona]
  return (
    <figure className="relative hidden pb-[18%] sm:block sm:pr-[8%]">
      <div className="relative border border-line-strong bg-paper p-3">
        <CropMarks />
        <div className="mb-2.5 border-b border-line pb-2.5 font-mono text-xs text-muted">
          the cast, and the sheet it came from
        </div>
        <Halftone src={p.image} label={`${p.title}: the cast part, as a halftone`} pitch={7} />
      </div>
      <div className="absolute right-0 bottom-0 w-[58%] border border-ink bg-paper p-3 shadow-[0_18px_40px_-24px_rgb(20_20_19/0.55)] sm:w-[52%]">
        <Drawing figure={p.figure} />
      </div>
    </figure>
  )
}
