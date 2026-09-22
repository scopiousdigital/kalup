// The read key for a target: from the process environment, else from .env in the working directory.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { KalupError } from './output.js'

export const defaultKeyVariable = 'HUBSPOT_SERVICE_KEY'

export interface ReadKey {
  key: string
  variable: string
}

const newline = /\r?\n/
const assignment = /^(?:export\s+)?(\w+)\s*=\s*(.*)$/
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
    throw new KalupError({
      code: 'E_MISSING_KEY',
      message: `${variable} is not set.`,
      fix: `Set ${variable} in the environment or in .env in the project directory.`,
    })
  }
  return { key, variable }
}

function readDotenv(cwd: string): Record<string, string> {
  const file = join(cwd, '.env')
  return existsSync(file) ? parseDotenv(readFileSync(file, 'utf8')) : {}
}
