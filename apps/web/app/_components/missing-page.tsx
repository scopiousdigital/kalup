'use client'

import { useEffect, useState } from 'react'
import { Address, ArrowButton, Rails } from '@/components/site/primitives'
import { Terminal } from '@/components/site/terminal'

/*
  The 404 as a Kalup session: a plan for the missing URL that finds nothing to apply. The path is read after mount, so
  the static 404 page hydrates without a mismatch and every missing URL shows its own address.
*/
export function MissingPage() {
  const [path, setPath] = useState('/this-page')
  useEffect(() => setPath(window.location.pathname), [])
  const address = `page:${path}`

  return (
    <div className="wrap relative">
      <Rails marks={false} />
      <div className="relative grid items-center gap-12 pt-10 pb-[clamp(56px,8vw,96px)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="grid min-w-0 content-start gap-7">
          <span className="[overflow-wrap:anywhere]">
            <Address>{address}</Address>
          </span>
          <h1 className="display text-hero">
            No page <span className="text-molten">here.</span>
          </h1>
          <p className="max-w-[46ch] text-lede text-graphite">
            This page is not in config. Kalup never creates what you did not ask for.
          </p>
          <p className="max-w-[46ch] text-[15px] text-muted">The link may point at an older version of the site.</p>
          <div className="flex flex-wrap gap-3">
            <ArrowButton href="/">Home</ArrowButton>
            <ArrowButton href="/docs" tone="ghost">
              Docs
            </ArrowButton>
          </div>
        </div>
        <Terminal
          key={path}
          title="kalup.dev · zsh"
          command={`kalup plan --only ${address}`}
          output={[
            'Plan pl_000000000404 for target kalup.dev (public, not protected)',
            '0 safe, 0 risky, 0 destructive, 0 blocked, 0 manual; 0 held',
            [
              { text: 'E_NOT_FOUND', tone: 'error' },
              { text: `: ${address} is not in config. (fix: open / for the home page, or /docs for the docs)` },
            ],
            [{ text: 'Nothing to apply. Nothing was created, and nothing was deleted.', tone: 'muted' }],
            [{ text: '# exit 3: absence never deletes, and it never invents a page either', tone: 'muted' }],
          ]}
        />
      </div>
    </div>
  )
}
