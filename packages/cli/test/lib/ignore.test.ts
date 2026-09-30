import { expect, test } from 'vitest'
import { ignores } from '../../src/lib/ignore.js'

test.each([
  ['.env', '.env'],
  ['/.env', '.env'],
  ['**/.env', 'apps/crm/.env'],
  ['.env', 'apps/crm/.env'],
  ['.env*', '.env'],
  ['*.env', 'apps/crm/.env'],
  ['.env  ', '.env'],
  ['.env\r', '.env'],
  ['!.env\n.env', '.env'],
  ['.env*\n!.env.example', '.env'],
  ['/apps/crm/.env', 'apps/crm/.env'],
  ['apps/crm/.env', 'apps/crm/.env'],
  ['apps/', 'apps/crm/.env'],
  ['apps/**', 'apps/crm/.env'],
  ['hubspot/**', 'hubspot/index.ts'],
  ['.env[.]', '.env.'],
])('%j ignores %s', (text, path) => {
  expect(ignores(text, path)).toBe(true)
})

test.each([
  ['/.env', 'apps/crm/.env'],
  ['.env.local', '.env'],
  ['.env/', '.env'],
  [' .env', '.env'],
  ['# .env', '.env'],
  ['.env\t', '.env'],
  ['.env*\n!.env', '.env'],
  ['*.env\n!/.env', '.env'],
  ['crm/.env', 'apps/crm/.env'],
  ['[', '['],
])('%j does not ignore %s', (text, path) => {
  expect(ignores(text, path)).toBe(false)
})

test('a line ending in / matches a folder only', () => {
  expect(ignores('.kalup/\n', '.kalup', true)).toBe(true)
  expect(ignores('.kalup/\n', '.kalup/state/portal-1111111.json')).toBe(true)
  expect(ignores('.kalup/\n', '.kalup')).toBe(false)
})
