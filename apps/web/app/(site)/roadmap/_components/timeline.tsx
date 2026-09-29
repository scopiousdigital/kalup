import { AvailabilityTag, CropMarks } from '@/components/site/primitives'
import { cn } from '@/lib/cn'
import type { Milestone, Stage } from '@/lib/site-data'
import { Rich } from '../../_components/rich'

// Built milestones are cast: a molten node. Planned ones are still an empty mould.
function Node({ built }: { built: boolean }) {
  return (
    <span aria-hidden className="relative grid size-[22px] place-items-center bg-paper">
      <span className={cn('relative size-[14px] border-[1.5px] border-molten', built ? 'bg-molten' : 'bg-paper')} />
    </span>
  )
}

function same(a: Stage, b: Stage) {
  return a.availability === b.availability && a.milestone === b.milestone
}

/** The milestones in build order, as a drawing: an ink rail with one node per milestone. */
export function Timeline({ milestones }: { milestones: Milestone[] }) {
  return (
    <ol className="relative grid gap-8">
      <span aria-hidden className="absolute top-3 bottom-3 left-[10.5px] w-px bg-ink" />
      {milestones.map((m) => (
        <li key={m.number} className="relative grid grid-cols-[22px_minmax(0,1fr)] gap-5 sm:gap-8">
          <div className="pt-6">
            <Node built={m.stage.availability === 'released' || m.stage.availability === 'unreleased'} />
          </div>
          <article className="relative grid min-w-0 gap-6 border border-line-strong bg-paper p-[clamp(20px,3vw,32px)]">
            <CropMarks />
            <header className="flex flex-wrap items-end justify-between gap-4">
              <div className="grid gap-2">
                <span className="eyebrow">
                  Milestone {m.number} · {m.release}
                </span>
                <h3 className="display text-h3">{m.name}</h3>
              </div>
              <AvailabilityTag stage={m.stage} />
            </header>
            <p className="max-w-[70ch] text-lede text-ink">
              <Rich text={m.goal} />
            </p>
            <ul className="grid gap-1.5 text-sm text-graphite md:grid-cols-2 md:gap-x-10">
              {m.ships.map((item) => (
                <li key={item.text} className="grid grid-cols-[10px_minmax(0,1fr)] items-baseline gap-2">
                  <span aria-hidden className="size-1.5 translate-y-[-2px] bg-line-strong" />
                  <span>
                    <Rich text={item.text} />
                    {!same(item.stage, m.stage) && (
                      <>
                        {' '}
                        <AvailabilityTag stage={item.stage} />
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </article>
        </li>
      ))}
    </ol>
  )
}
