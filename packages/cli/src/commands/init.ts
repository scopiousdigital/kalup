// kalup init: check the key against --portal, write the project files, then run the first pull. Nothing is written
// before the portal answers, and a local file init cannot read stops it before the first request.
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type ConfigFile, type Target, write } from '@kalup/core'
import {
  createHttp,
  guardPortal,
  type Issue,
  KalupError,
  type PortalInfo,
  readScope,
  registry,
  resolveReadKey,
} from '../lib/index.js'
import { STANDARD_OBJECTS } from '../lib/pull/index.js'
import { agentsBlock, claudePointer } from '../lib/templates/agents.js'
import { bin } from '../usage.js'
import { usageError } from './args.js'
import { type PullData, pull } from './pull.js'
import type { Context, Result } from './run.js'

export interface ScopeLine {
  scope: string
  neededFor: string[]
}

export interface InitData {
  target: string
  portalId: number
  account: PortalInfo
  objects: string[]
  /** The read scopes the key needs, one per standard object plus the custom one when a custom object is in scope. */
  scopes: ScopeLine[]
  /** The files init wrote. The pull's own files are under `pull.files`. */
  files: string[]
  /** Absent when the first pull failed; its issues are in the envelope and the project files are still written. */
  pull?: PullData
}

interface Biome {
  files?: { includes?: string[] }
}

interface BiomeConfig {
  file: string
  text: string
  /** The text with the ignore added, or the text as it was when it has it. Absent when init cannot place it. */
  edited?: string
}

const CONFIG = 'kalup.config.ts'
const BARREL = 'kalup/index.ts'
/** biome.json wins over biome.jsonc when both exist, as in biome. */
const BIOME_FILES = ['biome.json', 'biome.jsonc']
const BIOME_IGNORE = '!kalup/**'
const DEFAULT_OBJECTS = ['contacts', 'companies', 'deals']
/** Above this many properties written for one object by the first pull, init warns and points at `include`. */
const LARGE_SCOPE = 200
const SERVICE_KEYS =
  'Development > Keys > Service keys, see https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/account-service-keys'
const NO_FORMATTER =
  'No biome.json or prettier config found. If you add a formatter, ignore kalup/ in it: the writer keeps those files in its own format.'

export async function init(ctx: Context): Promise<Result<InitData>> {
  const { cwd, flags } = ctx
  if (flags.check || flags.discover || flags.exitCode || flags.only !== undefined) {
    throw usageError(`${bin} init takes only --portal, --objects, --target and --json`)
  }
  const portalId = parsePortal(flags.portal)
  const objects = parseObjects(flags.objects)
  if (flags.target === 'config') throw usageError("a target may not be named 'config'")
  if (existsSync(join(cwd, CONFIG))) {
    throw new KalupError({
      code: 'E_CONFIG_EXISTS',
      message: `${CONFIG} already exists in ${cwd}`,
      file: CONFIG,
      fix: `this is a ${bin} project already: run npx ${bin} pull --target <name>, or remove the file to start over`,
    })
  }
  const biome = readBiome(cwd)

  const { key, variable } = resolveReadKey({}, cwd)
  // The pull that follows prints the rate-header warning once; a second copy from this client would say the same.
  const http = createHttp({ key, warn: () => {} })
  const account = await guardPortal(http, { portalId, variable })
  const sandbox = account.accountType === 'SANDBOX' || account.accountType === 'DEVELOPER_TEST'
  const target = flags.target ?? (sandbox ? 'sandbox' : 'production')
  const protect = account.accountType === 'STANDARD'
  const targetConfig: Target = {
    portalId,
    ...(protect ? { protected: true } : {}),
    credentials: { read: { env: variable } },
  }
  const config: ConfigFile = {
    imports: [],
    objects: Object.fromEntries(objects.map((object) => [object, {}])),
    targets: { [target]: targetConfig },
  }

  const files: string[] = []
  writeFileSync(join(cwd, CONFIG), write('config', config))
  files.push(CONFIG)
  if (append(cwd, '.gitignore', '.kalup/\n', /^\s*\/?\.kalup\/?\s*$/m)) files.push('.gitignore')
  let note: string | undefined
  if (biome === undefined) {
    if (usesPrettier(cwd)) {
      if (append(cwd, '.prettierignore', 'kalup/\n', /^\s*\/?kalup(\/(\*\*)?)?\s*$/m)) files.push('.prettierignore')
    } else {
      note = NO_FORMATTER
    }
  } else if (biome.edited === undefined) {
    note = `${biome.file} was left alone: init could not read files.includes in it. Add ${BIOME_IGNORE} to files.includes yourself: the writer keeps those files in its own format.`
  } else if (biome.edited !== biome.text) {
    writeFileSync(join(cwd, biome.file), biome.edited)
    files.push(biome.file)
  }
  if (append(cwd, 'AGENTS.md', agentsBlock, /<!-- kalup:start/, true)) files.push('AGENTS.md')
  // A CLAUDE.md linked to AGENTS.md holds the block already, and the pointer would make AGENTS.md import itself.
  const claude = join(cwd, 'CLAUDE.md')
  const linked = existsSync(claude) && realpathSync(claude) === realpathSync(join(cwd, 'AGENTS.md'))
  if (!linked && append(cwd, 'CLAUDE.md', `${claudePointer}\n`, /@AGENTS\.md/)) files.push('CLAUDE.md')

  let pulled: Result<PullData> | KalupError
  try {
    pulled = (await pull({ cwd, flags: { ...flags, target } })) as Result<PullData>
  } catch (error) {
    if (!(error instanceof KalupError)) throw error
    pulled = error
  }
  // The barrel, so `./kalup` imports from the first minute. The pull writes it when it wrote an object file.
  if (!existsSync(join(cwd, BARREL))) {
    mkdirSync(join(cwd, 'kalup'), { recursive: true })
    writeFileSync(join(cwd, BARREL), write('barrel', []))
    files.push(BARREL)
  }

  const scopes = scopeLines(objects)
  const data: InitData = { target, portalId, account, objects, scopes, files }
  const lines = [
    `Portal ${portalId}: ${account.accountType}, ${account.uiDomain}, ${account.timeZone}`,
    `Target ${target}${protect ? ' (protected)' : ''}: ${objects.join(', ')}`,
    `Read scopes the key in ${variable} needs (${SERVICE_KEYS}):`,
    ...scopes.map((s) => `  ${s.scope} (${s.neededFor.join(', ')})`),
    ...files.map((file) => `wrote ${file}`),
    ...(note === undefined ? [] : [note]),
  ]
  if (pulled instanceof KalupError) {
    const retry: Issue = {
      code: 'E_FIRST_PULL',
      message: 'The project files are written, but the first pull failed.',
      fix: `fix the issue above, then run npx ${bin} pull --target ${target}`,
    }
    return { data, issues: [...pulled.issues, retry], text: `${lines.join('\n')}\n`, exitCode: pulled.exitCode }
  }
  data.pull = pulled.data
  return {
    data,
    issues: [...largeScope(pulled.data), ...(pulled.issues ?? [])],
    text: `${lines.join('\n')}\n${pulled.text ?? ''}`,
    exitCode: pulled.exitCode,
  }
}

function parsePortal(value: string | undefined): number {
  if (value === undefined) throw usageError(`${bin} init needs --portal <id>, the Hub ID from the HubSpot account menu`)
  if (!/^[1-9]\d*$/.test(value)) throw usageError(`--portal needs the Hub ID, a positive integer, not '${value}'`)
  return Number(value)
}

function parseObjects(value: string | undefined): string[] {
  if (value === undefined) return DEFAULT_OBJECTS
  const objects = value
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '')
  if (objects.length === 0) throw usageError('--objects needs at least one object name')
  return [...new Set(objects)]
}

// One warning per object the first pull wrote more than 200 properties for: every custom property is in scope.
function largeScope(data: PullData | undefined): Issue[] {
  const out: Issue[] = []
  for (const [object, report] of Object.entries(data?.objects ?? {})) {
    const n = report.changes.filter((c) => c.kind === 'added' && c.address.startsWith('property:')).length
    if (n <= LARGE_SCOPE) continue
    out.push({
      code: 'W_LARGE_SCOPE',
      message: `the first pull wrote ${n} properties for ${object}: every custom property is in the pull scope`,
      configPath: `objects.${object}`,
      fix: `set objects.${object}.custom to false and list the properties the app needs under objects.${object}.include`,
    })
  }
  return out
}

// One line per read scope with the objects that need it, as status probes them: standard objects that share a scope
// (communications and postal mail) share a line, and every custom object is on the custom scope's line.
function scopeLines(objects: string[]): ScopeLine[] {
  const out = new Map<string, string[]>()
  for (const object of objects) {
    const scope = STANDARD_OBJECTS.has(object) ? readScope(registry.property, object) : registry.object.scopes.read[0]
    out.set(scope, [...(out.get(scope) ?? []), object])
  }
  return [...out].map(([scope, neededFor]) => ({ scope, neededFor }))
}

/**
 * Appends `addition` to `file` unless its text already matches `present`, creating the file when it is missing.
 * `blank` puts an empty line between the old text and the addition. Returns whether it wrote.
 */
function append(cwd: string, file: string, addition: string, present: RegExp, blank = false): boolean {
  const path = join(cwd, file)
  const text = existsSync(path) ? readFileSync(path, 'utf8') : ''
  if (present.test(text)) return false
  const gap = text === '' ? '' : `${text.endsWith('\n') ? '' : '\n'}${blank ? '\n' : ''}`
  writeFileSync(path, `${text}${gap}${addition}`)
  return true
}

// biome.json or biome.jsonc and its text with the ignore added, or nothing when there is neither. Read before anything
// is written, so a biome.json that is not JSON stops init with the directory as it was. biome reads biome.json as
// plain JSON, so a comment there is an error too. A biome.jsonc is read with its comments blanked; one that is still
// not JSON (trailing commas, which biome allows there) is not broken, so init leaves it alone and prints a note.
function readBiome(cwd: string): BiomeConfig | undefined {
  const file = BIOME_FILES.find((name) => existsSync(join(cwd, name)))
  if (file === undefined) return undefined
  const text = readFileSync(join(cwd, file), 'utf8')
  const json = file === 'biome.jsonc' ? blankComments(text) : text
  let config: Biome
  try {
    config = JSON.parse(json) as Biome
  } catch (error) {
    if (file === 'biome.jsonc') return { file, text }
    throw new KalupError({
      code: 'E_BIOME_CONFIG',
      message: `${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      file,
      fix: `fix the file, then run npx ${bin} init again`,
    })
  }
  return { file, text, edited: biomeIgnore(text, json, config) }
}

// Comments outside strings turned to spaces, line breaks kept, so the text parses and every offset still points into
// the file. Strings are matched first so a // inside one (the $schema URL) stays.
function blankComments(text: string): string {
  return text.replace(/("(?:[^"\\\n]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (comment, string?: string) =>
    string === undefined ? comment.replace(/[^\r\n]/g, ' ') : string,
  )
}

// `!kalup/**` added to biome's files.includes as a text edit, so the file keeps its comments and its format and still
// passes its own biome check. A missing includes means every file, which `**` spells out. The new entry goes last, on
// a line of its own after any comment that ends the last entry's line when the entries are on lines of their own.
// `json` is `text` with its comments blanked. Undefined when files is not an object or files.includes not a list.
function biomeIgnore(text: string, json: string, config: Biome): string | undefined {
  const includes = config.files?.includes
  if (Array.isArray(includes) && includes.includes(BIOME_IGNORE)) return text
  const [path, item]: [string[], string] =
    includes !== undefined
      ? [['files', 'includes'], `"${BIOME_IGNORE}"`]
      : config.files !== undefined
        ? [['files'], `"includes": ["**", "${BIOME_IGNORE}"]`]
        : [[], `"files": { "includes": ["**", "${BIOME_IGNORE}"] }`]
  const at = container(json, path)
  if (at === undefined || json[at.open] !== (includes === undefined ? '{' : '[')) return undefined
  const inside = json.slice(at.open + 1, at.close)
  if (inside.trim() === '') {
    const pad = json[at.open] === '{' ? ' ' : ''
    return `${text.slice(0, at.open + 1)}${pad}${item}${pad}${text.slice(at.open + 1)}`
  }
  const end = at.open + 1 + inside.trimEnd().length
  const indent = /\r?\n[ \t]*$/.exec(inside.slice(0, inside.length - inside.trimStart().length))?.[0]
  const eol = indent === undefined ? -1 : json.slice(end, at.close).search(/\r?\n/)
  const after = eol === -1 ? end : end + eol
  return `${text.slice(0, end)},${text.slice(end, after)}${indent ?? ' '}${item}${text.slice(after)}`
}

// The offsets of the brackets around the object or array at `path` in JSON text. Strings are matched whole, so a
// bracket inside one does not count; a string followed by a colon is a key. An array's entries have the key ''.
function container(json: string, path: string[]): { open: number; close: number } | undefined {
  const want = JSON.stringify(path)
  const open: { path: string[]; at: number }[] = []
  let key = ''
  for (const match of json.matchAll(/("(?:[^"\\]|\\.)*")(\s*:)?|[{}[\]]/g)) {
    const [token, string, colon] = match
    if (string !== undefined) {
      if (colon !== undefined) key = JSON.parse(string) as string
      continue
    }
    if (token === '{' || token === '[') {
      const parent = open.at(-1)
      open.push({ path: parent === undefined ? [] : [...parent.path, key], at: match.index })
    } else {
      const done = open.pop()
      if (done !== undefined && JSON.stringify(done.path) === want) return { open: done.at, close: match.index }
    }
    key = ''
  }
  return undefined
}

// A prettier config: .prettierrc with any extension, prettier.config.*, an existing .prettierignore, or a `prettier`
// key in package.json.
function usesPrettier(cwd: string): boolean {
  const names = readdirSync(cwd)
  if (names.some((n) => n === '.prettierignore' || n.startsWith('.prettierrc') || n.startsWith('prettier.config.'))) {
    return true
  }
  try {
    return Object.hasOwn(JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')), 'prettier')
  } catch {
    return false
  }
}
