// J9, an interrupted apply: the process dies the moment HubSpot has accepted a property create, before Kalup hears the
// answer. Recovery is a new plan, which adopts the property instead of creating it again. The dead process's lock
// stops the next apply with E_LOCKED, which names the file and when it is safe to delete it; after the person deletes
// it, the apply finishes, HubSpot received exactly one create, and the plan after it is empty.
import { existsSync, rmSync } from 'node:fs'
import { hostname } from 'node:os'
import { expect, test } from 'vitest'
import { printed } from '../support/printed.js'
import { journey, simulator } from './journey.js'
import { initialised, nursery } from './nursery.js'

const CUTTINGS = 'property:companies/cutting_count'
const PROPAGATION = `    cuttingCount: p.number('cutting_count', {
      label: 'Cutting count',
      group: 'propagation',
      fieldType: 'number',
    }),
`
const LOCK_FILE = /delete (\S+\.lock) only when/
const PID = /pid \d+/

test('J9 interrupted apply: plan again adopts what landed, E_LOCKED says how to clear the lock, no duplicate', async () => {
  const j = journey(await simulator({ sandbox: nursery() }))
  await initialised(j)
  j.edit('hubspot/objects/companies.ts', '  groups: {\n', "  groups: {\n    propagation: { label: 'Propagation' },\n")
  j.edit('hubspot/objects/companies.ts', '  },\n})', `${PROPAGATION}  },\n})`)

  const killed = await j.killed(
    (method, path, status) => method === 'POST' && path === '/crm/properties/2026-09/companies' && status === 201,
    'apply',
    '--yes',
  )
  expect(killed.signal).toBe('SIGKILL')
  expect((await j.backend.ui.property('sandbox', 'companies', 'cutting_count')).label).toBe('Cutting count')
  expect(j.state().lastApply?.outcome).toBe('running')
  expect(j.state().resources[CUTTINGS]).toBeUndefined()

  // Recovery is a new plan: what the dead run created is adopted, never created again.
  const plan = await j.kalup<{ steps: { address: string; action: string }[] }>('plan', '--json')
  expect(plan.exitCode, plan.stdout).toBe(0)
  expect(plan.codes).toContain('W_UNFINISHED_APPLY')
  expect(plan.data?.steps.find((s) => s.address === CUTTINGS)?.action).toBe('adopt')

  const locked = await j.kalup('apply', '--yes')
  expect(locked.exitCode).toBe(1)
  const shown = printed(locked).replaceAll(hostname(), '<host>').replace(PID, 'pid <pid>')
  expect(shown).toMatchInlineSnapshot(`
    "--- stderr
    E_LOCKED: portal 8800101 is locked by kalup apply for plan pl_<id> on <host>, pid <pid>, since <time>. That process has ended without releasing the lock. (fix: delete <dir>/locks/portal-8800101.lock only when no kalup command is running on <host>, then run your command again) (docs: errors/E_LOCKED.md)
    "
  `)
  const lock = LOCK_FILE.exec(locked.stderr)?.[1]
  expect(lock !== undefined && existsSync(lock)).toBe(true)
  rmSync(lock as string)

  const recovered = await j.kalup('apply', '--yes')
  expect(recovered.exitCode, recovered.stderr).toBe(0)
  expect(j.state().resources[CUTTINGS]).toMatchObject({ origin: 'adopted' })
  const creates = j
    .requests()
    .filter((r) => r.method === 'POST' && (r.body as { name?: string }).name === 'cutting_count')
  expect(creates.map((r) => r.status)).toEqual([201])
  await j.planIsEmpty()
}, 60_000)
