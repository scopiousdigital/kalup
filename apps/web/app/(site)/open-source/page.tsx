import type { Metadata } from 'next'
import { githubUrl } from '@/components/site/chrome'
import { Halftone } from '@/components/site/halftone'
import { ArrowButton, CropMarks, Rails, Section, SectionHead } from '@/components/site/primitives'
import { Code } from '@/components/site/product'
import { OPEN_SOURCE } from '@/lib/site-data'
import { Rich } from '../_components/rich'

export const metadata: Metadata = {
  title: 'Open source',
  description:
    "Kalup is Apache-2.0. Everything that runs on your machine or in your CI against HubSpot's public APIs is free and stays free.",
}

const PROMISE =
  "Everything that runs on your machine or in your CI against HubSpot's public APIs is free and stays free. The licence will not tighten."

const LICENCES = [
  {
    part: 'Engine and CLI, and later the client and code generators',
    licence: 'Apache-2.0',
    detail:
      'An express patent grant and a trademark clause. Both packages, `kalup` and `@kalup/core`, already declare it in their `package.json` and ship the `LICENSE` and `NOTICE` kept at the repo root.',
  },
  {
    part: 'Blueprint content',
    licence: 'MIT or 0BSD',
    detail:
      '`kalup add` copies a blueprint into your config files, so a permissive licence keeps notice obligations out of your repo. Kalup ships no blueprint content of its own yet; the first will carry this licence.',
  },
  {
    part: 'What Kalup generates for you',
    licence: 'Yours',
    detail: 'Config files and docs, and later any generated code, belong to you.',
  },
]

const HOSTED = ['Shared state and coordination, with history', 'Scheduled observations of client portals']

const CONTRIBUTE = `git clone ${githubUrl}.git
cd kalup
pnpm install
pnpm build && pnpm check && pnpm test

# sign off every commit (DCO)
git commit -s -m "Describe the change"`

export default function OpenSourcePage() {
  return (
    <>
      <section className="relative overflow-hidden">
        <div className="wrap relative">
          <Rails marks={false} />
          <div className="relative grid items-center gap-x-12 gap-y-10 pt-10 pb-[clamp(56px,8vw,96px)] lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <div className="grid content-start gap-7">
              <span className="eyebrow">Open source · Apache-2.0</span>
              <h1 className="display text-hero">
                Free, and it <span className="text-molten">stays free.</span>
              </h1>
              <p className="max-w-[52ch] text-lede text-graphite">
                Kalup is open source under Apache-2.0, with no CLA.
              </p>
              <div className="flex flex-wrap gap-3">
                <ArrowButton href={githubUrl}>Star on GitHub</ArrowButton>
                <ArrowButton href="#contribute" tone="ghost">
                  Contribute
                </ArrowButton>
              </div>
            </div>
            {/* decoration; below sm it would leave a screen of empty space under the buttons */}
            <div className="hidden sm:block">
              <Halftone src="/images/tray.jpg" label="Halftone of a casting tray of identical tokens" />
            </div>
          </div>
        </div>
      </section>

      <Section dots>
        <SectionHead
          address="licence:promise"
          title="The promise, in writing."
          lede="It is in the README and the architecture document, so changing it would be public and on the record."
        />
        <figure className="relative grid gap-6 border border-ink bg-paper p-[clamp(24px,4vw,48px)]">
          <CropMarks />
          <blockquote className="display max-w-[22ch] text-h2 leading-[0.92]">
            Free and <span className="text-molten">stays free.</span> The licence will not tighten.
          </blockquote>
          <figcaption className="grid gap-2 border-t border-line pt-5 text-[15px] text-graphite md:grid-cols-2 md:gap-10">
            <p>{PROMISE}</p>
            <p>
              A hosted service will charge for what a laptop cannot provide. It never charges for a feature the CLI
              already has, and a feature that runs locally or in CI can never move to the hosted service only.
            </p>
          </figcaption>
        </figure>
      </Section>

      <Section>
        <SectionHead
          address="licence:*"
          title="What each part is licensed under."
          lede="Agencies build client work on Kalup, often next to other agencies. These licences let each of them trust that the engine stays open."
        />
        <ul className="grid gap-px border border-line-strong bg-line-strong md:grid-cols-3">
          {LICENCES.map((l) => (
            <li key={l.part} className="grid content-start gap-4 bg-paper p-6">
              <span className="eyebrow">{l.part}</span>
              <span className="display text-h3">{l.licence}</span>
              <p className="text-sm text-graphite">
                <Rich text={l.detail} />
              </p>
            </li>
          ))}
        </ul>
      </Section>

      <Section dots>
        <SectionHead
          address="boundary:free"
          title="Where the line sits."
          lede="Local and CI use is free. The hosted service for teams comes after pipelines, schema writes and association labels."
        />
        <div className="grid items-start gap-4 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <div className="relative grid content-start gap-5 border border-ink bg-paper p-6">
            <CropMarks />
            <div className="flex items-center justify-between gap-3">
              <h3 className="display text-h3">Open source</h3>
              <span className="rounded-[3px] bg-molten px-2 py-1.5 font-mono text-xs leading-none">free, always</span>
            </div>
            <ul className="grid gap-2 text-[15px]">
              {OPEN_SOURCE.map((text) => (
                <li key={text} className="grid grid-cols-[14px_minmax(0,1fr)] items-baseline gap-3">
                  <span aria-hidden className="size-2 bg-molten" />
                  <span>
                    <Rich text={text} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="grid content-start gap-5 bg-ink p-6 text-paper">
            <h3 className="display text-h3">Hosted, for teams</h3>
            <ul className="grid gap-2 text-[15px] text-paper/85">
              {HOSTED.map((h) => (
                <li key={h} className="grid grid-cols-[14px_minmax(0,1fr)] items-baseline gap-3">
                  <span aria-hidden className="size-2 border border-paper/60" />
                  {h}
                </li>
              ))}
            </ul>
            <p className="text-sm text-paper/60">It runs the same open engine. It adds what a laptop cannot do.</p>
          </div>
        </div>
      </Section>

      <Section id="contribute">
        <SectionHead
          address="contribute:dco"
          title="Sign off, no CLA."
          lede="Contributions use a Developer Certificate of Origin: add a sign-off line to each commit. There is no Contributor Licence Agreement."
        />
        <div className="grid items-start gap-x-12 gap-y-6 lg:grid-cols-2">
          <div className="grid gap-5 text-[15px] text-graphite">
            <p>
              <b className="block font-semibold text-ink">Why no CLA.</b>
              Apache-2.0 already lets anyone, the maintainer included, build on the code. A CLA would add little, and it
              is the tool that makes a later relicense possible. Not asking for one is part of the promise.
            </p>
            <p>
              <b className="block font-semibold text-ink">Before you open a pull request.</b>
              <Rich text="Read `AGENTS.md` and `docs/architecture.md`. Tests never touch the network, fixtures use invented names, and `pnpm build && pnpm check && pnpm test` passes." />
            </p>
            <p>
              <b className="block font-semibold text-ink">What gets built.</b>
              The roadmap sets the order. If something is underspecified, open an issue before the code.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <ArrowButton href={githubUrl}>Open the repo</ArrowButton>
              <ArrowButton href="/roadmap" tone="ghost">
                See the roadmap
              </ArrowButton>
            </div>
          </div>
          <Code file="terminal" code={CONTRIBUTE} />
        </div>
      </Section>
    </>
  )
}
