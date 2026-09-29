// Scenario: two cooperating writers, with different target names in two checkouts of the project, against one portal
// and one lock directory. The first apply runs as a process of its own, held at its write through the simulator; the
// second, run meanwhile, gets E_LOCKED before it reads state or sends anything but the guard. Once the first is done,
// the second's saved plan is refused E_STATE_CHANGED when the two share state (a state directory both name, or the
// worktrees of one clone), and when they do not (two clones), the second holds the first's change as drift and never
// writes over it. No writes interleave.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { PortalSim } from '../support/portal-sim.js'
import {
  APIARY,
  apply,
  applyNow,
  companies,
  edit,
  effects,
  environment,
  guardPath,
  HIVE_COUNT,
  HONEY_GRADE,
  hiveCount,
  honeyGrade,
  live,
  objectsFile,
  planOf,
  portal,
  portalId,
  project,
  savePlan,
  spawnKalup,
  stateBytes,
  stateOf,
  statePath,
} from './harness.js'

beforeEach(() => {
  environment()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const properties = `${HIVE_COUNT}${HONEY_GRADE}`

/** Two checkouts naming the portal by different targets: sandbox in the first, hive_lab in the second. */
function checkouts(dirs: { first?: string; second?: string } = {}): { first: string; second: string } {
  return {
    first: project({ dir: dirs.first, groups: APIARY, properties, target: { name: 'sandbox' } }),
    second: project({ dir: dirs.second, groups: APIARY, properties, target: { name: 'hive_lab' } }),
  }
}

/**
 * Two checkouts that share state: a state directory both name (a CI state-branch worktree), or the main worktree of a
 * clone and a linked worktree of it, laid out as git leaves them. The state file is the first checkout's.
 */
const sharing = {
  'KALUP_STATE_DIR names one state directory': () => {
    vi.stubEnv('KALUP_STATE_DIR', join(mkdtempSync(join(tmpdir(), 'kestrel-state-')), 'state-branch'))
    return checkouts()
  },
  'the two are worktrees of one clone': () => {
    const root = mkdtempSync(join(tmpdir(), 'kestrel-clone-'))
    const main = join(root, 'main')
    const linked = join(root, 'hive-lab')
    const admin = join(main, '.git', 'worktrees', 'hive-lab')
    mkdirSync(admin, { recursive: true })
    mkdirSync(linked)
    writeFileSync(join(admin, 'commondir'), '../..\n')
    writeFileSync(join(admin, 'gitdir'), `${join(linked, '.git')}\n`)
    writeFileSync(join(linked, '.git'), `gitdir: ${admin}\n`)
    return checkouts({ first: main, second: linked })
  },
}

/** Holds the first request that is not a GET: `reached` resolves when it arrives, and `release` lets it through. */
function gate() {
  let release: () => void = () => undefined
  let arrive: () => void = () => undefined
  const open = new Promise<void>((resolve) => {
    release = resolve
  })
  const reached = new Promise<void>((resolve) => {
    arrive = resolve
  })
  let held = false
  const before = async (asked: { method: string }) => {
    if (asked.method !== 'GET' && !held) {
      held = true
      arrive()
      await open
    }
  }
  return { before, reached, release: () => release() }
}

/**
 * Both checkouts plan a change. The first applies in a process of its own, held at its first write, while the second
 * applies its saved plan. The second's state file (`secondState`) is unreadable meanwhile, so a read of it before the
 * lock would fail with another code. Then the first is let through and finishes. Returns what each run did.
 */
async function race(sim: PortalSim, first: string, second: string, secondState: string) {
  edit(first, objectsFile, "label: 'Hive count'", "label: 'Hives on site'")
  const firstPlan = await savePlan(first)
  edit(second, objectsFile, "label: 'Honey grade'", "label: 'Honey class'")
  const secondPlan = await savePlan(second)

  const hold = gate()
  const start = sim.log.length
  const running = spawnKalup(sim, first, ['apply', 'plan.json', '--yes', '--json'], { before: hold.before })
  // A first run that exits before its write fails here with its own output, not as a timeout.
  await Promise.race([
    hold.reached,
    running.then((e) => {
      throw new Error(`the first apply exited before its write: code ${e.code}, ${e.stderr}${e.stdout}`)
    }),
  ])

  const bytes = readFileSync(secondState, 'utf8')
  writeFileSync(secondState, 'not a state file\n')
  const from = sim.log.length
  const locked = await apply(second, 'plan.json', '--yes', '--json')
  writeFileSync(secondState, bytes)
  const lockedRequests = sim.log.slice(from).map((r) => `${r.method} ${r.path}`)

  hold.release()
  const done = await running
  return {
    firstPlan,
    planned: [effects(firstPlan).map((s) => s.address), effects(secondPlan).map((s) => s.address)],
    locked: { exitCode: locked.exitCode, codes: locked.codes, message: locked.issues[0]?.message ?? '' },
    lockedRequests,
    first: { code: done.code, outcome: JSON.parse(done.stdout || '{}').data?.outcome, stderr: done.stderr },
    // Every write from the first run's start to its end: the first run's own, if nothing interleaved.
    during: sim.log
      .slice(start)
      .filter((r) => r.method !== 'GET')
      .map((r) => `${r.method} ${r.path}`),
    end: sim.log.length,
  }
}

/** What the race shows in every setup: the second locked out after the guard, the first done with its one write. */
function raced(planId: string) {
  return {
    planned: [[hiveCount], [honeyGrade]],
    locked: {
      exitCode: 1,
      codes: ['E_LOCKED'],
      message: expect.stringContaining(`portal ${portalId} is locked by kalup apply for plan ${planId}`),
    },
    lockedRequests: [`GET ${guardPath}`],
    first: { code: 0, outcome: 'done' },
    during: [`PATCH ${companies}/hive_count`],
  }
}

test.each(Object.keys(sharing))(
  'two cooperating writers, different aliases and checkouts, sharing state (%s): E_LOCKED, then E_STATE_CHANGED',
  async (setup) => {
    const sim = portal()
    const { first, second } = sharing[setup as keyof typeof sharing]()
    await applyNow(first)
    // One state file for the portal: the second checkout owns what the first created, under its own target name.
    const shared = statePath(first)
    const view = await planOf(second)
    expect(view.steps).toEqual([])
    expect(view.stateLineage).toBe(stateOf(first).lineage)
    expect(existsSync(join(second, '.kalup', 'state'))).toBe(false)

    const { end, firstPlan, ...seen } = await race(sim, first, second, shared)
    expect(seen).toMatchObject(raced(firstPlan.planId))
    expect(live(sim, 'hive_count').label).toBe('Hives on site')
    const bytes = stateBytes(first)
    expect(stateOf(first).lastApply).toMatchObject({ planId: firstPlan.planId, outcome: 'done' })

    // The second's plan was made before the first applied, from the state the first has since moved.
    const out = await apply(second, 'plan.json', '--yes', '--json')
    expect(out.exitCode, out.stdout).toBe(1)
    expect(out.codes).toEqual(['E_STATE_CHANGED'])
    expect(sim.log.slice(end).map((r) => `${r.method} ${r.path}`)).toEqual([`GET ${guardPath}`])
    expect(stateBytes(first)).toBe(bytes)
    expect(live(sim, 'honey_grade').label).toBe('Honey grade')
  },
)

test('two cooperating writers, different aliases and checkouts, separate state: E_LOCKED, then the change held as drift', async () => {
  const sim = portal()
  const { first, second } = checkouts()
  await applyNow(first)
  // Separate clones keep separate state: the second adopts what the first created, writing nothing.
  const adoption = await applyNow(second)
  expect(effects(adoption).map((s) => s.action)).toEqual(['adopt', 'adopt', 'adopt'])
  expect(statePath(second)).not.toBe(statePath(first))
  expect(stateOf(second).resources[hiveCount]).toMatchObject({ origin: 'adopted', base: { label: 'Hive count' } })
  expect(sim.writes().map((w) => `${w.method} ${w.path}`)).toEqual([
    `POST ${companies}/groups`,
    `POST ${companies}`,
    `POST ${companies}`,
  ])

  const { end, firstPlan, ...seen } = await race(sim, first, second, statePath(second))
  expect(seen).toMatchObject(raced(firstPlan.planId))
  expect(live(sim, 'hive_count').label).toBe('Hives on site')
  // The second's own state did not move, so its earlier plan still applies: it writes only what it planned.
  const out = await apply(second, 'plan.json', '--yes', '--json')
  expect(out.exitCode, out.stdout).toBe(0)
  const after = sim.log.slice(end).filter((r) => r.method !== 'GET')
  expect(after.map((r) => `${r.method} ${r.path}`)).toEqual([`PATCH ${companies}/honey_grade`])

  // The first's change is drift to the second: held, never written back.
  const plan = await planOf(second)
  const step = plan.steps.find((s) => s.address === hiveCount)
  expect(step?.held).toMatchObject([{ unit: 'label', class: 'drift', config: 'Hive count', live: 'Hives on site' }])
  expect(step?.changes ?? []).toEqual([])
  expect(effects(plan)).toEqual([])
  const again = await apply(second, '--yes', '--json')
  expect(again.data?.outcome).toBe('nothing')
  // Nothing the second ran after the first's change wrote to hive_count.
  expect(sim.log.slice(end).filter((r) => r.method !== 'GET' && r.path === `${companies}/hive_count`)).toEqual([])
  expect(live(sim, 'hive_count').label).toBe('Hives on site')
  expect(stateOf(second).resources[hiveCount]?.base).toMatchObject({ label: 'Hive count' })
})
