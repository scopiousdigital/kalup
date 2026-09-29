// What a command handler receives and returns. No framework types: the oclif adapters in src/host parse argv and
// hand these plain values over, so the same handlers can serve another host later.
import { bin, type ExitCode, KalupError } from '@kalup/engine'
import type { Issue } from '../lib/output.js'

/** The parsed flags. A command's adapter declares which of them it accepts; the rest stay unset. */
export interface Flags {
  /** `--accept <address[#unit]>`, repeatable: pull takes the portal side of a kept config change or a conflict. */
  accept?: string[]
  /** `--approve <writesHash>`: a reviewed CI job's approval of a saved plan. */
  approve?: string
  check: boolean
  discover: boolean
  /** `add` and `blueprint upgrade --dry-run`: report what would change and write nothing. */
  dryRun: boolean
  exitCode: boolean
  objects?: string
  only?: string
  out?: string
  portal?: string
  /** `add --prefix <p>`: the prefix for one add, over config's `prefix`. */
  prefix?: string
  /** `rm --release`: stop managing the resource and leave it in the portal. */
  release: boolean
  /** `--take`, repeatable: a side, then selectors, as plan and blueprint upgrade read them. */
  take?: string[]
  target?: string
  /** `state rebuild --write`: replace the state file, at a terminal only. */
  write: boolean
  yes: boolean
}

/** Asks the person at the terminal. Only an interactive host provides one; handlers never read stdin themselves. */
export interface Prompter {
  /** What the person typed, or undefined when they cancelled or the input ended. */
  ask: (question: string) => Promise<string | undefined>
  /** The value of the choice the person picked, or undefined when they cancelled or gave no valid answer. */
  choose: (question: string, choices: { label: string; value: string }[]) => Promise<string | undefined>
  /** Shows lines to the person before a question, each sanitized. */
  tell: (lines: string[]) => void
}

export interface Context {
  /** The positional arguments, in the order the command declares them. */
  args: string[]
  cwd: string
  flags: Flags
  /** Writes one line about a long wait to stderr; absent under --json. */
  progress?: (line: string) => void
  /** Present only when a person is at a terminal: stdin and stderr are terminals, no --json and no CI. */
  prompt?: Prompter
  /** Aborted on SIGINT or SIGTERM, for a command the host lets stop cleanly (apply). */
  signal?: AbortSignal
}

/**
 * What a command returns. `issues` on a zero exit are warnings, or an E_SCOPE gap the command recorded and went on past
 * (status, plan, snapshot). `text` is the human output, ignored with --json.
 */
export interface Result<T = unknown> {
  data?: T
  exitCode?: ExitCode
  issues?: Issue[]
  text?: string
}

export type Handler = (ctx: Context) => Result | Promise<Result>

export function usageError(message: string): KalupError {
  return new KalupError({ code: 'E_USAGE', message, fix: `run ${bin} --help` })
}
