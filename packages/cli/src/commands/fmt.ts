// kalup fmt: validate, then write kalup.config.ts, every object file and the barrel back in canonical form, through
// history. Validate runs first, as in every command, so a file the loader rejects (or a later-milestone file) is exit 3
// before anything is written and no half-formatted project is left behind. --check writes nothing.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type BarrelEntry, read, write } from '@kalup/core'
import { openHistory } from '../lib/history.js'
import { readProjectFiles } from '../lib/load.js'
import { exitCodes, KalupError } from '../lib/output.js'
import type { Context, Result } from './run.js'
import { check } from './validate.js'

export interface FmtData {
  /** The files that were rewritten, or with --check, would be. */
  changed: string[]
}

const BARREL = 'kalup/index.ts'

export function fmt(ctx: Context): Result<FmtData> {
  const { root, issues, warnings } = check(ctx)
  if (issues.length > 0) {
    throw new KalupError([...issues, ...warnings], exitCodes.invalid)
  }
  const files = readProjectFiles(root)
  const changed = canonical(files).filter(([file, next]) => next !== files[file])
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
  const pending = ctx.flags.check && ctx.flags.exitCode && names.length > 0
  return {
    data: { changed: names },
    issues: warnings,
    text,
    exitCode: pending ? exitCodes.differences : exitCodes.done,
  }
}

/**
 * The canonical text of every file of a project the loader accepted, in path order: kalup.config.ts, each object file,
 * and the barrel re-exporting every object. The barrel is left out when there is no object file to re-export.
 */
export function canonical(files: Record<string, string>): [file: string, text: string][] {
  const out: [string, string][] = []
  const entries: BarrelEntry[] = []
  for (const [file, text] of Object.entries(files)) {
    if (file === BARREL) {
      continue
    }
    const result = read(text, file)
    if (result.kind === 'config') {
      out.push([file, write('config', result.data)])
      continue
    }
    out.push([file, write('object', result.data)])
    const from = `./${file.slice('kalup/'.length, -'.ts'.length)}`
    for (const e of result.data.exports) {
      entries.push({ name: e.name, from })
    }
  }
  if (entries.length > 0) {
    out.push([BARREL, write('barrel', entries)])
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
export function barrel(files: Record<string, string>): string | undefined {
  return canonical(files).find(([file]) => file === BARREL)?.[1]
}
