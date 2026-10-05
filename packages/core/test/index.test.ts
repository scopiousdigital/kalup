// The package boundary. @kalup/core is what user project files and apps import: the codecs and builders, and the config
// authoring surface. The engine lives in @kalup/engine, so nothing else may appear here, and the app pays for no
// dependency. The checks read the built dist, which is what ships.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { fresh } from '@kalup/tsconfig/stamp'
import { beforeAll, expect, test } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))
const ANY_IMPORT = /\bimport\b|\brequire\(/
const FETCH = /\bfetch\b/
const DECLARED = /^export declare (?:const|function) (\w+)/gm
const TYPE_LIST = /^export type \{([^}]*)\};?$/gm

const VALUES = [
  'defineConfig',
  'defineCustomObject',
  'defineObject',
  'definePipeline',
  'defineRemoved',
  'p',
  'propertyNames',
]
const TYPES = [
  // Codecs and builders.
  'Codec',
  'Codecs',
  'DataSensitivity',
  'DefinedCustomObject',
  'DefinedObject',
  'DefinedPipeline',
  'EnumAlias',
  'EnumOption',
  'EnumPropertyBuilder',
  'EnumReference',
  'EnumValues',
  'GroupDefinition',
  'InferProperties',
  'NumberDisplay',
  'NumberDisplayHint',
  'OwnerDefinition',
  'PipelineSpec',
  'PropertyBuilder',
  'PropertyDefinition',
  'PropertyEntry',
  'PropertyLifecycle',
  'PropertyName',
  'ReadonlyCodec',
  'ReadonlyPropertyBuilder',
  'RequiredPropertyBuilder',
  'StageId',
  'StageSpec',
  'StageState',
  'StandardOutput',
  'StandardResult',
  'StandardSchema',
  'TextDisplay',
  'TextDisplayHint',
  'Unlisted',
  // Config authoring.
  'Definition',
  'KalupConfig',
  'KalupRemoved',
  'Mode',
  'ObjectScope',
  'Override',
  'Target',
  'TargetObject',
  'Tombstone',
]

function dist(file: string): string {
  return readFileSync(new URL(`../dist/${file}`, import.meta.url), 'utf8')
}

beforeAll(() => {
  if (!fresh(root)) {
    throw new Error(`${root}dist does not match its sources: run pnpm --filter @kalup/core build before the tests`)
  }
})

test('the bundle and its declarations import nothing, and the bundle never calls fetch', () => {
  expect(dist('index.mjs')).not.toMatch(ANY_IMPORT)
  expect(dist('index.d.mts')).not.toMatch(ANY_IMPORT)
  expect(dist('index.mjs')).not.toMatch(FETCH)
})

test('the runtime exports are exactly the builders and the config helpers', async () => {
  const module = await import(new URL('../dist/index.mjs', import.meta.url).href)
  expect(Object.keys(module).sort()).toEqual(VALUES)
})

test('the declared exports are exactly the app runtime and the config authoring types', () => {
  const text = dist('index.d.mts')
  const values = [...text.matchAll(DECLARED)].map((m) => m[1])
  const types = [...text.matchAll(TYPE_LIST)].flatMap((m) => (m[1] ?? '').split(',').map((name) => name.trim()))
  expect(values.sort()).toEqual(VALUES)
  expect(types.sort()).toEqual([...TYPES].sort())
})

// A tripwire, not a budget: engine code pulled in by an import would multiply the size.
test('the bundle stays small', () => {
  expect(Buffer.byteLength(dist('index.mjs'))).toBeLessThan(16_384)
})
