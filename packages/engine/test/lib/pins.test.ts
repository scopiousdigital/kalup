import { expect, test } from 'vitest'
import { pinWarnings } from '../../src/lib/pins.js'
import { registry } from '../../src/lib/registry.js'

const near = Date.parse('2028-01-15T00:00:00Z')

test('a pin within 90 days of its expiry month is one W_PIN_EXPIRES per API family, in row order', () => {
  expect(pinWarnings(Object.values(registry), near)).toEqual([
    {
      code: 'W_PIN_EXPIRES',
      message: 'the crm.properties API pin 2026-09 expires 2028-03',
      fix: 'upgrade kalup to a release that pins a newer version',
    },
    expect.objectContaining({ message: 'the crm-object-schemas API pin 2026-09 expires 2028-03' }),
    expect.objectContaining({ message: 'the crm.pipelines API pin 2026-09 expires 2028-03' }),
    expect.objectContaining({ message: 'the crm.associations API pin 2026-09 expires 2028-03' }),
    expect.objectContaining({ message: 'the account-info API pin 2026-09 expires 2028-03' }),
    expect.objectContaining({ message: 'the crm.limits API pin 2026-09 expires 2028-03' }),
  ])
})

test('only the rows given are checked, and a pin further out than 90 days is quiet', () => {
  expect(pinWarnings([registry.group, registry.property], near).map((issue) => issue.message)).toEqual([
    'the crm.properties API pin 2026-09 expires 2028-03',
  ])
  expect(pinWarnings(Object.values(registry), Date.parse('2027-11-01T00:00:00Z'))).toEqual([])
})

test('a row without an expiry, pinned to a path version with no stated sunset, warns nothing', () => {
  const rows = [
    { family: 'oauth.private-apps', version: 'v2', status: 'ga', paths: {} },
    { family: 'crm.properties', version: '2026-09', status: 'ga', expires: '2026-10', paths: {} },
  ] as const
  const warnings = pinWarnings([...rows], Date.parse('2026-09-30T00:00:00Z'))
  expect(warnings.map((w) => w.message)).toEqual(['the crm.properties API pin 2026-09 expires 2026-10'])
})
