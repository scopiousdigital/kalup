import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fresh, stamp } from '@kalup/tsconfig/stamp'
import { expect, test } from 'vitest'
import { checkBuild, parseEnvelope } from '../../src/commands/testing.js'

const cli = fileURLToPath(new URL('../../', import.meta.url))
const engine = realpathSync(join(cli, 'node_modules/@kalup/engine'))
const stale = /does not match its sources: run pnpm --filter kalup build before the tests/
const staleEngine = /does not match its sources: run pnpm --filter @kalup\/engine build before the tests/
const engineStamp = 'engine/dist/build-stamp.json'

// A throwaway copy of a built package, so these tests never touch the real sources or dist. It sits under a packages
// folder beside a copy of the engine's stamp, which the CLI's fingerprint reads as ../engine/dist/build-stamp.json.
function built(root: string, entries: string[]): string {
  const packages = mkdtempSync(join(tmpdir(), 'kalup-cli-build-'))
  const dir = join(packages, basename(root))
  for (const entry of entries) {
    cpSync(join(root, entry), join(dir, entry), { recursive: true })
  }
  cpSync(join(engine, 'dist/build-stamp.json'), join(packages, engineStamp))
  return dir
}

test('an edited source fails even when its timestamp is older than the build', () => {
  const dir = built(cli, ['src', 'dist', 'tsdown.config.ts', 'tsconfig.build.json'])
  appendFileSync(join(dir, 'src/index.ts'), '\n// edited\n')
  utimesSync(join(dir, 'src/index.ts'), new Date(0), new Date(0))
  expect(() => checkBuild(dir, 'pnpm --filter kalup build')).toThrow(stale)
})

test('a hidden file and the test helper are left out of the fingerprint', () => {
  const dir = built(cli, ['src', 'dist', 'tsdown.config.ts', 'tsconfig.build.json'])
  writeFileSync(join(dir, 'src/lib/.DS_Store'), '')
  appendFileSync(join(dir, 'src/commands/testing.ts'), '\n// edited\n')
  expect(() => checkBuild(dir, 'pnpm --filter kalup build')).not.toThrow()
})

// tsdown --watch calls build:prepare once, then build:done after the first build and after every rebuild.
test('under watch, a rebuild of edited sources leaves no stamp, so reverting the edit later cannot vouch for it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kalup-cli-watch-'))
  mkdirSync(join(dir, 'src'))
  mkdirSync(join(dir, 'dist'))
  writeFileSync(join(dir, 'src/value.ts'), 'export const value = 1\n')
  const hooks = stamp(['src'])
  const build = { options: { cwd: dir, outDir: join(dir, 'dist') } }
  hooks['build:prepare'](build)
  hooks['build:done'](build)
  expect(fresh(dir)).toBe(true)
  writeFileSync(join(dir, 'src/value.ts'), 'export const value = 2\n')
  hooks['build:done'](build)
  writeFileSync(join(dir, 'src/value.ts'), 'export const value = 1\n')
  expect(fresh(dir)).toBe(false)
})

test('a dist without a stamp fails', () => {
  const dir = built(cli, ['src', 'dist', 'tsdown.config.ts', 'tsconfig.build.json'])
  rmSync(join(dir, 'dist/build-stamp.json'))
  expect(() => checkBuild(dir, 'pnpm --filter kalup build')).toThrow(stale)
})

test('the engine stamp covers the JSON schema its bundle imports', () => {
  const dir = built(engine, ['src', 'schemas', 'dist', 'tsdown.config.ts'])
  appendFileSync(join(dir, 'schemas/ir-1.schema.json'), '\n')
  expect(() => checkBuild(dir, 'pnpm --filter @kalup/engine build')).toThrow(staleEngine)
})

test('a rebuilt engine makes the CLI dist that inlines the old one stale', () => {
  const dir = built(cli, ['src', 'dist', 'tsdown.config.ts', 'tsconfig.build.json'])
  expect(() => checkBuild(dir, 'pnpm --filter kalup build')).not.toThrow()
  writeFileSync(join(dir, '..', engineStamp), '{"inputs":["src"],"sha256":"0"}\n')
  expect(() => checkBuild(dir, 'pnpm --filter kalup build')).toThrow(stale)
})

test('parseEnvelope refuses another format and data: null', () => {
  const env = { format: 'envelope/1', ok: true, data: { files: [] }, issues: [] }
  expect(() => parseEnvelope(JSON.stringify({ ...env, format: 'ir/1' }))).toThrow('not an envelope/1 document')
  expect(() => parseEnvelope(JSON.stringify({ ...env, data: null }))).toThrow('data: null')
})
