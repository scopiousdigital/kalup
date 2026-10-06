// kalup apply through the built host against the stateful simulator. The evidence is what reached the portal (the
// simulator's request log) and the bytes of the state file.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { ApplyData } from '@kalup/engine'
import { type Plan, stableStringify, type TargetState, writesHash } from '@kalup/engine'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  createPortalSim,
  fault,
  type PortalSim,
  type SimPortalInput,
  type SimProperty,
} from '../../../engine/test/support/portal-sim.js'
import { cli, copy, parseEnvelope } from '../../src/commands/testing.js'
import { version } from '../../src/version.js'
import { printed } from '../support/printed.js'
import { settleState } from '../support/settling.js'
import { edit } from './orchard.js'

const key = 'kalup-apply-sandbox-3c8e'
const writeKey = 'kalup-apply-write-91d0'
const portalId = 1_111_111
const companies = '/crm/properties/2026-09/companies'
const groups = `${companies}/groups`
const soilPh = 'property:companies/soil_ph'
const config = 'kalup.config.ts'
const objects = 'hubspot/objects/companies.ts'
const pin = 'portalId: 1111111,'
const readCredential = "credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },"
const writeCredential =
  "credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' }, write: { env: 'HUBSPOT_SANDBOX_WRITE_KEY' } },"
let locks = ''

beforeEach(() => {
  locks = mkdtempSync(join(tmpdir(), 'kalup-locks-'))
  vi.stubEnv('KALUP_LOCK_DIR', locks)
  vi.stubEnv('KALUP_STATE_DIR', undefined)
  vi.stubEnv('HUBSPOT_SANDBOX_KEY', key)
  vi.stubEnv('HUBSPOT_SANDBOX_WRITE_KEY', undefined)
  vi.stubEnv('CI', undefined)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

/** The sandbox portal: companies with HubSpot's own group and name property, and the given extras. */
function portal(extra: Partial<SimPortalInput> = {}): PortalSim {
  const sim = createPortalSim([
    {
      portalId,
      keys: { HUBSPOT_SANDBOX_KEY: key, HUBSPOT_SANDBOX_WRITE_KEY: writeKey },
      objects: {
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
      },
      ...extra,
    },
  ])
  vi.stubGlobal('fetch', sim.fetch)
  return sim
}

/** Runs `hook` before each request reaches the simulator: a change made in HubSpot at that moment. */
function intercept(sim: PortalSim, hook: (method: string, path: string) => void | Promise<void>): void {
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    await hook((init?.method ?? 'GET').toUpperCase(), new URL(String(input)).pathname)
    return sim.fetch(input, init)
  })
}

function statePath(dir: string): string {
  return join(dir, '.kalup', 'state', `portal-${portalId}.json`)
}

function stateOf(dir: string): TargetState {
  return JSON.parse(readFileSync(statePath(dir), 'utf8')) as TargetState
}

function writes(sim: PortalSim): string[] {
  return sim.writes().map((r) => `${r.method} ${r.path}`)
}

function since(sim: PortalSim, from: number): string[] {
  return sim.log.slice(from).map((r) => `${r.method} ${r.path}`)
}

async function saved(dir: string, ...flags: string[]): Promise<Plan> {
  const out = await cli(dir, 'plan', '--out', 'plan.json', '--json', ...flags)
  if (out.exitCode !== 0) {
    throw new Error(`the plan failed: ${out.stdout}`)
  }
  return parseEnvelope<Plan>(out.stdout).data as Plan
}

/** Writes a plan file, with a digest recomputed from its content when `rehash`, as a forger would. */
function writePlan(dir: string, plan: Plan, rehash = false): void {
  const hash = rehash ? writesHash(plan) : plan.writesHash
  const planId = rehash ? `pl_${hash.slice('sha256:'.length, 'sha256:'.length + 12)}` : plan.planId
  writeFileSync(join(dir, 'plan.json'), `${stableStringify({ ...plan, writesHash: hash, planId })}\n`)
}

async function apply(where: string | Parameters<typeof cli>[0], ...argv: string[]) {
  const out = await cli(where, 'apply', ...argv)
  const env = argv.includes('--json') ? parseEnvelope<ApplyData>(out.stdout) : undefined
  return { ...out, env, data: env?.data }
}

function terminal(dir: string, ...answers: string[]) {
  return { cwd: dir, interactive: true, stdin: Readable.from([answers.map((a) => `${a}\n`).join('')]) }
}

/** A project whose group and soil_ph were applied: state owns both. */
async function applied(sim: PortalSim, dir = copy('apply')): Promise<string> {
  await saved(dir)
  const out = await apply(dir, 'plan.json', '--yes', '--json')
  if (out.exitCode !== 0) {
    throw new Error(`the first apply failed: ${out.stdout}`)
  }
  sim.log.length = 0
  return dir
}

const ALREADY = /^Already applied at \S+: plan pl_[0-9a-f]{12} on target sandbox/
const SOIL_PH = / {4}soilPh: p\.number\([\s\S]*?\}\),\n/
const ORCHARD = / {4}orchard: \{ label: 'Orchard' \},\n/

/** Takes soil_ph, and with `group` the orchard group, out of config. */
function dropSoilPh(dir: string, group = false): void {
  const text = readFileSync(join(dir, objects), 'utf8').replace(SOIL_PH, '')
  writeFileSync(join(dir, objects), group ? text.replace(ORCHARD, '') : text)
}

function removed(dir: string, entries: Record<string, 'destroy' | 'release'>): void {
  const lines = Object.entries(entries).map(([address, action]) => `  '${address}': { action: '${action}' },`)
  writeFileSync(
    join(dir, 'hubspot', 'removed.ts'),
    `import { defineRemoved } from '@kalup/core'\n\nexport default defineRemoved({\n${lines.join('\n')}\n})\n`,
  )
}

/** Advances fake time while the run waits on it, letting real I/O through between steps. */
async function onFakeTime<T>(run: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  const pending = { settled: false }
  const result = run().finally(() => {
    pending.settled = true
  })
  await tick(pending)
  return await result
}

// One tick of fake time, then real I/O, until the run settles.
async function tick(pending: { settled: boolean }): Promise<void> {
  if (pending.settled) {
    return
  }
  await vi.advanceTimersByTimeAsync(250)
  await new Promise((resolve) => setImmediate(resolve))
  await tick(pending)
}

// Ordering and a second run

test('a new group and property: POST group before POST property, state owns both, and nothing is left', async () => {
  const sim = portal()
  const dir = copy('apply')
  const plan = await saved(dir)
  const from = sim.log.length
  const first = await apply(dir, 'plan.json', '--yes', '--json')
  expect(first.exitCode, first.stdout).toBe(0)
  expect(first.data).toMatchObject({
    planId: plan.planId,
    target: { name: 'sandbox', portalId },
    approval: 'yes',
    outcome: 'done',
    steps: [
      { id: 's1', address: 'group:companies/orchard', action: 'create', outcome: 'done' },
      { id: 's2', address: soilPh, action: 'create', outcome: 'done' },
    ],
    state: { path: statePath(dir), changed: true },
  })
  expect(writes(sim)).toEqual([`POST ${groups}`, `POST ${companies}`])
  const state = stateOf(dir)
  expect(state.resources).toEqual({
    'group:companies/orchard': {
      origin: 'created',
      id: 'orchard',
      normVersion: 1,
      base: { label: 'Orchard' },
      written: { label: expect.any(String) },
      writtenAt: expect.any(String),
    },
    [soilPh]: {
      origin: 'created',
      id: 'soil_ph',
      normVersion: 1,
      base: {
        description: '',
        formField: false,
        hasUniqueValue: false,
        dataSensitivity: 'non_sensitive',
        displayOrder: -1,
        hidden: false,
        numberDisplayHint: 'formatted',
        showCurrencySymbol: false,
        fieldType: 'number',
        group: { $ref: 'group:companies/orchard' },
        label: 'Soil pH',
        type: 'number',
      },
      written: {
        fieldType: expect.any(String),
        group: expect.any(String),
        label: expect.any(String),
        type: expect.any(String),
      },
      writtenAt: expect.any(String),
    },
  })
  expect(state.lastApply).toMatchObject({ planId: plan.planId, writesHash: plan.writesHash, outcome: 'done' })
  expect(first.data?.state?.serial).toBe(state.serial)
  const journal = readFileSync(first.data?.journal as string, 'utf8')
  expect(journal).not.toContain(key)
  // One line per request under the lock: everything but the guard.
  expect(journal.trim().split('\n').length).toBe(sim.log.length - from - 1)

  // A second plan has no effect, and applying it sends no write and leaves the state file byte-identical.
  const bytes = readFileSync(statePath(dir), 'utf8')
  const again = await saved(dir)
  expect(again.steps).toEqual([])
  const count = sim.writes().length
  const second = await apply(dir, 'plan.json', '--yes', '--json')
  expect(second.exitCode).toBe(0)
  expect(second.data?.outcome).toBe('nothing')
  expect(sim.writes().length).toBe(count)
  expect(readFileSync(statePath(dir), 'utf8')).toBe(bytes)

  // Replaying the first plan: already applied, no write.
  writePlan(dir, plan)
  const replay = await apply(dir, 'plan.json', '--yes')
  expect(replay.exitCode).toBe(0)
  expect(replay.stdout).toMatch(ALREADY)
  expect(sim.writes().length).toBe(count)
  expect(readFileSync(statePath(dir), 'utf8')).toBe(bytes)
})

test('apply without a file plans the unprotected target now and applies it through the same checks', async () => {
  const sim = portal()
  const dir = copy('apply')
  const out = await apply(dir, '--yes')
  expect(out.exitCode, out.stderr).toBe(0)
  expect(printed(out)).toMatchInlineSnapshot(`
    "Target sandbox, portal 1111111 (the only target)
    Applied plan pl_<id> on target sandbox, portal 1111111
    s1 done Create property group "Orchard" (orchard) on companies
    s2 done Create property "Soil pH" (soil_ph) on companies
    2 done.
    State: <dir>/.kalup/state/portal-1111111.json (serial 4). Journal: <dir>/.kalup/journal/portal-1111111/pl_<id>-<time>.jsonl
    "
  `)
  expect(writes(sim)).toEqual([`POST ${groups}`, `POST ${companies}`])
  const again = await apply(dir, '--yes', '--json')
  expect(again.data?.outcome).toBe('nothing')
  expect(sim.writes().length).toBe(2)
})

test('apply without a file on a protected target and no terminal is E_PROTECTED_SAVED_PLAN after the guard, exit 4', async () => {
  const sim = portal()
  const dir = copy('apply')
  edit(dir, config, pin, `${pin}\n      protected: true,`)
  for (const argv of [['--yes', '--json'], ['--json'], []]) {
    // biome-ignore lint/performance/noAwaitInLoops: serial HubSpot requests against one simulated portal, in order
    const out = await apply(dir, ...argv)
    expect(out.exitCode, argv.join(' ')).toBe(4)
  }
  const out = await apply(dir, '--json')
  expect(out.env?.issues[0]).toEqual({
    code: 'E_PROTECTED_SAVED_PLAN',
    message:
      'target sandbox is protected: applying it without a plan file needs a person at a terminal to confirm the plan, and there is none here (no terminal, --json, or CI set). Nothing was written.',
    fix: 'ask the user to run kalup apply --target sandbox in a terminal, where they confirm it; in CI, apply a plan saved with kalup plan --target sandbox --out after review',
    humanRequired: true,
    docs: 'errors/E_PROTECTED_SAVED_PLAN.md',
  })
  // It stops before it plans: the guard is the only request, each time.
  expect(since(sim, 0)).toEqual(new Array(4).fill('GET /account-info/2026-09/details'))
  expect(writes(sim)).toEqual([])
})

// Stale, destination, policy, lineage

test('a plan the portal moved past is E_PLAN_STALE, with no write', async () => {
  const sim = portal()
  const dir = copy('apply')
  await saved(dir)
  sim
    .object(portalId, 'companies')
    .groups.set('orchard', { name: 'orchard', label: 'Orchard', displayOrder: -1, archived: false })
  const out = await apply(dir, 'plan.json', '--yes', '--json')
  expect(out.exitCode).toBe(1)
  expect(out.env?.issues[0]?.code).toBe('E_PLAN_STALE')
  expect(out.env?.issues[0]?.message).toContain('group:companies/orchard exists')
  expect(writes(sim)).toEqual([])
  expect(existsSync(statePath(dir))).toBe(false)
})

test('a plan whose target now pins another portal is E_PLAN_DESTINATION before any request', async () => {
  const sim = portal()
  const dir = copy('apply')
  await saved(dir)
  sim.log.length = 0
  edit(dir, config, pin, 'portalId: 2222222,')
  const out = await apply(dir, 'plan.json', '--yes', '--json')
  expect(out.exitCode).toBe(1)
  expect(out.env?.issues[0]?.code).toBe('E_PLAN_DESTINATION')
  expect(sim.log).toEqual([])
})

test('a plan the next release line of kalup made is E_PLAN_VERSION before any request: plan again', async () => {
  const sim = portal()
  const dir = copy('apply')
  const plan = await saved(dir)
  sim.log.length = 0
  // Before 1.0.0 the next minor release is another release line, from 1.0.0 the next major.
  const [major = 0, minor = 0] = version.split('.').map(Number)
  const next = major === 0 ? `0.${minor + 1}.0` : `${major + 1}.0.0`
  // The generator is outside the digest, so the file keeps its writesHash and passes every other offline check.
  writePlan(dir, { ...plan, generator: { name: 'kalup', version: next } })
  const out = await apply(dir, 'plan.json', '--yes', '--json')
  expect(out.exitCode).toBe(1)
  expect(out.env?.issues[0]?.code).toBe('E_PLAN_VERSION')
  expect(out.env?.issues[0]?.message).toContain(`kalup ${next}`)
  expect(out.env?.issues[0]?.message).toContain(`kalup ${version}`)
  expect(sim.log).toEqual([])
})

test('a policy that changed since the plan is E_POLICY_CHANGED after the guard, naming the field', async () => {
  const sim = portal()
  const dir = copy('apply')
  await saved(dir)
  sim.log.length = 0
  edit(dir, config, pin, `${pin}\n      protected: true,`)
  const out = await apply(dir, 'plan.json', '--yes', '--json')
  expect(out.exitCode).toBe(1)
  expect(out.env?.issues[0]).toMatchObject({ code: 'E_POLICY_CHANGED' })
  expect(out.env?.issues[0]?.message).toContain('protected was false, now true')
  expect(since(sim, 0)).toEqual(['GET /account-info/2026-09/details'])
})

test('another apply in between moves the serial: E_STATE_CHANGED, with no write', async () => {
  const sim = portal()
  const dir = copy('apply')
  await saved(dir)
  const first = readFileSync(join(dir, 'plan.json'), 'utf8')
  edit(dir, objects, "label: 'Orchard'", "label: 'Orchard details'")
  await saved(dir)
  expect((await apply(dir, 'plan.json', '--yes')).exitCode).toBe(0)
  const count = sim.writes().length
  writeFileSync(join(dir, 'plan.json'), first)
  const out = await apply(dir, 'plan.json', '--yes', '--json')
  expect(out.exitCode).toBe(1)
  expect(out.env?.issues[0]?.code).toBe('E_STATE_CHANGED')
  expect(sim.writes().length).toBe(count)
})

// Edited plan files

test('an edited title applies: titles are display only, and the confirmation shows the trusted title', async () => {
  const sim = portal()
  const dir = copy('apply')
  const plan = await saved(dir)
  const steps = plan.steps.map((s) => (s.id === 's2' ? { ...s, title: 'Tidy up a label' } : s))
  writePlan(dir, { ...plan, steps })
  const out = await apply(terminal(dir, 'sandbox'), 'plan.json')
  expect(out.exitCode, out.stderr).toBe(0)
  expect(printed(out)).toMatchInlineSnapshot(`
    "Applied plan pl_<id> on target sandbox, portal 1111111
    s1 done Create property group "Orchard" (orchard) on companies
    s2 done Create property "Soil pH" (soil_ph) on companies
    2 done.
    State: <dir>/.kalup/state/portal-1111111.json (serial 4). Journal: <dir>/.kalup/journal/portal-1111111/pl_<id>-<time>.jsonl
    --- stderr
    Apply plan pl_<id> to target sandbox, portal 1111111 (SANDBOX, not protected):
      s1 safe Create property group "Orchard" (orchard) on companies
      s2 safe Create property "Soil pH" (soil_ph) on companies
    2 writes, 0 destructive
    Type the target name to apply: "
  `)
  expect(out.stderr).not.toContain('Tidy up')
  expect(out.stdout).not.toContain('Tidy up')
  expect(writes(sim)).toEqual([`POST ${groups}`, `POST ${companies}`])
})

/** A plan that takes config over a label edited in HubSpot after the apply settled: risky, labelled reverts-ui-edit. */
async function takenPlan(sim: PortalSim, dir: string): Promise<Plan> {
  settleState(join(dir, '.kalup', 'state'))
  const prop = sim.object(portalId, 'companies').properties.get('soil_ph')
  Object.assign(prop ?? {}, { label: 'Soil reading' })
  const plan = await saved(dir, '--take', 'config', `${soilPh}#label`)
  const [step] = plan.steps
  if (plan.steps.length !== 1 || step?.risk !== 'risky' || !step.labels?.includes('reverts-ui-edit')) {
    throw new Error(`the take is not one risky reverts-ui-edit step: ${JSON.stringify(plan.steps)}`)
  }
  return plan
}

test('a lowered risk, or a dropped reverts-ui-edit label under a recomputed digest, is E_PLAN_RISK with no write', async () => {
  const sim = portal()
  const dir = await applied(sim)
  const plan = await takenPlan(sim, dir)
  const lowered = plan.steps.map((s) => ({ ...s, risk: 'safe' as const }))
  writePlan(dir, { ...plan, steps: lowered })
  const out = await apply(dir, 'plan.json', '--yes', '--json')
  expect(out.exitCode).toBe(1)
  expect(out.env?.issues[0]?.code).toBe('E_PLAN_RISK')
  expect(out.env?.issues[0]?.message).toContain('s1 states risk safe, and it is risky')

  const unlabelled = plan.steps.map(({ labels: _, ...s }) => ({ ...s, risk: 'safe' as const }))
  writePlan(dir, { ...plan, steps: unlabelled }, true)
  const forged = await apply(dir, 'plan.json', '--yes', '--json')
  expect(forged.exitCode).toBe(1)
  expect(forged.env?.issues[0]?.code).toBe('E_PLAN_RISK')
  expect(forged.env?.issues[0]?.message).toContain('leaves out the label reverts-ui-edit')
  expect(writes(sim)).toEqual([])
})

test('an edited desired value is E_PLAN_DIGEST; with a recomputed digest --yes applies it, but not past the risk rules', async () => {
  const sim = portal()
  const dir = copy('apply')
  const plan = await saved(dir)
  const relabelled = plan.steps.map((s) =>
    s.id === 's2' ? { ...s, desired: { ...s.desired, label: 'Soil acidity' } } : s,
  )
  writePlan(dir, { ...plan, steps: relabelled })
  sim.log.length = 0
  const digest = await apply(dir, 'plan.json', '--yes', '--json')
  expect(digest.exitCode).toBe(1)
  expect(digest.env?.issues[0]?.code).toBe('E_PLAN_DIGEST')
  expect(sim.log).toEqual([])

  writePlan(dir, { ...plan, steps: relabelled }, true)
  const forged = await apply(dir, 'plan.json', '--yes', '--json')
  expect(forged.exitCode, forged.stdout).toBe(0)
  expect(sim.writes()[1]?.body).toMatchObject({ name: 'soil_ph', label: 'Soil acidity' })

  const taken = await takenPlan(sim, dir)
  writePlan(dir, { ...taken, steps: taken.steps.map((s) => ({ ...s, risk: 'safe' as const })) }, true)
  const risky = await apply(dir, 'plan.json', '--yes', '--json')
  expect(risky.exitCode).toBe(1)
  expect(risky.env?.issues[0]?.code).toBe('E_PLAN_RISK')
})

test('config changed after planning does not change what apply writes: the plan is the intent', async () => {
  const sim = portal()
  const dir = copy('apply')
  await saved(dir)
  edit(dir, objects, "label: 'Soil pH'", "label: 'Soil acidity'")
  const out = await apply(dir, 'plan.json', '--yes')
  expect(out.exitCode).toBe(0)
  expect(sim.writes()[1]?.body).toMatchObject({ label: 'Soil pH' })
})

// Approval

test('no terminal and no flag: exit 4, humanRequired, the command for a person, no request beyond the guard', async () => {
  const sim = portal()
  const dir = copy('apply')
  await saved(dir)
  sim.log.length = 0
  const out = await apply(dir, 'plan.json', '--json')
  expect(out.exitCode).toBe(4)
  expect(out.env?.issues[0]).toMatchObject({
    code: 'E_APPROVAL_REQUIRED',
    humanRequired: true,
    fix: expect.stringContaining('kalup apply plan.json'),
  })
  expect(JSON.stringify(out.env)).not.toContain('--approve')
  expect(since(sim, 0)).toEqual(['GET /account-info/2026-09/details'])
})

test('--yes on a protected target, with a risky step, or with more than 25 effects is exit 4', async () => {
  const sim = portal()
  const guarded = copy('apply')
  edit(guarded, config, pin, `${pin}\n      protected: true,`)
  await saved(guarded)
  const protectedOut = await apply(guarded, 'plan.json', '--yes', '--json')
  expect(protectedOut.exitCode).toBe(4)
  expect(protectedOut.env?.issues[0]?.message).toContain('target sandbox is protected')

  const dir = await applied(sim)
  await takenPlan(sim, dir)
  const risky = await apply(dir, 'plan.json', '--yes', '--json')
  expect(risky.exitCode).toBe(4)
  expect(risky.env?.issues[0]?.message).toContain('s1 (risky) is not safe')

  const many = copy('apply')
  const extra = Array.from(
    { length: 24 },
    (_, i) => `    plot${i}: p.number('plot_${i}', { label: 'Plot ${i}', group: 'orchard', fieldType: 'number' }),`,
  )
  edit(many, objects, '  properties: {\n', `  properties: {\n${extra.join('\n')}\n`)
  const plan = await saved(many)
  expect(plan.steps.length).toBe(26)
  const tooMany = await apply(many, 'plan.json', '--yes', '--json')
  expect(tooMany.exitCode).toBe(4)
  expect(tooMany.env?.issues[0]?.message).toContain('26 writes')
  expect(writes(sim)).toEqual([])
})

test('--approve applies the reviewed digest with a write key held apart; a wrong digest or a key in .env is refused', async () => {
  const sim = portal()
  const dir = copy('apply')
  edit(dir, config, readCredential, writeCredential)
  const plan = await saved(dir)
  vi.stubEnv('HUBSPOT_SANDBOX_WRITE_KEY', writeKey)

  sim.log.length = 0
  const wrong = await apply(dir, 'plan.json', '--approve', `sha256:${'0'.repeat(64)}`, '--json')
  expect(wrong.exitCode).toBe(1)
  expect(wrong.env?.issues[0]?.code).toBe('E_APPROVE_MISMATCH')
  expect(since(sim, 0)).toEqual(['GET /account-info/2026-09/details'])

  writeFileSync(join(dir, '.env'), `HUBSPOT_SANDBOX_WRITE_KEY=${writeKey}\n`)
  sim.log.length = 0
  const local = await apply(dir, 'plan.json', '--approve', plan.writesHash, '--json')
  expect(local.exitCode).toBe(4)
  expect(local.env?.issues[0]).toMatchObject({ code: 'E_APPROVE_CREDENTIAL', humanRequired: true })
  expect(sim.log).toEqual([])
  expect(`${local.stdout}${local.stderr}`).not.toContain(writeKey)

  rmSync(join(dir, '.env'))
  const from = sim.log.length
  const approved = await apply(dir, 'plan.json', '--approve', plan.writesHash, '--json')
  expect(approved.exitCode, approved.stdout).toBe(0)
  expect(approved.data?.approval).toBe('approve')
  expect(sim.writes().map((r) => r.key)).toEqual(['HUBSPOT_SANDBOX_WRITE_KEY', 'HUBSPOT_SANDBOX_WRITE_KEY'])
  // Every request of the run, the guard and the observation included, went with the write key.
  const run = sim.log.slice(from)
  expect(run[0]).toMatchObject({ method: 'GET', path: '/account-info/2026-09/details' })
  expect(run.length).toBe(14)
  expect(run.map((r) => r.key)).toEqual(new Array(14).fill('HUBSPOT_SANDBOX_WRITE_KEY'))
})

test('at a terminal the person types the target name; a wrong name or the end of input cancels with no write', async () => {
  const sim = portal()
  const dir = copy('apply')
  const plan = await saved(dir)
  const wrong = await apply(terminal(dir, 'production'), 'plan.json')
  expect(wrong.exitCode).toBe(1)
  expect(wrong.stderr).toContain(`Apply plan ${plan.planId} to target sandbox`)
  expect(printed(wrong)).toMatchInlineSnapshot(`
    "--- stderr
    Apply plan pl_<id> to target sandbox, portal 1111111 (SANDBOX, not protected):
      s1 safe Create property group "Orchard" (orchard) on companies
      s2 safe Create property "Soil pH" (soil_ph) on companies
    2 writes, 0 destructive
    Type the target name to apply: E_CANCELLED: Not applied: the answer was not the target name. Nothing was written. (docs: errors/E_CANCELLED.md)
    "
  `)
  const ended = await apply(terminal(dir), 'plan.json')
  expect(ended.exitCode).toBe(1)
  expect(writes(sim)).toEqual([])
  const right = await apply(terminal(dir, 'sandbox'), 'plan.json')
  expect(right.exitCode, right.stderr).toBe(0)
  expect(right.stderr).toContain('Type the target name to apply: ')
  expect(writes(sim)).toEqual([`POST ${groups}`, `POST ${companies}`])
})

// Uncertain and failed writes

test('a POST answered 502 after HubSpot applied it: one POST, the read-back finds it, done', async () => {
  const sim = portal()
  const dir = copy('apply')
  await saved(dir)
  sim.fault({ method: 'POST', path: companies, action: fault.status(502, { message: 'Bad gateway' }, { apply: true }) })
  const out = await apply(dir, 'plan.json', '--yes', '--json')
  expect(out.exitCode, out.stdout).toBe(0)
  expect(writes(sim)).toEqual([`POST ${groups}`, `POST ${companies}`])
  expect(stateOf(dir).resources[soilPh]).toMatchObject({ origin: 'created', base: { label: 'Soil pH' } })
})

test('a POST that times out and never landed: one POST, uncertain, exit 5, and no second POST', async () => {
  const sim = portal()
  const dir = copy('apply')
  await saved(dir)
  sim.fault({ method: 'POST', path: companies, action: fault.timeout() })
  const out = await onFakeTime(() => apply(dir, 'plan.json', '--yes', '--json'))
  expect(out.exitCode).toBe(5)
  expect(out.data?.outcome).toBe('uncertain')
  expect(out.data?.steps[1]).toMatchObject({ address: soilPh, outcome: 'uncertain', issue: 'E_UNCERTAIN_WRITE' })
  expect(writes(sim)).toEqual([`POST ${groups}`, `POST ${companies}`])
  const state = stateOf(dir)
  expect(state.resources[soilPh]).toBeUndefined()
  expect(state.lastApply?.outcome).toBe('uncertain')
})

test('a 429 without the daily policy is waited out: a new read, then one successful write', async () => {
  const sim = portal()
  const dir = copy('apply')
  await saved(dir)
  const limited = fault.status(
    429,
    { policyName: 'TEN_SECONDLY_ROLLING', message: 'Slow down' },
    { headers: { 'retry-after': '1' } },
  )
  sim.fault({ method: 'POST', path: companies, occurrence: 1, action: limited })
  const out = await onFakeTime(() => apply(dir, 'plan.json', '--yes'))
  expect(out.exitCode, out.stderr).toBe(0)
  const property = since(sim, 0).filter((line) => line.includes('/soil_ph') || line === `POST ${companies}`)
  expect(property).toEqual([
    `GET ${companies}/soil_ph`,
    `POST ${companies}`,
    `GET ${companies}/soil_ph`,
    `POST ${companies}`,
    `GET ${companies}/soil_ph`,
  ])
  expect(sim.writes().filter((r) => r.status === 201).length).toBe(2)
})

test('a daily 429 stops the run: exit 1 before any write landed, exit 5 after one did', async () => {
  const sim = portal()
  const dir = copy('apply')
  await saved(dir)
  const daily = fault.status(429, { policyName: 'DAILY', message: 'Daily limit' })
  sim.fault({ method: 'POST', path: groups, occurrence: 1, action: daily })
  const first = await apply(dir, 'plan.json', '--yes', '--json')
  expect(first.exitCode).toBe(1)
  expect(first.data?.steps.map((s) => s.outcome)).toEqual(['not-run', 'not-run'])
  expect(first.env?.issues.map((i) => i.code)).toContain('E_DAILY_LIMIT')

  const later = copy('apply')
  await saved(later)
  sim.fault({ method: 'POST', path: companies, occurrence: 1, action: daily })
  const second = await apply(later, 'plan.json', '--yes', '--json')
  expect(second.exitCode).toBe(5)
  expect(second.data?.steps.map((s) => s.outcome)).toEqual(['done', 'not-run'])
  expect(stateOf(later).lastApply?.outcome).toBe('partial')
})

test('a 403 on a write is rejected and names the write scope', async () => {
  const sim = portal()
  const dir = copy('apply')
  await saved(dir)
  const refused = {
    status: 'error',
    category: 'MISSING_SCOPES',
    message: 'This app has not been granted all required scopes',
  }
  sim.fault({ method: 'POST', path: groups, action: fault.status(403, refused) })
  const from = sim.log.length
  const out = await apply(dir, 'plan.json', '--yes', '--json')
  expect(out.exitCode).toBe(1)
  expect(out.data?.steps.map((s) => s.outcome)).toEqual(['rejected', 'not-run'])
  // After the refused POST one groups read shows the group absent, so nothing was written, and nothing follows.
  expect(since(sim, from).slice(-3)).toEqual([`GET ${groups}`, `POST ${groups}`, `GET ${groups}`])
  const issue = out.env?.issues.find((i) => i.code === 'E_SCOPE')
  expect(issue?.message).toContain('crm.schemas.companies.write')
  expect(issue?.fix).toContain('crm.schemas.companies.write')
})

test('a name that appears in HubSpot: stale at the read before the write, or uncertain when it appears only after', async () => {
  const appear = (sim: PortalSim) =>
    sim.object(portalId, 'companies').properties.set('soil_ph', {
      ...(sim.object(portalId, 'companies').properties.get('name') as SimProperty),
      name: 'soil_ph',
      label: 'Soil pH',
      type: 'number',
      fieldType: 'number',
      groupName: 'orchard',
      hubspotDefined: false,
    })
  const before = portal()
  const early = copy('apply')
  await saved(early)
  intercept(before, (method, path) => {
    if (method === 'GET' && path === `${companies}/soil_ph`) {
      appear(before)
    }
  })
  const stale = await apply(early, 'plan.json', '--yes', '--json')
  expect(stale.exitCode).toBe(5)
  expect(stale.data?.steps[1]).toMatchObject({ outcome: 'stale', units: ['exists'] })
  expect(writes(before)).toEqual([`POST ${groups}`])

  const after = portal()
  const late = copy('apply')
  await saved(late)
  intercept(after, (method, path) => {
    if (method === 'POST' && path === companies) {
      appear(after)
    }
  })
  const uncertain = await apply(late, 'plan.json', '--yes', '--json')
  expect(uncertain.exitCode).toBe(5)
  expect(uncertain.data?.steps[1]).toMatchObject({ outcome: 'uncertain' })
  expect(after.writes().map((r) => r.status)).toEqual([201, 409])
  // The single read after the 409 finds it; no list is needed.
  expect(since(after, 0).slice(-2)).toEqual([`POST ${companies}`, `GET ${companies}/soil_ph`])
  expect(stateOf(late).resources[soilPh]).toBeUndefined()

  // A property that appears as sensitive only: the single read answers 404, and the sensitive list finds it.
  const hidden = portal()
  const secret = copy('apply')
  await saved(secret)
  intercept(hidden, (method, path) => {
    if (method === 'POST' && path === companies) {
      appear(hidden)
      Object.assign(hidden.object(portalId, 'companies').properties.get('soil_ph') ?? {}, {
        dataSensitivity: 'sensitive',
      })
    }
  })
  const from = hidden.log.length
  const sensitive = await apply(secret, 'plan.json', '--yes', '--json')
  expect(sensitive.exitCode).toBe(5)
  expect(sensitive.data?.steps[1]).toMatchObject({ outcome: 'uncertain', issue: 'E_UNCERTAIN_WRITE' })
  const after409 = hidden.log.slice(from).slice(-4)
  expect(after409.map((r) => [r.method, r.path, r.status, r.query.dataSensitivity])).toEqual([
    ['POST', companies, 409, undefined],
    ['GET', `${companies}/soil_ph`, 404, undefined],
    ['GET', companies, 200, undefined],
    ['GET', companies, 200, 'sensitive'],
  ])
})

test('a read-back that lags a few reads settles within the deadline', async () => {
  const sim = portal()
  const dir = copy('apply')
  await saved(dir)
  sim.fault({ method: 'POST', path: companies, action: fault.lag(3) })
  const out = await onFakeTime(() => apply(dir, 'plan.json', '--yes', '--json'))
  expect(out.exitCode, out.stdout).toBe(0)
  expect(since(sim, 0).filter((line) => line === `GET ${companies}/soil_ph`).length).toBe(5)
  expect(stateOf(dir).resources[soilPh]?.base).toMatchObject({ label: 'Soil pH' })
})

// Deletes

test('a delete needs all four keys: no tombstone, no owner, no allowDestroy, or no terminal each refuses', async () => {
  const sim = portal()
  const dir = await applied(sim)

  // No tombstone: config drops the property, which stays in HubSpot and in state as an orphan.
  const dropped = copy('apply')
  await applied(sim, dropped)
  dropSoilPh(dropped)
  const orphan = await saved(dropped)
  expect(orphan.steps).toEqual([])
  expect(orphan.orphans.map((o) => o.address)).toEqual([soilPh])

  // Not owned: a tombstone on a property state does not own.
  sim.object(portalId, 'companies').properties.set('old_notes', {
    ...(sim.object(portalId, 'companies').properties.get('soil_ph') as SimProperty),
    name: 'old_notes',
    label: 'Old notes',
  })
  removed(dir, { 'property:companies/old_notes': 'destroy' })
  edit(dir, config, pin, `${pin}\n      allowDestroy: true,`)
  const notOwned = await saved(dir)
  expect(notOwned.steps).toMatchObject([{ action: 'delete', risk: 'blocked', blocked: { reason: 'not-owned' } }])
  expect((await apply(dir, 'plan.json', '--json')).data?.outcome).toBe('nothing')

  // Owned, but the target does not allow deletes.
  edit(dir, config, `${pin}\n      allowDestroy: true,`, pin)
  removed(dir, { [soilPh]: 'destroy' })
  dropSoilPh(dir)
  const policy = await saved(dir)
  expect(policy.steps).toMatchObject([{ address: soilPh, risk: 'blocked', blocked: { reason: 'policy' } }])

  // All three in config, and no terminal.
  edit(dir, config, pin, `${pin}\n      allowDestroy: true,`)
  const destroy = await saved(dir)
  expect(destroy.steps).toMatchObject([{ address: soilPh, action: 'delete', risk: 'destructive' }])
  const noTerminal = await apply(dir, 'plan.json', '--json')
  expect(noTerminal.exitCode).toBe(4)
  expect(noTerminal.env?.issues[0]?.message).toContain('Deleting needs a person at a terminal')
  const yes = await apply(dir, 'plan.json', '--yes', '--json')
  expect(yes.exitCode).toBe(4)
  expect(yes.env?.issues[0]?.message).toContain('--yes never covers a delete')
  // A write key held apart, as a reviewed CI job has it, and the plan's own digest: still no delete.
  edit(dir, config, readCredential, writeCredential)
  vi.stubEnv('HUBSPOT_SANDBOX_WRITE_KEY', writeKey)
  const approved = await apply(dir, 'plan.json', '--approve', destroy.writesHash, '--json')
  expect(approved.exitCode).toBe(4)
  expect(approved.env?.issues[0]).toMatchObject({ code: 'E_APPROVAL_REQUIRED', humanRequired: true })
  expect(approved.env?.issues[0]?.message).toContain('--approve never covers a delete')
  expect(writes(sim).filter((w) => w.startsWith('DELETE'))).toEqual([])
})

/** A project that applied the group and soil_ph, then asks to destroy them. */
async function destroying(sim: PortalSim, addresses: string[]): Promise<string> {
  const dir = await applied(sim)
  removed(dir, Object.fromEntries(addresses.map((a) => [a, 'destroy' as const])))
  dropSoilPh(dir, addresses.includes('group:companies/orchard'))
  edit(dir, config, pin, `${pin}\n      allowDestroy: true,`)
  return dir
}

test('with all four keys the delete runs: DELETE, an archived read-back, the entry dropped, and no step left', async () => {
  const sim = portal()
  const dir = await destroying(sim, [soilPh])
  await saved(dir)
  const wrongCount = await apply(terminal(dir, 'sandbox', '2'), 'plan.json')
  expect(wrongCount.exitCode).toBe(1)
  expect(wrongCount.stderr).toContain('Type the number of destructive steps (1): ')
  expect(sim.writes()).toEqual([])
  const out = await apply(terminal(dir, 'sandbox', '1'), 'plan.json')
  expect(out.exitCode, out.stderr).toBe(0)
  expect(writes(sim)).toEqual([`DELETE ${companies}/soil_ph`])
  expect(
    sim.log.some((r) => r.path === `${companies}/soil_ph` && r.query.archived === 'true' && r.status === 200),
  ).toBe(true)
  expect(stateOf(dir).resources[soilPh]).toBeUndefined()
  const again = await saved(dir)
  expect(again.steps).toEqual([])
})

test("a group delete runs after its property's delete in the same run", async () => {
  const sim = portal()
  const dir = await destroying(sim, [soilPh, 'group:companies/orchard'])
  const plan = await saved(dir)
  expect(plan.steps.map((s) => [s.address, s.action, s.risk])).toEqual([
    [soilPh, 'delete', 'destructive'],
    ['group:companies/orchard', 'delete', 'destructive'],
  ])
  const out = await apply(terminal(dir, 'sandbox', '2'), 'plan.json')
  expect(out.exitCode, out.stderr).toBe(0)
  expect(writes(sim)).toEqual([`DELETE ${companies}/soil_ph`, `DELETE ${groups}/orchard`])
  expect(stateOf(dir).resources).toEqual({})
})

test('a plan file reordered to delete the group first, re-hashed, still deletes the property before the group', async () => {
  const sim = portal()
  const dir = await destroying(sim, [soilPh, 'group:companies/orchard'])
  const plan = await saved(dir)
  const [property, group] = plan.steps as [Plan['steps'][number], Plan['steps'][number]]
  writePlan(
    dir,
    {
      ...plan,
      steps: [
        { ...group, id: 's1' },
        { ...property, id: 's2' },
      ],
    },
    true,
  )
  const out = await apply(terminal(dir, 'sandbox', '2'), 'plan.json')
  expect(out.exitCode, out.stderr).toBe(0)
  expect(writes(sim)).toEqual([`DELETE ${companies}/soil_ph`, `DELETE ${groups}/orchard`])
  expect(stateOf(dir).resources).toEqual({})
})

test('a group that still holds a property no one manages is blocked, and nothing is deleted', async () => {
  const sim = portal()
  const dir = await applied(sim)
  // soil_ph leaves the group in HubSpot and is released, so the only property left in orchard is plot_notes.
  Object.assign(sim.object(portalId, 'companies').properties.get('soil_ph') ?? {}, {
    groupName: 'companyinformation',
  })
  removed(dir, { 'group:companies/orchard': 'destroy', [soilPh]: 'release' })
  dropSoilPh(dir, true)
  edit(dir, config, pin, `${pin}\n      allowDestroy: true,`)
  const clear = await saved(dir)
  expect(clear.steps.find((s) => s.address === 'group:companies/orchard')).toMatchObject({
    action: 'delete',
    risk: 'destructive',
  })

  sim.object(portalId, 'companies').properties.set('plot_notes', {
    ...(sim.object(portalId, 'companies').properties.get('soil_ph') as SimProperty),
    name: 'plot_notes',
    label: 'Plot notes',
    groupName: 'orchard',
  })
  const plan = await saved(dir)
  const group = plan.steps.find((s) => s.address === 'group:companies/orchard')
  expect(group).toMatchObject({ risk: 'blocked', blocked: { reason: 'unsupported' } })
  expect(group?.blocked?.detail).toContain('plot_notes')
  expect(group?.blocked?.detail).not.toContain('soil_ph')
  const out = await apply(dir, 'plan.json', '--yes', '--json')
  expect(out.exitCode, out.stdout).toBe(0)
  expect(out.data?.steps).toMatchObject([
    { address: soilPh, action: 'release', outcome: 'done' },
    { address: 'group:companies/orchard', outcome: 'blocked' },
  ])
  expect(sim.writes()).toEqual([])
  expect(stateOf(dir).resources['group:companies/orchard']).toMatchObject({ origin: 'created' })
})

test('a release drops the entry and sends no request', async () => {
  const sim = portal()
  const dir = await applied(sim)
  removed(dir, { [soilPh]: 'release' })
  dropSoilPh(dir)
  const plan = await saved(dir)
  expect(plan.steps).toMatchObject([{ address: soilPh, action: 'release', risk: 'safe' }])
  sim.log.length = 0
  const out = await apply(dir, 'plan.json', '--yes', '--json')
  expect(out.exitCode, out.stdout).toBe(0)
  expect(sim.writes()).toEqual([])
  expect(stateOf(dir).resources[soilPh]).toBeUndefined()
  expect(sim.object(portalId, 'companies').properties.get('soil_ph')?.archived).toBe(false)
})

// State persistence

test('a failed save of the running record writes nothing: E_STATE_WRITE, exit 1', async () => {
  const sim = portal()
  const dir = await applied(sim)
  edit(dir, objects, "label: 'Soil pH'", "label: 'Soil acidity'")
  await saved(dir)
  rmSync(`${statePath(dir)}.bak`)
  mkdirSync(`${statePath(dir)}.bak`)
  const bytes = readFileSync(statePath(dir), 'utf8')
  const out = await apply(dir, 'plan.json', '--yes', '--json')
  expect(out.exitCode).toBe(1)
  expect(out.env?.issues[0]?.code).toBe('E_STATE_WRITE')
  expect(sim.writes()).toEqual([])
  expect(readFileSync(statePath(dir), 'utf8')).toBe(bytes)
})

test('a failed save after a verified create exits 5 with E_STATE_WRITE, and the next plan adopts, never a second create', async () => {
  const sim = portal()
  const dir = copy('apply')
  await saved(dir)
  intercept(sim, (method, path) => {
    if (method === 'POST' && path === companies) {
      rmSync(`${statePath(dir)}.bak`, { force: true })
      mkdirSync(`${statePath(dir)}.bak`)
    }
  })
  const out = await apply(dir, 'plan.json', '--yes', '--json')
  expect(out.exitCode).toBe(5)
  const issue = out.env?.issues.find((i) => i.code === 'E_STATE_WRITE')
  expect(issue?.message).toContain('Journal: ')
  expect(issue?.message).toContain('kalup plan')
  expect(stateOf(dir).resources[soilPh]).toBeUndefined()
  vi.stubGlobal('fetch', sim.fetch)
  const next = await saved(dir)
  expect(next.steps.map((s) => [s.address, s.action])).toEqual([[soilPh, 'adopt']])
})

// Signals and the lock

/** SIGINT and SIGTERM as the process delivers them: each to the listeners registered for that signal. */
function emitter() {
  const listeners = new Map<string, Set<() => void>>()
  return {
    on: (signal: string, listener: () => void) =>
      listeners.set(signal, (listeners.get(signal) ?? new Set()).add(listener)),
    off: (signal: string, listener: () => void) => listeners.get(signal)?.delete(listener),
    emit: (signal: 'SIGINT' | 'SIGTERM') => {
      for (const listener of listeners.get(signal) ?? []) {
        listener()
      }
    },
    listening: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
  }
}

test('a signal mid-run stops before the next request, saves state and releases the lock', async () => {
  const sim = portal()
  const dir = copy('apply')
  await saved(dir)
  const signals = emitter()
  intercept(sim, (method) => {
    if (method === 'POST') {
      signals.emit('SIGINT')
    }
  })
  const out = await apply({ cwd: dir, signals } as never, 'plan.json', '--yes', '--json')
  expect(out.exitCode).toBe(5)
  expect(out.stderr).toContain('Stopping after the request in flight.')
  // The group's POST landed; its read-back and everything after it were not sent.
  expect(sim.log.at(-1)).toMatchObject({ method: 'POST', path: groups })
  expect(out.data?.steps.map((s) => s.outcome)).toEqual(['unverified', 'not-run'])
  expect(stateOf(dir).resources['group:companies/orchard']).toEqual({
    origin: 'created',
    id: 'orchard',
    normVersion: 1,
    written: { label: expect.any(String) },
    writtenAt: expect.any(String),
  })
  expect(stateOf(dir).lastApply?.outcome).toBe('partial')
  expect(readdirSync(locks)).toEqual([])
  expect(signals.listening()).toBe(0)
})

test('two SIGINTs a few milliseconds apart are one interrupt, as npx delivers one Ctrl-C: a clean stop with its summary', async () => {
  const sim = portal()
  const dir = copy('apply')
  await saved(dir)
  const signals = emitter()
  const exits: number[] = []
  intercept(sim, async (method) => {
    if (method === 'POST') {
      // The terminal signals the process group, and npm forwards the same Ctrl-C to its child.
      signals.emit('SIGINT')
      await new Promise((resolve) => setTimeout(resolve, 5))
      signals.emit('SIGINT')
    }
  })
  const out = await apply(
    { cwd: dir, signals, exit: (code: number) => exits.push(code) } as never,
    'plan.json',
    '--yes',
  )
  expect(exits).toEqual([])
  expect(out.exitCode).toBe(5)
  expect(out.stderr.match(/Stopping after the request in flight/g)).toHaveLength(1)
  expect(out.stdout).toContain('Did not finish plan ')
  expect(out.stdout).toContain('1 unverified, 1 not run.')
  expect(stateOf(dir).lastApply?.outcome).toBe('partial')
  expect(readdirSync(locks)).toEqual([])
  expect(signals.listening()).toBe(0)
})

test('a second signal a second or more after the first ends the process at once with exit 5; one signal alone does not', async () => {
  const sim = portal()
  const dir = copy('apply')
  await saved(dir)
  const signals = emitter()
  const exits: number[] = []
  let sent = 0
  intercept(sim, (method) => {
    if (method === 'POST') {
      sent += 1
      signals.emit('SIGTERM')
      expect(exits).toEqual([])
      const later = Date.now() + 1000
      const clock = vi.spyOn(Date, 'now').mockReturnValue(later)
      signals.emit('SIGINT')
      clock.mockRestore()
    }
  })
  const out = await apply(
    { cwd: dir, signals, exit: (code: number) => exits.push(code) } as never,
    'plan.json',
    '--yes',
  )
  expect(exits).toEqual([5])
  expect(sent).toBe(1)
  expect(out.stderr).toContain('Stopping after the request in flight.')
})

test('an apply while another holds the portal lock is E_LOCKED: no request after the guard, and state is not read', async () => {
  const sim = portal()
  const other = copy('apply')
  edit(other, config, 'sandbox: {', 'orchard_sandbox: {')
  await saved(other)
  const dir = copy('apply')
  await saved(dir)
  let release: () => void = () => undefined
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let paused = false
  let reached: () => void = () => undefined
  const writing = new Promise<void>((resolve) => {
    reached = resolve
  })
  intercept(sim, async (method) => {
    if (method === 'POST' && !paused) {
      paused = true
      reached()
      await held
    }
  })
  const first = apply(other, 'plan.json', '--yes', '--json')
  // The first apply holds the lock and waits at its first write.
  await writing
  mkdirSync(join(dir, '.kalup', 'state'), { recursive: true })
  writeFileSync(statePath(dir), 'not json\n')
  const from = sim.log.length
  const second = await apply(dir, 'plan.json', '--yes', '--json')
  expect(second.exitCode).toBe(1)
  expect(second.env?.issues[0]?.code).toBe('E_LOCKED')
  expect(second.env?.issues[0]?.message).toContain(`portal ${portalId} is locked by kalup apply`)
  expect(since(sim, from)).toEqual(['GET /account-info/2026-09/details'])
  release()
  expect((await first).exitCode).toBe(0)
})

const NOTHING_BY_DEFAULT =
  /^Target sandbox, portal 1111111 \(defaultTarget\)\nNothing to apply: plan pl_\w+ writes nothing/

// A second target, so the rule has two to pick from: defaultTarget, or the person at the terminal.
const production =
  "    production: {\n      portalId: 2222222,\n      credentials: { read: { env: 'HUBSPOT_PROD_KEY' } },\n    },\n"

test('direct apply says how the target was chosen: by defaultTarget, or by the person at the terminal', async () => {
  const sim = portal()
  const byDefault = copy('apply')
  edit(byDefault, config, '  targets: {\n', `  defaultTarget: 'sandbox',\n  targets: {\n${production}`)
  const out = await apply(byDefault, '--yes')
  expect(out.exitCode, out.stderr).toBe(0)
  expect(out.stdout.startsWith('Target sandbox, portal 1111111 (defaultTarget)\nApplied plan ')).toBe(true)
  const nothing = await apply(byDefault, '--yes')
  expect(nothing.stdout).toMatch(NOTHING_BY_DEFAULT)

  sim.log.length = 0
  const chosen = copy('apply')
  edit(chosen, config, '  targets: {\n', `  targets: {\n${production}`)
  const picked = await apply(terminal(chosen, 'sandbox', 'sandbox'))
  expect(picked.exitCode, picked.stderr).toBe(0)
  expect(picked.stderr).toContain('Which target?')
  expect(picked.stdout.startsWith('Target sandbox, portal 1111111 (chosen)\nApplied plan ')).toBe(true)
  // The flag names the target itself, so the line is left out.
  const flagged = await apply(chosen, '--target', 'sandbox', '--yes')
  expect(flagged.stdout.startsWith('Nothing to apply: plan ')).toBe(true)
})
