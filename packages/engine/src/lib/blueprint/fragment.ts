// A blueprint as the hosts use it: parsed from the source's text (never run), checked, given its binding defaults, and
// renamed by the prefix. Also the lock rules add and upgrade share: integrity, the stored original, versions. Pure: the
// host reads the source, the stored original and .gitattributes.
import { parseLock } from '../../blueprint/lock.js'
import { applyPrefix } from '../../blueprint/prefix.js'
import type { Blueprint, BlueprintLock, LockEntry } from '../../blueprint/types.js'
import { defaultCodec, validateBlueprint } from '../../blueprint/validate.js'
import { bin } from '../../brand.js'
import type { ConfigFile } from '../../grammar/types.js'
import { stableStringify } from '../../ir/serialize.js'
import type { Address, Issue } from '../../ir/types.js'
import type { Layout } from '../../loader/layout.js'
import { KalupError } from '../errors.js'
import { camelCase } from '../pull/keys.js'
import { sanitize } from '../sanitize.js'

/** A blueprint ready to render: binding defaults filled in, the prefix applied, each address back to its source. */
export interface Prepared {
  blueprint: Blueprint
  /** Local address to the address in the blueprint. */
  sources: Map<Address, Address>
}

/** The prefix pattern. The names it makes are checked again with the prefix applied. */
const PREFIX = /^[a-z][a-z0-9_]*$/
/** A cap on third-party text quoted in an issue: above sanitize's 120, below a screenful. */
const QUOTED_MAX = 500
const EMPTY_LOCK: BlueprintLock = { lockVersion: 1, blueprints: {}, sources: {} }

/**
 * The blueprint in `text`, read from `source`: JSON, never code. Not JSON, another blueprint version, or not a
 * blueprint, is E_BLUEPRINT_SCHEMA (exit 1).
 */
export function parseBlueprint(text: string, source: string): Blueprint {
  const document = parseJson(text)
  if (document === notJson) {
    throw schemaError([{ code: 'E_BLUEPRINT_SCHEMA', message: 'the blueprint is not JSON' }])
  }
  // Another blueprint version may be shaped in any way: only its version is read.
  const format = versionOf(document)
  if (format !== undefined) {
    throw new KalupError({
      code: 'E_BLUEPRINT_SCHEMA',
      message: `${sanitize(source, QUOTED_MAX)} is blueprint/${format}, and this version of ${bin} reads blueprint/1`,
      configPath: 'blueprintVersion',
      fix: `ask the blueprint's author for a blueprint/1 version, or add it with a version of ${bin} that reads blueprint/${format}`,
    })
  }
  const issues = validateBlueprint(document)
  if (issues.length > 0) {
    throw schemaError(issues)
  }
  return document as Blueprint
}

const notJson = Symbol('not JSON')

// The blueprintVersion of a document that states another one than 1, else undefined.
function versionOf(document: unknown): number | undefined {
  const format = (document as { blueprintVersion?: unknown } | null)?.blueprintVersion
  return typeof format === 'number' && format !== 1 ? format : undefined
}

// The SyntaxError is not kept: its message quotes the third-party text.
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return notJson
  }
}

// Every issue quotes the third-party document, so each is sanitized whole.
function schemaError(issues: Issue[]): KalupError {
  return new KalupError(
    issues.map((issue) => ({
      ...issue,
      message: sanitize(issue.message, QUOTED_MAX),
      ...(issue.configPath === undefined ? {} : { configPath: sanitize(issue.configPath, QUOTED_MAX) }),
      fix: 'a blueprint is third-party data: ask its author for a version that passes, or fix your own copy of the file',
    })),
  )
}

/**
 * The blueprint with its binding defaults filled in and `prefix` applied. A property with no key gets camelCase of its
 * name before the prefix, so a prefix never changes the app's key; one with no codec gets the codec its type implies.
 * The prefixed names are checked again (E_BLUEPRINT_SCHEMA), since a prefix can make an hs_ name.
 */
export function prepare(blueprint: Blueprint, prefix: string): Prepared {
  const filled: Blueprint = {
    ...blueprint,
    resources: Object.fromEntries(
      Object.entries(blueprint.resources).map(([address, r]) => {
        if (r.type !== 'property') {
          return [address, r]
        }
        const name = address.slice(address.lastIndexOf('/') + 1)
        const binding = {
          ...r.binding,
          key: r.binding?.key ?? camelCase(name),
          codec: r.binding?.codec ?? defaultCodec(r.definition),
        }
        return [address, { ...r, binding }]
      }),
    ),
  }
  const renamed = applyPrefix(filled, prefix)
  if (prefix !== '') {
    const issues = validateBlueprint(renamed)
    if (issues.length > 0) {
      throw schemaError(issues.map((i) => ({ ...i, message: `with the prefix '${prefix}': ${i.message}` })))
    }
  }
  // applyPrefix keeps the order of the resources, so the two key lists pair up.
  const before = Object.keys(filled.resources)
  const sources = new Map(Object.keys(renamed.resources).map((address, i) => [address, before[i] as Address]))
  return { blueprint: renamed, sources }
}

/** The prefix for an add: `--prefix`, else config's `prefix`, else none. One that is not plain is E_USAGE. */
export function prefixFor(flag: string | undefined, config: ConfigFile): string {
  const prefix = flag ?? config.prefix ?? ''
  if (prefix !== '' && !PREFIX.test(prefix)) {
    const from = flag === undefined ? 'prefix in kalup.config.ts' : '--prefix'
    throw new KalupError({
      code: 'E_USAGE',
      message: `${from} '${sanitize(prefix)}' is not lowercase letters, digits and underscores starting with a letter`,
      fix: flag === undefined ? 'change prefix in kalup.config.ts, or pass --prefix' : 'pass a prefix such as acme_',
    })
  }
  return prefix
}

/** The project's lock, or an empty one. The loader validated it, so parsing cannot fail here. */
export function lockOf(files: Record<string, string>, at: Layout): BlueprintLock {
  const text = files[at.lock]
  return text === undefined ? structuredClone(EMPTY_LOCK) : parseLock(text, at)
}

/** The lock's text as the tool writes it: sorted keys, two-space indent, a final newline. */
export function lockText(lock: BlueprintLock): string {
  return `${stableStringify(lock)}\n`
}

/**
 * The integrity rule: a source and version the lock has seen with another hash is E_BLUEPRINT_INTEGRITY (exit 1),
 * naming both hashes.
 */
export function checkIntegrity(lock: BlueprintLock, source: string, version: string, hash: string): void {
  const key = `${source}@${version}`
  const recorded = Object.hasOwn(lock.sources, key) ? lock.sources[key] : undefined
  if (recorded !== undefined && recorded !== hash) {
    throw integrityError(`${sanitize(source)} version ${sanitize(version)}`, recorded, hash)
  }
}

export function integrityError(what: string, recorded: string, hash: string): KalupError {
  return new KalupError({
    code: 'E_BLUEPRINT_INTEGRITY',
    message: `${what} was recorded with ${recorded}, and the source now serves ${hash}. Nothing was written.`,
    fix: 'the same version must hold the same bytes: ask the author why it changed, and use a new version number for new content',
  })
}

/** Why the stored original of a lock entry cannot be merged against: E_BLUEPRINT_ORIGINAL (exit 1), fixed from git. */
export function originalError(name: string, entry: LockEntry, why: string): KalupError {
  return new KalupError({
    code: 'E_BLUEPRINT_ORIGINAL',
    message: `the stored original of ${name} ${entry.version}, ${entry.original}, ${why}; upgrade merges against it. Nothing was written.`,
    fix: `restore it from git, for example git checkout -- ${entry.original}, then run ${bin} blueprint upgrade again`,
  })
}

/**
 * The text of a lock entry's stored original, checked: a valid blueprint of that name and version. Anything else is
 * E_BLUEPRINT_ORIGINAL (exit 1), fixed by restoring the file from git, except another blueprint version, which the
 * version of kalup that wrote it reads. The host checks first that the file is present and holds the lock's hash.
 */
export function parseOriginal(text: string, name: string, entry: LockEntry): Blueprint {
  const document = parseJson(text)
  const format = versionOf(document)
  if (format !== undefined) {
    throw new KalupError({
      code: 'E_BLUEPRINT_ORIGINAL',
      message: `the stored original of ${name} ${entry.version}, ${entry.original}, is blueprint/${format}, and this version of ${bin} reads blueprint/1. Nothing was written.`,
      fix: `use the version of ${bin} that wrote it, or a newer one`,
    })
  }
  if (document === notJson || validateBlueprint(document).length > 0) {
    throw originalError(name, entry, 'is not a valid blueprint')
  }
  const original = document as Blueprint
  if (original.name !== name || original.version !== entry.version) {
    throw originalError(name, entry, `holds ${original.name} ${original.version}`)
  }
  return original
}

/** Semantic version precedence: negative when `a` is lower than `b`, 0 when equal, positive when higher. */
export function compareVersions(a: string, b: string): number {
  const [coreA = '', preA] = splitVersion(a)
  const [coreB = '', preB] = splitVersion(b)
  const numbers = (core: string) => core.split('.').map(Number)
  const [x, y] = [numbers(coreA), numbers(coreB)]
  for (let i = 0; i < 3; i += 1) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0)
    if (diff !== 0) {
      return diff
    }
  }
  if (preA === undefined || preB === undefined) {
    // A version without a pre-release ranks above the same version with one.
    return (preA === undefined ? 1 : 0) - (preB === undefined ? 1 : 0)
  }
  return comparePrerelease(preA.split('.'), preB.split('.'))
}

function splitVersion(version: string): [string, string | undefined] {
  const at = version.indexOf('-')
  return at === -1 ? [version, undefined] : [version.slice(0, at), version.slice(at + 1)]
}

const NUMERIC = /^[0-9]+$/

// Numeric identifiers compare as numbers and rank below alphanumeric ones; a longer list ranks above its own prefix.
function comparePrerelease(a: string[], b: string[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const [p, q] = [a[i] as string, b[i] as string]
    if (p === q) {
      continue
    }
    const [pn, qn] = [NUMERIC.test(p), NUMERIC.test(q)]
    if (pn && qn) {
      return Number(p) - Number(q)
    }
    if (pn !== qn) {
      return pn ? -1 : 1
    }
    return p < q ? -1 : 1
  }
  return a.length - b.length
}
