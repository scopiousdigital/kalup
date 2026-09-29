import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KalupError } from '@kalup/engine'
import { expect, test } from 'vitest'
import { parseDotenv, resolveReadKey, resolveWriteKey } from '../../src/lib/auth.js'

const key = 'kalup-test-secret-9f2c'
const WRITE_CLIENT = /\b(createWriteHttp|resolveWriteKey)\b/

function project(dotenv?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'kalup-auth-'))
  if (dotenv !== undefined) {
    writeFileSync(join(dir, '.env'), dotenv)
  }
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

const readOnly = { credentials: { read: { env: 'HUBSPOT_PROD_READ_KEY' } } }
const separate = { credentials: { read: { env: 'HUBSPOT_PROD_READ_KEY' }, write: { env: 'HUBSPOT_PROD_WRITE_KEY' } } }

function failure(run: () => unknown): KalupError {
  try {
    run()
  } catch (error) {
    if (error instanceof KalupError) {
      return error
    }
    throw error
  }
  throw new Error('expected a KalupError')
}

test('the write key comes from credentials.write, else the read credential, else HUBSPOT_SERVICE_KEY', () => {
  const env = { HUBSPOT_PROD_WRITE_KEY: 'write-key', HUBSPOT_PROD_READ_KEY: 'read-key', HUBSPOT_SERVICE_KEY: 'service' }
  expect(resolveWriteKey(separate, project(), env)).toEqual({
    key: 'write-key',
    variable: 'HUBSPOT_PROD_WRITE_KEY',
    separate: true,
  })
  expect(resolveWriteKey(readOnly, project(), env)).toEqual({
    key: 'read-key',
    variable: 'HUBSPOT_PROD_READ_KEY',
    separate: false,
  })
  expect(resolveWriteKey({}, project(), env)).toEqual({
    key: 'service',
    variable: 'HUBSPOT_SERVICE_KEY',
    separate: false,
  })
})

test('by default the write key comes from the environment, then from .env', () => {
  const dir = project('HUBSPOT_PROD_WRITE_KEY=from-dotenv\n')
  expect(resolveWriteKey(separate, dir, { HUBSPOT_PROD_WRITE_KEY: 'from-env' }).key).toBe('from-env')
  expect(resolveWriteKey(separate, dir, {}).key).toBe('from-dotenv')
})

test('a missing write key is E_MISSING_KEY naming the variable, never a value', () => {
  const error = failure(() => resolveWriteKey(separate, project(`OTHER_KEY=${key}\n`), { OTHER_KEY: key }))
  expect(error.exitCode).toBe(1)
  expect(error.issues).toEqual([
    {
      code: 'E_MISSING_KEY',
      message: 'HUBSPOT_PROD_WRITE_KEY is not set.',
      fix: expect.stringContaining('Set HUBSPOT_PROD_WRITE_KEY'),
    },
  ])
})

test('envOnly reads a separate write key from the process environment alone', () => {
  const dir = project(`HUBSPOT_PROD_READ_KEY=${key}\n`)
  expect(resolveWriteKey(separate, dir, { HUBSPOT_PROD_WRITE_KEY: 'from-env' }, { envOnly: true })).toEqual({
    key: 'from-env',
    variable: 'HUBSPOT_PROD_WRITE_KEY',
    separate: true,
  })
  const missing = failure(() => resolveWriteKey(separate, project(), {}, { envOnly: true }))
  expect(missing.issues[0]).toMatchObject({ code: 'E_MISSING_KEY', message: 'HUBSPOT_PROD_WRITE_KEY is not set.' })
  expect(missing.issues[0]?.fix).toContain('.env is not read here')
})

test('envOnly without a separate write credential is E_APPROVE_CREDENTIAL, exit 4, whatever the environment holds', () => {
  const sameVariable = {
    credentials: { read: { env: 'HUBSPOT_PROD_READ_KEY' }, write: { env: 'HUBSPOT_PROD_READ_KEY' } },
  }
  expect(resolveWriteKey(sameVariable, project(), { HUBSPOT_PROD_READ_KEY: 'read-key' })).toEqual({
    key: 'read-key',
    variable: 'HUBSPOT_PROD_READ_KEY',
    separate: false,
  })
  for (const target of [{}, readOnly, sameVariable]) {
    const error = failure(() =>
      resolveWriteKey(target, project(), { HUBSPOT_SERVICE_KEY: key, HUBSPOT_PROD_READ_KEY: key }, { envOnly: true }),
    )
    expect(error.exitCode).toBe(4)
    expect(error.issues[0]).toMatchObject({ code: 'E_APPROVE_CREDENTIAL', humanRequired: true })
    expect(error.issues[0]?.message).toContain('names no credentials.write')
    expect(JSON.stringify(error.issues)).not.toContain(key)
  }
})

test.each([
  [`HUBSPOT_PROD_WRITE_KEY=${key}\n`],
  ['HUBSPOT_PROD_WRITE_KEY=\n'],
  ['export HUBSPOT_PROD_WRITE_KEY="unused"\n'],
])(
  'envOnly refuses when .env defines the write variable at all (%j), even with the key in the environment',
  (dotenv) => {
    const error = failure(() =>
      resolveWriteKey(separate, project(dotenv), { HUBSPOT_PROD_WRITE_KEY: key }, { envOnly: true }),
    )
    expect(error.exitCode).toBe(4)
    expect(error.issues).toEqual([
      {
        code: 'E_APPROVE_CREDENTIAL',
        message: expect.stringContaining('.env in the project directory defines HUBSPOT_PROD_WRITE_KEY'),
        fix: expect.stringContaining('Remove HUBSPOT_PROD_WRITE_KEY from .env'),
        humanRequired: true,
      },
    ])
    expect(JSON.stringify(error.issues)).not.toContain(key)
  },
)

test('no fix of the write key suggests --approve', () => {
  const errors = [
    failure(() => resolveWriteKey({}, project(), {}, { envOnly: true })),
    failure(() => resolveWriteKey(separate, project('HUBSPOT_PROD_WRITE_KEY=x\n'), {}, { envOnly: true })),
    failure(() => resolveWriteKey(separate, project(), {}, { envOnly: true })),
    failure(() => resolveWriteKey(separate, project(), {})),
  ]
  for (const error of errors) {
    expect(error.issues[0]?.fix).not.toContain('--approve')
  }
})

test.each([
  ['a line feed', 'pat-na1-1111\n2222'],
  ['a carriage return', 'pat-na1-1111\r2222'],
  ['a NUL', 'pat-na1-1111\u00002222'],
  ['a character outside Latin-1', 'pat-na1-1111\u20ac2222'],
])('a key with %s is E_KEY_INVALID naming the variable, never the value, for read and write keys', (_, value) => {
  const target = { credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } } }
  const env = { HUBSPOT_SANDBOX_KEY: value }
  for (const resolve of [() => resolveReadKey(target, project(), env), () => resolveWriteKey(target, project(), env)]) {
    let error: unknown
    try {
      resolve()
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(KalupError)
    const { exitCode, issues } = error as KalupError
    expect(exitCode).toBe(1)
    expect(issues[0]).toMatchObject({
      code: 'E_KEY_INVALID',
      message: expect.stringContaining('HUBSPOT_SANDBOX_KEY holds a line break'),
    })
    expect(JSON.stringify(issues)).not.toContain('1111')
  }
})

test('a key from .env with a character a header cannot carry is refused too', () => {
  const dir = project('HUBSPOT_SANDBOX_KEY="pat-na1-1111\u00002222"\n')
  expect(() => resolveReadKey({ credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } } }, dir, {})).toThrow(
    'HUBSPOT_SANDBOX_KEY holds a line break',
  )
})

test('a key with tabs, spaces and printable characters only is sent as it is', () => {
  const env = { HUBSPOT_SERVICE_KEY: 'pat-na1-1111 2222\t3333' }
  expect(resolveReadKey({}, project(), env).key).toBe('pat-na1-1111 2222\t3333')
})

test('E_MISSING_KEY never quotes a variable name that looks like a key pasted in its place', () => {
  // Joined at run time so secret scanners do not read the invented key as a real one.
  const pasted = ['pat', 'na1', '11111111-2222-3333-4444-555555555555'].join('-')
  const target = { credentials: { read: { env: pasted }, write: { env: pasted } } }
  for (const resolve of [() => resolveReadKey(target, project(), {}), () => resolveWriteKey(target, project(), {})]) {
    let error: unknown
    try {
      resolve()
    } catch (e) {
      error = e
    }
    const { issues } = error as KalupError
    expect(issues[0]).toMatchObject({ code: 'E_MISSING_KEY', message: 'the variable credentials names is not set.' })
    expect(JSON.stringify(issues)).not.toContain(pasted)
  }
})

// The engine checks its own sources: only its executor references createWriteHttp.
test('only the writing commands create a write client or resolve a write key', () => {
  const src = fileURLToPath(new URL('../../src/', import.meta.url))
  const writers = new Set(['lib/auth.ts', 'commands/apply.ts', 'commands/state.ts', 'commands/target-rebind.ts'])
  const offenders = readdirSync(src, { recursive: true, encoding: 'utf8' })
    .map((file) => file.split('\\').join('/'))
    .filter((file) => file.endsWith('.ts') && !writers.has(file))
    .filter((file) => WRITE_CLIENT.test(readFileSync(join(src, file), 'utf8')))
  expect(offenders).toEqual([])
})
