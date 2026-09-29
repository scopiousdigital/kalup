// kalup/blueprints.lock.json: blueprints-lock-1.schema.json, then the rules that keep the lock and the stored originals
// consistent. The loader reads it to merge provenance into the IR; every issue is E_BLUEPRINT_LOCK.
import lockSchema from '../../schemas/blueprints-lock-1.schema.json' with { type: 'json' }
import { IssueError } from '../grammar/types.js'
import type { Issue } from '../ir/types.js'
import { type JsonSchema, validateSchema } from '../ir/validate.js'
import type { BlueprintLock } from './types.js'

/** Where the lock lives, relative to the project root. */
export const LOCK_FILE = 'kalup/blueprints.lock.json'

// TypeScript gives heterogeneous JSON arrays `?: undefined` members, so the literal type does not fit JsonSchema.
const SCHEMA = lockSchema as unknown as JsonSchema

const FIX = `restore ${LOCK_FILE} from git: kalup add and kalup blueprint upgrade write it, never a person`

/**
 * The stored original of a blueprint version: kalup/.blueprints/<name with / as -->@<version>.json. A name segment
 * never holds `--`, so two names never share a file.
 */
export function originalPath(name: string, version: string): string {
  return `kalup/.blueprints/${name.replace('/', '--')}@${version}.json`
}

/** Checks a document against blueprints-lock-1.schema.json, then the lock's own rules. Empty when it is a lock. */
export function validateLock(document: unknown): Issue[] {
  const schema = validateSchema(SCHEMA, document).map(({ path, message }) => issue(path, message))
  return schema.length > 0 ? schema : rules(document as BlueprintLock)
}

/**
 * The lock in `text`. Throws an IssueError, every issue E_BLUEPRINT_LOCK, when it is not JSON, another lock version, or
 * not a lock.
 */
export function parseLock(text: string): BlueprintLock {
  const document = parseJson(text)
  if (document === notJson) {
    throw new IssueError([issue('', 'the lock is not JSON')])
  }
  // Another version of kalup wrote another lock version, which may be shaped in any way: only its version is read.
  const version = (document as { lockVersion?: unknown } | null)?.lockVersion
  if (typeof version === 'number' && version !== 1) {
    throw new IssueError([
      {
        ...issue(
          'lockVersion',
          `the lock is blueprints-lock/${version}, and this version of kalup reads blueprints-lock/1`,
        ),
        fix: 'use the version of kalup that wrote it, or a newer one',
      },
    ])
  }
  const issues = validateLock(document)
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

function issue(configPath: string, message: string): Issue {
  return { code: 'E_BLUEPRINT_LOCK', message, file: LOCK_FILE, ...(configPath ? { configPath } : {}), fix: FIX }
}

// The original is where the version says, the source and version are in sources with the same hash, one local address
// belongs to one blueprint, and a held unit is on an address the blueprint provides. The original's path is fixed, so
// an edited lock cannot point an upgrade at another file to read or remove.
function rules(lock: BlueprintLock): Issue[] {
  const issues: Issue[] = []
  const owners = new Map<string, string>()
  for (const [name, entry] of Object.entries(lock.blueprints)) {
    const at = `blueprints.${name}`
    const original = originalPath(name, entry.version)
    if (entry.original !== original) {
      issues.push(issue(`${at}.original`, `the original of ${name} ${entry.version} is ${original}`))
    }
    const key = `${entry.source}@${entry.version}`
    const recorded = Object.hasOwn(lock.sources, key) ? lock.sources[key] : undefined
    if (recorded !== entry.hash) {
      issues.push(issue(`${at}.hash`, `sources does not record ${key} with the hash of ${name}`))
    }
    for (const address of Object.keys(entry.resources)) {
      const first = owners.get(address)
      if (first === undefined) {
        owners.set(address, name)
      } else {
        issues.push(issue(`${at}.resources`, `${address} is listed by two blueprints: ${first} and ${name}`))
      }
    }
    for (const [index, held] of entry.held.entries()) {
      if (!Object.hasOwn(entry.resources, held.address)) {
        issues.push(issue(`${at}.held[${index}]`, `${held.address} is held but not listed under resources`))
      }
    }
  }
  return issues
}
