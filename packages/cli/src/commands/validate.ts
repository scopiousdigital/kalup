// kalup validate: load, run core's validate rules and the CLI's own, report. Exit 3 on any issue, 0 when there are
// only warnings.
import { IssueError, type Loaded, validate as validateProject } from '@kalup/core'
import { findRoot, load } from '../lib/load.js'
import { exitCodes, type Issue } from '../lib/output.js'
import { STANDARD_OBJECTS } from '../lib/pull/scope.js'
import type { Context, Result } from './context.js'

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
    const { issues, warnings } = validateProject(loaded, { target: ctx.flags.target })
    return { root, loaded, issues: [...issues, ...standardObjects(loaded)], warnings }
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

// HubSpot has no custom object schema under a standard object's name, so a read never finds one there. Core does not
// know the standard objects; the pull scope does.
function standardObjects({ ir, sources }: Loaded): Issue[] {
  return Object.keys(ir.resources)
    .filter((address) => address.startsWith('object:') && STANDARD_OBJECTS.has(address.slice('object:'.length)))
    .map((address) => {
      const key = address.slice('object:'.length)
      return {
        code: 'E_STANDARD_OBJECT',
        message: `'${key}' is a standard object in HubSpot, so defineCustomObject cannot define it`,
        ...sources[address],
        fix: `use defineObject('${key}', ...) without labels and the display properties, or name the custom object differently`,
      }
    })
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}
