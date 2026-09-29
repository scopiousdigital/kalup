import { expect, test } from 'vitest'
import { defineConfig, defineRemoved } from '../src/config.js'

// The type cases below run in `pnpm --filter @kalup/core typecheck`, not in vitest, which does not type-check.

test('defineConfig returns its argument untouched: the tool parses the file and never runs it', () => {
  const config = { objects: {}, targets: { sandbox: { portalId: 1_111_111 } } }
  expect(defineConfig(config)).toBe(config)
})

test('a config that uses every field the reader knows type-checks', () => {
  defineConfig({
    name: 'acme-crm',
    prefix: '',
    objects: {
      companies: { include: ['name', 'domain'] },
      products: { include: ['name'], custom: false },
      subscription: { as: 'Subscription' },
    },
    targets: {
      sandbox: { portalId: 1_111_111, credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } } },
      production: {
        portalId: 2_222_222,
        protected: true,
        drift: 'hold',
        allowDestroy: false,
        credentials: { read: { env: 'HUBSPOT_PROD_READ_KEY' }, write: { env: 'HUBSPOT_PROD_WRITE_KEY' } },
        overrides: {
          'property:subscription/customer_status': { name: 'customerstatus' },
          'property:companies/billing_status': {
            definition: {
              label: 'Billing state',
              group: 'billing',
              fieldType: 'select',
              description: 'Where the account stands',
              options: [{ value: 'PAST DUE', label: 'Past due', as: 'past_due', hidden: false, description: 'Late' }],
              hasUniqueValue: false,
              formField: true,
              lifecycle: { options: 'exact', removedOptions: ['old'], ignoreChanges: ['label'], preventDestroy: true },
            },
          },
          'object:subscription': { skip: true },
          'team:sales_emea': { lookup: { name: 'QA team' } },
        },
      },
    },
  })
})

test('a config without objects or targets type-checks, since the writer drops an empty one', () => {
  defineConfig({})
  defineConfig({ targets: { sandbox: { portalId: 1_111_111 } } })
})

test('a wrong portalId type is rejected', () => {
  // @ts-expect-error portalId is a number
  defineConfig({ objects: {}, targets: { sandbox: { portalId: '1111111' } } })
  // @ts-expect-error portalId is required
  defineConfig({ objects: {}, targets: { sandbox: { credentials: { read: { env: 'HUBSPOT_SERVICE_KEY' } } } } })
})

test('a field the reader rejects as unknown does not type-check', () => {
  // @ts-expect-error unknown top-level field
  defineConfig({ objects: {}, targets: {}, extra: true })
  // @ts-expect-error unknown target field
  defineConfig({ objects: {}, targets: { sandbox: { portalId: 1_111_111, region: 'eu' } } })
  // @ts-expect-error includes is a typo for include
  defineConfig({ objects: { companies: { includes: ['name'], custom: false } }, targets: {} })
  // @ts-expect-error a credential holds only the name of an env variable
  defineConfig({ objects: {}, targets: { qa: { portalId: 1_111_111, credentials: { read: { env: 'K', key: 'x' } } } } })
  defineConfig({
    targets: {
      qa: {
        portalId: 1_111_111,
        // @ts-expect-error descripton is a typo for description
        overrides: { 'property:companies/billing_status': { definition: { label: 'L', descripton: 'd' } } },
      },
    },
  })
})

test('defineRemoved returns its argument untouched and types each entry', () => {
  const removed = {
    'property:companies/legacy_score': { action: 'destroy' as const, reason: 'Replaced by lead_score' },
    'group:companies/old_billing': { action: 'release' as const },
  }
  expect(defineRemoved(removed)).toBe(removed)
  // @ts-expect-error this version removes properties and groups only
  defineRemoved({ 'object:parcels': { action: 'destroy' } })
  // @ts-expect-error a property address names its object
  defineRemoved({ 'property:legacy_score': { action: 'destroy' } })
  // @ts-expect-error action is destroy or release
  defineRemoved({ 'property:companies/legacy_score': { action: 'delete' } })
  // @ts-expect-error a tombstone holds action and reason only
  defineRemoved({ 'property:companies/legacy_score': { action: 'destroy', force: true } })
})
