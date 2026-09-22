// kalup pull: read a target and merge it into the object files. Validate runs first, then the portal guard, then the
// read, all through read-tagged paths; nothing is written on an error, and --check and --discover write nothing.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { type ObjectFile, type ObjectScope, read, type Target, write } from '@kalup/core'
import {
  createHttp,
  exitCodes,
  guardPortal,
  type Issue,
  KalupError,
  openHistory,
  readProjectFiles,
  resolveReadKey,
  sanitize,
} from '../lib/index.js'
import {
  addressMatcher,
  type Change,
  type Counts,
  exportName,
  inScope,
  mergeObject,
  type Portal,
  readPortal,
  STANDARD_OBJECTS,
  scopeOf,
} from '../lib/pull/index.js'
import { bin } from '../usage.js'
import { usageError } from './args.js'
import { barrel } from './fmt.js'
import type { Context, Result } from './run.js'
import { check } from './validate.js'

export interface ObjectReport extends Counts {
  changes: Change[]
}

export interface PullData {
  target: string
  portalId: number
  /** Per object in scope, in config order. */
  objects: Record<string, ObjectReport>
  /** The files written, or with --check, the files that would be. */
  files: string[]
}

export interface DiscoverData {
  target: string
  portalId: number
  /** The portal's custom objects that the config does not name. */
  objects: string[]
  /** Per object in scope, the portal properties the scope leaves out. */
  properties: Record<string, string[]>
}

interface Home {
  file: string
  data: ObjectFile
  index: number
}

const BARREL = 'kalup/index.ts'

export async function pull(ctx: Context): Promise<Result<PullData | DiscoverData>> {
  const targetName = ctx.flags.target
  if (targetName === undefined) throw usageError(`${bin} pull needs --target <name>`)
  const { root, loaded, issues, warnings } = check(ctx)
  if (!loaded || issues.length > 0) throw new KalupError([...issues, ...warnings], exitCodes.invalid)
  // validate rejected an unknown target and a missing portalId above.
  const target = loaded.config.targets[targetName] as Target
  const portalId = target.portalId as number
  const { key, variable } = resolveReadKey(target, root)
  const http = createHttp({ key, warn: (message) => warnings.push({ code: 'W_RATE_LIMIT', message }) })
  await guardPortal(http, { name: targetName, portalId, variable })
  const portal = await readPortal(http, loaded.config, target, warnings, {
    schemas: ctx.flags.discover,
    configLines: loaded.configLines,
  })
  if (ctx.flags.discover) return discover(targetName, portalId, loaded.config.objects, portal, warnings)

  const files = readProjectFiles(root)
  const parsed = objectFiles(files)
  const only = addressMatcher(ctx.flags.only)
  const next = { ...files }
  const objects: Record<string, ObjectReport> = {}
  for (const live of portal.objects) {
    const scope = loaded.config.objects[live.object] ?? {}
    const home = findHome(parsed, live.object)
    const merged = mergeObject({
      live,
      scope: scopeOf(scope),
      local: home?.data.exports[home.index],
      fresh: {
        name: scope.as ?? exportName(live.object),
        builder: STANDARD_OBJECTS.has(live.object) ? 'defineObject' : 'defineCustomObject',
      },
      only,
    })
    warnings.push(...merged.issues)
    objects[live.object] = { ...merged.counts, changes: merged.changes }
    // An object with no file yet and nothing added (--only left it out) gets no empty file.
    if (!home && merged.counts.added === 0) continue
    const file = home?.file ?? `kalup/objects/${live.object}.ts`
    const data: ObjectFile = home
      ? { ...home.data, exports: home.data.exports.map((e, i) => (i === home.index ? merged.export : e)) }
      : { imports: [], exports: [merged.export] }
    parsed.set(file, data)
    next[file] = write('object', data)
  }
  const index = barrel(next)
  if (index !== undefined) next[BARREL] = index
  const changed = Object.keys(next)
    .filter((file) => next[file] !== files[file])
    .sort()
  if (!ctx.flags.check) {
    const history = openHistory(root)
    for (const file of changed) {
      history.save(file)
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), next[file] ?? '')
    }
  }
  const data: PullData = { target: targetName, portalId, objects, files: changed }
  const pending = ctx.flags.check && ctx.flags.exitCode && changed.length > 0
  return {
    data,
    issues: warnings,
    text: summary(data, ctx.flags.check),
    exitCode: pending ? exitCodes.differences : exitCodes.done,
  }
}

// Every object file of the project, parsed. The loader accepted them all, so read() cannot throw here.
function objectFiles(files: Record<string, string>): Map<string, ObjectFile> {
  const out = new Map<string, ObjectFile>()
  for (const [file, text] of Object.entries(files)) {
    if (!file.startsWith('kalup/') || file === BARREL) continue
    const result = read(text, file)
    if (result.kind === 'object') out.set(file, result.data)
  }
  return out
}

// The file and export that hold an object today. The loader rejects duplicates, so there is at most one.
function findHome(parsed: Map<string, ObjectFile>, object: string): Home | undefined {
  for (const [file, data] of parsed) {
    const index = data.exports.findIndex((e) => e.object === object)
    if (index >= 0) return { file, data, index }
  }
  return undefined
}

const LABELS: Record<Change['kind'], string> = {
  added: 'added',
  changed: 'changed',
  missing: 'missing in portal',
  'local-only': 'only in config',
  'out-of-scope': 'out of scope, not refreshed',
}

function summary(data: PullData, check: boolean): string {
  const lines: string[] = []
  for (const [object, report] of Object.entries(data.objects)) {
    const { added, changed, unchanged, missing } = report
    lines.push(`${object}: ${added} added, ${changed} changed, ${unchanged} unchanged, ${missing} missing in portal`)
    for (const c of report.changes) {
      const where = c.field === undefined ? c.address : `${c.address}#${c.field}`
      const diff = c.kind === 'changed' && c.field !== undefined ? ` ${show(c.before)} -> ${show(c.after)}` : ''
      lines.push(`  ${LABELS[c.kind]}: ${where}${diff}`)
    }
  }
  const verb = check ? 'would write' : 'wrote'
  lines.push(...(data.files.length > 0 ? data.files.map((file) => `${verb} ${file}`) : ['Files are up to date']))
  return `${lines.join('\n')}\n`
}

function show(value: unknown): string {
  return value === undefined ? 'none' : JSON.stringify(value)
}

function discover(
  target: string,
  portalId: number,
  scopes: Record<string, ObjectScope>,
  portal: Portal,
  warnings: Issue[],
): Result<DiscoverData> {
  const lines: string[] = []
  const objects = portal.otherObjects.map((name) => sanitize(name))
  for (const name of objects) lines.push(`  object:${name}  (custom object; add ${name}: {} under objects)`)
  const properties: Record<string, string[]> = {}
  for (const live of portal.objects) {
    const scope = scopeOf(scopes[live.object])
    const outside = live.properties.filter((p) => !inScope(scope, p)).sort((a, b) => (a.name < b.name ? -1 : 1))
    if (outside.length === 0) continue
    properties[live.object] = outside.map((p) => sanitize(p.name))
    for (const p of outside) {
      const why = p.hubspotDefined
        ? `HubSpot-defined; add '${sanitize(p.name)}' to objects.${live.object}.include`
        : `custom; set objects.${live.object}.custom to true`
      lines.push(`  property:${live.object}/${sanitize(p.name)}  (${why})`)
    }
  }
  const head =
    lines.length > 0
      ? `Outside the pull scope of target ${target} (portal ${portalId}):`
      : `Everything the portal holds for target ${target} is in the pull scope.`
  return {
    data: { target, portalId, objects, properties },
    issues: warnings,
    text: `${[head, ...lines, 'Nothing written.'].join('\n')}\n`,
  }
}
