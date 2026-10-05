// The live conformance runner (scripts/conformance/run.mjs), offline: every check run in simulate mode against the
// stateful simulator, the evidence it writes, its refusals before any write, the manifest written before each create
// (the runner's and kalup apply's), a cleanup that archives the manifest's resources and nothing else in a portal full
// of other properties, --cleanup after an interrupted run, and no key in any file it writes. Nothing reaches HubSpot:
// global fetch throws, the runner gets the simulator's fetch, and the CLI it spawns asks the simulator over IPC.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough, Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { createBody, normalizeProperties, optionsPatch, type RawProperty, registry } from '@kalup/engine'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  createPortalSim,
  fault,
  type PortalSim,
  type SimGroupInput,
  type SimPortalInput,
  type SimPropertyInput,
} from '../../../engine/test/support/portal-sim.js'
import { cli, host } from '../../src/commands/testing.js'

interface Command {
  argv: string[]
  cwd: string
}

interface Io {
  env?: Record<string, string | undefined>
  fetch?: PortalSim['fetch']
  person?: (command: Command) => Promise<void>
  sleep?: (ms: number) => Promise<void>
  stderr?: (text: string) => void
  stdin?: NodeJS.ReadableStream
  stdout?: (text: string) => void
}

interface Check {
  assumption: string
  facts: Record<string, unknown>
  gate: string
  id: string
  note?: string
  reason?: string
  requests: { correlationId?: string; method: string; path: string; status: number | null }[]
  status: 'pass' | 'fail' | 'not-applicable'
  title: string
}

interface Evidence {
  accountType: string
  checks: Check[]
  cleanup: { complete: boolean; resources: { address: string; result: string }[] }
  date: string
  format: string
  mode: string
  portal: string
  runId: string
  summary: Record<string, number>
  versions: { api: Record<string, string>; kalup: string | null; node: string }
}

interface Manifest {
  cleanup?: Evidence['cleanup']
  portalId: number
  prefix: string
  resources: { name: string; objectType: string; sentAt?: string; type: 'property' | 'group' }[]
  runId: string
}

type Body = Record<string, unknown>

const scripts = new URL('../../../../scripts/conformance/', import.meta.url)
const runner = (await import(new URL('run.mjs', scripts).href)) as {
  API_PINS: Record<string, string>
  main: (argv: string[], io?: Io) => Promise<number>
}
const simulate = (await import(new URL('simulate.mjs', scripts).href)) as {
  SIMULATED_KEY: string
  SIMULATED_LIMITED_KEY: string
  SIMULATED_OBJECT: string
  simulatedPortal: (portalId: number) => SimPortalInput
}
const client = (await import(new URL('client.mjs', scripts).href)) as {
  refuseWrite: (
    manifest: { data: { prefix: string }; holds: (resource: unknown) => boolean },
    resource: { name: string; objectType: string; type: string },
  ) => string | undefined
}
const checks = (await import(new URL('checks.mjs', scripts).href)) as {
  choiceBody: (name: string, group: string) => Body
  normalizeProperty: (raw: Body) => Body
  optionInputs: (options: RawProperty['options']) => Body[]
  textBody: (name: string, group: string) => Body
}

const fieldModule = (await import(new URL('fields.mjs', scripts).href)) as {
  FIELD_CHECKS: Record<string, { id: string }>
  fieldBodies: (prefix: string, group: string) => Record<string, Body>
}

const pipelineModule = (await import(new URL('pipelines.mjs', scripts).href)) as {
  PIPELINE_CHECKS: Record<string, { id: string }>
}

const objectModule = (await import(new URL('objects.mjs', scripts).href)) as {
  OBJECT_CHECKS: Record<string, { id: string }>
}

const portalId = 7_000_001
const otherPortal = 7_000_002
const liveKey = 'kalupconf-live-key-5e0a17c2'
// A second key from the environment: never a value on the command line, never in the CLI's environment.
const limitedKey = 'kalupconf-limited-key-2c9f04'
const flags = ['--portal', String(portalId), '--i-own-this-test-portal', String(portalId)]
const cliVersion = (
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }
).version
const CREATE = /^\/crm\/properties\/2026-09\/([^/]+)(\/groups)?$/
const RESOURCE = /^\/crm\/properties\/2026-09\/([^/]+)\/(?:(groups)\/)?([^/]+)$/
const PIPELINE = /^\/crm\/pipelines\/2026-09\/([^/]+)(?:\/([^/]+))?/
const SCHEMA = /^\/crm-object-schemas\/2026-09\/schemas(?:\/([^/]+))?$/
// What cleanup leaves of a pipeline: deleted, or absent when its create was refused.
const GONE = /^(deleted|absent)$/
const CORRELATION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const EVIDENCE_NAME = /^\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\.(json|md)$/
const COMPANIES = '/crm/properties/2026-09/companies'
const MANIFEST_FORMAT = 'kalup-conformance-manifest/1'
const CHOICE = /^\/crm\/properties\/2026-09\/companies\/kalupconf_[0-9a-f]{8}_choice$/

// Another run's leftovers carry a kalupconf prefix too: cleanup goes by the manifest, never by the prefix alone.
const OTHER_RUN = 'kalupconf_0badc0de_'

/** The simulated developer test portal, with forty more invented properties and groups the run must never touch. */
function crowdedPortal(extra: Partial<SimPortalInput> = {}): SimPortalInput {
  const input = simulate.simulatedPortal(portalId)
  const objects = input.objects ?? {}
  for (const objectType of Object.keys(objects)) {
    const model = objects[objectType] ?? {}
    const groups: SimGroupInput[] = [
      { name: 'harvest_log', label: 'Harvest log' },
      { name: `${OTHER_RUN}group`, label: 'Another run' },
    ]
    const properties: SimPropertyInput[] = [
      ...Array.from({ length: 40 }, (_, i) => ({
        name: `orchard_metric_${String(i + 1).padStart(2, '0')}`,
        type: 'number',
        fieldType: 'number',
        groupName: 'harvest_log',
      })),
      { name: `${OTHER_RUN}text`, type: 'string', fieldType: 'text', groupName: `${OTHER_RUN}group` },
    ]
    objects[objectType] = {
      groups: [...(model.groups ?? []), ...groups],
      properties: [...(model.properties ?? []), ...properties],
    }
  }
  return { ...input, objects, ...extra }
}

function work(): string {
  return mkdtempSync(join(tmpdir(), 'kalupconf-'))
}

async function run(
  argv: string[],
  fetch?: PortalSim['fetch'],
  env: Record<string, string | undefined> = {},
  io: Pick<Io, 'person' | 'sleep' | 'stdin'> = {},
) {
  const stdout: string[] = []
  const stderr: string[] = []
  const code = await runner.main(argv, {
    env,
    fetch,
    sleep: () => Promise.resolve(),
    stdin: Readable.from([]),
    ...io,
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
  })
  return { code, stdout: stdout.join(''), stderr: stderr.join('') }
}

function offline(): Promise<Response> {
  return Promise.reject(new Error('a test reached for the network'))
}

/** Stdin as a terminal: `lines` typed one per line, then nothing more. */
function tty(...lines: string[]): NodeJS.ReadableStream {
  const stream = new PassThrough()
  if (lines.length > 0) {
    stream.write(lines.map((line) => `${line}\n`).join(''))
  }
  return Object.assign(stream, { isTTY: true })
}

/** A sleep that lets other work run, such as a line typed at the terminal, before it returns. */
function yielding(): Promise<void> {
  return new Promise((done) => setImmediate(done))
}

/**
 * A person at a terminal: runs the command the runner printed, in-process against the simulator, and types the target
 * name and the number of destructive steps.
 */
function person(fetch: PortalSim['fetch'], exits: { exitCode: number; stderr: string }[]) {
  return async ({ cwd, argv }: Command): Promise<void> => {
    vi.stubGlobal('fetch', fetch)
    vi.stubEnv('KALUP_CONFORMANCE_KEY', simulate.SIMULATED_KEY)
    vi.stubEnv('KALUP_LOCK_DIR', join(cwd, '..', 'locks'))
    vi.stubEnv('KALUP_STATE_DIR', undefined)
    vi.stubEnv('CI', undefined)
    try {
      const { exitCode, stderr } = await cli(
        { cwd, interactive: true, stdin: Readable.from(['conformance\n1\n']) },
        ...argv,
      )
      exits.push({ exitCode, stderr })
    } finally {
      vi.unstubAllEnvs()
      vi.stubGlobal('fetch', offline)
    }
  }
}

/** A clock that moves on a second each time the simulator stamps something, so no two stamps are equal. */
function ticking(): () => Date {
  let clock = Date.parse('2026-09-01T08:00:00Z')
  return () => {
    clock += 1000
    return new Date(clock)
  }
}

/** A manifest file of the run feedf00d on the test portal, as --cleanup reads it. */
function manifestFile(resources: Manifest['resources'], fields: Record<string, unknown> = {}): string {
  const file = join(work(), 'manifest.json')
  const manifest = {
    format: MANIFEST_FORMAT,
    runId: 'feedf00d',
    portalId,
    prefix: 'kalupconf_feedf00d_',
    mode: 'simulate',
    resources,
    ...fields,
  }
  writeFileSync(file, JSON.stringify(manifest))
  return file
}

function simulated(dir: string, ...extra: string[]): string[] {
  return ['--simulate', ...flags, '--work', dir, '--out', join(dir, 'runs'), ...extra]
}

function manifestOf(dir: string): Manifest {
  return JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Manifest
}

function evidenceOf(dir: string): Evidence {
  const [file] = readdirSync(join(dir, 'runs')).filter((name) => name.endsWith('.json'))
  return JSON.parse(readFileSync(join(dir, 'runs', String(file)), 'utf8')) as Evidence
}

function key(type: string, objectType: string, name: string): string {
  return `${type}:${objectType}/${name}`
}

/** The custom object names by type ID, active and archived, as the simulator made them. */
const schemaNames = new Map<string, string>()

/** The resource a write request is for: from the body of a create, from the path otherwise. */
function target(method: string, path: string, body: unknown): string | undefined {
  const schema = SCHEMA.exec(path)
  if (schema) {
    const name = schema[1] ? schemaNames.get(schema[1]) : String((body as { name?: unknown }).name)
    return key('object', 'schemas', String(name))
  }
  // A pipeline, and a stage of one, are the pipeline's: cleanup deletes the stages with it.
  const pipeline = PIPELINE.exec(path)
  if (pipeline) {
    const id = pipeline[2] ?? String((body as { pipelineId?: unknown }).pipelineId)
    return key('pipeline', String(pipeline[1]), id)
  }
  const created = CREATE.exec(path)
  if (method === 'POST' && created) {
    return key(created[2] ? 'group' : 'property', String(created[1]), String((body as Body).name))
  }
  const named = RESOURCE.exec(path)
  return named ? key(named[2] ? 'group' : 'property', String(named[1]), String(named[3])) : undefined
}

/** Every property and group of every object, deep-copied, by resource key. */
function everything(sim: PortalSim): Map<string, unknown> {
  const out = new Map<string, unknown>()
  for (const [objectType, model] of sim.portal(portalId).objects) {
    for (const [name, property] of model.properties) {
      out.set(key('property', objectType, name), structuredClone(property))
    }
    for (const [name, group] of model.groups) {
      out.set(key('group', objectType, name), structuredClone(group))
    }
  }
  return out
}

/** Every file under `dir`, recursively, with its text. */
function texts(dir: string): [string, string][] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const file = join(entry.parentPath, entry.name)
      return [file, readFileSync(file, 'utf8')]
    })
}

beforeAll(() => {
  // Throws unless the CLI's dist matches its sources: the runner spawns it.
  host()
})

beforeEach(() => {
  vi.stubGlobal('fetch', offline)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a simulated run on a portal full of other properties', () => {
  const dir = work()
  const sim = createPortalSim([crowdedPortal()])
  const before = everything(sim)
  const creates: string[] = []
  const unlisted: string[] = []
  const confirmed: { exitCode: number; stderr: string }[] = []
  let result: Awaited<ReturnType<typeof run>>

  // Every create, the runner's and the ones kalup apply sends over IPC, is checked against the manifest on disk.
  async function watched(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
    const method = (init.method ?? 'GET').toUpperCase()
    const path = new URL(String(input)).pathname
    if (method === 'POST' && (CREATE.test(path) || SCHEMA.test(path))) {
      const address = String(target(method, path, JSON.parse(String(init.body))))
      creates.push(address)
      const listed = existsSync(join(dir, 'manifest.json'))
        ? manifestOf(dir).resources.map((r) => key(r.type, r.objectType, r.name))
        : []
      if (!listed.includes(address)) {
        unlisted.push(address)
      }
    }
    const answer = await sim.fetch(input, init)
    const p = sim.portal(portalId)
    for (const s of [...p.schemas, ...p.archivedSchemas]) {
      schemaNames.set(s.objectTypeId, s.name)
    }
    return answer
  }

  beforeAll(async () => {
    result = await run(simulated(dir), watched, {}, { stdin: tty(), person: person(watched, confirmed) })
  }, 120_000)

  test('every check passes, the delete a person confirms at a terminal included, exit 0, and cleanup is complete', () => {
    expect(result.code, result.stderr).toBe(0)
    const evidence = evidenceOf(dir)
    expect(evidence.checks.filter((c) => c.status !== 'pass').map((c) => [c.id, c.status, c.reason])).toEqual([])
    expect(evidence.cleanup.complete).toBe(true)
    expect(result.stdout).toContain('pass  write.companies.option-left-out')
    expect(result.stdout).toContain(`cd '${join(dir, 'project')}' && node '`)
    expect(result.stdout).toContain("dist/index.mjs' apply delete-plan.json")
    expect(confirmed).toEqual([{ exitCode: 0, stderr: expect.any(String) }])
  })

  test('the evidence: its file names, header, redacted portal, versions and one entry per check with facts', () => {
    const files = readdirSync(join(dir, 'runs')).sort()
    expect(files).toHaveLength(2)
    expect(files.every((name) => EVIDENCE_NAME.test(name))).toBe(true)
    const evidence = evidenceOf(dir)
    expect(files).toEqual([`${evidence.date}-${evidence.runId}.json`, `${evidence.date}-${evidence.runId}.md`])
    expect(evidence).toMatchObject({
      format: 'kalup-conformance/1',
      mode: 'simulate',
      portal: 'test-portal',
      accountType: 'DEVELOPER_TEST',
      versions: { kalup: cliVersion, node: process.version, api: runner.API_PINS },
    })
    const writeKeys = [
      'group-create',
      'group-label-update',
      'property-create',
      'read-after-write-lag',
      'create-round-trip',
      'modification-metadata',
      'label-description-update',
      'patch-without-options',
      'option-added',
      'option-label-changed',
      'option-left-out',
      'field-type-change',
      'create-existing-name',
      'archive',
      'archived-single-read',
      'create-archived-name',
      'archive-group-holding-property',
    ]
    const expected = [
      'read.unknown-property-404',
      'read.custom-object-schemas',
      'read.sensitive-lists',
      'read.sensitive-property-without-sensitivity',
      'read.limits-custom-properties',
      'read.limits-custom-object-types',
      'read.secondary-display-properties-order',
      'read.archived-list-sensitivity',
      'read.archived-groups-in-list',
      'read.rate-limit-headers',
      'read.scopes',
      'write.companies.archive-property-in-use',
      'write.companies.create-archived-group-name',
      'write.companies.missing-write-scope',
      ...Object.values(fieldModule.FIELD_CHECKS).map((c) => c.id),
      ...writeKeys.map((k) => `write.companies.${k}`),
      ...writeKeys.map((k) => `write.custom-object.${k}`),
      ...Object.values(pipelineModule.PIPELINE_CHECKS).map((c) => c.id),
      ...Object.values(objectModule.OBJECT_CHECKS).map((c) => c.id),
      'cli.pull',
      'cli.plan',
      'cli.apply-saved-plan',
      'cli.second-plan-no-effect',
      'cli.drift-held',
      'cli.pull-only-takes-drift',
      'cli.rm-destroy-plan',
      'cli.delete-at-terminal',
    ]
    expect(evidence.checks.map((c) => c.id).sort()).toEqual(expected.sort())
    for (const c of evidence.checks) {
      expect(c.title && c.gate && c.assumption, c.id).toBeTruthy()
      expect(typeof c.facts, c.id).toBe('object')
      expect(Array.isArray(c.requests), c.id).toBe(true)
    }
    const counts = { pass: 0, fail: 0, 'not-applicable': 0 }
    for (const c of evidence.checks) {
      counts[c.status] += 1
    }
    expect(evidence.summary).toEqual(counts)
    // HubSpot's correlationId is kept: the simulator sends one with each error answer.
    const correlated = evidence.checks.flatMap((c) => c.requests).filter((r) => r.correlationId !== undefined)
    expect(correlated.length).toBeGreaterThan(0)
    expect(correlated.every((r) => CORRELATION.test(String(r.correlationId)))).toBe(true)
    const markdown = readFileSync(join(dir, 'runs', `${evidence.date}-${evidence.runId}.md`), 'utf8')
    expect(markdown).toContain(`# Conformance run ${evidence.runId}`)
    // A simulated run says what it proves: the runner's mechanics, not HubSpot's behaviour, and it names no correlation ID.
    expect(markdown).toContain("The checks ran against Kalup's HubSpot simulator and no request reached HubSpot")
    expect(markdown).toContain("a pass proves the runner's mechanics")
    expect(markdown.toLowerCase()).not.toContain('correlation')
    for (const id of expected) {
      expect(markdown).toContain(`| \`${id}\` |`)
    }
  })

  test('facts record what HubSpot answered: the round trip, the options left out, the existing name, the lag', () => {
    const facts = (id: string) => evidenceOf(dir).checks.find((c) => c.id === id)?.facts
    expect(facts('write.companies.create-round-trip')).toEqual({
      text: { owned: [], rewritten: [] },
      choice: { owned: [], rewritten: [] },
    })
    expect(facts('write.companies.option-left-out')).toMatchObject({ status: 200, outcome: 'removed' })
    expect(facts('write.companies.create-existing-name')).toMatchObject({
      status: 409,
      category: 'OBJECT_ALREADY_EXISTS',
      subCategory: 'Properties.PROPERTY_WITH_NAME_EXISTS',
      unchanged: true,
    })
    // As observed on 2026-09-29: HubSpot restores the archived property with the definition the create posted, refuses
    // to archive one in use, leaves an archived group out of the list, creates a group of an archived group's name with
    // the new label, and answers 403 on the property limit to a key with no crm.objects scope.
    const posted = { label: 'Kalup conformance text', fieldType: 'text' }
    expect(facts('write.companies.create-archived-name')).toMatchObject({
      status: 201,
      outcome: 'restored',
      activeRead: 200,
      archivedRead: 404,
      definition: {
        archived: { label: 'Kalup conformance text, renamed', fieldType: 'textarea' },
        posted,
        active: posted,
      },
    })
    expect(facts('read.archived-groups-in-list')).toMatchObject({ status: 204, listed: 'absent' })
    // No --scopes, so either answer passes; the facts keep the 403's category.
    expect(facts('read.limits-custom-properties')).toMatchObject({
      expected: null,
      status: 403,
      category: 'MISSING_SCOPES',
      scopesNamed: [],
    })
    expect(facts('read.scopes')).toMatchObject({
      covered: [],
      uncovered: ['GET /crm/limits/2026-09/custom-properties'],
    })
    expect(facts('write.companies.create-archived-group-name')).toMatchObject({
      status: 201,
      outcome: 'created',
      label: 'Kalup conformance reused again',
    })
    expect(facts('write.companies.read-after-write-lag')).toMatchObject({
      single: { visible: true, reads: 1 },
      list: { visible: true, reads: 1 },
    })
    expect(facts('cli.rm-destroy-plan')).toMatchObject({ yes: { exitCode: 4, issues: ['E_APPROVAL_REQUIRED'] } })
    // The calculation property's formula is set by its create, and the property it uses is not archived.
    expect(facts('write.companies.archive-property-in-use')).toMatchObject({
      status: 400,
      category: 'VALIDATION_ERROR',
      subCategory: 'PropertyValidationError.CANNOT_DELETE_PROPERTY_IN_USE',
      formulaSetBy: 'create',
      used: 'active',
      calculation: 'active',
    })
    // The group archive's refusal nests its error body in the message; the facts read it as Kalup does.
    expect(facts('write.companies.archive-group-holding-property')).toMatchObject({
      status: 400,
      category: 'VALIDATION_ERROR',
      subCategory: 'PropertyGroupError.GROUP_WITH_ACTIVE_PROPERTIES',
      message: "Can't delete or purge a group with active properties",
    })
    expect(facts('write.companies.missing-write-scope')).toMatchObject({
      status: 403,
      category: 'MISSING_SCOPES',
      scopesNamed: ['crm.schemas.companies.write'],
      sameScope: true,
      created: false,
    })
    expect(facts('read.sensitive-property-without-sensitivity')).toMatchObject({
      without: 404,
      with: 200,
      runProperty: false,
      why: expect.stringContaining('--scopes names no crm.objects.companies.sensitive.write'),
    })
    expect(facts('cli.delete-at-terminal')).toMatchObject({ archived: true, stateDropped: true })
  })

  test("each apply's requests come from Kalup's journal: method, path template, status and outcome, no body", () => {
    const { prefix } = manifestOf(dir)
    const { facts } = evidenceOf(dir).checks.find((c) => c.id === 'cli.apply-saved-plan') ?? { facts: {} }
    const { journal } = facts as { journal: Body[] }
    expect(journal.length).toBeGreaterThan(0)
    for (const entry of journal) {
      expect(Object.keys(entry).sort()).toEqual(
        [
          'address',
          'category',
          'correlationId',
          'method',
          'ms',
          'outcome',
          'path',
          'status',
          'step',
          'subCategory',
        ].sort(),
      )
    }
    expect(journal).toContainEqual(
      expect.objectContaining({
        address: key('property', 'companies', `${prefix}kalup_count`),
        method: 'POST',
        path: '/crm/properties/2026-09/{objectType}',
        status: 201,
        outcome: 'ok',
      }),
    )
  })

  test('the manifest names each resource before its create is sent, kalup apply creates included', () => {
    const { prefix } = manifestOf(dir)
    expect(unlisted).toEqual([])
    expect(manifestOf(dir).resources.every((r) => typeof r.sentAt === 'string')).toBe(true)
    expect(creates).toContain(key('group', 'companies', `${prefix}kalup`))
    expect(creates).toContain(key('property', 'companies', `${prefix}kalup_count`))
    expect(creates).toContain(key('property', simulate.SIMULATED_OBJECT, `${prefix}choice`))
  })

  test('only the manifest is written to: every other property and group is as it was, and the run left none active', () => {
    const manifest = manifestOf(dir)
    const owned = new Set(manifest.resources.map((r) => key(r.type, r.objectType, r.name)))
    const writes = sim.writes().map((w) => String(target(w.method, w.path, w.body)))
    expect(writes.length).toBeGreaterThan(0)
    expect(writes.filter((w) => !owned.has(w))).toEqual([])
    expect(manifest.resources.every((r) => r.name.startsWith(manifest.prefix))).toBe(true)
    const after = everything(sim)
    for (const [address, value] of before) {
      expect(after.get(address), address).toEqual(value)
    }
    // The second key's create was refused with a 403, and so were the field checks' invalid creates: those never
    // existed, and cleanup found them absent.
    const limited = key('group', 'companies', `${manifest.prefix}limited`)
    const refused = ['fcurbad', 'fownerbad', 'fboolbare', 'fsens'].map((n) =>
      key('property', 'companies', manifest.prefix + n),
    )
    for (const address of [limited, ...refused]) {
      expect(after.has(address), address).toBe(false)
      expect(manifest.cleanup?.resources.find((r) => r.address === address)?.result, address).toBe('absent')
    }
    // A pipeline is purged, not archived: the empty one was refused and never existed, the other is gone.
    const pipelines = [...owned].filter((a) => a.startsWith('pipeline:'))
    expect(pipelines).toHaveLength(2)
    for (const address of pipelines) {
      const [objectType = '', id] = address.slice('pipeline:'.length).split('/')
      expect(
        sim
          .portal(portalId)
          .pipelines.get(objectType)
          ?.some((p) => p.id === id),
        address,
      ).toBe(false)
      expect(manifest.cleanup?.resources.find((r) => r.address === address)?.result, address).toMatch(GONE)
    }
    // The run's custom object is archived and then purged: neither list holds it.
    const objects = [...owned].filter((a) => a.startsWith('object:'))
    expect(objects).toHaveLength(1)
    const p = sim.portal(portalId)
    expect([...p.schemas, ...p.archivedSchemas].some((s) => s.name.startsWith(manifest.prefix))).toBe(false)
    expect(manifest.cleanup?.resources.find((r) => r.address === objects[0])?.result).toBe('purged')
    const left = (a: string) => !(a === limited || refused.includes(a) || pipelines.includes(a) || objects.includes(a))
    for (const address of [...owned].filter(left)) {
      expect((after.get(address) as { archived?: boolean } | undefined)?.archived, address).toBe(true)
    }
    // The manifest records the cleanup by portal names; the evidence redacts the custom object's type ID.
    expect(manifest.cleanup?.resources.map((r) => r.address).sort()).toEqual([...owned].sort())
  })

  test('no key in any file the run wrote, nor in its output; no portal ID in the evidence', () => {
    const written = texts(dir)
    expect(written.some(([file]) => file.includes('journal'))).toBe(true)
    for (const [file, text] of written) {
      expect(text.includes(simulate.SIMULATED_KEY), file).toBe(false)
      expect(text.includes(simulate.SIMULATED_LIMITED_KEY), file).toBe(false)
    }
    expect(`${result.stdout}${result.stderr}`).not.toContain(simulate.SIMULATED_KEY)
    expect(`${result.stdout}${result.stderr}`).not.toContain(simulate.SIMULATED_LIMITED_KEY)
    for (const [file, text] of texts(join(dir, 'runs'))) {
      expect(text.includes(String(portalId)), file).toBe(false)
      expect(text.includes(simulate.SIMULATED_OBJECT), file).toBe(false)
    }
  })
})

describe('refusals', () => {
  test.each([
    ['no --portal', ['--simulate', '--i-own-this-test-portal', String(portalId)], 'E_USAGE'],
    ['no confirmation flag', ['--simulate', '--portal', String(portalId)], 'E_CONFIRMATION'],
    ['a confirmation of another portal', ['--simulate', ...flags.slice(0, 3), String(otherPortal)], 'E_CONFIRMATION'],
    ['the key in a flag', ['--simulate', ...flags, '--key', 'kalupconf-typed-key-81f2'], 'E_KEY_IN_FLAG'],
    ['the key after =', ['--simulate', ...flags, `--token=${liveKey}`], 'E_KEY_IN_FLAG'],
    ['the key as an argument', ['--simulate', ...flags, liveKey], 'E_KEY_IN_FLAG'],
    ['the simulated key as a value', ['--simulate', ...flags, '--scopes', simulate.SIMULATED_KEY], 'E_KEY_IN_FLAG'],
    ['a HubSpot-shaped key', ['--simulate', ...flags, '--scopes', 'pat-na1-00000000-0000'], 'E_KEY_IN_FLAG'],
    ['the second key as a value', ['--simulate', ...flags, '--scopes', limitedKey], 'E_KEY_IN_FLAG'],
    ['an unknown flag', ['--simulate', ...flags, '--force'], 'E_USAGE'],
  ])('before any request: %s is exit 2 with %s, nothing sent or written', async (_, argv, code) => {
    const sim = createPortalSim([crowdedPortal()])
    const dir = work()
    const out = await run([...argv, '--work', dir], sim.fetch, {
      KALUP_CONFORMANCE_KEY: liveKey,
      KALUP_CONFORMANCE_LIMITED_KEY: limitedKey,
    })
    expect(out.code).toBe(2)
    expect(out.stderr).toContain(code)
    expect(sim.log).toEqual([])
    expect(readdirSync(dir)).toEqual([])
    expect(`${out.stdout}${out.stderr}`).not.toContain(liveKey)
    expect(`${out.stdout}${out.stderr}`).not.toContain(limitedKey)
  })

  test.each([
    ['a STANDARD account', { accountType: 'STANDARD' }, 'E_ACCOUNT_TYPE'],
    ['an APP_DEVELOPER account', { accountType: 'APP_DEVELOPER' }, 'E_ACCOUNT_TYPE'],
    ['the key of another portal', { portalId: otherPortal }, 'E_PORTAL_MISMATCH'],
  ])('after account-info: %s is exit 2 with %s, and no write and no manifest', async (_, extra, code) => {
    const sim = createPortalSim([crowdedPortal(extra)])
    const dir = work()
    const out = await run(simulated(dir), sim.fetch)
    expect(out.code).toBe(2)
    expect(out.stderr).toContain(code)
    expect(sim.log.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /account-info/2026-09/details'])
    expect(existsSync(join(dir, 'manifest.json'))).toBe(false)
  })

  test.each([
    [
      '403: a scope account-info may need',
      (sim: PortalSim) =>
        sim.fault({
          method: 'GET',
          path: '/account-info/2026-09/details',
          action: fault.status(403, {
            status: 'error',
            category: 'MISSING_SCOPES',
            correlationId: '5c0bba5e-0000-4000-8000-000000000403',
            message: 'This key has not been granted all required scopes.',
          }),
        }),
      'E_GUARD: account-info answered 403 (MISSING_SCOPES, correlationId 5c0bba5e-0000-4000-8000-000000000403). The key may lack a scope',
    ],
    [
      '401: a key HubSpot does not accept',
      (sim: PortalSim) => {
        sim.portal(portalId).keys = { KALUP_CONFORMANCE_KEY: 'kalupconf-revoked-key-19ab' }
      },
      'E_GUARD: account-info answered 401 (INVALID_AUTHENTICATION, correlationId 00000000-0000-4000-8000-000000000001): HubSpot did not accept the key',
    ],
  ])('account-info answering %s is exit 2 with the status, category and correlationId', async (_, arrange, message) => {
    const sim = createPortalSim([crowdedPortal()])
    arrange(sim)
    const dir = work()
    const out = await run(simulated(dir), sim.fetch)
    expect(out.code).toBe(2)
    expect(out.stderr).toContain(message)
    expect(sim.log.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /account-info/2026-09/details'])
    expect(existsSync(join(dir, 'manifest.json'))).toBe(false)
  })

  test('live without KALUP_CONFORMANCE_KEY: exit 2 before any request', async () => {
    const out = await run([...flags, '--work', work()], undefined, {})
    expect(out.code).toBe(2)
    expect(out.stderr).toContain('E_MISSING_KEY')
  })
})

test('the CLI the runner spawns never gets the second key: KALUP_CONFORMANCE_LIMITED_KEY is not in its environment', async () => {
  const sim = createPortalSim([crowdedPortal()])
  const dir = work()
  // A stand-in CLI that records the names of the variables it was given, once per run.
  const stub = join(work(), 'cli.mjs')
  writeFileSync(
    stub,
    "import { appendFileSync } from 'node:fs'\nappendFileSync(new URL('env.jsonl', import.meta.url), JSON.stringify(Object.keys(process.env)) + '\\n')\n",
  )
  await run(simulated(dir, '--cli', stub), sim.fetch, { KALUP_CONFORMANCE_LIMITED_KEY: limitedKey })
  const runs = readFileSync(join(stub, '..', 'env.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[])
  expect(runs.length).toBeGreaterThan(0)
  for (const names of runs) {
    expect(names).toContain('KALUP_CONFORMANCE_KEY')
    expect(names).not.toContain('KALUP_CONFORMANCE_LIMITED_KEY')
  }
}, 120_000)

describe('cleanup', () => {
  test('an interrupted run reports what it left behind, and --cleanup archives exactly the manifest', async () => {
    const sim = createPortalSim([crowdedPortal()])
    const before = everything(sim)
    const dir = work()
    let writes = 0
    // The network goes away after the sixth write: the checks after it fail, and so does the run's own cleanup.
    const failing = (input: string | URL | Request, init: RequestInit = {}) => {
      if (writes >= 6) {
        return Promise.reject(new TypeError('fetch failed'))
      }
      writes += (init.method ?? 'GET') === 'GET' ? 0 : 1
      return sim.fetch(input, init)
    }
    const interrupted = await run(simulated(dir), failing)
    expect(interrupted.code).toBe(3)
    expect(interrupted.stderr).toContain('--cleanup')
    // A create is in the manifest before it is sent, so the manifest also names the creates the network lost.
    const manifest = manifestOf(dir)
    const owned = manifest.resources.map((r) => key(r.type, r.objectType, r.name))
    const created = [
      key('group', 'companies', `${manifest.prefix}group`),
      key('property', 'companies', `${manifest.prefix}text`),
      key('property', 'companies', `${manifest.prefix}choice`),
    ]
    expect(owned.slice(0, 3)).toEqual(created)
    expect(owned.length).toBeGreaterThan(3)
    const left = evidenceOf(dir).cleanup
    expect(left.complete).toBe(false)
    expect(left.resources.every((r) => r.result === 'failed')).toBe(true)

    const cleaned = await run(['--simulate', '--cleanup', join(dir, 'manifest.json'), ...flags], sim.fetch)
    expect(cleaned.code, cleaned.stderr).toBe(0)
    const after = everything(sim)
    for (const address of created) {
      expect((after.get(address) as { archived?: boolean }).archived, address).toBe(true)
      expect(cleaned.stdout).toContain(`archived         ${address}`)
    }
    for (const address of owned.slice(3)) {
      expect(cleaned.stdout).toContain(`absent           ${address}`)
    }
    for (const [address, value] of before) {
      expect(after.get(address), address).toEqual(value)
    }
    expect(sim.writes().filter((w) => w.method === 'DELETE')).toHaveLength(3)
  })

  test('--cleanup refuses a manifest entry without the run prefix, and never archives it', async () => {
    const prefix = 'kalupconf_feedf00d_'
    const sim = createPortalSim([
      crowdedPortal({
        objects: {
          companies: {
            groups: [
              { name: 'orchard_details', label: 'Orchard details' },
              { name: `${prefix}group`, label: 'Left behind' },
            ],
            properties: [
              { name: 'orchard_rows', type: 'number', fieldType: 'number', groupName: 'orchard_details' },
              { name: `${prefix}text`, type: 'string', fieldType: 'text', groupName: `${prefix}group` },
            ],
          },
        },
      }),
    ])
    const dir = work()
    const file = join(dir, 'manifest.json')
    const resources = [
      { type: 'group', objectType: 'companies', name: `${prefix}group` },
      { type: 'property', objectType: 'companies', name: `${prefix}text` },
      { type: 'property', objectType: 'companies', name: 'orchard_rows' },
    ]
    const manifest = {
      format: 'kalup-conformance-manifest/1',
      runId: 'feedf00d',
      portalId,
      prefix,
      mode: 'simulate',
      resources,
    }
    writeFileSync(file, JSON.stringify(manifest))
    const out = await run(['--simulate', '--cleanup', file, ...flags], sim.fetch)
    expect(out.code).toBe(3)
    expect(out.stdout).toContain('refused')
    const model = sim.object(portalId, 'companies')
    expect(model.properties.get('orchard_rows')?.archived).toBe(false)
    expect(model.properties.get(`${prefix}text`)?.archived).toBe(true)
    expect(model.groups.get(`${prefix}group`)?.archived).toBe(true)
    expect(sim.writes().map((w) => `${w.method} ${w.path}`)).toEqual([
      `DELETE /crm/properties/2026-09/companies/${prefix}text`,
      `DELETE /crm/properties/2026-09/companies/groups/${prefix}group`,
    ])
  })

  test.each([
    ['an empty prefix', { prefix: '' }],
    ['the bare kalupconf_ prefix', { prefix: 'kalupconf_' }],
    ["another run's prefix", { prefix: OTHER_RUN }],
    ['a run ID that is not eight hexadecimal characters', { runId: 'orchard', prefix: 'kalupconf_orchard_' }],
  ])('--cleanup refuses a manifest with %s before any write', async (_, fields) => {
    const sim = createPortalSim([crowdedPortal()])
    const file = manifestFile(
      [
        { type: 'property', objectType: 'companies', name: 'orchard_rows' },
        { type: 'property', objectType: 'companies', name: `${OTHER_RUN}text` },
        { type: 'group', objectType: 'companies', name: `${OTHER_RUN}group` },
      ],
      fields,
    )
    const out = await run(['--simulate', '--cleanup', file, ...flags], sim.fetch)
    expect(out.code).toBe(2)
    expect(out.stderr).toContain('E_MANIFEST')
    expect(sim.writes()).toEqual([])
  })

  test('a write is refused unless the name is shaped as a run name, whatever the manifest holds as its prefix', () => {
    const everyName = (prefix: string) => ({ data: { prefix }, holds: () => true })
    const property = (name: string) => ({ type: 'property', objectType: 'companies', name })
    expect(client.refuseWrite(everyName(''), property('orchard_rows'))).toContain('does not carry the run prefix')
    expect(client.refuseWrite(everyName('kalupconf_'), property('kalupconf_notes'))).toContain('run prefix')
    expect(client.refuseWrite(everyName('kalupconf_feedf00d_'), property('kalupconf_feedf00d_text'))).toBeUndefined()
  })

  test('a create HubSpot applied but answered 502, and that reads back only after a lag, is archived', async () => {
    const sim = createPortalSim([crowdedPortal()])
    const dir = work()
    const lagging = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
      const path = new URL(String(input)).pathname
      if (init.method === 'POST' && path === COMPANIES && String(init.body).includes('_cli_seed')) {
        sim.fault({ method: 'POST', path, occurrence: 1, action: fault.lag(3) })
        await sim.fetch(input, init)
        return new Response(JSON.stringify({ status: 'error', message: 'Bad gateway' }), { status: 502 })
      }
      return sim.fetch(input, init)
    }
    const out = await run(simulated(dir), lagging)
    expect(out.code, out.stderr).toBe(1)
    const evidence = evidenceOf(dir)
    expect(evidence.checks.filter((c) => c.status === 'fail').map((c) => c.id)).toEqual(['cli.pull'])
    const { prefix } = manifestOf(dir)
    const seed = key('property', 'companies', `${prefix}cli_seed`)
    expect(evidence.cleanup.complete).toBe(true)
    expect(evidence.cleanup.resources.find((r) => r.address === seed)?.result).toBe('archived')
    expect(sim.object(portalId, 'companies').properties.get(`${prefix}cli_seed`)?.archived).toBe(true)
  }, 120_000)

  test("--cleanup of another portal's manifest is refused before any write", async () => {
    const sim = createPortalSim([crowdedPortal()])
    const dir = work()
    const file = join(dir, 'manifest.json')
    const manifest = {
      format: 'kalup-conformance-manifest/1',
      runId: 'feedf00d',
      portalId: otherPortal,
      prefix: 'kalupconf_feedf00d_',
      mode: 'simulate',
      resources: [],
    }
    writeFileSync(file, JSON.stringify(manifest))
    const out = await run(['--simulate', '--cleanup', file, ...flags], sim.fetch)
    expect(out.code).toBe(2)
    expect(out.stderr).toContain('E_PORTAL_MISMATCH')
    expect(sim.writes()).toEqual([])
  })
})

test('a portal that answers otherwise than the simulator assumes fails that check, with the facts', async () => {
  const conflict = { status: 'error', category: 'VALIDATION_ERROR', message: 'Property already exists' }
  const sim = createPortalSim([
    crowdedPortal({ groupDelete: 'archive-members', existingCreate: { status: 400, body: conflict } }),
  ])
  const dir = work()
  const out = await run(simulated(dir), sim.fetch)
  expect(out.code).toBe(1)
  const evidence = evidenceOf(dir)
  const failed = evidence.checks.filter((c) => c.status === 'fail')
  expect(failed.map((c) => c.id)).toEqual([
    'write.companies.archive-group-holding-property',
    'write.custom-object.archive-group-holding-property',
  ])
  // An archived group leaves the list, as observed.
  expect(failed[0]?.facts).toMatchObject({ status: 204, group: 'absent', property: 'archived' })
  expect(evidence.checks.find((c) => c.id === 'write.companies.create-existing-name')).toMatchObject({
    status: 'pass',
    facts: { status: 400, category: 'VALIDATION_ERROR' },
  })
  expect(evidence.cleanup.complete).toBe(true)
}, 120_000)

test('a rejected PATCH and a recreate of an archived name are recorded as what HubSpot did, not guessed', async () => {
  const sim = createPortalSim([crowdedPortal()], ticking())
  const rejected = fault.status(400, {
    status: 'error',
    category: 'VALIDATION_ERROR',
    correlationId: '0dd0b7e5-0000-4000-8000-000000000400',
    message: 'Invalid options',
  })
  // The first PATCH of the choice property is patch-without-options, the fourth option-left-out.
  sim.fault({ method: 'PATCH', path: CHOICE, occurrence: 1, action: rejected })
  sim.fault({ method: 'PATCH', path: CHOICE, occurrence: 4, action: rejected })
  // HubSpot takes a create of the archived text property's name as a new property, which reads back after two reads.
  const recreating = (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const path = new URL(String(input)).pathname
    const { properties } = sim.object(portalId, 'companies')
    const name = init.method === 'POST' && path === COMPANIES ? String(JSON.parse(String(init.body)).name) : ''
    if (name.endsWith('_text') && properties.get(name)?.archived) {
      properties.delete(name)
      sim.fault({ method: 'POST', path, occurrence: 1, action: fault.lag(2) })
    }
    return sim.fetch(input, init)
  }
  const dir = work()
  const out = await run(simulated(dir), recreating)
  expect(out.code, out.stderr).toBe(1)
  const evidence = evidenceOf(dir)
  const byId = (id: string) => evidence.checks.find((c) => c.id === id)
  expect(evidence.checks.filter((c) => c.status === 'fail').map((c) => c.id)).toEqual([
    'write.companies.patch-without-options',
    'write.companies.option-left-out',
    'write.companies.create-archived-name',
  ])
  expect(byId('write.companies.patch-without-options')).toMatchObject({
    note: '400; the PATCH was rejected',
    facts: { status: 400, optionsKept: null, category: 'VALIDATION_ERROR' },
  })
  expect(byId('write.companies.option-left-out')).toMatchObject({
    note: '400; the PATCH was rejected',
    facts: { status: 400, outcome: 'rejected', readBack: null, category: 'VALIDATION_ERROR' },
  })
  const { prefix } = manifestOf(dir)
  const options = sim.object(portalId, 'companies').properties.get(`${prefix}choice`)?.options ?? []
  expect(options.map((o) => o.value)).toEqual(['alpha', 'beta', 'gamma', 'delta'])
  expect(byId('write.companies.create-archived-name')).toMatchObject({
    note: '201; the name was recreated',
    facts: { status: 201, outcome: 'recreated', activeRead: 200 },
  })
  expect(evidence.cleanup.complete).toBe(true)
}, 120_000)

// A portal that restores the archived group with its old label, which fb6155db did not observe, is recorded as such,
// fails, and cleanup still archives the group.
test("a group create of an archived group's name on a portal that restores the old label: a fail, and cleaned up", async () => {
  const sim = createPortalSim([crowdedPortal()])
  const reusing = (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const path = new URL(String(input)).pathname
    const name =
      init.method === 'POST' && path === `${COMPANIES}/groups` ? String(JSON.parse(String(init.body)).name) : ''
    const held = sim.object(portalId, 'companies').groups.get(name)
    if (name.endsWith('_reused') && held?.archived) {
      held.archived = false
      const headers = { 'content-type': 'application/json' }
      return Promise.resolve(new Response(JSON.stringify(held), { status: 201, headers }))
    }
    return sim.fetch(input, init)
  }
  const dir = work()
  const out = await run(simulated(dir), reusing)
  expect(out.code, out.stderr).toBe(1)
  const evidence = evidenceOf(dir)
  expect(evidence.checks.filter((c) => c.status === 'fail').map((c) => c.id)).toEqual([
    'write.companies.create-archived-group-name',
  ])
  expect(evidence.checks.find((c) => c.id === 'write.companies.create-archived-group-name')).toMatchObject({
    facts: { status: 201, outcome: 'restored', label: 'Kalup conformance reused' },
  })
  const { prefix } = manifestOf(dir)
  const address = key('group', 'companies', `${prefix}reused`)
  expect(evidence.cleanup.resources.find((r) => r.address === address)?.result).toBe('archived')
  expect(sim.object(portalId, 'companies').groups.get(`${prefix}reused`)?.archived).toBe(true)
  expect(evidence.cleanup.complete).toBe(true)
}, 120_000)

// Without --scopes the key's scopes are unknown: a key that reads the property limit passes as a 403 would.
test('with no --scopes, a property limit reading passes too, and the facts say it answered 200', async () => {
  const scopes = ['crm.schemas.companies.read', 'crm.schemas.companies.write', 'crm.objects.companies.read']
  const sim = createPortalSim([crowdedPortal({ scopes: { KALUP_CONFORMANCE_KEY: scopes } })])
  const dir = work()
  const out = await run(simulated(dir), sim.fetch)
  expect(out.code, out.stderr).toBe(0)
  expect(evidenceOf(dir).checks.find((c) => c.id === 'read.limits-custom-properties')).toMatchObject({
    status: 'pass',
    note: expect.stringContaining('no --scopes, so a 403 or a reading passes'),
    facts: { expected: null, status: 200, overallLimit: 1000 },
  })
}, 120_000)

test('a saved plan with an effect outside the manifest is never applied, base-only or refused by --yes', async () => {
  const sim = createPortalSim([crowdedPortal()])
  const portalGroup = structuredClone(sim.object(portalId, 'companies').groups.get('orchard_details'))
  // A person moves the property kalup apply created into a portal group in HubSpot, with the label edit.
  const moving = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const answer = await sim.fetch(input, init)
    const name = new URL(String(input)).pathname.split('/').at(-1) ?? ''
    const property = sim.object(portalId, 'companies').properties.get(name)
    if (init.method === 'PATCH' && name.endsWith('_kalup_count') && answer.status === 200 && property) {
      property.groupName = 'orchard_details'
    }
    return answer
  }
  const dir = work()
  const out = await run(simulated(dir), moving)
  expect(out.code, out.stderr).toBe(1)
  const evidence = evidenceOf(dir)
  expect(evidence.checks.find((c) => c.id === 'cli.pull-only-takes-drift')).toMatchObject({
    status: 'fail',
    facts: { apply: null, plan: { outsideManifest: ['group:companies/orchard_details'] } },
  })
  expect(evidence.checks.find((c) => c.id === 'cli.rm-destroy-plan')).toMatchObject({
    status: 'fail',
    facts: { yes: null, plan: { outsideManifest: ['group:companies/orchard_details'] } },
  })
  const state = JSON.parse(
    readFileSync(join(dir, 'project', '.kalup', 'state', `portal-${portalId}.json`), 'utf8'),
  ) as { resources: Record<string, unknown> }
  expect(Object.keys(state.resources)).not.toContain('group:companies/orchard_details')
  expect(sim.object(portalId, 'companies').groups.get('orchard_details')).toEqual(portalGroup)
  expect(evidence.cleanup.complete).toBe(true)
}, 120_000)

describe('the checks a live run cannot always make', () => {
  test('with the companies sensitive write scope, the run reads a sensitive property of its own and cleanup archives it', async () => {
    const scopes = 'crm.schemas.companies.read,crm.schemas.companies.write,crm.objects.companies.sensitive.write'
    const sim = createPortalSim([crowdedPortal({ scopes: { KALUP_CONFORMANCE_KEY: scopes.split(',') } })])
    const dir = work()
    const out = await run(simulated(dir, '--scopes', scopes), sim.fetch)
    expect(out.code, out.stderr).toBe(0)
    const { prefix, resources } = manifestOf(dir)
    expect(resources).toContainEqual(
      expect.objectContaining({ type: 'property', name: `${prefix}secret`, dataSensitivity: 'sensitive' }),
    )
    expect(evidenceOf(dir).checks.find((c) => c.id === 'read.sensitive-property-without-sensitivity')).toMatchObject({
      status: 'pass',
      facts: { dataSensitivity: 'sensitive', without: 404, with: 200, runProperty: true },
    })
    // --scopes names a crm.objects scope and the key holds it, so the property limit reads.
    expect(evidenceOf(dir).checks.find((c) => c.id === 'read.limits-custom-properties')).toMatchObject({
      status: 'pass',
      facts: { expected: 200, status: 200 },
    })
    const secret = sim.object(portalId, 'companies').properties.get(`${prefix}secret`)
    expect(secret).toMatchObject({ dataSensitivity: 'sensitive', archived: true })
    expect(evidenceOf(dir).cleanup.complete).toBe(true)
  }, 120_000)

  // A 403 is how a key without a scope is refused: the check records it as not applicable, and read.scopes, which fails
  // on reads only, still passes while its facts list the create, next to the property limit's 403, which a key without
  // a crm.objects scope gets.
  test.each([400, 403])(
    'a portal that cannot create a calculation property (%i): the in-use archive is not applicable, and says what stays open',
    async (status) => {
      const sim = createPortalSim([crowdedPortal()])
      const refusing = (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
        const path = new URL(String(input)).pathname
        if (init.method === 'POST' && path === COMPANIES && String(init.body).includes('calculation_equation')) {
          const body = {
            status: 'error',
            category: 'VALIDATION_ERROR',
            message: 'Calculation properties are not available',
          }
          return Promise.resolve(new Response(JSON.stringify(body), { status }))
        }
        return sim.fetch(input, init)
      }
      const dir = work()
      const out = await run(simulated(dir), refusing)
      expect(out.code, out.stderr).toBe(0)
      const { checks: results } = evidenceOf(dir)
      const inUse = results.find((c) => c.id === 'write.companies.archive-property-in-use')
      expect(inUse?.status).toBe('not-applicable')
      expect(inUse?.reason).toContain(`answered ${status} VALIDATION_ERROR`)
      expect(inUse?.reason).toContain(
        'whether the API archive of an in-use property is refused stays open: the run archives only its own properties, which nothing else uses',
      )
      const limit = 'GET /crm/limits/2026-09/custom-properties'
      expect(results.find((c) => c.id === 'read.scopes')).toMatchObject({
        status: 'pass',
        note: `403 only where the declared scopes do not reach: ${limit}`,
        // The field checks' sensitive create answers 403 too, since the simulated key holds no sensitive scope.
        facts: { forbidden: [limit, `POST ${COMPANIES}`] },
      })
      const { prefix } = manifestOf(dir)
      expect(sim.object(portalId, 'companies').properties.get(`${prefix}used`)?.archived).toBe(true)
      expect(evidenceOf(dir).cleanup.complete).toBe(true)
    },
    120_000,
  )

  test('--scopes names the sensitive write scope but the create answers 403: the read uses a portal property, and read.scopes passes', async () => {
    const scopes = 'crm.schemas.companies.read,crm.schemas.companies.write,crm.objects.companies.sensitive.write'
    const sim = createPortalSim([crowdedPortal({ scopes: { KALUP_CONFORMANCE_KEY: scopes.split(',') } })])
    const refusing = (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
      const path = new URL(String(input)).pathname
      if (init.method === 'POST' && path === COMPANIES && String(init.body).includes('"dataSensitivity":"sensitive"')) {
        const body = { status: 'error', category: 'MISSING_SCOPES', message: 'This key lacks a sensitive data scope' }
        return Promise.resolve(new Response(JSON.stringify(body), { status: 403 }))
      }
      return sim.fetch(input, init)
    }
    const dir = work()
    const out = await run(simulated(dir, '--scopes', scopes), refusing)
    expect(out.code, out.stderr).toBe(0)
    const { checks: results } = evidenceOf(dir)
    expect(results.find((c) => c.id === 'read.sensitive-property-without-sensitivity')).toMatchObject({
      status: 'pass',
      facts: { runProperty: false, why: "the run's sensitive property create answered 403 MISSING_SCOPES" },
    })
    expect(results.find((c) => c.id === 'read.scopes')).toMatchObject({
      status: 'pass',
      facts: { forbidden: [`POST ${COMPANIES}`] },
    })
    expect(evidenceOf(dir).cleanup.complete).toBe(true)
  }, 120_000)

  test('a portal that archives a property in use, unlike the one observed: a finding with the facts, and cleanup completes', async () => {
    const sim = createPortalSim([crowdedPortal()])
    // HubSpot stops guarding the use: the formula no longer counts when the property it names is archived.
    const unguarded = (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
      const path = new URL(String(input)).pathname
      const calculation = [...sim.object(portalId, 'companies').properties.values()].find((p) =>
        p.name.endsWith('_uses'),
      )
      if (init.method === 'DELETE' && path.endsWith('_used') && calculation) {
        const { calculationFormula: _, ...rest } = calculation
        sim.object(portalId, 'companies').properties.set(calculation.name, { ...rest })
      }
      return sim.fetch(input, init)
    }
    const dir = work()
    const out = await run(simulated(dir), unguarded)
    expect(out.code, out.stderr).toBe(1)
    const evidence = evidenceOf(dir)
    expect(evidence.checks.filter((c) => c.status === 'fail').map((c) => c.id)).toEqual([
      'write.companies.archive-property-in-use',
    ])
    expect(evidence.checks.find((c) => c.id === 'write.companies.archive-property-in-use')?.facts).toMatchObject({
      status: 204,
      used: 'archived',
      calculation: 'active',
    })
    expect(evidence.cleanup.complete).toBe(true)
  }, 120_000)

  test('a second key of another portal refuses the run before any write', async () => {
    const sim = createPortalSim([
      crowdedPortal({ keys: { KALUP_CONFORMANCE_KEY: simulate.SIMULATED_KEY } }),
      {
        ...simulate.simulatedPortal(otherPortal),
        keys: { KALUP_CONFORMANCE_LIMITED_KEY: simulate.SIMULATED_LIMITED_KEY },
      },
    ])
    const dir = work()
    const out = await run(simulated(dir), sim.fetch)
    expect(out.code).toBe(2)
    expect(out.stderr).toContain('E_PORTAL_MISMATCH: the key in KALUP_CONFORMANCE_LIMITED_KEY')
    expect(sim.log.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /account-info/2026-09/details',
      'GET /account-info/2026-09/details',
    ])
    expect(existsSync(join(dir, 'manifest.json'))).toBe(false)
  })

  test('a second key HubSpot does not accept: the check fails, and nothing but account-info goes out with it', async () => {
    const sim = createPortalSim([crowdedPortal({ keys: { KALUP_CONFORMANCE_KEY: simulate.SIMULATED_KEY } })])
    const dir = work()
    const out = await run(simulated(dir), sim.fetch)
    expect(out.code, out.stderr).toBe(1)
    const evidence = evidenceOf(dir)
    expect(evidence.checks.filter((c) => c.status === 'fail').map((c) => c.id)).toEqual([
      'write.companies.missing-write-scope',
    ])
    expect(sim.log.filter((r) => r.key === null).map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /account-info/2026-09/details',
    ])
    expect(evidence.cleanup.complete).toBe(true)
  }, 120_000)
})

describe('the delete a person confirms at a terminal', () => {
  test('skip typed at the terminal: not applicable, after the runner printed the command', async () => {
    const sim = createPortalSim([crowdedPortal()])
    const dir = work()
    const away = () => Promise.resolve()
    const out = await run(simulated(dir), sim.fetch, {}, { stdin: tty('skip'), person: away, sleep: yielding })
    expect(out.code, out.stderr).toBe(0)
    expect(out.stdout).toContain("dist/index.mjs' apply delete-plan.json")
    expect(evidenceOf(dir).checks.find((c) => c.id === 'cli.delete-at-terminal')).toMatchObject({
      status: 'not-applicable',
      reason: 'skipped by the person at the terminal',
    })
  }, 120_000)

  test('no delete before the deadline: the check fails, and state keeps the entry', async () => {
    const sim = createPortalSim([crowdedPortal()])
    const dir = work()
    const away = () => Promise.resolve()
    const out = await run(simulated(dir), sim.fetch, {}, { stdin: tty(), person: away })
    expect(out.code, out.stderr).toBe(1)
    const evidence = evidenceOf(dir)
    expect(evidence.checks.filter((c) => c.status !== 'pass').map((c) => c.id)).toEqual(['cli.delete-at-terminal'])
    expect(evidence.checks.find((c) => c.id === 'cli.delete-at-terminal')).toMatchObject({
      note: 'not archived in time',
      facts: { archived: false, stateDropped: false },
    })
    expect(evidence.cleanup.complete).toBe(true)
  }, 120_000)
})

test('node scripts/conformance/run.mjs --simulate loads the simulator itself and runs every check', () => {
  const dir = work()
  const script = fileURLToPath(new URL('run.mjs', scripts))
  const out = spawnSync(process.execPath, [script, ...simulated(dir)], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH },
  })
  expect(out.status, out.stderr).toBe(0)
  expect(out.stdout).toContain(' 0 fail, 1 not applicable')
  expect(evidenceOf(dir)).toMatchObject({ mode: 'simulate', cleanup: { complete: true } })
  expect(existsSync(join(dir, 'simulator', 'portal-sim.mjs'))).toBe(true)
}, 120_000)

test("the runner's create bodies and option lists are apply's, and its normalizer is pull's", () => {
  const group = 'kalupconf_ab12cd34_group'
  for (const body of [
    checks.textBody('kalupconf_ab12cd34_text', group),
    checks.choiceBody('kalupconf_ab12cd34_choice', group),
    ...Object.values(fieldModule.fieldBodies('kalupconf_ab12cd34_', group)),
  ]) {
    const { name, groupName, options, ...fields } = body
    const desired = {
      ...fields,
      group: { $ref: `group:companies/${group}` },
      ...(Array.isArray(options)
        ? {
            options: (options as Body[]).map(({ displayOrder: _, hidden, ...option }) => ({
              ...option,
              ...(hidden ? { hidden } : {}),
            })),
          }
        : {}),
    }
    expect(
      createBody({ address: `property:companies/${String(name)}`, desired }, { name: String(name), group }),
    ).toEqual(body)
  }
  const raws: RawProperty[] = [
    {
      name: 'orchard_notes',
      label: 'Orchard notes',
      type: 'string',
      fieldType: 'textarea',
      groupName: 'orchard',
      description: '',
    },
    {
      name: 'harvest_band',
      label: 'Harvest band',
      type: 'enumeration',
      fieldType: 'radio',
      groupName: 'orchard',
      description: 'Band by week',
      hasUniqueValue: true,
      formField: true,
      options: [
        { value: 'late', label: 'Late', displayOrder: -1, hidden: false },
        { value: 'early', label: 'Early', displayOrder: 2, hidden: true, description: 'Before week 30' },
        { value: 'mid', label: 'Mid', displayOrder: 0, hidden: false, description: '' },
        { value: 'unsorted', label: 'Unsorted' },
      ],
    },
  ]
  for (const raw of raws) {
    const [live] = normalizeProperties('companies', [raw], []).properties
    expect(checks.normalizeProperty(raw as unknown as Body)).toEqual({ type: raw.type, ...live?.definition })
    expect(checks.optionInputs(raw.options)).toEqual(optionsPatch([], raw.options ?? []))
  }
})

test('the runner pins the version of every API family the registry sends to', () => {
  for (const row of Object.values(registry)) {
    expect(runner.API_PINS[row.family], row.family).toBe(row.version)
  }
})
