import { cn } from '@/lib/cn'
import type { Transport } from '@/lib/site-data'

const styles: Record<Transport, string> = {
  'public-api': 'bg-ink text-paper before:bg-molten',
  'public-beta':
    'text-risky-ink bg-[repeating-linear-gradient(-45deg,color-mix(in_oklab,var(--color-risky)_28%,var(--color-paper))_0_5px,var(--color-paper)_5px_10px)] shadow-[inset_0_0_0_1px_var(--color-risky)] before:bg-risky',
  runbook: 'text-ink shadow-[inset_0_0_0_1px_var(--color-ink)] before:shadow-[inset_0_0_0_1.5px_var(--color-ink)]',
  undecided: 'text-muted border border-dashed border-line-strong before:bg-line-strong',
}

/** How a change reaches the portal. Shape carries the meaning as well as colour. */
export function TransportChip({ transport }: { transport: Transport }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[7px] whitespace-nowrap rounded-[3px] px-2 py-1.5 font-mono text-xs leading-none font-medium before:size-[7px] before:content-['']",
        styles[transport],
      )}
    >
      {transport === 'undecided' ? 'not decided' : transport}
    </span>
  )
}
