// The host between a process and the commands. oclif finds, parses and documents a command; the host owns every
// byte of output: human text on stdout and issues on stderr, or with --json exactly one envelope on stdout. It turns
// every error into Kalup issues and an exit code, and never exits the process, so it can be called repeatedly.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bin, disclaimer, type ExitCode, exitCodes, IssueError, KalupError, sanitize } from '@kalup/engine'
import { Config, Errors, Help } from '@oclif/core'
import { type Prompter, type Result, usageError } from '../commands/context.js'
import { PATH_MAX } from '../commands/files.js'
import { envelope, type Issue, printEnvelope } from '../lib/output.js'
import { formats, version, versionText } from '../version.js'
import { KalupCommand } from './commands.js'
import { createPrompter } from './prompt.js'

interface Out {
  write: (text: string) => unknown
}

type Signal = 'SIGINT' | 'SIGTERM'

/** Where SIGINT and SIGTERM arrive: the process, or a test's emitter. */
export interface Signals {
  off: (signal: Signal, listener: () => void) => unknown
  on: (signal: Signal, listener: () => void) => unknown
}

export interface Io {
  cwd: string
  /** Ends the process at once, on a second signal during an interruptible command. */
  exit?: (code: number) => void
  /**
   * Whether a person is at a terminal: stdin and stderr are terminals and CI is not set. The entry decides it from the
   * process; a command prompts only when this is true, stdin is given and --json is absent.
   */
  interactive?: boolean
  /**
   * The process's signals. While an interruptible command runs (apply), the first SIGINT or SIGTERM aborts its signal,
   * so it stops before its next request, and a second one a second or more later exits at once.
   */
  signals?: Signals
  stderr: Out
  /** Where a prompt reads its answer. */
  stdin?: NodeJS.ReadableStream
  stdout: Out
}

const HELP_WIDTH = 100
const PROGRESS_MAX = 200

/** A person is at a terminal when stdin and stderr are terminals and CI is not set. The entry passes the process's. */
export function isInteractive(
  stdin: { isTTY?: boolean },
  stderr: { isTTY?: boolean },
  env: NodeJS.ProcessEnv,
): boolean {
  return stdin.isTTY === true && stderr.isTTY === true && !env.CI
}

/** Runs one invocation and returns its exit code. Only the executable entry sets process.exitCode. */
export async function run(argv: string[], io: Io): Promise<ExitCode> {
  const json = argv.includes('--json')
  const invocation: Invocation = {}
  // A prompt writes to stderr, so --json, whose output is one envelope, never prompts.
  const prompt = io.interactive === true && !json && io.stdin ? createPrompter(io.stdin, io.stderr) : undefined
  try {
    const result = await dispatch(argv, io.cwd, invocation, prompt, io)
    const exitCode = result.exitCode ?? exitCodes.done
    const issues = withDocs(result.issues ?? [])
    if (json) {
      const ok = exitCode === exitCodes.done || exitCode === exitCodes.differences
      printEnvelope(envelope(ok, result.data, issues), io.stdout)
    } else {
      if (result.text) {
        io.stdout.write(result.text)
      }
      printLines(issues, io.stderr)
    }
    return exitCode
  } catch (error) {
    const failed = failure(error)
    const issues = withDocs(failed.issues)
    if (json) {
      printEnvelope(envelope(false, undefined, issues), io.stdout)
    } else {
      printLines(issues, io.stderr)
      if (invocation.config && issues.some((issue) => issue.code === 'E_USAGE')) {
        io.stderr.write(`\n${await helpText(invocation.config, invocation.id)}\n`)
      }
    }
    return failed.exitCode
  }
}

/**
 * Parses and runs one invocation and returns its result without printing anything. Errors are thrown as they
 * happen; `run` turns them into issues and an exit code. Without `prompt` nothing asks, as in a run without a terminal.
 */
export function execute(argv: string[], cwd: string, prompt?: Prompter): Promise<Result> {
  return dispatch(argv, cwd, {}, prompt)
}

/** What dispatch learned before a failure, so a usage error can print the right help. */
interface Invocation {
  config?: Config
  id?: string
}

// --version and --help are results like any command's, so --json wraps them in an envelope too.
async function dispatch(
  argv: string[],
  cwd: string,
  invocation: Invocation,
  prompt: Prompter | undefined,
  io?: Pick<Io, 'exit' | 'signals' | 'stderr'>,
): Promise<Result> {
  const config = await loadConfig()
  invocation.config = config
  const { id, rest } = splitCommand(argv, config)
  if (argv.includes('--version')) {
    return { data: { name: bin, version, disclaimer, formats: [...formats] }, text: versionText() }
  }
  // A topic alone, `kalup state`, is a request for its help.
  const topic = id !== undefined && !config.findCommand(id) && isTopic(config, id)
  invocation.id = id !== undefined && (config.findCommand(id) || topic) ? id : undefined
  if (id === undefined || topic || argv.includes('--help') || argv.includes('-h')) {
    const usage = await helpText(config, invocation.id)
    return { data: { usage }, text: `${usage}\n` }
  }
  const found = config.findCommand(id)
  if (!found) {
    throw usageError(`unknown command '${id}'`)
  }
  // oclif types a loaded command as its abstract base; every entry in COMMANDS is a concrete Kalup command.
  const Found = (await found.load()) as unknown as new (argv: string[], config: Config) => unknown
  const command = new Found(rest, config)
  if (!(command instanceof KalupCommand)) {
    throw new Error(`command ${id} is not a Kalup command`)
  }
  command.cwd = cwd
  command.prompt = prompt
  // --json prints one envelope and nothing else on stdout; a progress line goes to stderr, and only without it.
  const stderr = io?.stderr
  command.progress =
    stderr && !argv.includes('--json') ? (line) => stderr.write(`${sanitize(line, PROGRESS_MAX)}\n`) : undefined
  const interruptible = (Found as unknown as { interruptible?: boolean }).interruptible === true
  const interrupts = interruptible && io ? watch(io) : undefined
  command.signal = interrupts?.signal
  try {
    return await command.run()
  } catch (error) {
    throw fromParser(error)
  } finally {
    interrupts?.dispose()
  }
}

/** Exit code of a second signal: the run stopped mid-way, and a write may have landed. */
const HARD_STOP = exitCodes.partial
/**
 * A second signal this soon after the first is the same interrupt: under npx, npm forwards the terminal's SIGINT to
 * its child, which the terminal already sent to the whole process group, so one Ctrl-C arrives twice.
 */
const SAME_INTERRUPT_MS = 1000

// The first SIGINT or SIGTERM aborts the signal and says so; a second one a second or more later exits at once.
// Listening replaces Node's default, which ends the process, so the listeners go as soon as the command returns.
function watch(io: Pick<Io, 'exit' | 'signals' | 'stderr'>): { dispose: () => void; signal: AbortSignal } | undefined {
  const { signals } = io
  if (!signals) {
    return undefined
  }
  const controller = new AbortController()
  let first: number | undefined
  const listener = () => {
    if (first === undefined) {
      first = Date.now()
      controller.abort()
      io.stderr.write('Stopping after the request in flight. Send the signal again to stop at once.\n')
      return
    }
    if (Date.now() - first >= SAME_INTERRUPT_MS) {
      io.exit?.(HARD_STOP)
    }
  }
  signals.on('SIGINT', listener)
  signals.on('SIGTERM', listener)
  return {
    signal: controller.signal,
    dispose: () => {
      signals.off('SIGINT', listener)
      signals.off('SIGTERM', listener)
    },
  }
}

let configLoad: Promise<Config> | undefined

// One Config per process: it holds the package's command metadata, which never changes between invocations.
// User, dev and just-in-time plugins stay off, so loading never reads the user's home directory for plugins.
function loadConfig(): Promise<Config> {
  configLoad ??= Config.load({ root: packageRoot(), userPlugins: false, devPlugins: false, jitPlugins: false })
  return configLoad
}

// The nearest ancestor holding the kalup package.json: the package root both from dist/ and when installed.
function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  while (dirname(dir) !== dir) {
    const file = join(dir, 'package.json')
    if (existsSync(file) && (JSON.parse(readFileSync(file, 'utf8')) as { name?: string }).name === bin) {
      return dir
    }
    dir = dirname(dir)
  }
  throw new Error('the kalup package.json was not found above the host module')
}

const ROOT_FLAGS = new Set(['--json', '--help', '-h', '--version'])

/**
 * The command id is the first argument that is neither a flag nor a flag's value, so flags may come before or
 * after it. A flag takes a value when any command declares it as an option; `--flag=value` carries its own.
 * Without a command only the root flags are accepted: anything else, even beside --help or --version, is E_USAGE.
 */
function splitCommand(argv: string[], config: Config): { id?: string; rest: string[] } {
  const flags = config.commands.flatMap((command) => Object.entries(command.flags))
  const valued = new Set(flags.filter(([, flag]) => flag.type === 'option').map(([name]) => `--${name}`))
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string
    if (arg.startsWith('-')) {
      if (valued.has(arg)) {
        i += 1
      }
      continue
    }
    // A topic's command is the next word that is neither a flag nor a flag's value: `state rebuild`.
    const next = isTopic(config, arg) ? subcommand(argv, i + 1, valued) : undefined
    const id = next === undefined ? undefined : `${arg}:${argv[next]}`
    if (next !== undefined && id !== undefined) {
      if (!config.findCommand(id)) {
        throw usageError(`unknown command '${arg} ${argv[next]}'`)
      }
      return { id, rest: argv.filter((_, at) => at !== i && at !== next) }
    }
    return { id: arg, rest: [...argv.slice(0, i), ...argv.slice(i + 1)] }
  }
  // The first stray argument is always a flag: a value only counts as one after a flag, which comes first.
  const stray = argv.find((arg) => !ROOT_FLAGS.has(arg))
  if (stray !== undefined) {
    const [name] = stray.split('=')
    throw usageError(
      flags.some(([declared]) => `--${declared}` === name) ? `${name} needs a command` : `unknown flag ${stray}`,
    )
  }
  return { rest: argv }
}

// A topic groups commands under one word, `state rebuild`; a command's own id is no topic.
function isTopic(config: Config, id: string): boolean {
  return config.commands.some((command) => command.id.startsWith(`${id}:`))
}

// The index of the first argument from `from` that is neither a flag nor a flag's value.
function subcommand(argv: string[], from: number, valued: Set<string>): number | undefined {
  for (let i = from; i < argv.length; i += 1) {
    const arg = argv[i] as string
    if (!arg.startsWith('-')) {
      return i
    }
    if (valued.has(arg)) {
      i += 1
    }
  }
  return undefined
}

/** The help for one command, or for the whole CLI, as oclif renders it, plain text, with the disclaimer. */
async function helpText(config: Config, id?: string): Promise<string> {
  const help = new CapturedHelp(config, { maxWidth: HELP_WIDTH, stripAnsi: true })
  // oclif's help writes the spaced form of a topic command's id (`state rebuild`) into the shared config's commands,
  // which would break every later lookup in this process, so the ids are put back.
  const ids = config.commands.map((command) => [command, command.id, command.aliases] as const)
  try {
    await help.showHelp(id === undefined ? [] : [id])
  } finally {
    for (const [command, original, aliases] of ids) {
      command.id = original
      command.aliases = aliases
    }
  }
  return `${help.lines.join('\n').trimEnd()}\n\n${disclaimer}`
}

class CapturedHelp extends Help {
  readonly lines: string[] = []

  protected override log(...args: string[]): void {
    this.lines.push(args.join(' '))
  }
}

// oclif's parser errors become E_USAGE. The three it types get Kalup's wording, arguments named as the help's usage
// line names them; the rest keep oclif's first line.
function fromParser(error: unknown): unknown {
  if (!(error instanceof Errors.CLIError) || error.oclif.exit !== 2) {
    return error
  }
  const { flags, args } = error as unknown as { flags?: unknown; args?: unknown }
  if (Array.isArray(flags) && typeof flags[0] === 'string') {
    return usageError(`unknown flag ${flags[0]}`)
  }
  if (Array.isArray(args) && typeof args[0] === 'string') {
    return usageError(`unexpected argument '${args[0]}'`)
  }
  if (Array.isArray(args) && args.length > 0) {
    const names = (args as { name: string }[]).map((arg) => arg.name.toUpperCase())
    return usageError(`missing argument${names.length > 1 ? 's' : ''} ${names.join(', ')}`)
  }
  return usageError(sanitize(error.message.split('\n')[0] ?? ''))
}

// A KalupError carries its exit code, core's IssueError means the config is invalid, anything else is exit 1 with
// one sanitized line and never a key.
function failure(error: unknown): { issues: Issue[]; exitCode: ExitCode } {
  if (error instanceof KalupError) {
    return error
  }
  if (error instanceof IssueError) {
    return { issues: error.issues, exitCode: exitCodes.invalid }
  }
  const message = error instanceof Error ? error.message : String(error)
  const issue: Issue = { code: 'E_UNEXPECTED', message: sanitize(message.split('\n')[0] ?? '') }
  return { issues: [issue], exitCode: exitCodes.error }
}

/** Points each issue at its page in the shipped docs folder. test/docs.test.ts checks every code has one. */
function withDocs(issues: Issue[]): Issue[] {
  return issues.map((issue) => ({ ...issue, docs: issue.docs ?? `errors/${issue.code}.md` }))
}

/**
 * One line per issue: `file:line: CODE: message (fix: ...) (docs: ...)`. A file named on the command line is text, and
 * a message or fix can quote kalup.config.ts (a target name, defaultTarget), so each is sanitized, never shortened.
 */
function formatIssue(issue: Issue): string {
  const where = issue.file
    ? `${sanitize(issue.file, PATH_MAX)}${issue.line === undefined ? '' : `:${issue.line}`}: `
    : ''
  const fix = issue.fix ? ` (fix: ${sanitize(issue.fix, Number.POSITIVE_INFINITY)})` : ''
  const docs = issue.docs ? ` (docs: ${issue.docs})` : ''
  return `${where}${issue.code}: ${sanitize(issue.message, Number.POSITIVE_INFINITY)}${fix}${docs}`
}

function printLines(issues: Issue[], out: Out): void {
  if (issues.length > 0) {
    out.write(`${issues.map(formatIssue).join('\n')}\n`)
  }
}
