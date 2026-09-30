// kalup init: check the key against --portal, write the project files, then run the first pull. Nothing is written
// before the portal answers, and a local file init cannot read stops it before the first request.
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Target } from '@kalup/core'
import {
  bin,
  type ConfigFile,
  createHttp,
  guardPortal,
  KalupError,
  limitScope,
  type PortalInfo,
  readScope,
  registry,
  STANDARD_OBJECTS,
  targetFlag,
  write,
  writeScope,
} from '@kalup/engine'
import { resolveReadKey } from '../lib/auth.js'
import type { Issue } from '../lib/output.js'
import { agentsBlock, claudePointer } from '../lib/templates/agents.js'
import { version } from '../version.js'
import { type Context, type Result, usageError } from './context.js'
import { type PullData, pull } from './pull.js'

export interface ScopeLine {
  neededFor: string[]
  scope: string
}

export interface InitData {
  account: PortalInfo
  /** The files init wrote. The pull's own files are under `pull.files`. */
  files: string[]
  objects: string[]
  packageJson: PackageJsonData
  portalId: number
  /** Absent when the first pull failed; its issues are in the envelope and the project files are still written. */
  pull?: PullData
  /**
   * The one crm.objects read scope recommended so plan can read the property limit: HubSpot's Limits Tracking answers
   * 403 to a key with crm.schemas scopes only, and 200 once this scope is added (observed on 2026-09-29).
   */
  recommended: ScopeLine
  /** The read scopes the key needs, one per standard object plus the custom one when a custom object is in scope. */
  scopes: ScopeLine[]
  target: string
  /** The write scopes apply needs on the write key besides the read scopes, as `scopes` lists those. */
  writeScopes: ScopeLine[]
}

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

export interface PackageJsonData {
  /** Whether init added @kalup/core to dependencies in package.json. */
  added: boolean
  /** Whether the directory has a package.json. init never creates one. */
  found: boolean
  /**
   * From the nearest lockfile, else the nearest packageManager field in package.json, else npm_config_user_agent, else
   * npm. The search goes up from the directory and stops at the first one with .git or pnpm-workspace.yaml.
   */
  manager: PackageManager
}

interface Biome {
  files?: { includes?: string[] }
}

interface BiomeConfig {
  /** The text with the ignores added, or the text as it was when it has them. Absent when init cannot place them. */
  edited?: string
  file: string
  text: string
}

const CONFIG = 'kalup.config.ts'
const BARREL = 'kalup/index.ts'
/** biome.json wins over biome.jsonc when both exist, as in biome. */
const BIOME_FILES = ['biome.json', 'biome.jsonc']
/**
 * What init adds to biome's files.includes, each with the entries that already ignore the same path: the files the
 * writer formats, and .kalup, where state is written in its own format from the first pull on.
 */
const BIOME_IGNORES: [entry: string, present: string[]][] = [
  ['!kalup', ['!kalup', '!kalup/**', '!!kalup', '!!kalup/**']],
  ['!kalup.config.ts', ['!kalup.config.ts', '!!kalup.config.ts']],
  ['!.kalup', ['!.kalup', '!.kalup/**', '!!.kalup', '!!.kalup/**']],
]
const CORE = '@kalup/core'
/** The dependency lists that count as having @kalup/core already. */
const DEPENDENCY_LISTS = ['dependencies', 'devDependencies', 'peerDependencies']
/** The first lockfile found names the package manager. */
const LOCKFILES: [file: string, manager: PackageManager][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
]
const MANAGERS: readonly string[] = ['npm', 'pnpm', 'yarn', 'bun']
/** A directory with one of these is the top of the project or workspace: the lockfile search stops there. */
const PROJECT_ROOTS = ['.git', 'pnpm-workspace.yaml']
const DEFAULT_OBJECTS = ['contacts', 'companies', 'deals']
/** Above this many properties written for one object by the first pull, init warns and points at `include`. */
const LARGE_SCOPE = 200
const SERVICE_KEYS =
  'Development > Keys > Service keys, see https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/account-service-keys'
const NO_FORMATTER =
  'No biome.json or prettier config found. If you add a formatter, ignore kalup/ and kalup.config.ts in it: the writer keeps those files in its own format.'
const HUB_ID = /^[1-9]\d*$/
const GITIGNORE_KALUP = /^\s*\/?\.kalup\/?\s*$/m
// A line that ignores .env, or with a leading ! un-ignores it: .env, .env*, *.env or *.env*, bare or after / or **/.
// git trims trailing spaces and the \r of a CRLF line, but reads a leading space or a trailing tab as part of the name.
const GITIGNORE_ENV = /^!?(?:\/|\*\*\/)?\*?\.env\*? *\r?$/
const PRETTIERIGNORE_KALUP = /^\s*\/?kalup(\/(\*\*)?)?\s*$/m
const PRETTIERIGNORE_CONFIG = /^\s*\/?kalup\.config\.ts\s*$/m
const AGENTS_BLOCK = /<!-- kalup:start/
const CLAUDE_POINTER = /@AGENTS\.md/
const LINE_INDENT = /\r?\n[ \t]*$/
const LINE_BREAK = /\r?\n/
const JSON_INDENT = /^([ \t]+)"/m

export async function init(ctx: Context): Promise<Result<InitData>> {
  const { cwd, flags } = ctx
  const portalId = parsePortal(flags.portal)
  const objects = parseObjects(flags.objects)
  if (flags.target === 'config') {
    throw usageError("a target may not be named 'config'")
  }
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
  const http = createHttp({ key, warn: () => undefined })
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
  // A .gitignore init creates also keeps node_modules out: the project was just set up with npm install.
  if (!existsSync(join(cwd, '.gitignore'))) {
    writeFileSync(join(cwd, '.gitignore'), 'node_modules/\n')
  }
  // .env is where the key goes, whether or not it exists yet.
  const kalup = append(cwd, '.gitignore', '.kalup/\n', GITIGNORE_KALUP)
  const env = append(cwd, '.gitignore', '.env\n', { test: ignoresEnv })
  if (kalup || env) {
    files.push('.gitignore')
  }
  const note = ignoreInFormatter(cwd, biome, files)
  writeAgentFiles(cwd, files)
  const core = addCore(cwd, files)

  let pulled: Result<PullData> | KalupError
  try {
    pulled = (await pull({ cwd, args: [], flags: { ...flags, target } })) as Result<PullData>
  } catch (error) {
    if (!(error instanceof KalupError)) {
      throw error
    }
    pulled = error
  }
  // The barrel, so `./kalup` imports from the first minute. The pull writes it when it wrote an object file.
  if (!existsSync(join(cwd, BARREL))) {
    mkdirSync(join(cwd, 'kalup'), { recursive: true })
    writeFileSync(join(cwd, BARREL), write('barrel', []))
    files.push(BARREL)
  }

  const scopes = scopeLines(objects, 'read')
  const writeScopes = scopeLines(objects, 'write')
  const recommended = { scope: limitScope(objects), neededFor: ['the property limit check in plan'] }
  const data: InitData = {
    target,
    portalId,
    account,
    objects,
    scopes,
    recommended,
    writeScopes,
    files,
    packageJson: core.data,
  }
  const lines = [
    `Portal ${portalId}: ${account.accountType}, ${account.uiDomain}, ${account.timeZone}`,
    `Target ${target}${protect ? ' (protected)' : ''}: ${objects.join(', ')}`,
    // The account type only suggests a name: it gives the target no role.
    ...(flags.target === undefined
      ? [`Named the target ${target} from the account type. Rename it in ${CONFIG} if you want another name.`]
      : []),
    `Read scopes the key in ${variable} needs (${SERVICE_KEYS}):`,
    ...scopes.map((s) => `  ${s.scope} (${s.neededFor.join(', ')})`),
    `  ${recommended.scope} (recommended, for the property limit check in plan; ${bin} reads no records)`,
    'For apply, the write key needs the read scopes and:',
    ...writeScopes.map((s) => `  ${s.scope} (${s.neededFor.join(', ')})`),
    ...files.map((file) => `wrote ${file}`),
    ...(note === undefined ? [] : [note]),
  ]
  // The install step goes last, after the pull's output, as the one thing left to do.
  const next = core.next === undefined ? '' : `${core.next}\n`
  if (pulled instanceof KalupError) {
    const retry: Issue = {
      code: 'E_FIRST_PULL',
      message: 'The project files are written, but the first pull failed.',
      fix: `fix the issue above, then run npx ${bin} pull ${targetFlag(target)}`,
    }
    return { data, issues: [...pulled.issues, retry], text: `${lines.join('\n')}\n${next}`, exitCode: pulled.exitCode }
  }
  data.pull = pulled.data
  return {
    data,
    issues: [...largeScope(pulled.data), ...(pulled.issues ?? [])],
    text: `${lines.join('\n')}\n${pulled.text ?? ''}${next}`,
    exitCode: pulled.exitCode,
  }
}

function parsePortal(value: string | undefined): number {
  if (value === undefined) {
    throw usageError(`${bin} init needs --portal <id>, the Hub ID from the HubSpot account menu`)
  }
  if (!HUB_ID.test(value)) {
    throw usageError(`--portal needs the Hub ID, a positive integer, not '${value}'`)
  }
  return Number(value)
}

function parseObjects(value: string | undefined): string[] {
  if (value === undefined) {
    return DEFAULT_OBJECTS
  }
  const objects = value
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '')
  if (objects.length === 0) {
    throw usageError('--objects needs at least one object name')
  }
  return [...new Set(objects)]
}

// One warning per object the first pull wrote more than 200 properties for: every custom property is in scope.
function largeScope(data: PullData | undefined): Issue[] {
  const out: Issue[] = []
  for (const [object, report] of Object.entries(data?.objects ?? {})) {
    const n = report.changes.filter((c) => c.kind === 'added' && c.address.startsWith('property:')).length
    if (n <= LARGE_SCOPE) {
      continue
    }
    out.push({
      code: 'W_LARGE_SCOPE',
      message: `the first pull wrote ${n} properties for ${object}: every custom property is in the pull scope`,
      configPath: `objects.${object}`,
      fix: `set objects.${object}.custom to false and list the properties the app needs under objects.${object}.include`,
    })
  }
  return out
}

/**
 * One line per read or write scope with the objects that need it, as status probes the read ones: standard objects
 * that share a scope (communications and postal mail) share a line, and every custom object is on the custom scope's.
 */
export function scopeLines(objects: string[], access: 'read' | 'write'): ScopeLine[] {
  const out = new Map<string, string[]>()
  const scopeOf = access === 'read' ? readScope : writeScope
  for (const object of objects) {
    const scope = STANDARD_OBJECTS.has(object) ? scopeOf(registry.property, object) : registry.object.scopes[access][0]
    out.set(scope, [...(out.get(scope) ?? []), object])
  }
  return [...out].map(([scope, neededFor]) => ({ scope, neededFor }))
}

// kalup/, kalup.config.ts and .kalup/ ignored in the biome config when there is one, else in .prettierignore when prettier is set
// up. Adds the file it wrote to `files`. Returns the note to print when there is no formatter or the biome config is
// one init cannot edit.
function ignoreInFormatter(cwd: string, biome: BiomeConfig | undefined, files: string[]): string | undefined {
  if (biome === undefined) {
    if (!usesPrettier(cwd)) {
      return NO_FORMATTER
    }
    const folder = append(cwd, '.prettierignore', 'kalup/\n', PRETTIERIGNORE_KALUP)
    const config = append(cwd, '.prettierignore', `${CONFIG}\n`, PRETTIERIGNORE_CONFIG)
    if (folder || config) {
      files.push('.prettierignore')
    }
    return undefined
  }
  if (biome.edited === undefined) {
    return `${biome.file} was left alone: init could not read files.includes in it. Add !kalup, !kalup.config.ts and !.kalup to files.includes yourself: the writer keeps those files in its own format.`
  }
  if (biome.edited !== biome.text) {
    writeFileSync(join(cwd, biome.file), biome.edited)
    files.push(biome.file)
  }
  return undefined
}

/**
 * @kalup/core added to dependencies in package.json when no dependency list has it, as the files under kalup/ import it
 * at runtime. The file keeps its indentation, key order and final line break; dependencies are sorted, as npm keeps
 * them. Adds package.json to `files` when it wrote. `next` is the install step to print, when there is one.
 */
function addCore(cwd: string, files: string[]): { data: PackageJsonData; next?: string } {
  const manager = packageManager(cwd)
  const install = `${manager === 'npm' ? 'npm install' : `${manager} add`} ${CORE}`
  const path = join(cwd, 'package.json')
  if (!existsSync(path)) {
    return {
      data: { added: false, found: false, manager },
      next: `No package.json here. The files under kalup/ import ${CORE}: install it in your app with ${install}.`,
    }
  }
  const text = readFileSync(path, 'utf8')
  const pkg = parseJson<unknown>(text)
  if (
    pkg instanceof Error ||
    !isObject(pkg) ||
    !DEPENDENCY_LISTS.every((field) => pkg[field] === undefined || isObject(pkg[field]))
  ) {
    return {
      data: { added: false, found: true, manager },
      next: `package.json was left alone: init could not read its dependencies. Install ${CORE} in your app with ${install}.`,
    }
  }
  if (DEPENDENCY_LISTS.some((field) => isObject(pkg[field]) && Object.hasOwn(pkg[field], CORE))) {
    return { data: { added: false, found: true, manager } }
  }
  const dependencies = { ...(pkg.dependencies as object | undefined), [CORE]: `^${version}` }
  pkg.dependencies = Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b, 'en')))
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const json = JSON.stringify(pkg, null, JSON_INDENT.exec(text)?.[1] ?? '  ').replaceAll('\n', eol)
  writeFileSync(path, `${json}${text.endsWith('\n') ? eol : ''}`)
  files.push('package.json')
  return {
    data: { added: true, found: true, manager },
    next: `Added ${CORE} to dependencies in package.json: run ${manager} install.`,
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// The nearest lockfile names the manager, so a package in a workspace gets the workspace's. Then the nearest
// packageManager field (`pnpm@9.12.0`), which corepack reads, then whatever runs init: npx says npm.
function packageManager(cwd: string): PackageManager {
  const dirs = projectDirs(cwd)
  for (const dir of dirs) {
    const lock = LOCKFILES.find(([file]) => existsSync(join(dir, file)))
    if (lock !== undefined) {
      return lock[1]
    }
  }
  for (const dir of dirs) {
    const pkg = parseJson<unknown>(
      existsSync(join(dir, 'package.json')) ? readFileSync(join(dir, 'package.json'), 'utf8') : '',
    )
    const field = isObject(pkg) && typeof pkg.packageManager === 'string' ? pkg.packageManager.split('@')[0] : undefined
    if (field !== undefined && MANAGERS.includes(field)) {
      return field as PackageManager
    }
  }
  const agent = process.env.npm_config_user_agent?.split('/')[0] ?? ''
  return MANAGERS.includes(agent) ? (agent as PackageManager) : 'npm'
}

// cwd and the directories above it, up to the first with .git or pnpm-workspace.yaml, or the file system root.
function projectDirs(cwd: string): string[] {
  const dirs = [cwd]
  let dir = cwd
  while (!PROJECT_ROOTS.some((name) => existsSync(join(dir, name))) && dirname(dir) !== dir) {
    dir = dirname(dir)
    dirs.push(dir)
  }
  return dirs
}

// AGENTS.md gets the kalup block and CLAUDE.md the pointer to it, each appended or created. Adds each file it wrote to
// `files`.
function writeAgentFiles(cwd: string, files: string[]): void {
  if (append(cwd, 'AGENTS.md', agentsBlock, AGENTS_BLOCK, true)) {
    files.push('AGENTS.md')
  }
  // A CLAUDE.md linked to AGENTS.md holds the block already, and the pointer would make AGENTS.md import itself.
  const claude = join(cwd, 'CLAUDE.md')
  const linked = existsSync(claude) && realpathSync(claude) === realpathSync(join(cwd, 'AGENTS.md'))
  if (!linked && append(cwd, 'CLAUDE.md', `${claudePointer}\n`, CLAUDE_POINTER)) {
    files.push('CLAUDE.md')
  }
}

// Whether a .gitignore ignores .env. As in git, the last line that matches it decides, so a later !.env un-ignores it.
function ignoresEnv(text: string): boolean {
  const last = text
    .split('\n')
    .filter((line) => GITIGNORE_ENV.test(line))
    .at(-1)
  return last !== undefined && !last.startsWith('!')
}

/**
 * Appends `addition` to `file` unless its text already matches `present`, creating the file when it is missing.
 * `blank` puts an empty line between the old text and the addition. Returns whether it wrote.
 */
function append(cwd: string, file: string, addition: string, present: Pick<RegExp, 'test'>, blank = false): boolean {
  const path = join(cwd, file)
  const text = existsSync(path) ? readFileSync(path, 'utf8') : ''
  if (present.test(text)) {
    return false
  }
  const gap = text === '' ? '' : `${text.endsWith('\n') ? '' : '\n'}${blank ? '\n' : ''}`
  writeFileSync(path, `${text}${gap}${addition}`)
  return true
}

// biome.json or biome.jsonc and its text with the ignores added, or nothing when there is neither. Read before anything
// is written, so a biome.json that is not JSON stops init with the directory as it was. biome reads biome.json as
// plain JSON, so a comment there is an error too. A biome.jsonc is read with its comments blanked; one that is still
// not JSON (trailing commas, which biome allows there) is not broken, so init leaves it alone and prints a note.
function readBiome(cwd: string): BiomeConfig | undefined {
  const file = BIOME_FILES.find((name) => existsSync(join(cwd, name)))
  if (file === undefined) {
    return undefined
  }
  const text = readFileSync(join(cwd, file), 'utf8')
  const json = file === 'biome.jsonc' ? blankComments(text) : text
  const config = parseJson<Biome>(json)
  if (config instanceof Error) {
    if (file === 'biome.jsonc') {
      return { file, text }
    }
    throw new KalupError({
      code: 'E_BIOME_CONFIG',
      message: `${file} is not valid JSON: ${config.message}`,
      file,
      fix: `fix the file, then run npx ${bin} init again`,
    })
  }
  return { file, text, edited: biomeIgnore(text, json, config) }
}

// JSON.parse, with the SyntaxError it throws returned instead, so the caller can turn it into an issue.
function parseJson<T>(json: string): T | Error {
  try {
    return JSON.parse(json) as T
  } catch (error) {
    return error as Error
  }
}

// Comments outside strings turned to spaces, line breaks kept, so the text parses and every offset still points into
// the file. Strings are matched first so a // inside one (the $schema URL) stays.
function blankComments(text: string): string {
  return text.replace(/("(?:[^"\\\n]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (comment, string?: string) =>
    string === undefined ? comment.replace(/[^\r\n]/g, ' ') : string,
  )
}

// `!kalup` and `!kalup.config.ts` added to biome's files.includes as a text edit, so the file keeps its comments and its
// format and still passes its own biome check. An entry is left out when the list already ignores its path. A missing
// includes means every file, which `**` spells out. `json` is `text` with its comments blanked. Undefined when files
// is not an object or files.includes not a list.
function biomeIgnore(text: string, json: string, config: Biome): string | undefined {
  const includes = config.files?.includes
  const listed = Array.isArray(includes) ? includes : []
  const missing = BIOME_IGNORES.filter(([, present]) => !present.some((entry) => listed.includes(entry))).map(
    ([entry]) => `"${entry}"`,
  )
  if (missing.length === 0) {
    return text
  }
  if (includes !== undefined) {
    return insert(text, json, ['files', 'includes'], '[', missing)
  }
  const list = `["**", ${missing.join(', ')}]`
  if (config.files === undefined) {
    return insert(text, json, [], '{', [`"files": { "includes": ${list} }`])
  }
  return insert(text, json, ['files'], '{', [`"includes": ${list}`])
}

// `items` added last to the object or array at `path`, which opens with `bracket`. When the entries there are on lines
// of their own, each item gets its own line, after any comment that ends the last entry's line. Undefined when there
// is no such object or array.
function insert(text: string, json: string, path: string[], bracket: '{' | '[', items: string[]): string | undefined {
  const at = container(json, path)
  if (at === undefined || json[at.open] !== bracket) {
    return undefined
  }
  const inside = json.slice(at.open + 1, at.close)
  if (inside.trim() === '') {
    const pad = bracket === '{' ? ' ' : ''
    return `${text.slice(0, at.open + 1)}${pad}${items.join(', ')}${pad}${text.slice(at.open + 1)}`
  }
  const end = at.open + 1 + inside.trimEnd().length
  const indent = LINE_INDENT.exec(inside.slice(0, inside.length - inside.trimStart().length))?.[0]
  const eol = indent === undefined ? -1 : json.slice(end, at.close).search(LINE_BREAK)
  const after = eol === -1 ? end : end + eol
  const gap = indent ?? ' '
  return `${text.slice(0, end)},${text.slice(end, after)}${gap}${items.join(`,${gap}`)}${text.slice(after)}`
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
      if (colon !== undefined) {
        key = JSON.parse(string) as string
      }
      continue
    }
    if (token === '{' || token === '[') {
      const parent = open.at(-1)
      open.push({ path: parent === undefined ? [] : [...parent.path, key], at: match.index })
    } else {
      const done = open.pop()
      if (done !== undefined && JSON.stringify(done.path) === want) {
        return { open: done.at, close: match.index }
      }
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
