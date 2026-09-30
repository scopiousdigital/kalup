import type { Metadata } from 'next'
import Link from 'next/link'
import { Drawing } from '@/components/site/drawing'
import { HeatField } from '@/components/site/fields'
import { Halftone } from '@/components/site/halftone'
import { InstallBlock } from '@/components/site/install'
import { AddressMarquee, PourText } from '@/components/site/motion'
import {
  ArrowButton,
  AvailabilityTag,
  CropMarks,
  Meaning,
  Rails,
  RiskChip,
  Section,
  SectionHead,
} from '@/components/site/primitives'
import { Code, PlanStep } from '@/components/site/product'
import { Scene } from '@/components/site/scene'
import { DriftDemo, FourKeys, UseCaseCard } from '@/components/site/showcase'
import { Terminal } from '@/components/site/terminal'
import { ogImage } from '@/lib/shared'
import { RELEASES, STAGE } from '@/lib/site-data'

// The home page sets its own share card; every other page inherits the image and uses its own title.
export const metadata: Metadata = {
  openGraph: {
    type: 'website',
    siteName: 'Kalup',
    url: '/',
    title: 'Kalup: configuration as code for HubSpot',
    description: 'Your HubSpot portal, in a pull request. Open source, on npm.',
    images: [ogImage],
  },
}

const ADDRESSES = [
  'property:companies/billing_status',
  'group:companies/billing',
  'object:subscription',
  'property:deals/renewal_date',
  'property:companies/seat_count',
  'group:deals/renewal',
  'property:contacts/lifecycle_owner',
  'property:companies/billing_notes',
  'group:deals/forecast',
  'property:subscription/plan_tier',
]

const COMPANIES = `// kalup/objects/companies.ts
import { defineObject, p, type InferProperties } from '@kalup/core'

export const Company = defineObject('companies', {
  groups: { billing: { label: 'Billing' } },
  properties: {
    billingStatus: p.enum('billing_status', {
      label: 'Billing status',
      group: 'billing',
      fieldType: 'select',
      options: [
        { value: 'active', label: 'Active' },
        { value: 'PAST DUE', label: 'Past due', as: 'past_due' },
      ],
    }).required(),
    name: p.string('name'),
    renewalDate: p.date('renewal_date', {
      label: 'Renewal date',
      group: 'billing',
      fieldType: 'date',
    }),
  },
})

export type CompanyData = InferProperties<typeof Company.properties> & { id: string }`

const AGENT_POINTS = [
  {
    title: 'Speaks JSON.',
    body: 'Every command takes --json, with fixed exit codes and errors that name the file, line and fix.',
  },
  {
    title: 'Writes its own rules.',
    body: 'kalup init writes an AGENTS.md: edit config and plan, never write to the portal directly.',
  },
  {
    title: 'Stops at the wrong portal.',
    body: 'A key that belongs to another portal stops any command that reads the portal, with exit 4. The fix tells the agent to ask you, never to change the pin.',
  },
  {
    title: 'Stops at production.',
    body: 'Applying to a protected target needs a person at a terminal typing its name, or a reviewed CI job with --approve and a write key only that job holds. Deletes always need the person. An agent cannot say yes for you.',
    stage: STAGE.shipped,
  },
  { title: 'Reads, never obeys.', body: 'Text read from the portal is data, never instructions.' },
]

export default function HomePage() {
  return (
    <>
      {/* 1. Hero */}
      <section className="relative overflow-hidden">
        <HeatField />
        <div className="wrap relative">
          <Rails marks={false} />
          <div className="relative grid items-center gap-10 pt-10 pb-[clamp(56px,8vw,96px)] lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <div className="grid content-start gap-7">
              <span className="eyebrow" data-heat-mask>
                Configuration as code for HubSpot
              </span>
              <h1 className="display text-hero" data-heat-mask>
                Your HubSpot portal, in a <span className="text-molten">pull request.</span>
              </h1>
              <p className="max-w-[52ch] text-lede text-graphite" data-heat-mask>
                Keep HubSpot properties and property groups in TypeScript files, in git. Kalup shows every change as a
                plan and writes only what you approve, to any portal you name. Edits made in the HubSpot UI are held,
                not reverted, and the same files type your app. For HubSpot developers and agencies. Open source,
                Apache-2.0.
              </p>
              <div id="install" className="scroll-mt-24">
                <InstallBlock />
              </div>
              <div className="flex flex-wrap gap-3">
                <ArrowButton href="/how-it-works">How it works</ArrowButton>
                <ArrowButton href="/docs" tone="ghost">
                  Read the docs
                </ArrowButton>
              </div>
            </div>
            <figure className="grid gap-5">
              <Drawing figure="pour" />
              <figcaption data-heat-mask>
                <Meaning />
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      <AddressMarquee addresses={ADDRESSES} />

      {/* 2. Where Kalup sits */}
      <Section>
        <SectionHead
          address="kalup:overview"
          title="Where Kalup sits."
          lede="Between the files in your repository and your HubSpot portals. Every change goes through a plan you can read before anything is written."
        />
        <Scene />
      </Section>

      {/* 3. The problem */}
      <section className="relative border-t border-line bg-paper">
        <div className="wrap relative">
          <Rails />
          <PourText text="Portals are configured by hand, and nothing records why.">
            <div className="grid max-w-[980px] gap-x-8 gap-y-4 md:grid-cols-3">
              {[
                ['No file.', 'The config lives in the portal and nowhere else.'],
                ['No diff.', 'A change lands the moment someone clicks save.'],
                ['No history.', 'The audit log API needs Enterprise. Below that, history is what people remember.'],
              ].map(([title, body]) => (
                <p key={title} className="text-[15px] text-graphite">
                  <b className="block font-semibold text-ink">{title}</b>
                  {body}
                </p>
              ))}
            </div>
            <p className="max-w-[60ch] text-lede text-ink">
              And now AI agents can change your portal from a prompt.{' '}
              <span className="bg-molten px-1">A prompt is not a review.</span>
            </p>
          </PourText>
        </div>
      </section>

      {/* 4. The plan is the product */}
      <Section>
        <SectionHead
          address="plan/1"
          title="Read the plan, not the config."
          lede="Every step names the resource, the risk and the exact values before and after. Titles use the words of the HubSpot UI, so an admin can approve a change without reading TypeScript."
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="grid content-start gap-4">
            <PlanStep
              op="~"
              title={'Adopt property "Billing status" (billing_status) on companies, add options "Past due"'}
              address="property:companies/billing_status"
              risk="safe"
              changes={[
                { unit: 'options[PAST DUE]', kind: 'add', detail: '+ add { value: "PAST DUE", label: "Past due" }' },
                {
                  unit: 'label',
                  kind: 'held',
                  detail: (
                    <>
                      <b className="font-semibold text-risky-ink">held · diverged</b>
                      <br />
                      config "Billing status" · portal "Billing state"
                    </>
                  ),
                },
              ]}
              expect="expect: exists · options = every live option, as read"
            />
            <div className="grid gap-3 border border-line-strong bg-paper p-5">
              <span className="eyebrow">Every step carries one risk</span>
              <div className="flex flex-wrap gap-2">
                <RiskChip risk="safe" />
                <RiskChip risk="risky" />
                <RiskChip risk="destructive" />
                <RiskChip risk="blocked" />
                <RiskChip risk="manual" />
              </div>
              <p className="text-sm text-graphite">
                Each step also records what it expects to find. Apply re-checks that right before each write, and stops
                if the portal changed since you approved.
              </p>
              <div className="flex">
                <AvailabilityTag stage={STAGE.shipped} />
              </div>
            </div>
          </div>
          <Terminal
            title="acme-crm · zsh"
            command="kalup plan --target sandbox"
            output={[
              'Plan pl_6fcf740d2b33 for target sandbox, portal 1111111 (SANDBOX, not protected)',
              [
                {
                  text: 'Settings: mode addon; adopt hold; drift hold; allowDestroy false; yesLimit 25',
                  tone: 'muted',
                },
              ],
              [
                { text: 's1 ' },
                { text: 'safe', tone: 'add' },
                { text: ' Adopt property group "Billing" (billing) on companies' },
              ],
              [
                { text: 's2 ' },
                { text: 'safe', tone: 'add' },
                { text: ' Adopt property "Billing status" (billing_status) on companies, add option "Trial"' },
              ],
              '  + option "Trial" ("trial")',
              [
                {
                  text: '  held label drift: config "Billing status", portal "Billing state", last agreed "Billing status". Take the portal side: kalup pull --target sandbox --only property:companies/billing_status; take config: kalup plan --target sandbox --take config \'property:companies/billing_status#label\'',
                  tone: 'hold',
                },
              ],
              [
                { text: 's3 ' },
                { text: 'safe', tone: 'add' },
                { text: ' Create property "Churn reason" (churn_reason) on companies' },
              ],
              '  label "Churn reason", group billing, fieldType "text"',
              [
                { text: 's4 ' },
                { text: 'safe', tone: 'add' },
                { text: ' Adopt property "Seats" (seat_count) on companies, set label' },
              ],
              '  label: "Seat count" -> "Seats"',
              '4 safe, 0 risky, 0 destructive, 0 blocked, 0 manual; 1 held',
              [{ text: 'Coverage: complete; 0 unsupported, 0 skipped.', tone: 'muted' }],
              [
                {
                  text: 'Not copied, HubSpot has no API: conditional property logic, field-level permissions.',
                  tone: 'muted',
                },
              ],
            ]}
          />
        </div>
      </Section>

      {/* 5. Safe by default: drift is held, absence never deletes */}
      <Section dots>
        <SectionHead
          address="safety"
          title="Nothing changes behind your back."
          lede="People keep editing the portal in the HubSpot UI, and that is fine. Kalup holds those edits instead of overwriting them, and deleting a line from a file deletes nothing."
        />
        <div className="grid gap-12">
          <div className="grid gap-5">
            <h3 className="display text-h3">Edits in the UI are held.</h3>
            <DriftDemo />
          </div>
          <div className="grid gap-5">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="display text-h3">A delete needs four keys.</h3>
              <AvailabilityTag stage={STAGE.shipped} />
            </div>
            <FourKeys />
          </div>
        </div>
      </Section>

      {/* 6. Agents */}
      <Section>
        <SectionHead
          address="envelope/1"
          title="Let the agent do the typing. Keep the approval."
          lede="Kalup is built to be driven by Claude Code and other agents. When a person is needed, it stops and says so."
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <ul className="grid content-start gap-px border border-line-strong bg-line-strong">
            {AGENT_POINTS.map((point) => (
              <li key={point.title} className="bg-paper p-5 text-[15px] text-graphite">
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <b className="block font-semibold text-ink">{point.title}</b>
                  {point.stage && <AvailabilityTag stage={point.stage} />}
                </span>
                {point.body}
              </li>
            ))}
          </ul>
          <Terminal
            title="agent session · zsh"
            command="kalup plan --target production --json"
            output={[
              '{',
              '  "format": "envelope/1",',
              '  "ok": false,',
              '  "issues": [',
              '    {',
              [{ text: '      "code": "E_TARGET_PORTAL_MISMATCH",', tone: 'error' }],
              '      "message": "The key in HUBSPOT_PROD_READ_KEY belongs to portal 1111111, not portal 2222222 pinned for target production.",',
              '      "configPath": "targets.production.portalId",',
              '      "fix": "The key in HUBSPOT_PROD_READ_KEY belongs to portal 1111111. Ask the user to check the key and the pinned portalId for target production. For a recreated test portal or sandbox, the user can run kalup target rebind production --portal <id> in a terminal; it refuses STANDARD accounts.",',
              [{ text: '      "humanRequired": true,', tone: 'hold' }],
              '      "docs": "errors/E_TARGET_PORTAL_MISMATCH.md"',
              '    }',
              '  ]',
              '}',
              [{ text: '# exit 4: a person is needed', tone: 'muted' }],
            ]}
          />
        </div>
      </Section>

      {/* 7. One file, two jobs */}
      <Section dots>
        <SectionHead
          address="InferProperties"
          title="The file that shapes the portal also types your app."
          lede="Import your object files and get exact types and codecs. No generate step, no hand-typed property names drifting away from the portal."
        />
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <Code file="kalup/objects/companies.ts" code={COMPANIES} />
          <div className="relative grid gap-3 border border-line-strong bg-paper p-5">
            <CropMarks />
            <span className="eyebrow">In your editor</span>
            <pre className="font-mono text-[13px] leading-[1.7] text-graphite">
              {'company.'}
              <span className="bg-molten/25">billingStatus</span>
            </pre>
            <div className="border border-line-strong bg-[#f6f6f2] font-mono text-[13px] shadow-[0_12px_30px_-18px_rgb(20_20_19/0.5)]">
              {[
                ['billingStatus', "'active' | 'past_due' | Unlisted"],
                ['renewalDate', 'string | null'],
                ['name', 'string | null'],
              ].map(([key, type], n) => (
                <div key={key} className={`flex justify-between gap-4 px-3 py-2 ${n === 0 ? 'bg-ink text-paper' : ''}`}>
                  <span>{key}</span>
                  <span className={n === 0 ? 'text-molten' : 'text-muted'}>{type}</span>
                </div>
              ))}
            </div>
            <p className="text-sm text-graphite">
              <code className="font-mono">'PAST DUE'</code> in the portal is{' '}
              <code className="font-mono">'past_due'</code> in your code, and a value an admin adds later reads as{' '}
              <code className="font-mono">Unlisted</code> instead of breaking the app.{' '}
              <code className="font-mono">.strict()</code> narrows the type to the listed values.
            </p>
          </div>
        </div>
      </Section>

      {/* 8. Who it is for */}
      <Section>
        <SectionHead
          address="use-cases"
          title="Three ways in."
          lede="Same files, same plan, three daily flows. Move your cursor over the metal."
        />
        <div className="grid gap-4 md:grid-cols-3">
          <UseCaseCard
            href="/use-cases/developers"
            title="Developers"
            line="Ship the property before the code that needs it. The same files type your app, a plan shows the portal change, and apply writes it to your sandbox."
            image="/images/braces.jpg"
            path="/developers"
          />
          <UseCaseCard
            href="/use-cases/agents"
            title="Agents"
            line="For admins working through Claude Code. Ask for the change, read the plan, then apply it yourself at a terminal."
            image="/images/prompt.jpg"
            path="/agents"
          />
          <UseCaseCard
            href="/use-cases/agencies"
            title="Agencies"
            line="Every client portal pulled into files, documented, and set up from the same blueprint."
            image="/images/tray.jpg"
            path="/agencies"
          />
        </div>
      </Section>

      {/* 9. Honest about limits */}
      <Section dots>
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <SectionHead
              address="transport:runbook"
              title="When HubSpot has no public API, Kalup says so."
              className="md:grid-cols-1"
            />
            <p className="mb-8 max-w-[52ch] text-lede text-graphite">
              Some settings can only be changed in the UI or through endpoints HubSpot has not published. Today the plan
              names them, once per type, so nobody assumes they were copied. Later, it will print a runbook with the
              page, the fields and the values for a person to follow. Kalup never claims a change it could not make.
            </p>
            <ArrowButton href="/coverage" tone="ghost">
              See full coverage
            </ArrowButton>
          </div>
          <div className="relative border border-line-strong bg-paper">
            <CropMarks />
            <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-3">
              <span className="eyebrow">A runbook step, as planned</span>
              <AvailabilityTag stage={STAGE.later} />
            </div>
            <div className="flex items-start justify-between gap-4 border-b border-line p-4">
              <div className="min-w-0 [overflow-wrap:anywhere]">
                <div className="font-semibold">Set required properties for stage "Closed won"</div>
                <div className="font-mono text-xs text-muted">stage:deals/enterprise/closed_won · runbook</div>
              </div>
              <RiskChip risk="manual" />
            </div>
            <ol className="grid gap-2 p-4 text-sm text-graphite">
              <li>1. Open the settings for the deal pipeline "Enterprise".</li>
              <li>2. Edit the stage "Closed won".</li>
              <li>3. Make "Renewal date" and "Billing status" required on that stage.</li>
              <li className="font-mono text-xs text-muted">verify: both properties show as required on the stage</li>
            </ol>
            <div className="border-t border-dashed border-line-strong px-4 py-3 font-mono text-xs text-muted">
              Today the plan prints: Not copied, HubSpot has no API: conditional property logic, field-level
              permissions.
            </div>
          </div>
        </div>
      </Section>

      {/* 10. Open source */}
      <Section>
        <div className="grid items-end gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="grid gap-6">
            <SectionHead
              address="licence:apache-2.0"
              title="Free, and it stays free."
              className="mb-0 md:grid-cols-1"
            />
            <p className="max-w-[56ch] bg-paper text-lede text-graphite">
              Apache-2.0. Everything that runs on your machine or in your CI against HubSpot's public APIs is free and
              stays free. The licence will not tighten.
            </p>
            <div className="flex flex-wrap gap-3">
              <ArrowButton href="/open-source">The open source promise</ArrowButton>
              <ArrowButton href="/roadmap" tone="ghost">
                Roadmap
              </ArrowButton>
            </div>
          </div>
          <div className="grid gap-4">
            <Halftone src="/images/perforated.jpg" label="A perforated plate lit orange from below" pitch={9} />
            <ol className="grid grid-cols-2 gap-px border border-line-strong bg-line-strong md:grid-cols-4 lg:grid-cols-2">
              {RELEASES.map((part) => (
                <li key={part.name} className="grid content-start gap-1 bg-paper p-3">
                  <span className="flex items-center gap-2 text-[13px] font-semibold">
                    <span aria-hidden className="size-2 flex-none bg-molten" />
                    {part.name}
                  </span>
                  <span className="text-xs text-graphite">{part.detail}</span>
                  <span className="mt-1 flex">
                    <AvailabilityTag stage={part.stage} />
                  </span>
                </li>
              ))}
            </ol>
            <Link href="/roadmap" className="font-mono text-[13px] text-muted hover:text-ink">
              0.1.0 is out. Pipelines, schema writes and association labels come next →
            </Link>
          </div>
        </div>
      </Section>
    </>
  )
}
