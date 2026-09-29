import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { cli, copy, empty, parseEnvelope, project } from '../../src/commands/testing.js'
import type { ValidateData } from '../../src/commands/validate.js'
import { printed } from '../support/printed.js'
import { edit } from './orchard.js'

const prefixWarning = /^kalup\/objects\/companies\.ts:\d+: W_PREFIX: 'zone_code' /
const noConfigLine = /^E_NO_CONFIG: .*npx kalup init --portal <id>/

test('a valid project exits 0 with nothing on stderr', async () => {
  const out = await cli(project('valid'), 'validate')
  expect(out.exitCode).toBe(0)
  expect(out.stdout).toBe('Config valid (0 errors, 0 warnings)\n')
  expect(out.stderr).toBe('')
})

test('--json on a valid project is one envelope with data { valid, counts }', async () => {
  const out = await cli(project('valid'), 'validate', '--json')
  expect(out.exitCode).toBe(0)
  expect(out.stderr).toBe('')
  expect(parseEnvelope<ValidateData>(out.stdout)).toEqual({
    format: 'envelope/1',
    ok: true,
    data: { valid: true, counts: { errors: 0, warnings: 0 } },
    issues: [],
  })
})

test('warnings alone exit 0, and the envelope stays ok with the warning in issues', async () => {
  const human = await cli(project('warned'), 'validate')
  expect(human.exitCode).toBe(0)
  expect(human.stdout).toBe('Config valid (0 errors, 1 warning)\n')
  expect(human.stderr).toMatch(prefixWarning)
  const json = await cli(project('warned'), 'validate', '--json')
  expect(json.exitCode).toBe(0)
  const env = parseEnvelope<ValidateData>(json.stdout)
  expect(env.ok).toBe(true)
  expect(env.data).toEqual({ valid: true, counts: { errors: 0, warnings: 1 } })
  expect(env.issues.map((issue) => issue.code)).toEqual(['W_PREFIX'])
})

test('an invalid project exits 3 with one line per issue: file:line, code, message and fix', async () => {
  const out = await cli(project('invalid'), 'validate')
  expect(out.exitCode).toBe(3)
  expect(printed(out)).toMatchInlineSnapshot(`
    "Config invalid (1 error, 1 warning)
    --- stderr
    kalup/objects/companies.ts:14: E_UNKNOWN_GROUP: group 'yield' is not in the groups of companies (fix: add yield: { label: '...' } to the groups block) (docs: errors/E_UNKNOWN_GROUP.md)
    kalup/objects/companies.ts:20: W_PREFIX: 'zone_code' does not carry the project prefix 'orc_' (fix: rename it to orc_zone_code, or clear prefix in kalup.config.ts) (docs: errors/W_PREFIX.md)
    "
  `)
})

test('--json on an invalid project is ok: false with data { valid: false, counts }', async () => {
  const out = await cli(project('invalid'), 'validate', '--json')
  expect(out.exitCode).toBe(3)
  expect(out.stderr).toBe('')
  const env = parseEnvelope<ValidateData>(out.stdout)
  expect(env.ok).toBe(false)
  expect(env.data).toEqual({ valid: false, counts: { errors: 1, warnings: 1 } })
  expect(env.issues.map((issue) => issue.code)).toEqual(['E_UNKNOWN_GROUP', 'W_PREFIX'])
  expect(env.issues[0]).toMatchObject({
    file: 'kalup/objects/companies.ts',
    line: 14,
    configPath: 'Company.properties.orcYieldTier.group',
  })
})

test('--target naming an undeclared target exits 3 with E_UNKNOWN_TARGET', async () => {
  const out = await cli(project('valid'), 'validate', '--target', 'nowhere', '--json')
  expect(out.exitCode).toBe(3)
  const env = parseEnvelope<ValidateData>(out.stdout)
  expect(env.data).toEqual({ valid: false, counts: { errors: 1, warnings: 0 } })
  expect(env.issues[0]).toMatchObject({ code: 'E_UNKNOWN_TARGET', file: 'kalup.config.ts' })
  expect((await cli(project('valid'), 'validate', '--target', 'sandbox')).exitCode).toBe(0)
})

test('defineCustomObject on a standard object key exits 3 with E_STANDARD_OBJECT at the export', async () => {
  const dir = copy('pull')
  const file = 'kalup/objects/companies.ts'
  edit(dir, file, 'import { defineObject,', 'import { defineCustomObject,')
  edit(
    dir,
    file,
    "defineObject('companies', {",
    "defineCustomObject('companies', {\n  labels: { singular: 'Company', plural: 'Companies' },\n  primaryDisplayProperty: 'name',",
  )
  const out = await cli(dir, 'validate', '--json')
  expect(out.exitCode).toBe(3)
  const env = parseEnvelope<ValidateData>(out.stdout)
  expect(env.data).toEqual({ valid: false, counts: { errors: 1, warnings: 0 } })
  expect(env.issues).toEqual([
    {
      code: 'E_STANDARD_OBJECT',
      message: expect.stringContaining("'companies'"),
      file,
      line: 6,
      configPath: 'Company',
      fix: expect.stringContaining("defineObject('companies', ...)"),
      docs: 'errors/E_STANDARD_OBJECT.md',
    },
  ])
})

test('a file the reader rejects exits 3 with the reader issue and data { valid: false }', async () => {
  const dir = empty()
  writeFileSync(
    join(dir, 'kalup.config.ts'),
    "import { defineConfig } from '@kalup/core'\n\nexport default defineConfig({})\n",
  )
  mkdirSync(join(dir, 'kalup', 'objects'), { recursive: true })
  writeFileSync(
    join(dir, 'kalup', 'objects', 'plots.ts'),
    "import { defineObject, p } from '@kalup/core'\n\nexport const Plot = defineObject('plots', {\n  properties: { ...shared },\n})\n",
  )
  const out = await cli(dir, 'validate', '--json')
  expect(out.exitCode).toBe(3)
  const env = parseEnvelope<ValidateData>(out.stdout)
  expect(env.data?.valid).toBe(false)
  expect(env.issues.length).toBeGreaterThan(0)
  expect(env.issues[0]).toMatchObject({ file: 'kalup/objects/plots.ts', line: expect.any(Number) })
})

test('no kalup.config.ts anywhere above cwd exits 1 with E_NO_CONFIG and the init fix', async () => {
  const out = await cli(empty(), 'validate')
  expect(out.exitCode).toBe(1)
  expect(out.stdout).toBe('')
  expect(out.stderr).toMatch(noConfigLine)
})

test('runs from a subdirectory of the project', async () => {
  const out = await cli(join(project('valid'), 'kalup', 'objects'), 'validate', '--json')
  expect(out.exitCode).toBe(0)
  expect(parseEnvelope<ValidateData>(out.stdout).data?.valid).toBe(true)
})

test('a definition override that breaks a rule exits 3 at its line in kalup.config.ts, whichever target is asked for', async () => {
  const dir = copy('valid')
  edit(
    dir,
    'kalup.config.ts',
    "      credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },\n",
    "      credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },\n      overrides: {\n        'property:companies/plot_count': { definition: { label: 'Plots', hasUniqueValue: true } },\n      },\n",
  )
  const out = await cli(dir, 'validate', '--target', 'sandbox', '--json')
  expect(out.exitCode).toBe(3)
  expect(parseEnvelope(out.stdout).issues).toEqual([
    {
      code: 'E_OVERRIDE_DEFINITION',
      message: expect.stringContaining('property:companies/plot_count on target sandbox'),
      file: 'kalup.config.ts',
      line: 14,
      configPath: 'targets.sandbox.overrides.property:companies/plot_count.definition.hasUniqueValue',
      fix: 'remove hasUniqueValue from the override',
      docs: 'errors/E_OVERRIDE_DEFINITION.md',
    },
  ])
})
