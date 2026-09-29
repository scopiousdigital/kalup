// The keys for a target: from the process environment, else from .env in the project directory. The write key only
// for the commands that write, and from the process environment alone under --approve.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { exitCodes, KalupError } from './output.js'

export const defaultKeyVariable = 'HUBSPOT_SERVICE_KEY'

export interface ReadKey {
  key: string
  variable: string
}

export interface WriteKey extends ReadKey {
  /** Whether the target names its own `credentials.write`, a variable other than the read credential's. */
  separate: boolean
}

interface Credentials {
  credentials?: { read: { env: string }; write?: { env: string } }
}

const newline = /\r?\n/
const assignment = /^(?:export\s+)?(\w+)\s*=\s*(.*)$/
/** What a request header value may carry: tab, space, printable ASCII and the bytes above it. */
const HEADER_VALUE = /^[\t\x20-\x7e\x80-\xff]*$/
/** An environment variable's name, as credentials.*.env must give it. */
export const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/
const quotedValue = /^(["'])(.*?)\1/
const trailingComment = /\s+#.*$/

/** Parses `KEY=value` lines: blank lines, `#` comments, an `export` prefix and single or double quotes. */
export function parseDotenv(text: string): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const raw of text.split(newline)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) {
      continue
    }
    const match = assignment.exec(line)
    if (!match) {
      continue
    }
    const [, name = '', rest = ''] = match
    const quoted = quotedValue.exec(rest)
    vars[name] = quoted ? (quoted[2] ?? '') : rest.replace(trailingComment, '').trim()
  }
  return vars
}

/** Resolves the read key named by `credentials.read.env`, else HUBSPOT_SERVICE_KEY. The error never carries a value. */
export function resolveReadKey(
  target: { credentials?: { read: { env: string } } },
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): ReadKey {
  const variable = target.credentials ? target.credentials.read.env : defaultKeyVariable
  const key = env[variable] || readDotenv(cwd)[variable]
  if (!key) {
    throw missingKey(variable, `Set ${named(variable)} in the environment or in .env in the project directory.`)
  }
  return { key: sendable(key, variable), variable }
}

/**
 * Resolves the write key: `credentials.write.env` when the target names one, else the read credential's variable, else
 * HUBSPOT_SERVICE_KEY. With `envOnly` (for --approve) the target must name its own write credential, the key comes
 * from the process environment only, and a .env in `root` that defines the variable at all is E_APPROVE_CREDENTIAL.
 * No error carries a value.
 */
export function resolveWriteKey(
  target: Credentials,
  root = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
  options: { envOnly?: boolean } = {},
): WriteKey {
  const { credentials } = target
  // A credentials.write that names the read variable holds nothing apart.
  const separate = credentials?.write !== undefined && credentials.write.env !== credentials.read.env
  let variable = defaultKeyVariable
  if (credentials) {
    variable = credentials.write ? credentials.write.env : credentials.read.env
  }
  if (!options.envOnly) {
    const key = env[variable] || readDotenv(root)[variable]
    if (!key) {
      throw missingKey(variable, `Set ${named(variable)} in the environment or in .env in the project directory.`)
    }
    return { key: sendable(key, variable), variable, separate }
  }
  if (!separate) {
    throw approveCredential(
      '--approve needs a write key that only the reviewed CI environment holds, and this target names no credentials.write apart from its read credential.',
      'Give the target credentials.write with a variable only the reviewed CI environment holds, or have a person apply the plan at a terminal.',
    )
  }
  if (Object.hasOwn(readDotenv(root), variable)) {
    throw approveCredential(
      `--approve needs a write key that only the reviewed CI environment holds, and .env in the project directory defines ${named(variable)}.`,
      `Remove ${named(variable)} from .env, or have a person apply the plan at a terminal.`,
    )
  }
  const key = env[variable]
  if (!key) {
    throw missingKey(
      variable,
      `Set ${named(variable)} in the environment of the reviewed CI job; .env is not read here.`,
    )
  }
  return { key: sendable(key, variable), variable, separate }
}

// The variable as a message may name it: a name, never a value that looks like a key pasted in its place.
function named(variable: string): string {
  return VARIABLE.test(variable) ? variable : 'the variable credentials names'
}

function missingKey(variable: string, fix: string): KalupError {
  return new KalupError({ code: 'E_MISSING_KEY', message: `${named(variable)} is not set.`, fix })
}

// A key goes out in the Authorization header, and the HTTP client quotes a header value it refuses in its error: one
// with a line break or another control character is refused here, naming the variable and never the value.
function sendable(key: string, variable: string): string {
  if (HEADER_VALUE.test(key)) {
    return key
  }
  throw new KalupError({
    code: 'E_KEY_INVALID',
    message: `The value of ${named(variable)} holds a line break or another character a request header cannot carry, so it was not sent.`,
    fix: `Set ${named(variable)} again with the key alone on one line, as HubSpot shows it.`,
  })
}

// --approve rests on custody: only the reviewed CI environment holds the write key.
function approveCredential(message: string, fix: string): KalupError {
  return new KalupError({ code: 'E_APPROVE_CREDENTIAL', message, fix, humanRequired: true }, exitCodes.humanRequired)
}

function readDotenv(cwd: string): Record<string, string> {
  const file = join(cwd, '.env')
  return existsSync(file) ? parseDotenv(readFileSync(file, 'utf8')) : {}
}
