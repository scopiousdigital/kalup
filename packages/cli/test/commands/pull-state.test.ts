// kalup pull with a base, through the built host against the stateful simulator: the project is applied
// first, so state owns its resources with a base, then HubSpot and config are edited on either side. Pull reads state
// and never writes it. Every resolve.portal command a plan prints is run, and must leave its unit converged.
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Change, Plan } from '@kalup/engine'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createPortalSim, fault, type PortalSim } from '../../../engine/test/support/portal-sim.js'
import { fixture } from '../../../engine/test/support/testing.js'
import type { PullData } from '../../src/commands/pull.js'
import { cli, copy, parseEnvelope } from '../../src/commands/testing.js'
import { printed } from '../support/printed.js'
import { edit } from './orchard.js'

const key = 'kalup-pull-state-7d41'
const portalId = 1_111_111
const soilPh = 'property:companies/soil_ph'
const soilType = 'property:companies/soil_type'
const orchard = 'group:companies/orchard'
const objects = 'kalup/objects/companies.ts'
const statePath = join('.kalup', 'state', `portal-${portalId}.json`)

const SOIL_TYPE = `    soilType: p.enum('soil_type', {
      label: 'Soil type',
      group: 'orchard',
      fieldType: 'select',
      options: [
        { value: 'clay', label: 'Clay' },
        { value: 'loam', label: 'Loam' },
        { value: 'sand', label: 'Sand' },
      ],
    }),
`

beforeEach(() => {
  vi.stubEnv('KALUP_LOCK_DIR', mkdtempSync(join(tmpdir(), 'kalup-locks-')))
  vi.stubEnv('KALUP_STATE_DIR', undefined)
  vi.stubEnv('HUBSPOT_SANDBOX_KEY', key)
  vi.stubEnv('CI', undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function text(dir: string, file: string): string {
  return readFileSync(join(dir, file), 'utf8')
}

function sim(): PortalSim {
  const portal = createPortalSim([
    { portalId, keys: { HUBSPOT_SANDBOX_KEY: key }, objects: { companies: { groups: [], properties: [] } } },
  ])
  vi.stubGlobal('fetch', portal.fetch)
  return portal
}

/**
 * The apply project with soil_type and any `extra` properties and groups, applied: state owns every group and property
 * with a full base.
 */
async function applied(portal: PortalSim, extra: { groups?: string; properties?: string } = {}): Promise<string> {
  const dir = copy('apply')
  const properties = `${SOIL_TYPE}${extra.properties ?? ''}`
  edit(dir, objects, "      fieldType: 'number',\n    }),\n", `      fieldType: 'number',\n    }),\n${properties}`)
  edit(
    dir,
    objects,
    "    orchard: { label: 'Orchard' },\n",
    `    orchard: { label: 'Orchard' },\n${extra.groups ?? ''}`,
  )
  const plan = await cli(dir, 'plan', '--out', 'plan.json')
  const out = await cli(dir, 'apply', 'plan.json', '--yes')
  if (plan.exitCode !== 0 || out.exitCode !== 0) {
    throw new Error(`the first apply failed: ${plan.stderr}${out.stderr}`)
  }
  portal.log.length = 0
  return dir
}

function group(portal: PortalSim, name: string) {
  const found = portal.object(portalId, 'companies').groups.get(name)
  if (!found) {
    throw new Error(`no group ${name}`)
  }
  return found
}

function live(portal: PortalSim, name: string) {
  const found = portal.object(portalId, 'companies').properties.get(name)
  if (!found) {
    throw new Error(`no ${name}`)
  }
  return found
}

async function pull(dir: string, ...flags: string[]) {
  const out = await cli(dir, 'pull', '--json', ...flags)
  const env = parseEnvelope<PullData>(out.stdout)
  return { ...out, env, changes: env.data?.objects.companies?.changes ?? [] }
}

async function planned(dir: string): Promise<Plan> {
  const out = await cli(dir, 'plan', '--json')
  if (out.exitCode !== 0) {
    throw new Error(`the plan failed: ${out.stdout}`)
  }
  return parseEnvelope<Plan>(out.stdout).data as Plan
}

function about(changes: Change[], address: string): Change[] {
  return changes.filter((c) => c.address === address)
}

test('drift: only HubSpot moved the unit, so pull takes the portal value; state is never written', async () => {
  const portal = sim()
  const dir = await applied(portal)
  const state = text(dir, statePath)
  live(portal, 'soil_ph').label = 'Soil acidity'
  const out = await pull(dir)
  expect(out.exitCode, out.stdout).toBe(0)
  expect(about(out.changes, soilPh)).toEqual([
    { kind: 'changed', address: soilPh, field: 'label', before: 'Soil pH', after: 'Soil acidity' },
  ])
  expect(text(dir, objects)).toContain("label: 'Soil acidity'")
  expect(text(dir, statePath)).toBe(state)
  expect(portal.writes()).toEqual([])
})

test('an explicit empty option list the file states is owned: pull with a base keeps it, and it is no difference', async () => {
  const portal = sim()
  const yieldBand = `    yieldBand: p.enum('yield_band', {
      label: 'Yield band',
      group: 'orchard',
      fieldType: 'select',
      options: [],
    }),
`
  const dir = await applied(portal, { properties: yieldBand })
  const before = text(dir, objects)
  const check = await pull(dir, '--check', '--exit-code')
  expect(check.exitCode, check.stdout).toBe(0)
  expect(check.env.data?.files).toEqual([])
  const out = await pull(dir)
  expect(out.exitCode, out.stdout).toBe(0)
  expect(text(dir, objects)).toBe(before)
  expect(before).toContain('options: []')
})

test('a config change: only config moved the unit, so pull keeps the file and it is no difference', async () => {
  const portal = sim()
  const dir = await applied(portal)
  edit(dir, objects, "label: 'Soil pH'", "label: 'Soil pH (1 to 14)'")
  const check = await pull(dir, '--check', '--exit-code')
  expect(check.exitCode, check.stdout).toBe(0)
  expect(about(check.changes, soilPh)).toEqual([
    { kind: 'kept', address: soilPh, field: 'label', before: 'Soil pH (1 to 14)', after: 'Soil pH' },
  ])
  expect(check.env.data?.files).toEqual([])
  const human = await cli(dir, 'pull')
  expect(printed(human)).toMatchInlineSnapshot(`
    "Target sandbox, portal 1111111 (the only target)
    companies: 0 added, 0 changed, 3 unchanged, 0 missing in portal
      config change kept: property:companies/soil_ph#label config "Soil pH (1 to 14)", portal "Soil pH"; take the portal side: kalup pull --target sandbox --accept 'property:companies/soil_ph#label'
    Files are up to date
    "
  `)
  expect(text(dir, objects)).toContain("label: 'Soil pH (1 to 14)'")
})

test('a conflict: both sides moved the unit apart, so pull keeps the file, reports both and exits 2 on --check', async () => {
  const portal = sim()
  const dir = await applied(portal)
  edit(dir, objects, "label: 'Soil pH'", "label: 'Soil pH (1 to 14)'")
  live(portal, 'soil_ph').label = 'Soil acidity'
  group(portal, 'orchard').label = 'Orchards'
  edit(dir, objects, "orchard: { label: 'Orchard' }", "orchard: { label: 'Orchard trees' }")
  const check = await pull(dir, '--check', '--exit-code')
  expect(check.exitCode).toBe(2)
  expect(about(check.changes, soilPh)).toEqual([
    { kind: 'conflict', address: soilPh, field: 'label', before: 'Soil pH (1 to 14)', after: 'Soil acidity' },
  ])
  expect(about(check.changes, orchard)).toEqual([
    { kind: 'conflict', address: orchard, field: 'label', before: 'Orchard trees', after: 'Orchards' },
  ])
  expect((await pull(dir)).exitCode).toBe(0)
  expect(text(dir, objects)).toContain("label: 'Soil pH (1 to 14)'")
  expect(text(dir, objects)).toContain("orchard: { label: 'Orchard trees' }")
})

test("no base for the unit: today's rules, the portal wins", async () => {
  const portal = sim()
  const dir = await applied(portal)
  const state = JSON.parse(text(dir, statePath))
  const { label: _, ...base } = state.resources[soilPh].base
  state.resources[soilPh].base = base
  writeFileSync(join(dir, statePath), `${JSON.stringify(state)}\n`)
  edit(dir, objects, "label: 'Soil pH'", "label: 'Soil pH (1 to 14)'")
  const out = await pull(dir)
  expect(out.exitCode).toBe(0)
  expect(about(out.changes, soilPh)).toEqual([
    { kind: 'changed', address: soilPh, field: 'label', before: 'Soil pH (1 to 14)', after: 'Soil pH' },
  ])
  expect(text(dir, objects)).toContain("label: 'Soil pH',")
})

test('options with a base: one dropped from config stays dropped; one removed in HubSpot stays in the file', async () => {
  const portal = sim()
  const dir = await applied(portal)
  edit(dir, objects, "        { value: 'sand', label: 'Sand' },\n", '')
  const soil = live(portal, 'soil_type')
  soil.options = soil.options.filter((o) => o.value !== 'loam')
  const out = await pull(dir, '--check', '--exit-code')
  expect(about(out.changes, soilType)).toEqual([
    { kind: 'removed-in-hubspot', address: soilType, field: 'options[loam]' },
    { kind: 'kept', address: soilType, field: 'options[sand]', after: 'Sand' },
  ])
  // An option HubSpot removed is held drift, a difference; the dropped one is config's change.
  expect(out.exitCode).toBe(2)
  expect((await pull(dir)).exitCode).toBe(0)
  const file = text(dir, objects)
  expect(file).not.toContain("value: 'sand'")
  expect(file).toContain("{ value: 'loam', label: 'Loam' }")
})

test('options.order config changed: the file keeps its order; drift of the order takes the portal order', async () => {
  const portal = sim()
  const dir = await applied(portal)
  edit(
    dir,
    objects,
    "        { value: 'clay', label: 'Clay' },\n        { value: 'loam', label: 'Loam' },\n",
    "        { value: 'loam', label: 'Loam' },\n        { value: 'clay', label: 'Clay' },\n",
  )
  const kept = await pull(dir)
  expect(about(kept.changes, soilType)).toEqual([
    {
      kind: 'kept',
      address: soilType,
      field: 'options.order',
      before: ['loam', 'clay', 'sand'],
      after: ['clay', 'loam', 'sand'],
    },
  ])
  expect(text(dir, objects)).toContain("{ value: 'loam', label: 'Loam' },\n        { value: 'clay', label: 'Clay' },")
})

test('--accept takes the portal side of a conflict and of a config change, and pull never writes state', async () => {
  const portal = sim()
  const dir = await applied(portal)
  const state = text(dir, statePath)
  edit(dir, objects, "label: 'Soil pH'", "label: 'Soil pH (1 to 14)'")
  live(portal, 'soil_ph').label = 'Soil acidity'
  edit(dir, objects, "orchard: { label: 'Orchard' }", "orchard: { label: 'Orchard trees' }")
  const out = await pull(dir, '--accept', `${soilPh}#label`, '--accept', orchard)
  expect(out.exitCode, out.stdout).toBe(0)
  expect(about(out.changes, soilPh)).toEqual([
    { kind: 'changed', address: soilPh, field: 'label', before: 'Soil pH (1 to 14)', after: 'Soil acidity' },
  ])
  expect(about(out.changes, orchard)).toEqual([
    { kind: 'changed', address: orchard, field: 'label', before: 'Orchard trees', after: 'Orchard' },
  ])
  expect(text(dir, objects)).toContain("label: 'Soil acidity'")
  expect(text(dir, objects)).toContain("orchard: { label: 'Orchard' }")
  expect(text(dir, statePath)).toBe(state)
})

test('--accept drops an option HubSpot removed; a glob selector works as in --only', async () => {
  const portal = sim()
  const dir = await applied(portal)
  const soil = live(portal, 'soil_type')
  soil.options = soil.options.filter((o) => o.value !== 'loam')
  const out = await pull(dir, '--accept', 'property:companies/*')
  expect(out.exitCode, out.stdout).toBe(0)
  expect(about(out.changes, soilType)).toEqual([
    { kind: 'changed', address: soilType, field: 'options[loam]', before: 'Loam' },
  ])
  expect(text(dir, objects)).not.toContain("value: 'loam'")
})

test('an --accept selector that matches nothing is E_ACCEPT_UNMATCHED, exit 1, listing what pull keeps; nothing written', async () => {
  const portal = sim()
  const dir = await applied(portal)
  edit(dir, objects, "label: 'Soil pH'", "label: 'Soil pH (1 to 14)'")
  live(portal, 'soil_ph').label = 'Soil acidity'
  const before = text(dir, objects)
  const out = await pull(dir, '--accept', `${soilPh}#fieldType`)
  expect(out.exitCode).toBe(1)
  expect(out.env.issues).toEqual([
    {
      code: 'E_ACCEPT_UNMATCHED',
      message: expect.stringContaining(`pull keeps: ${soilPh}#label (conflict, config kept)`),
      fix: expect.stringContaining('kalup pull --target sandbox --check'),
      docs: 'errors/E_ACCEPT_UNMATCHED.md',
    },
  ])
  expect(text(dir, objects)).toBe(before)
  const bad = await pull(dir, '--accept', 'soil_ph')
  expect(bad.exitCode).toBe(1)
  expect(bad.env.issues[0]?.code).toBe('E_USAGE')
})

// A printed command as argv: words split on spaces, a single-quoted word taken whole.
function argv(command: string): string[] {
  const words = command.match(/'[^']*'|\S+/g) ?? []
  return words.map((w) => (w.startsWith("'") ? w.slice(1, -1) : w))
}

type Held = NonNullable<Plan['steps'][number]['held']>[number] & { address: string }

function heldOf(plan: Plan): Held[] {
  return plan.steps.flatMap((s) => (s.held ?? []).map((h) => ({ address: s.address, ...h })))
}

/**
 * Runs each held unit's resolve.portal command in its own copy of the project, against the same portal, then plans
 * again: the unit must be neither held nor written, and its step must list it in baseUnits, which apply records.
 */
async function resolved(dir: string, held: Held[]) {
  const runs = held.map(async (h) => {
    const command = h.resolve?.portal as string
    const copyDir = mkdtempSync(join(tmpdir(), 'kalup-resolve-'))
    cpSync(dir, copyDir, { recursive: true })
    const [, ...rest] = argv(command)
    const out = await cli(copyDir, ...rest)
    const step = (await planned(copyDir)).steps.find((s) => s.address === h.address)
    return {
      command,
      exitCode: out.exitCode,
      held: step?.held?.some((u) => u.unit === h.unit) ?? false,
      written: step?.changes?.some((c) => c.unit === h.unit) ?? false,
      recorded: step?.baseUnits?.includes(h.unit) ?? false,
    }
  })
  return await Promise.all(runs)
}

const converged = { exitCode: 0, held: false, written: false, recorded: true }

test('every resolve.portal command a plan prints leaves its unit converged when run', async () => {
  const portal = sim()
  const dir = await applied(portal)
  // Drift, a conflict, an option removed in HubSpot, and a diverged unit on an adoption.
  live(portal, 'soil_ph').label = 'Soil acidity'
  edit(dir, objects, "orchard: { label: 'Orchard' }", "orchard: { label: 'Orchard trees' }")
  group(portal, 'orchard').label = 'Orchards'
  const soil = live(portal, 'soil_type')
  soil.options = soil.options.filter((o) => o.value !== 'loam')
  soil.options = soil.options.map((o) => (o.value === 'clay' ? { ...o, label: 'Heavy clay' } : o))
  portal.object(portalId, 'companies').properties.set('soil_depth', {
    ...live(portal, 'soil_ph'),
    name: 'soil_depth',
    label: 'Depth',
  })
  edit(
    dir,
    objects,
    SOIL_TYPE,
    `${SOIL_TYPE}    soilDepth: p.number('soil_depth', {\n      label: 'Soil depth',\n      group: 'orchard',\n      fieldType: 'number',\n    }),\n`,
  )
  const plan = await planned(dir)
  const held = heldOf(plan)
  expect(held.map((h) => [h.address, h.unit, h.class])).toEqual([
    [orchard, 'label', 'conflict'],
    ['property:companies/soil_depth', 'label', 'diverged'],
    [soilPh, 'label', 'drift'],
    [soilType, 'options[clay].label', 'drift'],
    [soilType, 'options[loam]', 'drift'],
  ])
  expect(held.map((h) => h.resolve?.portal)).toEqual([
    `kalup pull --target sandbox --accept '${orchard}#label'`,
    'kalup pull --target sandbox --only property:companies/soil_depth',
    `kalup pull --target sandbox --only ${soilPh}`,
    `kalup pull --target sandbox --only ${soilType}`,
    `kalup pull --target sandbox --accept '${soilType}#options[loam]'`,
  ])
  for (const run of await resolved(dir, held)) {
    expect(run, run.command).toEqual({ command: run.command, ...converged })
  }
  expect(portal.writes()).toEqual([])
})

const SOIL_CLASS = `    soilClass: p.enum('soil_class', {
      label: 'Soil class',
      group: 'orchard',
      fieldType: 'select',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
        { value: 'c', label: 'C' },
      ],
    }),
`

/** Sets the portal's option order of one property, as a drag in the HubSpot UI would. */
function order(portal: PortalSim, name: string, values: string[]): void {
  const property = live(portal, name)
  property.options = values.map((value, displayOrder) => ({
    ...(property.options.find((o) => o.value === value) as (typeof property.options)[number]),
    displayOrder,
  }))
}

test('every resolve.portal command for option order and option label units converges too', async () => {
  const portal = sim()
  const dir = await applied(portal, { properties: SOIL_CLASS })
  // Order drift on soil_class; on soil_type an order conflict and a conflict on one option's label.
  order(portal, 'soil_class', ['c', 'b', 'a'])
  order(portal, 'soil_type', ['sand', 'clay', 'loam'])
  live(portal, 'soil_type').options = live(portal, 'soil_type').options.map((o) =>
    o.value === 'clay' ? { ...o, label: 'Heavy clay' } : o,
  )
  edit(
    dir,
    objects,
    "        { value: 'clay', label: 'Clay' },\n        { value: 'loam', label: 'Loam' },\n",
    "        { value: 'loam', label: 'Loam' },\n        { value: 'clay', label: 'Clay soil' },\n",
  )
  const held = heldOf(await planned(dir))
  expect(held.map((h) => [h.address, h.unit, h.class, h.resolve?.portal])).toEqual([
    [
      'property:companies/soil_class',
      'options.order',
      'drift',
      'kalup pull --target sandbox --only property:companies/soil_class',
    ],
    [soilType, 'options.order', 'conflict', `kalup pull --target sandbox --accept '${soilType}#options.order'`],
    [
      soilType,
      'options[clay].label',
      'conflict',
      `kalup pull --target sandbox --accept '${soilType}#options[clay].label'`,
    ],
  ])
  for (const run of await resolved(dir, held)) {
    expect(run, run.command).toEqual({ command: run.command, ...converged })
  }
  expect(portal.writes()).toEqual([])
})

test('no resolve.portal where no pull takes the portal side: outside the pull scope, or a fieldType of another builder', async () => {
  const portal = sim()
  const dir = await applied(portal)
  edit(dir, 'kalup.config.ts', 'companies: {},', 'companies: { custom: false },')
  live(portal, 'soil_ph').label = 'Soil acidity'
  const scoped = (await planned(dir)).steps.find((s) => s.address === soilPh)
  const scope = expect.stringContaining("add 'soil_ph' to objects.companies.include")
  expect(scoped?.held).toEqual([{ unit: 'label', class: 'drift', config: 'Soil pH', live: 'Soil acidity' }])
  expect(scoped?.notes).toEqual([{ unit: 'label', live: 'Soil acidity', note: scope }])
  const human = await cli(dir, 'plan')
  expect(printed(human)).toMatchInlineSnapshot(`
    "Target sandbox, portal 1111111 (the only target)
    Plan pl_<id> for target sandbox, portal 1111111 (SANDBOX, not protected)
    s1 safe No change to property "Soil pH" (soil_ph) on companies
      held label: config "Soil pH", portal "Soil acidity". No pull takes the portal side (see the note on label); take config: kalup plan --target sandbox --take config 'property:companies/soil_ph#label'
      note label: no pull refreshes it: it is outside the pull scope of companies; add 'soil_ph' to objects.companies.include in kalup.config.ts to take the portal side with pull
    1 safe, 0 risky, 0 destructive, 0 blocked, 0 manual; 1 held
    Coverage: complete; 0 unsupported, 0 excluded.
    About 0 API calls; 999964 left today.
    Not copied, HubSpot has no API: conditional property logic, field-level permissions.
    "
  `)
  // The omission is right: the pull a plan would otherwise print leaves the unit held.
  expect((await pull(dir, '--only', soilPh)).changes).toEqual([{ kind: 'out-of-scope', address: soilPh }])
  expect(heldOf(await planned(dir)).map((h) => h.unit)).toEqual(['label'])
  // Named in include, it is in scope, and the printed pull converges it.
  edit(dir, 'kalup.config.ts', 'companies: { custom: false },', "companies: { custom: false, include: ['soil_ph'] },")
  const included = heldOf(await planned(dir))
  expect(included.map((h) => h.resolve?.portal)).toEqual([`kalup pull --target sandbox --only ${soilPh}`])
  for (const run of await resolved(dir, included)) {
    expect(run, run.command).toEqual({ command: run.command, ...converged })
  }

  // A second project against the same portal, which adopts what the first created.
  live(portal, 'soil_ph').label = 'Soil pH'
  const other = await applied(portal)
  live(portal, 'soil_type').fieldType = 'checkbox'
  const codec = (await planned(other)).steps.find((s) => s.address === soilType)
  expect(codec?.held).toEqual([{ unit: 'fieldType', class: 'drift', config: 'select', live: 'checkbox' }])
  expect(codec?.notes).toEqual([
    {
      unit: 'fieldType',
      live: 'checkbox',
      note: expect.stringContaining('change the builder to p.multiEnum'),
    },
  ])
  const kept = await pull(other, '--only', soilType)
  expect(kept.env.issues.map((i) => i.code)).toEqual(['W_CODEC_MISMATCH'])
  expect(heldOf(await planned(other)).map((h) => h.unit)).toEqual(['fieldType'])
  expect(portal.writes()).toEqual([])
})

const DRAINAGE = `    drainage: p.string('drainage', {
      label: 'Drainage',
      group: 'beds',
      fieldType: 'text',
    }),
`

test('a group in kalup/removed.ts is never written back: a new portal property in it is left out, a moved one keeps its group', async () => {
  const portal = sim()
  const dir = await applied(portal, { groups: "    beds: { label: 'Beds' },\n", properties: DRAINAGE })
  // Each rm validates the project the one before left.
  expect((await cli(dir, 'rm', soilPh, '--release')).exitCode).toBe(0)
  expect((await cli(dir, 'rm', soilType, '--release')).exitCode).toBe(0)
  expect((await cli(dir, 'rm', orchard, '--release')).exitCode).toBe(0)
  // In HubSpot, people keep using the released group: a new property in it, and drainage moved into it.
  portal.object(portalId, 'companies').properties.set('soil_depth', {
    ...live(portal, 'soil_ph'),
    name: 'soil_depth',
    label: 'Soil depth',
  })
  live(portal, 'drainage').groupName = 'orchard'
  const drainage = 'property:companies/drainage'
  const check = await pull(dir, '--check', '--exit-code')
  expect(check.changes).toEqual([
    { kind: 'removed-group', address: drainage, field: 'group', before: 'beds', after: 'orchard' },
    { kind: 'removed-group', address: 'property:companies/soil_depth' },
    { kind: 'removed', address: soilPh },
    { kind: 'removed', address: soilType },
    { kind: 'removed', address: orchard },
  ])
  // HubSpot moved a config property where pull cannot follow: a difference.
  expect(check.exitCode, check.stdout).toBe(2)
  const human = await cli(dir, 'pull')
  expect(human.exitCode, human.stderr).toBe(0)
  expect(printed(human)).toMatchInlineSnapshot(`
    "Target sandbox, portal 1111111 (the only target)
    companies: 0 added, 0 changed, 2 unchanged, 0 missing in portal
      its group is in kalup/removed.ts, not written: property:companies/drainage#group "beds" -> "orchard"
      its group is in kalup/removed.ts, not written: property:companies/soil_depth
      in kalup/removed.ts, not written back: property:companies/soil_ph
      in kalup/removed.ts, not written back: property:companies/soil_type
      in kalup/removed.ts, not written back: group:companies/orchard
    Files are up to date
    "
  `)
  const file = text(dir, objects)
  expect(file).not.toContain('orchard')
  expect(file).not.toContain('soil_depth')
  expect(file).toContain("group: 'beds',")
  // Plan holds the moved group and prints no pull for it.
  const step = (await planned(dir)).steps.find((s) => s.address === drainage)
  expect(step?.held).toEqual([
    { unit: 'group', class: 'drift', config: { $ref: 'group:companies/beds' }, live: { $ref: orchard } },
  ])
  expect(step?.notes).toEqual([
    {
      unit: 'group',
      live: { $ref: orchard },
      note: expect.stringContaining(`${orchard} is in kalup/removed.ts`),
    },
  ])
  // With drainage back in its group, what is left in HubSpot is no difference.
  live(portal, 'drainage').groupName = 'beds'
  const clean = await pull(dir, '--check', '--exit-code')
  expect(clean.exitCode, clean.stdout).toBe(0)
  expect(clean.env.data?.files).toEqual([])
  expect(portal.writes()).toEqual([])
})

test('an option config added is a config change: kept, no difference, and --accept drops it', async () => {
  const portal = sim()
  const dir = await applied(portal)
  edit(
    dir,
    objects,
    "        { value: 'sand', label: 'Sand' },\n",
    "        { value: 'sand', label: 'Sand' },\n        { value: 'silt', label: 'Silt' },\n",
  )
  const plan = (await planned(dir)).steps.find((s) => s.address === soilType)
  expect(plan?.changes).toMatchObject([{ unit: 'options[silt]', class: 'add', op: 'add' }])
  const check = await pull(dir, '--check', '--exit-code')
  expect(check.exitCode, check.stdout).toBe(0)
  expect(about(check.changes, soilType)).toEqual([
    { kind: 'kept', address: soilType, field: 'options[silt]', before: 'Silt' },
  ])
  const human = await cli(dir, 'pull', '--check')
  expect(printed(human)).toMatchInlineSnapshot(`
    "Target sandbox, portal 1111111 (the only target)
    companies: 0 added, 0 changed, 3 unchanged, 0 missing in portal
      config change kept: property:companies/soil_type#options[silt] config "Silt", portal none; take the portal side: kalup pull --target sandbox --accept 'property:companies/soil_type#options[silt]'
    Files are up to date
    "
  `)
  const accepted = await pull(dir, '--accept', `${soilType}#options[silt]`)
  expect(accepted.exitCode, accepted.stdout).toBe(0)
  expect(about(accepted.changes, soilType)).toEqual([
    { kind: 'changed', address: soilType, field: 'options[silt]', before: 'Silt' },
  ])
  expect(text(dir, objects)).not.toContain('silt')
})

test('E_ACCEPT_UNMATCHED carries the warnings that explain it: an unread list is E_SCOPE and E_INCOMPLETE', async () => {
  const portal = sim()
  const dir = await applied(portal)
  portal.fault({
    method: 'GET',
    path: '/crm/properties/2026-09/companies',
    action: fault.status(403, fixture('errors/missing-scope.json')),
  })
  const before = text(dir, objects)
  const out = await pull(dir, '--accept', `${soilPh}#label`)
  expect(out.exitCode).toBe(1)
  expect(out.env.issues.map((i) => i.code)).toEqual(['E_ACCEPT_UNMATCHED', 'E_SCOPE', 'E_INCOMPLETE'])
  expect(text(dir, objects)).toBe(before)
})
