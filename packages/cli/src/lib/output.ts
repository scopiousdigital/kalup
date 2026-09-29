// The envelope/1 shape, issues, the exit-code table and the error every command turns into an exit code.
import { escapeJson, type Issue } from '@kalup/core'

export type { Issue } from '@kalup/core'

export interface Envelope<T = unknown> {
  data?: T
  format: 'envelope/1'
  issues: Issue[]
  ok: boolean
}

export const exitCodes = {
  done: 0,
  error: 1,
  differences: 2,
  invalid: 3,
  humanRequired: 4,
  partial: 5,
} as const

export type ExitCode = (typeof exitCodes)[keyof typeof exitCodes]

export class KalupError extends Error {
  readonly issues: Issue[]
  readonly exitCode: ExitCode

  constructor(issues: Issue | Issue[], exitCode: ExitCode = exitCodes.error) {
    const list = Array.isArray(issues) ? issues : [issues]
    super(list.map((issue) => issue.message).join('\n'))
    this.name = 'KalupError'
    this.issues = list
    this.exitCode = exitCode
  }
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
