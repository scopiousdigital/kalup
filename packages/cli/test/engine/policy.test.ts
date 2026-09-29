import { expect, test } from 'vitest'
import { policyOf } from '../../src/engine/policy.js'

test('with config silent: protected on every account but a test portal, sandbox or app developer, drift held, destroys not allowed', () => {
  // An unknown or new account type fails closed: protected.
  for (const accountType of ['STANDARD', 'CRM_TRIAL', 'PARTNER', '']) {
    expect(policyOf({}, accountType), accountType).toEqual({ protected: true, drift: 'hold', allowDestroy: false })
  }
  for (const accountType of ['DEVELOPER_TEST', 'SANDBOX', 'APP_DEVELOPER']) {
    expect(policyOf({ portalId: 1_111_111 }, accountType), accountType).toEqual({
      protected: false,
      drift: 'hold',
      allowDestroy: false,
    })
  }
})

test('config wins over every default, false included', () => {
  expect(policyOf({ protected: false, drift: 'overwrite', allowDestroy: true }, 'STANDARD')).toEqual({
    protected: false,
    drift: 'overwrite',
    allowDestroy: true,
  })
  expect(policyOf({ protected: true, drift: 'hold', allowDestroy: false }, 'DEVELOPER_TEST')).toEqual({
    protected: true,
    drift: 'hold',
    allowDestroy: false,
  })
})

test('credentials and overrides do not enter the policy', () => {
  const target = {
    portalId: 1_111_111,
    credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' }, write: { env: 'HUBSPOT_SANDBOX_WRITE_KEY' } },
    overrides: { 'object:harvest': { skip: true as const } },
  }
  expect(Object.keys(policyOf(target, 'SANDBOX')).sort()).toEqual(['allowDestroy', 'drift', 'protected'])
})
