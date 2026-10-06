import type { Metadata } from 'next'
import { Drawing } from '@/components/site/drawing'
import { ArrowButton, CropMarks, Rails, Section, SectionHead } from '@/components/site/primitives'

export const metadata: Metadata = {
  title: "Kalup and HubSpot's tools",
  description:
    "Where Kalup fits next to HubSpot's own tools: the Agent CLI, the MCP configuration tools, sandbox deploy, and the hs CLI. HubSpot's tools make changes. Kalup records and reviews them.",
}

type Row = {
  tool: string
  note: string
  well: string
  leaves: string
  fits: string
}

const ROWS: Row[] = [
  {
    tool: 'HubSpot Agent CLI',
    note: 'Public beta',
    well: 'Gives an agent create, update and delete over properties, pipelines, custom object schemas, association labels, workflows, saved views and reports, with --dry-run and --confirm.',
    leaves:
      'One change at a time, with no desired-state file, diff, plan, named targets or drift check. Some commands, such as saved views, use endpoints HubSpot has not published.',
    fits: 'Kalup is the file and the plan around it. After a quick change with the Agent CLI, run kalup pull and your files catch up.',
  },
  {
    tool: 'MCP configuration tools and Breeze',
    note: "On HubSpot's remote MCP server: properties and pipelines",
    well: 'The same kind of change, made from a chat window.',
    leaves: 'A prompt is not a review. The change lands with no file, no diff and no record of what changed or why.',
    fits: 'Kalup does not compete with that. It adds a file and a reviewed plan, whoever made the change.',
  },
  {
    tool: 'Sandbox deploy to production',
    note: 'Enterprise only',
    well: 'Moves new assets from a sandbox to production, from the HubSpot UI.',
    leaves:
      'Enterprise and a Super Admin only, from the UI only. It moves new assets and cannot push an edit to anything already in production. No API, no rollback.',
    fits: 'Kalup compares any two portals, edits included, and applies a reviewed plan for properties, groups, custom objects, pipelines and association labels, in either direction.',
  },
  {
    tool: 'hs CLI and the projects framework',
    note: 'Configuration as code for apps and CMS',
    well: 'Apps and CMS assets as code: modules, themes, serverless functions, app cards and app objects.',
    leaves: 'Nothing Kalup needs to fill. The two cover different ground.',
    fits: 'Kalup does not rebuild any of this and never will. Use hs for the app and Kalup for the portal.',
  },
]

const NOT = [
  [
    'Not a record data migration tool.',
    'Kalup moves configuration, never contacts, deals or any other record. A typed record client for your app is on the later list, and it will not be a migration engine either.',
  ],
  [
    'Not a backup.',
    'A snapshot is a scoped observation of the configuration, with what could not be read listed. It holds no record values, and nothing restores from it.',
  ],
  ["Not a replacement for HubSpot's UI.", "People keep using it. Kalup's job is to notice their edits and hold them."],
  [
    'No promise beyond a runbook.',
    'If HubSpot has no endpoint for something, the plan says so. Printing the steps for a person, and recording that they did them, come later. Kalup never claims to have done them itself.',
  ],
]

export default function ComparePage() {
  return (
    <>
      {/* hero */}
      <section className="relative overflow-hidden">
        <div className="wrap relative">
          <Rails marks={false} />
          <div className="relative grid items-center gap-10 pt-10 pb-[clamp(56px,8vw,96px)] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <div className="grid content-start gap-7">
              <span className="eyebrow">Kalup and HubSpot's tools</span>
              <h1 className="display text-hero">
                The layer above <span className="text-molten">HubSpot's own tools.</span>
              </h1>
              <p className="max-w-[52ch] bg-paper text-lede text-graphite">
                HubSpot's tools make changes. Kalup records them in files, reviews them as plans, and applies property
                and group changes to any portal you name. It calls HubSpot's public REST APIs directly.
              </p>
              <div className="flex flex-wrap gap-3">
                <ArrowButton href="/how-it-works">How it works</ArrowButton>
                <ArrowButton href="/coverage" tone="ghost">
                  See coverage
                </ArrowButton>
              </div>
            </div>
            <figure className="relative border border-line-strong bg-paper p-[clamp(16px,3vw,28px)]">
              <CropMarks />
              <Drawing figure="prompt" />
              <figcaption className="mt-3 font-mono text-xs text-muted">
                Any tool can pour. Kalup keeps the mould and checks the cast.
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      {/* the table */}
      <Section dots>
        <SectionHead
          address="compare:tools"
          title="Use both. Here is where each one fits."
          lede="Each of these does its job well. None of them keeps a desired state in a file you can review. That gap is the one Kalup fills."
        />
        <div className="hidden border border-line-strong bg-paper lg:block">
          <table className="w-full border-collapse text-left text-[15px]">
            <thead>
              <tr className="border-b border-line-strong">
                {[
                  ['Tool', 'w-[19%]'],
                  ['What it does well', 'w-[27%]'],
                  ['What it leaves out', 'w-[27%]'],
                  ['How Kalup fits', 'w-[27%]'],
                ].map(([h, w]) => (
                  <th key={h} scope="col" className={`eyebrow ${w} px-5 py-4 font-medium`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.tool} className="border-b border-line align-top last:border-b-0">
                  <th scope="row" className="px-5 py-5 font-normal">
                    <span className="block font-semibold text-ink">{row.tool}</span>
                    <span className="mt-1 block font-mono text-xs text-muted">{row.note}</span>
                  </th>
                  <td className="px-5 py-5 text-graphite">{row.well}</td>
                  <td className="px-5 py-5 text-graphite">{row.leaves}</td>
                  <td className="bg-[color-mix(in_oklab,var(--color-molten)_7%,var(--color-paper))] px-5 py-5 text-ink">
                    {row.fits}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-4 lg:hidden">
          {ROWS.map((row) => (
            <article key={row.tool} className="relative border border-line-strong bg-paper">
              <CropMarks />
              <div className="border-b border-line p-4">
                <h3 className="font-semibold">{row.tool}</h3>
                <p className="mt-1 font-mono text-xs text-muted">{row.note}</p>
              </div>
              <dl className="grid">
                {[
                  ['What it does well', row.well],
                  ['What it leaves out', row.leaves],
                  ['How Kalup fits', row.fits],
                ].map(([k, v], n) => (
                  <div
                    key={k}
                    className={`grid gap-1 border-b border-line p-4 last:border-b-0 ${n === 2 ? 'bg-[color-mix(in_oklab,var(--color-molten)_7%,var(--color-paper))]' : ''}`}
                  >
                    <dt className="eyebrow">{k}</dt>
                    <dd className="text-[15px] text-graphite">{v}</dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
        </div>
        <p className="mt-6 max-w-[80ch] font-mono text-xs text-muted">
          Kalup compares any two portals you name, edits included, plans your files against either, and applies property
          and group changes after a review. It is open source, on npm, and calls HubSpot's public REST APIs directly.
        </p>
      </Section>

      {/* where Kalup stops */}
      <Section>
        <SectionHead
          address="scope:not"
          title="Where Kalup stops."
          lede="Saying what a tool will not do is part of saying what it does. These are part of the design, not gaps waiting to be filled."
        />
        <ul className="grid gap-px border border-line-strong bg-line-strong md:grid-cols-2">
          {NOT.map(([title, body]) => (
            <li key={title} className="bg-paper p-6 text-[15px] text-graphite">
              <b className="block font-semibold text-ink">{title}</b>
              {body}
            </li>
          ))}
        </ul>
      </Section>
    </>
  )
}
