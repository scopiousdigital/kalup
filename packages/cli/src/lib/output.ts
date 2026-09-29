// The envelope/1 shape every --json run prints. The issues it carries, the exit-code table and KalupError are the
// engine's.
import { escapeJson, type Issue } from '@kalup/engine'

export type { Issue } from '@kalup/engine'

export interface Envelope<T = unknown> {
  data?: T
  format: 'envelope/1'
  issues: Issue[]
  ok: boolean
}

/** Builds an envelope/1 document. `data` is left out when undefined. */
export function envelope<T>(ok: boolean, data?: T, issues: Issue[] = []): Envelope<T> {
  return { format: 'envelope/1', ok, ...(data === undefined ? {} : { data }), issues }
}

interface Sink {
  write: (text: string) => unknown
}

/** Prints one envelope/1 document, the only thing `--json` writes to stdout. Keys stay in envelope order. */
export function printEnvelope(env: Envelope, out: Sink = process.stdout): void {
  out.write(`${escapeJson(JSON.stringify(env, null, 2))}\n`)
}
