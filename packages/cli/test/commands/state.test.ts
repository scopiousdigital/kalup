// kalup state rebuild through the built host against the stateful simulator: the read-only report, --write refused
// without a terminal and with --yes or --approve, and at a scripted terminal the archived file and the new lineage of
// adopted entries with partial bases. Nothing is ever sent to the portal but reads.
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { Plan, TargetState } from '@kalup/engine'
import { KalupError } from '@kalup/engine'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createPortalSim, fault, type PortalSim } from '../../../engine/test/support/portal-sim.js'
import { fixture } from '../../../engine/test/support/testing.js'
import { type RebuildData, replaceState } from '../../src/commands/state.js'
import { cli, copy, parseEnvelope } from '../../src/commands/testing.js'
import { FileStateStore, type StateIo } from '../../src/lib/state.js'
import { printed } from '../support/printed.js'
import { edit } from './orchard.js'

const key = 'kalup-rebuild-sandbox-2f8a'
const portalId = 1_111_111
const soilPh = 'property:companies/soil_ph'
const soilDepth = 'property:companies/soil_depth'
const drainage = 'property:companies/drainage'
const orchard = 'group:companies/orchard'
const objects = 'hubspot/objects/companies.ts'
let locks = ''

beforeEach(() => {
  locks = mkdtempSync(join(tmpdir(), 'kalup-locks-'))
  vi.stubEnv('KALUP_LOCK_DIR', locks)
  vi.stubEnv('KALUP_STATE_DIR', undefined)
  vi.stubEnv('HUBSPOT_SANDBOX_KEY', key)
  vi.stubEnv('CI', undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function sim(): PortalSim {
  const portal = createPortalSim([
    { portalId, keys: { HUBSPOT_SANDBOX_KEY: key }, objects: { companies: { groups: [], properties: [] } } },
  ])
  vi.stubGlobal('fetch', portal.fetch)
  return portal
}

function statePath(dir: string): string {
  return join(dir, '.kalup', 'state', `portal-${portalId}.json`)
}

function stateOf(dir: string): TargetState {
  return JSON.parse(readFileSync(statePath(dir), 'utf8')) as TargetState
}

function terminal(dir: string, ...answers: string[]) {
  return { cwd: dir, interactive: true, stdin: Readable.from([answers.map((a) => `${a}\n`).join('')]) }
}

/**
 * The apply project applied (state owns the group and soil_ph), then: soil_depth in config and in HubSpot with another
 * label, drainage in config only, and soil_ph released, so its entry is no longer in config and its address is
 * tombstoned while HubSpot still holds it.
 */
async function drifted(portal: PortalSim): Promise<string> {
  const dir = copy('apply')
  await cli(dir, 'plan', '--out', 'plan.json')
  if ((await cli(dir, 'apply', 'plan.json', '--yes')).exitCode !== 0) {
    throw new Error('the first apply failed')
  }
  const companies = portal.object(portalId, 'companies')
  companies.properties.set('soil_depth', {
    ...(companies.properties.get('soil_ph') as NonNullable<ReturnType<typeof companies.properties.get>>),
    name: 'soil_depth',
    label: 'Depth',
  })
  edit(
    dir,
    objects,
    '  properties: {\n',
    "  properties: {\n    drainage: p.string('drainage', {\n      label: 'Drainage',\n      group: 'orchard',\n      fieldType: 'text',\n    }),\n    soilDepth: p.number('soil_depth', {\n      label: 'Soil depth',\n      group: 'orchard',\n      fieldType: 'number',\n    }),\n",
  )
  if ((await cli(dir, 'rm', soilPh, '--release')).exitCode !== 0) {
    throw new Error('rm failed')
  }
  portal.log.length = 0
  return dir
}

const report = {
  target: 'sandbox',
  portalId,
  found: [
    { address: orchard, id: 'orchard', units: 1, agreed: 1 },
    { address: soilDepth, id: 'soil_depth', units: 4, agreed: 3 },
  ],
  missing: [drainage],
  stale: [{ address: soilPh, id: 'soil_ph', reason: 'not-in-config' }],
  excluded: [{ address: soilPh, reason: 'tombstone' }],
}

test('the read-only report: found with agreed units, missing, stale entries and tombstones; nothing written', async () => {
  const portal = sim()
  const dir = await drifted(portal)
  const before = readFileSync(statePath(dir), 'utf8')
  const out = await cli(dir, 'state', 'rebuild', '--json')
  expect(out.exitCode, out.stdout).toBe(0)
  const { data } = parseEnvelope<RebuildData>(out.stdout)
  expect(data).toEqual({
    ...report,
    statePath: statePath(dir),
    loses: { created: [orchard, soilPh], bases: [], dropped: [soilPh] },
    written: false,
  })
  expect(readFileSync(statePath(dir), 'utf8')).toBe(before)
  expect(portal.writes()).toEqual([])
  const human = await cli(dir, 'state', 'rebuild')
  expect(printed(human)).toMatchInlineSnapshot(`
    "Target sandbox, portal 1111111 (the only target)
    State: <dir>/.kalup/state/portal-1111111.json, lineage <lineage>, serial 4
    2 of 3 managed resources found by name in the portal
      adopt group:companies/orchard as orchard: config and the portal agree on 1 of 1 value
      adopt property:companies/soil_depth as soil_depth: config and the portal agree on 3 of 4 values
      missing in the portal: property:companies/drainage
      stale entry: property:companies/soil_ph (no longer in config, records soil_ph)
      not adopted: property:companies/soil_ph (tombstone)
    Nothing was written. To replace the state file with these adoptions, run kalup state rebuild --target sandbox --write in a terminal.
    "
  `)
})

test('--write without a terminal is E_APPROVAL_REQUIRED, exit 4, before any request', async () => {
  const portal = sim()
  const dir = await drifted(portal)
  const before = readFileSync(statePath(dir), 'utf8')
  const out = await cli(dir, 'state', 'rebuild', '--write', '--json')
  expect(out.exitCode).toBe(4)
  expect(parseEnvelope(out.stdout).issues[0]).toMatchObject({
    code: 'E_APPROVAL_REQUIRED',
    humanRequired: true,
    fix: expect.stringContaining('kalup state rebuild --target sandbox --write'),
  })
  expect(portal.log).toEqual([])
  expect(readFileSync(statePath(dir), 'utf8')).toBe(before)
})

test('--write never runs with --yes or --approve: a usage error, even at a terminal', async () => {
  const portal = sim()
  const dir = await drifted(portal)
  const yes = await cli(terminal(dir, 'sandbox'), 'state', 'rebuild', '--write', '--yes')
  expect(yes.exitCode).toBe(1)
  expect(yes.stderr).toContain('E_USAGE: unknown flag --yes')
  const approve = await cli(terminal(dir, 'sandbox'), 'state', 'rebuild', '--write', '--approve', 'sha256:0')
  expect(approve.exitCode).toBe(1)
  expect(approve.stderr).toContain('E_USAGE: unknown flag --approve')
  expect(portal.log).toEqual([])
})

test('--write at a terminal archives the old file and writes adopted entries with partial bases, then plan adopts nothing', async () => {
  const portal = sim()
  const dir = await drifted(portal)
  const old = stateOf(dir)
  const wrong = await cli(terminal(dir, 'production'), 'state', 'rebuild', '--write')
  expect(wrong.exitCode).toBe(1)
  expect(wrong.stderr).toContain('E_CANCELLED')
  expect(stateOf(dir)).toEqual(old)
  const out = await cli(terminal(dir, 'sandbox'), 'state', 'rebuild', '--write')
  expect(out.exitCode, out.stderr).toBe(0)
  expect(out.stderr).toContain('The current state file loses, for good:')
  expect(out.stderr).toContain(`  created by Kalup, recorded as adopted: ${orchard}, ${soilPh}`)
  const archive = join(dir, '.kalup', 'state', 'archive')
  const archived = readdirSync(archive)
  expect(archived).toHaveLength(1)
  expect(archived[0]).toMatch(new RegExp(`^portal-${portalId}-${old.lineage}-\\d{8}T\\d{9}Z\\.json$`))
  expect(JSON.parse(readFileSync(join(archive, archived[0] as string), 'utf8'))).toEqual(old)
  const rebuilt = stateOf(dir)
  expect(rebuilt.lineage).not.toBe(old.lineage)
  expect(rebuilt).toEqual({
    format: 'kalup.state/1',
    lineage: rebuilt.lineage,
    serial: 1,
    portalId,
    resources: {
      [orchard]: { origin: 'adopted', id: 'orchard', normVersion: 1, base: { label: 'Orchard' } },
      [soilDepth]: {
        origin: 'adopted',
        id: 'soil_depth',
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
          group: { $ref: orchard },
          type: 'number',
        },
      },
    },
  })
  expect(out.stdout).toContain(`Wrote ${statePath(dir)}: lineage ${rebuilt.lineage}, serial 1, 2 adopted entries.`)
  expect(readdirSync(locks)).toEqual([])
  expect(portal.writes()).toEqual([])
  const plan = parseEnvelope<Plan>((await cli(dir, 'plan', '--json')).stdout).data as Plan
  expect(plan.steps.filter((s) => s.action === 'adopt')).toEqual([])
  expect(plan.steps.some((s) => s.address === soilPh)).toBe(false)
  expect(plan.steps.find((s) => s.address === soilDepth)).toMatchObject({
    action: 'update',
    held: [{ unit: 'label', class: 'diverged' }],
  })
})

test('--write with no state file writes a first lineage and archives nothing', async () => {
  sim()
  const dir = copy('apply')
  const out = await cli(terminal(dir, 'sandbox'), 'state', 'rebuild', '--write')
  expect(out.exitCode, out.stderr).toBe(0)
  expect(stateOf(dir)).toMatchObject({ serial: 1, resources: {} })
  expect(existsSync(join(dir, '.kalup', 'state', 'archive'))).toBe(false)
})

test('--write refuses a state file another command saved after the report: E_STATE_CHANGED, nothing written', async () => {
  const portal = sim()
  const dir = await drifted(portal)
  const shown = stateOf(dir)
  const saved: TargetState = { ...shown, serial: shown.serial + 1 }
  // A concurrent apply saves state while the person reads the report, before they answer.
  function* answers() {
    writeFileSync(statePath(dir), `${JSON.stringify(saved)}\n`)
    yield 'sandbox\n'
  }
  const stdin = Readable.from(answers())
  const out = await cli({ cwd: dir, interactive: true, stdin }, 'state', 'rebuild', '--write')
  expect(out.exitCode).toBe(1)
  expect(out.stderr).toContain('E_STATE_CHANGED: ')
  expect(out.stderr).toContain(`now lineage ${shown.lineage}, serial ${shown.serial + 1}`)
  expect(out.stderr).toContain('kalup state rebuild --target sandbox --write')
  expect(stateOf(dir)).toEqual(saved)
  expect(existsSync(join(dir, '.kalup', 'state', 'archive'))).toBe(false)
  expect(readdirSync(locks)).toEqual([])
  expect(portal.writes()).toEqual([])
})

const SCOPE_FIX = /scope \S+ to the write key.*kalup state rebuild --target sandbox --write/

test('--write after an incomplete read is E_INCOMPLETE before the prompt; the report alone still runs', async () => {
  const portal = sim()
  const dir = await drifted(portal)
  const before = readFileSync(statePath(dir), 'utf8')
  portal.fault({
    method: 'GET',
    path: '/crm/properties/2026-09/companies',
    action: fault.status(403, fixture('errors/missing-scope.json')),
  })
  const readOnly = await cli(dir, 'state', 'rebuild', '--json')
  expect(readOnly.exitCode).toBe(0)
  expect(parseEnvelope(readOnly.stdout).issues.map((i) => i.code)).toContain('E_SCOPE')
  const out = await cli(terminal(dir, 'sandbox'), 'state', 'rebuild', '--write')
  expect(out.exitCode).toBe(1)
  expect(out.stderr).toContain('E_INCOMPLETE: ')
  expect(out.stderr).toContain('the lists of companies')
  expect(out.stderr).toMatch(SCOPE_FIX)
  expect(out.stderr).not.toContain('Type the target name')
  expect(readFileSync(statePath(dir), 'utf8')).toBe(before)
  expect(existsSync(join(dir, '.kalup', 'state', 'archive'))).toBe(false)
  expect(portal.writes()).toEqual([])
})

test('--write waits on a config resource settling after an apply: E_INCOMPLETE names it and when to run again', async () => {
  const portal = sim()
  const dir = await drifted(portal)
  const before = readFileSync(statePath(dir), 'utf8')
  // The apply minutes ago wrote the orchard group, and HubSpot still serves its label from before.
  const group = portal.object(portalId, 'companies').groups.get('orchard')
  Object.assign(group ?? {}, { label: 'Orchards' })
  const until = new Date(Date.parse(stateOf(dir).resources[orchard]?.writtenAt as string) + 5 * 60_000).toISOString()
  const out = await cli(terminal(dir, 'sandbox'), 'state', 'rebuild', '--write')
  expect(out.exitCode).toBe(1)
  expect(out.stderr).toContain(
    `E_INCOMPLETE: the read did not cover everything config names: ${orchard} (settling after an apply until ${until})`,
  )
  expect(out.stderr).toContain(`fix: run kalup state rebuild --target sandbox --write again after ${until}`)
  expect(out.stderr).not.toContain('Type the target name')
  expect(readFileSync(statePath(dir), 'utf8')).toBe(before)
})

test('--write goes on when what settles is no resource config names', async () => {
  const portal = sim()
  const dir = await drifted(portal)
  // soil_ph left config with its release, and HubSpot still serves its label from before the apply minutes ago.
  Object.assign(portal.object(portalId, 'companies').properties.get('soil_ph') ?? {}, { label: 'Soil acidity' })
  const out = await cli(terminal(dir, 'sandbox'), 'state', 'rebuild', '--write')
  expect(out.exitCode, out.stderr).toBe(0)
  expect(out.stderr).not.toContain('E_INCOMPLETE')
  expect(Object.keys(stateOf(dir).resources).sort()).toEqual([orchard, soilDepth])
})

test('the report resolves the read key only; --write the write key, before any request', async () => {
  const portal = sim()
  const dir = await drifted(portal)
  edit(
    dir,
    'kalup.config.ts',
    "credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },",
    "credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' }, write: { env: 'HUBSPOT_SANDBOX_WRITE_KEY' } },",
  )
  vi.stubEnv('HUBSPOT_SANDBOX_WRITE_KEY', undefined)
  const readOnly = await cli(dir, 'state', 'rebuild', '--json')
  expect(readOnly.exitCode, readOnly.stdout).toBe(0)
  expect(portal.log.length).toBeGreaterThan(0)
  expect(new Set(portal.log.map((r) => r.key))).toEqual(new Set(['HUBSPOT_SANDBOX_KEY']))
  portal.log.length = 0
  const write = await cli(terminal(dir, 'sandbox'), 'state', 'rebuild', '--write')
  expect(write.exitCode).not.toBe(0)
  expect(write.stderr).toContain('E_MISSING_KEY')
  expect(write.stderr).toContain('HUBSPOT_SANDBOX_WRITE_KEY')
  expect(portal.log).toEqual([])
})

const fsIo: StateIo = {
  closeSync,
  copyFileSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
}

test('a new file that fails to save after the archive says the old one was archived, and where', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kalup-state-'))
  const old: TargetState = {
    format: 'kalup.state/1',
    lineage: '0123456789abcdef',
    serial: 3,
    portalId: 42,
    resources: {},
  }
  FileStateStore(dir).write(old, null)
  const store = FileStateStore(dir, {
    io: {
      ...fsIo,
      openSync: (path, flags) => {
        if (String(path).includes('.tmp-')) {
          throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
        }
        return fsIo.openSync(path, flags)
      },
    },
  })
  let error: unknown
  try {
    replaceState(store, 42, {}, 'kalup state rebuild --target sandbox --write', null)
  } catch (caught) {
    error = caught
  }
  const file = join(dir, 'portal-42.json')
  const [archived] = readdirSync(join(dir, 'archive'))
  const moved = join(dir, 'archive', archived as string)
  expect(existsSync(file)).toBe(false)
  expect(error).toBeInstanceOf(KalupError)
  expect((error as KalupError).issues).toEqual([
    {
      code: 'E_STATE_WRITE',
      message: expect.stringContaining(`archived to ${moved}`),
      file,
      fix: expect.stringContaining(`move ${moved} back to ${file}`),
    },
  ])
})

test('state rebuild says how the target was chosen: by defaultTarget, or by the person at the terminal', async () => {
  const portal = sim()
  const production =
    "    production: {\n      portalId: 2222222,\n      credentials: { read: { env: 'HUBSPOT_PROD_KEY' } },\n    },\n"
  const dir = await drifted(portal)
  edit(dir, 'kalup.config.ts', '  targets: {\n', `  defaultTarget: 'sandbox',\n  targets: {\n${production}`)
  const byDefault = await cli(dir, 'state', 'rebuild')
  expect(byDefault.exitCode, byDefault.stderr).toBe(0)
  expect(byDefault.stdout.startsWith('Target sandbox, portal 1111111 (defaultTarget)\n')).toBe(true)

  edit(dir, 'kalup.config.ts', "  defaultTarget: 'sandbox',\n", '')
  const chosen = await cli(terminal(dir, 'sandbox'), 'state', 'rebuild')
  expect(chosen.exitCode, chosen.stderr).toBe(0)
  expect(chosen.stderr).toContain('Which target?')
  expect(chosen.stdout.startsWith('Target sandbox, portal 1111111 (chosen)\n')).toBe(true)
  expect(portal.writes()).toEqual([])
})
