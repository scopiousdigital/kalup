// kalup fmt: validate, then write kalup.config.ts, <dir>/removed.ts, every object and pipeline file and the barrel back
// in canonical form, through history. Validate runs first, as in every command, so a file the loader rejects is exit 3
// before anything is written and no half-formatted project is left behind. --check writes nothing and exits 2 when a
// file would change, as a CI check expects.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type BarrelEntry, barrelPath, exitCodes, KalupError, type Layout, read, write } from '@kalup/engine'
import { openHistory } from '../lib/history.js'
import { readProjectFiles } from '../lib/load.js'
import type { Context, Result } from './context.js'
import { check } from './validate.js'

export interface FmtData {
  /** The files that were rewritten, or with --check, would be. */
  changed: string[]
}

export function fmt(ctx: Context): Result<FmtData> {
  const { root, loaded, issues, warnings } = check(ctx)
  if (!loaded || issues.length > 0) {
    throw new KalupError([...issues, ...warnings], exitCodes.invalid)
  }
  const files = readProjectFiles(root, loaded.layout)
  const changed = canonical(files, loaded.layout).filter(([file, next]) => next !== files[file])
  if (!ctx.flags.check) {
    const history = openHistory(root)
    for (const [file, text] of changed) {
      history.save(file)
      writeFileSync(join(root, file), text)
    }
  }
  const names = changed.map(([file]) => file)
  const verb = ctx.flags.check ? 'would rewrite' : 'rewrote'
  const text = names.length ? `${names.map((file) => `${verb} ${file}`).join('\n')}\n` : 'All files are canonical\n'
  const pending = ctx.flags.check && names.length > 0
  return {
    data: { changed: names },
    issues: warnings,
    text,
    exitCode: pending ? exitCodes.differences : exitCodes.done,
  }
}

/**
 * The canonical text of every file of a project the loader accepted, in path order: kalup.config.ts, <dir>/removed.ts,
 * each object and pipeline file, and the barrel re-exporting every object and pipeline. The barrel is left out when there is no object file to
 * re-export. A file that is not TypeScript (the blueprints lock, a stored original) is the tool's own JSON: not here.
 */
export function canonical(files: Record<string, string>, at: Layout): [file: string, text: string][] {
  const out: [string, string][] = []
  const entries: BarrelEntry[] = []
  for (const [file, text] of Object.entries(files)) {
    if (file === at.barrel || !file.endsWith('.ts')) {
      continue
    }
    const result = read(text, file)
    if (result.kind === 'config') {
      out.push([file, write('config', result.data)])
      continue
    }
    if (result.kind === 'removed') {
      out.push([file, write('removed', result.data)])
      continue
    }
    const from = barrelPath(at, file)
    if (result.kind === 'pipeline') {
      out.push([file, write('pipeline', result.data)])
      entries.push(...result.data.exports.map((e) => ({ name: e.name, from, pipeline: true as const })))
      continue
    }
    out.push([file, write('object', result.data)])
    for (const e of result.data.exports) {
      entries.push({ name: e.name, from })
    }
  }
  if (entries.length > 0) {
    out.push([at.barrel, write('barrel', entries)])
  }
  return out.sort(([a], [b]) => byPath(a, b))
}

// Code unit order, as a sort with no comparator uses. localeCompare would follow the locale.
function byPath(a: string, b: string): number {
  if (a < b) {
    return -1
  }
  return a > b ? 1 : 0
}

/** The barrel for a project's files, as fmt writes it, or nothing when there is no object file to re-export. */
export function barrel(files: Record<string, string>, at: Layout): string | undefined {
  return canonical(files, at).find(([file]) => file === at.barrel)?.[1]
}
