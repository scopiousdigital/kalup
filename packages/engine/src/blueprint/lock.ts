// <dir>/blueprints.lock.json: blueprints-lock-1.schema.json, then the rules that keep the lock and the stored originals
// consistent. The loader reads it to merge provenance into the IR; every issue is E_BLUEPRINT_LOCK.
import lockSchema from '../../schemas/blueprints-lock-1.schema.json' with { type: 'json' }
import { IssueError } from '../grammar/types.js'
import type { Issue } from '../ir/types.js'
import { type JsonSchema, validateSchema } from '../ir/validate.js'
import type { Layout } from '../loader/layout.js'
import type { BlueprintLock } from './types.js'

// TypeScript gives heterogeneous JSON arrays `?: undefined` members, so the literal type does not fit JsonSchema.
const SCHEMA = lockSchema as unknown as JsonSchema

/**
 * The stored original of a blueprint version: <dir>/.blueprints/<name with / as -->@<version>.json. A name segment
 * never holds `--`, so two names never share a file.
 */
export function originalPath(at: Layout, name: string, version: string): string {
  return `${at.dir}/.blueprints/${name.replace('/', '--')}@${version}.json`
}

/** Checks a document against blueprints-lock-1.schema.json, then the lock's own rules. Empty when it is a lock. */
export function validateLock(document: unknown, at: Layout): Issue[] {
  const schema = validateSchema(SCHEMA, document).map(({ path, message }) => issue(at, path, message))
  return schema.length > 0 ? schema : rules(document as BlueprintLock, at)
}

/**
 * The lock in `text`. Throws an IssueError, every issue E_BLUEPRINT_LOCK, when it is not JSON, another lock version, or
 * not a lock.
 */
export function parseLock(text: string, at: Layout): BlueprintLock {
  const document = parseJson(text)
  if (document === notJson) {
    throw new IssueError([issue(at, '', 'the lock is not JSON')])
  }
  // Another version of kalup wrote another lock version, which may be shaped in any way: only its version is read.
  const version = (document as { lockVersion?: unknown } | null)?.lockVersion
  if (typeof version === 'number' && version !== 1) {
    throw new IssueError([
      {
        ...issue(
          at,
          'lockVersion',
          `the lock is blueprints-lock/${version}, and this version of kalup reads blueprints-lock/1`,
        ),
        fix: 'use the version of kalup that wrote it, or a newer one',
      },
    ])
  }
  const issues = validateLock(document, at)
  if (issues.length > 0) {
    throw new IssueError(issues)
  }
  return document as BlueprintLock
}

const notJson = Symbol('not JSON')

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return notJson
  }
}

function issue(at: Layout, configPath: string, message: string, fix = restore(at)): Issue {
  return { code: 'E_BLUEPRINT_LOCK', message, file: at.lock, ...(configPath ? { configPath } : {}), fix }
}

function restore(at: Layout): string {
  return `restore ${at.lock} from git: kalup add and kalup blueprint upgrade write it, never a person`
}

// The original is where the version says, the source and version are in sources with the same hash, one local address
// belongs to one blueprint, and a held unit is on an address the blueprint provides. The original's path is fixed, so
// an edited lock cannot point an upgrade at another file to read or remove.
function rules(lock: BlueprintLock, at: Layout): Issue[] {
  const issues: Issue[] = []
  const owners = new Map<string, string>()
  for (const [name, entry] of Object.entries(lock.blueprints)) {
    const path = `blueprints.${name}`
    const original = originalPath(at, name, entry.version)
    if (entry.original !== original) {
      const message = `the original of ${name} ${entry.version} is ${original}`
      issues.push(issue(at, `${path}.original`, message, movedFix(at, entry.original, original) ?? restore(at)))
    }
    const key = `${entry.source}@${entry.version}`
    const recorded = Object.hasOwn(lock.sources, key) ? lock.sources[key] : undefined
    if (recorded !== entry.hash) {
      issues.push(issue(at, `${path}.hash`, `sources does not record ${key} with the hash of ${name}`))
    }
    for (const address of Object.keys(entry.resources)) {
      const first = owners.get(address)
      if (first === undefined) {
        owners.set(address, name)
      } else {
        issues.push(issue(at, `${path}.resources`, `${address} is listed by two blueprints: ${first} and ${name}`))
      }
    }
    for (const [index, held] of entry.held.entries()) {
      if (!Object.hasOwn(entry.resources, held.address)) {
        issues.push(issue(at, `${path}.held[${index}]`, `${held.address} is held but not listed under resources`))
      }
    }
  }
  return issues
}

// The fix for an original under another folder's .blueprints/: a lock whose folder moved, such as a 0.1 kalup/ renamed
// to hubspot/. Undefined for any other path.
function movedFix(at: Layout, stated: string, original: string): string | undefined {
  const suffix = original.slice(at.dir.length)
  if (!stated.endsWith(suffix) || stated.length === suffix.length) {
    return undefined
  }
  const from = `${stated.slice(0, -suffix.length)}/.blueprints/`
  return `the folder of object files moved: in ${at.lock}, replace ${from} with ${at.dir}/.blueprints/`
}
