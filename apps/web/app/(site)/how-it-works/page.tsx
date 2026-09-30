import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'
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
import { Code, PlanStep } from '@/components/site/product'
import { Terminal } from '@/components/site/terminal'
import { STAGE } from '@/lib/site-data'
import { ClassTable } from './_components/class-table'
import { PathDiagram } from './_components/path-diagram'

export const metadata: Metadata = {
  title: 'How it works',
  description:
    'How Kalup gets from a file to a portal: targets, a config grammar that is parsed and never executed, classification and the plan, the state file, apply and the CI recipe.',
}

const CONFIG = `// kalup.config.ts
import { defineConfig } from '@kalup/core'

export default defineConfig({
  name: 'acme-crm',
  objects: {
    companies: { include: ['name', 'domain'] },
    subscription: {},
  },
  targets: {
    sandbox: { portalId: 1111111, credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } } },
    production: {
      portalId: 2222222,
      protected: true,
      drift: 'hold',
      credentials: { read: { env: 'HUBSPOT_PROD_READ_KEY' }, write: { env: 'HUBSPOT_PROD_WRITE_KEY' } },
    },
  },
})`

const ACCEPTED = `// Set by the billing sync. Do not edit by hand.
billingStatus: p.enum('billing_status', {
  label: 'Billing status',
  group: 'billing',
  fieldType: 'select',
  options: [
    { value: 'active', label: 'Active' },
    { value: 'PAST DUE', label: 'Past due', as: 'past_due' },
  ],
}).required(),`

const REJECTED = `const shared = { group: 'billing', fieldType: 'select' }

billingStatus: p.enum('billing_status', {
  ...shared,
  label: 'Billing status',
}),`

const STATE = `{
  "format": "kalup.state/1",
  "lastApply": { "actor": "--approve", "at": "2026-09-28T16:51:14.178Z", "outcome": "done", "planId": "pl_8a2d43f85238" },
  "lineage": "a70f763f50f8bf47",
  "portalId": 2222222,
  "resources": {
    "property:companies/billing_status": {
      "base": { "fieldType": "select", "label": "Billing status", "type": "enumeration" },
      "id": "billing_status",
      "normVersion": 1,
      "origin": "adopted"
    }
  },
  "serial": 5
}`

const CI = `# The apply job after merge to main, abridged. A design, not yet run in a real CI.
concurrency: { group: kalup-portal-2222222, cancel-in-progress: false }
env: { KALUP_STATE_DIR: .kalup-state/state }
steps:
  - run: git fetch origin kalup-state/portal-2222222 && git worktree add -B kalup-state/portal-2222222 .kalup-state FETCH_HEAD
  - run: npx kalup plan --target production --out plan.json
  - run: npx kalup apply plan.json --approve "$REVIEWED_HASH"   # the writesHash posted on the pull request
  - if: always()
    run: cd .kalup-state && git add state && git commit -m "Apply $GITHUB_SHA" && git push origin HEAD:kalup-state/portal-2222222`

const IR = `{
  "irVersion": 1,
  "project": "acme-crm",
  "resources": {
    "property:companies/billing_status": {
      "binding": { "codec": "enum", "key": "billingStatus", "required": true },
      "definition": {
        "fieldType": "select",
        "group": { "$ref": "group:companies/billing" },
        "label": "Billing status",
        "type": "enumeration"
      },
      "managed": true,
      "type": "property"
    }
  },
  "targets": {
    "production": { "portalId": 2222222, "protected": true },
    "sandbox": { "portalId": 1111111 }
  }
}`

const PLAN = `{
  "format": "plan/1",
  "planId": "pl_3f9a1c07b2e4",
  "target": { "name": "production", "portalId": 2222222, "protected": true, "drift": "hold" },
  "counts": { "safe": 2, "risky": 0, "destructive": 0, "blocked": 0, "manual": 0, "held": 1 },
  "writesHash": "sha256:3f9a1c07b2e40b7e",
  "steps": [
    {
      "address": "property:companies/renewal_date",
      "action": "create",
      "risk": "safe",
      "transport": "public-api",
      "expect": { "exists": false }
    }
  ]
}`

function Point({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="bg-paper p-5 text-[15px] text-graphite">
      <b className="block font-semibold text-ink">{title}</b>
      {children}
    </li>
  )
}

const ANATOMY: [string, string][] = [
  ['address', 'The resource, as <type>:<path>. The same string in config, IR, plan and state.'],
  [
    'action',
    'create, adopt, update, delete, release or unknown, where a read could not tell. manual is kept for runbooks, which come later.',
  ],
  [
    'risk',
    'safe, risky, destructive, blocked or manual. Risky needs a person or a reviewed CI job; destructive always needs the person.',
  ],
  ['transport', 'How the step reaches the portal: public-api today; public-beta and runbook are kept for later types.'],
  ['title', "HubSpot's own UI wording, from a fixed template."],
  ['changes', 'Each unit with its value before and after.'],
  ['held', 'Fields the plan will not write, with the class that held them.'],
  ['expect', 'What the portal must still look like. Apply re-checks it right before the write.'],
]

const APPLY_LOOP = [
  ['re-check', 'expect still holds'],
  ['write', 'one step, serially'],
  ['read back', 'confirm the result'],
  ['advance base', 'only where config and portal agree'],
]

export default function HowItWorksPage() {
  return (
    <>
      {/* hero */}
      <section className="relative overflow-hidden">
        <div className="wrap relative">
          <Rails marks={false} />
          <div className="relative grid items-center gap-10 pt-10 pb-[clamp(56px,8vw,96px)] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <div className="grid content-start gap-7">
              <span className="eyebrow">How it works</span>
              <h1 className="display text-hero">
                From a file to a portal, <span className="text-molten">one reviewed step</span> at a time.
              </h1>
              <p className="max-w-[52ch] bg-paper text-lede text-graphite">
                Kalup reads your files and your portal, works out the difference, and writes a plan in HubSpot's own
                words. Apply writes that plan and nothing else. This page follows the path end to end and labels what is
                not built yet.
              </p>
              <div className="flex flex-wrap gap-3">
                <ArrowButton href="/docs">Read the docs</ArrowButton>
                <ArrowButton href="/coverage" tone="ghost">
                  See coverage
                </ArrowButton>
              </div>
            </div>
            <figure className="grid gap-3">
              <Halftone src="/images/hero.jpg" label="Halftone of a mould with brace cavities being poured" />
              <figcaption className="font-mono text-xs text-muted">
                The mould is your config. The plan is the pour. The cast is your portal.
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      {/* the whole path */}
      <Section dots>
        <SectionHead
          address="ir/1 → plan/1"
          title="The whole path, on one sheet."
          lede="Two versioned JSON documents hold the system together: the IR says what your files mean, the plan says what apply would do to one target. Everything else reads one of the two."
        />
        <div className="relative border border-line-strong bg-paper p-[clamp(16px,3vw,32px)]">
          <CropMarks />
          <PathDiagram />
          <p className="mt-4 flex flex-wrap items-center gap-3 font-mono text-xs text-muted">
            <AvailabilityTag stage={STAGE.shipped} />
            In 0.1.0: the executor, the state file, kalup/removed.ts and the merge from a base.
          </p>
        </div>
      </Section>

      {/* 1. targets */}
      <Section>
        <SectionHead
          address="target:production"
          title="A target is a portal with a name and a pin."
          lede="Each target in your config names a portal and pins it to a portal ID. Kalup refuses to read, plan or apply when the key belongs to a different portal, so a sandbox key can never touch production by mistake."
        />
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <Code file="kalup.config.ts" code={CONFIG} />
          <div className="grid gap-4">
            <Terminal
              title="acme-crm · zsh"
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
            <p className="text-sm text-graphite">
              The fix never says "change the pin". Fix hints never tell an agent to switch off a safety check.
            </p>
          </div>
        </div>
      </Section>

      {/* 2. parsed, never executed */}
      <Section dots>
        <SectionHead
          address="E_NOT_DATA"
          title="Your files look like TypeScript. Kalup reads them as data."
          lede="The app runs the object files for types and codecs. Kalup never does. It parses a small grammar and prints it back in one canonical form, which is why an agent can edit it safely and pull can write it back without losing your comments."
        />
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <div className="grid gap-3">
            <span className="eyebrow">Accepted: literals, builders, leading comments</span>
            <Code file="kalup/objects/companies.ts" code={ACCEPTED} />
          </div>
          <div className="grid gap-3">
            <span className="eyebrow">Rejected: spreads, loops, other calls</span>
            <Code file="kalup/objects/companies.ts" code={REJECTED} />
            <div className="relative border border-line-strong bg-paper p-4 font-mono text-[13px] leading-normal">
              <span className="font-semibold text-destructive">E_NOT_DATA</span>
              <span className="text-muted"> · kalup/objects/companies.ts:4 · companies.properties.billingStatus</span>
              <br />
              expected a key but found '.'
              <br />
              <span className="text-muted">
                fix: write key: value entries only; no spreads, computed keys or shorthand
              </span>
            </div>
          </div>
        </div>
        <ul className="mt-8 grid gap-px border border-line-strong bg-line-strong md:grid-cols-3">
          <Point title="One canonical form.">
            Properties sorted by internal name, options in display order, quotes and line breaks as biome would write
            them.
          </Point>
          <Point title="Round trips, tested.">
            Writing what was parsed gives back the same text, and a second pull with no portal change is byte-identical.
          </Point>
          <Point title="Nothing runs.">
            A config file cannot run code in the tool, because the tool never executes it.
          </Point>
        </ul>
      </Section>

      {/* 3. two truths and a state file */}
      <Section>
        <SectionHead
          address=".kalup/state/portal-2222222.json"
          title="Two truths and a small state file."
          lede={
            <>
              <AvailabilityTag stage={STAGE.shipped} /> Config is the truth for what you intend. The portal is the truth
              for what exists. Between them, one file per portal records what config and the portal last agreed on, so a
              plan can tell your change from someone else's.
            </>
          }
        />
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <ol className="grid gap-px border border-line-strong bg-line-strong">
            <Point title="Safety never depends on state.">
              A missing or stale base makes the plan hold and ask. It never overwrites.
            </Point>
            <Point title="State describes the portal, not the code.">
              It is gitignored and never lives on a working branch. In the CI recipe, a design not yet run in a real CI,
              it lives on a branch of its own, one per portal.
            </Point>
            <Point title="Apply and pull move it forward.">
              The base advances only where config and portal agree. Held drift stays held across any number of applies.
            </Point>
            <Point title="Nothing sensitive inside.">
              The kalup.state/1 schema has no place for tokens, record data, fields Kalup does not own or resources it
              does not manage.
            </Point>
          </ol>
          <Code file=".kalup/state/portal-2222222.json, abridged" code={STATE} />
        </div>
      </Section>

      {/* 4. classification */}
      <Section dots>
        <SectionHead
          address="class:*"
          title="Five classes. Three of them hold."
          lede="Every owned field is compared three ways: config against the last applied base, the portal against the same base. The answer is one of five classes, and the default for anything someone else touched is to hold. Until there is a base, a field is converged or diverged."
        />
        <ClassTable />
        <div className="mt-6 grid gap-4 text-[15px] text-graphite md:grid-cols-3">
          <p>
            <b className="block font-semibold text-ink">Take the portal's side.</b>
            <code className="font-mono text-[0.9em]">kalup pull</code> brings the portal's values into your files.
          </p>
          <div className="grid content-start gap-2">
            <span className="flex flex-wrap items-center gap-3">
              <b className="font-semibold text-ink">Take yours.</b>
              <AvailabilityTag stage={STAGE.shipped} />
            </span>
            <p>
              <code className="font-mono text-[0.9em]">kalup plan --take config {'<address#field>'}</code> writes your
              value and labels the step <code className="font-mono text-[0.9em]">reverts-ui-edit</code>, at risk risky.
            </p>
          </div>
          <div className="grid content-start gap-2">
            <span className="flex flex-wrap items-center gap-3">
              <b className="font-semibold text-ink">A personal sandbox.</b>
              <AvailabilityTag stage={STAGE.shipped} />
            </span>
            <p>
              A target can set <code className="font-mono text-[0.9em]">drift: 'overwrite'</code>, and the default
              everywhere is hold. It acts where state holds a base: drift and conflicts are written, labelled
              reverts-ui-edit.
            </p>
          </div>
        </div>
        <p className="mt-6 font-mono text-xs text-muted">
          Before a pull or an apply records a base, a difference on an existing resource shows as diverged, and it is
          held like the rest.
        </p>
      </Section>

      {/* 5. anatomy of a plan */}
      <Section>
        <SectionHead
          address="plan/1#steps"
          title="Anatomy of a plan step."
          lede="A plan is self-contained: apply reads the plan, the target in kalup.config.ts, credentials and state, never your object files. Each step carries everything a person needs to approve it."
        />
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="grid gap-4">
            <PlanStep
              op="~"
              title={'Adopt property "Billing status" (billing_status) on companies, add options "Reseller"'}
              address="property:companies/billing_status"
              risk="safe"
              changes={[
                { unit: 'options[reseller]', kind: 'add', detail: '+ add { value: "reseller", label: "Reseller" }' },
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
            <div className="relative grid gap-2 border border-line-strong bg-panel p-4 font-mono text-[13px] leading-normal">
              <span className="eyebrow">The plan header</span>
              <span>
                counts: <span className="text-safe">safe 2</span> · held 1
              </span>
              <span className="[overflow-wrap:anywhere]">writesHash: sha256:3f9a1c07b2e40b7e</span>
              <span className="text-muted">planId: pl_3f9a1c07b2e4</span>
            </div>
          </div>
          <dl className="grid border-t border-line">
            {ANATOMY.map(([field, body]) => (
              <div key={field} className="grid grid-cols-[110px_minmax(0,1fr)] gap-4 border-b border-line py-3">
                <dt className="font-mono text-[13px] font-semibold">
                  <span aria-hidden className="mr-2 inline-block size-1.5 bg-molten align-middle" />
                  {field}
                </dt>
                <dd className="text-[15px] text-graphite">{body}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="mt-8 grid gap-4 text-[15px] text-graphite md:grid-cols-2">
          <p>
            <b className="block font-semibold text-ink">Approval binds to what would change.</b>
            The writesHash covers the destination (target and portal ID), the effective policy, the state lineage, the
            relevant bindings, and every step that creates, adopts, updates or deletes, with your desired values and the
            portal values it expects. Titles, counts, held values and times stay out, so an edited title or a new held
            value changes nothing.
          </p>
          <p>
            <b className="block font-semibold text-ink">It says what it cannot do.</b>
            Plans print, once per type, what a step cannot copy because HubSpot has no API for it. A plan that stays
            silent about that would mislead more than a wrong label.
          </p>
        </div>
      </Section>

      {/* 6. apply */}
      <Section dots>
        <SectionHead
          address="kalup apply"
          title="Apply writes the plan and nothing more."
          lede={
            <>
              <AvailabilityTag stage={STAGE.shipped} /> For properties and property groups. Steps run one at a time,
              destructive steps last, each checked before and read back after. There is no rollback verb and no resume:
              recovery is a new plan.
            </>
          }
        />
        <ol className="grid gap-px border border-line-strong bg-line-strong sm:grid-cols-2 lg:grid-cols-4">
          {APPLY_LOOP.map(([step, detail], n) => (
            <li key={step} className="relative grid gap-2 bg-paper p-5">
              <span className="font-mono text-xs text-muted">per step · {n + 1} of 4</span>
              <b className="display text-h3">{step}</b>
              <span className="text-sm text-graphite">{detail}</span>
              {n < APPLY_LOOP.length - 1 && (
                <span
                  aria-hidden
                  className="absolute top-1/2 -right-2 z-10 hidden size-4 rotate-45 bg-molten lg:block"
                />
              )}
            </li>
          ))}
        </ol>
        <ul className="mt-8 grid gap-px border border-line-strong bg-line-strong md:grid-cols-2 lg:grid-cols-3">
          <Point title="A person for anything risky.">
            A risky step needs someone at a real terminal typing the target name, or a reviewed CI job's --approve. A
            destructive step always needs the person, who also types the count.
          </Point>
          <Point title="Saved plans for protected targets.">
            A protected target accepts only a saved plan file, never a plan made on the fly.
          </Point>
          <Point title="--yes has a ceiling.">
            It covers an unprotected target with only safe steps, and at most 25 writes, adoptions and releases.
          </Point>
          <Point title="One shared budget.">
            All requests share one rate limiter, and apply refuses when its calls would use more than half of the
            portal's daily calls left.
          </Point>
          <Point title="Partial is reported, not hidden.">
            An apply that does not finish exits 5. Run plan again to see where things stand.
          </Point>
          <Point title="Deletes need four keys.">
            A tombstone, ownership in this target, a policy that allows it, and a person at a terminal.
          </Point>
        </ul>
      </Section>

      {/* 7. CI */}
      <Section>
        <SectionHead
          address="ci:github"
          title="In CI, the property ships before the code."
          lede={
            <>
              <AvailabilityTag stage={STAGE.design} /> The coordinated recipe, documented as a design and not yet run in
              a real CI. The pull request carries the production plan and its writesHash as a comment. After merge, one
              job per portal, holding the production write key, plans again and applies with the reviewed hash, then the
              app deploys.
            </>
          }
        />
        <ol className="mb-6 grid gap-px border border-line-strong bg-line-strong md:grid-cols-3">
          {[
            [
              'On the pull request',
              'kalup plan --target production --out plan.json runs with the read key, and the job posts the plan and its writesHash as a comment.',
            ],
            [
              'After merge',
              'The job plans again and runs kalup apply plan.json --approve with the reviewed hash. A plan that moved since the review is refused.',
            ],
            ['Then the app', 'The deploy runs after apply, so the property exists before the code that reads it.'],
          ].map(([title, body]) => (
            <li key={title} className="grid gap-2 bg-paper p-5">
              <b className="font-semibold">{title}</b>
              <span className="text-sm text-graphite">{body}</span>
            </li>
          ))}
        </ol>
        <Code file=".github/workflows/kalup.yml (steps)" code={CI} />
        <p className="mt-4 max-w-[80ch] text-sm text-graphite">
          In the recipe, state lives on a branch per portal,{' '}
          <code className="font-mono">kalup-state/portal-2222222</code>, checked out as a worktree that{' '}
          <code className="font-mono">KALUP_STATE_DIR</code> names. One job per portal writes at a time, in a
          concurrency group that never cancels a run in progress. A rejected push after apply is a recovery incident,
          never a lock. Deletes never run in CI: --approve never covers one. The{' '}
          <Link href="/docs/guides/several-portals" className="underline underline-offset-2">
            Sandbox, production and CI
          </Link>{' '}
          guide has the full workflow.
        </p>
      </Section>

      {/* 8. two contracts */}
      <Section dots>
        <SectionHead
          address="schema:ir/1 · schema:plan/1"
          title="Two JSON contracts. Build on either."
          lede="Both documents have a JSON Schema that ships in the kalup package as kalup/schemas/<file>. Before 1.0 a minor release may change them, and its release notes say so. From 1.0 they change only by addition. kalup docs reads the IR today, and any tool you write can read either. None of them needs the TypeScript."
        />
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <div className="grid gap-3">
            <Address>ir/1 · what your files mean</Address>
            <Code file="kalup ir, abridged" code={IR} />
          </div>
          <div className="grid gap-3">
            <Address>plan/1 · what apply would do</Address>
            <Code file="plan.json from kalup plan --out, abridged" code={PLAN} />
          </div>
        </div>
        <p className="mt-6 max-w-[80ch] text-[15px] text-graphite">
          The IR holds no tokens and no transport names. Its targets carry each portal ID; its resources hold none. The
          plan holds no tokens either. Every resource has one address, the same in config, IR, plans and state.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <ArrowButton href="/docs">Read the docs</ArrowButton>
          <ArrowButton href="/roadmap" tone="ghost">
            See the roadmap
          </ArrowButton>
        </div>
      </Section>
    </>
  )
}
