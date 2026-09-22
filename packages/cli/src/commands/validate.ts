// kalup validate: load, run core's validate rules, report. Exit 3 on any issue, 0 when there are only warnings.
import { IssueError, type Loaded, validate as validateProject } from '@kalup/core'
import { findRoot, load } from '../lib/load.js'
import { exitCodes, type Issue } from '../lib/output.js'
import type { Context, Result } from './run.js'

export interface ValidateData {
  counts: { errors: number; warnings: number }
  valid: boolean
}

export interface Checked {
  issues: Issue[]
  /** Absent when the loader rejected the project; its issues are then in `issues`. */
  loaded?: Loaded
  root: string
  warnings: Issue[]
}

/** Finds the project, loads it and runs the validate rules. Never throws for an invalid project. */
export function check(ctx: Context): Checked {
  const root = findRoot(ctx.cwd)
  try {
    const loaded = load(root)
    return { root, loaded, ...validateProject(loaded, { target: ctx.flags.target }) }
  } catch (error) {
    if (error instanceof IssueError) {
      return { root, issues: error.issues, warnings: [] }
    }
    throw error
  }
}

export function validate(ctx: Context): Result<ValidateData> {
  const { issues, warnings } = check(ctx)
  const valid = issues.length === 0
  const counts = { errors: issues.length, warnings: warnings.length }
  const summary = `${plural(counts.errors, 'error')}, ${plural(counts.warnings, 'warning')}`
  return {
    data: { valid, counts },
    issues: [...issues, ...warnings],
    exitCode: valid ? exitCodes.done : exitCodes.invalid,
    text: `Config ${valid ? 'valid' : 'invalid'} (${summary})\n`,
  }
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}
