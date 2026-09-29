// The onboarding guides on the website, replayed. Each guide's sh blocks run in order, in one project, against the
// stateful HubSpot simulator, and every `npx --no-install kalup` line must exit as the guide says: 0, or N when its
// comment says `exit N`. A line that needs a person at a terminal or a CI job (`# at a terminal`, `# in CI`) is checked
// for parsing only: run with --json, it must not be a usage error. A terminal apply of a saved plan is then confirmed as the person
// would, typing the target name, so the lines after it see its writes. What happens between the commands, the file
// edits a guide describes and the edits someone makes in the HubSpot UI, is scripted per guide below, keyed by the
// command it comes before. The config and object snippets the guides show are the ones written. Nothing reaches the
// network.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plan } from '@kalup/core'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { cli, parseEnvelope } from '../src/commands/testing.js'
import { onFakeTime, terminal } from './scenarios/harness.js'
import { createPortalSim, fault, type PortalSim, type SimPortalInput } from './support/portal-sim.js'

const guides = fileURLToPath(new URL('../../../apps/web/content/docs/guides/', import.meta.url))
const KEYS = [
  'HUBSPOT_SERVICE_KEY',
  'HUBSPOT_SANDBOX_KEY',
  'HUBSPOT_PROD_READ_KEY',
  'HUBSPOT_PROD_WRITE_KEY',
  'HUBSPOT_PROD_KEY',
]
const sandboxKey = 'guide-sandbox-key-4b1e'
const productionKey = 'guide-production-key-90c2'
const productionWriteKey = 'guide-production-write-key-d57a'

beforeEach(() => {
  vi.stubEnv('KALUP_LOCK_DIR', mkdtempSync(join(tmpdir(), 'kalup-guide-locks-')))
  vi.stubEnv('KALUP_STATE_DIR', undefined)
  vi.stubEnv('CI', undefined)
  // The guides put keys in .env, so none may come from the environment the tests run in.
  for (const key of KEYS) {
    vi.stubEnv(key, undefined)
  }
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

interface Command {
  argv: string[]
  exit: number
  /** The command without `npx --no-install kalup` and its comment, then ` (n)` from its second occurrence on. */
  key: string
  line: string
  needs: 'nothing' | 'terminal' | 'ci'
}

const SH_BLOCK = /^```sh[^\n]*\n([\s\S]*?)^```$/gm
const TITLED_BLOCK = /^```\w+ title="([^"]+)"\n([\s\S]*?)^```$/gm
const CONTINUED = /\\\n\s*/g
const WORD = /'[^']*'|"[^"]*"|\S+/g
const QUOTED = /^(['"])(.*)\1$/
const EXIT = /\bexit (\d)\b/
const RENEWAL_DATE = /renewal_date$/

/** Throws unless `ok`. The helpers below run outside a test body, so they throw instead of calling expect. */
function check(ok: boolean, message: string): void {
  if (!ok) {
    throw new Error(message)
  }
}

/** What a line needs, from its comment. */
function needsOf(comment: string): Command['needs'] {
  if (comment.includes('at a terminal')) {
    return 'terminal'
  }
  return comment.includes('in CI') ? 'ci' : 'nothing'
}

function page(name: string): string {
  return readFileSync(join(guides, name), 'utf8')
}

/** Every kalup line of the page's sh blocks, in order. */
function commands(name: string): Command[] {
  const seen = new Map<string, number>()
  const lines = [...page(name).matchAll(SH_BLOCK)].flatMap((m) => (m[1] ?? '').replace(CONTINUED, ' ').split('\n'))
  return lines.flatMap((line) => {
    const words = line.match(WORD) ?? []
    const hash = words.findIndex((word) => word.startsWith('#'))
    const code = (hash === -1 ? words : words.slice(0, hash)).map((word) => word.replace(QUOTED, '$2'))
    const comment = hash === -1 ? '' : words.slice(hash).join(' ')
    const [bin, ...argv] = code[0] === 'npx' ? code.slice(code[1] === '--no-install' ? 2 : 1) : code
    if (bin !== 'kalup') {
      return []
    }
    const command = argv.join(' ')
    const n = (seen.get(command) ?? 0) + 1
    seen.set(command, n)
    const exit = Number(EXIT.exec(comment)?.[1] ?? 0)
    return [{ argv, exit, key: n === 1 ? command : `${command} (${n})`, line: line.trim(), needs: needsOf(comment) }]
  })
}

/** The body of the nth code block with this title on the page. */
function block(name: string, title: string, n = 1): string {
  const body = [...page(name).matchAll(TITLED_BLOCK)].filter((m) => m[1] === title)[n - 1]?.[2]
  if (body === undefined) {
    throw new Error(`${name} has no block titled ${title} (${n})`)
  }
  return body
}

interface World {
  /** Where the guide's commands run. */
  cwd: string
  sim: PortalSim
}

interface Guide {
  /** What happens before a command, keyed as Command.key. */
  before: Record<string, (world: World) => void | Promise<void>>
  name: string
  /** Text a command must print, keyed as Command.key. */
  says: Record<string, string>
  world: () => World
}

/** A simulator over these portals, serving global fetch. */
function portals(...inputs: SimPortalInput[]): PortalSim {
  const sim = createPortalSim(inputs)
  vi.stubGlobal('fetch', sim.fetch)
  return sim
}

function project(dir: string, env: Record<string, string>): string {
  mkdirSync(dir, { recursive: true })
  writeEnv(dir, env)
  return dir
}

function writeEnv(dir: string, env: Record<string, string>): void {
  const lines = Object.entries(env).map(([name, value]) => `${name}=${value}\n`)
  writeFileSync(join(dir, '.env'), lines.join(''))
}

/** Replaces `from` in a project file, which must hold it. */
function edit(dir: string, file: string, from: string | RegExp, to: string): void {
  const path = join(dir, file)
  const text = readFileSync(path, 'utf8')
  const next = text.replace(from, to)
  if (next === text) {
    throw new Error(`${file}: nothing matched ${from}`)
  }
  writeFileSync(path, next)
}

// The entries of the only export's properties block, and the end of that block.
const PROPERTY_ENTRIES = /(\n {2}properties: \{\n)[\s\S]*?(\n {2}\},\n\}\))/
const PROPERTIES_END = /(\n {2}\},\n\}\))/
const PRODUCTION_TARGET = /^ {4}production: \{\n[\s\S]*?^ {4}\},\n/m

/** An edit made in the HubSpot UI: a property's label changes. */
function relabel(sim: PortalSim, portalId: number, objectType: string, name: string, label: string): void {
  const property = sim.object(portalId, objectType).properties.get(name)
  if (!property) {
    throw new Error(`portal ${portalId} holds no property ${name}`)
  }
  property.label = label
}

/** The answers a person gives an apply of this plan file: the target name, and the destructive count when asked. */
function answers(cwd: string, file: string): string[] {
  const plan = JSON.parse(readFileSync(join(cwd, file), 'utf8')) as Plan
  const destructive = plan.steps.filter((step) => step.risk === 'destructive').length
  return destructive === 0 ? [plan.target.name] : [plan.target.name, String(destructive)]
}

/** A line that needs a person or CI must at least parse: with --json, no E_USAGE. */
async function parses(world: World, command: Command): Promise<void> {
  const argv = command.argv.includes('--json') ? command.argv : [...command.argv, '--json']
  const out = await cli(world.cwd, ...argv)
  const codes = parseEnvelope(out.stdout).issues.map((issue) => issue.code)
  check(!codes.includes('E_USAGE'), `${command.line} is a usage error\n${out.stdout}`)
}

/** Runs a line as the guide means it; undefined for a line only checked for parsing. */
function run(world: World, command: Command) {
  const [verb, file] = command.argv
  if (command.needs === 'nothing') {
    return cli(world.cwd, ...command.argv)
  }
  if (command.needs === 'terminal' && verb === 'apply' && file?.endsWith('.json')) {
    return cli(terminal(world.cwd, ...answers(world.cwd, file)), ...command.argv)
  }
  return undefined
}

async function replay(guide: Guide): Promise<void> {
  const world = guide.world()
  const lines = commands(guide.name)
  const keys = lines.map((command) => command.key)
  for (const key of [...Object.keys(guide.before), ...Object.keys(guide.says)]) {
    check(keys.includes(key), `${guide.name} has no line ${key}`)
  }
  // The guide's lines run one after another, as a person types them.
  await lines.reduce(async (previous, command) => {
    await previous
    await guide.before[command.key]?.(world)
    if (command.needs !== 'nothing') {
      await parses(world, command)
    }
    const out = await run(world, command)
    if (out !== undefined) {
      const printed = `${out.stdout}${out.stderr}`
      const says = guide.says[command.key] ?? ''
      check(out.exitCode === command.exit, `${guide.name}: ${command.line} exited ${out.exitCode}\n${printed}`)
      check(printed.includes(says), `${guide.name}: ${command.line} did not print ${says}\n${printed}`)
    }
  }, Promise.resolve())
}

const COMPANIES = 'kalup/objects/companies.ts'
const DEALS = 'kalup/objects/deals.ts'
const CONFIG = 'kalup.config.ts'

// HubSpot's own company name, and a billing group with a billing status: what the invented portals start with.
function companies(extra = false): NonNullable<SimPortalInput['objects']>[string] {
  const option = (value: string, label: string, displayOrder: number) => ({ value, label, displayOrder, hidden: false })
  return {
    groups: [
      { name: 'companyinformation', label: 'Company information' },
      { name: 'billing', label: 'Billing' },
    ],
    properties: [
      {
        name: 'name',
        label: 'Company name',
        type: 'string',
        fieldType: 'text',
        groupName: 'companyinformation',
        hubspotDefined: true,
      },
      {
        name: 'billing_status',
        label: 'Billing status',
        type: 'enumeration',
        fieldType: 'select',
        groupName: 'billing',
        options: [
          option('active', 'Active', 0),
          option('past_due', 'Past due', 1),
          ...(extra ? [option('paused', 'Paused', 2)] : []),
        ],
      },
      ...(extra
        ? [{ name: 'seat_count', label: 'Seat count', type: 'number', fieldType: 'number', groupName: 'billing' }]
        : []),
    ],
  }
}

function deals(): NonNullable<SimPortalInput['objects']>[string] {
  return {
    groups: [{ name: 'dealinformation', label: 'Deal information' }],
    properties: [
      {
        name: 'dealname',
        label: 'Deal name',
        type: 'string',
        fieldType: 'text',
        groupName: 'dealinformation',
        hubspotDefined: true,
      },
    ],
  }
}

const onePortal: Guide = {
  name: 'one-portal.mdx',
  world: () => ({
    sim: portals({
      portalId: 1_111_111,
      accountType: 'STANDARD',
      keys: { HUBSPOT_SERVICE_KEY: productionKey },
      objects: { companies: companies() },
    }),
    cwd: project(mkdtempSync(join(tmpdir(), 'kalup-guide-')), { HUBSPOT_SERVICE_KEY: productionKey }),
  }),
  before: {
    // The change the guide shows: its snippet replaces the pulled properties.
    validate: ({ cwd }) =>
      edit(cwd, COMPANIES, PROPERTY_ENTRIES, `$1${block('one-portal.mdx', COMPANIES).trimEnd()}$2`),
    plan: ({ sim }) => relabel(sim, 1_111_111, 'companies', 'billing_status', 'Customer status'),
    // Pull took the portal's label; the colleague edits it again, so there is drift to take config's side of.
    'plan --take config property:companies/billing_status#label --out plan.json': ({ sim }) =>
      relabel(sim, 1_111_111, 'companies', 'billing_status', 'Client status'),
    // Both sides change the label: a conflict.
    'pull --accept property:companies/billing_status#label': ({ cwd, sim }) => {
      edit(cwd, COMPANIES, "label: 'Customer status'", "label: 'Account status'")
      relabel(sim, 1_111_111, 'companies', 'billing_status', 'Client status')
    },
    // An apply whose write gets no answer: sent once, never settled, so the run is uncertain and exits 5.
    status: async ({ cwd, sim }) => {
      edit(cwd, COMPANIES, "label: 'Renewal date'", "label: 'Renewal due'")
      check((await cli(cwd, 'plan', '--out', 'plan.json')).exitCode === 0, 'the plan before the cut-off apply failed')
      sim.fault({ method: 'PATCH', path: RENEWAL_DATE, occurrence: 1, action: fault.throw() })
      const cut = await onFakeTime(() => cli(terminal(cwd, 'production'), 'apply', 'plan.json'))
      vi.useRealTimers()
      check(cut.exitCode === 5, `the cut-off apply exited ${cut.exitCode}\n${cut.stderr}`)
    },
  },
  says: {
    'plan --out plan.json': 's2 safe Adopt property "Billing status" (billing_status) on companies',
    'plan --out plan.json (2)': 's2 safe Create property "Renewal date" (renewal_date) on companies',
    plan: 'held label: config "Account status", portal "Customer status"',
    'plan --take config property:companies/billing_status#label --out plan.json': '[reverts-ui-edit]',
    'plan --out plan.json (3)': 'W_UNFINISHED_APPLY',
  },
}

const severalPortals: Guide = {
  name: 'several-portals.mdx',
  world: () => ({
    sim: portals(
      {
        portalId: 1_111_111,
        accountType: 'SANDBOX',
        keys: { HUBSPOT_SERVICE_KEY: sandboxKey, HUBSPOT_SANDBOX_KEY: sandboxKey },
        objects: { companies: companies(true), deals: deals() },
      },
      {
        portalId: 2_222_222,
        accountType: 'STANDARD',
        keys: { HUBSPOT_PROD_READ_KEY: productionKey, HUBSPOT_PROD_WRITE_KEY: productionWriteKey },
        objects: { companies: companies(), deals: deals() },
      },
    ),
    cwd: project(mkdtempSync(join(tmpdir(), 'kalup-guide-')), { HUBSPOT_SERVICE_KEY: sandboxKey }),
  }),
  before: {
    status: ({ cwd }) => {
      writeFileSync(join(cwd, CONFIG), block('several-portals.mdx', CONFIG))
      writeEnv(cwd, { HUBSPOT_SANDBOX_KEY: sandboxKey, HUBSPOT_PROD_READ_KEY: productionKey })
    },
    'compare snapshots/production-2026-09-28.json production': ({ sim }) =>
      relabel(sim, 2_222_222, 'companies', 'billing_status', 'Account status'),
    plan: ({ cwd }) => edit(cwd, COMPANIES, PROPERTIES_END, `\n${block('several-portals.mdx', COMPANIES).trimEnd()}$1`),
    // A colleague relabels the sandbox's property in the HubSpot UI: drift, held.
    'plan (2)': ({ sim }) => relabel(sim, 1_111_111, 'companies', 'billing_status', 'Account status'),
    // Pull took the portal's label; the colleague edits it again, so there is drift to take config's side of.
    'plan --take config property:companies/billing_status#label --out plan.json': ({ sim }) =>
      relabel(sim, 1_111_111, 'companies', 'billing_status', 'Client status'),
    // An apply whose write gets no answer: sent once, never settled, so the run is uncertain and exits 5.
    'status (2)': async ({ cwd, sim }) => {
      edit(cwd, COMPANIES, "label: 'Renewal date'", "label: 'Renewal due'")
      check((await cli(cwd, 'plan', '--out', 'plan.json')).exitCode === 0, 'the plan before the cut-off apply failed')
      sim.fault({ method: 'PATCH', path: RENEWAL_DATE, occurrence: 1, action: fault.throw() })
      const cut = await onFakeTime(() => cli(cwd, 'apply', 'plan.json', '--yes'))
      vi.useRealTimers()
      check(cut.exitCode === 5, `the cut-off apply exited ${cut.exitCode}\n${cut.stderr}`)
    },
  },
  says: {
    'compare sandbox production': 'only in a: property:companies/seat_count',
    'compare snapshots/production-2026-09-28.json production': 'held label: a "Billing status", b "Account status"',
    'apply --yes': 'done Create property "Renewal date" (renewal_date) on companies',
    'plan --target production': 'Create property "Renewal date" (renewal_date) on companies',
    'plan (2)': `held label: config "Billing status", portal "Account status". Take the portal side: kalup pull --target sandbox --only property:companies/billing_status; take config: kalup plan --target sandbox --take config 'property:companies/billing_status#label'`,
    'apply --yes (2)': 'Record the agreed values of property "Account status" (billing_status) on companies',
    'plan --take config property:companies/billing_status#label --out plan.json': '[reverts-ui-edit]',
    'plan --out plan.json': 'W_UNFINISHED_APPLY',
  },
}

const AGENCY = 'blueprints-for-agencies.mdx'

/** The agency's workspace: the blueprints beside the client repository the commands run in. */
function agencyWorld(): World {
  const workspace = mkdtempSync(join(tmpdir(), 'kalup-guide-agency-'))
  const first = block(AGENCY, 'blueprints/renewals-1.0.0.json')
  // 2.0.0 as the guide describes it: the date label renamed, a Paused option added.
  const second = JSON.parse(first) as {
    version: string
    resources: Partial<Record<string, { definition: { label: string; options?: { value: string; label: string }[] } }>>
  }
  second.version = '2.0.0'
  const date = second.resources['property:deals/renewal_date']
  const stage = second.resources['property:deals/renewal_stage']
  if (!(date && stage?.definition.options)) {
    throw new Error('the guide changed the blueprint this replay upgrades')
  }
  date.definition.label = 'Renewal due date'
  stage.definition.options.push({ value: 'paused', label: 'Paused' })
  mkdirSync(join(workspace, 'blueprints'))
  writeFileSync(join(workspace, 'blueprints', 'renewals-1.0.0.json'), first)
  writeFileSync(join(workspace, 'blueprints', 'renewals-2.0.0.json'), `${JSON.stringify(second, null, 2)}\n`)
  return {
    sim: portals(
      {
        portalId: 1_111_111,
        accountType: 'SANDBOX',
        keys: { HUBSPOT_SERVICE_KEY: sandboxKey, HUBSPOT_SANDBOX_KEY: sandboxKey },
        objects: { deals: deals() },
      },
      {
        portalId: 2_222_222,
        accountType: 'STANDARD',
        keys: { HUBSPOT_PROD_KEY: productionKey },
        objects: { deals: deals() },
      },
    ),
    cwd: project(join(workspace, 'quarry'), { HUBSPOT_SERVICE_KEY: sandboxKey }),
  }
}

const agency: Guide = {
  name: AGENCY,
  world: agencyWorld,
  before: {
    'add ../blueprints/renewals-1.0.0.json --dry-run': ({ cwd }) => {
      writeFileSync(join(cwd, CONFIG), block(AGENCY, CONFIG))
      writeEnv(cwd, { HUBSPOT_SANDBOX_KEY: sandboxKey, HUBSPOT_PROD_KEY: productionKey })
    },
    // Quarry renames the date label for all its portals, and gives production its own stage label.
    'plan --out plan.json (2)': ({ cwd }) => {
      edit(cwd, DEALS, "label: 'Renewal date'", "label: 'Contract end'")
      edit(cwd, CONFIG, PRODUCTION_TARGET, block(AGENCY, CONFIG, 2))
    },
    // The client's admin relabels the property in production's HubSpot UI: drift, held.
    'plan --target production': ({ sim }) => relabel(sim, 2_222_222, 'deals', 'renewal_date', 'Renewal deadline'),
    // Pull took the client's label; the admin edits it again, so there is drift to take config's side of.
    'plan --target production --take config property:deals/renewal_date#label --out plan.json': ({ sim }) =>
      relabel(sim, 2_222_222, 'deals', 'renewal_date', 'Renewal cutoff'),
    // An apply whose write gets no answer: sent once, never settled, so the run is uncertain and exits 5.
    status: async ({ cwd, sim }) => {
      edit(cwd, DEALS, "label: 'Renewal deadline'", "label: 'Renewal by'")
      const planned = await cli(cwd, 'plan', '--target', 'production', '--out', 'plan.json')
      check(planned.exitCode === 0, 'the plan before the cut-off apply failed')
      sim.fault({ method: 'PATCH', path: RENEWAL_DATE, occurrence: 1, action: fault.throw() })
      const cut = await onFakeTime(() => cli(terminal(cwd, 'production'), 'apply', 'plan.json'))
      vi.useRealTimers()
      check(cut.exitCode === 5, `the cut-off apply exited ${cut.exitCode}\n${cut.stderr}`)
    },
  },
  says: {
    'plan --out plan.json (2)': 'Update property "Contract end" (renewal_date) on deals, set label',
    'plan --target production --out plan.json (2)':
      'Update property "Renewal status" (renewal_stage) on deals, set label',
    'blueprint upgrade acme/renewals ../blueprints/renewals-2.0.0.json':
      'conflict, config kept: property:deals/renewal_date',
    'plan --out plan.json (3)': 'Update property "Renewal due date" (renewal_date) on deals, set label',
    'plan --target production --out plan.json (3)': 'add options "Paused"',
    'plan --target production': 'held label: config "Renewal due date", portal "Renewal deadline"',
    'plan --target production --out plan.json (4)':
      'Record the agreed values of property "Renewal deadline" (renewal_date) on deals',
    'plan --target production --take config property:deals/renewal_date#label --out plan.json': '[reverts-ui-edit]',
    'plan --target production --out plan.json (5)': 'W_UNFINISHED_APPLY',
  },
}

test('one-portal.mdx: every kalup line runs as the guide says, a UI edit is held, and an apply cut off is recovered by a new plan', async () => {
  await replay(onePortal)
}, 30_000)

test('several-portals.mdx: every kalup line runs as the guide says, a UI edit is held and taken both ways, an apply cut off is recovered, and the CI lines parse', async () => {
  await replay(severalPortals)
}, 30_000)

test('blueprints-for-agencies.mdx: every kalup line runs as the guide says, through an upgrade with a conflict and a production override, a UI edit taken both ways and an apply cut off', async () => {
  await replay(agency)
}, 30_000)

test('each guide marks the lines that need a person or CI, and reads its exit codes from the comments', () => {
  expect(commands('one-portal.mdx').filter((c) => c.needs === 'terminal')).toHaveLength(5)
  const ci = commands('several-portals.mdx').filter((c) => c.needs === 'ci')
  expect(ci.map((c) => c.argv)).toEqual([
    ['plan', '--target', 'production', '--out', 'plan.json'],
    ['apply', 'plan.json', '--approve', '$REVIEWED_HASH'],
  ])
  expect(commands('several-portals.mdx').find((c) => c.key === 'compare sandbox production --exit-code')?.exit).toBe(2)
})
