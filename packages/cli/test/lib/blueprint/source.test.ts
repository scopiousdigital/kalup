// Reading a blueprint source: a file relative to the current directory, or an https URL through a stubbed fetch. The
// bytes come back exactly as served, with their sha256.
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KalupError } from '@kalup/engine'
import { afterEach, expect, test, vi } from 'vitest'
import { MAX_BYTES, readSource, TIMEOUT_MS } from '../../../src/lib/blueprint/source.js'

const FETCH_WORD = /\bfetch\b/
// Each refusal by its code and the words that tell it apart.
const redirectNotHttps = /^E_BLUEPRINT_SOURCE: .* redirects to .*not an https URL/
const notHttps = /^E_BLUEPRINT_SOURCE: .* is not an https URL/
const strippedUrl = /^E_BLUEPRINT_SOURCE: https:\/\/blueprints\.example\.com\/acme\/renewals\.json has /
const redirectWithUser = /^E_BLUEPRINT_SOURCE: .* redirects to a URL with a user name or password/
const noFile = /^E_BLUEPRINT_SOURCE: .*no file at missing\.json/
const timedOut = /^E_BLUEPRINT_SOURCE: .* within 30 seconds/
const notUtf8 = /^E_BLUEPRINT_SCHEMA: .*not UTF-8/

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const url = 'https://blueprints.example.com/acme/renewals-1.0.0.json'
const body = '{ "blueprintVersion": 1 }\n'

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'kalup-source-'))
  mkdirSync(join(root, 'hubspot', 'objects'), { recursive: true })
  return root
}

interface Call {
  headers: unknown
  redirect: unknown
  url: string
}

/** A fetch that answers each URL with the given Response, and records every call. */
function serve(answers: Record<string, () => Response>): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', (input: URL | string, init: RequestInit) => {
    const at = String(input)
    calls.push({ url: at, headers: init.headers, redirect: init.redirect })
    const answer = Object.hasOwn(answers, at) ? answers[at] : undefined
    return Promise.resolve(answer ? answer() : new Response('missing', { status: 404 }))
  })
  return calls
}

async function failure(given: string, cwd = project()): Promise<string> {
  try {
    await readSource(given, cwd, cwd)
  } catch (error) {
    if (!(error instanceof KalupError)) {
      throw error
    }
    const [issue] = error.issues
    return `${issue?.code}: ${issue?.message}`
  }
  throw new Error('readSource did not fail')
}

test('a path is read relative to the current directory and recorded relative to the project root', async () => {
  const root = project()
  mkdirSync(join(root, 'shared'))
  writeFileSync(join(root, 'shared', 'renewals.json'), body)
  const read = await readSource('../shared/renewals.json', join(root, 'hubspot'), root)
  expect(read.source).toBe('shared/renewals.json')
  expect(read.text).toBe(body)
  expect(read.hash).toBe(`sha256:${createHash('sha256').update(body).digest('hex')}`)
})

test('an https URL is fetched with accept as its only header, and its bytes are kept as served', async () => {
  const calls = serve({ [url]: () => new Response(body, { headers: { 'content-type': 'application/json' } }) })
  const read = await readSource(url, project(), project())
  expect(read).toMatchObject({ source: url, text: body })
  expect(calls).toEqual([{ url, headers: { accept: 'application/json' }, redirect: 'manual' }])
})

test('a redirect to another https URL is followed; one to plain http is refused', async () => {
  const next = 'https://cdn.example.com/renewals.json'
  serve({
    [url]: () => Response.redirect(next, 302),
    [next]: () => new Response(body),
  })
  expect((await readSource(url, project(), project())).text).toBe(body)
  serve({ [url]: () => Response.redirect('http://cdn.example.com/x.json', 301) })
  expect(await failure(url)).toMatch(redirectNotHttps)
})

test('an http URL, or any scheme but https, is refused before any request', async () => {
  const calls = serve({})
  expect(await failure('http://blueprints.example.com/renewals.json')).toMatch(notHttps)
  expect(await failure('file:///etc/renewals.json')).toContain('is not an https URL')
  expect(calls).toEqual([])
})

test('a URL with a user name, password or query string is refused before any request, and never echoed whole', async () => {
  const calls = serve({})
  const cases = [
    'https://agency:secret-tok-9f2c@blueprints.example.com/acme/renewals.json',
    'https://blueprints.example.com/acme/renewals.json?token=secret-tok-9f2c',
  ]
  for (const said of await Promise.all(cases.map((given) => failure(given)))) {
    expect(said).toMatch(strippedUrl)
    expect(said).not.toContain('secret-tok')
  }
  expect(calls).toEqual([])
})

test('a redirect to a URL with a user name or password is refused without quoting it', async () => {
  serve({ [url]: () => Response.redirect('https://agency:secret-tok-9f2c@cdn.example.com/renewals.json', 302) })
  const said = await failure(url)
  expect(said).toMatch(redirectWithUser)
  expect(said).not.toContain('secret-tok')
})

test('a body over 1 MB is refused, by its stated length or as it streams', async () => {
  const huge = 'x'.repeat(MAX_BYTES + 1)
  serve({ [url]: () => new Response(huge, { headers: { 'content-length': String(huge.length) } }) })
  expect(await failure(url)).toMatch(new RegExp(`^E_BLUEPRINT_SOURCE: .* more than the ${MAX_BYTES} bytes`))
  const chunk = new Uint8Array(64 * 1024)
  serve({
    [url]: () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(chunk)
          },
        }),
      ),
  })
  expect(await failure(url)).toContain('sent more than the')
  const root = project()
  writeFileSync(join(root, 'huge.json'), huge)
  expect(await failure('huge.json', root)).toMatch(
    new RegExp(`^E_BLUEPRINT_SOURCE: huge\\.json is ${MAX_BYTES + 1} bytes, more than the ${MAX_BYTES}`),
  )
})

test('an error status, a failed request and a missing file are E_BLUEPRINT_SOURCE', async () => {
  serve({ [url]: () => new Response('gone', { status: 410 }) })
  expect(await failure(url)).toBe(`E_BLUEPRINT_SOURCE: ${url} answered HTTP 410`)
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('fetch failed')))
  expect(await failure(url)).toBe(`E_BLUEPRINT_SOURCE: ${url} could not be fetched: fetch failed`)
  expect(await failure('missing.json')).toMatch(noFile)
  expect(await failure('hubspot')).toBe('E_BLUEPRINT_SOURCE: hubspot is not a file')
})

test('a fetch that does not finish within 30 seconds is aborted', async () => {
  vi.useFakeTimers()
  vi.stubGlobal(
    'fetch',
    (_: URL, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      }),
  )
  const pending = failure(url)
  await vi.advanceTimersByTimeAsync(TIMEOUT_MS)
  expect(await pending).toMatch(timedOut)
})

test('bytes that are not UTF-8 are E_BLUEPRINT_SCHEMA; a body that is not JSON is read, and refused when parsed', async () => {
  serve({ [url]: () => new Response(new Uint8Array([0x7b, 0xff, 0x7d])) })
  expect(await failure(url)).toMatch(notUtf8)
  serve({ [url]: () => new Response('<html>not a blueprint</html>', { headers: { 'content-type': 'text/html' } }) })
  expect((await readSource(url, project(), project())).text).toBe('<html>not a blueprint</html>')
})

// Every HubSpot request goes through the engine's HTTP client, which the engine's tests check.
test('the blueprint source reader is the only file in the CLI that references fetch', () => {
  const src = fileURLToPath(new URL('../../../src/', import.meta.url))
  const offenders = readdirSync(src, { recursive: true, encoding: 'utf8' })
    .map((file) => file.split('\\').join('/'))
    .filter((file) => file.endsWith('.ts') && file !== 'lib/blueprint/source.ts')
    .filter((file) => FETCH_WORD.test(readFileSync(join(src, file), 'utf8')))
  expect(offenders).toEqual([])
})
