// J10, a large portal: 600 custom company properties across 30 groups. The first pull, the first plan and a plan with
// nothing to do each finish within a budget meant for a slow CI machine, and the generated object file type-checks
// with tsc within one too. The measured times are printed, so a regression shows before it breaches the budget.
import { expect, test } from 'vitest'
import type { SimPropertyInput } from '../../../engine/test/support/portal-sim.js'
import { compileApp, journey, simulator } from './journey.js'
import { initialised, options } from './nursery.js'

/** Per command, generous for a shared CI runner: this machine's times are printed beside it. */
const BUDGET_MS = 20_000
const GROUPS = 30
const PROPERTIES = 600

function bigPortal() {
  const pad = (n: number, width: number) => String(n).padStart(width, '0')
  const groups = Array.from({ length: GROUPS }, (_, g) => ({ name: `bench_${pad(g, 2)}`, label: `Bench ${pad(g, 2)}` }))
  const kinds: Omit<SimPropertyInput, 'name' | 'groupName'>[] = [
    { type: 'number', fieldType: 'number' },
    { type: 'string', fieldType: 'text' },
    { type: 'enumeration', fieldType: 'select', options: options(['seed', 'Seed'], ['plug', 'Plug'], ['pot', 'Pot']) },
    { type: 'date', fieldType: 'date' },
  ]
  const properties = Array.from({ length: PROPERTIES }, (_, i) => ({
    ...kinds[i % kinds.length],
    name: `tray_${pad(i, 3)}`,
    label: `Tray ${pad(i, 3)}`,
    groupName: `bench_${pad(i % GROUPS, 2)}`,
  })) as SimPropertyInput[]
  return { objects: { companies: { groups, properties } } }
}

async function timed<T>(run: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const started = performance.now()
  const value = await run()
  return { ms: Math.round(performance.now() - started), value }
}

test('J10 scale: 600 properties pull, plan and plan again within budget, and the file type-checks', async () => {
  const j = journey(await simulator({ sandbox: bigPortal() }))

  const pull = await timed(() => initialised(j))
  expect(j.read('hubspot/objects/companies.ts').match(/p\.\w+\('tray_\d{3}'/g)).toHaveLength(PROPERTIES)

  const first = await timed(() => j.plan())
  expect(first.value.steps.filter((s) => s.action === 'adopt')).toHaveLength(PROPERTIES + GROUPS)

  j.edit('kalup.config.ts', 'portalId: 8800101,', 'portalId: 8800101,\n      yesLimit: 1000,')
  const apply = await timed(() => j.kalup('apply', '--yes'))
  expect(apply.value.exitCode, apply.value.stderr).toBe(0)
  const noOp = await timed(() => j.planIsEmpty())

  const app = `import { Company, type CompanyData } from '../hubspot/index.js'\n\nexport const count: CompanyData['tray000'] = Company.properties.tray000.get({})\n`
  const tsc = compileApp(j.dir, { 'app/big.ts': app }, '--noEmit')
  expect(tsc.output).toBe('')

  const times = { pull: pull.ms, plan: first.ms, apply: apply.ms, noOpPlan: noOp.ms, tsc: Math.round(tsc.ms) }
  process.stdout.write(`J10 with ${PROPERTIES} properties in ${GROUPS} groups, ms: ${JSON.stringify(times)}\n`)
  for (const ms of Object.values(times)) {
    expect(ms).toBeLessThan(BUDGET_MS)
  }
}, 180_000)
