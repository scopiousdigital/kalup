import { type IR, stableStringify } from '@kalup/core'
import { expect, test } from 'vitest'
import { cli, empty, parseEnvelope, project } from '../../src/commands/testing.js'
import { load } from '../../src/lib/index.js'
import { version } from '../../src/usage.js'

test('prints the IR as deterministic JSON and exits 0', async () => {
  const out = await cli(project('valid'), 'ir')
  expect(out.exitCode).toBe(0)
  expect(out.stderr).toBe('')
  expect(out.stdout).toBe(`${stableStringify(load(project('valid')).ir)}\n`)
  const ir = JSON.parse(out.stdout) as IR
  expect(ir.irVersion).toBe(1)
  expect(ir.project).toBe('orchard-crm')
  expect(ir.generator).toEqual({ name: 'kalup', version, frontend: 'ts' })
  expect(Object.keys(ir.resources)).toEqual([
    'group:companies/orchard',
    'group:harvest/harvest_details',
    'object:harvest',
    'property:companies/name',
    'property:companies/plot_count',
    'property:companies/yield_tier',
    'property:harvest/batch_code',
    'property:harvest/picked_on',
  ])
  expect(Object.keys(ir)).toEqual([...Object.keys(ir)].sort())
  expect(out.stdout).not.toContain('credentials')
  expect(out.stdout).not.toContain('HUBSPOT_SANDBOX_KEY')
})

test('--json wraps the IR as data', async () => {
  const out = await cli(project('valid'), 'ir', '--json')
  expect(out.exitCode).toBe(0)
  const env = parseEnvelope<IR>(out.stdout)
  expect(env.ok).toBe(true)
  expect(env.issues).toEqual([])
  expect(env.data).toEqual(load(project('valid')).ir)
})

test('an invalid project exits 3 and prints no IR', async () => {
  const human = await cli(project('invalid'), 'ir')
  expect(human.exitCode).toBe(3)
  expect(human.stdout).toBe('')
  expect(human.stderr).toContain('E_UNKNOWN_GROUP')
  const json = await cli(project('invalid'), 'ir', '--json')
  expect(json.exitCode).toBe(3)
  const env = parseEnvelope(json.stdout)
  expect(env.ok).toBe(false)
  expect('data' in env).toBe(false)
  expect(env.issues.map((issue) => issue.code)).toEqual(['E_UNKNOWN_GROUP', 'W_PREFIX'])
})

test('--check validates only and prints nothing but issues', async () => {
  const human = await cli(project('warned'), 'ir', '--check')
  expect(human.exitCode).toBe(0)
  expect(human.stdout).toBe('')
  expect(human.stderr).toContain('W_PREFIX')
  const json = await cli(project('valid'), 'ir', '--check', '--json')
  expect(json.exitCode).toBe(0)
  expect(parseEnvelope(json.stdout)).toEqual({ format: 'envelope/1', ok: true, issues: [] })
})

test('--check on an invalid project exits 3', async () => {
  const out = await cli(project('invalid'), 'ir', '--check')
  expect(out.exitCode).toBe(3)
  expect(out.stdout).toBe('')
})

test('no kalup.config.ts exits 1', async () => {
  const out = await cli(empty(), 'ir')
  expect(out.exitCode).toBe(1)
  expect(out.stderr).toContain('E_NO_CONFIG')
})
