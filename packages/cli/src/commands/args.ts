// Argument parsing with no dependency: <command> [args] plus the global flags, in any order.
import { KalupError } from '../lib/index.js'
import { bin } from '../usage.js'

export interface Flags {
  json: boolean
  check: boolean
  exitCode: boolean
  discover: boolean
  help: boolean
  version: boolean
  target?: string
  only?: string
  portal?: string
  objects?: string
}

export interface Parsed {
  command?: string
  args: string[]
  flags: Flags
}

type Valued = 'target' | 'only' | 'portal' | 'objects'

const switches: Record<string, keyof Omit<Flags, Valued>> = {
  '--json': 'json',
  '--check': 'check',
  '--exit-code': 'exitCode',
  '--discover': 'discover',
  '--help': 'help',
  '-h': 'help',
  '--version': 'version',
}

// Flags that take the next argument as their value.
const valued: Record<string, { flag: Valued; needs: string }> = {
  '--target': { flag: 'target', needs: 'a target name' },
  '--only': { flag: 'only', needs: 'an address glob' },
  '--portal': { flag: 'portal', needs: 'the Hub ID' },
  '--objects': { flag: 'objects', needs: 'a comma-separated list of object names' },
}

export function usageError(message: string): KalupError {
  return new KalupError({ code: 'E_USAGE', message, fix: `run ${bin} --help` })
}

export function parseArgs(argv: string[]): Parsed {
  const flags: Flags = { json: false, check: false, exitCode: false, discover: false, help: false, version: false }
  const args: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? ''
    // Object.hasOwn: a plain lookup would take `toString` or `constructor` for a switch.
    const flag = Object.hasOwn(switches, arg) ? switches[arg] : undefined
    const takes = Object.hasOwn(valued, arg) ? valued[arg] : undefined
    if (flag) {
      flags[flag] = true
    } else if (takes) {
      const value = argv[++i]
      // An empty value is an unset shell variable, not a name.
      if (value === undefined || value === '' || value.startsWith('-')) throw usageError(`${arg} needs ${takes.needs}`)
      flags[takes.flag] = value
    } else if (arg.startsWith('-')) {
      throw usageError(`unknown flag ${arg}`)
    } else {
      args.push(arg)
    }
  }
  const [command, ...rest] = args
  return { command, args: rest, flags }
}
