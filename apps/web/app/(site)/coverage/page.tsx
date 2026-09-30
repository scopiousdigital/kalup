import type { Metadata } from 'next'
import { Drawing } from '@/components/site/drawing'
import { AvailabilityTag, CropMarks, Rails, Section, SectionHead } from '@/components/site/primitives'
import {
  IDENTITY_TEXT,
  MANUAL_ONLY,
  RESOURCE_TYPES,
  STAGE,
  TRANSPORT_TEXT,
  type Transport,
  UNVERIFIED,
} from '@/lib/site-data'
import { Rich } from '../_components/rich'
import { TransportChip } from './_components/transport-chip'

export const metadata: Metadata = {
  title: 'Coverage',
  description:
    'Every HubSpot resource type Kalup reaches, what it can read and write today, and how a change will reach the portal.',
}

const TRANSPORTS: Transport[] = ['public-api', 'public-beta', 'runbook', 'undecided']

export default function CoveragePage() {
  return (
    <>
      <section className="relative overflow-hidden">
        <div className="wrap relative">
          <Rails marks={false} />
          <div className="relative grid items-center gap-10 pt-10 pb-[clamp(56px,8vw,96px)] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <div className="grid content-start gap-7">
              <span className="eyebrow">Coverage</span>
              <h1 className="display text-hero">
                What Kalup can reach, <span className="text-molten">and how.</span>
              </h1>
              <p className="max-w-[52ch] text-lede text-graphite">
                Every resource type, whether Kalup can read it and write it today, and how a change will reach the
                portal. Where HubSpot has no API, the plan says so.
              </p>
            </div>
            <Drawing figure="fleet" />
          </div>
        </div>
      </section>

      <Section dots>
        <SectionHead
          address="registry:types"
          title="Resource types."
          lede="This table is kept by hand, not generated. Properties, groups and custom object schemas follow the endpoint registry, the one place Kalup pins each HubSpot API version. The other types follow the roadmap. Read and write are labelled separately. Live runs on a developer test account back property and group reads and writes; other account types are not verified yet."
        />
        <div className="relative border border-line-strong bg-paper">
          <CropMarks />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line-strong">
                  {['Resource', 'Address', 'Read', 'Write', 'Transport', 'Identity', 'Notes'].map((h) => (
                    <th key={h} scope="col" className="eyebrow px-4 py-3 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {RESOURCE_TYPES.map((r) => (
                  <tr key={r.type} className="border-b border-line align-top last:border-b-0 hover:bg-panel/60">
                    <th scope="row" className="px-4 py-4 font-semibold whitespace-nowrap">
                      {r.name}
                    </th>
                    <td className="px-4 py-4 font-mono text-[13px] whitespace-nowrap text-graphite">{r.type}:…</td>
                    <td className="px-4 py-4">
                      <AvailabilityTag stage={r.read} />
                    </td>
                    <td className="px-4 py-4">
                      <AvailabilityTag stage={r.write} />
                    </td>
                    <td className="px-4 py-4">
                      <TransportChip transport={r.transport} />
                    </td>
                    <td className="px-4 py-4 font-mono text-[13px]">{r.identity}</td>
                    <td className="max-w-[40ch] px-4 py-4 text-graphite">{r.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <dl className="grid gap-3 border border-line-strong bg-paper p-5">
            <dt className="eyebrow">Transport</dt>
            {TRANSPORTS.map((t) => (
              <dd key={t} className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-3 text-sm text-graphite">
                <TransportChip transport={t} />
                {TRANSPORT_TEXT[t]}
              </dd>
            ))}
          </dl>
          <dl className="grid content-start gap-3 border border-line-strong bg-paper p-5">
            <dt className="eyebrow">Identity</dt>
            {(['natural', 'bound'] as const).map((i) => (
              <dd key={i} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 text-sm text-graphite">
                <span className="font-mono text-[13px] text-ink">{i}</span>
                {IDENTITY_TEXT[i]}
              </dd>
            ))}
            <dd className="mt-2 border-t border-dashed border-line-strong pt-3 text-sm text-graphite">
              Not reachable yet: sequences and sales email templates need user-level OAuth, which a target does not
              hold.
            </dd>
          </dl>
        </div>
      </Section>

      <Section>
        <SectionHead
          address="transport:runbook"
          title="No API, no pretending."
          lede="These settings have no public write API. The tag on each says when a plan names it, in one line per type, so nobody assumes it was copied: today for the types Kalup reads, later for the rest. Runbooks in the words of the HubSpot UI, with the page, the fields, the values and a check, come later. Kalup never claims a change it did not make."
        />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <ul className="grid gap-px border border-line-strong bg-line-strong sm:grid-cols-2">
            {MANUAL_ONLY.map((m) => (
              <li key={m.name} className="flex items-center justify-between gap-4 bg-paper p-5">
                <span className="font-semibold">{m.name}</span>
                <AvailabilityTag stage={m.stage} />
              </li>
            ))}
          </ul>
          <div className="grid content-start gap-4">
            <div className="relative border border-line-strong bg-paper p-5">
              <CropMarks />
              <span className="eyebrow">Printed today, once per type the plan touches</span>
              <p className="mt-3 font-mono text-[13px] leading-relaxed text-graphite">
                Not copied, HubSpot has no API: conditional property logic, field-level permissions.
              </p>
            </div>
            <div className="grid gap-3 bg-paper text-[15px] text-graphite">
              <div className="flex">
                <AvailabilityTag stage={STAGE.later} />
              </div>
              <p>
                <Rich text="Runbook steps, and `kalup attest` to record that a person did one, come later. Edits to these settings are invisible to any API, so Kalup will label them unverifiable." />
              </p>
            </div>
          </div>
        </div>
      </Section>

      <Section dots>
        <SectionHead
          address="status:unverified"
          title="Not confirmed yet."
          lede="A few HubSpot behaviours are not documented, or have been seen on one developer test account only. Each stays labelled here until live tests settle it, and Kalup treats it as unknown until then."
        />
        <ol className="grid gap-px border border-line-strong bg-line-strong md:grid-cols-2">
          {UNVERIFIED.map((u, n) => (
            <li key={u.question} className="grid content-start gap-3 bg-paper p-5">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-xs text-muted">question {n + 1}</span>
                <span className="rounded-[3px] bg-[repeating-linear-gradient(-45deg,color-mix(in_oklab,var(--color-risky)_22%,var(--color-paper))_0_5px,var(--color-paper)_5px_10px)] px-2 py-1 font-mono text-[11px] leading-none text-risky-ink shadow-[inset_0_0_0_1px_var(--color-risky)]">
                  unverified
                </span>
              </div>
              <p className="font-semibold">{u.question}</p>
              <p className="text-sm text-graphite">{u.decides}</p>
              {u.observed ? <p className="text-sm text-muted">{u.observed}</p> : null}
            </li>
          ))}
        </ol>
      </Section>
    </>
  )
}
