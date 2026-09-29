// kalup target rebind through the built host against the stateful simulator with two portals: refused without a
// terminal, for a STANDARD account, for a portal another target pins and for a key of another portal; both locks in
// ascending portal ID order; and a rebind that rewrites the pin, archives the old state and writes the new one, after
// which a plan saved for the old portal is refused.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { TargetState } from '@kalup/core'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { RebindData } from '../../src/commands/target-rebind.js'
import { cli, copy, parseEnvelope } from '../../src/commands/testing.js'
import { fixture } from '../../src/lib/testing.js'
import { createPortalSim, fault, type PortalSim } from '../support/portal-sim.js'
import { edit, tree } from './orchard.js'

const oldKey = 'kalup-rebind-old-4a1c'
const newKey = 'kalup-rebind-new-8e3d'
const oldPortal = 1_111_111
const newPortal = 3_333_333
const config = 'kalup.config.ts'
const objects = 'kalup/objects/companies.ts'
const soilPh = 'property:companies/soil_ph'
const orchard = 'group:companies/orchard'
let locks = ''

beforeEach(() => {
  locks = mkdtempSync(join(tmpdir(), 'kalup-locks-'))
  vi.stubEnv('KALUP_LOCK_DIR', locks)
  vi.stubEnv('KALUP_STATE_DIR', undefined)
  vi.stubEnv('HUBSPOT_SANDBOX_KEY', oldKey)
  vi.stubEnv('CI', undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

/** The old portal, empty, and the new one holding the orchard group and soil_ph, as a recreated sandbox would. */
function sim(accountType = 'DEVELOPER_TEST', ids = { old: oldPortal, new: newPortal }): PortalSim {
  const portal = createPortalSim([
    { portalId: ids.old, keys: { HUBSPOT_SANDBOX_KEY: oldKey }, objects: { companies: {} } },
    {
      portalId: ids.new,
      accountType,
      keys: { HUBSPOT_SANDBOX_KEY: newKey },
      objects: {
        companies: {
          groups: [{ name: 'orchard', label: 'Orchard' }],
          properties: [
            { name: 'soil_ph', label: 'Soil pH', type: 'number', fieldType: 'number', groupName: 'orchard' },
          ],
        },
      },
    },
  ])
  vi.stubGlobal('fetch', portal.fetch)
  return portal
}

function statePath(dir: string, portalId: number): string {
  return join(dir, '.kalup', 'state', `portal-${portalId}.json`)
}

function stateOf(dir: string, portalId: number): TargetState {
  return JSON.parse(readFileSync(statePath(dir, portalId), 'utf8')) as TargetState
}

function terminal(dir: string, ...answers: string[]) {
  return { cwd: dir, interactive: true, stdin: Readable.from([answers.map((a) => `${a}\n`).join('')]) }
}

/** The apply project applied to the old portal, and a plan saved for it with an effect still to apply. */
async function applied(portal: PortalSim): Promise<string> {
  const dir = copy('apply')
  await cli(dir, 'plan', '--out', 'plan.json')
  if ((await cli(dir, 'apply', 'plan.json', '--yes')).exitCode !== 0) {
    throw new Error('the first apply failed')
  }
  edit(dir, objects, "label: 'Soil pH'", "label: 'Soil pH (1 to 14)'")
  if ((await cli(dir, 'plan', '--out', 'old-plan.json')).exitCode !== 0) {
    throw new Error('the second plan failed')
  }
  portal.log.length = 0
  vi.stubEnv('HUBSPOT_SANDBOX_KEY', newKey)
  return dir
}

/** Every project file and state file, history and archive left out. */
function files(dir: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(tree(dir)).filter(([file]) => !(file.startsWith('.kalup/history') || file.includes('archive'))),
  )
}

/** A lock file held by this live process, as another Kalup command on this machine would hold it. */
function hold(portalId: number): void {
  mkdirSync(locks, { recursive: true })
  const record = {
    pid: process.pid,
    host: hostname(),
    command: 'apply',
    startedAt: '2026-09-28T10:00:00.000Z',
    portalId,
  }
  writeFileSync(join(locks, `portal-${portalId}.lock`), `${JSON.stringify(record)}\n`)
}

test('without a terminal rebind is E_APPROVAL_REQUIRED, exit 4, and sends nothing', async () => {
  const portal = sim()
  const dir = await applied(portal)
  const before = files(dir)
  const out = await cli(dir, 'target', 'rebind', 'sandbox', '--portal', String(newPortal), '--json')
  expect(out.exitCode).toBe(4)
  expect(parseEnvelope(out.stdout).issues[0]).toMatchObject({
    code: 'E_APPROVAL_REQUIRED',
    humanRequired: true,
    fix: `ask the user to run kalup target rebind sandbox --portal ${newPortal} in a terminal, where they confirm it`,
  })
  expect(portal.log).toEqual([])
  const yes = await cli(terminal(dir, 'sandbox'), 'target', 'rebind', 'sandbox', '--portal', String(newPortal), '--yes')
  expect(yes.exitCode).toBe(1)
  expect(yes.stderr).toContain('E_USAGE: unknown flag --yes')
  expect(portal.log).toEqual([])
  expect(files(dir)).toEqual(before)
})

test.each(['STANDARD', 'APP_DEVELOPER', 'CRM_TRIAL'])(
  'a %s account is E_REBIND_STANDARD, exit 4, and nothing is written: only test portals and sandboxes',
  async (type) => {
    const portal = sim(type)
    const dir = await applied(portal)
    const before = files(dir)
    const out = await cli(terminal(dir, 'sandbox'), 'target', 'rebind', 'sandbox', '--portal', String(newPortal))
    expect(out.exitCode).toBe(4)
    expect(out.stderr).toContain(
      `E_REBIND_STANDARD: portal ${newPortal} is a ${type} account; rebind is only for recreated test portals (DEVELOPER_TEST) and sandboxes (SANDBOX). Nothing was written.`,
    )
    expect(files(dir)).toEqual(before)
    expect(portal.writes()).toEqual([])
  },
)

test('a portal another target pins is E_DUPLICATE_PORTAL, exit 3, before any request', async () => {
  const portal = sim()
  const dir = await applied(portal)
  edit(
    dir,
    config,
    '  targets: {\n',
    `  targets: {\n    qa: { portalId: ${newPortal}, credentials: { read: { env: 'HUBSPOT_QA_KEY' } } },\n`,
  )
  const out = await cli(terminal(dir, 'sandbox'), 'target', 'rebind', 'sandbox', '--portal', String(newPortal))
  expect(out.exitCode).toBe(3)
  expect(out.stderr).toContain(`E_DUPLICATE_PORTAL: target qa already pins portal ${newPortal}`)
  expect(portal.log).toEqual([])
})

test("the target's write key must belong to the new portal: E_TARGET_PORTAL_MISMATCH, exit 4", async () => {
  const portal = sim()
  const dir = await applied(portal)
  vi.stubEnv('HUBSPOT_SANDBOX_KEY', oldKey)
  const before = files(dir)
  const out = await cli(terminal(dir, 'sandbox'), 'target', 'rebind', 'sandbox', '--portal', String(newPortal))
  expect(out.exitCode).toBe(4)
  // The new portal is the one --portal gives, not a pin, and the fix does not send the person back to rebind.
  expect(out.stderr).toContain(
    `E_TARGET_PORTAL_MISMATCH: The key in HUBSPOT_SANDBOX_KEY belongs to portal ${oldPortal}, not portal ${newPortal} given by --portal. Nothing was written. (fix: Ask the user to check the key in HUBSPOT_SANDBOX_KEY and the Hub ID in --portal.)`,
  )
  expect(files(dir)).toEqual(before)
})

test('an undeclared target, the same portal or a bad --portal are refused before any request', async () => {
  const portal = sim()
  const dir = await applied(portal)
  const unknown = await cli(terminal(dir), 'target', 'rebind', 'staging', '--portal', String(newPortal))
  expect(unknown.exitCode).toBe(3)
  expect(unknown.stderr).toContain('E_UNKNOWN_TARGET')
  const same = await cli(terminal(dir), 'target', 'rebind', 'sandbox', '--portal', String(oldPortal))
  expect(same.exitCode).toBe(1)
  expect(same.stderr).toContain(`E_USAGE: target sandbox already pins portal ${oldPortal}`)
  const bad = await cli(terminal(dir), 'target', 'rebind', 'sandbox', '--portal', 'abc')
  expect(bad.exitCode).toBe(1)
  expect(bad.stderr).toContain("E_USAGE: --portal needs the Hub ID, a positive integer, not 'abc'")
  expect(portal.log).toEqual([])
})

test('both portal locks are taken in ascending portal ID order, and a held one stops the rebind', async () => {
  // The old portal has the higher ID here, so ascending order takes the new portal's lock first.
  const portal = sim('DEVELOPER_TEST', { old: newPortal, new: oldPortal })
  const dir = copy('apply')
  edit(dir, config, `portalId: ${oldPortal},`, `portalId: ${newPortal},`)
  vi.stubEnv('HUBSPOT_SANDBOX_KEY', newKey)
  hold(oldPortal)
  hold(newPortal)
  const both = await cli(terminal(dir, 'sandbox'), 'target', 'rebind', 'sandbox', '--portal', String(oldPortal))
  expect(both.exitCode).toBe(1)
  expect(both.stderr).toContain(`E_LOCKED: portal ${oldPortal} is locked`)
  // Only the higher one held: the lower was taken, then released when the second failed.
  rmSync(join(locks, `portal-${oldPortal}.lock`))
  const second = await cli(terminal(dir, 'sandbox'), 'target', 'rebind', 'sandbox', '--portal', String(oldPortal))
  expect(second.exitCode).toBe(1)
  expect(second.stderr).toContain(`E_LOCKED: portal ${newPortal} is locked`)
  expect(readdirSync(locks)).toEqual([`portal-${newPortal}.lock`])
  expect(existsSync(statePath(dir, oldPortal))).toBe(false)
  expect(portal.writes()).toEqual([])
})

test('a rebind rewrites the pin, archives the old state, writes the new state; an old saved plan is refused', async () => {
  const portal = sim()
  const dir = await applied(portal)
  const oldState = stateOf(dir, oldPortal)
  const wrong = await cli(terminal(dir, 'qa'), 'target', 'rebind', 'sandbox', '--portal', String(newPortal))
  expect(wrong.exitCode).toBe(1)
  expect(wrong.stderr).toContain('E_CANCELLED')
  expect(readFileSync(join(dir, config), 'utf8')).toContain(`portalId: ${oldPortal},`)
  const out = await cli(
    terminal(dir, 'sandbox'),
    'target',
    'rebind',
    'sandbox',
    '--portal',
    String(newPortal),
    '--json',
  )
  // --json never prompts, so the envelope run is refused; the terminal run follows.
  expect(out.exitCode).toBe(4)
  const human = await cli(terminal(dir, 'sandbox'), 'target', 'rebind', 'sandbox', '--portal', String(newPortal))
  expect(human.exitCode, human.stderr).toBe(0)
  expect(human.stderr).toContain(
    `Rebind target sandbox from portal ${oldPortal} to portal ${newPortal} (DEVELOPER_TEST).`,
  )
  expect(human.stderr).toContain('2 of 2 managed resources found by name in the portal')
  expect(human.stdout).toContain(`Target sandbox now pins portal ${newPortal}: 2 of 2 managed resources found by name.`)
  expect(readFileSync(join(dir, config), 'utf8')).toContain(`portalId: ${newPortal},`)
  const history = Object.keys(tree(dir)).filter((file) => file.startsWith('.kalup/history/'))
  expect(history.some((file) => file.endsWith(`/${config}`))).toBe(true)
  expect(existsSync(statePath(dir, oldPortal))).toBe(false)
  const archive = readdirSync(join(dir, '.kalup', 'state', 'archive'))
  expect(archive.filter((name) => name.startsWith(`portal-${oldPortal}-${oldState.lineage}-`))).toHaveLength(1)
  const next = stateOf(dir, newPortal)
  expect(next).toEqual({
    format: 'kalup.state/1',
    lineage: next.lineage,
    serial: 1,
    portalId: newPortal,
    resources: {
      [orchard]: { origin: 'adopted', id: 'orchard', normVersion: 1, base: { label: 'Orchard' } },
      [soilPh]: {
        origin: 'adopted',
        id: 'soil_ph',
        normVersion: 1,
        base: { fieldType: 'number', group: { $ref: orchard }, type: 'number' },
      },
    },
  })
  expect(readdirSync(locks)).toEqual([])
  expect(portal.writes()).toEqual([])
  const stale = await cli(dir, 'apply', 'old-plan.json', '--yes', '--json')
  expect(stale.exitCode).toBe(1)
  expect(parseEnvelope<RebindData>(stale.stdout).issues[0]?.code).toBe('E_PLAN_DESTINATION')
  expect(portal.writes()).toEqual([])
})

test('an unreadable old state file stops the rebind before any write; so does an incomplete read', async () => {
  const portal = sim()
  const dir = await applied(portal)
  writeFileSync(statePath(dir, oldPortal), '{ not json')
  const before = files(dir)
  const out = await cli(terminal(dir, 'sandbox'), 'target', 'rebind', 'sandbox', '--portal', String(newPortal))
  expect(out.exitCode).toBe(1)
  expect(out.stderr).toContain(
    `E_STATE_INVALID: ${statePath(dir, oldPortal)} is not JSON. (fix: rename portal-${oldPortal}.json.bak, the state before its last save, into its place if it reads; else move the file away and run kalup state rebuild --target sandbox)`,
  )
  expect(out.stderr).not.toContain('Type the target name')
  expect(files(dir)).toEqual(before)
  expect(existsSync(statePath(dir, newPortal))).toBe(false)
  expect(readdirSync(locks)).toEqual([])

  rmSync(statePath(dir, oldPortal))
  const cleared = files(dir)
  portal.fault({
    method: 'GET',
    path: '/crm/properties/2026-09/companies',
    action: fault.status(403, fixture('errors/missing-scope.json')),
  })
  const partial = await cli(terminal(dir, 'sandbox'), 'target', 'rebind', 'sandbox', '--portal', String(newPortal))
  expect(partial.exitCode).toBe(1)
  expect(partial.stderr).toContain(
    'E_INCOMPLETE: the read did not cover everything config names: the lists of companies.',
  )
  expect(partial.stderr).not.toContain('Type the target name')
  expect(files(dir)).toEqual(cleared)
  expect(readdirSync(locks)).toEqual([])
  expect(portal.writes()).toEqual([])
})
