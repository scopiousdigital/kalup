import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { parseDotenv, resolveReadKey } from '../../src/lib/auth.js'
import { KalupError } from '../../src/lib/output.js'

const key = 'kalup-test-secret-9f2c'

function project(dotenv?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'kalup-auth-'))
  if (dotenv !== undefined) writeFileSync(join(dir, '.env'), dotenv)
  return dir
}

test('the variable comes from credentials.read.env, else HUBSPOT_SERVICE_KEY', () => {
  const env = { HUBSPOT_SANDBOX_KEY: 'sandbox-key', HUBSPOT_SERVICE_KEY: 'service-key' }
  expect(resolveReadKey({ credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } } }, project(), env)).toEqual({
    key: 'sandbox-key',
    variable: 'HUBSPOT_SANDBOX_KEY',
  })
  expect(resolveReadKey({}, project(), env)).toEqual({ key: 'service-key', variable: 'HUBSPOT_SERVICE_KEY' })
})

test('the process environment wins over .env, and .env fills the gap', () => {
  const dir = project('HUBSPOT_SERVICE_KEY=from-dotenv\n')
  expect(resolveReadKey({}, dir, { HUBSPOT_SERVICE_KEY: 'from-env' }).key).toBe('from-env')
  expect(resolveReadKey({}, dir, {}).key).toBe('from-dotenv')
  expect(resolveReadKey({}, dir, { HUBSPOT_SERVICE_KEY: '' }).key).toBe('from-dotenv')
})

test('a missing key names the variable and never a value', () => {
  const dir = project(`OTHER_KEY=${key}\n`)
  let error: unknown
  try {
    resolveReadKey({ credentials: { read: { env: 'HUBSPOT_PROD_READ_KEY' } } }, dir, { OTHER_KEY: key })
  } catch (e) {
    error = e
  }
  expect(error).toBeInstanceOf(KalupError)
  const { exitCode, issues, message } = error as KalupError
  expect(exitCode).toBe(1)
  expect(issues[0]?.code).toBe('E_MISSING_KEY')
  expect(message).toContain('HUBSPOT_PROD_READ_KEY')
  expect(JSON.stringify(issues)).not.toContain(key)
})

test('a project without .env resolves from the environment only', () => {
  expect(() => resolveReadKey({}, project(), {})).toThrow('HUBSPOT_SERVICE_KEY is not set')
})

test('parseDotenv strips the quotes of a quoted value followed by an inline comment', () => {
  // Review finding: the quoted branch needs the line to end with the quote, so the comment makes it fall through
  // to the unquoted branch and the key is sent as `Bearer "kalup-test-secret-9f2c"`.
  expect(parseDotenv(`HUBSPOT_SERVICE_KEY="${key}" # production\nSINGLE='a b' # c\n`)).toEqual({
    HUBSPOT_SERVICE_KEY: key,
    SINGLE: 'a b',
  })
})

test('parseDotenv handles comments, blanks, export, quotes and CRLF', () => {
  const text = [
    '# comment',
    '',
    'PLAIN=one',
    'export EXPORTED=two',
    "SINGLE='three # not a comment'",
    'DOUBLE="four=with=equals"',
    'TRAILING=five # a comment',
    'SPACED =  six  ',
    'EMPTY=',
    'not a pair',
    'CRLF=seven\r',
  ].join('\n')
  expect(parseDotenv(text)).toEqual({
    PLAIN: 'one',
    EXPORTED: 'two',
    SINGLE: 'three # not a comment',
    DOUBLE: 'four=with=equals',
    TRAILING: 'five',
    SPACED: 'six',
    EMPTY: '',
    CRLF: 'seven',
  })
})
