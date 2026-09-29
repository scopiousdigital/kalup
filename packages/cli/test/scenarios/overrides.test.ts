// Scenario: per-target definition overrides. One shared honey_grade property and two targets on two
// portals: acme-eu overrides its label, its options and its description (an owned empty one), acme-us overrides
// nothing. Plan, apply, compare and pull each use the target's effective config, and a pull of one target never
// writes its overridden fields into the shared file or touches the other target.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Comparison } from '@kalup/engine'
import { type Plan, stableStringify, type TargetState, writesHash } from '@kalup/engine'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { normalise } from '../../../engine/test/support/normalise.js'
import { createPortalSim, type PortalSim, type SimProperty } from '../../../engine/test/support/portal-sim.js'
import type { PullData } from '../../src/commands/pull.js'
import { cli, parseEnvelope } from '../../src/commands/testing.js'
import {
  APIARY,
  apply,
  configFile,
  edit,
  effects,
  environment,
  HONEY_GRADE,
  objectsFile,
  planIsEmpty,
  planOf,
  savePlan,
  writeObjects,
} from './harness.js'

const EU = 7_700_002
const US = 7_700_003
const euKey = 'kestrel-eu-key-3f81'
const usKey = 'kestrel-us-key-9a27'
const honeyGrade = 'property:companies/honey_grade'

const SHARED_GRADE = HONEY_GRADE.replace(
  "      fieldType: 'select',\n",
  "      fieldType: 'select',\n      description: 'Graded at extraction',\n",
)

const EU_OVERRIDE = `      overrides: {
        'property:companies/honey_grade': {
          definition: {
            label: 'Honey class',
            description: '',
            options: [
              { value: 'amber', label: 'Amber' },
              { value: 'light', label: 'Pale' },
            ],
          },
        },
      },
`

// Directories a test made read-only, made writable again after it.
const readOnly: string[] = []

beforeEach(() => {
  environment()
  vi.stubEnv('ACME_EU_KEY', euKey)
  vi.stubEnv('ACME_US_KEY', usKey)
})

afterEach(() => {
  for (const dir of readOnly.splice(0)) {
    chmodSync(dir, 0o755)
  }
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

/** The two portals, empty but for their companies object, in one simulator. */
function portals(): PortalSim {
  const empty = { companies: { groups: [], properties: [] } }
  const sim = createPortalSim([
    { portalId: EU, keys: { ACME_EU_KEY: euKey }, objects: empty },
    { portalId: US, keys: { ACME_US_KEY: usKey }, objects: empty },
  ])
  vi.stubGlobal('fetch', sim.fetch)
  return sim
}

/** The project, in canonical form: the `groups` and honey_grade, acme-eu with `overrides` and acme-us. */
async function project(overrides = EU_OVERRIDE, us = '', groups = APIARY): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'kestrel-overrides-'))
  mkdirSync(join(dir, 'kalup', 'objects'), { recursive: true })
  const config = [
    "import { defineConfig } from '@kalup/core'",
    '',
    'export default defineConfig({',
    "  name: 'kestrel-apiaries',",
    '  objects: {',
    '    companies: {},',
    '  },',
    '  targets: {',
    "    'acme-eu': {",
    `      portalId: ${EU},`,
    "      credentials: { read: { env: 'ACME_EU_KEY' } },",
    `${overrides}    },`,
    "    'acme-us': {",
    `      portalId: ${US},`,
    "      credentials: { read: { env: 'ACME_US_KEY' } },",
    `${us}    },`,
    '  },',
    '})',
    '',
  ]
  writeFileSync(join(dir, configFile), config.join('\n'))
  writeObjects(dir, groups, SHARED_GRADE)
  const fmt = await cli(dir, 'fmt', '--json')
  if (fmt.exitCode !== 0) {
    throw new Error(`fmt failed: ${fmt.stdout}`)
  }
  return dir
}

function text(dir: string, file: string): string {
  return readFileSync(join(dir, file), 'utf8')
}

function stateOf(dir: string, portalId: number): TargetState {
  return JSON.parse(text(dir, join('.kalup', 'state', `portal-${portalId}.json`))) as TargetState
}

function grade(sim: PortalSim, portalId: number): SimProperty {
  return sim.object(portalId, 'companies').properties.get('honey_grade') as SimProperty
}

function stepOf(plan: Plan) {
  return plan.steps.find((s) => s.address === honeyGrade)
}

async function applyTarget(dir: string, target: string): Promise<Plan> {
  const plan = await savePlan(dir, '--target', target)
  const out = await apply(dir, 'plan.json', '--yes', '--json')
  if (out.exitCode !== 0) {
    throw new Error(`the apply to ${target} failed: ${out.stdout}`)
  }
  return plan
}

async function compared(dir: string, target: string) {
  const out = await cli(dir, 'compare', 'config', target, '--exit-code', '--json')
  return { exitCode: out.exitCode, data: parseEnvelope<Comparison>(out.stdout).data as Comparison }
}

/** The project applied to both portals. */
async function appliedBoth(sim: PortalSim): Promise<string> {
  const dir = await project()
  await applyTarget(dir, 'acme-eu')
  await applyTarget(dir, 'acme-us')
  sim.log.length = 0
  return dir
}

test('each target plans its own effective values, its digest covers them, and apply writes them to its portal', async () => {
  const sim = portals()
  const dir = await project()
  const eu = await savePlan(dir, '--target', 'acme-eu')
  const us = await planOf(dir, '--target', 'acme-us')
  expect(stepOf(eu)).toMatchObject({
    action: 'create',
    desired: {
      label: 'Honey class',
      description: '',
      options: [
        { value: 'amber', label: 'Amber' },
        { value: 'light', label: 'Pale' },
      ],
    },
  })
  expect(stepOf(us)).toMatchObject({
    action: 'create',
    desired: {
      label: 'Honey grade',
      description: 'Graded at extraction',
      options: [
        { value: 'light', label: 'Light' },
        { value: 'amber', label: 'Amber' },
      ],
    },
  })
  // Each digest covers its own desired values: change one and the digest no longer matches.
  for (const plan of [eu, us]) {
    expect(writesHash(plan)).toBe(plan.writesHash)
    const steps = plan.steps.map((s) =>
      s.address === honeyGrade ? { ...s, desired: { ...s.desired, label: 'Something else' } } : s,
    )
    expect(writesHash({ ...plan, steps })).not.toBe(plan.writesHash)
  }
  expect(eu.writesHash).not.toBe(us.writesHash)

  const out = await apply(dir, 'plan.json', '--yes', '--json')
  expect(out.exitCode, out.stdout).toBe(0)
  await applyTarget(dir, 'acme-us')
  expect(grade(sim, EU)).toMatchObject({ label: 'Honey class', description: '' })
  expect(grade(sim, EU).options.map((o) => [o.value, o.label])).toEqual([
    ['amber', 'Amber'],
    ['light', 'Pale'],
  ])
  expect(grade(sim, US)).toMatchObject({ label: 'Honey grade', description: 'Graded at extraction' })
  expect(grade(sim, US).options.map((o) => [o.value, o.label])).toEqual([
    ['light', 'Light'],
    ['amber', 'Amber'],
  ])
  // State per portal holds the base of that portal's own values.
  expect(stateOf(dir, EU).resources[honeyGrade]?.base).toMatchObject({ label: 'Honey class', description: '' })
  expect(stateOf(dir, US).resources[honeyGrade]?.base).toMatchObject({
    label: 'Honey grade',
    description: 'Graded at extraction',
  })
  // A second plan of each has nothing to do.
  await planIsEmpty(dir, '--target', 'acme-eu')
  await planIsEmpty(dir, '--target', 'acme-us')
})

test('compare config <target> is clean on both after apply; a shared label change differs only where not overridden', async () => {
  const sim = portals()
  const dir = await appliedBoth(sim)
  expect((await compared(dir, 'acme-eu')).exitCode).toBe(0)
  expect((await compared(dir, 'acme-us')).exitCode).toBe(0)
  edit(dir, objectsFile, "label: 'Honey grade'", "label: 'Honey quality'")
  expect((await compared(dir, 'acme-eu')).exitCode).toBe(0)
  const us = await compared(dir, 'acme-us')
  expect(us.exitCode).toBe(2)
  expect(us.data.differences).toEqual([
    {
      address: honeyGrade,
      status: 'differs',
      held: [{ unit: 'label', class: 'diverged', a: 'Honey quality', b: 'Honey grade' }],
    },
  ])
  expect(sim.writes()).toEqual([])
})

test('pull acme-eu after a UI edit of its overridden label: the override takes it, the shared file and acme-us do not', async () => {
  const sim = portals()
  const dir = await appliedBoth(sim)
  const objects = text(dir, objectsFile)
  const usPlan = await planOf(dir, '--target', 'acme-us')
  grade(sim, EU).label = 'Honey tier'

  // --check --exit-code counts the overridden field as a difference, and writes nothing.
  const check = await cli(dir, 'pull', '--target', 'acme-eu', '--check', '--exit-code', '--json')
  expect(check.exitCode, check.stdout).toBe(2)
  expect(parseEnvelope<PullData>(check.stdout).data?.files).toEqual([configFile])
  const config = text(dir, configFile)

  const out = await cli(dir, 'pull', '--target', 'acme-eu', '--json')
  expect(out.exitCode, out.stdout).toBe(0)
  const { data } = parseEnvelope<PullData>(out.stdout)
  expect(data?.files).toEqual([configFile])
  expect(data?.objects.companies?.changes ?? []).toContainEqual({
    kind: 'changed',
    address: honeyGrade,
    field: 'label',
    before: 'Honey class',
    after: 'Honey tier',
  })
  expect(text(dir, objectsFile)).toBe(objects)
  expect(text(dir, configFile)).toBe(config.replace("label: 'Honey class'", "label: 'Honey tier'"))
  // The owned empty description and the option list stay in the override, in portal order, with no alias added.
  expect(text(dir, configFile)).toContain("description: ''")
  // The history holds the config as it was; pull sends no write.
  const history = join(dir, '.kalup', 'history')
  const saved = readdirSync(history).map((stamp) => join(history, stamp, configFile))
  expect(saved.filter(existsSync).map((file) => readFileSync(file, 'utf8'))).toEqual([config])
  expect(sim.writes()).toEqual([])
  const us = await planOf(dir, '--target', 'acme-us')
  expect(us.writesHash).toBe(usPlan.writesHash)
  expect(effects(us)).toEqual([])
  // acme-eu now agrees with its portal; the plan only records the new base.
  const eu = await planOf(dir, '--target', 'acme-eu')
  expect(stepOf(eu)?.changes ?? []).toEqual([])
  expect(stepOf(eu)?.held ?? []).toEqual([])
})

test('pull acme-us after a UI edit of the same label: the shared file takes it, the acme-eu override stays', async () => {
  const sim = portals()
  const dir = await appliedBoth(sim)
  const config = text(dir, configFile)
  grade(sim, US).label = 'Honey type'
  const out = await cli(dir, 'pull', '--target', 'acme-us', '--json')
  expect(out.exitCode, out.stdout).toBe(0)
  expect(parseEnvelope<PullData>(out.stdout).data?.files).toEqual([objectsFile])
  expect(text(dir, objectsFile)).toContain("label: 'Honey type'")
  expect(text(dir, configFile)).toBe(config)
  expect(text(dir, configFile)).toContain("label: 'Honey class'")
  // acme-eu's effective label is still its override, which its portal holds.
  expect((await compared(dir, 'acme-eu')).exitCode).toBe(0)
})

test('pull acme-eu after HubSpot moves a property whose group it overrides into a new group: no shared group for acme-us', async () => {
  const sim = portals()
  const override = "      overrides: { 'property:companies/honey_grade': { definition: { group: 'yard' } } },\n"
  const dir = await project(override, '', `${APIARY}    yard: { label: 'Yard' },\n`)
  await applyTarget(dir, 'acme-eu')
  await applyTarget(dir, 'acme-us')
  const config = text(dir, configFile)
  const objects = text(dir, objectsFile)
  const usPlan = await planOf(dir, '--target', 'acme-us')
  sim.object(EU, 'companies').groups.set('field', { name: 'field', label: 'Field', displayOrder: -1, archived: false })
  grade(sim, EU).groupName = 'field'

  // Writing the portal's group would add a shared group every other target's plan creates: the override keeps its
  // group, and the difference counts.
  const check = await cli(dir, 'pull', '--target', 'acme-eu', '--check', '--exit-code', '--json')
  expect(check.exitCode, check.stdout).toBe(2)
  const out = await cli(dir, 'pull', '--target', 'acme-eu', '--json')
  expect(out.exitCode, out.stdout).toBe(0)
  const { data } = parseEnvelope<PullData>(out.stdout)
  expect(data?.files).toEqual([])
  expect(data?.objects.companies?.changes).toEqual([
    { kind: 'override-group', address: honeyGrade, field: 'group', before: 'yard', after: 'field' },
  ])
  const human = await cli(dir, 'pull', '--target', 'acme-eu', '--check')
  expect(normalise(human.stdout)).toMatchInlineSnapshot(`
    "Target acme-eu, portal 7700002
    companies: 0 added, 0 changed, 3 unchanged, 0 missing in portal
      its portal group is not in config, override kept: property:companies/honey_grade#group "yard" -> "field"
    Files are up to date
    "
  `)
  expect(text(dir, configFile)).toBe(config)
  expect(text(dir, objectsFile)).toBe(objects)
  const us = await planOf(dir, '--target', 'acme-us')
  expect(us.writesHash).toBe(usPlan.writesHash)
  expect(effects(us)).toEqual([])

  // With the group added to config by hand, the next pull takes it into the override.
  edit(
    dir,
    objectsFile,
    "    apiary: { label: 'Apiary' },\n",
    "    apiary: { label: 'Apiary' },\n    field: { label: 'Field' },\n",
  )
  const added = await cli(dir, 'pull', '--target', 'acme-eu', '--json')
  expect(added.exitCode, added.stdout).toBe(0)
  expect(parseEnvelope<PullData>(added.stdout).data?.files).toEqual([configFile])
  expect(text(dir, configFile)).toBe(config.replace("group: 'yard'", "group: 'field'"))
})

test('pull acme-eu of a field only its own lifecycle ignores: the shared file keeps its value, acme-us is unaffected', async () => {
  const sim = portals()
  const override = `      overrides: {
        'property:companies/honey_grade': { definition: { lifecycle: { ignoreChanges: ['label'] } } },
      },
`
  const dir = await project(override)
  await applyTarget(dir, 'acme-eu')
  await applyTarget(dir, 'acme-us')
  const config = text(dir, configFile)
  const objects = text(dir, objectsFile)
  const usPlan = await planOf(dir, '--target', 'acme-us')
  grade(sim, EU).label = 'Honey class'
  // The label is left to the acme-eu portal: its plan has nothing to do.
  expect(effects(await planOf(dir, '--target', 'acme-eu'))).toEqual([])

  const check = await cli(dir, 'pull', '--target', 'acme-eu', '--check', '--exit-code', '--json')
  expect(check.exitCode, check.stdout).toBe(0)
  const out = await cli(dir, 'pull', '--target', 'acme-eu', '--json')
  expect(out.exitCode, out.stdout).toBe(0)
  const { data } = parseEnvelope<PullData>(out.stdout)
  expect(data?.files).toEqual([])
  expect(data?.objects.companies?.changes).toEqual([{ kind: 'ignored', address: honeyGrade, field: 'label' }])
  expect(text(dir, objectsFile)).toBe(objects)
  expect(text(dir, configFile)).toBe(config)
  const us = await planOf(dir, '--target', 'acme-us')
  expect(us.writesHash).toBe(usPlan.writesHash)
  expect(effects(us)).toEqual([])
})

test('a pull that changes kalup.config.ts and an object file writes both or neither', async () => {
  const sim = portals()
  const dir = await appliedBoth(sim)
  const config = text(dir, configFile)
  const objects = text(dir, objectsFile)
  // The label is acme-eu's override, the fieldType the shared file's.
  grade(sim, EU).label = 'Honey tier'
  grade(sim, EU).fieldType = 'radio'
  const check = await cli(dir, 'pull', '--target', 'acme-eu', '--check', '--json')
  expect(parseEnvelope<PullData>(check.stdout).data?.files).toEqual([configFile, objectsFile])

  const folder = join(dir, 'kalup', 'objects')
  chmodSync(folder, 0o555)
  readOnly.push(folder)
  const out = await cli(dir, 'pull', '--target', 'acme-eu', '--json')
  expect(out.exitCode, out.stdout).toBe(1)
  expect(parseEnvelope(out.stdout).issues.map((i) => i.code)).toEqual(['E_PROJECT_WRITE'])
  expect(text(dir, configFile)).toBe(config)
  expect(text(dir, objectsFile)).toBe(objects)

  chmodSync(folder, 0o755)
  const retried = await cli(dir, 'pull', '--target', 'acme-eu', '--json')
  expect(retried.exitCode, retried.stdout).toBe(0)
  expect(text(dir, configFile)).toContain("label: 'Honey tier'")
  expect(text(dir, objectsFile)).toContain("fieldType: 'radio'")
})

test('an owned empty description on one target survives fmt, pull and plan', async () => {
  const sim = portals()
  const dir = await appliedBoth(sim)
  const fmt = await cli(dir, 'fmt', '--check', '--exit-code')
  expect(fmt.exitCode, fmt.stdout).toBe(0)
  expect(text(dir, configFile)).toContain("description: ''")
  // HubSpot now holds a description on acme-eu: drift against the owned empty one, which pull takes into the override.
  grade(sim, EU).description = 'Set in HubSpot'
  const drifted = await planOf(dir, '--target', 'acme-eu')
  expect(stepOf(drifted)?.held).toEqual([
    expect.objectContaining({ unit: 'description', class: 'drift', config: '', live: 'Set in HubSpot' }),
  ])
  grade(sim, EU).description = ''
  const pulled = await cli(dir, 'pull', '--target', 'acme-eu', '--json')
  expect(pulled.exitCode, pulled.stdout).toBe(0)
  expect(parseEnvelope<PullData>(pulled.stdout).data?.files).toEqual([])
  expect(text(dir, configFile)).toContain("description: ''")
  await planIsEmpty(dir, '--target', 'acme-eu')
})

test('a lookup override still blocks the resource in plan, with the reason, and compare reports it unknown', async () => {
  portals()
  const us = "      overrides: { 'group:companies/apiary': { lookup: { name: 'Apiary' } } },\n"
  const dir = await project(EU_OVERRIDE, us)
  const plan = await planOf(dir, '--target', 'acme-us')
  expect(plan.steps.find((s) => s.address === 'group:companies/apiary')).toMatchObject({
    risk: 'blocked',
    blocked: {
      reason: 'override',
      detail: expect.stringContaining('lookup resources'),
    },
  })
  const out = await compared(dir, 'acme-us')
  expect(out.exitCode).toBe(1)
  expect(out.data.differences).toContainEqual({
    address: 'group:companies/apiary',
    status: 'unknown',
    reason: expect.stringContaining('lookup override'),
  })
  expect(stableStringify(plan)).not.toContain('Honey class')
})
