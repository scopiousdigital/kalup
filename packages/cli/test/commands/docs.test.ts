import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, test, vi } from 'vitest'
import { fakeFetch, fixture } from '../../../engine/test/support/testing.js'
import type { DocsData } from '../../src/commands/docs.js'
import { cli, copy, empty, parseEnvelope, project } from '../../src/commands/testing.js'
import { edit } from './orchard.js'

const snapshotFile = fileURLToPath(new URL('../../../engine/test/fixtures/snapshot/orchard.json', import.meta.url))

function golden(name: string): string {
  return readFileSync(new URL(`../../../engine/test/fixtures/dictionary/${name}`, import.meta.url), 'utf8')
}

// docs never reads a portal: every test runs with a fetch that records any request.
function offline(): { calls: unknown[] } {
  const fake = fakeFetch()
  vi.stubGlobal('fetch', fake.fetch)
  return fake
}

afterEach(() => {
  vi.unstubAllGlobals()
})

test('docs prints the data dictionary of the config, and --json carries the same Markdown', async () => {
  const { calls } = offline()
  const human = await cli(project('pull'), 'docs')
  expect(human.exitCode).toBe(0)
  expect(human.stderr).toBe('')
  expect(human.stdout).toBe(golden('pull.config.md'))
  expect((await cli(project('pull'), 'docs', 'config')).stdout).toBe(human.stdout)
  const json = await cli(project('pull'), 'docs', '--json')
  expect(json.exitCode).toBe(0)
  expect(parseEnvelope<DocsData>(json.stdout)).toEqual({
    format: 'envelope/1',
    ok: true,
    data: { markdown: human.stdout },
    issues: [],
  })
  expect(calls).toEqual([])
})

test('docs <snapshot> needs no project: the dictionary of the read, with its coverage', async () => {
  const { calls } = offline()
  const out = await cli(empty(), 'docs', snapshotFile)
  expect(out.exitCode).toBe(0)
  expect(out.stderr).toBe('')
  expect(out.stdout).toBe(golden('orchard.snapshot.md'))
  expect(calls).toEqual([])
})

test('--out writes the Markdown relative to the directory the command runs in, replacing an older file', async () => {
  offline()
  const dir = copy('pull')
  const cwd = join(dir, 'kalup')
  writeFileSync(join(cwd, 'DICTIONARY.md'), 'an older dictionary\n')
  const json = await cli(cwd, 'docs', '--out', 'DICTIONARY.md', '--json')
  expect(json.exitCode).toBe(0)
  expect(parseEnvelope<DocsData>(json.stdout).data).toEqual({ file: 'DICTIONARY.md' })
  expect(readFileSync(join(cwd, 'DICTIONARY.md'), 'utf8')).toBe(golden('pull.config.md'))
  const human = await cli(cwd, 'docs', snapshotFile, '--out', 'docs/orchard.md')
  expect(human.exitCode).toBe(0)
  expect(human.stdout).toBe('Wrote docs/orchard.md\n')
  expect(readFileSync(join(cwd, 'docs', 'orchard.md'), 'utf8')).toBe(golden('orchard.snapshot.md'))
})

test('an incomplete snapshot is documented with W_INCOMPLETE, exit 0', async () => {
  offline()
  const dir = empty()
  const snapshot = fixture('snapshot/orchard.json') as {
    observation: { coverage: { complete: boolean; objects: Record<string, unknown> } }
  }
  snapshot.observation.coverage.complete = false
  snapshot.observation.coverage.objects.harvest = {
    status: 'unreadable',
    missingScope: 'crm.schemas.custom.read',
    issue: 'E_SCOPE',
  }
  writeFileSync(join(dir, 'partial.json'), JSON.stringify(snapshot))
  const out = await cli(dir, 'docs', 'partial.json', '--json')
  expect(out.exitCode).toBe(0)
  const env = parseEnvelope<DocsData>(out.stdout)
  expect(env.ok).toBe(true)
  expect(env.issues).toEqual([
    {
      code: 'W_INCOMPLETE',
      message: expect.stringContaining('harvest was not read'),
      fix: expect.stringContaining('crm.schemas.custom.read'),
      docs: 'errors/W_INCOMPLETE.md',
    },
  ])
  expect((env.data as { markdown: string }).markdown).toContain('harvest (missing scope crm\\.schemas\\.custom\\.read)')
})

test('errors: an invalid config is exit 3, a missing file is E_SNAPSHOT exit 1, a file that is no snapshot exit 3', async () => {
  offline()
  const dir = copy('pull')
  edit(dir, 'kalup.config.ts', 'portalId: 1111111', 'portalId: 0')
  const invalid = await cli(dir, 'docs', '--json')
  expect(invalid.exitCode).toBe(3)
  expect(parseEnvelope(invalid.stdout).issues[0]?.code).toBe('E_PORTAL_ID')
  const outside = await cli(empty(), 'docs', '--json')
  expect(outside.exitCode).toBe(1)
  expect(parseEnvelope(outside.stdout).issues[0]?.code).toBe('E_NO_CONFIG')
  const missing = await cli(dir, 'docs', 'nope.json', '--json')
  expect(missing.exitCode).toBe(1)
  expect(parseEnvelope(missing.stdout).issues).toEqual([
    {
      code: 'E_SNAPSHOT',
      message: "'nope.json' is not a file",
      file: 'nope.json',
      fix: expect.any(String),
      docs: 'errors/E_SNAPSHOT.md',
    },
  ])
  const config = await cli(dir, 'docs', 'kalup.config.ts', '--json')
  expect(config.exitCode).toBe(1)
  expect(parseEnvelope(config.stdout).issues[0]).toMatchObject({ code: 'E_SNAPSHOT', file: 'kalup.config.ts' })
  writeFileSync(join(dir, 'ir.json'), (await cli(project('pull'), 'ir')).stdout)
  const notSnapshot = await cli(dir, 'docs', 'ir.json', '--json')
  expect(notSnapshot.exitCode).toBe(3)
  expect(parseEnvelope(notSnapshot.stdout).issues[0]).toMatchObject({ code: 'E_SNAPSHOT', file: 'ir.json' })
})
