// A person at a terminal: a command run in a pseudo-terminal from `script`, with answers typed as its prompts appear.
// The e2e journeys and scripts/pack-smoke.mjs share it. Node builtins only and erasable TypeScript, so pack-smoke loads
// it with Node's type stripping.
//
// macOS's script refuses the socket Node gives a child as stdin (and a FIFO, which it takes for one), so cat stands
// between them and hands script a pipe. Closing stdin while the command runs would reach it as ^D, so input stays open
// until script has exited, which the wrapper reports on stderr. sh, cat and script run as a process group of their own,
// so at the deadline one kill stops them all and the run settles with status 'timeout'.
import { spawn, spawnSync } from 'node:child_process'

/** Typed once the output shows `after`, past what the previous answer waited for. End it with '\r' to press Enter. */
export interface Answer {
  after: string
  type: string
}

export interface Typed {
  /** What the terminal showed, stdout and stderr together, with the answers as it echoed them and \n line ends. */
  printed: string
  /** The command's exit status, or 'timeout' when the deadline stopped it. */
  status: number | 'timeout'
}

export interface TerminalOptions {
  answers?: Answer[]
  cwd: string
  /** The command's whole environment. CI is left out, since a terminal under CI never prompts. */
  env: NodeJS.ProcessEnv
  timeoutMs?: number
}

const EXITED = 'kalup-terminal: script exited'

/** Why no pseudo-terminal is available here, or undefined when `script` can give one. */
export function noPseudoTerminal(): string | undefined {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    return `${process.platform} has no pseudo-terminal`
  }
  if (spawnSync('sh', ['-c', 'command -v script']).status !== 0) {
    return 'no script command for a pseudo-terminal'
  }
  return undefined
}

/** `words` as one sh argument. */
export function shellQuote(words: string): string {
  return `'${words.replaceAll("'", "'\\''")}'`
}

/** Runs `command`, the program and its arguments, in a pseudo-terminal and types `answers` at its prompts. */
export function inTerminal(command: string[], options: TerminalOptions): Promise<Typed> {
  const words = command.map(shellQuote).join(' ')
  const pty =
    process.platform === 'darwin' ? `script -q /dev/null ${words}` : `script -qec ${shellQuote(words)} /dev/null`
  const wrapper = `cat | { ${pty}; status=$?; echo '${EXITED}' >&2; exit "$status"; }`
  const { CI: _, ...env } = options.env
  const answers = [...(options.answers ?? [])]
  return new Promise((done) => {
    const child = spawn('sh', ['-c', wrapper], { cwd: options.cwd, detached: true, env })
    let printed = ''
    let from = 0
    let settled = false
    const settle = (status: number | 'timeout') => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        done({ status, printed: printed.replaceAll('\r\n', '\n') })
      }
    }
    const timer = setTimeout(() => {
      try {
        process.kill(-(child.pid ?? 0), 'SIGKILL')
      } catch {
        // The group has exited already.
      }
      settle('timeout')
    }, options.timeoutMs ?? 30_000)
    // Each answer whose prompt the output now shows, in order.
    const type = (): void => {
      const [next] = answers
      const at = next === undefined ? -1 : printed.indexOf(next.after, from)
      if (next !== undefined && at !== -1) {
        answers.shift()
        from = at + next.after.length
        child.stdin.write(next.type)
        type()
      }
    }
    child.stdout.on('data', (chunk: Buffer) => {
      printed += chunk.toString()
      type()
    })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
      if (stderr.includes(EXITED)) {
        child.stdin.end()
      }
    })
    child.on('close', (status) => settle(status ?? 'timeout'))
  })
}
