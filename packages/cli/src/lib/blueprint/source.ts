// Reads a blueprint source: a path, or an https URL. This and lib/http.ts are the only modules that call fetch; a
// blueprint fetch never carries a key or any header but accept. The bytes are kept exactly as read, so the stored
// original hashes to what the lock records.
import { createHash } from 'node:crypto'
import { readFileSync, type Stats, statSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { PATH_MAX } from '../../commands/files.js'
import { KalupError } from '../output.js'
import { sanitize } from '../sanitize.js'

/** The largest blueprint Kalup reads, from a URL or a file: 1 MB. */
export const MAX_BYTES = 1_048_576
/** How long a URL fetch may take, redirects included. */
export const TIMEOUT_MS = 30_000

const MAX_REDIRECTS = 5
const REDIRECTS = new Set([301, 302, 303, 307, 308])
// A URL names its scheme and two slashes; a Windows path such as C:\blueprints does not.
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i
const SOURCE_FIX = 'pass a path to a blueprint JSON file, or an https:// URL that serves one'

export interface Read {
  /** The bytes as read. */
  bytes: Uint8Array
  /** `sha256:` and the hex digest of the bytes. */
  hash: string
  /** The source as the lock records it: the URL as given, or the path relative to the project root. */
  source: string
  /** The bytes as UTF-8 text, the one encoding a blueprint may use. */
  text: string
}

/**
 * Reads `given`: an https URL, or a path relative to `cwd`. Anything else, a URL with a user name, password or query
 * string, an unreachable URL, a missing file or a body over 1 MB is E_BLUEPRINT_SOURCE (exit 1); bytes that are not
 * UTF-8 are E_BLUEPRINT_SCHEMA.
 */
export async function readSource(given: string, cwd: string, root: string): Promise<Read> {
  const url = URL_SCHEME.test(given)
  const bytes = url ? await download(given) : readLocal(given, cwd)
  const source = url ? given : relative(root, resolve(cwd, given)).split(sep).join('/')
  return { bytes, hash: sha256(bytes), source, text: decode(bytes) }
}

/** `sha256:` and the hex digest of `bytes`. */
export function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

export function sourceError(message: string, fix = SOURCE_FIX): KalupError {
  return new KalupError({ code: 'E_BLUEPRINT_SOURCE', message, fix })
}

function readLocal(given: string, cwd: string): Uint8Array {
  const path = resolve(cwd, given)
  const shown = sanitize(given, PATH_MAX)
  const stat = statOf(path)
  if (!stat) {
    throw sourceError(`there is no file at ${shown}; a source is a path or an https:// URL`)
  }
  if (!stat.isFile()) {
    throw sourceError(`${shown} is not a file`)
  }
  if (stat.size > MAX_BYTES) {
    throw sourceError(`${shown} is ${stat.size} bytes, more than the ${MAX_BYTES} a blueprint may hold`)
  }
  return new Uint8Array(readFileSync(path))
}

// What is at `path`, or undefined when nothing can be read there.
function statOf(path: string): Stats | undefined {
  try {
    return statSync(path)
  } catch {
    return undefined
  }
}

async function download(given: string): Promise<Uint8Array> {
  if (!URL.canParse(given)) {
    throw sourceError(`${sanitize(given, PATH_MAX)} is not a URL`)
  }
  const at = new URL(given)
  // The lock records the source and every run prints it, so a URL that may carry a secret is refused, and shown
  // without the part that would.
  const shown = sanitize(redacted(at), PATH_MAX)
  if (at.protocol !== 'https:') {
    throw sourceError(`${shown} is not an https URL; Kalup fetches blueprints over https only`)
  }
  if (at.username !== '' || at.password !== '' || at.search !== '') {
    throw sourceError(
      `${shown} has a user name, password or query string, which may hold a token; the lock would record it and every run would print it`,
      'download the blueprint and pass its path, or use a URL with no credentials and no query string',
    )
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await follow(at, shown, controller, 0)
  } catch (error) {
    if (error instanceof KalupError) {
      throw error
    }
    if (controller.signal.aborted) {
      throw sourceError(`${shown} did not answer within ${TIMEOUT_MS / 1000} seconds`)
    }
    throw sourceError(
      `${shown} could not be fetched: ${sanitize(error instanceof Error ? error.message : String(error))}`,
    )
  } finally {
    clearTimeout(timer)
  }
}

// One request. Redirects are followed by hand, so each hop is checked: an https URL may not send the fetch to plain
// http.
async function follow(at: URL, shown: string, controller: AbortController, hop: number): Promise<Uint8Array> {
  if (hop > MAX_REDIRECTS) {
    throw sourceError(`${shown} redirects more than ${MAX_REDIRECTS} times`)
  }
  const response = await globalThis.fetch(at, {
    redirect: 'manual',
    signal: controller.signal,
    headers: { accept: 'application/json' },
  })
  if (!REDIRECTS.has(response.status)) {
    if (!response.ok) {
      throw sourceError(`${shown} answered HTTP ${response.status}`)
    }
    return capped(response, shown, controller)
  }
  await response.body?.cancel()
  const next = resolved(response.headers.get('location'), at)
  if (next?.protocol !== 'https:') {
    throw sourceError(`${shown} redirects to a location that is not an https URL; Kalup does not follow it`)
  }
  // fetch refuses a URL with credentials, and its error would quote them.
  if (next.username !== '' || next.password !== '') {
    throw sourceError(`${shown} redirects to a URL with a user name or password; Kalup does not follow it`)
  }
  return follow(next, shown, controller, hop + 1)
}

// The URL without its user name, password and query string.
function redacted(at: URL): string {
  const copy = new URL(at.href)
  copy.username = ''
  copy.password = ''
  copy.search = ''
  return copy.href
}

// A Location header against the URL that sent it, or undefined when there is none or it is not a URL.
function resolved(location: string | null, from: URL): URL | undefined {
  if (location === null) {
    return undefined
  }
  try {
    return new URL(location, from)
  } catch {
    return undefined
  }
}

// The body, refused as soon as it passes the cap: a stated length first, then the bytes as they arrive.
async function capped(response: Response, shown: string, controller: AbortController): Promise<Uint8Array> {
  const tooLarge = () => sourceError(`${shown} sent more than the ${MAX_BYTES} bytes a blueprint may hold`)
  if (Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) {
    controller.abort()
    throw tooLarge()
  }
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of response.body ?? []) {
    total += chunk.byteLength
    if (total > MAX_BYTES) {
      controller.abort()
      throw tooLarge()
    }
    chunks.push(chunk)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

// Strict UTF-8 with any byte order mark kept, so the text written back as the stored original is the same bytes.
function decode(bytes: Uint8Array): string {
  const text = utf8(bytes)
  if (text === undefined) {
    throw new KalupError({
      code: 'E_BLUEPRINT_SCHEMA',
      message: 'the blueprint is not UTF-8 text',
      fix: 'a blueprint is a JSON file in UTF-8; ask its author for one',
    })
  }
  return text
}

function utf8(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    return undefined
  }
}
