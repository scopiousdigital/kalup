import { expect, test } from 'vitest'
import { LOCK_FILE, originalPath, parseLock, validateLock } from '../../src/blueprint/lock.js'
import type { BlueprintLock } from '../../src/blueprint/types.js'
import { IssueError } from '../../src/grammar/types.js'
import { fixture, fixtureText } from '../../src/ir/fixture.js'

const example = (): BlueprintLock => fixture<BlueprintLock>('blueprints-lock-example.json')
const entry = (lock: BlueprintLock) =>
  lock.blueprints['acme/renewals'] as NonNullable<BlueprintLock['blueprints'][string]>
const messages = (document: unknown) => validateLock(document).map((i) => `${i.configPath}: ${i.message}`)

test('the example is a lock, and parseLock returns it', () => {
  expect(validateLock(example())).toEqual([])
  expect(parseLock(fixtureText('blueprints-lock-example.json'))).toEqual(example())
})

test('the original of a version is under kalup/.blueprints, the slash as two dashes', () => {
  expect(originalPath('acme/renewals', '1.1.0')).toBe('kalup/.blueprints/acme--renewals@1.1.0.json')
  expect(originalPath('renewals', '2.0.0-rc.1')).toBe('kalup/.blueprints/renewals@2.0.0-rc.1.json')
})

test('issues are E_BLUEPRINT_LOCK on the lock file with the fix to restore it from git', () => {
  const lock = example()
  Object.assign(lock, { lockVersion: 2 })
  expect(validateLock(lock)).toEqual([
    {
      code: 'E_BLUEPRINT_LOCK',
      message: 'expected 1',
      file: LOCK_FILE,
      configPath: 'lockVersion',
      fix: `restore ${LOCK_FILE} from git: kalup add and kalup blueprint upgrade write it, never a person`,
    },
  ])
})

test('another lock version, written by another version of kalup, is refused by its version alone', () => {
  // A newer lock may be shaped in any way: only lockVersion is read.
  const text = JSON.stringify({ ...example(), lockVersion: 2, blueprints: [] })
  expect(() => parseLock(text)).toThrow(IssueError)
  try {
    parseLock(text)
  } catch (error) {
    expect((error as IssueError).issues).toEqual([
      {
        code: 'E_BLUEPRINT_LOCK',
        message: 'the lock is blueprints-lock/2, and this version of kalup reads blueprints-lock/1',
        file: LOCK_FILE,
        configPath: 'lockVersion',
        fix: 'use the version of kalup that wrote it, or a newer one',
      },
    ])
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
  expect(messages(lock)).toEqual([
    'blueprints.acme/renewals.original: the original of acme/renewals 1.1.0 is kalup/.blueprints/acme--renewals@1.1.0.json',
  ])
})

test('the source and version must be in sources with the same hash', () => {
  const lock = example()
  lock.sources['https://blueprints.example.com/renewals-1.1.0.json@1.1.0'] = `sha256:${'0'.repeat(64)}`
  expect(messages(lock)).toEqual([
    'blueprints.acme/renewals.hash: sources does not record https://blueprints.example.com/renewals-1.1.0.json@1.1.0 with the hash of acme/renewals',
  ])
})

test('one local address belongs to one blueprint, and a held unit is on an address the blueprint lists', () => {
  const lock = example()
  const other = structuredClone(entry(lock))
  other.source = 'blueprints/other.json'
  other.original = originalPath('acme/other', other.version)
  other.held = [{ address: 'property:deals/other', unit: 'label' }]
  lock.blueprints['acme/other'] = other
  lock.sources[`blueprints/other.json@${other.version}`] = other.hash
  expect(messages(lock)).toEqual([
    'blueprints.acme/other.resources: group:deals/renewal is listed by two blueprints: acme/renewals and acme/other',
    'blueprints.acme/other.resources: property:deals/renewal_date is listed by two blueprints: acme/renewals and acme/other',
    'blueprints.acme/other.held[0]: property:deals/other is held but not listed under resources',
  ])
})

test('parseLock throws an IssueError for text that is not JSON or not a lock', () => {
  expect(() => parseLock('{ nope')).toThrow(IssueError)
  try {
    parseLock('{ nope')
  } catch (error) {
    expect((error as IssueError).issues).toEqual([
      expect.objectContaining({ code: 'E_BLUEPRINT_LOCK', message: 'the lock is not JSON', file: LOCK_FILE }),
    ])
  }
  expect(() => parseLock('{}')).toThrow('missing required field')
})

test('a sources key such as __proto__ is an own key, never the prototype', () => {
  const text = fixtureText('blueprints-lock-example.json').replace(
    '"sources": {',
    '"sources": {\n    "__proto__": "x",',
  )
  expect(messages(JSON.parse(text))).toEqual(['sources.__proto__: does not match ^sha256:[0-9a-f]{64}$'])
})
