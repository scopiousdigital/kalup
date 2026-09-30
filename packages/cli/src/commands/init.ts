// kalup init: write kalup.config.ts, the folder of object files with its barrel, the ignore entries and the agent
// files. It never needs a key and never calls HubSpot: `kalup pull` reads the portal. In a monorepo it edits the
// .gitignore and the formatter config it finds between the project and the repository root, with paths relative to
// them, instead of adding new ones in the project folder. A local file init cannot read stops it before it writes.
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import type { Target } from '@kalup/core'
import {
  bin,
  type ConfigFile,
  DEFAULT_DIR,
  IssueError,
  KalupError,
  type Layout,
  layout,
  limitScope,
  normalDir,
  read,
  readScope,
  registry,
  STANDARD_OBJECTS,
  sanitize,
  write,
  writeScope,
} from '@kalup/engine'
import { defaultKeyVariable, resolveReadKey } from '../lib/auth.js'
import { verdict } from '../lib/ignore.js'
import { repoDirs } from '../lib/repo.js'
import { agentsBlock, claudePointer } from '../lib/templates/agents.js'
import { version } from '../version.js'
import { type Context, type Result, usageError } from './context.js'

export interface ScopeLine {
  neededFor: string[]
  scope: string
}

export interface InitData {
  /** The files init wrote or changed, relative to the directory it ran in: in a monorepo, some are above it. */
  files: string[]
  /** The variable the target's read key is read from. Never its value. */
  keyVariable: string
  /** What is left to do, in order, the last step always the first pull. */
  next: string[]
  objects: string[]
  packageJson: PackageJsonData
  /** The Hub ID `--portal` gave. Absent for a pending target, which has no portalId until someone sets it. */
  portalId?: number
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
  /** The config file, relative to the directory init runs in. */
  file: string
  /** The directory it is in, absolute. */
  in: string
  text: string
}

const CONFIG = 'kalup.config.ts'
/** biome.json wins over biome.jsonc when both exist, as in biome. */
const BIOME_FILES = ['biome.json', 'biome.jsonc']
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
/**
 * The target name without --target. init cannot see the account type offline, and a name never decides protection,
 * so it errs towards care: a sandbox named production is harmless, the other way round is not.
 */
const DEFAULT_TARGET = 'production'
const SERVICE_KEYS =
  'Development > Keys > Service keys, see https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/account-service-keys'
const HUB_ID = /^[1-9]\d*$/
const AGENTS_BLOCK = /<!-- kalup:start/
const CLAUDE_POINTER = /@AGENTS\.md/
const LINE_INDENT = /\r?\n[ \t]*$/
const LINE_BREAK = /\r?\n/
const JSON_INDENT = /^([ \t]+)"/m
/** A line of the barrel: `export {}`, or a re-export of one object file's exports. */
const BARREL_LINE = /^export (?:\{\}|(?:type )?\{ [\w, ]+ \} from '\.\/[\w./-]+')$/

export function init(ctx: Context): Result<InitData> {
  const { cwd, flags } = ctx
  const portalId = parsePortal(flags.portal)
  const objects = parseObjects(flags.objects)
  const { dir, at } = parseDir(flags.dir)
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
  checkDir(cwd, at)
  const dirs = repoDirs(cwd)
  const biome = readBiome(cwd, dirs, at)

  const target = flags.target ?? DEFAULT_TARGET
  const keyVariable = defaultKeyVariable
  // No portalId: a pending target, which validate accepts with W_PENDING_TARGET until someone sets it.
  const targetConfig: Target = {
    ...(portalId === undefined ? {} : { portalId }),
    credentials: { read: { env: keyVariable } },
  }
  const config: ConfigFile = {
    imports: [],
    dir,
    objects: Object.fromEntries(objects.map((object) => [object, {}])),
    targets: { [target]: targetConfig },
  }

  const files: string[] = []
  writeFileSync(join(cwd, CONFIG), write('config', config))
  files.push(CONFIG)
  // The barrel, so `./hubspot` imports from the first minute. The first pull fills it. One a previous init or pull
  // wrote is kept.
  if (!existsSync(join(cwd, at.barrel))) {
    mkdirSync(join(cwd, at.dir), { recursive: true })
    writeFileSync(join(cwd, at.barrel), write('barrel', []))
    files.push(at.barrel)
  }
  ignoreInGit(cwd, dirs, files)
  const note = ignoreInFormatter(cwd, dirs, at, biome, files)
  writeAgentFiles(cwd, at, files)
  const core = addCore(cwd, at, files)

  const scopes = scopeLines(objects, 'read')
  const writeScopes = scopeLines(objects, 'write')
  const recommended = { scope: limitScope(objects), neededFor: ['the property limit check in plan'] }
  const next = [
    ...(portalId === undefined
      ? [`Set targets.${target}.portalId in ${CONFIG} to the Hub ID from the HubSpot account menu.`]
      : []),
    ...(hasKey(cwd) ? [] : [`Put the key in .env as ${keyVariable}=<key>, or export it in the shell.`]),
    ...(core.next === undefined ? [] : [core.next]),
    `Run npx ${bin} pull to write the object files from the portal.`,
  ]
  const data: InitData = {
    target,
    ...(portalId === undefined ? {} : { portalId }),
    keyVariable,
    objects,
    scopes,
    recommended,
    writeScopes,
    files,
    packageJson: core.data,
    next,
  }
  const lines = [
    portalId === undefined
      ? `Target ${target}: pending, no portal ID yet: ${objects.join(', ')}`
      : `Target ${target}, portal ${portalId}: ${objects.join(', ')}`,
    // The name is only a name: it gives the target no role.
    ...(flags.target === undefined
      ? [`Named the target ${target}. Rename it in ${CONFIG}, or pass --target <name>, if you want another name.`]
      : []),
    ...files.map((file) => `wrote ${file}`),
    ...(note === undefined ? [] : [note]),
    `Read scopes the key in ${keyVariable} needs (${SERVICE_KEYS}):`,
    ...scopes.map((s) => `  ${s.scope} (${s.neededFor.join(', ')})`),
    `  ${recommended.scope} (recommended, for the property limit check in plan; ${bin} reads no records)`,
    'For apply, the write key needs the read scopes and:',
    ...writeScopes.map((s) => `  ${s.scope} (${s.neededFor.join(', ')})`),
    'Next:',
    ...next.map((step) => `  ${step}`),
  ]
  return { data, text: `${lines.join('\n')}\n` }
}

// The Hub ID --portal gives, or undefined without the flag: a pending target.
function parsePortal(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!HUB_ID.test(value)) {
    throw usageError(`--portal needs the Hub ID, a positive integer, not '${sanitize(value)}'`)
  }
  return Number(value)
}

// Whether the key's variable is set, in the environment or .env. The key itself is never kept or shown.
function hasKey(cwd: string): boolean {
  try {
    resolveReadKey({}, cwd)
    return true
  } catch (error) {
    if (error instanceof KalupError) {
      return false
    }
    throw error
  }
}

/**
 * E_DIR_IN_USE when the folder of object files is a file, or holds a .ts file that is not Kalup's: a barrel as pull
 * writes it, or a file the grammar reader reads. Every command reads each .ts file there as an object file, pull
 * rewrites index.ts, and the formatter ignore init adds would take the app's own files out of its checks. Kalup files
 * from an earlier init are fine: init runs again after kalup.config.ts is removed.
 */
function checkDir(cwd: string, at: Layout): void {
  const folder = join(cwd, at.dir)
  const stat = statSync(folder, { throwIfNoEntry: false })
  if (stat === undefined) {
    return
  }
  const foreign = stat.isDirectory()
    ? readdirSync(folder, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
        .map((entry) => slashed(cwd, join(entry.parentPath, entry.name)))
        .sort()
        .find((file) => !kalupFile(file, readFileSync(join(cwd, file), 'utf8'), at))
    : at.dir
  if (foreign === undefined) {
    return
  }
  throw new KalupError({
    code: 'E_DIR_IN_USE',
    message: `${foreign} is not a ${bin} file, and ${at.dir}/ must hold ${bin}'s files only. Nothing was written.`,
    file: foreign,
    fix: `pass --dir with a folder of its own, such as ${at.dir === DEFAULT_DIR ? 'lib/config/hubspot' : `${at.dir}/hubspot`}`,
  })
}

// A barrel as pull and fmt write it, or a file the grammar reader reads: an object file or removed.ts.
function kalupFile(file: string, text: string, at: Layout): boolean {
  if (file === at.barrel) {
    return text.split('\n').every((line) => line === '' || BARREL_LINE.test(line))
  }
  try {
    return read(text, file).kind !== 'config'
  } catch (error) {
    if (error instanceof IssueError) {
      return false
    }
    throw error
  }
}

// The folder --dir names, normalized, as kalup.config.ts records it (none without the flag), and its layout.
function parseDir(value: string | undefined): { at: Layout; dir?: string } {
  if (value === undefined) {
    return { at: layout(DEFAULT_DIR) }
  }
  const dir = normalDir(value)
  if (dir === undefined) {
    throw usageError(`--dir needs a folder inside the project, such as lib/config/hubspot, not '${sanitize(value)}'`)
  }
  return { dir, at: layout(dir) }
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

// A path from `from` to `to` with forward slashes, as ignore files and the file list write it. '' for the same place.
function slashed(from: string, to: string): string {
  return relative(from, to).split(sep).join('/')
}

// The path in front of a project path in an ignore file in `dir`: '' in the project itself, else `apps/crm/`.
function prefixFrom(dir: string, cwd: string): string {
  const rel = slashed(dir, cwd)
  return rel === '' ? '' : `${rel}/`
}

/**
 * .kalup/ and .env ignored in git. The .gitignore files from the repository root down to the project are read as git
 * reads them, a deeper file's verdict winning; what none of them ignores yet is appended to the nearest one, with the
 * path from it (`/apps/crm/.env`). With no .gitignore at all, one is created in the project, also ignoring node_modules
 * (the project was just set up with npm install). .env is where the key goes, whether or not it exists yet.
 */
function ignoreInGit(cwd: string, dirs: string[], files: string[]): void {
  const found = dirs.filter((dir) => existsSync(join(dir, '.gitignore')))
  const nearest = found[0] ?? cwd
  const path = join(nearest, '.gitignore')
  if (found.length === 0) {
    writeFileSync(path, 'node_modules/\n')
  }
  const covered = (name: string, folder: boolean): boolean => {
    let ignored = false
    for (const dir of [...found].reverse()) {
      const text = readFileSync(join(dir, '.gitignore'), 'utf8')
      ignored = verdict(text, `${prefixFrom(dir, cwd)}${name}`, folder) ?? ignored
    }
    return ignored
  }
  const anchor = nearest === cwd ? '' : `/${prefixFrom(nearest, cwd)}`
  const kalup = !covered('.kalup', true) && append(path, `${anchor}.kalup/\n`)
  const env = !covered('.env', false) && append(path, `${anchor}.env\n`)
  if (found.length === 0 || kalup || env) {
    files.push(slashed(cwd, path))
  }
}

// The folder of object files, kalup.config.ts and .kalup/ ignored in the nearest biome config when there is one, else
// in the .prettierignore of the nearest directory with a prettier config, each path from that directory. Adds the
// file it wrote to `files`. Returns the note to print when there is no formatter or the biome config is one init
// cannot edit.
function ignoreInFormatter(
  cwd: string,
  dirs: string[],
  at: Layout,
  biome: BiomeConfig | undefined,
  files: string[],
): string | undefined {
  if (biome === undefined) {
    const prettier = dirs.find(usesPrettier)
    if (prettier === undefined) {
      return `No biome.json or prettier config found. If you add a formatter, ignore ${at.dir}/ and ${CONFIG} in it: the writer keeps those files in its own format.`
    }
    const prefix = prefixFrom(prettier, cwd)
    const path = join(prettier, '.prettierignore')
    const text = () => (existsSync(path) ? readFileSync(path, 'utf8') : '')
    const folder = !(verdict(text(), `${prefix}${at.barrel}`) ?? false) && append(path, `${prefix}${at.dir}/\n`)
    const config = !(verdict(text(), `${prefix}${CONFIG}`) ?? false) && append(path, `${prefix}${CONFIG}\n`)
    if (folder || config) {
      files.push(slashed(cwd, path))
    }
    return undefined
  }
  const prefix = prefixFrom(biome.in, cwd)
  if (biome.edited === undefined) {
    const entries = [at.dir, CONFIG, '.kalup'].map((name) => `!${prefix}${name}`)
    const listed = `${entries.slice(0, -1).join(', ')} and ${entries.at(-1)}`
    return `${biome.file} was left alone: init could not read files.includes in it. Add ${listed} to files.includes yourself: the writer keeps those files in its own format.`
  }
  if (biome.edited !== biome.text) {
    writeFileSync(join(cwd, biome.file), biome.edited)
    files.push(biome.file)
  }
  return undefined
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

/**
 * @kalup/core added to dependencies in package.json when no dependency list has it, as the object files import it
 * at runtime. The file keeps its indentation, key order and final line break; dependencies are sorted, as npm keeps
 * them. Adds package.json to `files` when it wrote. `next` is the install step to print, when there is one.
 */
function addCore(cwd: string, at: Layout, files: string[]): { data: PackageJsonData; next?: string } {
  const manager = packageManager(cwd)
  const install = `${manager === 'npm' ? 'npm install' : `${manager} add`} ${CORE}`
  const path = join(cwd, 'package.json')
  if (!existsSync(path)) {
    return {
      data: { added: false, found: false, manager },
      next: `No package.json here. The files under ${at.dir}/ import ${CORE}: install it in your app with ${install}.`,
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
function writeAgentFiles(cwd: string, at: Layout, files: string[]): void {
  if (append(join(cwd, 'AGENTS.md'), agentsBlock(at.dir), AGENTS_BLOCK, true)) {
    files.push('AGENTS.md')
  }
  // A CLAUDE.md linked to AGENTS.md holds the block already, and the pointer would make AGENTS.md import itself.
  const claude = join(cwd, 'CLAUDE.md')
  const linked = existsSync(claude) && realpathSync(claude) === realpathSync(join(cwd, 'AGENTS.md'))
  if (!linked && append(join(cwd, 'CLAUDE.md'), `${claudePointer}\n`, CLAUDE_POINTER)) {
    files.push('CLAUDE.md')
  }
}

/**
 * Appends `addition` to the file at `path` unless `present` matches its text, creating the file when it is missing.
 * `blank` puts an empty line between the old text and the addition. Returns whether it wrote.
 */
function append(path: string, addition: string, present?: RegExp, blank = false): boolean {
  const text = existsSync(path) ? readFileSync(path, 'utf8') : ''
  if (present?.test(text)) {
    return false
  }
  const gap = text === '' ? '' : `${text.endsWith('\n') ? '' : '\n'}${blank ? '\n' : ''}`
  writeFileSync(path, `${text}${gap}${addition}`)
  return true
}

// The nearest biome.json or biome.jsonc from the project up to the repository root, and its text with the ignores
// added, or nothing when there is none. Read before anything is written, so a biome.json that is not JSON stops init
// with the directory as it was. biome reads biome.json as plain JSON, so a comment there is an error too. A
// biome.jsonc is read with its comments blanked; one that is still not JSON (trailing commas, which biome allows
// there) is not broken, so init leaves it alone and prints a note.
function readBiome(cwd: string, dirs: string[], at: Layout): BiomeConfig | undefined {
  for (const dir of dirs) {
    const name = BIOME_FILES.find((candidate) => existsSync(join(dir, candidate)))
    if (name !== undefined) {
      return biomeConfig(cwd, dir, name, at)
    }
  }
  return undefined
}

function biomeConfig(cwd: string, dir: string, name: string, at: Layout): BiomeConfig {
  const file = slashed(cwd, join(dir, name))
  const text = readFileSync(join(dir, name), 'utf8')
  const json = name === 'biome.jsonc' ? blankComments(text) : text
  const config = parseJson<Biome>(json)
  if (config instanceof Error) {
    if (name === 'biome.jsonc') {
      return { file, in: dir, text }
    }
    throw new KalupError({
      code: 'E_BIOME_CONFIG',
      message: `${file} is not valid JSON: ${config.message}`,
      file,
      fix: `fix the file, then run npx ${bin} init again`,
    })
  }
  return { file, in: dir, text, edited: biomeIgnore(text, json, config, at, prefixFrom(dir, cwd)) }
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

// `!<dir>`, `!kalup.config.ts` and `!.kalup` added to biome's files.includes as a text edit, so the file keeps its
// comments and its format and still passes its own biome check; in a monorepo each path starts with `prefix`, the path
// from the config to the project. An entry is left out when the list already ignores its path. A missing includes
// means every file, which `**` spells out. `json` is `text` with its comments blanked. Undefined when files is not an
// object or files.includes not a list.
function biomeIgnore(text: string, json: string, config: Biome, at: Layout, prefix: string): string | undefined {
  const includes = config.files?.includes
  const listed = Array.isArray(includes) ? includes : []
  const missing = biomeIgnores(at, prefix)
    .filter(([, present]) => !present.some((entry) => listed.includes(entry)))
    .map(([entry]) => `"${entry}"`)
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

// What init adds to biome's files.includes, each with the entries that already ignore the same path: the files the
// writer formats, and .kalup, where state is written in its own format from the first pull on.
function biomeIgnores(at: Layout, prefix: string): [entry: string, present: string[]][] {
  const path = (name: string): [string, string[]] => [
    `!${prefix}${name}`,
    [`!${prefix}${name}`, `!${prefix}${name}/**`, `!!${prefix}${name}`, `!!${prefix}${name}/**`],
  ]
  const config = `${prefix}${CONFIG}`
  return [path(at.dir), [`!${config}`, [`!${config}`, `!!${config}`]], path('.kalup')]
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
