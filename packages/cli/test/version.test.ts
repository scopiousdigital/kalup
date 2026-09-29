import { readFileSync } from 'node:fs'
import { bin, disclaimer } from '@kalup/engine'
import { expect, test } from 'vitest'
import { envelope } from '../src/lib/output.js'
import { formats, version, versionText } from '../src/version.js'

const semver = /^\d+\.\d+\.\d+/

/** A schema the engine holds and the package ships, by file name. */
function schema(name: string): { properties: Record<string, { const?: unknown }> } {
  return JSON.parse(readFileSync(new URL(`../../engine/schemas/${name}`, import.meta.url), 'utf8'))
}

test('the version text carries the name, the version and the disclaimer', () => {
  expect(version).toMatch(semver)
  expect(versionText()).toBe(`${bin} ${version}\n${disclaimer}\n`)
})

test('formats names each document at the version its schema or writer fixes', () => {
  const constOf = (name: string, field: string) => schema(name).properties[field]?.const
  expect([...formats].sort()).toEqual(
    [
      `ir/${constOf('ir-1.schema.json', 'irVersion')}`,
      constOf('plan-1.schema.json', 'format'),
      constOf('state-1.schema.json', 'format'),
      envelope(true).format,
      `blueprint/${constOf('blueprint-1.schema.json', 'blueprintVersion')}`,
      `blueprints-lock/${constOf('blueprints-lock-1.schema.json', 'lockVersion')}`,
    ].sort(),
  )
})
