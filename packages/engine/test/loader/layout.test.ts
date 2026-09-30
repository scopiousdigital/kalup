import { expect, test } from 'vitest'
import { barrelPath, inDir, layout, normalDir, objectPath } from '../../src/loader/layout.js'

test('the layout of a folder names its barrel, removed.ts and lock', () => {
  expect(layout('lib/config/hubspot')).toEqual({
    dir: 'lib/config/hubspot',
    barrel: 'lib/config/hubspot/index.ts',
    removed: 'lib/config/hubspot/removed.ts',
    lock: 'lib/config/hubspot/blueprints.lock.json',
  })
  expect(layout('kalup', true).legacy).toBe(true)
})

test.each([
  ['hubspot', 'hubspot'],
  ['./lib/config/', 'lib/config'],
  ['lib\\config', 'lib/config'],
  ['lib//./config', 'lib/config'],
])('normalDir(%j) is %j', (given, expected) => {
  expect(normalDir(given)).toBe(expected)
})

test.each([
  '',
  '.',
  './',
  '/srv/hubspot',
  '\\hubspot',
  'C:\\config',
  'c:/config',
  '../shared',
  'lib/../../shared',
  'lib/..',
])('normalDir(%j) refuses a folder that is not inside the project', (given) => {
  expect(normalDir(given)).toBeUndefined()
})

test('paths in a layout: the files under it, a new object file, the barrel entry', () => {
  const at = layout('lib/config')
  expect(inDir(at, 'lib/config/objects/deals.ts')).toBe(true)
  expect(inDir(at, 'lib/configs/deals.ts')).toBe(false)
  expect(inDir(at, 'lib/config/blueprints.lock.json')).toBe(false)
  expect(objectPath(at, 'line_items')).toBe('lib/config/objects/line_items.ts')
  expect(barrelPath(at, 'lib/config/objects/line_items.ts')).toBe('./objects/line_items')
})
