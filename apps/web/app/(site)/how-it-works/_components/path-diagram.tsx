'use client'

import { useRef } from 'react'
import { useInView, useReducedMotion } from '@/components/site/hooks'
import { cn } from '@/lib/cn'

/*
  The whole path in one drawing, from architecture section 1. Same language as the figures:
  ink lines for the machinery, orange dots for the two contracts, graphite dots for the portal.
  The main line carries a stream of metal while the drawing is on screen.
*/

type NodeProps = {
  x: number
  y: number
  w: number
  h: number
  label: string
  sub?: string
  metal?: 'hot' | 'cool'
}

function Node({ x, y, w, h, label, sub, metal }: NodeProps) {
  const band = metal ? 22 : 0
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} className="ln block" />
      {metal && (
        <>
          <rect x={x + 3} y={y + band + 3} width={w - 6} height={h - band - 6} fill={`url(#path-${metal})`} />
          <path d={`M${x} ${y + band}H${x + w}`} className="thin" />
        </>
      )}
      <text x={x + w / 2} y={metal ? y + 15 : y + h / 2 - (sub ? 2 : -4)} textAnchor="middle" className="t b">
        {label}
      </text>
      {sub && !metal && (
        <text x={x + w / 2} y={y + h / 2 + 14} textAnchor="middle" className="t m">
          {sub}
        </text>
      )}
      {sub && metal && (
        <text x={x + w / 2} y={y + h + 16} textAnchor="middle" className="t m">
          {sub}
        </text>
      )}
    </g>
  )
}

function Label({ x, y, children, anchor = 'middle' }: { x: number; y: number; children: string; anchor?: string }) {
  return (
    <text x={x} y={y} textAnchor={anchor as 'middle'} className="t m">
      {children}
    </text>
  )
}

const FILES = ['kalup.config.ts', 'hubspot/objects/*.ts', 'hubspot/removed.ts']

export function PathDiagram() {
  const ref = useRef<SVGSVGElement>(null)
  const inView = useInView(ref, 0.25)
  const reduce = useReducedMotion()

  return (
    <div className="overflow-x-auto">
      <svg
        ref={ref}
        viewBox="0 0 1120 540"
        role="img"
        aria-label="The path through Kalup. Config files are parsed into the IR. The engine combines the IR, the state file and a normalized read of the portal into a plan. The executor writes the plan to the portal and reads it back to advance state; the executor and the state file keep what config and the portal last agreed on. Pull runs the other way, from the portal back into the files. The app imports the same files for types and codecs."
        className={cn('fig block h-auto w-full min-w-[900px] overflow-visible', inView && !reduce && 'live')}
      >
        <defs>
          <pattern id="path-hot" width="7" height="7" patternUnits="userSpaceOnUse">
            <circle cx="3.5" cy="3.5" r="2.1" className="d-hot" />
          </pattern>
          <pattern id="path-cool" width="7" height="7" patternUnits="userSpaceOnUse">
            <circle cx="3.5" cy="3.5" r="1.9" className="d-cool" />
          </pattern>
          <pattern id="path-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" className="hl" />
          </pattern>
          <marker id="path-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 0L10 5L0 10z" fill="var(--color-ink)" />
          </marker>
        </defs>

        {/* the app: the same files, imported and executed by your code */}
        <path d="M100 96V40H300" className="thin" markerEnd="url(#path-arrow)" />
        <Label x={108} y={34} anchor="start">
          import, executed by the app
        </Label>
        <Node x={302} y={20} w={190} h={40} label="types + codecs" sub="@kalup/core" />

        {/* config files */}
        {FILES.map((f, n) => (
          <g key={f}>
            <rect x={20} y={100 + n * 40} width={200} height={30} className="ln block" />
            <text x={32} y={119 + n * 40} className="t">
              {f}
            </text>
            <path d={`M220 ${115 + n * 40}H240V155H262`} className="thin" />
          </g>
        ))}
        <path d="M240 155H268" className="thin" markerEnd="url(#path-arrow)" />

        {/* the main line */}
        <line x1="400" y1="155" x2="960" y2="155" className="stream" />
        <Node x={270} y={125} w={130} h={60} label="reader" sub="parse, never run" />
        <path d="M400 155H448" className="thin" markerEnd="url(#path-arrow)" />
        <Node x={450} y={118} w={120} h={74} label="IR" sub="ir/1" metal="hot" />
        <path d="M570 155H618" className="thin" markerEnd="url(#path-arrow)" />
        <Node x={620} y={125} w={120} h={60} label="engine" sub="classify, order" />
        <path d="M740 155H788" className="thin" markerEnd="url(#path-arrow)" />
        <Node x={790} y={118} w={120} h={74} label="plan" sub="plan/1" metal="hot" />
        <path d="M910 155H958" className="thin" markerEnd="url(#path-arrow)" />
        <Node x={960} y={125} w={140} h={60} label="executor" sub="write, read back" />

        {/* the portal */}
        <path d="M1030 185V318" className="thin" markerEnd="url(#path-arrow)" />
        <Label x={1038} y={255} anchor="start">
          write
        </Label>
        <rect x={960} y={320} width={140} height={70} className="ln block" />
        <rect x={963} y={345} width={134} height={42} fill="url(#path-cool)" />
        <path d="M960 342H1100" className="thin" />
        <text x={1030} y={336} textAnchor="middle" className="t b">
          portal
        </text>
        <rect x={960} y={390} width={140} height={10} fill="url(#path-hatch)" />

        {/* read-back advances the base in state */}
        <path d="M985 185V222H700V256" className="thin" strokeDasharray="4 3" markerEnd="url(#path-arrow)" />
        <Label x={900} y={216} anchor="start">
          read-back
        </Label>

        {/* state and the live read feed the engine */}
        <Node x={620} y={258} w={120} h={52} label="state" sub=".kalup/state" />
        <path d="M660 258V187" className="thin" markerEnd="url(#path-arrow)" />
        <Node x={790} y={258} w={120} h={52} label="live" sub="normalized" />
        <path d="M850 258V240H720V187" className="thin" markerEnd="url(#path-arrow)" />
        <path d="M960 355H880V312" className="thin" markerEnd="url(#path-arrow)" />
        <Label x={954} y={372} anchor="end">
          list + normalize
        </Label>

        {/* pull: the reverse arrow */}
        <path d="M1030 400V470H912" className="thin" markerEnd="url(#path-arrow)" />
        <Node x={790} y={444} w={120} h={52} label="live IR" />
        <path d="M790 470H722" className="thin" markerEnd="url(#path-arrow)" />
        <Node x={560} y={444} w={160} h={52} label="merge3" sub="base from state" />
        <path d="M680 310V442" className="thin" strokeDasharray="4 3" markerEnd="url(#path-arrow)" />
        <path d="M560 470H472" className="thin" markerEnd="url(#path-arrow)" />
        <Node x={330} y={444} w={140} h={52} label="writer" sub="canonical form" />
        <path d="M330 470H120V222" className="thin" markerEnd="url(#path-arrow)" />
        <Label x={225} y={462}>
          pull
        </Label>

        {/* title block */}
        <rect x={20} y={500} width={300} height={32} className="thin" />
        <path d="M82 500V532" className="thin" />
        <text x={28} y={520} className="t b">
          KALUP
        </text>
        <text x={92} y={520} className="t">
          FIG. 5 · THE PATH · NOT TO SCALE
        </text>
      </svg>
    </div>
  )
}
