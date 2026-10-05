// Reading association labels against the simulator: the pairs in scope, the two type IDs of a label paired by the name
// the schema read gives, the direction config names, HubSpot's own labels left out, a name the schema read does not give
// yet, and what state's type IDs name instead.
import { expect, test } from 'vitest'
import { observeTarget, statusOf } from '../../../src/engine/observe.js'
import { createHttp, createWriteHttp, MILESTONE_3_WRITES } from '../../../src/lib/http.js'
import { associationPairs } from '../../../src/lib/pull/associations.js'
import { type Edit, files, key, loadProject, simPortal } from '../../engine/apply-harness.js'
import type { SimPortalInput } from '../../support/portal-sim.js'

const ASSOCIATIONS = 'hubspot/associations.ts'

const withObjects: Edit = [files.config, 'companies: {},', 'companies: {},\n    deals: {},\n    contacts: {},']

function associationsFile(entries: string[]): string {
  const body = entries.map((e, i) => `  e${i}: ${e},`).join('\n')
  return `import { defineAssociations } from '@kalup/core'\n\nexport const Associations = defineAssociations({\n${body}\n})\n`
}

const signer =
  "{ from: 'deals', to: 'contacts', name: 'charter_signer', label: 'Signer', inverseLabel: 'Signed charter' }"

// The portal: HubSpot's own deals-to-contacts association and label, the signer label and one only HubSpot holds.
const portal: Partial<SimPortalInput> = {
  associations: [
    { from: 'deals', to: 'contacts', name: 'DEAL_TO_CONTACT', category: 'HUBSPOT_DEFINED', typeIds: [3, 4] },
    {
      from: 'contacts',
      to: 'deals',
      name: 'charter_signer',
      label: 'Signed charter',
      inverseLabel: 'Signer',
      typeIds: [21, 20],
    },
    { from: 'companies', to: 'contacts', name: 'crew', label: 'Crew', typeIds: [30, 31] },
  ],
}

async function observe(entries: string[], input = portal, associationIds = {}) {
  const sim = simPortal({}, input)
  const loaded = loadProject([withObjects], { [ASSOCIATIONS]: associationsFile(entries) })
  const http = createHttp({ key, fetch: sim.fetch, warn: () => undefined })
  const { observation, issues } = await observeTarget(http, loaded, 'sandbox', { associationIds })
  return { observation, issues, sim }
}

test('the pairs in scope: those the files name, and those of an object that sets associations', () => {
  const loaded = loadProject([withObjects], { [ASSOCIATIONS]: associationsFile([signer]) })
  expect(associationPairs(loaded.config.objects, loaded.ir, ['companies', 'contacts', 'deals'])).toEqual([
    ['contacts', 'deals'],
  ])
  const all = { ...loaded.config.objects, companies: { associations: true } }
  expect(associationPairs(all, loaded.ir, ['companies', 'contacts', 'deals'])).toEqual([
    ['companies', 'contacts'],
    ['companies', 'deals'],
    ['contacts', 'deals'],
  ])
})

test('a label is read in the direction config names, HubSpot own labels left out, with its type IDs in coverage', async () => {
  const { observation, issues } = await observe([signer])
  expect(issues).toEqual([])
  expect(observation.resources['association:deals/contacts/charter_signer']).toEqual({
    type: 'association',
    managed: true,
    definition: { label: 'Signer', inverseLabel: 'Signed charter' },
  })
  expect(Object.keys(observation.resources).filter((a) => a.startsWith('association:'))).toEqual([
    'association:deals/contacts/charter_signer',
  ])
  expect(observation.coverage?.objects.deals?.associations).toEqual({
    status: 'read',
    with: ['contacts'],
    typeIds: { 'association:deals/contacts/charter_signer': [20, 21] },
  })
  expect(observation.coverage?.objects.contacts?.associations).toEqual({ status: 'read', with: ['deals'] })
  expect(statusOf(observation, 'association:deals/contacts/charter_signer')).toBe('present')
  expect(statusOf(observation, 'association:deals/contacts/missing')).toBe('absent')
  expect(statusOf(observation, 'association:companies/contacts/crew')).toBe('not-observed')
})

test('a type ID the schema read names nothing for is unnamed, never absent, until state names it', async () => {
  const lagging: Partial<SimPortalInput> = { ...portal, associationNameLag: 5 }
  const sim = simPortal({}, lagging)
  // The lag hides only the names of creates, so the label is made through the labels path.
  const http = createWriteHttp({ key, fetch: sim.fetch, warn: () => undefined, allow: MILESTONE_3_WRITES })
  await http.send({
    type: 'association',
    path: 'create',
    params: { fromObjectType: 'deals', toObjectType: 'contacts' },
    body: { name: 'witness', label: 'Witness' },
  })
  const loaded = loadProject([withObjects], {
    [ASSOCIATIONS]: associationsFile([signer, "{ from: 'deals', to: 'contacts', name: 'witness', label: 'Witness' }"]),
  })
  const read = createHttp({ key, fetch: sim.fetch, warn: () => undefined })
  const before = await observeTarget(read, loaded, 'sandbox')
  expect(before.observation.coverage?.objects.deals?.associations?.unnamed).toEqual([9901, 9902])
  expect(before.observation.resources['association:deals/contacts/witness']).toBeUndefined()
  const named = await observeTarget(read, loaded, 'sandbox', {
    associationIds: { 'association:deals/contacts/witness': [9901, 9902] },
  })
  expect(named.observation.resources['association:deals/contacts/witness']).toEqual({
    type: 'association',
    managed: true,
    definition: { label: 'Witness', inverseLabel: 'Witness' },
  })
})

test('a 403 on a labels list makes the pair unreadable and the read incomplete', async () => {
  const { observation, sim } = await observe([signer])
  expect(observation.coverage?.complete).toBe(true)
  sim.fault({ path: '/crm/associations/2026-09/contacts/deals/labels', action: { kind: 'status', status: 403 } })
  const loaded = loadProject([withObjects], { [ASSOCIATIONS]: associationsFile([signer]) })
  const http = createHttp({ key, fetch: sim.fetch, warn: () => undefined })
  const again = await observeTarget(http, loaded, 'sandbox')
  expect(again.observation.coverage?.complete).toBe(false)
  expect(again.observation.coverage?.objects.deals?.associations?.status).toBe('unreadable')
  expect(statusOf(again.observation, 'association:deals/contacts/charter_signer')).toBe('unreadable')
})
