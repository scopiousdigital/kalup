// kalup snapshot: record one read of a target as a file, an ir/1 document with an observation block. Validate runs
// first, then the portal guard, then the read, all through read-tagged paths. The snapshot is the only file it writes:
// never a config file, and never over a file that exists.
import { join } from 'node:path'
import {
  exitCodes,
  guardPortal,
  incompleteIssues,
  KalupError,
  observeTarget,
  plural,
  type Snapshot,
  sanitize,
  snapshotPath,
  snapshotText,
  toSnapshot,
} from '@kalup/engine'
import type { Context, Result } from './context.js'
import { shown, writeArgFile, wrote } from './files.js'
import { connect, resolveTarget, targetLine } from './target.js'
import { check } from './validate.js'

export interface SnapshotData {
  /** Whether every object in scope was read. */
  complete: boolean
  /** The objects read, and the groups and properties the snapshot holds. */
  counts: { groups: number; objects: number; properties: number }
  /** The file written, relative to the directory the command ran in. */
  file: string
  observedAt: string
  portalId: number
  target: string
}

export async function snapshot(ctx: Context): Promise<Result<SnapshotData>> {
  const { root, loaded, issues, warnings } = check(ctx)
  if (!loaded || issues.length > 0) {
    throw new KalupError([...issues, ...warnings], exitCodes.invalid)
  }
  const { name: target, via } = await resolveTarget(ctx, loaded.config)
  const { http, guard } = connect(root, loaded, target, warnings)
  await guardPortal(http, guard)
  const { observation, issues: read } = await observeTarget(http, loaded, target)
  const observedAt = new Date().toISOString()
  const document = toSnapshot(observation, { generator: loaded.ir.generator, observedAt, project: loaded.ir.project })
  const path = ctx.flags.out ?? join(root, snapshotPath(target, observedAt))
  const file = shown(ctx.cwd, path)
  if (!writeArgFile(ctx.cwd, path, snapshotText(document), true)) {
    throw new KalupError({
      code: 'E_SNAPSHOT',
      message: `${sanitize(file)} already exists`,
      file,
      fix: 'pass another --out, or move the file away',
    })
  }
  const { coverage } = document.observation
  const data: SnapshotData = {
    file,
    target,
    portalId: guard.portalId,
    observedAt,
    complete: coverage.complete,
    counts: countsOf(document),
  }
  // The flag names the target itself; otherwise the text says which target the rule picked.
  const text = `${via === 'flag' ? '' : targetLine(target, guard.portalId, via)}${summary(data)}`
  return { data, issues: [...warnings, ...read, ...incompleteIssues(coverage, target)], text }
}

function countsOf(document: Snapshot): SnapshotData['counts'] {
  const resources = Object.values(document.resources)
  return {
    objects: Object.values(document.observation.coverage.objects).filter((o) => o.status === 'read').length,
    groups: resources.filter((r) => r.type === 'group').length,
    properties: resources.filter((r) => r.type === 'property').length,
  }
}

function summary(data: SnapshotData): string {
  const { objects, groups, properties } = data.counts
  const held = `${plural(objects, 'object')}, ${plural(groups, 'group')}, ${plural(properties, 'property', 'properties')}`
  const head = `Snapshot of target ${sanitize(data.target)}, portal ${data.portalId}, observed at ${data.observedAt}: ${held}`
  return `${head}\n${wrote(data.file)}`
}
