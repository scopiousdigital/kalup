// The apply scenarios' own harness: an invented beekeeping portal in the stateful simulator, projects
// written from text, and the built host through cli(). The evidence each scenario asserts is the simulator's request
// log and the bytes of the state file. Nothing here reuses the implementers' apply test helpers.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import type { ApplyData } from '@kalup/engine'
import { type Plan, registry, stableStringify, type TargetState, writesHash } from '@kalup/engine'
import { vi } from 'vitest'
import {
  createPortalSim,
  type PortalSim,
  type SimPortalInput,
  type SimProperty,
  type SimRequest,
} from '../../../engine/test/support/portal-sim.js'
import { cli, host, parseEnvelope, type Where } from '../../src/commands/testing.js'

export const portalId = 7_700_001
export const readKey = 'kestrel-read-key-51c3'
export const writeKey = 'kestrel-write-key-a06e'
export const companies = '/crm/properties/2026-09/companies'
export const groups = `${companies}/groups`
export const guardPath = '/account-info/2026-09/details'
export const apiary = 'group:companies/apiary'
export const hiveCount = 'property:companies/hive_count'
export const honeyGrade = 'property:companies/honey_grade'
export const objectsFile = 'kalup/objects/companies.ts'
export const configFile = 'kalup.config.ts'

export const APIARY = "    apiary: { label: 'Apiary' },\n"

export const HIVE_COUNT = `    hiveCount: p.number('hive_count', {
      label: 'Hive count',
      group: 'apiary',
      fieldType: 'number',
    }),
`

export const HONEY_GRADE = `    honeyGrade: p.enum('honey_grade', {
      label: 'Honey grade',
      group: 'apiary',
      fieldType: 'select',
      options: [
        { value: 'light', label: 'Light' },
        { value: 'amber', label: 'Amber' },
      ],
    }),
`

export interface TargetSpec {
  adopt?: 'hold' | 'overwrite'
  allowDestroy?: boolean
  drift?: 'hold' | 'overwrite'
  mode?: 'addon' | 'takeover'
  name?: string
  /** targets.<target>.objects as written, such as `{ companies: { mode: 'addon' } }`. */
  objects?: string
  protected?: boolean
  /** The variable of a separate write key. */
  write?: string
  yesLimit?: number
}

/** The settings above the targets: the top-level mode and the companies entry under objects. */
export interface ConfigSpec {
  /** The companies entry under objects as written; `{}` by default. */
  companies?: string
  mode?: 'addon' | 'takeover'
}

export interface ProjectSpec {
  config?: ConfigSpec
  /** Where to write it; a new temporary directory by default. */
  dir?: string
  groups?: string
  properties?: string
  target?: TargetSpec
}

/** A fresh environment per test: its own lock directory, the read key, no state directory override, no CI. */
export function environment(): { locks: string } {
  const locks = mkdtempSync(join(tmpdir(), 'kestrel-locks-'))
  vi.stubEnv('KALUP_LOCK_DIR', locks)
  vi.stubEnv('KALUP_STATE_DIR', undefined)
  vi.stubEnv('KESTREL_READ_KEY', readKey)
  vi.stubEnv('KESTREL_WRITE_KEY', undefined)
  vi.stubEnv('CI', undefined)
  return { locks }
}

/** One target entry of kalup.config.ts. */
function targetText(spec: TargetSpec = {}): string {
  const credentials =
    spec.write === undefined
      ? "{ read: { env: 'KESTREL_READ_KEY' } }"
      : `{ read: { env: 'KESTREL_READ_KEY' }, write: { env: '${spec.write}' } }`
  const fields = [
    `    ${spec.name ?? 'sandbox'}: {`,
    `      portalId: ${portalId},`,
    ...(spec.mode === undefined ? [] : [`      mode: '${spec.mode}',`]),
    ...(spec.protected === undefined ? [] : [`      protected: ${spec.protected},`]),
    ...(spec.drift === undefined ? [] : [`      drift: '${spec.drift}',`]),
    ...(spec.adopt === undefined ? [] : [`      adopt: '${spec.adopt}',`]),
    ...(spec.allowDestroy === undefined ? [] : [`      allowDestroy: ${spec.allowDestroy},`]),
    ...(spec.yesLimit === undefined ? [] : [`      yesLimit: ${spec.yesLimit},`]),
    `      credentials: ${credentials},`,
    ...(spec.objects === undefined ? [] : [`      objects: ${spec.objects},`]),
    '    },',
  ]
  return `${fields.join('\n')}\n`
}

/** Writes kalup.config.ts with one target. */
export function writeConfig(dir: string, target: TargetSpec = {}, settings: ConfigSpec = {}): void {
  const text = [
    "import { defineConfig } from '@kalup/core'",
    '',
    'export default defineConfig({',
    "  name: 'kestrel-apiaries',",
    ...(settings.mode === undefined ? [] : [`  mode: '${settings.mode}',`]),
    '  objects: {',
    `    companies: ${settings.companies ?? '{}'},`,
    '  },',
    '  targets: {',
    `${targetText(target)}  },`,
    '})',
    '',
  ]
  writeFileSync(join(dir, configFile), text.join('\n'))
}

/** Writes the companies object file with these group and property entries. */
export function writeObjects(dir: string, groupEntries: string, propertyEntries: string): void {
  const text = [
    '// Kestrel Apiaries: the company group and properties the scenarios write.',
    '',
    "import { defineObject, type InferProperties, p } from '@kalup/core'",
    '',
    "export const Company = defineObject('companies', {",
    '  groups: {',
    `${groupEntries}  },`,
    '  properties: {',
    `${propertyEntries}  },`,
    '})',
    '',
    'export type CompanyData = InferProperties<typeof Company.properties> & { id: string }',
    '',
  ]
  writeFileSync(join(dir, objectsFile), text.join('\n'))
}

/** A throwaway project: the apiary group and hive_count unless the spec says otherwise, on target sandbox. */
export function project(spec: ProjectSpec = {}): string {
  const dir = spec.dir ?? mkdtempSync(join(tmpdir(), 'kestrel-'))
  mkdirSync(join(dir, 'kalup', 'objects'), { recursive: true })
  writeConfig(dir, spec.target, spec.config)
  writeObjects(dir, spec.groups ?? APIARY, spec.properties ?? HIVE_COUNT)
  writeFileSync(
    join(dir, 'kalup', 'index.ts'),
    "export type { CompanyData } from './objects/companies.js'\nexport { Company } from './objects/companies.js'\n",
  )
  return dir
}

/** Replaces `from` in a project file, which must contain it. */
export function edit(dir: string, file: string, from: string, to: string): void {
  const text = readFileSync(join(dir, file), 'utf8')
  if (!text.includes(from)) {
    throw new Error(`${file} has no ${from}`)
  }
  writeFileSync(join(dir, file), text.replace(from, to))
}

/** Writes kalup/removed.ts with these tombstones. */
export function tombstones(dir: string, actions: Record<string, 'destroy' | 'release'>): void {
  const entries = Object.entries(actions).map(([address, action]) => `  '${address}': { action: '${action}' },`)
  writeFileSync(
    join(dir, 'kalup', 'removed.ts'),
    `import { defineRemoved } from '@kalup/core'\n\nexport default defineRemoved({\n${entries.join('\n')}\n})\n`,
  )
}

/** HubSpot's own companies group and name property: what every portal starts with. */
function hubspotDefaults(): NonNullable<SimPortalInput['objects']> {
  return {
    companies: {
      groups: [{ name: 'companyinformation', label: 'Company information' }],
      properties: [
        {
          name: 'name',
          label: 'Company name',
          type: 'string',
          fieldType: 'text',
          groupName: 'companyinformation',
          hubspotDefined: true,
        },
      ],
    },
  }
}

/** The Kestrel sandbox portal in a simulator that serves global fetch. `extra.objects` replaces HubSpot's defaults. */
export function portal(extra: Partial<SimPortalInput> = {}): PortalSim {
  const sim = createPortalSim([
    {
      portalId,
      keys: { KESTREL_READ_KEY: readKey, KESTREL_WRITE_KEY: writeKey },
      objects: hubspotDefaults(),
      ...extra,
    },
  ])
  vi.stubGlobal('fetch', sim.fetch)
  return sim
}

/** A property as HubSpot holds it once created, on companies. */
export function liveProperty(input: Partial<SimProperty> & Pick<SimProperty, 'name'>): SimProperty {
  return {
    label: input.name,
    description: '',
    options: [],
    displayOrder: -1,
    hasUniqueValue: false,
    hidden: false,
    formField: false,
    calculated: false,
    externalOptions: false,
    hubspotDefined: false,
    dataSensitivity: 'non_sensitive',
    archived: false,
    createdAt: '2026-09-01T08:00:00.000Z',
    updatedAt: '2026-09-01T08:00:00.000Z',
    type: 'number',
    fieldType: 'number',
    groupName: 'apiary',
    modificationMetadata: { archivable: true, readOnlyDefinition: false, readOnlyValue: false },
    ...input,
  }
}

/** One live property of companies, which must exist. */
export function live(sim: PortalSim, name: string): SimProperty {
  const found = sim.object(portalId, 'companies').properties.get(name)
  if (!found) {
    throw new Error(`the portal holds no property ${name}`)
  }
  return found
}

/** Runs `hook` before each request reaches the simulator: what happens in HubSpot at that moment. */
export function intercept(sim: PortalSim, hook: (method: string, path: string) => void | Promise<void>): void {
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    await hook((init?.method ?? 'GET').toUpperCase(), new URL(String(input)).pathname)
    return sim.fetch(input, init)
  })
}

/** The project's state file: under KALUP_STATE_DIR when the test set it, else under .kalup/state. */
export function statePath(dir: string): string {
  const shared = process.env.KALUP_STATE_DIR
  return join(shared ? resolve(dir, shared) : join(dir, '.kalup', 'state'), `portal-${portalId}.json`)
}

/** The state file's bytes, or null when there is none. */
export function stateBytes(dir: string): string | null {
  const path = statePath(dir)
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

export function stateOf(dir: string): TargetState {
  return JSON.parse(readFileSync(statePath(dir), 'utf8')) as TargetState
}

/** `<METHOD> <path>` of every request from `from` on. */
export function lines(sim: PortalSim, from = 0): string[] {
  return sim.log.slice(from).map((r) => `${r.method} ${r.path}`)
}

/** The writes from `from` on, as `<METHOD> <path>`. */
export function writesOf(sim: PortalSim, from = 0): string[] {
  return sim.log
    .slice(from)
    .filter((r) => r.method !== 'GET')
    .map((r) => `${r.method} ${r.path}`)
}

// Every read-tagged registry path as a method and a pattern over the path.
const readPaths = Object.values(registry).flatMap((row) =>
  Object.values(row.paths)
    .filter((endpoint) => endpoint.tag === 'read')
    .map((endpoint) => ({
      method: endpoint.method as string,
      pattern: new RegExp(`^${endpoint.path.replace(/\{\w+\}/g, '[^/]+')}$`),
    })),
)

/** The requests that match no read-tagged registry path: empty for a run that only read. */
export function notRead(requests: SimRequest[]): string[] {
  return requests
    .filter((r) => !readPaths.some((read) => read.method === r.method && read.pattern.test(r.path)))
    .map((r) => `${r.method} ${r.path}`)
}

/** `kalup plan --out plan.json --json` with any flags; throws unless it exits 0. */
export async function savePlan(dir: string, ...flags: string[]): Promise<Plan> {
  const out = await cli(dir, 'plan', '--out', 'plan.json', '--json', ...flags)
  if (out.exitCode !== 0) {
    throw new Error(`the plan failed: ${out.stdout}`)
  }
  return parseEnvelope<Plan>(out.stdout).data as Plan
}

/** `kalup plan --json`, not saved. */
export async function planOf(dir: string, ...flags: string[]): Promise<Plan> {
  const out = await cli(dir, 'plan', '--json', ...flags)
  if (out.exitCode !== 0) {
    throw new Error(`the plan failed: ${out.stdout}`)
  }
  return parseEnvelope<Plan>(out.stdout).data as Plan
}

/** The steps that have an effect: every one that is not blocked and is not an update with nothing to record. */
export function effects(plan: Plan): Plan['steps'] {
  return plan.steps.filter(
    (s) =>
      s.risk !== 'blocked' &&
      s.risk !== 'manual' &&
      !(s.action === 'update' && (s.changes ?? []).length === 0 && (s.baseUnits ?? []).length === 0),
  )
}

/**
 * Plans again after a successful apply and throws unless the plan is empty, as Terraform checks: nothing blocked,
 * manual or held, nothing missing or orphaned, and every step an update with nothing to change or record.
 */
export async function planIsEmpty(dir: string, ...flags: string[]): Promise<Plan> {
  const plan = await planOf(dir, ...flags)
  const left = leftOver(plan)
  if (left) {
    throw new Error(`the plan after apply is not empty: ${left}`)
  }
  return plan
}

/** What keeps `plan` from being empty, in words, or undefined when it is. */
export function leftOver(plan: Plan): string | undefined {
  const { blocked, manual, held } = plan.counts
  const left = plan.steps
    .filter((s) => !(s.action === 'update' && (s.changes ?? []).length === 0 && (s.baseUnits ?? []).length === 0))
    .map((s) => `${s.id} ${s.action} ${s.address}`)
  if (blocked + manual + held > 0 || plan.missing.length > 0 || plan.orphans.length > 0 || left.length > 0) {
    const counts = JSON.stringify({ blocked, manual, held, missing: plan.missing.length, orphans: plan.orphans.length })
    const kept = plan.steps.flatMap((s) => (s.held ?? []).map((h) => `${s.address}#${h.unit} ${h.class}`))
    return `${counts} ${[...left, ...kept].join(', ')}`
  }
  return undefined
}

/** kalup apply with these arguments; `data` is the envelope's when --json is among them. */
export async function apply(where: string | Where, ...argv: string[]) {
  const out = await cli(where, 'apply', ...argv)
  const env = argv.includes('--json') ? parseEnvelope<ApplyData>(out.stdout) : undefined
  const issues = env?.issues ?? []
  return { ...out, env, data: env?.data, issues, codes: issues.map((i) => i.code) }
}

/** A person at a terminal who types these answers, one per line. */
export function terminal(dir: string, ...answers: string[]): Where {
  return { cwd: dir, interactive: true, stdin: Readable.from([answers.map((a) => `${a}\n`).join('')]) }
}

/** Saves `plan` as plan.json; with `rehash`, a digest and planId recomputed from its content, as a forger would. */
export function writePlan(dir: string, plan: Plan, rehash = false): void {
  const hash = rehash ? writesHash(plan) : plan.writesHash
  const planId = rehash ? `pl_${hash.slice('sha256:'.length, 'sha256:'.length + 12)}` : plan.planId
  writeFileSync(join(dir, 'plan.json'), `${stableStringify({ ...plan, writesHash: hash, planId })}\n`)
}

/** Plans and applies with --yes; throws unless both exit 0. The log is left as it is. */
export async function applyNow(dir: string): Promise<Plan> {
  const plan = await savePlan(dir)
  const out = await apply(dir, 'plan.json', '--yes', '--json')
  if (out.exitCode !== 0) {
    throw new Error(`the apply failed: ${out.stdout}`)
  }
  return plan
}

/** Every journal line of the project's runs, oldest file first. */
export function journalLines(dir: string): Record<string, unknown>[] {
  const folder = join(dirname(statePath(dir)), '..', 'journal', `portal-${portalId}`)
  if (!existsSync(folder)) {
    return []
  }
  return readdirSync(folder)
    .sort()
    .flatMap((file) =>
      readFileSync(join(folder, file), 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
    )
}

/** Runs `run` on fake timers, advancing them while it waits and letting real I/O through between ticks. */
export async function onFakeTime<T>(run: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  const progress = { settled: false }
  const result = run().finally(() => {
    progress.settled = true
  })
  await advance(progress)
  return await result
}

// Half a second of fake time, then real I/O, until the run settles.
async function advance(progress: { settled: boolean }): Promise<void> {
  if (progress.settled) {
    return
  }
  await vi.advanceTimersByTimeAsync(500)
  await new Promise((next) => setImmediate(next))
  await advance(progress)
}

/** A request a spawned kalup sent, as the test process sees it. */
export interface Asked {
  body?: unknown
  method: string
  path: string
}

export interface Hooks {
  /** Called after the simulator answered; 'kill' ends the process with SIGKILL instead of answering it. */
  after?: (asked: Asked, status: number) => 'kill' | undefined | Promise<'kill' | undefined>
  /** Awaited before the request reaches the simulator: a pause holds the process at this request. */
  before?: (asked: Asked) => void | Promise<void>
}

export interface Exited {
  code: number | null
  signal: NodeJS.Signals | null
  stderr: string
  stdout: string
}

const executable = fileURLToPath(new URL('../../dist/index.mjs', import.meta.url))
const preload = new URL('./ipc-fetch.mjs', import.meta.url).href

/**
 * Runs the built executable in a process of its own, in `cwd`, with no terminal and the test's environment. Its fetch
 * goes over the IPC channel to `sim`, through the hooks, so it shares the portal (and the request log) with the runs
 * in this process.
 */
export function spawnKalup(sim: PortalSim, cwd: string, args: string[], hooks: Hooks = {}): Promise<Exited> {
  // Throws unless dist was built from the sources as they are now, as every cli() run checks.
  host()
  const child = spawn(process.execPath, ['--import', preload, executable, ...args], {
    cwd,
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  })
  child.stdin?.end()
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString()
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  child.on(
    'message',
    async (message: { body?: string; headers: Record<string, string>; id: number; method: string; url: string }) => {
      const asked: Asked = {
        method: message.method,
        path: new URL(message.url).pathname,
        ...(message.body === undefined ? {} : { body: JSON.parse(message.body) }),
      }
      await hooks.before?.(asked)
      let answer: Record<string, unknown>
      try {
        const init = {
          method: message.method,
          headers: message.headers,
          ...(message.body === undefined ? {} : { body: message.body }),
        }
        const res = await sim.fetch(message.url, init)
        if ((await hooks.after?.(asked, res.status)) === 'kill') {
          child.kill('SIGKILL')
          return
        }
        const body = res.status === 204 ? null : await res.text()
        answer = { id: message.id, status: res.status, headers: Object.fromEntries(res.headers), body }
      } catch (error) {
        answer = { id: message.id, error: error instanceof Error ? error.message : String(error) }
      }
      if (child.connected) {
        child.send(answer)
      }
    },
  )
  return new Promise((exited) => {
    child.on('close', (code, signal) => exited({ code, signal, stdout, stderr }))
  })
}
