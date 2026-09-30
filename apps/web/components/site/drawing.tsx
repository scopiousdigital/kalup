'use client'

import { type CSSProperties, type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { useInView, useReducedMotion } from './hooks'

/*
  Technical drawings. The line is the mould, the dots are the metal:
  ink outlines for moulds, orange dots for hot metal, graphite dots for metal that has cooled.
  Each figure draws its lines in on first view, then pours while it is on screen.
*/

const MONO = "var(--font-mono), 'JetBrains Mono', monospace"
type Metal = 'pour' | 'hot' | 'cool' | 'cooling'
type Box = { x: number; y: number; width: number; height: number }

function Defs({ k }: { k: string }) {
  return (
    <defs>
      <pattern id={`hot${k}`} width="7" height="7" patternUnits="userSpaceOnUse">
        <circle cx="3.5" cy="3.5" r="2.3" className="d-hot" />
      </pattern>
      <pattern id={`cool${k}`} width="7" height="7" patternUnits="userSpaceOnUse">
        <circle cx="3.5" cy="3.5" r="2" className="d-cool" />
      </pattern>
      <pattern id={`hatch${k}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="6" className="hl" />
      </pattern>
    </defs>
  )
}

/** A cavity: the clip shape holds the metal. */
function Cavity({ k, id, clip, box, metal }: { k: string; id: string; clip: ReactNode; box: Box; metal: Metal }) {
  const fill = `url(#${metal === 'cool' ? 'cool' : 'hot'}${k})`
  return (
    <>
      <clipPath id={`c${k}${id}`}>{clip}</clipPath>
      <g clipPath={`url(#c${k}${id})`}>
        {metal === 'cooling' ? (
          <>
            <rect {...box} fill={`url(#cool${k})`} />
            <rect {...box} y={box.y + box.height * 0.62} fill={`url(#hot${k})`} />
          </>
        ) : (
          <rect
            {...box}
            fill={fill}
            className={metal === 'pour' ? 'level' : undefined}
            style={{ '--h': `${box.height}px` } as CSSProperties}
          />
        )}
      </g>
    </>
  )
}

function Glyph(props: { k: string; id: string; ch: string; x: number; y: number; size: number; metal: Metal }) {
  const { k, id, ch, x, y, size, metal } = props
  const text = { x, y, fontSize: size, fontFamily: MONO, fontWeight: 700, textAnchor: 'middle' as const }
  return (
    <>
      <Cavity
        k={k}
        id={id}
        metal={metal}
        clip={<text {...text}>{ch}</text>}
        box={{ x: x - size, y: y - size, width: size * 2, height: size * 1.5 }}
      />
      <text {...text} className="gl-i" transform="translate(2.5 2.5)">
        {ch}
      </text>
      <text {...text} className="gl-o">
        {ch}
      </text>
    </>
  )
}

function Hole({ x, y }: { x: number; y: number }) {
  return (
    <>
      <circle cx={x} cy={y} r="6" className="ln draw" pathLength={1} />
      <path d={`M${x - 11} ${y}H${x + 11}M${x} ${y - 11}V${y + 11}`} className="thin cl" />
    </>
  )
}

function Block({ k, x, y, w, h }: { k: string; x: number; y: number; w: number; h: number }) {
  return (
    <>
      <rect x={x} y={y} width={w} height={h} className="block ln draw" pathLength={1} />
      <rect x={x} y={y + h - 16} width={w} height="16" fill={`url(#hatch${k})`} />
      <path d={`M${x} ${y + h - 16}H${x + w}`} className="thin" />
    </>
  )
}

function Nozzle({ x, top, bottom }: { x: number; top: number; bottom: number }) {
  return (
    <>
      <path
        d={`M${x - 22} ${top}H${x + 22}L${x + 14} ${top + 22}H${x - 14}Z`}
        className="ln block draw"
        pathLength={1}
      />
      <line x1={x} y1={top + 24} x2={x} y2={bottom} className="stream" />
    </>
  )
}

function Callout(props: {
  x: number
  y: number
  to: [number, number][]
  label: string
  sub?: string
  anchor?: 'start' | 'end'
}) {
  const { x, y, to, label, sub, anchor = 'start' } = props
  const [tx, ty] = to[to.length - 1]
  const points = [[x, y], ...to].map((p) => p.join(',')).join(' ')
  return (
    <>
      <circle cx={x} cy={y} r="2.5" className="dot" />
      <polyline points={points} className="thin" />
      <text x={tx} y={ty - 6} textAnchor={anchor} className="t">
        {label}
      </text>
      {sub && (
        <text x={tx} y={ty + 12} textAnchor={anchor} className="t m">
          {sub}
        </text>
      )}
    </>
  )
}

function TitleBlock({ x, y, fig, name }: { x: number; y: number; fig: number; name: string }) {
  return (
    <>
      <rect x={x} y={y} width="222" height="48" className="thin" />
      <path d={`M${x} ${y + 18}H${x + 222}M${x + 62} ${y}V${y + 18}`} className="thin" />
      <text x={x + 8} y={y + 13} className="t b">
        KALUP
      </text>
      <text x={x + 70} y={y + 13} className="t">
        FIG. {fig} · {name}
      </text>
      <text x={x + 8} y={y + 36} className="t m">
        SCALE 1:1 · SHEET {fig} OF {FIGURE_COUNT}
      </text>
    </>
  )
}

const FIGURE_COUNT = 4

function Pour({ k }: { k: string }) {
  return (
    <>
      <Block k={k} x={150} y={96} w={340} h={282} />
      <path d="M320 80V392" className="thin cl" />
      <Hole x={176} y={122} />
      <Hole x={464} y={122} />
      <Hole x={176} y={336} />
      <Hole x={464} y={336} />
      <Glyph k={k} id="a" ch="{" x={258} y={306} size={205} metal="pour" />
      <Glyph k={k} id="b" ch="}" x={382} y={306} size={205} metal="cool" />
      <Nozzle x={262} top={6} bottom={226} />
      {/* the file is the mould: dimensioned under it, clear of the pour */}
      <path d="M150 382V414M490 382V414M150 406H490M146 410l8-8M486 410l8-8" className="thin" />
      <text x="320" y="428" textAnchor="middle" className="t">
        hubspot/objects/companies.ts
      </text>
      <Callout
        x={262}
        y={58}
        to={[
          [210, 40],
          [24, 40],
        ]}
        label="pour · apply (M3)"
      />
      <Callout
        x={214}
        y={231}
        to={[
          [120, 231],
          [24, 231],
        ]}
        label="cavity"
        sub="your config"
      />
      <Callout
        x={428}
        y={231}
        to={[
          [540, 190],
          [616, 190],
        ]}
        label="cast · your portal"
        anchor="end"
      />
      <TitleBlock x={394} y={452} fig={1} name="THE POUR" />
    </>
  )
}

function Prompt({ k }: { k: string }) {
  return (
    <>
      <Block k={k} x={104} y={70} w={192} h={196} />
      <Hole x={124} y={90} />
      <Hole x={276} y={90} />
      <Glyph k={k} id="a" ch=">_" x={200} y={214} size={118} metal="pour" />
      <Nozzle x={170} top={0} bottom={150} />
      <Callout
        x={152}
        y={180}
        to={[
          [64, 180],
          [16, 180],
        ]}
        label="agent edits"
      />
      <Callout x={262} y={216} to={[[384, 216]]} label="you review" anchor="end" />
      <TitleBlock x={170} y={286} fig={2} name="THE PROMPT" />
    </>
  )
}

const HOT_CELLS = new Set(['0,1', '1,3', '2,2'])

function Fleet({ k }: { k: string }) {
  const cells = []
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      const box = { x: 78 + c * 64, y: 76 + r * 58, width: 50, height: 44 }
      cells.push(
        <g key={`${r}${c}`}>
          <Cavity
            k={k}
            id={`${r}${c}`}
            box={box}
            clip={<rect {...box} />}
            metal={HOT_CELLS.has(`${r},${c}`) ? 'hot' : 'cool'}
          />
          <rect {...box} className="ln draw" pathLength={1} />
        </g>,
      )
    }
  }
  return (
    <>
      <Block k={k} x={56} y={56} w={288} h={214} />
      {cells}
      <path d="M200 44V282" className="thin cl" />
      <Callout
        x={103}
        y={76}
        to={[
          [70, 34],
          [16, 34],
        ]}
        label="one mould per client"
      />
      <TitleBlock x={170} y={286} fig={3} name="THE FLEET" />
    </>
  )
}

function Cast({ k }: { k: string }) {
  return (
    <>
      <Glyph k={k} id="a" ch="{" x={130} y={222} size={196} metal="cooling" />
      <Glyph k={k} id="b" ch="}" x={270} y={222} size={196} metal="cooling" />
      <path d="M24 262H376" className="ln draw" pathLength={1} />
      <rect x="24" y="262" width="352" height="12" fill={`url(#hatch${k})`} />
      <Callout
        x={262}
        y={86}
        to={[
          [262, 40],
          [384, 40],
        ]}
        label="renewalDate: string | null"
        anchor="end"
      />
      <TitleBlock x={170} y={286} fig={4} name="THE CAST" />
    </>
  )
}

export const FIGURES = {
  pour: {
    viewBox: '0 0 640 510',
    label:
      'Figure 1: a mould with brace-shaped cavities. Molten metal pours into the left brace; the right brace has cooled.',
    Body: Pour,
  },
  prompt: {
    viewBox: '0 0 400 340',
    label: 'Figure 2: a mould with a command prompt cavity, filling with molten metal.',
    Body: Prompt,
  },
  fleet: {
    viewBox: '0 0 400 340',
    label: 'Figure 3: a casting tray of twelve identical cavities. Three are still hot.',
    Body: Fleet,
  },
  cast: {
    viewBox: '0 0 400 340',
    label: 'Figure 4: the finished cast, a pair of braces cooling from the bottom up.',
    Body: Cast,
  },
}

export type FigureName = keyof typeof FIGURES

export function Drawing({ figure, className }: { figure: FigureName; className?: string }) {
  const ref = useRef<SVGSVGElement>(null)
  const inView = useInView(ref, 0.3)
  const reduce = useReducedMotion()
  const [drawn, setDrawn] = useState(false)
  // ids feed url(#...) references, so keep them to safe characters
  const k = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const { viewBox, label, Body } = FIGURES[figure]

  useEffect(() => {
    if (inView && !reduce) setDrawn(true)
  }, [inView, reduce])

  return (
    <svg
      ref={ref}
      viewBox={viewBox}
      role="img"
      aria-label={label}
      className={cn(
        'fig block h-auto w-full overflow-visible',
        drawn && 'drawing',
        inView && !reduce && 'live',
        className,
      )}
    >
      <Defs k={k} />
      <Body k={k} />
    </svg>
  )
}
