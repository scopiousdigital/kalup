// Scenario: the first run. init pulls the portal into files, and pull records in state the base of every unit the files
// and the portal agree on, so a later edit in a file is a config change a plan writes, not a difference it holds. A
// resource no entry owns gets a `pulled` entry, which owns nothing: the plan still adopts it, as a reviewed step.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { normalise } from '../../../engine/test/support/normalise.js'
import { fault } from '../../../engine/test/support/portal-sim.js'
import type { PullData } from '../../src/commands/pull.js'
import { cli, parseEnvelope } from '../../src/commands/testing.js'
import {
  apply,
  applyNow,
  configFile,
  edit,
  environment,
  hiveCount,
  live,
  liveProperty,
  objectsFile,
  planIsEmpty,
  planOf,
  portal,
  portalId,
  project,
  readKey,
  stateBytes,
  stateOf,
  writesOf,
} from './harness.js'

beforeEach(() => {
  environment()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

/** The Kestrel portal as an admin left it before Kalup: the apiary group and hive_count, read with the default key. */
function before() {
  const sim = portal({
    keys: { HUBSPOT_SERVICE_KEY: readKey },
    objects: {
      companies: {
        groups: [{ name: 'apiary', label: 'Apiary' }],
        properties: [liveProperty({ name: 'hive_count', label: 'Hive count' })],
      },
    },
  })
  vi.stubEnv('HUBSPOT_SERVICE_KEY', readKey)
  return sim
}

test('init, pull, edit a label: the plan writes it as a config change, apply writes it, and the next plan is empty', async () => {
  const sim = before()
  const dir = mkdtempSync(join(tmpdir(), 'kestrel-first-'))
  const init = await cli(dir, 'init', '--portal', String(portalId), '--objects', 'companies')
  expect(init.exitCode, init.stdout).toBe(0)
  // init pulled: the files hold what the portal holds, and state records that they agree. Nothing owns it yet.
  expect(stateOf(dir).resources).toEqual({
    'group:companies/apiary': { origin: 'pulled', id: 'apiary', normVersion: 1, base: { label: 'Apiary' } },
    [hiveCount]: {
      origin: 'pulled',
      id: 'hive_count',
      normVersion: 1,
      base: {
        description: '',
        formField: false,
        hasUniqueValue: false,
        fieldType: 'number',
        group: { $ref: 'group:companies/apiary' },
        label: 'Hive count',
        type: 'number',
      },
    },
  })
  expect(writesOf(sim)).toEqual([])

  const pulled = await cli(dir, 'pull', '--json')
  expect(pulled.exitCode, pulled.stdout).toBe(0)
  // A pull with nothing new records nothing, so the serial stays.
  expect(parseEnvelope<PullData>(pulled.stdout).data?.state).toMatchObject({ recorded: 0, serial: 1 })

  edit(dir, objectsFile, "label: 'Hive count'", "label: 'Hives kept'")
  const text = await cli(dir, 'plan')
  expect(text.exitCode, text.stderr).toBe(0)
  expect(normalise(text.stdout)).toMatchInlineSnapshot(`
    "Target sandbox, portal 7700001 (the only target)
    Plan pl_<id> for target sandbox, portal 7700001 (SANDBOX, not protected)
    Settings: mode addon; adopt hold; drift hold; allowDestroy false; yesLimit 25
    s1 safe Adopt property group "Apiary" (apiary) on companies
    s2 safe Adopt property "Hives kept" (hive_count) on companies, set label
      label: "Hive count" -> "Hives kept"
    2 safe, 0 risky, 0 destructive, 0 blocked, 0 manual; 0 held
    Coverage: complete; 0 unsupported, 0 skipped.
    About 8 API calls; 999984 left today.
    Not copied, HubSpot has no API: conditional property logic, field-level permissions.
    "
  `)
  const plan = await planOf(dir)
  const step = plan.steps.find((s) => s.address === hiveCount)
  expect(step).toMatchObject({
    action: 'adopt',
    risk: 'safe',
    changes: [{ unit: 'label', class: 'config-change', op: 'set', before: 'Hive count', after: 'Hives kept' }],
  })
  expect(step?.held).toBeUndefined()
  expect(plan.counts.held).toBe(0)

  const out = await apply(dir, '--yes', '--json')
  expect(out.exitCode, out.stdout).toBe(0)
  expect(live(sim, 'hive_count').label).toBe('Hives kept')
  expect(stateOf(dir).resources[hiveCount]).toMatchObject({ origin: 'adopted', base: { label: 'Hives kept' } })
  await planIsEmpty(dir)
})

test('an owned property: pull takes an admin edit, records it, and a later edit in the file is a config change', async () => {
  const sim = portal()
  const dir = project()
  await applyNow(dir)
  live(sim, 'hive_count').label = 'Hives kept'
  const pulled = await cli(dir, 'pull')
  expect(pulled.exitCode, pulled.stderr).toBe(0)
  expect(stateOf(dir).resources[hiveCount]).toMatchObject({ origin: 'created', base: { label: 'Hives kept' } })

  edit(dir, objectsFile, "label: 'Hives kept'", "label: 'Hives on site'")
  const plan = await planOf(dir)
  const step = plan.steps.find((s) => s.address === hiveCount)
  expect(step).toMatchObject({
    action: 'update',
    risk: 'safe',
    changes: [{ unit: 'label', class: 'config-change', before: 'Hives kept', after: 'Hives on site' }],
  })
  expect(plan.counts.held).toBe(0)
  expect((await apply(dir, '--yes')).exitCode).toBe(0)
  expect(live(sim, 'hive_count').label).toBe('Hives on site')
  await planIsEmpty(dir)
})

test('pull --check records nothing, a held unit keeps its base, and an incomplete read records nothing', async () => {
  const sim = portal()
  const dir = project()
  await applyNow(dir)
  const saved = stateBytes(dir)
  live(sim, 'hive_count').label = 'Hives kept'
  expect((await cli(dir, 'pull', '--check')).exitCode).toBe(0)
  expect(stateBytes(dir)).toBe(saved)

  // A config change pull keeps is not agreed, so its base stays where the last apply left it.
  edit(dir, objectsFile, "label: 'Hive count'", "label: 'Hives on site'")
  live(sim, 'hive_count').label = 'Hive count'
  expect((await cli(dir, 'pull')).exitCode).toBe(0)
  expect(readFileSync(join(dir, objectsFile), 'utf8')).toContain("label: 'Hives on site'")
  expect(stateBytes(dir)).toBe(saved)

  // A 403 on another object's list makes the read incomplete: pull exits 1 and records no base.
  edit(dir, objectsFile, "label: 'Hives on site'", "label: 'Hive count'")
  live(sim, 'hive_count').label = 'Hives kept'
  edit(dir, configFile, '    companies: {},\n', '    companies: {},\n    deals: {},\n')
  const scope = { status: 'error', category: 'MISSING_SCOPES', message: 'This app lacks crm.schemas.deals.read.' }
  sim.fault({ method: 'GET', path: '/crm/properties/2026-09/deals', action: fault.status(403, scope) })
  const incomplete = await cli(dir, 'pull', '--json')
  expect(incomplete.exitCode).toBe(1)
  expect(stateBytes(dir)).toBe(saved)
})

test('a pull that writes takes the portal lock, and refuses while another command holds it', async () => {
  portal()
  const dir = project()
  writeFileSync(join(process.env.KALUP_LOCK_DIR as string, `portal-${portalId}.lock`), '{"command":"apply"}\n')
  const out = await cli(dir, 'pull', '--json')
  expect(out.exitCode).toBe(1)
  expect(parseEnvelope(out.stdout).issues.map((i) => i.code)).toEqual(['E_LOCKED'])
  // --check writes nothing, so it takes no lock.
  expect((await cli(dir, 'pull', '--check')).exitCode).toBe(0)
})
