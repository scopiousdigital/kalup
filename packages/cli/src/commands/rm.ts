// kalup rm <address> [--release]: take a property, group, pipeline or stage out of config and write its tombstone in
// <dir>/removed.ts. A pipeline goes with its stages; a pipeline file left with no export is deleted.
// Offline: it never reads a key, sends a request or touches state. The candidate project is validated before
// anything is written, and the files go through one staged write, so the project is never half-rewritten.
import type { Tombstone } from '@kalup/core'
import {
  type Address,
  bin,
  exitCodes,
  type IRResource,
  isAddress,
  KalupError,
  type Loaded,
  nameOf,
  objectOf,
  parseAddress,
  REMOVABLE,
  type RemovedFile,
  read,
  sanitize,
  selectTarget,
  shellWord,
  targetFlag,
  write,
} from '@kalup/engine'
import { readProjectFiles } from '../lib/load.js'
import type { Issue } from '../lib/output.js'
import { writeStaged } from '../lib/staged.js'
import type { Context, Result } from './context.js'
import { usageError } from './context.js'
import { barrel } from './fmt.js'
import { candidateIssues } from './pull.js'
import { check } from './validate.js'

export interface RmData {
  action: Tombstone['action']
  address: Address
  /** The files written, sorted. Empty when the tombstone already said this. */
  files: string[]
  /** The object file the resource was taken out of. Absent for an address config does not define. */
  from?: string
  /** The action the tombstone had before, when the address was already tombstoned. */
  previous?: Tombstone['action']
}

export function rm(ctx: Context): Result<RmData> {
  const [given] = ctx.args
  if (given === undefined) {
    throw usageError('missing argument ADDRESS')
  }
  const address = checkAddress(given)
  const action: Tombstone['action'] = ctx.flags.release ? 'release' : 'destroy'
  const { root, loaded, issues, warnings } = check({ ...ctx, flags: { ...ctx.flags, target: undefined } })
  if (!loaded || issues.length > 0) {
    throw new KalupError([...issues, ...warnings], exitCodes.invalid)
  }
  const resource = Object.hasOwn(loaded.ir.resources, address) ? loaded.ir.resources[address] : undefined
  if (resource) {
    refuse(loaded, address, resource, action)
  }
  const { layout } = loaded
  const files = readProjectFiles(root, layout)
  const tombstones = removedFile(files[layout.removed], layout.removed)
  const previous = Object.hasOwn(tombstones.tombstones, address) ? tombstones.tombstones[address] : undefined
  if (previous?.action === action) {
    const data: RmData = { address, action, files: [], previous: action }
    return { data, issues: warnings, text: summary(data, planCommand(loaded), layout.removed) }
  }
  const next: Record<string, string> = { ...files }
  const from = resource ? takeOut(next, loaded, address) : undefined
  tombstones.tombstones = { ...tombstones.tombstones, [address]: { ...previous, action } }
  next[layout.removed] = write('removed', tombstones)
  const index = barrel(next, layout)
  if (index !== undefined) {
    next[layout.barrel] = index
  }
  // The loader accepted the project as it is, so an issue here is one the removal makes.
  const invalid = candidateIssues(next, layout)
  if (invalid.length > 0) {
    const after = ` (as rm ${address} would leave it; nothing was written)`
    throw new KalupError(
      invalid.map((issue) => ({ ...issue, message: `${issue.message}${after}` })),
      exitCodes.invalid,
    )
  }
  // A file takeOut emptied is gone from `next`: deleted.
  const changed = [...new Set([...Object.keys(next), ...Object.keys(files)])].filter(
    (file) => next[file] !== files[file],
  )
  const written = writeStaged(root, Object.fromEntries(changed.map((file) => [file, next[file] ?? null])))
  const data: RmData = {
    address,
    action,
    files: written,
    ...(from === undefined ? {} : { from }),
    ...(previous === undefined ? {} : { previous: previous.action }),
  }
  return { data, issues: warnings, text: summary(data, planCommand(loaded), layout.removed) }
}

// A property, group, pipeline or stage address; anything else is E_TOMBSTONE_ADDRESS, as the same key in the file is.
function checkAddress(given: string): Address {
  const at = {
    fix: "pass the address of a property, group, pipeline or stage, such as 'property:companies/legacy_score'",
  }
  if (!isAddress(given)) {
    throw invalidAddress({ message: `'${sanitize(given)}' is not an address`, ...at })
  }
  const { type, path } = parseAddress(given)
  const shape = Object.hasOwn(REMOVABLE, type) ? REMOVABLE[type] : undefined
  if (!shape) {
    const message = `cannot remove ${sanitize(given)}: this version removes properties, groups, pipelines and stages only`
    throw invalidAddress({ message, fix: 'custom objects are not removed or released in this release' })
  }
  if (!shape.path.test(path)) {
    throw invalidAddress({ message: `'${sanitize(given)}' is not of the form ${shape.form}`, ...at })
  }
  return given
}

function invalidAddress(issue: Omit<Issue, 'code'>): KalupError {
  return new KalupError({ code: 'E_TOMBSTONE_ADDRESS', ...issue }, exitCodes.invalid)
}

// preventDestroy refuses a destroy; a group config properties use, or a property a custom object schema in config
// names, cannot leave config at all.
function refuse(loaded: Loaded, address: Address, resource: IRResource, action: Tombstone['action']): void {
  if (action === 'destroy' && resource.lifecycle?.preventDestroy === true) {
    throw new KalupError(
      {
        code: 'E_PREVENT_DESTROY',
        message: `${address} sets lifecycle.preventDestroy, so rm does not write a destroy tombstone for it. Nothing was written.`,
        ...loaded.sources[address],
        fix: `remove preventDestroy from its lifecycle first, or run ${bin} rm ${shellWord(address)} --release to stop managing it and leave it in HubSpot`,
      },
      exitCodes.invalid,
    )
  }
  const users = dependents(loaded, address)
  if (users.length > 0) {
    const noun = parseAddress(address).type === 'group' ? 'properties in config use it' : 'config names it'
    throw new KalupError(
      {
        code: 'E_RM_DEPENDENTS',
        message: `${address} cannot leave config while ${noun}: ${users.join(', ')}. Nothing was written.`,
        ...loaded.sources[address],
        fix: 'remove or change those first, then run rm again',
      },
      exitCodes.invalid,
    )
  }
}

// A group's config properties; a property's custom object schema, when it names the property as a display property,
// a required property or a searchable one. Nothing for a pipeline or a stage.
function dependents(loaded: Loaded, address: Address): string[] {
  const { resources } = loaded.ir
  const key = objectOf(address)
  const { type } = parseAddress(address)
  // A pipeline goes with its stages, and validate refuses a pipeline left without one.
  if (type === 'pipeline' || type === 'stage') {
    return []
  }
  if (type === 'group') {
    return Object.entries(resources)
      .filter(
        ([, r]) => r.type === 'property' && (r.definition?.group as { $ref?: string } | undefined)?.$ref === address,
      )
      .map(([a]) => a)
      .sort()
  }
  const schema = Object.hasOwn(resources, `object:${key}`) ? resources[`object:${key}`] : undefined
  const d = schema?.definition ?? {}
  const names = [
    d.primaryDisplayProperty,
    d.requiredProperties,
    d.searchableProperties,
    d.secondaryDisplayProperties,
  ].flat()
  return names.includes(nameOf(address)) ? [`object:${key}`] : []
}

// Takes the resource out of the export that defines it: the property, or the group entry. An object may be split
// across exports and files, so the loader's source names the file and the export. The file it was in.
function takeOut(files: Record<string, string>, loaded: Loaded, address: Address): string | undefined {
  const source = loaded.sources[address]
  const text = source === undefined ? undefined : files[source.file]
  if (source === undefined || text === undefined) {
    return undefined
  }
  const { type } = parseAddress(address)
  if (type === 'pipeline' || type === 'stage') {
    return takeOutPipeline(files, source, text)
  }
  const result = read(text, source.file)
  if (result.kind !== 'object') {
    return undefined
  }
  // configPath is `<export>.properties.<key>` or `<export>.groups.<name>`.
  const [owner] = source.configPath.split('.')
  const name = nameOf(address)
  const isGroup = parseAddress(address).type === 'group'
  const exports = result.data.exports.map((e) => {
    if (e.name !== owner) {
      return e
    }
    return isGroup
      ? { ...e, groups: e.groups.filter((g) => g.name !== name) }
      : { ...e, properties: e.properties.filter((p) => p.name !== name) }
  })
  files[source.file] = write('object', { ...result.data, exports })
  return source.file
}

// Takes a pipeline export, or one stage of it, out of its pipeline file; a file left with no export goes. The
// configPath is `<export>` for a pipeline and `<export>.stages.<key>` for a stage.
function takeOutPipeline(
  files: Record<string, string>,
  source: NonNullable<Loaded['sources'][string]>,
  text: string,
): string | undefined {
  const result = read(text, source.file, 'pipeline')
  if (result.kind !== 'pipeline') {
    return undefined
  }
  const [owner, , key] = source.configPath.split('.')
  const exports =
    key === undefined
      ? result.data.exports.filter((e) => e.name !== owner)
      : result.data.exports.map((e) =>
          e.name === owner ? { ...e, stages: e.stages.filter((st) => st.key !== key) } : e,
        )
  if (exports.length === 0) {
    delete files[source.file]
  } else {
    files[source.file] = write('pipeline', { ...result.data, exports })
  }
  return source.file
}

// removed.ts as data, or a new one. The loader accepted the project, so reading it cannot fail.
function removedFile(text: string | undefined, file: string): RemovedFile {
  if (text === undefined) {
    return { imports: [], tombstones: {} }
  }
  const result = read(text, file, 'removed')
  return result.kind === 'removed' ? result.data : { imports: [], tombstones: {} }
}

// `kalup plan` with the target a plan would pick without a flag, or a placeholder when it would ask.
function planCommand(loaded: Loaded): string {
  const selection = selectTarget(loaded.config)
  const target = selection.status === 'selected' ? targetFlag(selection.name) : '--target <name>'
  return `${bin} plan ${target}`
}

function summary(data: RmData, plan: string, removed: string): string {
  const { address, action, from, previous } = data
  const lines: string[] = []
  if (from !== undefined) {
    lines.push(`Removed ${address} from ${from}.`)
  }
  if (previous === action) {
    lines.push(`${address} already has a ${action} tombstone in ${removed}. Nothing was written.`)
  } else if (previous === undefined) {
    lines.push(`Wrote a ${action} tombstone for ${address} to ${removed}.`)
  } else {
    lines.push(`Changed the tombstone for ${address} in ${removed} from ${previous} to ${action}.`)
  }
  if (action === 'release') {
    lines.push(
      'Kalup stops managing it; the portal keeps it, and pull no longer brings it back.',
      `Next: ${plan} shows the release, which sends nothing to HubSpot.`,
    )
  } else {
    lines.push(
      `Next: ${plan} shows the delete. It runs only when the target sets allowDestroy: true and a person confirms it at a terminal.`,
    )
  }
  return `${lines.join('\n')}\n`
}
