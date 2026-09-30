import { expect, test } from 'vitest'
import { policyOf } from '../../src/engine/policy.js'

const defaults = { drift: 'hold', adopt: 'hold', allowDestroy: false, yesLimit: 25 }

test('with config silent: protected on every account but a test portal, sandbox or app developer, drift and adoptions held, destroys not allowed, --yes up to 25', () => {
  // An unknown or new account type fails closed: protected.
  for (const accountType of ['STANDARD', 'CRM_TRIAL', 'PARTNER', '']) {
    expect(policyOf({}, accountType), accountType).toEqual({ protected: true, ...defaults })
  }
  for (const accountType of ['DEVELOPER_TEST', 'SANDBOX', 'APP_DEVELOPER']) {
    expect(policyOf({ portalId: 1_111_111 }, accountType), accountType).toEqual({ protected: false, ...defaults })
  }
})

test('config wins over every default, false and 0 included', () => {
  const stated = { protected: false, drift: 'overwrite', adopt: 'overwrite', allowDestroy: true, yesLimit: 0 } as const
  expect(policyOf(stated, 'STANDARD')).toEqual(stated)
  const held = { protected: true, drift: 'hold', adopt: 'hold', allowDestroy: false, yesLimit: 1000 } as const
  expect(policyOf(held, 'DEVELOPER_TEST')).toEqual(held)
})

test('credentials and overrides do not enter the policy', () => {
  const target = {
    portalId: 1_111_111,
    credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' }, write: { env: 'HUBSPOT_SANDBOX_WRITE_KEY' } },
    overrides: { 'object:harvest': { skip: true as const } },
  }
  expect(Object.keys(policyOf(target, 'SANDBOX')).sort()).toEqual([
    'adopt',
    'allowDestroy',
    'drift',
    'protected',
    'yesLimit',
  ])
})
