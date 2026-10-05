// What apply checks before it writes: the saved file, its destination, policy and versions, and the trusted derivation
// of every effect step from state and a fresh observation.
import type { Target } from '@kalup/core'
import { expect, test } from 'vitest'
import {
  checkDeletes,
  checkNames,
  checkPolicy,
  checkVersions,
  destinationOf,
  parsePlan,
  runOrder,
  staleUnits,
  stepTitle,
  trustSteps,
} from '../../src/engine/apply-check.js'
import { namesOf, observeForApply } from '../../src/engine/apply-observe.js'
import { writesHash } from '../../src/engine/digest.js'
import type { ConfigFile } from '../../src/grammar/types.js'
import { stableStringify } from '../../src/ir/serialize.js'
import type { TargetState } from '../../src/ir/state.js'
import type { IRResource, Lifecycle } from '../../src/ir/types.js'
import { KalupError } from '../../src/lib/errors.js'
import { createHttp } from '../../src/lib/http.js'
import type { Plan, PlanStep } from '../../src/plan/types.js'
import { normalise } from '../support/normalise.js'
import type { PortalSim, SimProperty } from '../support/portal-sim.js'
import {
  type Edit,
  files,
  key,
  loadProject,
  orchardGroup,
  planOn,
  portalId,
  simPortal,
  soilPh,
  soilPhProperty,
} from './apply-harness.js'

const relabel: Edit = [files.companies, "label: 'Soil pH'", "label: 'Soil acidity'"]
/** The CLI version apply runs as: the version the harness plans as, so its plans are on this release line. */
const running = '0.0.0-test'

function owned(): TargetState {
  return {
    format: 'kalup.state/1',
    lineage: '0a1b2c3d4e5f6071',
    serial: 4,
    portalId,
    resources: {
      'group:companies/orchard': { origin: 'created', id: 'orchard', normVersion: 1, base: { label: 'Orchard' } },
      [soilPh]: {
        origin: 'created',
        id: 'soil_ph',
        normVersion: 1,
        base: { fieldType: 'number', group: { $ref: 'group:companies/orchard' }, label: 'Soil pH', type: 'number' },
      },
    },
  }
}

function rehashed(plan: Plan): Plan {
  const hash = writesHash(plan)
  return { ...plan, writesHash: hash, planId: `pl_${hash.slice(7, 19)}` }
}

function observe(sim: PortalSim, plan: Plan) {
  return observeForApply(createHttp({ key, fetch: sim.fetch, warn: () => undefined }), plan)
}

function thrown(run: () => unknown): KalupError {
  try {
    run()
  } catch (error) {
    if (error instanceof KalupError) {
      return error
    }
    throw error
  }
  throw new Error('expected a KalupError')
}

async function created(): Promise<{ plan: Plan; sim: PortalSim }> {
  const sim = simPortal()
  return { sim, plan: await planOn(sim, loadProject()) }
}

// The saved file

test.each([
  [undefined, 'plan.json was not found'],
  ['not json', 'plan.json is not JSON'],
  ['{}', 'plan.json is not a plan/1 document'],
])('an unreadable plan file is E_PLAN_INVALID: %j', (text, message) => {
  expect(() => parsePlan(text, 'plan.json', running)).toThrow(message)
  try {
    parsePlan(text, 'plan.json', running)
  } catch (error) {
    expect(error).toMatchObject({ exitCode: 1, issues: [{ code: 'E_PLAN_INVALID' }] })
  }
})

test('a plan whose content no longer matches its digest is E_PLAN_DIGEST; its own digest parses', async () => {
  const { plan } = await created()
  expect(parsePlan(stableStringify(plan), 'plan.json', running)).toEqual(plan)
  const edited = { ...plan, stateSerial: 3 }
  expect(thrown(() => parsePlan(stableStringify(edited), 'plan.json', running)).issues).toMatchObject([
    { code: 'E_PLAN_DIGEST' },
  ])
  const renamed = { ...plan, planId: 'pl_000000000000' }
  expect(() => parsePlan(stableStringify(renamed), 'plan.json', running)).toThrow('writesHash and planId do not match')
})

test.each([
  ['0.4.9', '0.4.2'],
  ['0.4.0', '0.4.2'],
  ['1.0.0', '1.7.2'],
  ['1.9.0', '1.0.3'],
  ['1.0.0-rc.1', '1.0.0-rc.1'],
])(
  'a plan kalup %s made applies under %s, its release line; the generator is outside the digest',
  async (made, now) => {
    const { plan } = await created()
    const other = { ...plan, generator: { name: 'kalup', version: made } }
    expect(parsePlan(stableStringify(other), 'plan.json', now)).toEqual(other)
  },
)

test.each([
  ['2.0.0', '1.4.0'],
  ['0.4.2', '1.0.0'],
  // Before 1.0.0 any minor release may change what a plan/1 field means.
  ['0.5.0', '0.4.2'],
  ['0.3.9', '0.4.2'],
  // A pre-release applies only its own plans.
  ['1.0.0-rc.1', '1.0.0-rc.2'],
  ['1.0.0-rc.2', '1.0.0'],
  ['1.0.0', '1.0.0-rc.2'],
  ['dev', '0.4.2'],
])('a plan kalup %s made is E_PLAN_VERSION under %s: plan again with this version', async (made, now) => {
  const { plan } = await created()
  const error = thrown(() =>
    parsePlan(stableStringify({ ...plan, generator: { name: 'kalup', version: made } }), 'plan.json', now),
  )
  expect(error).toMatchObject({ exitCode: 1, issues: [{ code: 'E_PLAN_VERSION' }] })
  expect(error.issues[0]?.message).toContain(`made by kalup ${made}, and this is kalup ${now}`)
  expect(error.issues[0]?.fix).toContain('kalup plan --target <name> --out <file>')
})

test('another plan format, or a newer release plan/1 does not describe, names the version, not the schema', async () => {
  const { plan } = await created()
  const format = thrown(() => parsePlan(stableStringify({ ...plan, format: 'plan/2' }), 'plan.json', running))
  expect(format.issues).toMatchObject([{ code: 'E_PLAN_VERSION', message: expect.stringContaining('plan/2') }])
  // A field this version's closed schema refuses: the version is the reason.
  const newer = { ...plan, generator: { name: 'kalup', version: '3.1.0' }, reviewers: ['a reviewer'] }
  expect(thrown(() => parsePlan(stableStringify(newer), 'plan.json', running)).issues[0]?.code).toBe('E_PLAN_VERSION')
  // The same field from this release line is an invalid plan.
  const same = { ...plan, reviewers: ['a reviewer'] }
  expect(thrown(() => parsePlan(stableStringify(same), 'plan.json', running)).issues[0]?.code).toBe('E_PLAN_INVALID')
})

test('a change that writes another value than the step desires is E_PLAN_INVALID, even under a matching digest', async () => {
  const sim = simPortal({ groups: [orchardGroup], properties: [soilPhProperty] })
  const plan = await planOn(sim, loadProject([relabel]), owned())
  const steps = plan.steps.map((s) => ({
    ...s,
    changes: s.changes?.map((c) => ({ ...c, after: 'Something else' })),
  }))
  const forged = rehashed({ ...plan, steps })
  expect(() => parsePlan(stableStringify(forged), 'plan.json', running)).toThrow('step s1 changes label')
})

test('step ids are s1, s2 and on in step order: a duplicate or malformed id is E_PLAN_INVALID, digest or not', async () => {
  const { plan } = await created()
  // Ids are not in the digest, so a file can rename a step without a new hash: approval and the executor know steps by
  // id, so two steps may never share one.
  const duplicate = { ...plan, steps: plan.steps.map((s) => ({ ...s, id: 's1' })) }
  expect(writesHash(duplicate)).toBe(plan.writesHash)
  expect(() => parsePlan(stableStringify(duplicate), 'plan.json', running)).toThrow('step 2 has the id s1')
  const renumbered = { ...plan, steps: plan.steps.map((s, i) => ({ ...s, id: i === 0 ? 's7' : s.id })) }
  expect(() => parsePlan(stableStringify(renumbered), 'plan.json', running)).toThrow('step 1 has the id s7')
  const malformed = { ...plan, steps: plan.steps.map((s, i) => ({ ...s, id: i === 0 ? 's01' : s.id })) }
  expect(() => parsePlan(stableStringify(malformed), 'plan.json', running)).toThrow(
    'plan.json is not a plan/1 document',
  )
  try {
    parsePlan(stableStringify(duplicate), 'plan.json', running)
  } catch (error) {
    expect(error).toMatchObject({ exitCode: 1, issues: [{ code: 'E_PLAN_INVALID' }] })
  }
})

test('a $ref an effect step carries must be an address: E_PLAN_INVALID, digest or not', async () => {
  const { plan } = await created()
  const loose = {
    ...plan,
    steps: plan.steps.map((s) =>
      s.address === soilPh ? { ...s, desired: { ...s.desired, group: { $ref: 'orchard' } } } : s,
    ),
  }
  expect(() => parsePlan(stableStringify(rehashed(loose)), 'plan.json', running)).toThrow('s2 refers to')
})

/** kalup.config.ts with the companies object and one target, sandbox. */
function configFor(target: Target, objects: ConfigFile['objects'] = { companies: {} }) {
  return { objects, targets: { sandbox: target } }
}

test('name bindings come from the target overrides: one config does not give, or two steps on one portal name, is E_BINDING_CHANGED', async () => {
  const { plan } = await created()
  const target = configFor({ portalId })
  expect(() => checkNames(plan, target)).not.toThrow()
  const forged = { ...plan, bindings: { [soilPh]: { name: 'plot_notes' } } }
  const error = thrown(() => checkNames(forged, target))
  expect(error.issues).toMatchObject([{ code: 'E_BINDING_CHANGED' }])
  expect(normalise(String(error.issues[0]?.message))).toMatchInlineSnapshot(
    `"plan pl_<id> does not name what kalup.config.ts names on target sandbox: the plan binds property:companies/soil_ph to portal name plot_notes, and the name override in kalup.config.ts gives none. Nothing was written."`,
  )
  // The same binding with the override in config is what config names.
  const renamed = configFor({ portalId, overrides: { [soilPh]: { name: 'plot_notes' } } })
  expect(() => checkNames(forged, renamed)).not.toThrow()
  // A binding config gives and the plan leaves out.
  expect(() => checkNames(plan, renamed)).toThrow(`binds ${soilPh} to no portal name`)
  // Two effect steps that resolve to one portal property.
  const twin = plan.steps.find((s) => s.address === soilPh) as PlanStep
  const twins = {
    ...plan,
    bindings: { 'property:companies/soil_acidity': { name: 'soil_ph' } },
    steps: [...plan.steps, { ...twin, id: 's3', address: 'property:companies/soil_acidity' }],
  }
  const aliased = configFor({ portalId, overrides: { 'property:companies/soil_acidity': { name: 'soil_ph' } } })
  expect(() => checkNames(twins, aliased)).toThrow('both resolve to property:companies/soil_ph')
})

test('a step on an object config does not declare, or on a custom object named by its type ID too, is E_BINDING_CHANGED', async () => {
  const { plan } = await created()
  const step = plan.steps.find((s) => s.address === soilPh) as PlanStep
  // A custom object's property under its type ID: an object key config does not declare under objects.
  const typed = { ...plan, steps: [...plan.steps, { ...step, id: 's3', address: 'property:2-5500001/soil_ph' }] }
  expect(() => checkNames(typed, configFor({ portalId }))).toThrow('the plan touches 2-5500001')
  // A release sends nothing: one on an object config no longer declares is plan's own.
  const released = {
    ...plan,
    steps: [...plan.steps, { ...step, id: 's3', action: 'release' as const, address: 'property:deals/soil_ph' }],
  }
  expect(() => checkNames(released, configFor({ portalId }))).not.toThrow()
  // Two steps resolve to one portal resource by the object type their paths take, the bound type ID of a custom object.
  const onObject = (address: string, id: string): PlanStep => ({ ...step, id, address, desired: { label: 'Soil pH' } })
  const aliased = {
    ...plan,
    bindings: { 'object:plots': { id: '2-5500001' } },
    steps: [onObject('property:plots/soil_ph', 's1'), onObject('property:2-5500001/soil_ph', 's2')],
  }
  const both = configFor({ portalId }, { plots: {}, '2-5500001': {} })
  expect(() => checkNames(aliased, both)).toThrow('both resolve to property:2-5500001/soil_ph')
})

test('a delete needs a destroy tombstone and an address gone from config, never one that sets preventDestroy', async () => {
  const { plan } = await created()
  const del: PlanStep = {
    id: 's1',
    address: soilPh,
    action: 'delete',
    risk: 'destructive',
    transport: 'public-api',
    api: { family: 'crm.properties', version: '2026-09' },
    title: 'x',
    expect: { exists: true },
  }
  const deletes = { ...plan, steps: [del] }
  const kept = loadProject()
  expect(() => checkDeletes(deletes, kept)).toThrow(`${soilPh} is still in config`)
  const guarded = loadProject([
    [files.companies, "fieldType: 'number',", "fieldType: 'number',\n      lifecycle: { preventDestroy: true },"],
  ])
  const error = thrown(() => checkDeletes(deletes, guarded))
  expect(error.issues).toMatchObject([{ code: 'E_PLAN_DELETE' }])
  expect(normalise(String(error.issues[0]?.message))).toMatchInlineSnapshot(
    `"plan pl_<id> deletes what config does not ask to delete: property:companies/soil_ph is in config and sets lifecycle.preventDestroy. Nothing was written."`,
  )
  const gone = {
    ...kept.ir,
    resources: Object.fromEntries(Object.entries(kept.ir.resources).filter(([a]) => a !== soilPh)),
  }
  const { config } = kept
  expect(() => checkDeletes(deletes, { config, ir: gone })).toThrow(
    'has no destroy tombstone in removed.ts, and takeover does not archive it: the mode of companies on target sandbox is addon',
  )
  const released = { ...gone, tombstones: { [soilPh]: { action: 'release' as const } } }
  expect(() => checkDeletes(deletes, { config, ir: released })).toThrow('has no destroy tombstone')
  const destroyed = { ...gone, tombstones: { [soilPh]: { action: 'destroy' as const } } }
  expect(() => checkDeletes(deletes, { config, ir: destroyed })).not.toThrow()
  // Takeover asks for the delete itself: the object's mode, the pull scope, exclude and skip overrides decide, a
  // release wins, and the delete carries the takeover label, whose rules apply checks against its read.
  const takeover = { ...config, mode: 'takeover' as const }
  expect(() => checkDeletes(deletes, { config: takeover, ir: gone })).toThrow(
    'has no destroy tombstone and no takeover',
  )
  const labelled = { ...plan, steps: [{ ...del, labels: ['takeover' as const] }] }
  expect(() => checkDeletes(labelled, { config: takeover, ir: gone })).not.toThrow()
  expect(() => checkDeletes(labelled, { config: takeover, ir: released })).toThrow('is in removed.ts')
  // The label asks for takeover's archive, so its rules decide whatever removed.ts says.
  expect(() => checkDeletes(labelled, { config: takeover, ir: destroyed })).toThrow(
    'is labelled takeover, and takeover does not archive it: property:companies/soil_ph is in removed.ts',
  )
  expect(() => checkDeletes(labelled, { config, ir: destroyed })).toThrow('the mode of companies on target sandbox is addon')
  const { sandbox } = takeover.targets
  const skipped = {
    ...takeover,
    targets: { sandbox: { portalId, ...sandbox, overrides: { [soilPh]: { skip: true as const } } } },
  }
  expect(() => checkDeletes(labelled, { config: skipped, ir: gone })).toThrow(
    `a skip override leaves ${soilPh} out on target sandbox`,
  )
  const excluded = { ...takeover, objects: { ...takeover.objects, companies: { exclude: ['soil_*'] } } }
  expect(() => checkDeletes(deletes, { config: excluded, ir: gone })).toThrow('objects.companies.exclude names soil_ph')
  const noCustom = { ...takeover, objects: { ...takeover.objects, companies: { custom: false } } }
  expect(() => checkDeletes(deletes, { config: noCustom, ir: gone })).toThrow('outside the pull scope of companies')
})

test("an archive's counts move when apply's read finds more, or could not count the pipelines", () => {
  const visit = 'object:orchard_visit'
  const del: PlanStep = {
    id: 's1',
    address: visit,
    action: 'delete',
    risk: 'destructive',
    transport: 'public-api',
    api: { family: 'crm-object-schemas', version: '2026-09' },
    title: 'x',
    expect: { exists: true, values: { takes: { properties: 1, groups: 1, pipelines: 0 } } },
  }
  const observed = { type: 'object', definition: {} } as IRResource
  const members = { orchard_visit: { visit_details: ['visit_code', 'hs_object_id'] } }
  const read = (listed: { groups: number; pipelines?: number }) => ({
    archived: {},
    archivedSchemas: [],
    members,
    listed: { orchard_visit: listed },
  })
  expect(staleUnits(del, observed, read({ groups: 1, pipelines: 0 }))).toEqual([])
  expect(staleUnits(del, observed, read({ groups: 1, pipelines: 2 }))).toEqual(['takes'])
  expect(staleUnits(del, observed, read({ groups: 1 }))).toEqual(['takes'])
})

test('a custom object archive is refused while config still holds what is on it, and names what sets preventDestroy', async () => {
  const { plan } = await created()
  const visit = 'object:orchard_visit'
  const del: PlanStep = {
    id: 's1',
    address: visit,
    action: 'delete',
    risk: 'destructive',
    transport: 'public-api',
    api: { family: 'crm-object-schemas', version: '2026-09' },
    title: 'x',
    expect: { exists: true },
  }
  const deletes = { ...plan, steps: [del] }
  // The object's export is gone, but a hand edit kept one of its properties in another export. Validate refuses such a
  // project (E_TOMBSTONE_CONFLICT); apply reads config as data and refuses it on its own.
  const kept = (lifecycle: string) => {
    const loaded = loadProject([[files.config, 'companies: {},', 'companies: {},\n    orchard_visit: {},']], {
      'hubspot/objects/orchard_visit.ts': [
        "import { defineObject, p } from '@kalup/core'",
        '',
        "export const OrchardVisit = defineObject('orchard_visit', {",
        "  groups: { visit_details: { label: 'Visit details' } },",
        "  properties: { visitCode: p.string('visit_code', { label: 'Visit code', group: 'visit_details', fieldType: 'text'" +
          `${lifecycle} }) },`,
        '})',
        '',
      ].join('\n'),
    })
    return { config: loaded.config, ir: { ...loaded.ir, tombstones: { [visit]: { action: 'destroy' as const } } } }
  }
  expect(normalise(String(thrown(() => checkDeletes(deletes, kept(''))).issues[0]?.message))).toMatchInlineSnapshot(
    `"plan pl_<id> deletes what config does not ask to delete: object:orchard_visit archives what config still holds: group:orchard_visit/visit_details, property:orchard_visit/visit_code. Nothing was written."`,
  )
  const guarded = kept(', lifecycle: { preventDestroy: true }')
  expect(normalise(String(thrown(() => checkDeletes(deletes, guarded)).issues[0]?.message))).toMatchInlineSnapshot(
    `"plan pl_<id> deletes what config does not ask to delete: object:orchard_visit archives property:orchard_visit/visit_code, which config holds and protects with lifecycle.preventDestroy. Nothing was written."`,
  )
})

test('a delete whose portal resource another address in config names through a name override is E_PLAN_DELETE', async () => {
  const { plan } = await created()
  const del: PlanStep = {
    id: 's1',
    address: soilPh,
    action: 'delete',
    risk: 'destructive',
    transport: 'public-api',
    api: { family: 'crm.properties', version: '2026-09' },
    title: 'x',
    expect: { exists: true },
  }
  const deletes = { ...plan, steps: [del] }
  const { ir, config } = loadProject()
  const decoy = 'property:companies/soil_acidity'
  const { [soilPh]: soil, ...rest } = ir.resources
  // soil_ph has a destroy tombstone, and config holds the same portal property as soil_acidity on this target.
  const held = (lifecycle: Lifecycle) => ({
    config,
    ir: {
      ...ir,
      resources: { ...rest, [decoy]: { ...(soil as IRResource), lifecycle } },
      targets: { sandbox: { portalId, overrides: { [decoy]: { name: 'soil_ph' } } } },
      tombstones: { [soilPh]: { action: 'destroy' as const } },
    },
  })
  const error = thrown(() => checkDeletes(deletes, held({ options: 'additive', preventDestroy: true })))
  expect(error.issues).toMatchObject([{ code: 'E_PLAN_DELETE' }])
  expect(normalise(String(error.issues[0]?.message))).toMatchInlineSnapshot(
    `"plan pl_<id> deletes what config does not ask to delete: property:companies/soil_ph resolves to property:companies/soil_ph in the portal, which config holds as property:companies/soil_acidity and protects with lifecycle.preventDestroy. Nothing was written."`,
  )
  expect(() => checkDeletes(deletes, held({ options: 'additive' }))).toThrow(`config still holds as ${decoy}`)
  // Without the override, soil_acidity names its own portal property: the delete goes.
  const guarded = held({ options: 'additive', preventDestroy: true })
  const elsewhere = { config, ir: { ...guarded.ir, targets: { sandbox: { portalId } } } }
  expect(() => checkDeletes(deletes, elsewhere)).not.toThrow()
})

test('apply runs effect steps in the order their actions give, whatever order the file lists them in', () => {
  const step = (id: string, address: string, action: PlanStep['action']) =>
    ({ id, address, action, risk: 'safe', transport: 'public-api', title: 'x', expect: {} }) as PlanStep
  const steps = [
    step('s1', 'group:companies/orchard', 'delete'),
    step('s2', soilPh, 'delete'),
    step('s3', 'property:companies/old_notes', 'release'),
    step('s4', 'property:companies/plot_notes', 'create'),
    step('s5', 'group:companies/plots', 'create'),
  ]
  expect(runOrder({ steps }).map((s) => s.id)).toEqual(['s5', 's4', 's3', 's2', 's1'])
})

// Observed: HubSpot answers 404 to a formula naming a property it does not hold yet.
test('a property step that writes a formula runs after the other property steps, and after the formulas it names', () => {
  const step = (id: string, name: string, formula?: string) =>
    ({
      id,
      address: `property:companies/${name}`,
      action: 'create',
      risk: 'safe',
      transport: 'public-api',
      title: 'x',
      expect: {},
      desired: formula === undefined ? {} : { calculationFormula: formula },
    }) as PlanStep
  const steps = [
    step('s1', 'avg_yield', 'total_yield / plot_count'),
    step('s2', 'plot_count'),
    step('s3', 'total_yield', 'plot_yield * 2'),
    step('s4', 'plot_yield'),
    { ...step('s5', 'orchard', undefined), address: 'group:companies/orchard' },
    { ...step('s6', 'old_notes'), action: 'release' as const },
  ]
  expect(runOrder({ steps }).map((s) => s.id)).toEqual(['s5', 's2', 's4', 's3', 's1', 's6'])
})

// Destination, policy and versions

function configWith(targets: ConfigFile['targets']): ConfigFile {
  return { imports: [], objects: {}, targets }
}

test('the plan target must be declared, pin the plan portal, and be the only target on that portal', async () => {
  const { plan } = await created()
  expect(destinationOf(plan, configWith({ sandbox: { portalId } }))).toEqual({ portalId })
  expect(() => destinationOf(plan, configWith({ production: { portalId } }))).toThrow('does not declare')
  expect(() => destinationOf(plan, configWith({ sandbox: { portalId: 2_222_222 } }))).toThrow(
    'kalup.config.ts pins that target to portal 2222222',
  )
  try {
    destinationOf(plan, configWith({ sandbox: { portalId }, alias: { portalId } }))
    expect.unreachable()
  } catch (error) {
    expect(error).toMatchObject({ exitCode: 3, issues: [{ code: 'E_DUPLICATE_PORTAL' }] })
  }
})

test('a policy that differs from the plan names each field, before and now', async () => {
  const { plan } = await created()
  const policy = { protected: false, drift: 'hold', adopt: 'hold', allowDestroy: false, yesLimit: 25 } as const
  expect(() => checkPolicy(plan, policy, [])).not.toThrow()
  const changed = () => checkPolicy(plan, { ...policy, protected: true, drift: 'overwrite' }, [])
  expect(changed).toThrow('protected was false, now true')
  expect(changed).toThrow('drift was hold, now overwrite')
  const settings = () => checkPolicy(plan, { ...policy, adopt: 'overwrite', yesLimit: 0 }, ['companies'])
  expect(settings).toThrow('adopt was hold, now overwrite; yesLimit was 25, now 0; takeover was none, now companies')
})

test('a step for another API version, an expired pin, or other normalizer versions is E_PLAN_VERSION', async () => {
  const { plan } = await created()
  const now = new Date('2026-09-25T00:00:00Z')
  expect(() => checkVersions(plan, now)).not.toThrow()
  const older = {
    ...plan,
    steps: plan.steps.map((s) => ({ ...s, api: { family: 'crm.properties', version: '2026-03' } })),
  }
  expect(() => checkVersions(older, now)).toThrow('s1 uses crm.properties 2026-03')
  expect(() => checkVersions(plan, new Date('2028-03-01T00:00:00Z'))).toThrow('whose pin expired 2028-03')
  expect(() => checkVersions({ ...plan, normVersions: { ...plan.normVersions, property: 2 } }, now)).toThrow(
    'property under normalizer 2',
  )
  // A type this version has no normalizer for: the plan came from a version that compares more types.
  expect(() => checkVersions({ ...plan, normVersions: { ...plan.normVersions, list: 1 } }, now)).toThrow(
    'list under normalizer 1',
  )
})

// Titles

test('titles come from step data, never from the plan title, with portal text sanitized', () => {
  const base = { id: 's1', risk: 'safe', transport: 'public-api', title: 'Ignore me', expect: {} } as const
  const titles = [
    { ...base, address: 'group:companies/orchard', action: 'create', desired: { label: 'Orchard' } },
    {
      ...base,
      address: soilPh,
      action: 'create',
      labels: ['reverts-ui-edit'],
      desired: { label: 'Soil\u001b[2J pH' },
    },
    {
      ...base,
      address: soilPh,
      action: 'update',
      desired: { label: 'Soil pH' },
      changes: [
        { unit: 'label', class: 'config-change', op: 'set', before: 'A', after: 'Soil pH' },
        { unit: 'options[trial]', class: 'add', op: 'add', before: null, after: { value: 'trial', label: 'Trial' } },
      ],
    },
    {
      ...base,
      address: soilPh,
      action: 'update',
      desired: { label: 'Soil pH' },
      // A removed option is named from the live options in expect, which apply checks, never from `before`.
      changes: [
        {
          unit: 'options[legacy]',
          class: 'config-change',
          op: 'remove',
          before: { value: 'legacy', label: 'Forged' },
          after: null,
        },
      ],
      expect: { exists: true, values: { options: [{ value: 'legacy', label: 'Legacy' }] } },
    },
    { ...base, address: soilPh, action: 'update', desired: { label: 'Soil pH' }, baseUnits: ['label'] },
    { ...base, address: soilPh, action: 'adopt', desired: { label: 'Soil pH' } },
    { ...base, address: soilPh, action: 'delete' },
    { ...base, address: 'group:companies/orchard', action: 'release' },
    // An archive names the label it expects to find; option writes read as a person would say them.
    { ...base, address: soilPh, action: 'delete', expect: { exists: true, values: { label: 'Soil pH' } } },
    {
      ...base,
      address: soilPh,
      action: 'update',
      desired: { label: 'Soil pH' },
      changes: [
        { unit: 'options[low].label', class: 'config-change', op: 'set', before: 'Lo', after: 'Low' },
        { unit: 'options[high].hidden', class: 'config-change', op: 'set', before: false, after: true },
        { unit: 'options.order', class: 'config-change', op: 'set', before: ['high', 'low'], after: ['low', 'high'] },
      ],
    },
  ] as PlanStep[]
  const renamed = namesOf({ bindings: { [soilPh]: { name: 'legacy_ph' } } })
  const renamedTitles = [titles[1], titles[6]].map((step) => stepTitle(step as PlanStep, renamed))
  expect(renamedTitles.every((title) => title.includes('portal name legacy_ph'))).toBe(true)
  expect(titles.map((step) => stepTitle(step))).toMatchInlineSnapshot(`
    [
      "Create property group "Orchard" (orchard) on companies",
      "Recreate property "Soil pH" (soil_ph) on companies",
      "Update property "Soil pH" (soil_ph) on companies, set label, add option "Trial"",
      "Update property "Soil pH" (soil_ph) on companies, remove option "Legacy"",
      "Record the agreed values of property "Soil pH" (soil_ph) on companies",
      "Adopt property "Soil pH" (soil_ph) on companies",
      "Archive property soil_ph on companies",
      "Stop managing property group orchard on companies; nothing changes in HubSpot",
      "Archive property "Soil pH" (soil_ph) on companies",
      "Update property "Soil pH" (soil_ph) on companies, relabel option "low", hide option "high", reorder options",
    ]
  `)
})

// Trusted derivation

test('an expect the portal no longer meets is E_PLAN_STALE, listing what moved', async () => {
  const sim = simPortal({ groups: [orchardGroup], properties: [soilPhProperty] })
  const plan = await planOn(sim, loadProject([relabel]), owned())
  Object.assign(sim.object(portalId, 'companies').properties.get('soil_ph') ?? {}, { label: 'Soil reading' })
  await expect(observe(sim, plan).then((o) => trustSteps(plan, owned(), o))).rejects.toThrow(`${soilPh} label`)
  sim.object(portalId, 'companies').properties.delete('soil_ph')
  await expect(observe(sim, plan).then((o) => trustSteps(plan, owned(), o))).rejects.toThrow(`${soilPh} exists`)
})

test('a create whose name HubSpot now holds archived is stale; a destroy release of an archived property is not', async () => {
  const { sim, plan } = await created()
  sim.object(portalId, 'companies').properties.set('soil_ph', {
    ...(sim.object(portalId, 'companies').properties.get('name') as SimProperty),
    name: 'soil_ph',
    hubspotDefined: false,
    archived: true,
  })
  const observation = await observe(sim, plan)
  expect(() => trustSteps(plan, null, observation)).toThrow(`${soilPh} archived`)
  const release = { ...plan.steps[1], action: 'release', expect: { exists: false } } as PlanStep
  expect(staleUnits(release, undefined, observation)).toEqual([])
})

test.each([
  ['an update no entry owns', 'update', false, 'no state entry owns it on this target'],
  ['an adopt state owns', 'adopt', true, 'state owns it already'],
])('trusted derivation blocks %s: E_PLAN_RISK', async (_name, action, withState, text) => {
  const sim = simPortal({ groups: [orchardGroup], properties: [soilPhProperty] })
  const plan = await planOn(sim, loadProject([relabel]), owned())
  const edited = { ...plan, steps: plan.steps.map((s) => ({ ...s, action: action as PlanStep['action'] })) }
  const observation = await observe(sim, edited)
  expect(() => trustSteps(edited, withState ? owned() : null, observation)).toThrow(text)
})

test('a create on an address state owns is blocked unless it recreates a property HubSpot does not hold', async () => {
  const { sim, plan } = await created()
  const property = plan.steps.filter((s) => s.address === soilPh)
  const create = { ...plan, steps: property }
  const observation = await observe(sim, create)
  expect(() => trustSteps(create, owned(), observation)).toThrow('would duplicate')
  const recreate = {
    ...create,
    steps: property.map((s) => ({ ...s, risk: 'risky' as const, labels: ['reverts-ui-edit' as const] })),
  }
  expect(trustSteps(recreate, owned(), observation).get('s2')).toMatchObject({ owned: true })
})

test('a delete is blocked without allowDestroy, and a group delete while a property no one deletes names it', async () => {
  const other = { ...soilPhProperty, name: 'plot_notes', label: 'Plot notes' }
  const sim = simPortal({ groups: [orchardGroup], properties: [soilPhProperty, other] })
  const plan = await planOn(sim, loadProject([relabel]), owned())
  // What the planner expects of each: the live value of every unit the base holds.
  const values = (address: string) => ({ ...owned().resources[address]?.base })
  const del = (address: string): PlanStep => ({
    id: address.startsWith('group') ? 's2' : 's1',
    address,
    action: 'delete',
    risk: 'destructive',
    transport: 'public-api',
    api: { family: 'crm.properties', version: '2026-09' },
    title: 'x',
    expect: { exists: true, values: values(address) },
  })
  const deletes = { ...plan, steps: [del(soilPh), del('group:companies/orchard')] }
  const observation = await observe(sim, deletes)
  expect(() => trustSteps(deletes, owned(), observation)).toThrow('target sandbox does not allow deletes')
  const allowed = { ...deletes, target: { ...deletes.target, allowDestroy: true } }
  expect(() => trustSteps(allowed, owned(), observation)).toThrow('still name this group: plot_notes')
  sim.object(portalId, 'companies').properties.delete('plot_notes')
  const clear = await observe(sim, allowed)
  expect(trustSteps(allowed, owned(), clear).get('s1')).toMatchObject({ owned: true })
})

test('a delete whose expect leaves out a field the base holds is E_PLAN_RISK: a HubSpot edit after review would not stop it', async () => {
  const sim = simPortal({ groups: [orchardGroup], properties: [soilPhProperty] })
  const plan = await planOn(sim, loadProject([relabel]), owned())
  const step: PlanStep = {
    id: 's1',
    address: soilPh,
    action: 'delete',
    risk: 'destructive',
    transport: 'public-api',
    api: { family: 'crm.properties', version: '2026-09' },
    title: 'x',
    expect: { exists: true, values: { label: 'Soil pH', type: 'number' } },
  }
  const partial = { ...plan, target: { ...plan.target, allowDestroy: true }, steps: [step] }
  const observation = await observe(sim, partial)
  expect(() => trustSteps(partial, owned(), observation)).toThrow('leaves out fieldType, group,')
  const unsure = { ...partial, steps: [{ ...step, expect: { values: step.expect.values } }] }
  expect(() => trustSteps(unsure, owned(), observation)).toThrow('leaves out exists, fieldType, group,')
})

test('a release drops an entry that names another portal name; a destroy release re-checks the resource is absent', async () => {
  const sim = simPortal({ groups: [orchardGroup], properties: [soilPhProperty] })
  const plan = await planOn(sim, loadProject([relabel]), owned())
  const release = (expected: PlanStep['expect']): Plan => ({
    ...plan,
    steps: [
      {
        id: 's1',
        address: soilPh,
        action: 'release',
        risk: 'safe',
        transport: 'public-api',
        title: 'x',
        expect: expected,
      },
    ],
  })
  // A stale entry: state records soil_acidity at the address, which resolves to soil_ph.
  const stale = owned()
  ;(stale.resources[soilPh] as { id: string }).id = 'soil_acidity'
  const loose = release({})
  expect(trustSteps(loose, stale, await observe(sim, loose)).get('s1')).toMatchObject({
    owned: false,
    entry: { id: 'soil_acidity' },
  })
  // From a destroy tombstone: the plan saw the property gone, and HubSpot holds it again.
  const gone = release({ exists: false })
  await expect(observe(sim, gone).then((o) => trustSteps(gone, owned(), o))).rejects.toThrow(`${soilPh} exists`)
  sim.object(portalId, 'companies').properties.delete('soil_ph')
  expect(trustSteps(gone, owned(), await observe(sim, gone)).get('s1')).toMatchObject({ owned: true })
})

test('a stated risk below the derived one, or a missing label, is E_PLAN_RISK', async () => {
  const sim = simPortal({ groups: [orchardGroup], properties: [{ ...soilPhProperty, label: 'Soil reading' }] })
  const loaded = loadProject()
  const plan = await planOn(sim, loaded, owned(), [{ address: soilPh, unit: 'label' }])
  expect(plan.steps).toMatchObject([{ risk: 'risky', labels: ['reverts-ui-edit'] }])
  const observation = await observe(sim, plan)
  expect(() => trustSteps(plan, owned(), observation)).not.toThrow()
  const lowered = { ...plan, steps: plan.steps.map((s) => ({ ...s, risk: 'safe' as const, labels: undefined })) }
  const refused = () => trustSteps(lowered, owned(), observation)
  expect(refused).toThrow('s1 states risk safe, and it is risky')
  expect(refused).toThrow('s1 leaves out the label reverts-ui-edit')
})

test('an adopt classifies against the base a pull recorded: a config change is safe, and without that base it is not', async () => {
  const sim = simPortal({ groups: [orchardGroup], properties: [soilPhProperty] })
  const pulled = owned()
  for (const entry of Object.values(pulled.resources)) {
    entry.origin = 'pulled'
  }
  const plan = await planOn(sim, loadProject([relabel]), pulled)
  const step = plan.steps.find((s) => s.address === soilPh)
  expect(step).toMatchObject({
    action: 'adopt',
    risk: 'safe',
    changes: [{ unit: 'label', class: 'config-change', before: 'Soil pH', after: 'Soil acidity' }],
  })
  const observation = await observe(sim, plan)
  expect(trustSteps(plan, pulled, observation).get(step?.id ?? '')).toMatchObject({ owned: false, pulled: {} })
  // Without the pulled base the label never agreed, so writing it overwrites the portal: risky, labelled.
  const refused = () => trustSteps(plan, null, observation)
  expect(refused).toThrow(`${step?.id} states risk safe, and it is risky`)
  expect(refused).toThrow(`${step?.id} leaves out the label overwrites-portal`)
  // A pulled entry that names another portal name gives no base either.
  const renamed = structuredClone(pulled)
  ;(renamed.resources[soilPh] as { id: string }).id = 'soil_acidity'
  expect(() => trustSteps(plan, renamed, observation)).toThrow('states risk safe, and it is risky')
})
