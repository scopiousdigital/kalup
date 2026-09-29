import { expect, test } from 'vitest'
import type { ConfigFile } from '../../src/grammar/types.js'
import { selectTarget, type TargetSelection } from '../../src/loader/select.js'

type Config = Pick<ConfigFile, 'defaultTarget' | 'targets'>

// Arbitrary names, in an order that is neither alphabetical nor by portal ID: choices keep the declaration order.
const three: Config['targets'] = {
  client_b: { portalId: 2_222_222 },
  'acme-eu': { portalId: 1_111_111 },
  'Staging 2': { portalId: 3_333_333 },
}
const choices = [
  { name: 'client_b', portalId: 2_222_222 },
  { name: 'acme-eu', portalId: 1_111_111 },
  { name: 'Staging 2', portalId: 3_333_333 },
]
const one: Config['targets'] = { 'acme-eu': { portalId: 1_111_111 } }

const cases: [string, Config, string | undefined, TargetSelection][] = [
  ['a declared flag', { targets: three }, 'Staging 2', { status: 'selected', name: 'Staging 2', via: 'flag' }],
  ['an undeclared flag', { targets: three }, 'staging', { status: 'unknown', requested: 'staging', choices }],
  [
    'an undeclared flag with one target: no fallback to the only target',
    { targets: one },
    'acme',
    { status: 'unknown', requested: 'acme', choices: [{ name: 'acme-eu', portalId: 1_111_111 }] },
  ],
  [
    'an undeclared flag with a valid default: no fallback to the default',
    { targets: three, defaultTarget: 'acme-eu' },
    'prod',
    { status: 'unknown', requested: 'prod', choices },
  ],
  [
    'a flag over the default',
    { targets: three, defaultTarget: 'acme-eu' },
    'client_b',
    { status: 'selected', name: 'client_b', via: 'flag' },
  ],
  [
    'a flag over an invalid default',
    { targets: three, defaultTarget: 'gone' },
    'client_b',
    { status: 'selected', name: 'client_b', via: 'flag' },
  ],
  [
    'a valid default',
    { targets: three, defaultTarget: 'Staging 2' },
    undefined,
    { status: 'selected', name: 'Staging 2', via: 'default' },
  ],
  [
    'an invalid default',
    { targets: three, defaultTarget: 'gone' },
    undefined,
    { status: 'invalid-default', defaultTarget: 'gone', choices },
  ],
  [
    'an invalid default with one target: no fallback to the only target',
    { targets: one, defaultTarget: 'gone' },
    undefined,
    { status: 'invalid-default', defaultTarget: 'gone', choices: [{ name: 'acme-eu', portalId: 1_111_111 }] },
  ],
  [
    'a default with no targets',
    { targets: {}, defaultTarget: 'acme-eu' },
    undefined,
    { status: 'invalid-default', defaultTarget: 'acme-eu', choices: [] },
  ],
  ['the only target', { targets: one }, undefined, { status: 'selected', name: 'acme-eu', via: 'only' }],
  ['no targets', { targets: {} }, undefined, { status: 'none' }],
  [
    'an undeclared flag and no targets',
    { targets: {} },
    'acme-eu',
    { status: 'unknown', requested: 'acme-eu', choices: [] },
  ],
  ['several targets and no selection', { targets: three }, undefined, { status: 'ambiguous', choices }],
  [
    'two targets and no selection, one without a portalId',
    { targets: { 'acme-eu': { portalId: 1_111_111 }, qa: {} } },
    undefined,
    { status: 'ambiguous', choices: [{ name: 'acme-eu', portalId: 1_111_111 }, { name: 'qa' }] },
  ],
]

test.each(cases)('%s', (_name, config, requested, expected) => {
  expect(selectTarget(config, requested)).toEqual(expected)
  // Pure and deterministic: the same input gives the same answer and leaves the config as it was.
  const before = structuredClone(config)
  expect(selectTarget(config, requested)).toEqual(expected)
  expect(config).toEqual(before)
})

test.each(['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf'])(
  'a name every object inherits is no target: %s as the flag or as the default',
  (name) => {
    expect(selectTarget({ targets: one }, name)).toEqual({
      status: 'unknown',
      requested: name,
      choices: [{ name: 'acme-eu', portalId: 1_111_111 }],
    })
    expect(selectTarget({ targets: three, defaultTarget: name })).toEqual({
      status: 'invalid-default',
      defaultTarget: name,
      choices,
    })
  },
)

test('a target named like an Object.prototype member is a target like any other', () => {
  const targets: Config['targets'] = Object.fromEntries([
    ['toString', { portalId: 4_444_444 }],
    ['constructor', { portalId: 5_555_555 }],
  ])
  expect(selectTarget({ targets }, 'toString')).toEqual({ status: 'selected', name: 'toString', via: 'flag' })
  expect(selectTarget({ targets, defaultTarget: 'constructor' })).toEqual({
    status: 'selected',
    name: 'constructor',
    via: 'default',
  })
  expect(selectTarget({ targets })).toEqual({
    status: 'ambiguous',
    choices: [
      { name: 'toString', portalId: 4_444_444 },
      { name: 'constructor', portalId: 5_555_555 },
    ],
  })
  expect(selectTarget({ targets: { toString: { portalId: 4_444_444 } } })).toEqual({
    status: 'selected',
    name: 'toString',
    via: 'only',
  })
})

test('declaration order decides the choices, so a reordered file reorders the list and selects nothing', () => {
  const reordered = Object.fromEntries(Object.entries(three).reverse())
  expect(selectTarget({ targets: reordered })).toEqual({ status: 'ambiguous', choices: [...choices].reverse() })
})
