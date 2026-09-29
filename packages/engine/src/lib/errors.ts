// The exit-code table and the error every command turns into an exit code. The envelope that prints them is the
// CLI's.
import type { Issue } from '../ir/types.js'

export type { Issue } from '../ir/types.js'

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
