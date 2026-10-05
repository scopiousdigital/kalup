// The live tier, offline. Its guard refuses any portal but a developer test account or a sandbox before a write, its
// client writes only the run's manifest resources, cleanup archives exactly those after an interrupted run, the
// cleanup command loads under plain Node, and the live journeys themselves (*.live.test.ts) pass through their own
// vitest config with KALUP_LIVE_BACKEND=sim: the live code paths end to end, with the simulator in HubSpot's place.
// Nothing reaches a network: the client gets the simulator's fetch, and the spawned run gets no key.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { createPortalSim, type SimPortalInput } from '../../../engine/test/support/portal-sim.js'
import {
  type Api,
  cleanupAll,
  createApi,
  guarded,
  liveSettings,
  liveUi,
  type ManifestData,
  newManifest,
  newRunId,
  prefixOf,
} from './hubspot.js'

const cli = fileURLToPath(new URL('../../', import.meta.url))
const KEY = 'larkspur-live-offline-key-8e17c2'
const PORTAL = 7_100_001

function portal(accountType: string, portalId = PORTAL): SimPortalInput {
  return {
    portalId,
    accountType,
    keys: { KALUP_LIVE_KEY: KEY },
    objects: {
      companies: {
        groups: [{ name: 'orchard', label: 'Orchard' }],
        properties: [
          { name: 'orchard_rows', label: 'Orchard rows', type: 'number', fieldType: 'number', groupName: 'orchard' },
        ],
      },
    },
  }
}

function setup(accountType = 'DEVELOPER_TEST') {
  const sim = createPortalSim([portal(accountType)])
  const api: Api = createApi({ fetch: sim.fetch as typeof fetch, key: KEY })
  return { sim, api }
}

test('the guard refuses a standard account and a key of another portal before anything is written', async () => {
  const standard = setup('STANDARD')
  await expect(guarded(standard.api, String(PORTAL))).rejects.toThrow(
    'E_ACCOUNT_TYPE: portal 7100001 is a STANDARD account. Live runs go only to a developer test account or a sandbox (DEVELOPER_TEST, SANDBOX), with no override. Nothing was written.',
  )
  expect(standard.sim.writes()).toEqual([])

  const { api } = setup()
  await expect(guarded(api, '7100002')).rejects.toThrow(
    'E_PORTAL_MISMATCH: the key in KALUP_LIVE_KEY does not belong to portal 7100002',
  )
  await expect(guarded(api, 'all')).rejects.toThrow('KALUP_LIVE_PORTAL holds a portal ID')
  await expect(guarded(api, String(PORTAL))).resolves.toEqual({ accountType: 'DEVELOPER_TEST', portalId: PORTAL })
})

test('a live run needs the portal ID as well as the key: a key alone starts nothing', () => {
  // No .env: only the environment given.
  const none = join(mkdtempSync(join(tmpdir(), 'kalup-live-offline-')), '.env')
  expect(() => liveSettings({ KALUP_LIVE_KEY: KEY }, none)).toThrow(
    'set KALUP_LIVE_PORTAL to the ID of the test portal KALUP_LIVE_KEY belongs to',
  )
  expect(() => liveSettings({ KALUP_LIVE_PORTAL: String(PORTAL) }, none)).toThrow('set KALUP_LIVE_KEY')
  expect(liveSettings({ KALUP_LIVE_KEY: KEY, KALUP_LIVE_PORTAL: String(PORTAL) }, none)).toEqual({
    key: KEY,
    portal: String(PORTAL),
  })
})

test('the run client writes only resources its manifest names with the run prefix', async () => {
  const { sim, api } = setup()
  const dir = mkdtempSync(join(tmpdir(), 'kalup-live-offline-'))
  const manifest = newManifest(join(dir, 'run.manifest.json'), {
    runId: newRunId(),
    journey: 'j00',
    backend: 'hubspot',
  })
  const ui = liveUi(api, manifest)

  await expect(ui.editProperty('companies', 'orchard_rows', { label: 'Rows' })).rejects.toThrow(
    'does not carry the run prefix',
  )
  await expect(
    ui.createProperty('companies', { name: 'orchard_soil', type: 'string', fieldType: 'text', groupName: 'orchard' }),
  ).rejects.toThrow('does not carry the run prefix')
  expect(sim.writes()).toEqual([])
})

test('cleanup of an interrupted run archives what its manifest names and nothing else', async () => {
  const { sim, api } = setup()
  const runs = mkdtempSync(join(tmpdir(), 'kalup-live-offline-'))
  const runId = newRunId()
  const prefix = prefixOf(runId)
  const manifest = newManifest(join(runs, `${runId}.manifest.json`), { runId, journey: 'j00', backend: 'hubspot' })
  const ui = liveUi(api, manifest)
  await ui.createGroup('companies', { name: `${prefix}nursery`, label: 'Nursery' })
  await ui.createProperty('companies', {
    name: `${prefix}bed_count`,
    label: 'Bed count',
    type: 'number',
    fieldType: 'number',
    groupName: `${prefix}nursery`,
  })
  const id = await ui.createRecord('companies', `${prefix}record`, {}).catch(() => undefined)
  expect(id).toBeUndefined()
  // The run stopped there: a property it meant to create was recorded, never sent. A manifest edited by hand to name
  // another team's property is refused, never archived.
  manifest.add({ type: 'property', objectType: 'companies', name: `${prefix}seed_trays` })
  manifest.data.resources.push({ type: 'property', objectType: 'companies', name: 'orchard_rows' })
  manifest.add({ type: 'group', objectType: 'companies', name: `${prefix}nursery` })

  const cleaned = (await cleanupAll(api, runs)).map((run) => run.cleaned)
  expect(cleaned.map((c) => c.resources.map((r) => [r.address, r.result]))).toEqual([
    [
      [`record:companies/${prefix}record`, 'unknown'],
      ['property:companies/orchard_rows', 'refused'],
      [`property:companies/${prefix}seed_trays`, 'absent'],
      [`property:companies/${prefix}bed_count`, 'archived'],
      [`group:companies/${prefix}nursery`, 'archived'],
    ],
  ])
  expect(cleaned.map((c) => c.complete)).toEqual([false])
  expect(sim.object(PORTAL, 'companies').properties.get('orchard_rows')?.archived).toBe(false)
  expect(sim.object(PORTAL, 'companies').groups.get('orchard')?.archived).toBe(false)
  const saved = JSON.parse(readFileSync(join(runs, `${runId}.manifest.json`), 'utf8')) as ManifestData
  expect(saved.cleanup?.complete).toBe(false)
})

test('the cleanup command loads under plain Node', () => {
  const out = spawnSync(process.execPath, ['--experimental-strip-types', 'test/e2e/hubspot.ts', 'help'], {
    cwd: cli,
    encoding: 'utf8',
    env: { PATH: process.env.PATH },
  })
  expect(out.stderr).toContain('Usage: node packages/cli/test/e2e/hubspot.ts cleanup')
  expect(out.status).toBe(2)
})

test('the live journeys pass against the simulator through the live config, and leave nothing behind', () => {
  const runs = mkdtempSync(join(tmpdir(), 'kalup-live-offline-'))
  const vitest = join(cli, 'node_modules', 'vitest', 'vitest.mjs')
  const out = spawnSync(process.execPath, [vitest, 'run', '--config', 'vitest.live.config.ts'], {
    cwd: cli,
    encoding: 'utf8',
    // No key and no CI: the run is what `pnpm test:live` does, with the simulator in HubSpot's place.
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: tmpdir(),
      NO_COLOR: '1',
      KALUP_LIVE_BACKEND: 'sim',
      KALUP_LIVE_RUNS: runs,
    },
  })
  expect(out.status, `${out.stdout}${out.stderr}`).toBe(0)
  expect(out.stdout).toContain('Tests  8 passed (8)')

  const files = readdirSync(join(runs, 'e2e'))
  const manifests = files
    .filter((f) => f.endsWith('.manifest.json'))
    .map((f) => JSON.parse(readFileSync(join(runs, 'e2e', f), 'utf8')) as ManifestData)
  expect(manifests.map((m) => m.journey).sort()).toEqual(['j01', 'j02', 'j03', 'j04', 'j05', 'j08', 'j12', 'j13'])
  for (const m of manifests) {
    expect(m.backend).toBe('simulator')
    expect(m.cleanup?.complete, JSON.stringify(m.cleanup)).toBe(true)
    expect(m.resources.every((r) => r.name.startsWith(m.prefix))).toBe(true)
  }
  const transcripts = files.filter((f) => f.endsWith('.transcript.jsonl'))
  expect(transcripts).toHaveLength(8)
  for (const file of transcripts) {
    const text = readFileSync(join(runs, 'e2e', file), 'utf8')
    expect(text).toContain('"args":["pull"')
    expect(text).not.toContain('larkspur-sandbox-key')
    expect(text).not.toContain('8800101')
  }
}, 180_000)
