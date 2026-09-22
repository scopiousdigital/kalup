// kalup init: check the key against --portal, write the project files, then run the first pull. Nothing is written
// before the portal answers, and a local file init cannot read stops it before the first request.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type ConfigFile, type Target, write } from '@kalup/core'
import {
  createHttp,
  guardPortal,
  type Issue,
  KalupError,
  type PortalInfo,
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

const CONFIG = 'kalup.config.ts'
const BARREL = 'kalup/index.ts'
const DEFAULT_OBJECTS = ['contacts', 'companies', 'deals']
/** Above this many properties written for one object by the first pull, init warns and points at `include`. */
const LARGE_SCOPE = 200
const SERVICE_KEYS =
  'Development > Keys > Service keys, see https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/account-service-keys'
const NO_FORMATTER =
  'No biome.json or prettier config found. If you add a formatter, ignore kalup/ in it: the writer keeps those files in its own format.'

/**
 * Standard objects whose properties read under a scope other than `crm.schemas.<object>.read`. From the scope list on
 * HubSpot's 2026-09 properties reference; communications and postal mail from their own API guides.
 */
const SCOPE_EXCEPTIONS = new Map([
  ['commerce_payments', 'crm.schemas.commercepayments.read'],
  ['communications', 'crm.objects.contacts.read'],
  ['feedback_submissions', 'crm.objects.feedback_submissions.read'],
  ['goals', 'crm.objects.goals.read'],
  ['leads', 'crm.objects.leads.read'],
  ['marketing_events', 'crm.objects.marketing_events.read'],
  ['postal_mail', 'crm.objects.contacts.read'],
  ['products', 'e-commerce'],
  ['users', 'crm.objects.users.read'],
])

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
  if (biome) {
    if (biomeIgnore(cwd, biome)) files.push('biome.json')
  } else if (usesPrettier(cwd)) {
    if (append(cwd, '.prettierignore', 'kalup/\n', /^\s*\/?kalup(\/(\*\*)?)?\s*$/m)) files.push('.prettierignore')
  } else {
    note = NO_FORMATTER
  }
  if (append(cwd, 'AGENTS.md', agentsBlock, /<!-- kalup:start/, true)) files.push('AGENTS.md')
  if (existsSync(join(cwd, 'CLAUDE.md')) && append(cwd, 'CLAUDE.md', `${claudePointer}\n`, /@AGENTS\.md/)) {
    files.push('CLAUDE.md')
  }

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

/** The read scope a standard object's properties need: the registry template, or HubSpot's exception to it. */
export function readScope(object: string): string {
  return SCOPE_EXCEPTIONS.get(object) ?? registry.property.scopes.read[0].replace('{object}', object)
}

// One scope per standard object, and the custom scope once for every custom object, as status probes them.
function scopeLines(objects: string[]): ScopeLine[] {
  const out = new Map<string, string[]>()
  for (const object of objects) {
    const scope = STANDARD_OBJECTS.has(object) ? readScope(object) : registry.object.scopes.read[0]
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

// biome.json parsed, or nothing when there is none. Read before anything is written, so a broken file stops init
// with the directory as it was.
function readBiome(cwd: string): Biome | undefined {
  const path = join(cwd, 'biome.json')
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Biome
  } catch (error) {
    throw new KalupError({
      code: 'E_BIOME_CONFIG',
      message: `biome.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      file: 'biome.json',
      fix: `fix the file, then run npx ${bin} init again`,
    })
  }
}

// `!kalup/**` in biome's files.includes, so the writer's format is the only format. A missing includes means every
// file, which `**` spells out. Returns whether it wrote.
function biomeIgnore(cwd: string, json: Biome): boolean {
  const includes = json.files?.includes ?? ['**']
  if (includes.includes('!kalup/**')) return false
  json.files = { ...json.files, includes: [...includes, '!kalup/**'] }
  writeFileSync(join(cwd, 'biome.json'), `${JSON.stringify(json, null, 2)}\n`)
  return true
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
