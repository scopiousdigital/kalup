// The envelope/1 shape, issues, the exit-code table and the error every command turns into an exit code.

export interface Issue {
  code: string
  message: string
  file?: string
  line?: number
  configPath?: string
  fix?: string
  docs?: string
  humanRequired?: boolean
}

export interface Envelope<T = unknown> {
  format: 'envelope/1'
  ok: boolean
  data?: T
  issues: Issue[]
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
  write(text: string): unknown
}

/** Prints one envelope/1 document, the only thing `--json` writes to stdout. */
export function printEnvelope(env: Envelope, out: Sink = process.stdout): void {
  out.write(`${JSON.stringify(env, null, 2)}\n`)
}

/** Prints issues as human text: code and message, then location and fix where present. */
export function printIssues(issues: Issue[], out: Sink = process.stderr): void {
  const lines: string[] = []
  for (const issue of issues) {
    lines.push(`${issue.code}: ${issue.message}`)
    const where = [issue.file && `${issue.file}${issue.line === undefined ? '' : `:${issue.line}`}`, issue.configPath]
      .filter(Boolean)
      .join(' ')
    if (where) lines.push(`  at ${where}`)
    if (issue.fix) lines.push(`  fix: ${issue.fix}`)
  }
  if (lines.length > 0) out.write(`${lines.join('\n')}\n`)
}
