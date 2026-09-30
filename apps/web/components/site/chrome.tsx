import Link from 'next/link'
import { gitConfig } from '@/lib/shared'
import { ArrowField } from './fields'
import { Address, ArrowButton, Logo, Meaning, Rails } from './primitives'

export const githubUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`

const NAV = [
  { href: '/how-it-works', label: 'How it works' },
  { href: '/use-cases/agencies', label: 'Use cases' },
  { href: '/compare', label: 'Vs HubSpot tools' },
  { href: '/coverage', label: 'Coverage' },
  { href: '/roadmap', label: 'Roadmap' },
  { href: '/docs', label: 'Docs' },
]

export function SiteNav() {
  return (
    <nav aria-label="Main" className="relative z-20">
      <div className="flex items-center gap-7 py-[22px]">
        <Link
          href="/"
          className="inline-flex items-center gap-2.5 text-[21px] leading-none font-bold tracking-[-0.03em]"
        >
          <Logo />
          kalup
        </Link>
        <div className="hidden items-center gap-[22px] text-sm text-graphite lg:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="hover:text-ink">
              {n.label}
            </Link>
          ))}
        </div>
        <a
          href={githubUrl}
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex h-9 items-center gap-2 rounded-full border border-line-strong bg-paper/70 px-3 font-mono text-[13px] hover:border-ink"
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
      {/* below lg every link wraps onto a row of its own, so none is hidden behind a menu */}
      <div className="-mt-2 flex flex-wrap gap-x-5 gap-y-2 pb-4 text-sm text-graphite lg:hidden">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className="hover:text-ink">
            {n.label}
          </Link>
        ))}
      </div>
    </nav>
  )
}

/** The site header: the rails and the nav. Shared by the (site) layout and the 404 page outside it. */
export function SiteHeader() {
  return (
    <header className="relative z-20 bg-paper">
      <div className="wrap relative">
        <Rails marks={false} />
        <div className="relative">
          <SiteNav />
        </div>
      </div>
    </header>
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
      ['https://www.npmjs.com/package/kalup', 'npm'],
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
          <div className="pointer-events-none relative grid items-end gap-x-12 gap-y-7 py-[clamp(64px,8vw,112px)] md:grid-cols-[minmax(0,8fr)_minmax(0,4fr)] [&>*]:pointer-events-auto">
            <div className="grid justify-items-start gap-7">
              <Address>kalup:init</Address>
              <h2 className="display text-h2">Put your portal in a file.</h2>
            </div>
            <div className="md:justify-self-end">
              <ArrowButton href="/docs/getting-started">Get started</ArrowButton>
            </div>
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
