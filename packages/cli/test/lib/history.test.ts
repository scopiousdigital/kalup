import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { historyKeep, openHistory } from '../../src/lib/history.js'

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'kalup-history-'))
  mkdirSync(join(root, 'kalup', 'objects'), { recursive: true })
  writeFileSync(join(root, 'kalup', 'objects', 'companies.ts'), 'export const Company = 1\n')
  writeFileSync(join(root, 'kalup.config.ts'), 'export default 1\n')
  return root
}

test('save copies the old file under .kalup/history/<ISO timestamp>/<relative path>', () => {
  const root = project()
  const history = openHistory(root, new Date('2026-09-22T10:00:00.000Z'))
  history.save('kalup/objects/companies.ts')
  history.save('kalup.config.ts')
  const dir = join(root, '.kalup', 'history', '2026-09-22T10:00:00.000Z')
  expect(history.dir).toBe(dir)
  expect(readFileSync(join(dir, 'kalup', 'objects', 'companies.ts'), 'utf8')).toBe('export const Company = 1\n')
  expect(readFileSync(join(dir, 'kalup.config.ts'), 'utf8')).toBe('export default 1\n')
})

test('a file that does not exist yet is skipped and creates no folder', () => {
  const root = project()
  openHistory(root).save('kalup/objects/subscription.ts')
  expect(existsSync(join(root, '.kalup'))).toBe(false)
})

test('only the last 20 timestamps are kept', () => {
  const root = project()
  const stamps: string[] = []
  for (let i = 0; i < historyKeep + 1; i++) {
    const at = new Date(Date.UTC(2026, 8, 1 + i))
    stamps.push(at.toISOString())
    openHistory(root, at).save('kalup.config.ts')
  }
  const kept = readdirSync(join(root, '.kalup', 'history')).sort()
  expect(kept).toHaveLength(historyKeep)
  expect(kept).toEqual(stamps.slice(1))
})
