import { expect, test } from 'vitest'
import { originalPath, parseLock, validateLock } from '../../src/blueprint/lock.js'
import type { BlueprintLock } from '../../src/blueprint/types.js'
import { IssueError } from '../../src/grammar/types.js'
import { layout } from '../../src/loader/layout.js'
import { fixture, fixtureText } from '../ir/fixture.js'
import { prose } from '../support/prose.js'

const at = layout('hubspot')
const LOCK_FILE = at.lock

const example = (): BlueprintLock => fixture<BlueprintLock>('blueprints-lock-example.json')
const entry = (lock: BlueprintLock) =>
  lock.blueprints['acme/renewals'] as NonNullable<BlueprintLock['blueprints'][string]>
const messages = (document: unknown) => validateLock(document, at).map((i) => `${i.configPath}: ${i.message}`)

test('the example is a lock, and parseLock returns it', () => {
  expect(validateLock(example(), at)).toEqual([])
  expect(parseLock(fixtureText('blueprints-lock-example.json'), at)).toEqual(example())
})

test('the original of a version is under hubspot/.blueprints, the slash as two dashes', () => {
  expect(originalPath(at, 'acme/renewals', '1.1.0')).toBe('hubspot/.blueprints/acme--renewals@1.1.0.json')
  expect(originalPath(at, 'renewals', '2.0.0-rc.1')).toBe('hubspot/.blueprints/renewals@2.0.0-rc.1.json')
})

test('issues are E_BLUEPRINT_LOCK on the lock file with the fix to restore it from git', () => {
  const lock = example()
  Object.assign(lock, { lockVersion: 2 })
  expect(validateLock(lock, at)).toEqual([
    {
      code: 'E_BLUEPRINT_LOCK',
      message: expect.any(String),
      file: LOCK_FILE,
      configPath: 'lockVersion',
      fix: expect.any(String),
    },
  ])
  expect(prose(validateLock(lock, at))).toMatchInlineSnapshot(`
    [
      "expected 1 (fix: restore hubspot/blueprints.lock.json from git: kalup add and kalup blueprint upgrade write it, never a person)",
    ]
  `)
})

test('another lock version, written by another version of kalup, is refused by its version alone', () => {
  // A newer lock may be shaped in any way: only lockVersion is read.
  const text = JSON.stringify({ ...example(), lockVersion: 2, blueprints: [] })
  expect(() => parseLock(text, at)).toThrow(IssueError)
  try {
    parseLock(text, at)
  } catch (error) {
    expect((error as IssueError).issues).toEqual([
      {
        code: 'E_BLUEPRINT_LOCK',
        message: expect.any(String),
        file: LOCK_FILE,
        configPath: 'lockVersion',
        fix: expect.any(String),
      },
    ])
    expect(prose((error as IssueError).issues)).toMatchInlineSnapshot(`
      [
        "the lock is blueprints-lock/2, and this version of kalup reads blueprints-lock/1 (fix: use the version of kalup that wrote it, or a newer one)",
      ]
    `)
  }
})

test.each([
  ['an unknown field', (l: BlueprintLock) => Object.assign(entry(l), { note: 'x' }), 'unexpected field "note"'],
  [
    'a hash that is not sha256',
    (l: BlueprintLock) => Object.assign(entry(l), { hash: 'md5:1' }),
    '.hash: does not match',
  ],
  [
    'a prefix that is not plain',
    (l: BlueprintLock) => Object.assign(entry(l), { prefix: 'Acme-' }),
    '.prefix: does not match',
  ],
  [
    'a resource that is not a group or property',
    (l: BlueprintLock) => Object.assign(entry(l).resources, { 'object:deals': 'object:deals' }),
    'unexpected field "object:deals"',
  ],
  [
    'a name with two dashes in a row, whose original would be acme/renewals',
    (l: BlueprintLock) => Object.assign(l.blueprints, { 'acme--renewals': entry(l) }),
    'unexpected field "acme--renewals"',
  ],
  [
    'a held unit without a unit',
    (l: BlueprintLock) => Object.assign(entry(l), { held: [{ address: 'property:deals/renewal_date' }] }),
    'missing required field "unit"',
  ],
])('the schema refuses %s', (_, change, expected) => {
  const lock = example()
  change(lock)
  expect(messages(lock).join('\n')).toContain(expected)
})

test('an original somewhere else is refused, so an edited lock cannot point an upgrade at another file', () => {
  const lock = example()
  entry(lock).original = 'kalup.config.ts'
  expect(messages(lock)).toMatchInlineSnapshot(`
    [
      "blueprints.acme/renewals.original: the original of acme/renewals 1.1.0 is hubspot/.blueprints/acme--renewals@1.1.0.json",
    ]
  `)
})

test('an original under another folder, as after moving kalup/ to hubspot/, says what to replace in the lock', () => {
  const lock = example()
  entry(lock).original = 'kalup/.blueprints/acme--renewals@1.1.0.json'
  expect(prose(validateLock(lock, at))).toMatchInlineSnapshot(`
    [
      "the original of acme/renewals 1.1.0 is hubspot/.blueprints/acme--renewals@1.1.0.json (fix: the folder of object files moved: in hubspot/blueprints.lock.json, replace kalup/.blueprints/ with hubspot/.blueprints/)",
    ]
  `)
  const legacy = layout('kalup', true)
  expect(originalPath(legacy, 'acme/renewals', '1.1.0')).toBe(entry(lock).original)
  expect(validateLock(lock, legacy)).toEqual([])
})

test('the source and version must be in sources with the same hash', () => {
  const lock = example()
  lock.sources['https://blueprints.example.com/renewals-1.1.0.json@1.1.0'] = `sha256:${'0'.repeat(64)}`
  expect(messages(lock)).toMatchInlineSnapshot(`
    [
      "blueprints.acme/renewals.hash: sources does not record https://blueprints.example.com/renewals-1.1.0.json@1.1.0 with the hash of acme/renewals",
    ]
  `)
})

test('one local address belongs to one blueprint, and a held unit is on an address the blueprint lists', () => {
  const lock = example()
  const other = structuredClone(entry(lock))
  other.source = 'blueprints/other.json'
  other.original = originalPath(at, 'acme/other', other.version)
  other.held = [{ address: 'property:deals/other', unit: 'label' }]
  lock.blueprints['acme/other'] = other
  lock.sources[`blueprints/other.json@${other.version}`] = other.hash
  expect(validateLock(lock, at).map((i) => i.configPath)).toEqual([
    'blueprints.acme/other.resources',
    'blueprints.acme/other.resources',
    'blueprints.acme/other.held[0]',
  ])
  expect(messages(lock)).toMatchInlineSnapshot(`
    [
      "blueprints.acme/other.resources: group:deals/renewal is listed by two blueprints: acme/renewals and acme/other",
      "blueprints.acme/other.resources: property:deals/renewal_date is listed by two blueprints: acme/renewals and acme/other",
      "blueprints.acme/other.held[0]: property:deals/other is held but not listed under resources",
    ]
  `)
})

test('parseLock throws an IssueError for text that is not JSON or not a lock', () => {
  expect(() => parseLock('{ nope', at)).toThrow(IssueError)
  try {
    parseLock('{ nope', at)
  } catch (error) {
    expect((error as IssueError).issues).toEqual([
      expect.objectContaining({ code: 'E_BLUEPRINT_LOCK', message: expect.any(String), file: LOCK_FILE }),
    ])
    expect(prose((error as IssueError).issues)).toMatchInlineSnapshot(`
      [
        "the lock is not JSON (fix: restore hubspot/blueprints.lock.json from git: kalup add and kalup blueprint upgrade write it, never a person)",
      ]
    `)
  }
  expect(() => parseLock('{}', at)).toThrow('missing required field')
})

test('a sources key such as __proto__ is an own key, never the prototype', () => {
  const text = fixtureText('blueprints-lock-example.json').replace(
    '"sources": {',
    '"sources": {\n    "__proto__": "x",',
  )
  expect(messages(JSON.parse(text))).toEqual(['sources.__proto__: does not match ^sha256:[0-9a-f]{64}$'])
})
