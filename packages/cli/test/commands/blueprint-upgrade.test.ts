// kalup blueprint upgrade: offline through the built host. Three client projects made from acme/renewals 1.0.0 move to
// 2.0.0 and then 3.0.0: one left alone, one customized, one that changed a label upstream changed too. After each
// upgrade, plan and apply run against the simulator and a second plan has nothing to do. No add or upgrade sends a
// HubSpot request. The interrupted-write cases run the handler from source with node:fs mocked.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BlueprintLock, IR, LockEntry, Plan } from '@kalup/core'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { blueprintUpgrade, type UpgradeData } from '../../src/commands/blueprint-upgrade.js'
import type { Flags } from '../../src/commands/context.js'
import { cli, parseEnvelope } from '../../src/commands/testing.js'
import { sha256 } from '../../src/lib/blueprint/source.js'
import { KalupError } from '../../src/lib/output.js'
import type { PortalSim } from '../support/portal-sim.js'
import { printed } from '../support/printed.js'
import { edit } from './orchard.js'
import {
  blueprintText,
  deals,
  lockFile,
  noHubSpot,
  orchard,
  original,
  portal,
  projectFiles,
  source,
} from './renewals.js'

const control = vi.hoisted(() => ({ failRename: 0, renames: 0, failRemove: '' }))

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>()
  return {
    ...fs,
    renameSync: (from: string, to: string) => {
      control.renames += 1
      if (control.renames === control.failRename) {
        throw Object.assign(new Error('rename failed'), { code: 'EIO' })
      }
      fs.renameSync(from, to)
    },
    // The staged write's own delete passes no options; its cleanup forces.
    rmSync: (path: string, options?: { force?: boolean }) => {
      if (control.failRemove !== '' && String(path).endsWith(control.failRemove) && !options?.force) {
        throw Object.assign(new Error('remove failed'), { code: 'EPERM' })
      }
      fs.rmSync(path, options)
    },
  }
})

beforeEach(() => {
  control.failRename = 0
  control.renames = 0
  control.failRemove = ''
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const renewal = 'group:deals/renewal'
const renewalDate = 'property:deals/renewal_date'
const renewalStage = 'property:deals/renewal_stage'
const renewalNotes = 'property:deals/renewal_notes'
const renewalAmount = 'property:deals/renewal_amount'
const renewalRisk = 'property:deals/renewal_risk'
const bothVersions = /blueprint\/2.*blueprint\/1/
const digest = /sha256:[0-9a-f]{64}/g

type Steps = [string, string, string[]][]

function text(dir: string, file: string): string {
  return readFileSync(join(dir, file), 'utf8')
}

/** The lock's acme/renewals entry. */
function renewals(dir: string): LockEntry {
  return (JSON.parse(text(dir, lockFile)) as BlueprintLock).blueprints['acme/renewals'] as LockEntry
}

/** Runs a blueprint command with the HubSpot guard in place, then puts the simulator back. */
async function offline(sim: PortalSim | undefined, dir: string, ...argv: string[]) {
  const guard = noHubSpot()
  const out = await cli(dir, ...argv)
  if (guard.urls.length > 0) {
    throw new Error(`a blueprint command sent a request: ${guard.urls.join(', ')}`)
  }
  if (sim) {
    vi.stubGlobal('fetch', sim.fetch)
  }
  return out
}

async function upgrade(sim: PortalSim | undefined, dir: string, version: string, ...rest: string[]) {
  const out = await offline(sim, dir, 'blueprint', 'upgrade', 'acme/renewals', source(dir, version), ...rest, '--json')
  return { ...out, env: parseEnvelope<UpgradeData>(out.stdout) }
}

/** Each step as action, address and the units it changes. */
async function steps(dir: string): Promise<Steps> {
  const out = await cli(dir, 'plan', '--out', 'plan.json', '--json')
  if (out.exitCode !== 0) {
    throw new Error(`the plan failed: ${out.stdout}`)
  }
  const plan = parseEnvelope<Plan>(out.stdout).data as Plan
  return plan.steps.map((s) => [s.action, s.address, (s.changes ?? []).map((c) => c.unit)])
}

/** Plans and applies, and fails unless a second plan has nothing to do. Returns the first plan's steps. */
async function roll(dir: string): Promise<Steps> {
  const planned = await steps(dir)
  const out = await cli(dir, 'apply', 'plan.json', '--yes')
  if (out.exitCode !== 0) {
    throw new Error(`the apply failed: ${out.stdout}${out.stderr}`)
  }
  const left = await steps(dir)
  if (left.length > 0) {
    throw new Error(`a second plan still has steps: ${JSON.stringify(left)}`)
  }
  return planned
}

/** A project with acme/renewals 1.0.0 added. */
async function withBlueprint(sim: PortalSim | undefined, ...options: string[]): Promise<string> {
  const dir = orchard()
  const out = await offline(sim, dir, 'add', source(dir, '1.0.0'), ...options)
  if (out.exitCode !== 0) {
    throw new Error(`the add failed: ${out.stdout}`)
  }
  return dir
}

/** A client project with acme/renewals 1.0.0 added and applied to its portal. */
async function client(sim: PortalSim): Promise<string> {
  const dir = await withBlueprint(sim)
  await roll(dir)
  return dir
}

/**
 * 3.0.0 on a client at 2.0.0, then the same upgrade again, with what each showed: the status of every resource, what
 * the files and the lock hold after it, the provenance, the plan it leads to, and the repeat.
 */
async function third(sim: PortalSim, dir: string) {
  const file = text(dir, deals)
  const start = file.indexOf("p.string('renewal_notes'")
  const notes = file.slice(start, file.indexOf('}),', start))
  const out = await upgrade(sim, dir, '3.0.0')
  const resources = out.env.data?.resources ?? []
  const after = text(dir, deals)
  const ir = JSON.parse((await cli(dir, 'ir')).stdout) as IR
  const planned = await roll(dir)
  const before = projectFiles(dir)
  const again = await upgrade(sim, dir, '3.0.0')
  const human = await offline(sim, dir, 'blueprint', 'upgrade', 'acme/renewals', 'blueprints/renewals-3.0.0.json')
  return {
    exitCode: out.exitCode,
    statuses: Object.fromEntries(resources.map((r) => [r.address, r.status])),
    amount: resources.find((r) => r.address === renewalAmount)?.updated,
    stageNotes: resources.find((r) => r.address === renewalStage)?.notes,
    notesKept: after.includes(notes),
    lostKept: after.includes("{ value: 'lost', label: 'Lost' }"),
    lockLists: Object.keys(renewals(dir).resources),
    sources: Object.keys((JSON.parse(text(dir, lockFile)) as BlueprintLock).sources),
    notesProvenance: ir.resources[renewalNotes]?.provenance,
    riskProvenance: ir.resources[renewalRisk]?.provenance?.version,
    planned,
    again: {
      exitCode: again.exitCode,
      files: again.env.data?.files,
      said: human.stdout.includes('Already at 3.0.0.'),
      unchanged: JSON.stringify(projectFiles(dir)) === JSON.stringify(before),
      steps: await steps(dir),
    },
  }
}

/** What 3.0.0 does on every client, with the stage's status, which depends on the client. */
function thirdOf(stage: string) {
  return {
    exitCode: 0,
    statuses: {
      [renewal]: 'unchanged',
      [renewalAmount]: 'updated',
      [renewalDate]: 'unchanged',
      [renewalNotes]: 'detached',
      [renewalRisk]: 'added',
      [renewalStage]: stage,
    },
    amount: ['label'],
    stageNotes: [expect.stringContaining('option lost')],
    notesKept: true,
    lostKept: true,
    lockLists: [renewal, renewalAmount, renewalDate, renewalRisk, renewalStage],
    sources: [
      'blueprints/renewals-1.0.0.json@1.0.0',
      'blueprints/renewals-2.0.0.json@2.0.0',
      'blueprints/renewals-3.0.0.json@3.0.0',
    ],
    notesProvenance: undefined,
    riskProvenance: '3.0.0',
    planned: [
      ['update', renewalAmount, ['label']],
      ['create', renewalRisk, []],
    ],
    again: { exitCode: 0, files: [], said: true, unchanged: true, steps: [] },
  }
}

test('northwind, unchanged since 1.0.0: every upstream change applies, plan and apply write them', async () => {
  const sim = portal()
  const dir = await client(sim)
  sim.log.length = 0
  const out = await upgrade(sim, dir, '2.0.0')
  expect(out.exitCode, out.stdout).toBe(0)
  expect(out.env.data?.resources.map((r) => [r.address, r.status, r.updated ?? []])).toEqual([
    [renewal, 'unchanged', []],
    [renewalAmount, 'added', []],
    [renewalDate, 'updated', ['label']],
    [renewalNotes, 'updated', ['description']],
    [renewalStage, 'updated', ['options[paused]']],
  ])
  expect(out.env.data?.files).toEqual([original('1.0.0'), original('2.0.0'), lockFile, deals])
  expect(out.env.data?.removed).toEqual([original('1.0.0')])
  expect(existsSync(join(dir, original('1.0.0')))).toBe(false)
  expect(text(dir, original('2.0.0'))).toBe(text(dir, 'blueprints/renewals-2.0.0.json'))
  expect(sim.log).toEqual([])
  expect(await roll(dir)).toEqual([
    ['create', renewalAmount, []],
    ['update', renewalDate, ['label']],
    ['update', renewalNotes, ['description']],
    ['update', renewalStage, ['options.order', 'options[paused]']],
  ])
  expect(await third(sim, dir)).toEqual(thirdOf('unchanged'))
})

test("harbor, customized: the client's label and option survive, the other upstream changes apply", async () => {
  const sim = portal()
  const dir = await client(sim)
  edit(dir, deals, "label: 'Renewal notes',", "label: 'Call notes',")
  edit(
    dir,
    deals,
    "{ value: 'lost', label: 'Lost' },",
    "{ value: 'lost', label: 'Lost' },\n        { value: 'churned', label: 'Churned' },",
  )
  await roll(dir)
  const out = await upgrade(sim, dir, '2.0.0')
  expect(out.exitCode, out.stdout).toBe(0)
  expect(out.env.data?.resources.map((r) => [r.address, r.status, r.updated ?? [], r.kept ?? []])).toEqual([
    [renewal, 'unchanged', [], []],
    [renewalAmount, 'added', [], []],
    [renewalDate, 'updated', ['label'], []],
    [renewalNotes, 'updated', ['description'], ['label']],
    [renewalStage, 'updated', ['options[paused]'], ['options[churned]']],
  ])
  expect(out.env.data?.held).toBe(0)
  const file = text(dir, deals)
  expect(file).toContain("label: 'Call notes',")
  expect(file).toContain("description: 'Notes from the renewal call',")
  expect(file).toContain(
    [
      "        { value: 'open', label: 'Open' },",
      "        { value: 'won', label: 'Won', as: 'renewed' },",
      "        { value: 'paused', label: 'Paused' },",
      "        { value: 'lost', label: 'Lost' },",
      "        { value: 'churned', label: 'Churned' },",
    ].join('\n'),
  )
  expect(await roll(dir)).toEqual([
    ['create', renewalAmount, []],
    ['update', renewalDate, ['label']],
    ['update', renewalNotes, ['description']],
    ['update', renewalStage, ['options.order', 'options[paused]']],
  ])
  expect(await third(sim, dir)).toEqual(thirdOf('kept'))
  expect(text(dir, deals)).toContain("{ value: 'churned', label: 'Churned' }")
})

test('quarry, conflicting: the client keeps its label, the lock holds the conflict, and --take remote resolves it', async () => {
  const sim = portal()
  const dir = await client(sim)
  edit(dir, deals, "label: 'Renewal date',", "label: 'Contract end',")
  await roll(dir)
  const out = await upgrade(sim, dir, '2.0.0', '--exit-code')
  expect(out.exitCode, out.stdout).toBe(2)
  const take =
    "kalup blueprint upgrade acme/renewals blueprints/renewals-2.0.0.json --take remote 'property:deals/renewal_date#label'"
  expect(out.env.data?.resources.find((r) => r.address === renewalDate)).toEqual({
    address: renewalDate,
    sourceAddress: renewalDate,
    status: 'conflict',
    conflicts: [{ unit: 'label', local: 'Contract end', remote: 'Renewal due date', take }],
  })
  expect(out.env.data?.held).toBe(1)
  expect(renewals(dir).held).toEqual([
    { address: renewalDate, unit: 'label', local: 'Contract end', remote: 'Renewal due date' },
  ])
  expect(text(dir, deals)).toContain("label: 'Contract end',")
  expect(await roll(dir)).toEqual([
    ['create', renewalAmount, []],
    ['update', renewalNotes, ['description']],
    ['update', renewalStage, ['options.order', 'options[paused]']],
  ])
  // The same version again: the conflict is still held, and the output says how to take upstream's side.
  const held = await offline(sim, dir, 'blueprint', 'upgrade', 'acme/renewals', 'blueprints/renewals-2.0.0.json')
  expect(held.exitCode).toBe(0)
  expect(printed(held)).toMatchInlineSnapshot(`
    "Blueprint acme/renewals 2.0.0 (sha256:<digest>) from blueprints/renewals-2.0.0.json
    Already at 2.0.0. Nothing was written.
    The lock holds 1 conflict, config's value kept:
      conflict property:deals/renewal_date#label: config "Contract end", upstream "Renewal due date"; take upstream: kalup blueprint upgrade acme/renewals blueprints/renewals-2.0.0.json --take remote 'property:deals/renewal_date#label'
    "
  `)
  const taken = await upgrade(sim, dir, '2.0.0', '--take', 'remote', `${renewalDate}#label`)
  expect(taken.exitCode, taken.stdout).toBe(0)
  expect(taken.env.data?.resources.find((r) => r.address === renewalDate)).toMatchObject({
    status: 'updated',
    updated: ['label'],
  })
  expect(renewals(dir).held).toEqual([])
  expect(text(dir, deals)).toContain("label: 'Renewal due date',")
  expect(await roll(dir)).toEqual([['update', renewalDate, ['label']]])
  expect(await third(sim, dir)).toEqual(thirdOf('unchanged'))
})

test('a held conflict stays held at the next version while upstream leaves the unit alone, and can still be taken', async () => {
  const dir = await withBlueprint(undefined)
  edit(dir, deals, "label: 'Renewal date',", "label: 'Contract end',")
  expect((await upgrade(undefined, dir, '2.0.0')).env.data?.held).toBe(1)
  const out = await upgrade(undefined, dir, '3.0.0', '--exit-code')
  expect(out.exitCode, out.stdout).toBe(2)
  const take =
    "kalup blueprint upgrade acme/renewals blueprints/renewals-3.0.0.json --take remote 'property:deals/renewal_date#label'"
  expect(out.env.data?.resources.find((r) => r.address === renewalDate)).toEqual({
    address: renewalDate,
    sourceAddress: renewalDate,
    status: 'conflict',
    conflicts: [{ unit: 'label', local: 'Contract end', remote: 'Renewal due date', take }],
  })
  expect(renewals(dir).held).toEqual([
    { address: renewalDate, unit: 'label', local: 'Contract end', remote: 'Renewal due date' },
  ])
  const taken = await upgrade(undefined, dir, '3.0.0', '--take', 'remote', `${renewalDate}#label`)
  expect(taken.exitCode, taken.stdout).toBe(0)
  expect(renewals(dir).held).toEqual([])
  expect(text(dir, deals)).toContain("label: 'Renewal due date',")
})

test('a held conflict config settles by hand leaves the lock when the same version runs again', async () => {
  const dir = await withBlueprint(undefined)
  edit(dir, deals, "label: 'Renewal date',", "label: 'Contract end',")
  expect((await upgrade(undefined, dir, '2.0.0')).env.data?.held).toBe(1)
  edit(dir, deals, "label: 'Contract end',", "label: 'Renewal due date',")
  const dry = await upgrade(undefined, dir, '2.0.0', '--exit-code', '--dry-run')
  expect(dry.exitCode, dry.stdout).toBe(0)
  expect(dry.env.data).toMatchObject({ held: 0, files: [lockFile] })
  expect(renewals(dir).held).toHaveLength(1)
  const args = ['blueprint', 'upgrade', 'acme/renewals', 'blueprints/renewals-2.0.0.json', '--exit-code']
  const out = await offline(undefined, dir, ...args)
  expect(out.exitCode, out.stdout).toBe(0)
  expect(out.stdout).toContain(`\nAlready at 2.0.0.\nwrote ${lockFile}\n`)
  expect(renewals(dir).held).toEqual([])
  const again = await upgrade(undefined, dir, '2.0.0', '--exit-code')
  expect(again.exitCode).toBe(0)
  expect(again.env.data).toMatchObject({ held: 0, files: [] })
})

test('--dry-run lists the files the real run writes, leaving out a stored original already on disk', async () => {
  const dir = await withBlueprint(undefined)
  edit(dir, deals, "label: 'Renewal date',", "label: 'Contract end',")
  await upgrade(undefined, dir, '2.0.0')
  const take = ['--take', 'remote', `${renewalDate}#label`]
  const dry = await upgrade(undefined, dir, '2.0.0', ...take, '--dry-run')
  expect(dry.env.data?.files).toEqual([lockFile, deals])
  const real = await upgrade(undefined, dir, '2.0.0', ...take)
  expect(real.env.data?.files).toEqual(dry.env.data?.files)
})

test('an upgrade keeps a lifecycle the file states, preventDestroy: false included', async () => {
  const dir = await withBlueprint(undefined)
  edit(
    dir,
    deals,
    "      fieldType: 'date',\n",
    "      fieldType: 'date',\n      lifecycle: { preventDestroy: false },\n",
  )
  const out = await upgrade(undefined, dir, '2.0.0')
  expect(out.env.data?.resources.find((r) => r.address === renewalDate)?.updated).toEqual(['label'])
  expect(text(dir, deals)).toContain(
    "      label: 'Renewal due date',\n      group: 'renewal',\n      fieldType: 'date',\n      lifecycle: { preventDestroy: false },\n",
  )
})

test('an upgrade adds the .gitattributes rule when the project has lost it', async () => {
  const dir = await withBlueprint(undefined)
  rmSync(join(dir, '.gitattributes'))
  const out = await upgrade(undefined, dir, '2.0.0')
  expect(out.exitCode, out.stdout).toBe(0)
  expect(out.env.data?.files).toContain('.gitattributes')
  expect(text(dir, '.gitattributes')).toBe('kalup/.blueprints/** -text\n')
})

/** Runs an upgrade that must refuse, and fails if it wrote anything. */
async function refused(dir: string, ...argv: string[]) {
  const before = projectFiles(dir)
  const out = await offline(undefined, dir, 'blueprint', 'upgrade', ...argv, '--json')
  if (JSON.stringify(projectFiles(dir)) !== JSON.stringify(before)) {
    throw new Error(`a refused upgrade wrote files: ${out.stdout}`)
  }
  return { exitCode: out.exitCode, issues: parseEnvelope(out.stdout).issues }
}

test('a blueprint the lock does not hold is E_BLUEPRINT_UNKNOWN, and a source holding another one is E_BLUEPRINT_SOURCE', async () => {
  const dir = await withBlueprint(undefined)
  const unknown = await refused(dir, 'acme/billing', source(dir, '2.0.0'))
  expect(unknown.exitCode).toBe(1)
  expect(unknown.issues[0]).toMatchObject({
    code: 'E_BLUEPRINT_UNKNOWN',
    message: expect.stringContaining('acme/billing'),
  })
  writeFileSync(join(dir, 'other.json'), blueprintText('2.0.0').replace('"acme/renewals"', '"acme/billing"'))
  const other = await refused(dir, 'acme/renewals', 'other.json')
  expect(other.exitCode).toBe(1)
  expect(other.issues[0]).toMatchObject({
    code: 'E_BLUEPRINT_SOURCE',
    message: expect.stringContaining('acme/billing'),
  })
})

test('a missing or edited stored original is E_BLUEPRINT_ORIGINAL with the fix to restore it from git', async () => {
  const dir = await withBlueprint(undefined)
  const stored = join(dir, original('1.0.0'))
  writeFileSync(stored, text(dir, original('1.0.0')).replace('Renewal date', 'Renewal day'))
  const edited = await refused(dir, 'acme/renewals', source(dir, '2.0.0'))
  expect(edited.exitCode).toBe(1)
  expect(edited.issues[0]).toMatchObject({
    code: 'E_BLUEPRINT_ORIGINAL',
    message: expect.stringContaining(original('1.0.0')),
    fix: expect.stringContaining(`git checkout -- ${original('1.0.0')}`),
  })
  rmSync(stored)
  const missing = await refused(dir, 'acme/renewals', source(dir, '2.0.0'))
  expect(missing.issues[0]?.message).toContain(`${original('1.0.0')}, is missing;`)
})

test('a stored original of another blueprint version is E_BLUEPRINT_ORIGINAL naming both versions, not a damaged file', async () => {
  const dir = await withBlueprint(undefined)
  // What a kalup that reads blueprint/2 would store and record: the lock agrees with the bytes.
  const bytes = text(dir, original('1.0.0')).replace('"blueprintVersion": 1', '"blueprintVersion": 2')
  writeFileSync(join(dir, original('1.0.0')), bytes)
  const lock = JSON.parse(text(dir, lockFile)) as BlueprintLock
  const entry = lock.blueprints['acme/renewals'] as LockEntry
  entry.hash = sha256(new TextEncoder().encode(bytes))
  lock.sources[`${entry.source}@${entry.version}`] = entry.hash
  writeFileSync(join(dir, lockFile), `${JSON.stringify(lock, null, 2)}\n`)
  const out = await refused(dir, 'acme/renewals', source(dir, '2.0.0'))
  expect(out.exitCode).toBe(1)
  expect(out.issues).toEqual([
    expect.objectContaining({
      code: 'E_BLUEPRINT_ORIGINAL',
      message: expect.stringMatching(bothVersions),
    }),
  ])
})

test('the same source and version with other bytes is E_BLUEPRINT_INTEGRITY naming both hashes', async () => {
  const dir = await withBlueprint(undefined)
  const path = source(dir, '1.0.0')
  const recorded = renewals(dir).hash
  writeFileSync(join(dir, path), blueprintText('1.0.0').replace('Renewal date', 'Renewal day'))
  const out = await refused(dir, 'acme/renewals', path)
  expect(out.exitCode).toBe(1)
  expect(out.issues[0]?.code).toBe('E_BLUEPRINT_INTEGRITY')
  const hashes = String(out.issues[0]?.message).match(digest) ?? []
  expect(hashes).toContain(recorded)
  expect(hashes.filter((hash) => hash !== recorded)).toHaveLength(1)
})

test('--take takes upstream only, and a selector that matches no conflict is E_TAKE_UNMATCHED', async () => {
  const dir = await withBlueprint(undefined)
  const side = await refused(dir, 'acme/renewals', source(dir, '2.0.0'), '--take', 'config', renewalDate)
  expect(side.issues[0]).toMatchObject({ code: 'E_USAGE' })
  expect(side.issues[0]?.message).toContain("--take takes the blueprint's side only")
  const none = await refused(dir, 'acme/renewals', source(dir, '2.0.0'), '--take', 'remote', `${renewalDate}#label`)
  expect(none.exitCode).toBe(1)
  expect(none.issues[0]).toMatchObject({
    code: 'E_TAKE_UNMATCHED',
    message: expect.stringContaining(`--take remote ${renewalDate}#label`),
  })
})

test('--dry-run reports the merge and the files and writes nothing', async () => {
  const dir = await withBlueprint(undefined)
  const path = source(dir, '2.0.0')
  const before = projectFiles(dir)
  const out = await offline(undefined, dir, 'blueprint', 'upgrade', 'acme/renewals', path, '--dry-run')
  expect(out.exitCode).toBe(0)
  expect(printed(out)).toMatchInlineSnapshot(`
    "Blueprint acme/renewals 1.0.0 -> 2.0.0 (sha256:<digest>) from blueprints/renewals-2.0.0.json
      unchanged: group:deals/renewal
      added: property:deals/renewal_amount
      updated from upstream: property:deals/renewal_date (label)
      updated from upstream: property:deals/renewal_notes (description)
      updated from upstream: property:deals/renewal_stage (options[paused])
    would remove kalup/.blueprints/acme--renewals@1.0.0.json
    would write kalup/.blueprints/acme--renewals@2.0.0.json
    would write kalup/blueprints.lock.json
    would write kalup/objects/deals.ts
    Nothing was written. Run it again without --dry-run, then kalup plan --target sandbox shows what it changes in HubSpot.
    "
  `)
  expect(projectFiles(dir)).toEqual(before)
})

test('a lower version warns W_BLUEPRINT_DOWNGRADE and merges like any other', async () => {
  const dir = await withBlueprint(undefined)
  expect((await upgrade(undefined, dir, '2.0.0')).exitCode).toBe(0)
  const out = await upgrade(undefined, dir, '1.0.0')
  expect(out.exitCode).toBe(0)
  expect(out.env.issues).toMatchObject([
    { code: 'W_BLUEPRINT_DOWNGRADE', message: 'acme/renewals goes from 2.0.0 down to 1.0.0' },
  ])
  expect(out.env.data?.resources.find((r) => r.address === renewalAmount)?.status).toBe('detached')
  expect(text(dir, deals)).toContain("label: 'Renewal date',")
  expect(renewals(dir).version).toBe('1.0.0')
})

test('what the client removed stays removed, by hand or with rm', async () => {
  const dir = await withBlueprint(undefined)
  const file = text(dir, deals)
  const start = file.indexOf('    renewalNotes:')
  writeFileSync(join(dir, deals), file.slice(0, start) + file.slice(file.indexOf('}),\n', start) + 4))
  expect((await cli(dir, 'rm', renewalDate, '--release')).exitCode).toBe(0)
  const out = await upgrade(undefined, dir, '2.0.0')
  expect(out.exitCode, out.stdout).toBe(0)
  const status = Object.fromEntries((out.env.data?.resources ?? []).map((r) => [r.address, r.status]))
  expect(status[renewalNotes]).toBe('client-removed')
  expect(status[renewalDate]).toBe('client-removed')
  expect(text(dir, deals)).not.toContain('renewal_notes')
  expect(text(dir, deals)).not.toContain('renewal_date')
  // The lock still lists them: the client may bring them back by hand.
  expect(Object.keys(renewals(dir).resources)).toContain(renewalNotes)
})

test('a resource new upstream that config already has with another definition is a conflict on each differing unit', async () => {
  const dir = await withBlueprint(undefined)
  edit(
    dir,
    deals,
    '  properties: {\n',
    "  properties: {\n    renewalAmount: p.number('renewal_amount', {\n      label: 'Amount at renewal',\n      group: 'renewal',\n      fieldType: 'number',\n    }),\n",
  )
  const out = await upgrade(undefined, dir, '2.0.0')
  expect(out.exitCode, out.stdout).toBe(0)
  expect(out.env.data?.resources.find((r) => r.address === renewalAmount)).toMatchObject({
    status: 'conflict',
    conflicts: [{ unit: 'label', local: 'Amount at renewal', remote: 'Renewal amount' }],
  })
  expect(text(dir, deals)).toContain("label: 'Amount at renewal',")
})

test('a prefixed blueprint upgrades under its recorded prefix, and per-target overrides survive', async () => {
  const dir = await withBlueprint(undefined, '--prefix', 'acme_')
  const date = 'property:deals/acme_renewal_date'
  edit(
    dir,
    'kalup.config.ts',
    'portalId: 1111111,',
    `portalId: 1111111,\n      overrides: { '${date}': { definition: { label: 'Due' } } },`,
  )
  const config = text(dir, 'kalup.config.ts')
  const out = await upgrade(undefined, dir, '2.0.0')
  expect(out.exitCode, out.stdout).toBe(0)
  expect(out.env.data?.resources.find((r) => r.address === date)).toMatchObject({
    sourceAddress: renewalDate,
    status: 'updated',
    updated: ['label'],
  })
  expect(out.env.data?.resources.find((r) => r.address === 'property:deals/acme_renewal_amount')?.status).toBe('added')
  expect(text(dir, deals)).toContain("renewalAmount: p.number('acme_renewal_amount', {")
  expect(text(dir, 'kalup.config.ts')).toBe(config)
})

const flags: Flags = {
  check: false,
  discover: false,
  dryRun: false,
  exitCode: false,
  release: false,
  write: false,
  yes: false,
}

/** The error an upgrade to 2.0.0 run from source throws. */
async function interrupted(dir: string): Promise<unknown> {
  try {
    await blueprintUpgrade({ cwd: dir, args: ['acme/renewals', 'blueprints/renewals-2.0.0.json'], flags })
  } catch (error) {
    return error
  }
  throw new Error('the upgrade did not fail')
}

test('a failure on the second rename leaves config, the lock and both originals as they were', async () => {
  const dir = await withBlueprint(undefined)
  source(dir, '2.0.0')
  const before = projectFiles(dir)
  control.failRename = 2
  const error = await interrupted(dir)
  expect(error).toBeInstanceOf(KalupError)
  expect((error as KalupError).issues[0]).toMatchObject({
    code: 'E_PROJECT_WRITE',
    message: expect.stringContaining(`${original('1.0.0')}, ${original('2.0.0')}, ${lockFile}, ${deals} (EIO)`),
  })
  expect((error as KalupError).exitCode).toBe(1)
  expect(projectFiles(dir)).toEqual(before)
  expect(existsSync(join(dir, original('2.0.0')))).toBe(false)
  // The project still upgrades: the lock and its original agree.
  expect((await upgrade(undefined, dir, '2.0.0')).exitCode).toBe(0)
})

test('a failure removing the old original puts every renamed file back', async () => {
  const dir = await withBlueprint(undefined)
  source(dir, '2.0.0')
  const before = projectFiles(dir)
  control.failRemove = original('1.0.0')
  const error = await interrupted(dir)
  expect(error).toBeInstanceOf(KalupError)
  expect((error as KalupError).issues[0]?.code).toBe('E_PROJECT_WRITE')
  expect((error as KalupError).issues[0]?.message).toContain('(EPERM). Every file was left as it was.')
  expect(projectFiles(dir)).toEqual(before)
})
