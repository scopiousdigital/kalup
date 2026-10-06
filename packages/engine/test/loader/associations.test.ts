import { expect, test } from 'vitest'
import { IssueError } from '../../src/grammar/types.js'
import type { Issue } from '../../src/ir/types.js'
import { loadFiles } from '../../src/loader/load.js'
import { validate } from '../../src/loader/validate.js'

const CONFIG = `import { defineConfig } from '@kalup/core'

export default defineConfig({
  objects: {
    companies: {},
    contacts: {},
    deals: {},
    harvest: {},
  },
  targets: {
    sandbox: {
      portalId: 4141414,
      overrides: OVERRIDES,
    },
  },
})
`

// A project of the config above and an associations file whose entries are the given literals, keyed e0, e1, ...
function files(entries: string[], overrides = '{}', extra: Record<string, string> = {}): Record<string, string> {
  const body = entries.map((e, i) => `  e${i}: ${e},`).join('\n')
  return {
    'kalup.config.ts': CONFIG.replace('OVERRIDES', overrides),
    'hubspot/associations.ts': `import { defineAssociations } from '@kalup/core'\n\nexport const Associations = defineAssociations({\n${body}\n})\n`,
    ...extra,
  }
}

function loadIssues(f: Record<string, string>): Issue[] {
  try {
    loadFiles(f)
  } catch (error) {
    if (error instanceof IssueError) {
      return error.issues
    }
    throw error
  }
  return []
}

const codes = (issues: Issue[]) => issues.map((i) => [i.code, i.message])

test('each entry becomes an association resource: a label with both labels, a plain association with none', () => {
  const loaded = loadFiles(
    files([
      "{ from: 'deals', to: 'contacts', name: 'charter_signer', label: 'Signer', inverseLabel: 'Signed charter' }",
      "{ from: 'companies', to: 'contacts', name: 'crew', label: 'Crew' }",
      "{ from: 'harvest', to: 'companies', name: 'harvest_to_company' }",
    ]),
  )
  expect(loaded.ir.resources).toEqual({
    'association:companies/contacts/crew': {
      type: 'association',
      managed: true,
      definition: { label: 'Crew', inverseLabel: 'Crew' },
      binding: { key: 'e1', export: 'Associations' },
    },
    'association:deals/contacts/charter_signer': {
      type: 'association',
      managed: true,
      definition: { label: 'Signer', inverseLabel: 'Signed charter' },
      binding: { key: 'e0', export: 'Associations' },
    },
    'association:harvest/companies/harvest_to_company': {
      type: 'association',
      managed: true,
      definition: {},
      binding: { key: 'e2', export: 'Associations' },
    },
  })
  expect(loaded.sources['association:companies/contacts/crew']).toEqual({
    file: 'hubspot/associations.ts',
    line: 5,
    configPath: 'Associations.e1',
  })
  expect(validate(loaded).issues).toEqual([])
})

test('E_ASSOCIATION_NAME for a name or object no address can hold, E_DUPLICATE_KEY for a name used twice', () => {
  expect(
    codes(
      loadIssues(
        files([
          "{ from: 'deals', to: 'contacts', name: 'a/b', label: 'Signer' }",
          "{ from: 'deals', to: 'contacts', name: 'crew', label: 'Crew' }",
          "{ from: 'companies', to: 'contacts', name: 'crew', label: 'Crew' }",
        ]),
      ),
    ),
  ).toEqual([
    [
      'E_ASSOCIATION_NAME',
      'from, to and name must each be non-empty and hold no whitespace or slash, so an address can hold them',
    ],
    ['E_DUPLICATE_KEY', "internal name 'crew' is used by two entries: 'e1' and 'e2'"],
  ])
})

test('a defineAssociations file anywhere but associations.ts is E_UNSUPPORTED_FILE', () => {
  const found = loadIssues(
    files([], '{}', {
      'hubspot/objects/labels.ts':
        "import { defineAssociations } from '@kalup/core'\n\nexport const Labels = defineAssociations({})\n",
    }),
  )
  expect(codes(found)).toEqual([['E_UNSUPPORTED_FILE', 'a defineAssociations file belongs at hubspot/associations.ts']])
})

test('E_ASSOCIATION_FIELD: an object not under objects, a plain association of two standard objects, two plain associations of one pair, an empty label', () => {
  const found = validate(
    loadFiles(
      files([
        "{ from: 'deals', to: 'tickets', name: 'escalation', label: 'Escalation' }",
        "{ from: 'companies', to: 'contacts', name: 'company_contact' }",
        "{ from: 'harvest', to: 'companies', name: 'harvest_to_company' }",
        "{ from: 'companies', to: 'harvest', name: 'company_to_harvest' }",
        "{ from: 'deals', to: 'contacts', name: 'blank', label: ' ' }",
      ]),
    ),
  ).issues
  expect(codes(found)).toEqual([
    [
      'E_ASSOCIATION_FIELD',
      'association:companies/contacts/company_contact has no label, and HubSpot defines the plain association between companies and contacts',
    ],
    ['E_ASSOCIATION_FIELD', 'label of association:deals/contacts/blank is empty'],
    ['E_ASSOCIATION_FIELD', 'inverseLabel of association:deals/contacts/blank is empty'],
    [
      'E_ASSOCIATION_FIELD',
      'association:deals/tickets/escalation names tickets, which is not under objects in kalup.config.ts',
    ],
    [
      'E_ASSOCIATION_FIELD',
      'association:companies/harvest/company_to_harvest and association:harvest/companies/harvest_to_company are both the plain association of companies/harvest, and a pair has one',
    ],
  ])
})

test('E_DUPLICATE_LABEL: a label shown twice from one object of a pair, ignoring case, whichever entry states it', () => {
  const found = validate(
    loadFiles(
      files([
        "{ from: 'deals', to: 'contacts', name: 'signer', label: 'Signer', inverseLabel: 'Signed' }",
        "{ from: 'deals', to: 'contacts', name: 'cosigner', label: 'signer' }",
        "{ from: 'contacts', to: 'deals', name: 'witness', label: 'SIGNED' }",
      ]),
    ),
  ).issues
  expect(codes(found)).toEqual([
    [
      'E_DUPLICATE_LABEL',
      "association:deals/contacts/cosigner and association:deals/contacts/signer both show 'Signer' from deals, ignoring case",
    ],
    [
      'E_DUPLICATE_LABEL',
      "association:contacts/deals/witness and association:deals/contacts/signer both show 'Signed' from contacts, ignoring case",
    ],
  ])
})

test('a tombstone may name an association; an override may change a label, not a plain association or another field', () => {
  const loaded = loadFiles(
    files(
      [
        "{ from: 'deals', to: 'contacts', name: 'signer', label: 'Signer' }",
        "{ from: 'harvest', to: 'companies', name: 'harvest_to_company' }",
      ],
      `{
        'association:deals/contacts/signer': { definition: { label: 'Signatory', inverseLabel: 'Signed', group: 'x' } },
        'association:harvest/companies/harvest_to_company': { definition: { label: 'Grower' } },
      }`,
      {
        'hubspot/removed.ts':
          "import { defineRemoved } from '@kalup/core'\n\nexport default defineRemoved({\n  'association:deals/contacts/old_signer': { action: 'destroy' },\n})\n",
      },
    ),
  )
  expect(codes(validate(loaded).issues)).toEqual([
    [
      'E_OVERRIDE_DEFINITION',
      'association:deals/contacts/signer on target sandbox: an association override may set label and inverseLabel only, not group',
    ],
    [
      'E_OVERRIDE_DEFINITION',
      'association:harvest/companies/harvest_to_company on target sandbox: a plain association has no label to differ per target',
    ],
  ])
})

test('a label override that two labels of a pair would share on a target is E_OVERRIDE_DEFINITION', () => {
  const loaded = loadFiles(
    files(
      [
        "{ from: 'deals', to: 'contacts', name: 'signer', label: 'Signer' }",
        "{ from: 'deals', to: 'contacts', name: 'witness', label: 'Witness' }",
      ],
      `{ 'association:deals/contacts/witness': { definition: { label: 'signer' } } }`,
    ),
  )
  expect(codes(validate(loaded).issues)).toEqual([
    [
      'E_OVERRIDE_DEFINITION',
      "on target sandbox, association:deals/contacts/signer and association:deals/contacts/witness both show 'signer' from deals, ignoring case",
    ],
  ])
})
