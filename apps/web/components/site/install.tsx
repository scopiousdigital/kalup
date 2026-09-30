'use client'

import Link from 'next/link'
import { type KeyboardEvent, useId, useState } from 'react'
import { cn } from '@/lib/cn'
import { npmUrl, STAGE } from '@/lib/site-data'
import { AvailabilityTag } from './primitives'

const prompt =
  'Set up Kalup in this repo: run npm install @kalup/core and npm install -D kalup, then npx kalup init --portal <portal id>, and follow the AGENTS.md it writes.'

const TABS = [
  {
    id: 'terminal',
    label: 'Terminal',
    prompt: '$',
    text: 'npm install @kalup/core && npm install -D kalup && npx kalup init --portal <portal id>',
  },
  // starts Claude Code in the current folder with the setup prompt as its first message
  { id: 'claude', label: 'Claude Code', prompt: '$', text: `claude "${prompt}"` },
  { id: 'agent', label: 'Any agent', prompt: '›', text: prompt },
]

/**
 * The primary call to action: install Kalup and run init in a terminal, or hand the setup to an agent. `version` comes
 * from lib/version.ts on the server, so the status line is in the HTML.
 */
export function InstallBlock({ version, className }: { version: string; className?: string }) {
  const [active, setActive] = useState(0)
  const [copied, setCopied] = useState(false)
  const base = useId()
  const all = TABS
  const tab = all[active]

  async function copy() {
    try {
      await navigator.clipboard.writeText(tab.text)
    } catch {
      return
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  function onKey(e: KeyboardEvent) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    const next = (active + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length
    setActive(next)
    document.getElementById(`${base}-tab-${next}`)?.focus()
  }

  return (
    <div
      className={cn(
        'max-w-[580px] border border-line-strong bg-[color-mix(in_oklab,var(--color-paper)_86%,transparent)] backdrop-blur-sm',
        className,
      )}
    >
      <div role="tablist" aria-label="Install Kalup" className="flex flex-wrap border-b border-line">
        {all.map((t, n) => (
          <button
            key={t.id}
            id={`${base}-tab-${n}`}
            type="button"
            role="tab"
            aria-selected={n === active}
            aria-controls={`${base}-panel`}
            tabIndex={n === active ? 0 : -1}
            onClick={() => setActive(n)}
            onKeyDown={onKey}
            className={cn(
              'relative border-r border-line px-3.5 py-[11px] font-mono sm:px-4 text-[13px] whitespace-nowrap text-muted focus-visible:-outline-offset-2',
              n === active &&
                'bg-paper text-ink after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-molten',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        id={`${base}-panel`}
        role="tabpanel"
        aria-labelledby={`${base}-tab-${active}`}
        className="flex items-center gap-3 p-4 font-mono text-[15px] leading-[1.45]"
      >
        <span aria-hidden className="text-molten select-none">
          {tab.prompt}
        </span>
        <code className="flex-1 [overflow-wrap:anywhere]">{tab.text}</code>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? 'Copied' : 'Copy'}
          className={cn(
            'grid size-[34px] flex-none place-items-center rounded-md border border-line-strong hover:border-ink',
            copied && 'border-molten bg-molten',
          )}
        >
          <svg
            viewBox="0 0 16 16"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            {copied ? <path d="M3 8.5l3.2 3L13 4.5" /> : <path d="M5 5h9v9H5zM11 5V2H2v9h3" />}
          </svg>
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-t border-dashed border-line-strong px-4 py-2.5 text-[13px] text-muted">
        <AvailabilityTag stage={STAGE.shipped} />
        <span>
          <a href={npmUrl} className="text-ink underline underline-offset-2">
            {version}
          </a>{' '}
          is on npm.{' '}
          <Link href="/docs/getting-started" className="text-ink underline underline-offset-2">
            Getting started
          </Link>{' '}
          takes it from there.
        </span>
        <span>Apache-2.0 · Node 22.13.1 or later, on your machine and in CI</span>
      </div>
    </div>
  )
}
