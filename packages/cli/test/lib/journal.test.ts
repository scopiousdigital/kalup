import { closeSync, existsSync, fsyncSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { type JournalEntry, type JournalIo, type JournalRun, openJournal } from '../../src/lib/journal.js'

const key = 'kalup-test-write-secret-4b1d'
const run: JournalRun = {
  planId: 'pl_7f3a1c07b2e4',
  writesHash: `sha256:${'7f3a'.repeat(16)}`,
  portalId: 2_222_222,
  approval: 'terminal',
  keys: [key],
}
const opened = new Date('2026-09-24T10:11:12.345Z')
const entry: JournalEntry = {
  at: '2026-09-24T10:11:13.000Z',
  step: 's2',
  address: 'property:companies/plot_count',
  method: 'POST',
  path: '/crm/properties/2026-09/{objectType}',
  status: 201,
  category: undefined,
  correlationId: '9d0c3b1a-2f4e-4a6b-8c7d-1e2f3a4b5c6d',
  outcome: 'ok',
  ms: 184,
}

function stateDirectory(): string {
  return join(mkdtempSync(join(tmpdir(), 'kalup-journal-')), '.kalup', 'state')
}

function lines(path: string): unknown[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

test('the journal sits beside the state directory, one file per portal and run', () => {
  const state = stateDirectory()
  const journal = openJournal(state, run, opened)
  expect(journal.path).toBe(join(state, '..', 'journal', 'portal-2222222', 'pl_7f3a1c07b2e4-20260924T101112345Z.jsonl'))
  expect(existsSync(join(state, '..', 'journal', 'portal-2222222'))).toBe(true)
  expect(existsSync(journal.path)).toBe(false)
})

test('each append is one JSON line with the run, the entry and null for what is absent', () => {
  const journal = openJournal(stateDirectory(), run, opened)
  journal.append(entry)
  journal.append({
    ...entry,
    step: 's3',
    method: 'GET',
    path: '/crm/properties/2026-09/{objectType}/{name}',
    status: undefined,
    correlationId: undefined,
    outcome: 'uncertain',
    ms: 30_000,
  })
  // A rejected write keeps HubSpot's category and subCategory.
  journal.append({
    ...entry,
    step: 's4',
    method: 'DELETE',
    path: '/crm/properties/2026-09/{objectType}/{name}',
    status: 400,
    category: 'VALIDATION_ERROR',
    subCategory: 'PropertyValidationError.CANNOT_DELETE_PROPERTY_IN_USE',
    outcome: 'rejected',
    ms: 90,
  })
  expect(readFileSync(journal.path, 'utf8').split('\n')).toHaveLength(4)
  expect(lines(journal.path)).toEqual([
    {
      planId: 'pl_7f3a1c07b2e4',
      writesHash: run.writesHash,
      portalId: 2_222_222,
      approval: 'terminal',
      at: '2026-09-24T10:11:13.000Z',
      step: 's2',
      address: 'property:companies/plot_count',
      method: 'POST',
      path: '/crm/properties/2026-09/{objectType}',
      status: 201,
      category: null,
      subCategory: null,
      correlationId: '9d0c3b1a-2f4e-4a6b-8c7d-1e2f3a4b5c6d',
      outcome: 'ok',
      ms: 184,
    },
    {
      planId: 'pl_7f3a1c07b2e4',
      writesHash: run.writesHash,
      portalId: 2_222_222,
      approval: 'terminal',
      at: '2026-09-24T10:11:13.000Z',
      step: 's3',
      address: 'property:companies/plot_count',
      method: 'GET',
      path: '/crm/properties/2026-09/{objectType}/{name}',
      status: null,
      category: null,
      subCategory: null,
      correlationId: null,
      outcome: 'uncertain',
      ms: 30_000,
    },
    {
      planId: 'pl_7f3a1c07b2e4',
      writesHash: run.writesHash,
      portalId: 2_222_222,
      approval: 'terminal',
      at: '2026-09-24T10:11:13.000Z',
      step: 's4',
      address: 'property:companies/plot_count',
      method: 'DELETE',
      path: '/crm/properties/2026-09/{objectType}/{name}',
      status: 400,
      category: 'VALIDATION_ERROR',
      subCategory: 'PropertyValidationError.CANNOT_DELETE_PROPERTY_IN_USE',
      correlationId: '9d0c3b1a-2f4e-4a6b-8c7d-1e2f3a4b5c6d',
      outcome: 'rejected',
      ms: 90,
    },
  ])
})

test('append flushes the line to disk before it returns', () => {
  const calls: string[] = []
  const record =
    <T extends (...args: never[]) => unknown>(name: string, fn: T) =>
    (...args: Parameters<T>) => {
      calls.push(name)
      return fn(...args)
    }
  const io = {
    closeSync: record('close', closeSync),
    fsyncSync: record('fsync', fsyncSync),
    mkdirSync: record('mkdir', mkdirSync),
    openSync: record('open', openSync),
    writeSync: record('write', writeSync),
  } as unknown as JournalIo
  const journal = openJournal(stateDirectory(), run, opened, io)
  journal.append(entry)
  journal.append(entry)
  expect(calls).toEqual(['mkdir', 'open', 'write', 'fsync', 'close', 'open', 'write', 'fsync', 'close'])
})

test('a write(2) that takes part of a line is followed by more; one that takes nothing throws', () => {
  const chunked = (fd: number, buffer: Uint8Array, offset: number, length: number) =>
    writeSync(fd, buffer, offset, Math.min(length, 5))
  const io = { closeSync, fsyncSync, mkdirSync, openSync, writeSync: chunked } as unknown as JournalIo
  const journal = openJournal(stateDirectory(), run, opened, io)
  journal.append(entry)
  expect(lines(journal.path)).toEqual([expect.objectContaining({ step: 's2', ms: 184 })])
  const stuck = openJournal(stateDirectory(), run, opened, { ...io, writeSync: (() => 0) as JournalIo['writeSync'] })
  expect(() => stuck.append(entry)).toThrow('a write took no bytes')
})

test('a line with a string that holds a key is refused and nothing is written', () => {
  const journal = openJournal(stateDirectory(), run, opened)
  for (const bad of [
    { correlationId: key },
    { category: `INVALID ${key}` },
    { address: `property:companies/${key}` },
  ]) {
    expect(() => journal.append({ ...entry, ...bad })).toThrow('refusing to journal a line that holds a key')
  }
  expect(existsSync(journal.path)).toBe(false)
})

test('a path that is not a registry template, a URL for example, is refused', () => {
  const journal = openJournal(stateDirectory(), run, opened)
  expect(() => journal.append({ ...entry, path: '/crm/properties/2026-09/companies/plot_count' })).toThrow(
    'registry path template',
  )
  expect(() => journal.append({ ...entry, path: 'https://api.hubapi.com/crm/properties/2026-09/companies' })).toThrow(
    'registry path template',
  )
  expect(existsSync(journal.path)).toBe(false)
})

test('fields beyond the entry, such as a body, are never written', () => {
  const journal = openJournal(stateDirectory(), run, opened)
  const withBody = { ...entry, body: { name: 'plot_count', label: 'secret-body-text' }, email: 'dana@example.com' }
  journal.append(withBody as JournalEntry)
  const text = readFileSync(journal.path, 'utf8')
  expect(text).not.toContain('secret-body-text')
  expect(text).not.toContain('dana@example.com')
  expect(Object.keys(lines(journal.path)[0] as object)).not.toContain('body')
})
