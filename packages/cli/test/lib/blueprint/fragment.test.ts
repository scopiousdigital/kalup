// A blueprint as the commands prepare it: parsed as data, binding defaults filled before the prefix, the prefix checked,
// and the version order the downgrade warning uses.
import type { Blueprint, BlueprintResource, ConfigFile } from '@kalup/core'
import { expect, test } from 'vitest'
import { compareVersions, parseBlueprint, prefixFor, prepare } from '../../../src/lib/blueprint/fragment.js'
import { KalupError } from '../../../src/lib/output.js'
import { blueprintText } from '../../commands/renewals.js'

const v1 = (): Blueprint => parseBlueprint(blueprintText('1.0.0'), 'blueprints/renewals-1.0.0.json')

function resource(blueprint: Blueprint, address: string): BlueprintResource {
  return blueprint.resources[address] as BlueprintResource
}

function codeOf(run: () => unknown): string | undefined {
  try {
    run()
  } catch (error) {
    return (error as KalupError).issues[0]?.code
  }
  return undefined
}

test('the text is parsed as JSON, never run: a string that looks like code stays a string', () => {
  const code = "'); require('child_process').exec('touch pwned'); ('"
  const blueprint = parseBlueprint(
    blueprintText('1.0.0').replace('"Renewal date"', JSON.stringify(code)),
    'renewals.json',
  )
  expect(resource(blueprint, 'property:deals/renewal_date').definition.label).toBe(code)
  expect(() => parseBlueprint('module.exports = {}', 'renewals.js')).toThrow(KalupError)
  expect(codeOf(() => parseBlueprint('module.exports = {}', 'renewals.js'))).toBe('E_BLUEPRINT_SCHEMA')
})

test('another blueprint version is E_BLUEPRINT_SCHEMA naming the source and the version this one reads, first', () => {
  // A newer format may be shaped in any way: only blueprintVersion is read.
  const text = JSON.stringify({ ...v1(), blueprintVersion: 2, resources: [] })
  try {
    parseBlueprint(text, 'https://blueprints.example.com/renewals-2.0.0.json')
    expect.unreachable()
  } catch (error) {
    expect(error).toMatchObject({ exitCode: 1 })
    expect((error as KalupError).issues).toEqual([
      {
        code: 'E_BLUEPRINT_SCHEMA',
        message: expect.stringContaining('is blueprint/2'),
        configPath: 'blueprintVersion',
        fix: expect.stringContaining('blueprint/1 version'),
      },
    ])
  }
})

test('prepare fills the key from the unprefixed name and the codec from the type, then applies the prefix', () => {
  const { blueprint, sources } = prepare(v1(), 'nw_')
  expect(Object.keys(blueprint.resources)).toEqual([
    'group:deals/nw_renewal',
    'property:deals/nw_renewal_date',
    'property:deals/nw_renewal_notes',
    'property:deals/nw_renewal_stage',
  ])
  expect(resource(blueprint, 'property:deals/nw_renewal_notes').binding).toEqual({
    key: 'renewalNotes',
    codec: 'string',
  })
  expect(resource(blueprint, 'property:deals/nw_renewal_stage').binding).toEqual({
    key: 'renewalStage',
    codec: 'enum',
    aliases: { won: 'renewed' },
  })
  expect(resource(blueprint, 'property:deals/nw_renewal_stage').definition.group).toEqual({
    $ref: 'group:deals/nw_renewal',
  })
  expect(sources.get('property:deals/nw_renewal_stage')).toBe('property:deals/renewal_stage')
  expect(prepare(v1(), '').blueprint.resources['group:deals/renewal']).toEqual(v1().resources['group:deals/renewal'])
})

test("the prefix comes from the flag, then config's prefix; one that is not plain is E_USAGE", () => {
  const config = { prefix: 'acme_' } as ConfigFile
  expect(prefixFor(undefined, config)).toBe('acme_')
  expect(prefixFor('nw_', config)).toBe('nw_')
  expect(prefixFor(undefined, {} as ConfigFile)).toBe('')
  expect(codeOf(() => prefixFor('9nw', {} as ConfigFile))).toBe('E_USAGE')
  expect(codeOf(() => prepare(v1(), 'hs_'))).toBe('E_BLUEPRINT_SCHEMA')
})

test('versions order as semantic versions, a pre-release below its release', () => {
  const ordered = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0', '1.2.0', '1.10.0', '2.0.0']
  for (let i = 1; i < ordered.length; i += 1) {
    expect(compareVersions(ordered[i - 1] as string, ordered[i] as string), ordered[i]).toBeLessThan(0)
    expect(compareVersions(ordered[i] as string, ordered[i - 1] as string), ordered[i]).toBeGreaterThan(0)
  }
  expect(compareVersions('1.1.0', '1.1.0')).toBe(0)
})
