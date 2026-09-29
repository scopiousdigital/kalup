import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Plan, stableStringify, type TargetState, validatePlan } from '@kalup/core'
import { afterEach, expect, test, vi } from 'vitest'
import { cli, copy, parseEnvelope } from '../../src/commands/testing.js'
import { approvalContext, sha256 } from '../../src/engine/digest.js'
import { planText } from '../../src/engine/plan.js'
import { fixture, jsonResponse } from '../../src/lib/testing.js'
import { version } from '../../src/version.js'
import { golden } from '../engine/plan-harness.js'
import { type Bodies, edit, key, orchard, portal, refused, routes, type Sent, tree } from './orchard.js'

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

test('plan --json is one envelope whose data is the plan/1 document the engine plans from the same reads', async () => {
  const { calls } = portal()
  const out = await cli(copy('pull'), 'plan', '--target', 'sandbox', '--json')
  expect(out.exitCode).toBe(0)
  expect(out.stderr).toBe('')
  const env = parseEnvelope<Plan>(out.stdout)
  expect(env.ok).toBe(true)
  const plan = env.data as Plan
  expect(validatePlan(plan)).toEqual([])
  expect(plan.writesHash).toBe(sha256(stableStringify(approvalContext(plan))))
  expect(plan.planId).toBe(`pl_${plan.writesHash.slice('sha256:'.length, 'sha256:'.length + 12)}`)
  // The engine test plans the same project against the same portal: the same steps bind the same hash.
  const engine = golden('orchard')
  expect(plan.steps).toEqual(engine.steps)
  expect(plan.writesHash).toBe(engine.writesHash)
  expect(plan.generator).toEqual({ name: 'kalup', version })
  expect(plan.target).toEqual({
    name: 'sandbox',
    portalId: 1_111_111,
    accountType: 'SANDBOX',
    uiDomain: 'app-eu1.hubspot.com',
    protected: false,
    drift: 'hold',
    allowDestroy: false,
  })
  expect(env.issues.map((issue) => issue.code)).toEqual(['W_UNSUPPORTED_TYPE', 'W_RATE_HEADERS'])
  // The reads observe, then preflight and the archived names plan asks for: every one a read-tagged GET.
  expect(calls).toEqual([
    ...reads,
    'GET /crm/limits/2026-09/custom-properties',
    'GET /crm/properties/2026-09/companies?archived=true',
    'GET /crm/properties/2026-09/companies?archived=true&dataSensitivity=sensitive',
    'GET /crm/properties/2026-09/companies?archived=true&dataSensitivity=highly_sensitive',
  ])
})

test('plan prints the summary planText renders from the same document, and the warnings on stderr', async () => {
  portal()
  const json = parseEnvelope<Plan>((await cli(copy('pull'), 'plan', '--target', 'sandbox', '--json')).stdout)
  portal()
  const human = await cli(copy('pull'), 'plan', '--target', 'sandbox')
  expect(human.exitCode).toBe(0)
  expect(human.stdout).toBe(planText(json.data as Plan))
  expect(human.stderr).toContain('W_UNSUPPORTED_TYPE: property:companies/plot_shape')
})

test('--out writes the plan with the core serializer, relative to the directory the command runs in', async () => {
  portal()
  const dir = copy('pull')
  const cwd = join(dir, 'kalup', 'objects')
  const out = await cli(cwd, 'plan', '--target', 'sandbox', '--out', 'plans/sandbox.json', '--json')
  expect(out.exitCode).toBe(0)
  const plan = parseEnvelope<Plan>(out.stdout).data as Plan
  const written = readFileSync(join(cwd, 'plans', 'sandbox.json'), 'utf8')
  expect(written).toBe(`${stableStringify(plan)}\n`)
  expect(validatePlan(JSON.parse(written))).toEqual([])
  expect(existsSync(join(dir, 'plans'))).toBe(false)

  // A later plan replaces the file, and the summary names it.
  portal()
  writeFileSync(join(cwd, 'plans', 'sandbox.json'), 'an older plan\n')
  const human = await cli(cwd, 'plan', '--target', 'sandbox', '--out', 'plans/sandbox.json')
  expect(human.exitCode).toBe(0)
  expect(human.stdout).toBe(`${planText(plan)}Wrote plans/sandbox.json\n`)
  expect(readFileSync(join(cwd, 'plans', 'sandbox.json'), 'utf8')).toBe(written)
})

test.each([
  ['240000', 240_000, []],
  ['12.5', null, ['W_RATE_HEADERS']],
  ['', null, ['W_RATE_HEADERS']],
])('a daily remaining header of %j is the budget, or null with W_RATE_HEADERS', async (value, daily, codes) => {
  const headers = {
    'x-hubspot-ratelimit-max': '100',
    'x-hubspot-ratelimit-remaining': '99',
    'x-hubspot-ratelimit-interval-milliseconds': '10000',
    'x-hubspot-ratelimit-daily-remaining': value,
  }
  portal({ [key]: { ...orchard(), [routes.account]: jsonResponse(200, fixture('account-info.json'), headers) } })
  const out = await cli(copy('pull'), 'plan', '--target', 'sandbox', '--json')
  expect(out.exitCode).toBe(0)
  const env = parseEnvelope<Plan>(out.stdout)
  expect(env.data?.budget.dailyRemaining).toBe(daily)
  expect(env.issues.map((issue) => issue.code)).toEqual(['W_UNSUPPORTED_TYPE', ...codes])
})

test('an object the key cannot read: its resources are blocked on scope, never a create, and plan warns', async () => {
  const bodies = orchard()
  bodies[routes.harvest] = refused()
  portal({ [key]: bodies })
  const out = await cli(copy('pull'), 'plan', '--target', 'sandbox', '--json')
  expect(out.exitCode).toBe(0)
  const env = parseEnvelope<Plan>(out.stdout)
  const plan = env.data as Plan
  expect(validatePlan(plan)).toEqual([])
  const harvest = plan.steps.filter((s) => s.address === 'object:harvest' || s.address.includes(':harvest/'))
  expect(harvest.length).toBeGreaterThan(0)
  for (const step of harvest) {
    expect(step, step.address).toMatchObject({ action: 'unknown', risk: 'blocked', blocked: { reason: 'scope' } })
  }
  expect(plan.coverage.complete).toBe(false)
  expect(env.issues.map((issue) => issue.code)).toContain('E_SCOPE')
  expect(env.issues.map((issue) => issue.code)).toContain('W_INCOMPLETE')
})

test('a 403 on an archived properties list stops plan: exit 1, one envelope with E_SCOPE, no plan and no file', async () => {
  const bodies = orchard()
  const refusedList = `${routes.companies}?archived=true&dataSensitivity=sensitive`
  bodies[refusedList] = refused()
  const { calls } = portal({ [key]: bodies })
  const dir = copy('pull')
  const out = await cli(dir, 'plan', '--target', 'sandbox', '--out', 'plan.json', '--json')
  expect(out.exitCode).toBe(1)
  expect(out.stderr).toBe('')
  const env = parseEnvelope(out.stdout)
  expect(env.ok).toBe(false)
  expect(env).not.toHaveProperty('data')
  expect(env.issues).toEqual([
    {
      code: 'E_SCOPE',
      message:
        "HubSpot refused GET /crm/properties/2026-09/companies (403). The key likely lacks the scope crm.schemas.companies.read. HubSpot said: This app hasn't been granted all required scopes",
      fix: 'Add the scope crm.schemas.companies.read to the key.',
      docs: 'errors/E_SCOPE.md',
    },
  ])
  // The refused list is the last request: plan stops there instead of planning around what it could not read.
  expect(calls.at(-1)).toBe(`GET ${refusedList}`)
  expect(existsSync(join(dir, 'plan.json'))).toBe(false)
})

test('several targets and none selected is exit 1, an unknown target or invalid config exit 3, and none sends a request', async () => {
  const { calls } = portal()
  const several = copy('pull')
  edit(several, 'kalup.config.ts', '  targets: {\n', '  targets: {\n    production: { portalId: 2222222 },\n')
  const required = await cli(several, 'plan', '--json')
  expect(required.exitCode).toBe(1)
  expect(parseEnvelope(required.stdout).issues[0]).toMatchObject({
    code: 'E_TARGET_REQUIRED',
    message:
      'kalup.config.ts declares 2 targets and none is selected: production (portal 2222222), sandbox (portal 1111111)',
  })
  const unknown = await cli(copy('pull'), 'plan', '--target', 'production', '--json')
  expect(unknown.exitCode).toBe(3)
  expect(parseEnvelope(unknown.stdout).issues[0]?.code).toBe('E_UNKNOWN_TARGET')
  const dir = copy('pull')
  edit(dir, 'kalup.config.ts', 'portalId: 1111111', 'portalId: 0')
  const invalid = await cli(dir, 'plan', '--target', 'sandbox', '--json')
  expect(invalid.exitCode).toBe(3)
  expect(parseEnvelope(invalid.stdout).ok).toBe(false)
  expect(calls).toEqual([])
})

test.each([
  ['plan', '--target', 'sandbox'],
  ['snapshot', '--target', 'sandbox'],
  ['compare', 'config', 'sandbox'],
])('an override key named like an Object.prototype member is exit 3 before any request: %s', async (...argv) => {
  const { calls } = portal()
  const dir = copy('pull')
  edit(dir, 'kalup.config.ts', 'credentials:', 'overrides: { toString: { skip: true } },\n      credentials:')
  const out = await cli(dir, ...argv, '--json')
  expect(out.exitCode).toBe(3)
  expect(parseEnvelope(out.stdout).issues.map((issue) => issue.code)).toEqual(['E_UNKNOWN_OVERRIDE'])
  expect(calls).toEqual([])
})

test('two name overrides that read one portal name are E_OVERRIDE_NAME, exit 3, before any request', async () => {
  const { calls } = portal()
  const dir = copy('pull')
  const overrides = `overrides: {
        'property:companies/plot_tags': { name: 'legacy_tags' },
        'property:companies/row_meta': { name: 'legacy_tags' },
      },`
  edit(dir, 'kalup.config.ts', 'credentials:', `${overrides}\n      credentials:`)
  const out = await cli(dir, 'plan', '--target', 'sandbox', '--json')
  expect(out.exitCode).toBe(3)
  expect(parseEnvelope(out.stdout).issues).toMatchObject([
    { code: 'E_OVERRIDE_NAME', configPath: 'targets.sandbox.overrides.property:companies/row_meta.name' },
  ])
  expect(calls).toEqual([])
})

test('defineCustomObject on a standard object key is exit 3 before any request, never E_UNEXPECTED', async () => {
  const { calls } = portal()
  const dir = copy('pull')
  edit(dir, 'kalup/objects/companies.ts', 'import { defineObject,', 'import { defineCustomObject,')
  edit(
    dir,
    'kalup/objects/companies.ts',
    "defineObject('companies', {",
    "defineCustomObject('companies', {\n  labels: { singular: 'Company', plural: 'Companies' },\n  primaryDisplayProperty: 'name',",
  )
  const out = await cli(dir, 'plan', '--target', 'sandbox', '--json')
  expect(out.exitCode).toBe(3)
  expect(parseEnvelope(out.stdout).issues.map((issue) => issue.code)).toEqual(['E_STANDARD_OBJECT'])
  expect(calls).toEqual([])
})

test('a portal mismatch exits 4 after the account-info request alone, and writes no --out file', async () => {
  const { calls } = portal({
    [key]: { ...orchard(), [routes.account]: { ...fixture('account-info.json'), portalId: 2 } },
  })
  const dir = copy('pull')
  const out = await cli(dir, 'plan', '--target', 'sandbox', '--out', 'plan.json', '--json')
  expect(out.exitCode).toBe(4)
  expect(parseEnvelope(out.stdout).issues[0]).toMatchObject({ code: 'E_TARGET_PORTAL_MISMATCH', humanRequired: true })
  expect(calls).toEqual(['GET /account-info/2026-09/details'])
  expect(existsSync(join(dir, 'plan.json'))).toBe(false)
})

const failing: Record<string, () => Bodies> = {
  success: orchard,
  '401': () => ({ ...orchard(), [routes.companies]: jsonResponse(401, fixture('errors/unauthorized.json')) }),
  'portal mismatch': () => ({ [routes.account]: { ...fixture('account-info.json'), portalId: 2 } }),
  'limits refused': () => ({ ...orchard(), [routes.propertyLimit]: refused() }),
  'nothing answers': () => ({}),
}

test.each(
  Object.entries(failing).flatMap(([name, bodies]) => [
    { name, bodies, json: [] },
    { name, bodies, json: ['--json'] },
  ]),
)('key hygiene: no output and no written file carries the key: $name $json', async ({ bodies, json }) => {
  portal({ [key]: bodies() })
  vi.stubEnv('HUBSPOT_SANDBOX_KEY', undefined)
  const dir = copy('pull')
  writeFileSync(join(dir, '.env'), `HUBSPOT_SANDBOX_KEY=${key}\n`)
  mkdirSync(join(dir, 'out'))
  const out = await cli(dir, 'plan', '--target', 'sandbox', '--out', 'out/plan.json', ...json)
  expect(`${out.stdout}${out.stderr}`.length).toBeGreaterThan(0)
  expect(`${out.stdout}${out.stderr}`).not.toContain(key)
  for (const [file, text] of Object.entries(tree(join(dir, 'out')))) {
    expect(text, file).not.toContain(key)
  }
})

// State for the orchard portal: it owns plot_total with a base that agrees on everything but the label, which the
// portal below changed, so the label is held as drift. It also owns a property config no longer names.
function orchardState(): TargetState {
  return {
    format: 'kalup.state/1',
    lineage: '0a1b2c3d4e5f6071',
    serial: 4,
    portalId: 1_111_111,
    resources: {
      'property:companies/plot_total': {
        origin: 'created',
        id: 'plot_total',
        normVersion: 1,
        base: { fieldType: 'number', group: { $ref: 'group:companies/orchard' }, label: 'Plot total', type: 'number' },
      },
      'property:companies/pruned': { origin: 'adopted', id: 'pruned', normVersion: 1 },
      'group:companies/legacy': { origin: 'created', id: 'legacy', normVersion: 1, base: { label: 'Legacy' } },
    },
  }
}

/** The orchard portal with plot_total's label changed in HubSpot. */
function drifted(): Sent {
  const bodies = orchard()
  const listed = bodies[routes.companies] as { results: { name: string; label: string }[] }
  bodies[routes.companies] = {
    results: listed.results.map((p) => (p.name === 'plot_total' ? { ...p, label: 'Plot sum' } : p)),
  }
  return portal({ [key]: bodies })
}

function withState(state: TargetState | string): { dir: string; file: string } {
  vi.stubEnv('KALUP_STATE_DIR', undefined)
  const dir = copy('pull')
  mkdirSync(join(dir, '.kalup', 'state'), { recursive: true })
  const file = join(dir, '.kalup', 'state', 'portal-1111111.json')
  writeFileSync(file, typeof state === 'string' ? state : `${stableStringify(state)}\n`)
  return { dir, file }
}

test('plan reads the portal state and never writes it: the file keeps its bytes and mtime, and nothing is added', async () => {
  drifted()
  const { dir, file } = withState(orchardState())
  const before = {
    bytes: readFileSync(file, 'utf8'),
    mtime: statSync(file).mtimeMs,
    files: readdirSync(join(dir, '.kalup', 'state')),
  }
  const out = await cli(dir, 'plan', '--target', 'sandbox', '--json')
  expect(out.exitCode).toBe(0)
  const plan = parseEnvelope<Plan>(out.stdout).data as Plan
  expect(validatePlan(plan)).toEqual([])
  expect(plan).toMatchObject({ stateLineage: '0a1b2c3d4e5f6071', stateSerial: 4 })
  expect(plan.steps.find((s) => s.address === 'property:companies/plot_total')).toMatchObject({
    action: 'update',
    held: [{ unit: 'label', class: 'drift', config: 'Plot total', live: 'Plot sum' }],
  })
  expect(plan.missing.map((m) => m.address)).toEqual(['group:companies/legacy'])
  expect(plan.orphans.map((o) => o.address)).toEqual(['property:companies/pruned'])
  expect(readFileSync(file, 'utf8')).toBe(before.bytes)
  expect(statSync(file).mtimeMs).toBe(before.mtime)
  expect(readdirSync(join(dir, '.kalup', 'state'))).toEqual(before.files)
})

test.each([
  ['running', 'did not finish'],
  ['uncertain', 'left a write whose outcome is unknown'],
] as const)('a last apply left %s makes plan warn W_UNFINISHED_APPLY, exit 0', async (outcome, words) => {
  drifted()
  const lastApply = {
    planId: 'pl_0123456789ab',
    writesHash: `sha256:${'0'.repeat(64)}`,
    actor: 'cli',
    at: '2026-09-24T10:15:30.000Z',
    outcome,
  }
  const { dir } = withState({ ...orchardState(), lastApply })
  const out = await cli(dir, 'plan', '--target', 'sandbox', '--json')
  expect(out.exitCode).toBe(0)
  const issue = parseEnvelope<Plan>(out.stdout).issues.find((i) => i.code === 'W_UNFINISHED_APPLY')
  // The time is the last save's, the end of an uncertain run: the message says at, not started.
  expect(issue?.message).toContain('the last apply (pl_0123456789ab, at 2026-09-24T10:15:30.000Z)')
  expect(issue?.message).toContain(words)
})

test.each(['done', 'partial'] as const)('a last apply that is %s gives no W_UNFINISHED_APPLY', async (outcome) => {
  drifted()
  const lastApply = {
    planId: 'pl_0123456789ab',
    writesHash: `sha256:${'0'.repeat(64)}`,
    actor: 'cli',
    at: '2026-09-24T10:15:30.000Z',
    outcome,
  }
  const { dir } = withState({ ...orchardState(), lastApply })
  const out = await cli(dir, 'plan', '--target', 'sandbox', '--json')
  expect(out.exitCode).toBe(0)
  expect(parseEnvelope<Plan>(out.stdout).issues.map((i) => i.code)).not.toContain('W_UNFINISHED_APPLY')
})

test.each([
  ['not JSON', 'not json\n'],
  ['for another portal', `${JSON.stringify({ ...orchardState(), portalId: 2_222_222 })}\n`],
])('a state file %s stops plan with E_STATE_INVALID and its fix, after the guard alone', async (_, text) => {
  const { calls } = drifted()
  const { dir, file } = withState(text)
  const out = await cli(dir, 'plan', '--target', 'sandbox', '--json')
  expect(out.exitCode).toBe(1)
  const env = parseEnvelope(out.stdout)
  expect(env.issues[0]).toMatchObject({
    code: 'E_STATE_INVALID',
    file,
    fix: 'rename portal-1111111.json.bak, the state before its last save, into its place if it reads; else move the file away and run kalup state rebuild --target sandbox',
  })
  expect(calls).toEqual(['GET /account-info/2026-09/details'])
  expect(readFileSync(file, 'utf8')).toBe(text)
})

const plotTotal = 'property:companies/plot_total'

test.each([
  [['--take', 'config', `${plotTotal}#label`]],
  [['--take', 'config', 'property:companies/p*#label', '--take', 'config', `${plotTotal}#label`]],
])('--take config <address#unit> writes config over a held unit: %j', async (argv) => {
  drifted()
  const { dir } = withState(orchardState())
  const out = await cli(dir, 'plan', '--target', 'sandbox', ...argv, '--json')
  expect(out.exitCode).toBe(0)
  const plan = parseEnvelope<Plan>(out.stdout).data as Plan
  expect(plan.steps.find((s) => s.address === plotTotal)).toMatchObject({
    action: 'update',
    risk: 'risky',
    labels: ['reverts-ui-edit'],
    changes: [{ unit: 'label', class: 'drift', op: 'set', before: 'Plot sum', after: 'Plot total' }],
  })
})

test('several selectors may follow one --take config, and one that matches nothing is E_TAKE_UNMATCHED', async () => {
  drifted()
  const { dir } = withState(orchardState())
  // row_meta holds nothing.
  const argv = ['--take', 'config', `${plotTotal}#label`, 'property:companies/row_*']
  const out = await cli(dir, 'plan', '--target', 'sandbox', ...argv, '--json')
  expect(out.exitCode).toBe(1)
  expect(parseEnvelope(out.stdout).issues).toMatchObject([
    {
      code: 'E_TAKE_UNMATCHED',
      message:
        '--take config property:companies/row_* matches no held unit and no missing resource; nothing is held there',
    },
  ])
})

test.each([
  [['--take', 'property:companies/plot_total#label'], "--take takes config's side only: --take config"],
  [['--take', 'portal', 'property:companies/plot_total'], "--take takes config's side only; to take the portal side"],
  [['--take', 'config'], '--take config names no address'],
  [['--take', 'config', 'config', 'property:companies/plot_total'], '--take config names no address'],
  [['--take', 'config', 'plot_total'], '--take config plot_total is not an address with an optional #unit'],
  [['--take', 'config', 'property:companies/plot_total#'], 'is not an address with an optional #unit'],
])('--take %j is E_USAGE before any request', async (argv, message) => {
  const { calls } = portal()
  const out = await cli(copy('pull'), 'plan', '--target', 'sandbox', ...argv, '--json')
  expect(out.exitCode).toBe(1)
  const [issue] = parseEnvelope(out.stdout).issues
  expect(issue?.code).toBe('E_USAGE')
  expect(issue?.message).toContain(message)
  expect(calls).toEqual([])
})

const TAKEN_LINE =
  /\ns\d+ risky \[reverts-ui-edit\] Update property "Plot total" \(plot_total\) on companies, set label\n/

test('the text shows labels in brackets, both exits on a held line, the missing and orphan sections', async () => {
  drifted()
  const { dir } = withState(orchardState())
  const held = await cli(dir, 'plan', '--target', 'sandbox')
  expect(held.exitCode).toBe(0)
  expect(held.stdout).toContain(
    `  held label: config "Plot total", portal "Plot sum". Take the portal side: kalup pull --target sandbox --only property:companies/plot_total; take config: kalup plan --target sandbox --take config 'property:companies/plot_total#label'\n`,
  )
  expect(held.stdout).toContain(
    '\nMissing in HubSpot, owned in state:\n  group:companies/legacy (created): kalup rm group:companies/legacy --release\n',
  )
  expect(held.stdout).toContain(
    '\nOwned in state, not in config:\n  property:companies/pruned: no longer in config: run kalup rm property:companies/pruned to delete it in HubSpot, or kalup rm property:companies/pruned --release to stop managing it\n',
  )
  drifted()
  const taken = await cli(dir, 'plan', '--target', 'sandbox', '--take', 'config', 'property:companies/plot_total#label')
  expect(taken.exitCode).toBe(0)
  expect(taken.stdout).toMatch(TAKEN_LINE)
})
