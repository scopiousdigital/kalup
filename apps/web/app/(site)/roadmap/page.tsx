import type { Metadata } from 'next'
import { Halftone } from '@/components/site/halftone'
import { AvailabilityTag, Rails, Section, SectionHead } from '@/components/site/primitives'
import { AVAILABILITY_TEXT, type Availability, LATER, NOT_PLANNED, npmUrl, ROADMAP } from '@/lib/site-data'
import { kalupVersion } from '@/lib/version'
import { Rich } from '../_components/rich'
import { Timeline } from './_components/timeline'

export const metadata: Metadata = {
  title: 'Roadmap',
  description: 'What Kalup does today, what comes next, and what comes later. No dates: the order is the promise.',
}

const LEGEND: Availability[] = ['released', 'design', 'next', 'later']

// Shows the version on npm, so the page is rendered again at most once an hour, like the fetch in lib/version.ts.
// Next reads segment config statically, so this stays a literal.
export const revalidate = 3600

export default async function RoadmapPage() {
  const version = await kalupVersion()
  return (
    <>
      <section className="relative overflow-hidden">
        <div className="wrap relative">
          <Rails marks={false} />
          <div className="relative grid items-center gap-x-12 gap-y-10 pt-10 pb-[clamp(56px,8vw,96px)] lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <div className="grid content-start gap-7">
              <span className="eyebrow">Roadmap</span>
              <h1 className="display text-hero">
                The order is the promise. <span className="text-molten">The calendar is not.</span>
              </h1>
              <p className="max-w-[52ch] text-lede text-graphite">
                Kalup{' '}
                <a href={npmUrl} className="text-ink underline underline-offset-2">
                  {version}
                </a>{' '}
                is on npm for properties and property groups. Pipelines, schema writes and association labels come next.
                No dates.
              </p>
            </div>
            <Halftone src="/images/hero.jpg" label="Halftone of a mould being poured" pitch={7} />
          </div>
        </div>
      </section>

      <Section dots>
        <SectionHead
          address="release:sequence"
          title="What gets built, in order."
          lede="What shipped, then the next three, each with live evidence and recovery tests before its writes ship. All of it runs on your machine or in your CI against HubSpot's public APIs, except the hosted service at the end."
        />
        {/* the legend sits where the tags are, so each tag can be read against it */}
        <dl className="mb-8 grid gap-x-6 gap-y-3 text-[13px] text-graphite sm:grid-cols-2 lg:grid-cols-4">
          {LEGEND.map((a) => (
            <div key={a} className="flex items-start gap-2.5">
              <dt className="flex">
                <AvailabilityTag stage={{ availability: a }} />
              </dt>
              <dd>{AVAILABILITY_TEXT[a].meaning}</dd>
            </div>
          ))}
        </dl>
        <Timeline phases={ROADMAP} version={version} />
      </Section>

      <Section>
        <SectionHead
          address="release:later"
          title="Later, in no fixed order."
          lede="None of these has a place in the order yet. Each builds on the same two JSON contracts, the IR and the plan, so none of them changes how what ships above works."
        />
        <ul className="grid gap-px border border-line-strong bg-line-strong sm:grid-cols-2 lg:grid-cols-4">
          {LATER.map((l) => (
            <li key={l.name} className="grid content-start gap-3 bg-paper p-5">
              <h3 className="font-semibold">
                <Rich text={l.name} />
              </h3>
              <p className="text-sm text-graphite">
                <Rich text={l.detail} />
              </p>
            </li>
          ))}
        </ul>
      </Section>

      <Section dots>
        <SectionHead
          address="scope:out"
          title="Not planned."
          lede="Saying what Kalup will not do is part of the roadmap. These are out, not postponed."
        />
        <ul className="grid border-t border-line">
          {NOT_PLANNED.map((n) => (
            <li
              key={n.name}
              className="grid gap-2 border-b border-line py-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] md:gap-10"
            >
              <h3 className="flex items-baseline gap-3 font-semibold">
                <span aria-hidden className="font-mono text-muted">
                  ×
                </span>
                <Rich text={n.name} />
              </h3>
              <p className="text-[15px] text-graphite">
                <Rich text={n.detail} />
              </p>
            </li>
          ))}
        </ul>
      </Section>
    </>
  )
}
