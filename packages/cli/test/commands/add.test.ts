// kalup add: offline through the built host, with a fetch that fails on any HubSpot request, and assertions on the
// files it leaves. The staged-write failure runs the handler from source with node:fs mocked, which the built host
// (loaded by Node itself) never sees.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { IR } from '@kalup/core'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { type AddData, add } from '../../src/commands/add.js'
import type { Flags } from '../../src/commands/context.js'
import { cli, parseEnvelope } from '../../src/commands/testing.js'
import { KalupError } from '../../src/lib/output.js'
import { edit } from './orchard.js'
import {
  bare,
  barrel,
  blueprintText,
  config,
  deals,
  lockFile,
  noHubSpot,
  orchard,
  original,
  projectFiles,
  source,
} from './renewals.js'

const control = vi.hoisted(() => ({ failRename: 0, renames: 0 }))

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>()
  return {
    ...fs,
    renameSync: (from: string, to: string) => {
      control.renames += 1
      if (control.renames === control.failRename) {
        throw Object.assign(new Error('rename failed'), { code: 'EIO' })
      }
      fs.renameSync(from, to)
    },
  }
})

beforeEach(() => {
  control.failRename = 0
  control.renames = 0
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const attributes = '.gitattributes'
const renewal = 'group:deals/renewal'
const renewalDate = 'property:deals/renewal_date'
const renewalNotes = 'property:deals/renewal_notes'
const renewalStage = 'property:deals/renewal_stage'
const hash = /^sha256:[0-9a-f]{64}$/
const integrity =
  /^blueprints\/renewals-1\.0\.0\.json version 1\.0\.0 was recorded with sha256:[0-9a-f]{64}, and the source now serves sha256:[0-9a-f]{64}\. Nothing was written\.$/

function text(dir: string, file: string): string {
  return readFileSync(join(dir, file), 'utf8')
}

async function run(dir: string, ...argv: string[]) {
  const guard = noHubSpot()
  const out = await cli(dir, 'add', ...argv, '--json')
  if (guard.urls.length > 0) {
    throw new Error(`add sent a request: ${guard.urls.join(', ')}`)
  }
  return { ...out, env: parseEnvelope<AddData>(out.stdout) }
}

/** Runs an add that must refuse, and fails if it wrote anything. */
async function refused(dir: string, ...argv: string[]) {
  const before = projectFiles(dir)
  const out = await run(dir, ...argv)
  if (JSON.stringify(projectFiles(dir)) !== JSON.stringify(before)) {
    throw new Error(`a refused add wrote files: ${out.stdout}`)
  }
  return out
}

/** A blueprint file in `dir` made from 1.0.0 with a change, and its path. */
function variant(dir: string, change: (blueprint: Record<string, unknown>) => void, name = 'variant.json'): string {
  const blueprint = JSON.parse(blueprintText('1.0.0')) as Record<string, unknown>
  change(blueprint)
  writeFileSync(join(dir, name), JSON.stringify(blueprint, null, 2))
  return name
}

type Resources = Record<string, { definition: Record<string, unknown>; binding?: Record<string, unknown> }>

const DEALS = `import { defineObject, type InferProperties, p } from '@kalup/core'

export const Deal = defineObject('deals', {
  groups: {
    renewal: { label: 'Renewal' },
  },
  properties: {
    renewalDate: p.date('renewal_date', {
      label: 'Renewal date',
      group: 'renewal',
      fieldType: 'date',
    }),
  },
})

export type DealData = InferProperties<typeof Deal.properties> & { id: string }
`

test('add into a project with no object files writes the object file, the config, the barrel, the lock and the original', async () => {
  const dir = bare()
  const out = await run(dir, source(dir, '1.0.0'))
  expect(out.exitCode, out.stdout).toBe(0)
  const data = out.env.data as AddData
  expect(data.blueprint).toMatchObject({
    name: 'acme/renewals',
    version: '1.0.0',
    source: 'blueprints/renewals-1.0.0.json',
    prefix: '',
  })
  expect(data.blueprint.hash).toMatch(hash)
  expect(data.resources).toEqual([
    { address: renewal, sourceAddress: renewal, status: 'added' },
    { address: renewalDate, sourceAddress: renewalDate, status: 'added' },
    { address: renewalNotes, sourceAddress: renewalNotes, status: 'added' },
    { address: renewalStage, sourceAddress: renewalStage, status: 'added' },
  ])
  expect(data.objects).toEqual(['deals'])
  expect(data.files).toEqual([attributes, config, original('1.0.0'), lockFile, barrel, deals])
  // Git must not change the stored original's line endings: upgrade checks its bytes against the lock's hash.
  expect(text(dir, attributes)).toBe('kalup/.blueprints/** -text\n')
  expect(text(dir, deals)).toBe(
    [
      "import { defineObject, type InferProperties, p } from '@kalup/core'",
      '',
      "export const Deal = defineObject('deals', {",
      '  groups: {',
      "    renewal: { label: 'Renewal' },",
      '  },',
      '  properties: {',
      "    renewalDate: p.date('renewal_date', {",
      "      label: 'Renewal date',",
      "      group: 'renewal',",
      "      fieldType: 'date',",
      '    }),',
      "    renewalNotes: p.string('renewal_notes', {",
      "      label: 'Renewal notes',",
      "      group: 'renewal',",
      "      fieldType: 'textarea',",
      "      description: 'Notes for the renewal',",
      '    }),',
      "    renewalStage: p.enum('renewal_stage', {",
      "      label: 'Renewal stage',",
      "      group: 'renewal',",
      "      fieldType: 'select',",
      '      options: [',
      "        { value: 'open', label: 'Open' },",
      "        { value: 'won', label: 'Won', as: 'renewed' },",
      "        { value: 'lost', label: 'Lost' },",
      '      ],',
      '    }),',
      '  },',
      '})',
      '',
      'export type DealData = InferProperties<typeof Deal.properties> & { id: string }',
      '',
    ].join('\n'),
  )
  expect(text(dir, config)).toContain('  objects: {\n    companies: {},\n    deals: {},\n  },\n')
  expect(text(dir, barrel)).toBe(
    "export type { DealData } from './objects/deals'\nexport { Deal } from './objects/deals'\n",
  )
  // The stored original is the source's bytes, unchanged.
  expect(readFileSync(join(dir, original('1.0.0')))).toEqual(readFileSync(join(dir, 'blueprints/renewals-1.0.0.json')))
  const lock = JSON.parse(text(dir, lockFile))
  expect(lock).toEqual({
    lockVersion: 1,
    blueprints: {
      'acme/renewals': {
        version: '1.0.0',
        source: 'blueprints/renewals-1.0.0.json',
        hash: data.blueprint.hash,
        prefix: '',
        original: original('1.0.0'),
        resources: {
          [renewal]: renewal,
          [renewalDate]: renewalDate,
          [renewalNotes]: renewalNotes,
          [renewalStage]: renewalStage,
        },
        held: [],
      },
    },
    sources: { 'blueprints/renewals-1.0.0.json@1.0.0': data.blueprint.hash },
  })
  expect((await cli(dir, 'validate')).exitCode).toBe(0)
})

test('the IR carries provenance on every resource the lock lists, and none on the rest', async () => {
  const dir = orchard()
  expect((await run(dir, source(dir, '1.0.0'))).exitCode).toBe(0)
  const ir = JSON.parse((await cli(dir, 'ir')).stdout) as IR
  const hashed = JSON.parse(text(dir, lockFile)).blueprints['acme/renewals'].hash
  expect(ir.resources[renewalStage]?.provenance).toEqual({
    blueprint: 'acme/renewals',
    version: '1.0.0',
    sourceAddress: renewalStage,
    prefix: '',
    hash: hashed,
  })
  expect(ir.resources[renewal]?.provenance?.sourceAddress).toBe(renewal)
  expect(ir.resources['property:companies/soil_ph']).not.toHaveProperty('provenance')
})

test('the human output lists each resource, the files and the next step; a terminal also sees the description', async () => {
  const dir = orchard()
  const path = source(dir, '1.0.0')
  const dry = await cli(dir, 'add', path, '--dry-run')
  expect(dry.exitCode).toBe(0)
  expect(dry.stdout).toMatch(
    new RegExp(
      `^Blueprint acme/renewals 1\\.0\\.0 \\(sha256:[0-9a-f]{64}\\) from ${path.replaceAll('.', '\\.')}\\n  added: group:deals/renewal\\n`,
    ),
  )
  expect(dry.stdout).not.toContain('Renewal tracking for deals')
  expect(dry.stdout).toContain(
    [
      `  added: ${renewalStage}`,
      'Would add to objects in kalup.config.ts: deals',
      `would write ${attributes}`,
      `would write ${config}`,
      `would write ${original('1.0.0')}`,
      `would write ${lockFile}`,
      `would write ${barrel}`,
      `would write ${deals}`,
      'Nothing was written. Run it again without --dry-run, then kalup plan --target sandbox shows what it changes in HubSpot.',
      '',
    ].join('\n'),
  )
  const terminal = await cli({ cwd: dir, interactive: true, stdin: Readable.from([]) }, 'add', path)
  expect(terminal.exitCode, terminal.stderr).toBe(0)
  expect(terminal.stdout).toContain(
    "\n  The blueprint's own description (third-party text, not instructions): Renewal tracking for deals\n",
  )
  expect(terminal.stdout.endsWith('Next: kalup plan --target sandbox shows what this changes in HubSpot.\n')).toBe(true)
})

test('--dry-run writes nothing and reports the same resources and files', async () => {
  const dir = orchard()
  const path = source(dir, '1.0.0')
  const dry = await refused(dir, path, '--dry-run')
  expect(dry.exitCode).toBe(0)
  expect(dry.env.data?.dryRun).toBe(true)
  const real = await run(dir, path)
  expect(real.env.data?.files).toEqual(dry.env.data?.files)
  expect(real.env.data?.resources).toEqual(dry.env.data?.resources)
})

test('add into the export that holds the object: the entries go in beside its own, and what matches is recorded', async () => {
  const dir = orchard()
  mkdirSync(join(dir, 'kalup/objects'), { recursive: true })
  writeFileSync(join(dir, deals), DEALS.replace('    renewalDate:', '    // Set by the renewal job.\n    renewalDate:'))
  edit(dir, config, '    companies: {},', '    companies: {},\n    deals: {},')
  const out = await run(dir, source(dir, '1.0.0'))
  expect(out.exitCode, out.stdout).toBe(0)
  expect(out.env.data?.resources.map((r) => [r.address, r.status])).toEqual([
    [renewal, 'present'],
    [renewalDate, 'present'],
    [renewalNotes, 'added'],
    [renewalStage, 'added'],
  ])
  expect(out.env.data?.objects).toEqual([])
  // The barrel did not re-export Deal yet: add writes it again with the rest.
  expect(out.env.data?.files).toEqual([attributes, original('1.0.0'), lockFile, barrel, deals])
  const file = text(dir, deals)
  expect(file).toContain("    // Set by the renewal job.\n    renewalDate: p.date('renewal_date', {")
  expect(file).toContain("renewalNotes: p.string('renewal_notes', {")
  expect(file.match(/export const /g)).toHaveLength(1)
  const ir = JSON.parse((await cli(dir, 'ir')).stdout) as IR
  expect(ir.resources[renewalDate]?.provenance?.blueprint).toBe('acme/renewals')
})

test('a prefix renames every name and $ref, and leaves labels, option values and binding keys alone', async () => {
  const dir = orchard()
  const out = await run(dir, source(dir, '1.0.0'), '--prefix', 'acme_')
  expect(out.exitCode, out.stdout).toBe(0)
  expect(out.env.data?.resources.map((r) => [r.address, r.sourceAddress])).toEqual([
    ['group:deals/acme_renewal', renewal],
    ['property:deals/acme_renewal_date', renewalDate],
    ['property:deals/acme_renewal_notes', renewalNotes],
    ['property:deals/acme_renewal_stage', renewalStage],
  ])
  const file = text(dir, deals)
  expect(file).toContain("    acme_renewal: { label: 'Renewal' },")
  expect(file).toContain(
    "    renewalStage: p.enum('acme_renewal_stage', {\n      label: 'Renewal stage',\n      group: 'acme_renewal',",
  )
  expect(file).toContain("        { value: 'won', label: 'Won', as: 'renewed' },")
  expect(JSON.parse(text(dir, lockFile)).blueprints['acme/renewals'].prefix).toBe('acme_')
})

test("config's prefix applies without the flag, and a prefix that is not plain or makes an hs_ name is refused", async () => {
  const dir = orchard()
  const path = source(dir, '1.0.0')
  const bad = await refused(dir, path, '--prefix', 'Acme-')
  expect(bad.exitCode).toBe(1)
  expect(bad.env.issues[0]).toMatchObject({ code: 'E_USAGE' })
  expect(bad.env.issues[0]?.message).toBe(
    "--prefix 'Acme-' is not lowercase letters, digits and underscores starting with a letter",
  )
  const hs = await refused(dir, path, '--prefix', 'hs_')
  expect(hs.exitCode).toBe(1)
  expect(hs.env.issues[0]?.code).toBe('E_BLUEPRINT_SCHEMA')
  expect(hs.env.issues[0]?.message).toContain("with the prefix 'hs_': group name 'hs_renewal' starts with hs_")
  edit(dir, config, "  name: 'orchard-apply',", "  name: 'orchard-apply',\n  prefix: 'nw_',")
  const out = await run(dir, path)
  expect(out.exitCode, out.stdout).toBe(0)
  expect(out.env.data?.blueprint.prefix).toBe('nw_')
  expect(out.env.data?.resources[0]?.address).toBe('group:deals/nw_renewal')
})

test('an address config holds with another definition is E_BLUEPRINT_COLLISION, exit 1, naming each unit; nothing is written', async () => {
  const dir = orchard()
  mkdirSync(join(dir, 'kalup/objects'), { recursive: true })
  writeFileSync(join(dir, deals), DEALS.replace("label: 'Renewal date',", "label: 'Contract end',"))
  edit(dir, config, '    companies: {},', '    companies: {},\n    deals: {},')
  const out = await refused(dir, source(dir, '1.0.0'))
  expect(out.exitCode).toBe(1)
  expect(out.env.issues).toEqual([
    {
      code: 'E_BLUEPRINT_COLLISION',
      message: `${renewalDate} is in config with another definition: label (config "Contract end", blueprint "Renewal date"). Nothing was written.`,
      fix: 'make config match the blueprint, remove the resource from config, or add the blueprint with --prefix so its names do not collide',
      docs: 'errors/E_BLUEPRINT_COLLISION.md',
    },
  ])
  expect(out.env.data?.resources.find((r) => r.address === renewalDate)).toEqual({
    address: renewalDate,
    sourceAddress: renewalDate,
    status: 'collision',
    units: ['label'],
  })
})

test('a config entry marked .managed(false) collides on managed: a blueprint resource is always applied', async () => {
  const dir = orchard()
  mkdirSync(join(dir, 'kalup/objects'), { recursive: true })
  writeFileSync(
    join(dir, deals),
    DEALS.replace("      fieldType: 'date',\n    }),", "      fieldType: 'date',\n    }).managed(false),"),
  )
  edit(dir, config, '    companies: {},', '    companies: {},\n    deals: {},')
  const out = await refused(dir, source(dir, '1.0.0'))
  expect(out.exitCode).toBe(1)
  expect(out.env.issues).toEqual([
    {
      code: 'E_BLUEPRINT_COLLISION',
      message: `${renewalDate} is in config with another definition: managed (config false, blueprint true). Nothing was written.`,
      fix: 'make config match the blueprint, remove the resource from config, or add the blueprint with --prefix so its names do not collide',
      docs: 'errors/E_BLUEPRINT_COLLISION.md',
    },
  ])
  expect(out.env.data?.resources.find((r) => r.address === renewalDate)).toEqual({
    address: renewalDate,
    sourceAddress: renewalDate,
    status: 'collision',
    units: ['managed'],
  })
})

test('a resource another blueprint provides collides even when alike, and the fix says what resolves it', async () => {
  const dir = orchard()
  expect((await run(dir, source(dir, '1.0.0'))).exitCode).toBe(0)
  const billing = variant(dir, (b) => {
    const resources = b.resources as Resources
    Object.assign(b, { name: 'acme/billing', resources: { [renewal]: resources[renewal] } })
  })
  const out = await refused(dir, billing)
  expect(out.exitCode).toBe(1)
  expect(out.env.issues).toEqual([
    {
      code: 'E_BLUEPRINT_COLLISION',
      message: `${renewal} is already provided by blueprint acme/renewals, and a resource belongs to one blueprint. Nothing was written.`,
      fix: `add acme/billing with --prefix so its names do not collide, or add your own copy of acme/billing without ${renewal} (its properties may still name a group config has)`,
      docs: 'errors/E_BLUEPRINT_COLLISION.md',
    },
  ])
})

test('the .gitattributes rule is added once, after what the file holds', async () => {
  const dir = orchard()
  writeFileSync(join(dir, attributes), '*.png binary')
  expect((await run(dir, source(dir, '1.0.0'))).exitCode).toBe(0)
  expect(text(dir, attributes)).toBe('*.png binary\nkalup/.blueprints/** -text\n')
  const ruled = orchard()
  writeFileSync(join(ruled, attributes), '/kalup/.blueprints/* binary\n')
  const out = await run(ruled, source(ruled, '1.0.0'))
  expect(out.exitCode).toBe(0)
  expect(out.env.data?.files).not.toContain(attributes)
  expect(text(ruled, attributes)).toBe('/kalup/.blueprints/* binary\n')
})

test('a group $ref that is not a plain name is E_BLUEPRINT_SCHEMA, and no control character reaches the output', async () => {
  const dir = orchard()
  const path = variant(dir, (b) => {
    const resources = b.resources as Resources
    ;(resources[renewalDate] as Resources[string]).definition.group = {
      $ref: `group:deals/x\u001b]0;TITLE\u0007\u001b[2J\u202e${'X'.repeat(3000)}`,
    }
  })
  const out = await refused(dir, path)
  expect(out.exitCode).toBe(1)
  expect(out.env.issues.map((i) => i.code)).toEqual(['E_BLUEPRINT_SCHEMA'])
  for (const sequence of ['\\u001b', '\\u0007', '\u202e']) {
    expect(out.stdout).not.toContain(sequence)
  }
  expect(Array.from(String(out.env.issues[0]?.message)).length).toBeLessThanOrEqual(500)
})

test('a group the fragment names but neither it nor config holds is E_BLUEPRINT_REF', async () => {
  const dir = orchard()
  const path = variant(dir, (b) => {
    const resources = b.resources as Resources
    Reflect.deleteProperty(resources, renewal)
    for (const resource of Object.values(resources)) {
      resource.definition.group = { $ref: 'group:deals/contract' }
    }
  })
  const out = await refused(dir, path)
  expect(out.exitCode).toBe(1)
  expect(out.env.issues.map((i) => i.code)).toEqual(['E_BLUEPRINT_REF', 'E_BLUEPRINT_REF', 'E_BLUEPRINT_REF'])
  expect(out.env.issues[0]).toMatchObject({
    message: `${renewalDate} is in group group:deals/contract, which is neither in the blueprint nor in config. Nothing was written.`,
    fix: "add contract: { label: '...' } to the groups of deals in config, then run the command again",
  })
})

test('a custom object config does not define is E_BLUEPRINT_REQUIRES', async () => {
  const dir = orchard()
  const path = variant(dir, (b) =>
    Object.assign(b, { requires: [{ $ref: 'object:deals' }, { $ref: 'object:vineyard' }] }),
  )
  const out = await refused(dir, path)
  expect(out.exitCode).toBe(1)
  expect(out.env.issues[0]).toMatchObject({
    code: 'E_BLUEPRINT_REQUIRES',
    message: 'the blueprint needs the custom object vineyard, which config does not define. Nothing was written.',
  })
})

test('the same source and version with other bytes is E_BLUEPRINT_INTEGRITY; the same bytes again is E_BLUEPRINT_ADDED', async () => {
  const dir = orchard()
  const path = source(dir, '1.0.0')
  expect((await run(dir, path)).exitCode).toBe(0)
  const again = await refused(dir, path)
  expect(again.exitCode).toBe(1)
  expect(again.env.issues[0]).toMatchObject({
    code: 'E_BLUEPRINT_ADDED',
    message: 'acme/renewals is already in kalup/blueprints.lock.json, at version 1.0.0. Nothing was written.',
    fix: `to move to this version, run kalup blueprint upgrade acme/renewals ${path}`,
  })
  writeFileSync(join(dir, path), blueprintText('1.0.0').replace('"Renewal date"', '"Renewal day"'))
  const changed = await refused(dir, path)
  expect(changed.exitCode).toBe(1)
  expect(changed.env.issues[0]?.code).toBe('E_BLUEPRINT_INTEGRITY')
  expect(changed.env.issues[0]?.message).toMatch(integrity)
})

test('a binding key another property of the object uses is the loader E_DUPLICATE_KEY on the candidate, exit 3', async () => {
  const dir = orchard()
  mkdirSync(join(dir, 'kalup/objects'), { recursive: true })
  writeFileSync(
    join(dir, deals),
    DEALS.replace("    renewalDate: p.date('renewal_date'", "    renewalDate: p.date('close_on'"),
  )
  edit(dir, config, '    companies: {},', '    companies: {},\n    deals: {},')
  const out = await refused(dir, source(dir, '1.0.0'))
  expect(out.exitCode).toBe(3)
  expect(out.env.issues[0]?.code).toBe('E_DUPLICATE_KEY')
  expect(out.env.issues[0]?.message).toContain('(as add would leave the project; nothing was written)')
})

test('a blueprint that is not one is E_BLUEPRINT_SCHEMA, exit 1, its text sanitized', async () => {
  const dir = orchard()
  const hs = variant(dir, (b) => {
    const resources = b.resources as Resources
    resources['property:deals/hs_renewal_flag'] = resources[renewalDate] as Resources[string]
  })
  const out = await refused(dir, hs)
  expect(out.exitCode).toBe(1)
  expect(out.env.issues[0]).toMatchObject({
    code: 'E_BLUEPRINT_SCHEMA',
    message: "property name 'hs_renewal_flag' starts with hs_, the prefix HubSpot uses for its own names",
  })
  const coloured = variant(dir, (b) => Object.assign(b, { irVersion: 2, name: 'acme/\u001b[31mred' }), 'escape.json')
  const escaped = await refused(dir, coloured)
  expect(escaped.env.issues.map((i) => i.message)).toContain('expected 1')
  expect(escaped.stdout).not.toContain('\\u001b')
  writeFileSync(join(dir, 'broken.json'), '{ "blueprintVersion": 1, ')
  expect((await refused(dir, 'broken.json')).env.issues[0]).toMatchObject({
    code: 'E_BLUEPRINT_SCHEMA',
    message: 'the blueprint is not JSON',
  })
})

test('a lock that is not one stops add with E_BLUEPRINT_LOCK, exit 3', async () => {
  const dir = orchard()
  writeFileSync(join(dir, lockFile), '{ "lockVersion": 2 }\n')
  const out = await refused(dir, source(dir, '1.0.0'))
  expect(out.exitCode).toBe(3)
  expect(out.env.issues[0]).toMatchObject({ code: 'E_BLUEPRINT_LOCK', file: lockFile })
})

test('an https source is fetched once, with no key, and its bytes are stored as the original', async () => {
  const dir = orchard()
  const url = 'https://blueprints.example.com/acme/renewals-1.0.0.json'
  const guard = noHubSpot({ [url]: () => new Response(blueprintText('1.0.0')) })
  const out = await cli(dir, 'add', url, '--json')
  expect(out.exitCode, out.stdout).toBe(0)
  expect(guard.urls).toEqual([url])
  expect(text(dir, original('1.0.0'))).toBe(blueprintText('1.0.0'))
  expect(JSON.parse(text(dir, lockFile)).sources).toEqual({ [`${url}@1.0.0`]: expect.stringMatching(hash) })
})

test('a source that is neither a file nor an https URL is E_BLUEPRINT_SOURCE', async () => {
  const dir = orchard()
  const cases = [
    ['http://blueprints.example.com/renewals.json', 'is not an https URL; Kalup fetches blueprints over https only'],
    ['acme/renewals#v1', 'there is no file at acme/renewals#v1; a source is a path or an https:// URL'],
  ] as const
  const runs = await Promise.all(cases.map(([given]) => refused(dir, given)))
  for (const [index, out] of runs.entries()) {
    expect(out.exitCode).toBe(1)
    expect(out.env.issues[0]?.code).toBe('E_BLUEPRINT_SOURCE')
    expect(out.env.issues[0]?.message).toContain(cases[index]?.[1])
  }
})

const flags: Flags = {
  check: false,
  discover: false,
  dryRun: false,
  exitCode: false,
  release: false,
  write: false,
  yes: false,
}

test('a failure on the second rename leaves the objects, barrel, lock, original and config as they were', async () => {
  const dir = orchard()
  const path = source(dir, '1.0.0')
  const before = projectFiles(dir)
  control.failRename = 2
  let error: unknown
  try {
    await add({ cwd: dir, args: [path], flags })
  } catch (caught) {
    error = caught
  }
  expect(error).toBeInstanceOf(KalupError)
  expect((error as KalupError).issues[0]).toMatchObject({
    code: 'E_PROJECT_WRITE',
    message: `could not write ${attributes}, ${config}, ${original('1.0.0')}, ${lockFile}, ${barrel}, ${deals} (EIO). Every file was left as it was.`,
  })
  expect((error as KalupError).exitCode).toBe(1)
  expect(control.renames).toBe(2)
  expect(projectFiles(dir)).toEqual(before)
})
