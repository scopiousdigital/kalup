import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plan } from '@kalup/core'
import { afterEach, expect, test, vi } from 'vitest'
import type { SnapshotData } from '../../src/commands/snapshot.js'
import { cli, copy, empty, parseEnvelope } from '../../src/commands/testing.js'
import { type Comparison, compareText } from '../../src/engine/compare.js'
import { fakeFetch, fixture, jsonResponse } from '../../src/lib/testing.js'
import { type Bodies, edit, inSync, key, orchard, portal, refused, routes } from './orchard.js'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const reads = [
  'GET /account-info/2026-09/details',
  'GET /crm-object-schemas/2026-09/schemas',
  'GET /crm/properties/2026-09/companies',
  'GET /crm/properties/2026-09/companies?dataSensitivity=sensitive',
  'GET /crm/properties/2026-09/companies?dataSensitivity=highly_sensitive',
  'GET /crm/properties/2026-09/companies/groups',
  'GET /crm/properties/2026-09/2-4242001',
  'GET /crm/properties/2026-09/2-4242001?dataSensitivity=sensitive',
  'GET /crm/properties/2026-09/2-4242001?dataSensitivity=highly_sensitive',
  'GET /crm/properties/2026-09/2-4242001/groups',
]
const sandbox = { kind: 'target', name: 'sandbox', portalId: 1_111_111 }
const stagingKey = 'kalup-test-secret-b3c9'

/** The pull project with a second target, staging, on portal 2222222 and its own key. */
function twoTargets(dir: string): string {
  edit(
    dir,
    'kalup.config.ts',
    '    },\n  },\n})',
    "    },\n    staging: {\n      portalId: 2222222,\n      credentials: { read: { env: 'HUBSPOT_STAGING_KEY' } },\n    },\n  },\n})",
  )
  vi.stubEnv('HUBSPOT_STAGING_KEY', stagingKey)
  return dir
}

async function snapshotOf(dir: string, ...flags: string[]): Promise<SnapshotData> {
  const out = await cli(dir, 'snapshot', '--target', 'sandbox', ...flags, '--json')
  if (out.exitCode !== 0) {
    throw new Error(`the snapshot failed: ${out.stdout}`)
  }
  return parseEnvelope<SnapshotData>(out.stdout).data as SnapshotData
}

test('compare config <target> right after a pull of the same portal is complete, and exits 0 with --exit-code', async () => {
  const dir = await inSync()
  const { calls } = portal()
  const out = await cli(dir, 'compare', 'config', 'sandbox', '--exit-code', '--json')
  expect(out.exitCode).toBe(0)
  expect(out.stderr).toBe('')
  const env = parseEnvelope<Comparison>(out.stdout)
  expect(env.ok).toBe(true)
  const comparison = env.data as Comparison
  expect(comparison.a).toEqual({ kind: 'config' })
  expect(comparison.b).toEqual(sandbox)
  expect(comparison.complete).toBe(true)
  expect(comparison.counts).toMatchObject({ differs: 0, onlyA: 0, onlyB: 0, unknown: 0 })
  // What only the portal holds, a built-in group or a property no builder carries, is unmanaged: never a difference.
  expect(comparison.differences.map((d) => d.status)).toEqual(comparison.differences.map(() => 'unmanaged'))
  expect(comparison.differences.map((d) => d.address)).toContain('property:companies/plot_shape')
  expect(comparison.differences.map((d) => d.address)).toContain('group:companies/companyinformation')
  // Compare reads what observe reads, nothing more: no Limits Tracking, no archived list.
  expect(calls).toEqual(reads)
})

test('portal names no address can hold are left out with a warning: compare, plan and snapshot all complete', async () => {
  const dir = await inSync()
  const spaced = (): Bodies => {
    const bodies = orchard()
    bodies[`${routes.companies}?dataSensitivity=highly_sensitive`] = fixture('api/orchard/companies.spaced.json')
    ;(bodies[routes.companyGroups] as { results: unknown[] }).results.push({ name: 'odd group', label: 'Odd' })
    return bodies
  }
  const codes = (stdout: string) => parseEnvelope(stdout).issues.map((issue) => issue.code)
  portal({ [key]: spaced() })
  const compared = await cli(dir, 'compare', 'config', 'sandbox', '--exit-code', '--json')
  expect(compared.exitCode).toBe(0)
  expect(parseEnvelope<Comparison>(compared.stdout).data?.complete).toBe(true)
  expect(codes(compared.stdout)).toContain('W_UNADDRESSABLE_NAME')
  portal({ [key]: spaced() })
  const planned = await cli(dir, 'plan', '--target', 'sandbox', '--json')
  expect(planned.exitCode).toBe(0)
  expect(codes(planned.stdout)).toContain('W_UNADDRESSABLE_NAME')
  portal({ [key]: spaced() })
  const taken = await cli(dir, 'snapshot', '--target', 'sandbox', '--out', 'spaced.json', '--json')
  expect(taken.exitCode).toBe(0)
  expect(codes(taken.stdout)).toContain('W_UNADDRESSABLE_NAME')
  const back = await cli(dir, 'compare', 'config', 'spaced.json', '--exit-code', '--json')
  expect(back.exitCode).toBe(0)
})

test('a config property the portal moved into a group no address can hold: compare exits 1, plan blocks it', async () => {
  const dir = await inSync()
  const moved = (): Bodies => {
    const bodies = orchard()
    const { results } = bodies[routes.companies] as { results: Record<string, unknown>[] }
    bodies[routes.companies] = {
      results: results.map((p) => (p.name === 'plot_total' ? { ...p, groupName: 'odd group' } : p)),
    }
    ;(bodies[routes.companyGroups] as { results: unknown[] }).results.push({ name: 'odd group', label: 'Odd' })
    return bodies
  }
  const codes = (stdout: string) => parseEnvelope(stdout).issues.map((issue) => issue.code)
  portal({ [key]: moved() })
  const compared = await cli(dir, 'compare', 'config', 'sandbox', '--exit-code', '--json')
  expect(compared.exitCode).toBe(1)
  expect(parseEnvelope<Comparison>(compared.stdout).data?.differences).toContainEqual({
    address: 'property:companies/plot_total',
    status: 'unknown',
    reason: "target sandbox could not capture it: its group's name in the portal holds whitespace",
  })
  expect(codes(compared.stdout)).toEqual(expect.arrayContaining(['E_INCOMPLETE', 'W_UNADDRESSABLE_NAME']))
  portal({ [key]: moved() })
  const planned = await cli(dir, 'plan', '--target', 'sandbox', '--json')
  expect(planned.exitCode).toBe(0)
  const plan = parseEnvelope<Plan>(planned.stdout).data
  expect(plan?.coverage.complete).toBe(false)
  expect(plan?.coverage.excluded).toEqual([])
  expect(plan?.steps.find((s) => s.address === 'property:companies/plot_total')?.blocked?.reason).toBe('unsupported')
  // The snapshot of the same read says it is incomplete, as compare and plan do, and so does its dictionary.
  portal({ [key]: moved() })
  const taken = await cli(dir, 'snapshot', '--target', 'sandbox', '--out', 'moved.json', '--json')
  expect(taken.exitCode).toBe(0)
  expect(parseEnvelope<SnapshotData>(taken.stdout).data?.complete).toBe(false)
  expect(codes(taken.stdout)).toEqual(expect.arrayContaining(['W_INCOMPLETE', 'W_UNADDRESSABLE_NAME']))
  const documented = await cli(dir, 'docs', 'moved.json')
  expect(documented.stdout).toContain('The read was incomplete')
  expect(documented.stderr).toContain('W_INCOMPLETE')
  portal({ [key]: moved() })
  const since = await cli(dir, 'compare', 'moved.json', 'sandbox', '--json')
  expect(since.exitCode).toBe(1)
  expect(parseEnvelope(since.stdout).issues.find((issue) => issue.code === 'E_INCOMPLETE')?.fix).toBe(
    'rename the group of property:companies/plot_total in HubSpot to a name without spaces, then read the portal again',
  )
})

test('differences exit 0, or 2 with --exit-code and ok true; the text is compareText of the same comparison', async () => {
  const dir = copy('pull')
  portal()
  const plain = await cli(dir, 'compare', 'config', 'sandbox', '--json')
  expect(plain.exitCode).toBe(0)
  const comparison = parseEnvelope<Comparison>(plain.stdout).data as Comparison
  expect(comparison.complete).toBe(true)
  expect(comparison.counts.differs).toBeGreaterThan(0)
  expect(comparison.differences).toContainEqual({
    address: 'group:companies/orchard',
    status: 'differs',
    held: [{ unit: 'label', class: 'diverged', a: 'Orchard', b: 'Orchard details' }],
  })
  portal()
  const coded = await cli(dir, 'compare', 'config', 'sandbox', '--exit-code', '--json')
  expect(coded.exitCode).toBe(2)
  expect(parseEnvelope(coded.stdout).ok).toBe(true)
  portal()
  const human = await cli(dir, 'compare', 'config', 'sandbox')
  expect(human.exitCode).toBe(0)
  expect(human.stdout).toBe(compareText(comparison))
})

test("a kept option's note follows the project's pull scope: pull when it covers the property, include when not", async () => {
  const dir = copy('pull')
  const address = 'property:companies/yield_tier'
  // The portal holds the option peak, which config does not list.
  const kept = async () => {
    portal()
    const out = await cli(dir, 'compare', 'config', 'sandbox', '--json')
    const found = parseEnvelope<Comparison>(out.stdout).data?.differences.find((d) => d.address === address)
    return found?.notes?.map((n) => `${n.unit}: ${n.note}`)
  }
  expect(await kept()).toEqual([
    `options[peak]: kept; to add it to config, run kalup pull --target sandbox --only ${address}`,
  ])
  edit(dir, 'kalup.config.ts', 'companies: { include:', 'companies: { custom: false, include:')
  expect(await kept()).toEqual([
    "options[peak]: kept; no pull refreshes it: it is outside the pull scope of companies; add 'yield_tier' to objects.companies.include in kalup.config.ts to take the portal side with pull",
  ])
})

test.each([[[]], [['--exit-code']]])(
  'an object the key cannot read makes compare incomplete: exit 1 and ok false, never 0 or 2 (%j)',
  async (flags) => {
    const dir = await inSync()
    const bodies = orchard()
    bodies[routes.harvestGroups] = refused()
    portal({ [key]: bodies })
    const out = await cli(dir, 'compare', 'config', 'sandbox', ...flags, '--json')
    expect(out.exitCode).toBe(1)
    const env = parseEnvelope<Comparison>(out.stdout)
    expect(env.ok).toBe(false)
    expect(env.data?.complete).toBe(false)
    expect(env.issues.at(-1)).toEqual({
      code: 'E_INCOMPLETE',
      message:
        'compare is incomplete: harvest on target sandbox, whose key lacks crm.schemas.custom.read. Nothing there was compared.',
      fix: 'add the scope crm.schemas.custom.read to the read key, then read the portal again',
      docs: 'errors/E_INCOMPLETE.md',
    })
    // What config holds on harvest is unknown, never only in config: the read proves nothing absent.
    const harvest = env.data?.differences.filter((d) => d.address.includes('harvest')) ?? []
    expect(harvest.length).toBeGreaterThan(0)
    expect(harvest.map((d) => d.status)).toEqual(harvest.map(() => 'unknown'))
  },
)

test('an unreadable object with nothing in config under it still makes compare incomplete', async () => {
  const dir = await inSync()
  edit(dir, 'kalup.config.ts', 'harvest: {},', 'harvest: {},\n    deals: {},')
  portal({ [key]: { ...orchard(), '/crm/properties/2026-09/deals': refused() } })
  const out = await cli(dir, 'compare', 'config', 'sandbox', '--exit-code', '--json')
  expect(out.exitCode).toBe(1)
  const env = parseEnvelope<Comparison>(out.stdout)
  expect(env.data?.counts).toMatchObject({ differs: 0, onlyA: 0, onlyB: 0, unknown: 0 })
  expect(env.issues.at(-1)?.message).toBe(
    'compare is incomplete: deals on target sandbox, whose key lacks crm.schemas.deals.read. Nothing there was compared.',
  )
})

test('snapshot, then compare it with the same portal, either way round: complete and equal', async () => {
  portal()
  const dir = copy('pull')
  const snapshot = await snapshotOf(dir)
  const { file, observedAt } = snapshot
  const snapped = { kind: 'snapshot', file, name: 'sandbox', portalId: 1_111_111, observedAt }
  portal()
  const outs = await Promise.all([
    cli(dir, 'compare', file, 'sandbox', '--exit-code', '--json'),
    cli(dir, 'compare', 'sandbox', file, '--exit-code', '--json'),
  ])
  const sides = [
    [snapped, sandbox],
    [sandbox, snapped],
  ]
  outs.forEach((out, i) => {
    expect(out.exitCode).toBe(0)
    const comparison = parseEnvelope<Comparison>(out.stdout).data as Comparison
    expect(comparison.complete).toBe(true)
    expect(comparison.differences).toEqual([])
    expect(comparison.counts).toEqual({
      equal: 21,
      differs: 0,
      onlyA: 0,
      onlyB: 0,
      unmanaged: 0,
      unknown: 0,
      excluded: 0,
    })
    expect([comparison.a, comparison.b]).toEqual(sides[i])
  })
})

test('two snapshot files need no project and send no request; one edited label differs, exit 2', async () => {
  portal()
  const dir = copy('pull')
  const snapshot = await snapshotOf(dir, '--out', 'a.json')
  expect(snapshot.file).toBe('a.json')
  const outside = empty()
  const text = readFileSync(join(dir, 'a.json'), 'utf8')
  const edited = JSON.parse(text)
  edited.resources['group:companies/orchard'].definition.label = 'Orchard notes'
  writeFileSync(join(outside, 'a.json'), text)
  writeFileSync(join(outside, 'b.json'), JSON.stringify(edited))
  const fake = fakeFetch()
  vi.stubGlobal('fetch', fake.fetch)
  expect((await cli(outside, 'compare', 'a.json', 'a.json', '--exit-code')).exitCode).toBe(0)
  const out = await cli(outside, 'compare', 'a.json', 'b.json', '--exit-code', '--json')
  expect(out.exitCode).toBe(2)
  expect(parseEnvelope<Comparison>(out.stdout).data?.differences).toEqual([
    {
      address: 'group:companies/orchard',
      status: 'differs',
      held: [{ unit: 'label', class: 'diverged', a: 'Orchard details', b: 'Orchard notes' }],
    },
  ])
  // A project that does not validate is no obstacle when neither side is config or a target.
  edit(dir, 'kalup.config.ts', 'portalId: 1111111', 'portalId: 0')
  expect((await cli(dir, 'compare', 'a.json', 'a.json', '--exit-code')).exitCode).toBe(0)
  expect(fake.calls).toEqual([])
})

test('a side that is no target and no file is E_SNAPSHOT, exit 1; a file that is not a snapshot is exit 3', async () => {
  const fake = fakeFetch()
  vi.stubGlobal('fetch', fake.fetch)
  const dir = copy('pull')
  const missing = await cli(dir, 'compare', 'config', 'staging', '--json')
  expect(missing.exitCode).toBe(1)
  expect(parseEnvelope(missing.stdout).issues).toEqual([
    {
      code: 'E_SNAPSHOT',
      message: "'staging' is neither config, a target declared in kalup.config.ts nor a file",
      file: 'staging',
      fix: 'pass config, a target declared in kalup.config.ts, or a file the snapshot command wrote',
      docs: 'errors/E_SNAPSHOT.md',
    },
  ])
  writeFileSync(join(dir, 'notes.txt'), 'not a snapshot\n')
  const notJson = await cli(dir, 'compare', 'notes.txt', 'config', '--json')
  expect(notJson.exitCode).toBe(1)
  expect(parseEnvelope(notJson.stdout).issues[0]).toMatchObject({ code: 'E_SNAPSHOT', file: 'notes.txt' })
  writeFileSync(join(dir, 'ir.json'), (await cli(dir, 'ir')).stdout)
  const notSnapshot = await cli(dir, 'compare', 'config', 'ir.json', '--json')
  expect(notSnapshot.exitCode).toBe(3)
  expect(parseEnvelope(notSnapshot.stdout).issues[0]).toMatchObject({ code: 'E_SNAPSHOT', file: 'ir.json' })
  const golden = fixture('snapshot/orchard.json') as { resources: Record<string, unknown> }
  golden.resources['group:companies/orchard'] = { type: 'group', managed: 'yes' }
  writeFileSync(join(dir, 'broken.json'), JSON.stringify(golden))
  const broken = await cli(dir, 'compare', 'broken.json', 'config', '--json')
  expect(broken.exitCode).toBe(3)
  expect(parseEnvelope(broken.stdout).issues[0]).toMatchObject({ code: 'E_IR_SCHEMA', file: 'broken.json' })
  expect(fake.calls).toEqual([])
})

test('a config or target side needs a valid project: exit 3 before any request', async () => {
  const fake = fakeFetch()
  vi.stubGlobal('fetch', fake.fetch)
  const dir = copy('pull')
  edit(dir, 'kalup.config.ts', 'portalId: 1111111', 'portalId: 0')
  const outs = await Promise.all([
    cli(dir, 'compare', 'config', 'config', '--json'),
    cli(dir, 'compare', 'sandbox', 'config', '--json'),
  ])
  for (const out of outs) {
    expect(out.exitCode).toBe(3)
    expect(parseEnvelope(out.stdout).issues[0]?.code).toBe('E_PORTAL_ID')
  }
  const outside = await cli(empty(), 'compare', 'config', 'sandbox', '--json')
  expect(outside.exitCode).toBe(1)
  expect(parseEnvelope(outside.stdout).issues[0]?.code).toBe('E_NO_CONFIG')
  // A config that does not load hides its targets: a side that is no file may be one, so the config issues come first.
  const unloadable = copy('pull')
  edit(unloadable, 'kalup.config.ts', 'harvest: {},', 'harvest: nope,')
  const hidden = await cli(unloadable, 'compare', 'sandbox', 'a.json', '--json')
  expect(hidden.exitCode).toBe(3)
  expect(parseEnvelope(hidden.stdout).issues[0]).toMatchObject({ code: 'E_NOT_DATA', file: 'kalup.config.ts' })
  // A custom object under a standard object's key: validate rejects it, so compare never reads the portal.
  const standard = copy('pull')
  edit(standard, 'kalup/objects/companies.ts', 'import { defineObject,', 'import { defineCustomObject,')
  edit(
    standard,
    'kalup/objects/companies.ts',
    "defineObject('companies', {",
    "defineCustomObject('companies', {\n  labels: { singular: 'Company', plural: 'Companies' },\n  primaryDisplayProperty: 'name',",
  )
  const custom = await cli(standard, 'compare', 'config', 'sandbox', '--json')
  expect(custom.exitCode).toBe(3)
  expect(parseEnvelope(custom.stdout).issues[0]?.code).toBe('E_STANDARD_OBJECT')
  expect(fake.calls).toEqual([])
})

test('two targets: each side has its own key, client and portal guard, and the guards come before any read', async () => {
  const dir = twoTargets(copy('pull'))
  const staging = orchard()
  staging[routes.account] = { ...fixture('account-info.json'), portalId: 2_222_222 }
  staging[routes.companyGroups] = {
    results: (fixture('api/orchard/companies.groups.json').results as { name: string }[]).map((g) =>
      g.name === 'orchard' ? { ...g, label: 'Orchard notes' } : g,
    ),
  }
  const sent = portal({ [key]: orchard(), [stagingKey]: staging })
  const out = await cli(dir, 'compare', 'sandbox', 'staging', '--exit-code', '--json')
  expect(out.exitCode).toBe(2)
  const env = parseEnvelope<Comparison>(out.stdout)
  const comparison = env.data as Comparison
  expect(comparison.complete).toBe(true)
  expect(comparison.b).toEqual({ kind: 'target', name: 'staging', portalId: 2_222_222 })
  // Both portals hold the property no builder carries: the warning is listed once.
  expect(env.issues.map((issue) => issue.code)).toEqual(['W_UNSUPPORTED_TYPE'])
  expect(comparison.differences).toEqual([
    {
      address: 'group:companies/orchard',
      status: 'differs',
      held: [{ unit: 'label', class: 'diverged', a: 'Orchard details', b: 'Orchard notes' }],
    },
  ])
  expect(sent.calls.slice(0, 2)).toEqual([reads[0], reads[0]])
  expect(sent.keys).toEqual([
    key,
    stagingKey,
    ...reads.slice(1).map(() => key),
    ...reads.slice(1).map(() => stagingKey),
  ])

  // The staging key belongs to the sandbox portal: exit 4 once the guards ran, and nothing was read.
  const mismatch = portal({ [key]: orchard(), [stagingKey]: orchard() })
  const out4 = await cli(dir, 'compare', 'sandbox', 'staging', '--json')
  expect(out4.exitCode).toBe(4)
  expect(parseEnvelope(out4.stdout).issues[0]).toMatchObject({
    code: 'E_TARGET_PORTAL_MISMATCH',
    configPath: 'targets.staging.portalId',
  })
  expect(mismatch.calls).toEqual([reads[0], reads[0]])
})

test.each([
  ['config', 'sandbox'],
  ['sandbox', 'config'],
])(
  "compare %s %s: the config side is the target's effective config, its definition overrides applied",
  async (a, b) => {
    const dir = await inSync()
    const objects = 'kalup/objects/companies.ts'
    // The shared label differs from the portal's; the sandbox override states the portal's.
    edit(dir, objects, "orchard: { label: 'Orchard details' }", "orchard: { label: 'Orchard' }")
    portal()
    const before = await cli(dir, 'compare', a, b, '--exit-code', '--json')
    expect(before.exitCode).toBe(2)
    const config = a === 'config' ? 'a' : 'b'
    const portalSide = config === 'a' ? 'b' : 'a'
    expect(parseEnvelope<Comparison>(before.stdout).data?.differences).toContainEqual({
      address: 'group:companies/orchard',
      status: 'differs',
      held: [{ unit: 'label', class: 'diverged', [config]: 'Orchard', [portalSide]: 'Orchard details' }],
    })
    edit(
      dir,
      'kalup.config.ts',
      'credentials:',
      "overrides: { 'group:companies/orchard': { definition: { label: 'Orchard details' } } },\n      credentials:",
    )
    portal()
    const after = await cli(dir, 'compare', a, b, '--exit-code', '--json')
    expect(after.exitCode, after.stdout).toBe(0)
    expect(parseEnvelope<Comparison>(after.stdout).data?.counts).toMatchObject({ differs: 0, unknown: 0 })
    // compare config config is the shared config on both sides.
    const same = await cli(dir, 'compare', 'config', 'config', '--exit-code', '--json')
    expect(same.exitCode).toBe(0)
  },
)

test.each([
  ['config', 'sandbox'],
  ['sandbox', 'config'],
])('a lookup override on the target side is unknown, never equal: compare %s %s exits 1', async (a, b) => {
  const dir = await inSync()
  edit(
    dir,
    'kalup.config.ts',
    'credentials:',
    "overrides: { 'group:companies/orchard': { lookup: { name: 'Orchard' } } },\n      credentials:",
  )
  portal()
  const out = await cli(dir, 'compare', a, b, '--exit-code', '--json')
  expect(out.exitCode).toBe(1)
  const env = parseEnvelope<Comparison>(out.stdout)
  expect(env.data?.differences).toContainEqual({
    address: 'group:companies/orchard',
    status: 'unknown',
    reason: 'target sandbox has a lookup override for it; this version manages no lookup resources',
  })
  expect(env.issues.at(-1)?.code).toBe('E_INCOMPLETE')
})

const failing: Record<string, () => Bodies> = {
  success: orchard,
  '401': () => ({ ...orchard(), [routes.companies]: jsonResponse(401, fixture('errors/unauthorized.json')) }),
  'portal mismatch': () => ({ [routes.account]: { ...fixture('account-info.json'), portalId: 2 } }),
  incomplete: () => ({ ...orchard(), [routes.harvest]: refused() }),
  'nothing answers': () => ({}),
}

test.each(
  Object.entries(failing).flatMap(([name, bodies]) => [
    { name, bodies, json: [] },
    { name, bodies, json: ['--json'] },
  ]),
)('key hygiene: no output carries the key: $name $json', async ({ bodies, json }) => {
  portal({ [key]: bodies() })
  vi.stubEnv('HUBSPOT_SANDBOX_KEY', undefined)
  const dir = copy('pull')
  writeFileSync(join(dir, '.env'), `HUBSPOT_SANDBOX_KEY=${key}\n`)
  const out = await cli(dir, 'compare', 'config', 'sandbox', ...json)
  expect(`${out.stdout}${out.stderr}`.length).toBeGreaterThan(0)
  expect(`${out.stdout}${out.stderr}`).not.toContain(key)
})

const pairs: Record<string, { portals: () => Record<string, Bodies>; exit: number }> = {
  complete: {
    portals: () => ({
      [key]: orchard(),
      [stagingKey]: { ...orchard(), [routes.account]: { ...fixture('account-info.json'), portalId: 2_222_222 } },
    }),
    exit: 0,
  },
  'staging key on the sandbox portal': { portals: () => ({ [key]: orchard(), [stagingKey]: orchard() }), exit: 4 },
  'staging key refused': { portals: () => ({ [key]: orchard() }), exit: 1 },
}

test.each(
  Object.entries(pairs).flatMap(([name, pair]) => [
    { name, ...pair, json: [] },
    { name, ...pair, json: ['--json'] },
  ]),
)('key hygiene with two targets: neither key is in stdout or stderr: $name $json', async ({ portals, exit, json }) => {
  const dir = twoTargets(copy('pull'))
  portal(portals())
  const out = await cli(dir, 'compare', 'sandbox', 'staging', ...json)
  expect(out.exitCode).toBe(exit)
  expect(`${out.stdout}${out.stderr}`.length).toBeGreaterThan(0)
  for (const secret of [key, stagingKey]) {
    expect(out.stdout).not.toContain(secret)
    expect(out.stderr).not.toContain(secret)
  }
})
