import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { canonical, type FmtData } from '../../src/commands/fmt.js'
import { cli, copy, empty, parseEnvelope, project } from '../../src/commands/testing.js'
import { readProjectFiles } from '../../src/lib/load.js'

const files = ['kalup.config.ts', 'kalup/objects/companies.ts', 'kalup/objects/harvest.ts']

/** A copy of the valid project with every file indented twice as deep: same meaning, not canonical. */
function unformatted(): string {
  const dir = copy('valid')
  for (const file of files) {
    const path = join(dir, file)
    writeFileSync(
      path,
      readFileSync(path, 'utf8').replace(/^ +/gm, (indent) => indent + indent),
    )
  }
  return dir
}

function text(dir: string, file: string): string {
  return readFileSync(join(dir, file), 'utf8')
}

test('rewrites files to canonical form and copies the old ones into history first', async () => {
  const dir = unformatted()
  const before = Object.fromEntries(files.map((file) => [file, text(dir, file)]))
  const out = await cli(dir, 'fmt')
  expect(out.exitCode).toBe(0)
  expect(out.stderr).toBe('')
  expect(out.stdout).toBe(
    files
      .map((file) => `rewrote ${file}`)
      .join('\n')
      .concat('\n'),
  )
  for (const file of files) {
    expect(text(dir, file)).toBe(text(project('valid'), file))
  }
  const stamps = readdirSync(join(dir, '.kalup', 'history'))
  expect(stamps).toHaveLength(1)
  for (const file of files) {
    expect(text(join(dir, '.kalup', 'history', stamps[0] ?? ''), file)).toBe(before[file])
  }
})

test('a second run changes nothing', async () => {
  const dir = unformatted()
  await cli(dir, 'fmt')
  const out = await cli(dir, 'fmt', '--json')
  expect(out.exitCode).toBe(0)
  expect(parseEnvelope<FmtData>(out.stdout).data).toEqual({ changed: [] })
  expect(readdirSync(join(dir, '.kalup', 'history'))).toHaveLength(1)
})

test('a canonical project has nothing to rewrite and writes no history', async () => {
  const dir = copy('valid')
  const out = await cli(dir, 'fmt')
  expect(out.exitCode).toBe(0)
  expect(out.stdout).toBe('All files are canonical\n')
  expect(existsSync(join(dir, '.kalup'))).toBe(false)
})

test('--check lists the files that would change and writes nothing', async () => {
  const dir = unformatted()
  const before = Object.fromEntries(files.map((file) => [file, text(dir, file)]))
  const out = await cli(dir, 'fmt', '--check')
  expect(out.exitCode).toBe(0)
  expect(out.stdout).toBe(
    files
      .map((file) => `would rewrite ${file}`)
      .join('\n')
      .concat('\n'),
  )
  for (const file of files) {
    expect(text(dir, file)).toBe(before[file])
  }
  expect(existsSync(join(dir, '.kalup'))).toBe(false)
})

test('--check --exit-code exits 2 when files would change and 0 when none would', async () => {
  expect((await cli(unformatted(), 'fmt', '--check', '--exit-code')).exitCode).toBe(2)
  expect((await cli(copy('valid'), 'fmt', '--check', '--exit-code')).exitCode).toBe(0)
})

test('--json lists the changed files, and ok stays true on exit 2', async () => {
  const written = await cli(unformatted(), 'fmt', '--json')
  expect(written.stderr).toBe('')
  expect(parseEnvelope<FmtData>(written.stdout)).toEqual({
    format: 'envelope/1',
    ok: true,
    data: { changed: files },
    issues: [],
  })
  const pending = await cli(unformatted(), 'fmt', '--check', '--exit-code', '--json')
  expect(pending.exitCode).toBe(2)
  expect(parseEnvelope<FmtData>(pending.stdout)).toMatchObject({ ok: true, data: { changed: files } })
})

test('a file the reader rejects exits 3 with its issue and rewrites nothing', async () => {
  const dir = empty()
  writeFileSync(
    join(dir, 'kalup.config.ts'),
    "import { defineConfig } from 'kalup'\n\nexport default defineConfig({})\n",
  )
  mkdirSync(join(dir, 'kalup', 'objects'), { recursive: true })
  const bad =
    "import { defineObject, p } from '@kalup/core'\n\nexport const Plot = defineObject('plots', {\n  properties: { ...shared },\n})\n"
  writeFileSync(join(dir, 'kalup', 'objects', 'plots.ts'), bad)
  const out = await cli(dir, 'fmt', '--json')
  expect(out.exitCode).toBe(3)
  const env = parseEnvelope(out.stdout)
  expect(env.ok).toBe(false)
  expect(env.issues[0]).toMatchObject({ file: 'kalup/objects/plots.ts', line: expect.any(Number) })
  expect(text(dir, 'kalup/objects/plots.ts')).toBe(bad)
  expect(existsSync(join(dir, '.kalup'))).toBe(false)
})

test('a rejected file sorted after a non-canonical one still means nothing is rewritten', async () => {
  // Review finding: fmt wrote file by file, so kalup.config.ts was rewritten (and copied to history) before the
  // reader rejected kalup/objects/zzz.ts, and the exit 3 output never mentioned the rewrite.
  const dir = unformatted()
  const before = Object.fromEntries(files.map((file) => [file, text(dir, file)]))
  writeFileSync(
    join(dir, 'kalup', 'objects', 'zzz.ts'),
    "import { defineObject, p } from '@kalup/core'\n\nexport const Zzz = defineObject('zzz', {\n  properties: { ...shared },\n})\n",
  )
  const out = await cli(dir, 'fmt')
  expect(out.exitCode).toBe(3)
  expect(out.stdout).toBe('')
  for (const file of files) {
    expect(text(dir, file)).toBe(before[file])
  }
  expect(existsSync(join(dir, '.kalup'))).toBe(false)
})

test('files a later release reads (pipelines, removed.ts) are E_UNSUPPORTED_FILE, the same as validate says', async () => {
  const dir = unformatted()
  const before = Object.fromEntries(files.map((file) => [file, text(dir, file)]))
  mkdirSync(join(dir, 'kalup', 'pipelines'))
  writeFileSync(join(dir, 'kalup', 'pipelines', 'deals.ts'), "export const Deals = definePipeline('deals', {})\n")
  writeFileSync(join(dir, 'kalup', 'removed.ts'), 'export default []\n')
  const out = await cli(dir, 'fmt', '--json')
  expect(out.exitCode).toBe(3)
  const env = parseEnvelope(out.stdout)
  expect(env.ok).toBe(false)
  expect(env.issues.map((issue) => [issue.code, issue.file])).toEqual([
    ['E_UNSUPPORTED_FILE', 'kalup/pipelines/deals.ts'],
    ['E_UNSUPPORTED_FILE', 'kalup/removed.ts'],
  ])
  expect(env.issues[0]?.fix).toBe('move kalup/pipelines/deals.ts out of kalup/ until a release reads it')
  for (const file of files) {
    expect(text(dir, file)).toBe(before[file])
  }
  expect(existsSync(join(dir, '.kalup'))).toBe(false)
})

test('validate runs first: a project with a semantic error exits 3 and nothing is rewritten', async () => {
  const dir = copy('invalid')
  const before = text(dir, 'kalup/objects/companies.ts')
  writeFileSync(
    join(dir, 'kalup', 'objects', 'companies.ts'),
    before.replace(/^ +/gm, (indent) => indent + indent),
  )
  const out = await cli(dir, 'fmt')
  expect(out.exitCode).toBe(3)
  expect(out.stdout).toBe('')
  expect(out.stderr).toContain('E_UNKNOWN_GROUP')
  expect(text(dir, 'kalup/objects/companies.ts')).not.toBe(before)
  expect(existsSync(join(dir, '.kalup'))).toBe(false)
})

test('warnings are printed and do not block a rewrite', async () => {
  const dir = copy('warned')
  const out = await cli(dir, 'fmt')
  expect(out.exitCode).toBe(0)
  expect(out.stdout).toBe('All files are canonical\n')
  expect(out.stderr).toContain('W_PREFIX')
})

test('regenerates the barrel: one type and one value export per object, from its file', async () => {
  const dir = copy('valid')
  rmSync(join(dir, 'kalup', 'index.ts'))
  const out = await cli(dir, 'fmt')
  expect(out.exitCode).toBe(0)
  expect(out.stdout).toBe('rewrote kalup/index.ts\n')
  expect(text(dir, 'kalup/index.ts')).toBe(text(project('valid'), 'kalup/index.ts'))
  writeFileSync(join(dir, 'kalup', 'index.ts'), "export { Company } from './objects/companies'\n")
  const check = await cli(dir, 'fmt', '--check', '--json')
  expect(parseEnvelope<FmtData>(check.stdout).data).toEqual({ changed: ['kalup/index.ts'] })
})

test('a project with no object file gets no barrel', () => {
  const config = "import { defineConfig } from 'kalup'\n\nexport default defineConfig({})\n"
  expect(canonical({ 'kalup.config.ts': config })).toEqual([['kalup.config.ts', config]])
})

test('every fixture project is canonical, barrel included', () => {
  for (const name of ['valid', 'invalid', 'warned']) {
    const read = readProjectFiles(project(name))
    for (const [file, written] of canonical(read)) {
      expect(written, `${name}/${file}`).toBe(read[file])
    }
  }
})

test('no kalup.config.ts exits 1', async () => {
  const out = await cli(empty(), 'fmt')
  expect(out.exitCode).toBe(1)
  expect(out.stderr).toContain('E_NO_CONFIG')
})
