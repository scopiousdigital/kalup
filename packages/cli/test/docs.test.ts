// The docs/ folder the package ships: one page per issue code and no page for a code that does not exist, the
// AGENTS.md docs index names exactly the top-level pages, the prose rules, the word limits, and issues point at their
// page. No test checks for the client name: the test would have to hold the name it keeps out of public files.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { cli, parseEnvelope, project } from '../src/commands/testing.js'
import { agentsBlock } from '../src/lib/templates/agents.js'

const docs = fileURLToPath(new URL('../docs/', import.meta.url))
const packages = fileURLToPath(new URL('../../', import.meta.url))

function files(dir: string, extension: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => join(entry.parentPath, entry.name))
}

// Every E_ or W_ word in the source of both packages. Each one is an issue code; none needs skipping.
const codes = new Set(
  ['cli/src', 'core/src']
    .flatMap((dir) => files(join(packages, dir), '.ts'))
    .flatMap((file) => readFileSync(file, 'utf8').match(/\b[EW]_[A-Z_]+\b/g) ?? []),
)
const pages = readdirSync(join(docs, 'errors')).map((name) => name.replace(/\.md$/, ''))
const words = (file: string) => readFileSync(join(docs, file), 'utf8').split(/\s+/).filter(Boolean).length

test('every issue code in cli/src and core/src has a page under docs/errors', () => {
  expect(codes.size).toBeGreaterThan(0)
  expect([...codes].filter((code) => !pages.includes(code)).sort()).toEqual([])
})

test('every page under docs/errors is named after a code the source raises, and says so in its heading', () => {
  expect(pages.filter((page) => !codes.has(page))).toEqual([])
  for (const page of pages) {
    expect(readFileSync(join(docs, 'errors', `${page}.md`), 'utf8').split('\n')[0], page).toBe(`# ${page}`)
  }
})

test('an error page with an example shows its own code as a CLI line does', () => {
  for (const page of pages) {
    const text = readFileSync(join(docs, 'errors', `${page}.md`), 'utf8')
    const example = text.indexOf('## Example')
    if (example !== -1) expect(text.slice(example), page).toContain(`${page}: `)
  }
})

test('the package ships the docs folder', () => {
  const manifest = JSON.parse(readFileSync(join(packages, 'cli/package.json'), 'utf8')) as { files: string[] }
  expect(manifest.files).toContain('docs')
})

test('the AGENTS.md docs index lists exactly the shipped top-level pages', () => {
  const line = agentsBlock.split('\n').find((l) => l.startsWith('Docs (node_modules/kalup/docs): ')) ?? ''
  const listed = line
    .slice(line.indexOf(': ') + 2)
    .split(' | ')
    .map((entry) => entry.slice(0, entry.indexOf(': ')))
  const shipped = readdirSync(docs).filter((name) => name.endsWith('.md'))
  expect(listed.filter((entry) => !entry.startsWith('errors/')).sort()).toEqual(shipped.sort())
  expect(listed).toContain('errors/<CODE>.md')
})

test('no page contains an em dash or a word the public docs rules keep out', () => {
  for (const file of files(docs, '.md')) {
    const text = readFileSync(file, 'utf8')
    expect(text.includes('—'), file).toBe(false)
    expect(text.match(/\b(bridge|extension|cookie|session|internal api|private api)/gi), file).toBeNull()
  }
})

test('pages stay short: config.md and pull.md under 900 words, targets.md under 400, error pages at most 200', () => {
  expect(words('config.md')).toBeLessThan(900)
  expect(words('pull.md')).toBeLessThan(900)
  expect(words('targets.md')).toBeLessThan(400)
  for (const page of pages) expect(words(`errors/${page}.md`), page).toBeLessThanOrEqual(200)
})

test('run() points an issue at its page, in the envelope and on the human line', async () => {
  const json = parseEnvelope((await cli(project('valid'), 'deploy', '--json')).stdout)
  expect(json.issues[0]).toMatchObject({ code: 'E_USAGE', docs: 'errors/E_USAGE.md' })
  const human = await cli(project('valid'), 'deploy')
  expect(human.stderr).toContain(
    "E_USAGE: unknown command 'deploy' (fix: run kalup --help) (docs: errors/E_USAGE.md)\n",
  )
  // Warnings on a zero exit get their page too.
  const warned = parseEnvelope((await cli(project('warned'), 'validate', '--json')).stdout)
  expect(warned.ok).toBe(true)
  expect(warned.issues.length).toBeGreaterThan(0)
  for (const issue of warned.issues) expect(issue.docs).toBe(`errors/${issue.code}.md`)
})
