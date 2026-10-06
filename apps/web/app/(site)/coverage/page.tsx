import type { Metadata } from 'next'
import { Drawing } from '@/components/site/drawing'
import { AvailabilityTag, CropMarks, Rails, Section, SectionHead } from '@/components/site/primitives'
import {
  IDENTITY_TEXT,
  MANUAL_ONLY,
  RESOURCE_TYPES,
  AVAILABILITY_TEXT,
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
          <div className="relative grid items-center gap-x-12 gap-y-10 pt-10 pb-[clamp(56px,8vw,96px)] lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
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
          lede="Property and group reads and writes passed live runs. Start on a test account or sandbox."
        />
        <div className="relative border border-line-strong bg-paper">
          <CropMarks />
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[1000px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line-strong">
                  {['Resource', 'Read', 'Write', 'Address', 'Transport', 'Identity', 'Notes'].map((h) => (
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
                    <td className="px-4 py-4">
                      <AvailabilityTag stage={r.read} />
                    </td>
                    <td className="px-4 py-4">
                      <AvailabilityTag stage={r.write} />
                    </td>
                    <td className="px-4 py-4 font-mono text-[13px] whitespace-nowrap text-graphite">{r.type}:…</td>
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
          {/* below md the table would scroll away from Read and Write, so each type is a card */}
          <ul className="md:hidden">
            {RESOURCE_TYPES.map((r) => (
              <li key={r.type} className="grid gap-3 border-b border-line p-4 last:border-b-0">
                <div className="flex items-baseline justify-between gap-3">
                  <b className="font-semibold">{r.name}</b>
                  <span className="font-mono text-xs text-muted">{r.type}:…</span>
                </div>
                <dl className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-xs text-muted">
                  <dt className="eyebrow">Read</dt>
                  <dd className="flex">
                    <AvailabilityTag stage={r.read} />
                  </dd>
                  <dt className="eyebrow">Write</dt>
                  <dd className="flex">
                    <AvailabilityTag stage={r.write} />
                  </dd>
                  <dt className="eyebrow">Transport</dt>
                  <dd className="flex">
                    <TransportChip transport={r.transport} />
                  </dd>
                  <dt className="eyebrow">Identity</dt>
                  <dd className="font-mono text-[13px] text-ink">{r.identity}</dd>
                </dl>
                {r.note && <p className="text-sm text-graphite">{r.note}</p>}
              </li>
            ))}
          </ul>
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
          lede="These settings have no public write API. A plan names the ones it touches, so nobody assumes they were copied."
        />
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          {/* when a plan starts naming each setting, in words: a Released tag would read as if Kalup could write it */}
          <ul className="grid gap-px border border-line-strong bg-line-strong sm:grid-cols-2">
            {MANUAL_ONLY.map((m) => (
              <li key={m.name} className="flex items-baseline justify-between gap-4 bg-paper p-5">
                <span className="font-semibold">{m.name}</span>
                <span className="font-mono text-xs whitespace-nowrap text-muted">
                  named{' '}
                  {m.stage.availability === 'released'
                    ? 'today'
                    : AVAILABILITY_TEXT[m.stage.availability].label.toLowerCase()}
                </span>
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
            <p className="text-[15px] text-graphite">
              <Rich text="Runbook steps, and `kalup attest` to record that a person did one, come later. Edits to these settings are invisible to any API, so Kalup will label them unverifiable." />
            </p>
          </div>
        </div>
      </Section>

      {UNVERIFIED.length > 0 && (
        <Section dots>
          <SectionHead
            address="status:unverified"
            title="Still open."
            lede="These HubSpot behaviours are not confirmed yet. Everything else on this page was seen on a live developer test account, which counts for every account type."
          />
          <ol className="border border-line-strong bg-paper">
            {UNVERIFIED.map((u, n) => (
              <li
                key={u.question}
                className="grid gap-x-8 gap-y-2 border-b border-line p-5 last:border-b-0 md:grid-cols-[40px_minmax(0,7fr)_minmax(0,5fr)]"
              >
                <span className="font-mono text-xs text-muted tabular-nums md:pt-1">
                  {String(n + 1).padStart(2, '0')}
                </span>
                <p className="font-semibold">{u.question}</p>
                <div className="grid content-start gap-2 text-sm text-graphite">
                  <p>{u.decides}</p>
                  {u.observed ? (
                    <details className="text-muted">
                      <summary className="cursor-pointer font-mono text-xs hover:text-ink">What a live run saw</summary>
                      <p className="mt-2">{u.observed}</p>
                    </details>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </Section>
      )}
    </>
  )
}
