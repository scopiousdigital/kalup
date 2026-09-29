import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { findRoot, load, readProjectFiles } from '../../src/lib/load.js'
import { KalupError } from '../../src/lib/output.js'
import { version } from '../../src/version.js'

const valid = fileURLToPath(new URL('../fixtures/projects/valid', import.meta.url))

test('findRoot walks up from cwd to the nearest directory holding kalup.config.ts', () => {
  expect(findRoot(valid)).toBe(valid)
  expect(findRoot(join(valid, 'kalup', 'objects'))).toBe(valid)
})

test('findRoot with no kalup.config.ts anywhere above is E_NO_CONFIG, exit 1, with the init fix', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kalup-load-'))
  let error: unknown
  try {
    findRoot(dir)
  } catch (e) {
    error = e
  }
  expect(error).toBeInstanceOf(KalupError)
  const { issues, exitCode } = error as KalupError
  expect(exitCode).toBe(1)
  expect(issues[0]).toMatchObject({ code: 'E_NO_CONFIG', fix: expect.stringContaining('kalup init --portal <id>') })
})

test('readProjectFiles maps kalup.config.ts and every .ts under kalup/ by forward-slash path', () => {
  const files = readProjectFiles(valid)
  expect(Object.keys(files).sort()).toEqual([
    'kalup.config.ts',
    'kalup/index.ts',
    'kalup/objects/companies.ts',
    'kalup/objects/harvest.ts',
  ])
  expect(files['kalup.config.ts']).toContain("name: 'orchard-crm'")
})

test('readProjectFiles without a kalup/ directory gives the config alone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kalup-load-'))
  writeFileSync(
    join(dir, 'kalup.config.ts'),
    "import { defineConfig } from 'kalup'\n\nexport default defineConfig({})\n",
  )
  expect(Object.keys(readProjectFiles(dir))).toEqual(['kalup.config.ts'])
})

test('load returns the loader result with the CLI version as the generator version', () => {
  const { ir, sources, config } = load(valid)
  expect(ir.generator).toEqual({ name: 'kalup', version, frontend: 'ts' })
  expect(ir.project).toBe('orchard-crm')
  expect(Object.keys(ir.targets)).toEqual(['sandbox'])
  expect(sources['property:companies/plot_count']).toEqual({
    file: 'kalup/objects/companies.ts',
    line: 10,
    configPath: 'Company.properties.plotCount',
  })
  expect(config.targets).toHaveProperty('sandbox.credentials', { read: { env: 'HUBSPOT_SANDBOX_KEY' } })
})
