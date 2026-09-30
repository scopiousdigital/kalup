// J7, an agency with two targets: a sandbox where changes are made first and a client portal. A property added in
// config is applied to the sandbox, compare shows how the client differs, and the change is promoted to the client,
// which already holds that property with its own label. The first plan holds the differing label as diverged; with
// adopt: 'overwrite' on the client, config's value is written as a risky step a person confirms from a saved plan.
import { expect, test } from 'vitest'
import { printed } from '../support/printed.js'
import { journey, simulator } from './journey.js'
import { initialised, nursery, nurseryGroup, nurseryProperties } from './nursery.js'

const TRAYS = 'property:companies/seed_trays'
const SEED_TRAYS = `    seedTrays: p.number('seed_trays', {
      label: 'Seed trays',
      group: 'nursery',
      fieldType: 'number',
    }),
`
const CLIENT = `    client: {
      portalId: 8800202,
      credentials: { read: { env: 'HUBSPOT_CLIENT_KEY' } },
    },
`

test('J7 two targets: compare, then promote a sandbox change to a client that holds it differently', async () => {
  const clientTrays = { name: 'seed_trays', label: 'Trays', type: 'number', fieldType: 'number', groupName: 'nursery' }
  const j = journey(
    await simulator({
      sandbox: nursery(),
      client: {
        accountType: 'STANDARD',
        variable: 'HUBSPOT_CLIENT_KEY',
        objects: { companies: { groups: [nurseryGroup], properties: [...nurseryProperties(), clientTrays] } },
      },
    }),
  )
  await initialised(j)
  j.edit('kalup.config.ts', '  targets: {\n', `  targets: {\n${CLIENT}`)

  // Made in config and applied to the sandbox first.
  j.edit('kalup/objects/companies.ts', '  },\n})', `${SEED_TRAYS}  },\n})`)
  const sandbox = await j.kalup('apply', '--target', 'sandbox', '--yes')
  expect(sandbox.exitCode, sandbox.stderr).toBe(0)

  const compare = await j.kalup('compare', 'sandbox', 'client')
  expect(compare.exitCode, compare.stderr).toBe(0)
  expect(printed(compare)).toMatchInlineSnapshot(`
    "a: target sandbox, portal 8800101
    b: target client, portal 8800202
    7 equal, 1 differs, 0 only in a, 0 only in b, 0 unmanaged, 0 unknown, 0 skipped
    differs: property:companies/seed_trays
      label differs: a "Seed trays", b "Trays"
    "
  `)
  const diff = await j.kalup<{ differences: { address: string }[] }>('compare', 'sandbox', 'client', '--json')
  expect(diff.exitCode, diff.stdout).toBe(0)

  // Promoted: the client holds seed_trays under another label, so a plain adoption holds it.
  const held = await j.plan('--target', 'client')
  expect(held.steps.find((s) => s.address === TRAYS)).toMatchObject({
    action: 'adopt',
    risk: 'safe',
    held: [{ unit: 'label', class: 'diverged', config: 'Seed trays', live: 'Trays' }],
  })

  j.edit('kalup.config.ts', 'portalId: 8800202,', "portalId: 8800202,\n      adopt: 'overwrite',")
  const saved = await j.kalup('plan', '--target', 'client', '--out', 'client-plan.json', '--json')
  expect(saved.exitCode, saved.stdout).toBe(0)
  const step = (saved.data as { steps: { address: string }[] }).steps.find((s) => s.address === TRAYS)
  expect(step).toMatchObject({
    action: 'adopt',
    risk: 'risky',
    labels: ['overwrites-portal'],
    changes: [{ unit: 'label', class: 'diverged', before: 'Trays', after: 'Seed trays' }],
  })
  const yes = await j.kalup('apply', 'client-plan.json', '--yes', '--json')
  expect(yes.exitCode).toBe(4)
  expect(yes.codes).toEqual(['E_APPROVAL_REQUIRED'])

  const confirmed = await j.terminal(['apply', 'client-plan.json'], { 'Type the target name to apply:': 'client' })
  expect(confirmed.exitCode, confirmed.printed).toBe(0)
  expect(confirmed.printed).toContain('risky [overwrites-portal] Adopt property "Seed trays" (seed_trays)')
  expect((await j.backend.ui.property('client', 'companies', 'seed_trays')).label).toBe('Seed trays')
  await j.planIsEmpty('--target', 'client')
  await j.planIsEmpty('--target', 'sandbox')
  const same = await j.kalup('compare', 'sandbox', 'client', '--exit-code')
  expect(same.exitCode, same.stdout).toBe(0)
}, 60_000)
