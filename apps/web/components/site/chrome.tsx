import Link from 'next/link'
import { gitConfig } from '@/lib/shared'
import { ArrowField } from './fields'
import { STAGE } from '@/lib/site-data'
import { Address, ArrowButton, AvailabilityTag, Logo, Meaning, Rails } from './primitives'

export const githubUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`

const NAV = [
  { href: '/how-it-works', label: 'How it works' },
  { href: '/use-cases/developers', label: 'Use cases' },
  { href: '/coverage', label: 'Coverage' },
  { href: '/roadmap', label: 'Roadmap' },
  { href: '/docs', label: 'Docs' },
]

export function SiteNav() {
  return (
    <nav aria-label="Main" className="relative z-20 flex items-center gap-7 py-[22px]">
      <Link href="/" className="inline-flex items-center gap-2.5 text-[21px] leading-none font-bold tracking-[-0.03em]">
        <Logo />
        kalup
      </Link>
      <div className="hidden items-center gap-[22px] text-sm text-graphite md:flex">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className="hover:text-ink">
            {n.label}
          </Link>
        ))}
        <span
          className="inline-flex items-center gap-1.5 text-muted"
          title="A hosted service for agencies, after pipelines, schema writes and association labels. No date is set."
        >
          Cloud
          <AvailabilityTag stage={STAGE.later} />
        </span>
      </div>
      <div className="ml-auto flex items-center gap-4">
        <Link href="/docs" className="text-sm text-graphite hover:text-ink md:hidden">
          Docs
        </Link>
        <a
          href={githubUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-9 items-center gap-2 rounded-full border border-line-strong bg-paper/70 px-3 font-mono text-[13px] hover:border-ink"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z"
            />
          </svg>
          Star
        </a>
      </div>
    </nav>
  )
}

const COLUMNS = [
  {
    title: 'Product',
    links: [
      ['/how-it-works', 'How it works'],
      ['/coverage', 'Coverage'],
      ['/roadmap', 'Roadmap'],
      ['/compare', "Kalup and HubSpot's tools"],
    ],
  },
  {
    title: 'Use cases',
    links: [
      ['/use-cases/developers', 'Developers'],
      ['/use-cases/agents', 'Agents'],
      ['/use-cases/agencies', 'Agencies'],
    ],
  },
  {
    title: 'Project',
    links: [
      ['/docs', 'Docs'],
      [githubUrl, 'GitHub'],
      ['/open-source', 'Open source'],
    ],
  },
]

export function SiteFooter() {
  return (
    <footer className="relative mt-auto border-t border-line">
      <div className="relative overflow-hidden">
        <ArrowField />
        <div className="wrap relative">
          <Rails />
          <div className="pointer-events-none relative grid justify-items-start gap-7 py-[clamp(90px,12vw,160px)] [&>*]:pointer-events-auto">
            <Address>motion:arrows</Address>
            <h2 className="display max-w-[12ch] text-h2">Put your portal in a file.</h2>
            <ArrowButton href="/docs/getting-started">Get started</ArrowButton>
          </div>
        </div>
      </div>
      <div className="relative border-t border-line bg-paper">
        <div className="wrap relative">
          <Rails />
          <div className="relative px-px">
            <p
              aria-hidden
              className="overflow-hidden pt-3 text-[clamp(88px,21vw,300px)] leading-[0.8] font-bold tracking-[-0.06em] select-none"
            >
              kalup<span className="text-molten">.</span>
            </p>
            <Meaning className="mt-2 mb-9" />
            <div className="grid grid-cols-2 gap-7 border-t border-line pt-9 pb-7 md:grid-cols-[1.2fr_repeat(3,minmax(0,1fr))]">
              <p className="col-span-2 max-w-[42ch] text-[15px] text-graphite md:col-span-1">
                Configuration as code for HubSpot. Open source, Apache-2.0. Everything that runs on your machine or in
                your CI stays free.
              </p>
              {COLUMNS.map((col) => (
                <div key={col.title}>
                  <h3 className="eyebrow mb-3">{col.title}</h3>
                  <ul className="grid gap-2 text-sm text-graphite">
                    {col.links.map(([href, label]) => (
                      <li key={href}>
                        <Link href={href} className="hover:text-ink">
                          {label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <p className="col-span-full max-w-[90ch] border-t border-dashed border-line-strong pt-[18px] text-xs text-muted">
                Kalup is an independent open-source project maintained by Scopious. It is not affiliated with, endorsed
                by, or sponsored by HubSpot, Inc. HubSpot is a registered trademark of HubSpot, Inc.
              </p>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}
