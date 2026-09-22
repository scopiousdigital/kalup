// The shared runner: parses argv, runs one command and turns its result or error into output and an exit code.
// Human mode: the command's text on stdout, issues on stderr. --json: one envelope on stdout and nothing else.
import { IssueError } from '@kalup/core'
import { type ExitCode, envelope, exitCodes, type Issue, KalupError, printEnvelope, sanitize } from '../lib/index.js'
import { bin, type built, commands, disclaimer, isBuilt, usage, version, versionText } from '../usage.js'
import { type Flags, parseArgs, usageError } from './args.js'
import { fmt } from './fmt.js'
import { init } from './init.js'
import { ir } from './ir.js'
import { pull } from './pull.js'
import { status } from './status.js'
import { validate } from './validate.js'

export interface Context {
  cwd: string
  flags: Flags
}

/** What a command returns. `issues` on a zero exit are warnings. `text` is the human output, ignored with --json. */
export interface Result<T = unknown> {
  data?: T
  issues?: Issue[]
  exitCode?: ExitCode
  text?: string
}

export type Command = (ctx: Context) => Result | Promise<Result>

interface Out {
  write(text: string): unknown
}

export interface Io {
  cwd: string
  stdout: Out
  stderr: Out
}

const implementations: Record<(typeof built)[number], Command> = { init, validate, ir, fmt, status, pull }

export async function run(argv: string[], io: Io): Promise<ExitCode> {
  const json = argv.includes('--json')
  try {
    const result = await dispatch(argv, io.cwd)
    const exitCode = result.exitCode ?? exitCodes.done
    const issues = result.issues ?? []
    if (json) {
      const ok = exitCode === exitCodes.done || exitCode === exitCodes.differences
      printEnvelope(envelope(ok, result.data, issues), io.stdout)
    } else {
      if (result.text) io.stdout.write(result.text)
      printLines(issues, io.stderr)
    }
    return exitCode
  } catch (error) {
    const { issues, exitCode } = failure(error)
    if (json) {
      printEnvelope(envelope(false, undefined, issues), io.stdout)
    } else {
      printLines(issues, io.stderr)
      if (issues.some((issue) => issue.code === 'E_USAGE')) io.stderr.write(`\n${usage()}\n`)
    }
    return exitCode
  }
}

// --version and --help are results like any command's, so --json wraps them in an envelope too.
async function dispatch(argv: string[], cwd: string): Promise<Result> {
  const { command, args, flags } = parseArgs(argv)
  if (flags.version) return { data: { name: bin, version, disclaimer }, text: versionText() }
  if (command === undefined || flags.help) return { data: { usage: usage() }, text: `${usage()}\n` }
  if (!Object.hasOwn(commands, command)) throw usageError(`unknown command '${command}'`)
  if (!isBuilt(command)) {
    throw new KalupError({ code: 'E_NOT_IMPLEMENTED', message: `${bin} ${command} is not implemented yet` })
  }
  // No milestone 1 command takes a positional argument, so `fmt check` is a mistake, not a request to rewrite files.
  if (args.length > 0) throw usageError(`unexpected argument '${args[0]}'`)
  return implementations[command]({ cwd, flags })
}

// A KalupError carries its exit code, core's IssueError means the config is invalid, anything else is exit 1 with
// one sanitized line and never a key.
function failure(error: unknown): { issues: Issue[]; exitCode: ExitCode } {
  if (error instanceof KalupError) return error
  if (error instanceof IssueError) return { issues: error.issues, exitCode: exitCodes.invalid }
  const message = error instanceof Error ? error.message : String(error)
  const issue: Issue = { code: 'E_UNEXPECTED', message: sanitize(message.split('\n')[0] ?? '') }
  return { issues: [issue], exitCode: exitCodes.error }
}

/** One line per issue: `file:line: CODE: message (fix: ...)`. */
function formatIssue(issue: Issue): string {
  const where = issue.file ? `${issue.file}${issue.line === undefined ? '' : `:${issue.line}`}: ` : ''
  const fix = issue.fix ? ` (fix: ${issue.fix})` : ''
  return `${where}${issue.code}: ${issue.message}${fix}`
}

function printLines(issues: Issue[], out: Out): void {
  if (issues.length > 0) out.write(`${issues.map(formatIssue).join('\n')}\n`)
}
