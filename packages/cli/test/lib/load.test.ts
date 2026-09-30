import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KalupError, layout } from '@kalup/engine'
import { expect, test } from 'vitest'
import { findRoot, load, projectLayout, readProjectFiles } from '../../src/lib/load.js'
import { version } from '../../src/version.js'

const valid = fileURLToPath(new URL('../../../engine/test/fixtures/projects/valid', import.meta.url))

test('findRoot walks up from cwd to the nearest directory holding kalup.config.ts', () => {
  expect(findRoot(valid)).toBe(valid)
  expect(findRoot(join(valid, 'hubspot', 'objects'))).toBe(valid)
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

test('readProjectFiles maps kalup.config.ts and every .ts under hubspot/ by forward-slash path', () => {
  const files = readProjectFiles(valid)
  expect(Object.keys(files).sort()).toEqual([
    'hubspot/index.ts',
    'hubspot/objects/companies.ts',
    'hubspot/objects/harvest.ts',
    'kalup.config.ts',
  ])
  expect(files['kalup.config.ts']).toContain("name: 'orchard-crm'")
})

test('readProjectFiles without a hubspot/ directory gives the config alone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kalup-load-'))
  writeFileSync(
    join(dir, 'kalup.config.ts'),
    "import { defineConfig } from '@kalup/core'\n\nexport default defineConfig({})\n",
  )
  expect(Object.keys(readProjectFiles(dir))).toEqual(['kalup.config.ts'])
})

test('load returns the loader result with the CLI version as the generator version', () => {
  const { ir, sources, config } = load(valid)
  expect(ir.generator).toEqual({ name: 'kalup', version, frontend: 'ts' })
  expect(ir.project).toBe('orchard-crm')
  expect(Object.keys(ir.targets)).toEqual(['sandbox'])
  expect(sources['property:companies/plot_count']).toEqual({
    file: 'hubspot/objects/companies.ts',
    line: 10,
    configPath: 'Company.properties.plotCount',
  })
  expect(config.targets).toHaveProperty('sandbox.credentials', { read: { env: 'HUBSPOT_SANDBOX_KEY' } })
})

/** A copy of the valid fixture with its folder of object files at `folder` and, when given, `dir` in the config. */
function moved(folder: string, dir?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'kalup-load-'))
  cpSync(valid, root, { recursive: true })
  if (folder !== 'hubspot') {
    mkdirSync(dirname(join(root, folder)), { recursive: true })
    renameSync(join(root, 'hubspot'), join(root, folder))
  }
  if (dir !== undefined) {
    const config = readFileSync(join(root, 'kalup.config.ts'), 'utf8')
    writeFileSync(
      join(root, 'kalup.config.ts'),
      config.replace('defineConfig({\n', `defineConfig({\n  dir: '${dir}',\n`),
    )
  }
  return root
}

test('projectLayout: dir in the config, else hubspot/, else a 0.1 kalup/ folder when hubspot/ holds no .ts file', () => {
  expect(projectLayout(valid)).toEqual(layout('hubspot'))
  expect(projectLayout(moved('lib/config', './lib/config/'))).toEqual(layout('lib/config'))
  expect(projectLayout(moved('kalup'))).toEqual(layout('kalup', true))
  // An empty hubspot/, one with other files, or a file named hubspot leaves a 0.1 project on kalup/.
  const both = moved('kalup')
  mkdirSync(join(both, 'hubspot'))
  expect(projectLayout(both)).toEqual(layout('kalup', true))
  writeFileSync(join(both, 'hubspot', 'hsproject.json'), '{}\n')
  expect(projectLayout(both)).toEqual(layout('kalup', true))
  const named = moved('kalup')
  writeFileSync(join(named, 'hubspot'), 'not a folder\n')
  expect(projectLayout(named)).toEqual(layout('kalup', true))
  // Both holding .ts files: no guess, since the wrong one would plan the other's resources as gone.
  writeFileSync(join(both, 'hubspot', 'app.ts'), 'export const app = 1\n')
  let error: unknown
  try {
    projectLayout(both)
  } catch (e) {
    error = e
  }
  expect(error).toBeInstanceOf(KalupError)
  expect((error as KalupError).exitCode).toBe(3)
  expect((error as KalupError).issues).toEqual([
    {
      code: 'E_DIR_AMBIGUOUS',
      message:
        'both hubspot/ and kalup/ hold .ts files, and kalup.config.ts does not say which one holds the object files',
      file: 'kalup.config.ts',
      fix: "add dir: 'kalup' to kalup.config.ts to keep the old folder, or dir: 'hubspot' when the object files are there",
    },
  ])
  // dir settles it.
  const config = readFileSync(join(both, 'kalup.config.ts'), 'utf8')
  writeFileSync(join(both, 'kalup.config.ts'), config.replace('defineConfig({\n', "defineConfig({\n  dir: 'kalup',\n"))
  expect(projectLayout(both)).toEqual(layout('kalup'))
  // A file named kalup is no 0.1 folder.
  const file = mkdtempSync(join(tmpdir(), 'kalup-load-'))
  writeFileSync(join(file, 'kalup'), 'not a folder\n')
  expect(projectLayout(file)).toEqual(layout('hubspot'))
  expect(projectLayout(moved('hubspot', '../shared'))).toBeUndefined()
})

test('readProjectFiles reads the folder dir names, and nothing outside it', () => {
  const root = moved('lib/config', 'lib/config')
  mkdirSync(join(root, 'hubspot'))
  writeFileSync(join(root, 'hubspot', 'stray.ts'), 'not read\n')
  expect(Object.keys(readProjectFiles(root)).sort()).toEqual([
    'kalup.config.ts',
    'lib/config/index.ts',
    'lib/config/objects/companies.ts',
    'lib/config/objects/harvest.ts',
  ])
  expect(load(root).sources).toHaveProperty(
    ['property:companies/plot_count', 'file'],
    'lib/config/objects/companies.ts',
  )
})
