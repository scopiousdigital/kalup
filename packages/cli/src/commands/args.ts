// Argument parsing with no dependency: <command> [args] plus the global flags, in any order.
import { KalupError } from '../lib/index.js'
import { bin } from '../usage.js'

export interface Flags {
  json: boolean
  check: boolean
  exitCode: boolean
  help: boolean
  version: boolean
  target?: string
}

export interface Parsed {
  command?: string
  args: string[]
  flags: Flags
}

const switches: Record<string, keyof Omit<Flags, 'target'>> = {
  '--json': 'json',
  '--check': 'check',
  '--exit-code': 'exitCode',
  '--help': 'help',
  '-h': 'help',
  '--version': 'version',
}

export function usageError(message: string): KalupError {
  return new KalupError({ code: 'E_USAGE', message, fix: `run ${bin} --help` })
}

export function parseArgs(argv: string[]): Parsed {
  const flags: Flags = { json: false, check: false, exitCode: false, help: false, version: false }
  const args: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? ''
    // Object.hasOwn: a plain lookup would take `toString` or `constructor` for a switch.
    const flag = Object.hasOwn(switches, arg) ? switches[arg] : undefined
    if (flag) {
      flags[flag] = true
    } else if (arg === '--target') {
      const name = argv[++i]
      if (name === undefined || name.startsWith('-')) throw usageError('--target needs a target name')
      flags.target = name
    } else if (arg.startsWith('-')) {
      throw usageError(`unknown flag ${arg}`)
    } else {
      args.push(arg)
    }
  }
  const [command, ...rest] = args
  return { command, args: rest, flags }
}
