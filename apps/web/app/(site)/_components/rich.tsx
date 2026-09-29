import { Fragment } from 'react'

const CODE = 'rounded-[3px] bg-panel px-1 py-px font-mono text-[0.88em] text-ink [overflow-wrap:anywhere]'

/** Renders a data string, turning `backticked` parts into inline code. */
export function Rich({ text }: { text: string }) {
  return text.split('`').map((part, n) =>
    n % 2 === 1 ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: parts of a fixed string never reorder
      <code key={n} className={CODE}>
        {part}
      </code>
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: parts of a fixed string never reorder
      <Fragment key={n}>{part}</Fragment>
    ),
  )
}
