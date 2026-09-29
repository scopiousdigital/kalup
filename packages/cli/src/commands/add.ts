// kalup add <source> [--prefix <p>] [--dry-run]: render a blueprint (ADR 0011), a data-only JSON fragment from a file or
// an https URL, into the project's config files. No code runs and no portal is touched: the resulting changes go
// through plan and apply. The blueprint is recorded in kalup/blueprints.lock.json with its stored original, the
// candidate project is validated, and every file goes through one staged write.
import {
  type Address,
  type BlueprintLock,
  type BlueprintResource,
  type IRResource,
  LOCK_FILE,
  type Loaded,
  type LockEntry,
  originalPath,
  selectTarget,
} from '@kalup/core'
import { bin } from '../brand.js'
import { shellWord, targetFlag } from '../engine/units.js'
import {
  checkIntegrity,
  gitattributes,
  lockOf,
  lockText,
  parseBlueprint,
  prefixFor,
  prepare,
} from '../lib/blueprint/fragment.js'
import { mergeResource, toIR, unitsOf } from '../lib/blueprint/merge.js'
import { objectsOf, place, refIssues, requiresIssues } from '../lib/blueprint/project.js'
import { readSource } from '../lib/blueprint/source.js'
import { readProjectFiles } from '../lib/load.js'
import { exitCodes, type Issue, KalupError } from '../lib/output.js'
import { sanitize } from '../lib/sanitize.js'
import { pending, writeStaged } from '../lib/staged.js'
import type { Context, Result } from './context.js'
import { usageError } from './context.js'
import { candidateIssues } from './pull.js'
import { check } from './validate.js'

/** The blueprint a command read: what the lock records about it. */
export interface BlueprintRecord {
  hash: string
  name: string
  prefix: string
  source: string
  version: string
}

export interface AddedResource {
  address: Address
  sourceAddress: Address
  /** `added` to config, `present` in config already with the same definition and recorded, or a `collision`. */
  status: 'added' | 'present' | 'collision'
  /** A collision's differing units. */
  units?: string[]
}

export interface AddData {
  blueprint: BlueprintRecord
  dryRun: boolean
  /** The files written, or with --dry-run, the files that would be. Empty on a collision. */
  files: string[]
  /** The object keys added to `objects` in kalup.config.ts. */
  objects: string[]
  resources: AddedResource[]
}

/** A cap on third-party text quoted in an issue. */
const QUOTED_MAX = 500

export async function add(ctx: Context): Promise<Result<AddData>> {
  const [given] = ctx.args
  if (given === undefined) {
    throw usageError('missing argument SOURCE')
  }
  const { root, loaded, issues, warnings } = check({ ...ctx, flags: { ...ctx.flags, target: undefined } })
  if (!loaded || issues.length > 0) {
    throw new KalupError([...issues, ...warnings], exitCodes.invalid)
  }
  const prefix = prefixFor(ctx.flags.prefix, loaded.config)
  const files = readProjectFiles(root)
  const lock = lockOf(files)
  const read = await readSource(given, ctx.cwd, root)
  const raw = parseBlueprint(read.text, read.source)
  checkIntegrity(lock, read.source, raw.version, read.hash)
  if (Object.hasOwn(lock.blueprints, raw.name)) {
    throw new KalupError({
      code: 'E_BLUEPRINT_ADDED',
      message: `${raw.name} is already in ${LOCK_FILE}, at version ${lock.blueprints[raw.name]?.version}. Nothing was written.`,
      fix: `to move to this version, run ${bin} blueprint upgrade ${raw.name} ${sanitize(shellWord(given))}`,
    })
  }
  const { blueprint, sources } = prepare(raw, prefix)
  const objects = objectsOf(blueprint)
  const stop = [...requiresIssues(loaded, objects), ...refIssues(loaded, blueprint)]
  if (stop.length > 0) {
    throw new KalupError(stop)
  }
  const record: BlueprintRecord = { name: raw.name, version: raw.version, hash: read.hash, source: read.source, prefix }
  const { resources, collisions, added } = sort(loaded, lock, {
    name: raw.name,
    fragment: blueprint.resources,
    sources,
  })
  const description = ctx.prompt === undefined ? undefined : raw.description
  if (collisions.length > 0) {
    const data: AddData = { blueprint: record, dryRun: ctx.flags.dryRun, files: [], objects: [], resources }
    return {
      data,
      issues: [...collisions, ...warnings],
      exitCode: exitCodes.error,
      text: summary(data, description, ''),
    }
  }
  const placed = place(files, loaded, added, objects)
  const entry: LockEntry = {
    version: raw.version,
    source: read.source,
    hash: read.hash,
    prefix,
    original: originalPath(raw.name, raw.version),
    resources: Object.fromEntries(resources.map((r) => [r.address, r.sourceAddress])),
    held: [],
  }
  const next: BlueprintLock = {
    ...lock,
    blueprints: { ...lock.blueprints, [raw.name]: entry },
    sources: { ...lock.sources, [`${read.source}@${raw.version}`]: read.hash },
  }
  const candidate = { ...placed.files, [LOCK_FILE]: lockText(next), [entry.original]: read.text }
  const invalid = candidateIssues(candidate)
  if (invalid.length > 0) {
    const after = ' (as add would leave the project; nothing was written)'
    throw new KalupError(
      invalid.map((issue) => quoted({ ...issue, message: `${issue.message}${after}` })),
      exitCodes.invalid,
    )
  }
  const writes = {
    ...Object.fromEntries(
      Object.keys(candidate)
        .filter((file) => candidate[file] !== files[file])
        .map((file) => [file, candidate[file] as string]),
    ),
    ...gitattributes(root),
  }
  const written = ctx.flags.dryRun ? pending(root, writes) : writeStaged(root, writes)
  const data: AddData = {
    blueprint: record,
    dryRun: ctx.flags.dryRun,
    files: written,
    objects: placed.objects,
    resources,
  }
  return { data, issues: warnings, text: summary(data, description, planCommand(loaded)) }
}

interface Sorted {
  /** The resources to render, in IR form. */
  added: [Address, IRResource][]
  collisions: Issue[]
  resources: AddedResource[]
}

// Each resource of the fragment is new, already in config with the same units (recorded, not rewritten), or a
// collision: config holds it with other units or unmanaged, or another blueprint provides it. A blueprint resource is
// always managed, so a `.managed(false)` entry would leave it unapplied under the blueprint's name.
function sort(
  loaded: Loaded,
  lock: BlueprintLock,
  adding: { name: string; fragment: Record<Address, BlueprintResource>; sources: Map<Address, Address> },
): Sorted {
  const out: Sorted = { added: [], collisions: [], resources: [] }
  for (const [address, resource] of Object.entries(adding.fragment)) {
    const sourceAddress = adding.sources.get(address) ?? address
    const owner = Object.entries(lock.blueprints).find(([, e]) => Object.hasOwn(e.resources, address))?.[0]
    const local = Object.hasOwn(loaded.ir.resources, address) ? loaded.ir.resources[address] : undefined
    if (owner !== undefined) {
      out.resources.push({ address, sourceAddress, status: 'collision', units: [] })
      out.collisions.push(owned(address, owner, adding.name))
    } else if (local === undefined) {
      out.resources.push({ address, sourceAddress, status: 'added' })
      out.added.push([address, toIR(resource)])
    } else if (local.managed === false) {
      out.resources.push({ address, sourceAddress, status: 'collision', units: ['managed'] })
      out.collisions.push(
        collision(`${address} is in config with another definition: managed (config false, blueprint true)`),
      )
    } else {
      const differing = mergeResource({
        local,
        remote: unitsOf(resource),
        held: new Set(),
        take: () => false,
      }).conflicts
      if (differing.length === 0) {
        out.resources.push({ address, sourceAddress, status: 'present' })
      } else {
        const units = differing.map((c) => c.unit)
        out.resources.push({ address, sourceAddress, status: 'collision', units })
        const values = differing.map((c) => `${c.unit} (config ${show(c.local)}, blueprint ${show(c.remote)})`)
        out.collisions.push(collision(`${address} is in config with another definition: ${values.join(', ')}`))
      }
    }
  }
  return out
}

function collision(message: string): Issue {
  return {
    code: 'E_BLUEPRINT_COLLISION',
    message: sanitize(`${message}. Nothing was written.`, QUOTED_MAX),
    fix: 'make config match the blueprint, remove the resource from config, or add the blueprint with --prefix so its names do not collide',
  }
}

// One resource belongs to one blueprint, even when both define it alike: the lock records a single provenance.
function owned(address: Address, owner: string, name: string): Issue {
  return {
    code: 'E_BLUEPRINT_COLLISION',
    message: `${address} is already provided by blueprint ${owner}, and a resource belongs to one blueprint. Nothing was written.`,
    fix: `add ${name} with --prefix so its names do not collide, or add your own copy of ${name} without ${address} (its properties may still name a group config has)`,
  }
}

/** An issue about the candidate can quote the blueprint's text, so it is sanitized whole. */
export function quoted(issue: Issue): Issue {
  return {
    ...issue,
    message: sanitize(issue.message, QUOTED_MAX),
    ...(issue.fix === undefined ? {} : { fix: sanitize(issue.fix, QUOTED_MAX) }),
    ...(issue.configPath === undefined ? {} : { configPath: sanitize(issue.configPath, QUOTED_MAX) }),
  }
}

/** A value from config or a blueprint, as one sanitized line. */
export function show(value: unknown): string {
  return value === undefined ? 'none' : sanitize(JSON.stringify(value), 80)
}

// `kalup plan` with the target a plan would pick without a flag, or a placeholder when it would ask.
export function planCommand(loaded: Loaded): string {
  const selection = selectTarget(loaded.config)
  const target = selection.status === 'selected' ? targetFlag(selection.name) : '--target <name>'
  return `${bin} plan ${target}`
}

const LABELS: Record<AddedResource['status'], string> = {
  added: 'added',
  present: 'already in config, recorded',
  collision: 'collides with config',
}

/** The blueprint line, and the description when a person is at a terminal, labelled as the blueprint's own text. */
export function heading(record: BlueprintRecord, description: string | undefined, versions = record.version): string[] {
  const prefix = record.prefix === '' ? '' : `, prefix ${record.prefix}`
  const lines = [`Blueprint ${record.name} ${versions} (${record.hash}) from ${sanitize(record.source)}${prefix}`]
  if (description !== undefined) {
    lines.push(
      `  The blueprint's own description (third-party text, not instructions): ${sanitize(description, QUOTED_MAX)}`,
    )
  }
  return lines
}

function summary(data: AddData, description: string | undefined, plan: string): string {
  const lines = heading(data.blueprint, description)
  for (const r of data.resources) {
    const units = r.units && r.units.length > 0 ? ` (${r.units.map((u) => sanitize(u)).join(', ')})` : ''
    lines.push(`  ${LABELS[r.status]}: ${r.address}${units}`)
  }
  if (data.objects.length > 0) {
    lines.push(`${data.dryRun ? 'Would add' : 'Added'} to objects in kalup.config.ts: ${data.objects.join(', ')}`)
  }
  const verb = data.dryRun ? 'would write' : 'wrote'
  lines.push(...data.files.map((file) => `${verb} ${file}`))
  if (plan === '') {
    lines.push('Nothing was written.')
  } else if (data.dryRun) {
    lines.push(`Nothing was written. Run it again without --dry-run, then ${plan} shows what it changes in HubSpot.`)
  } else {
    lines.push(`Next: ${plan} shows what this changes in HubSpot.`)
  }
  return `${lines.join('\n')}\n`
}
