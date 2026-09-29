// The docs/ folder the package ships: the issue pages are what scripts/gen-docs.mjs makes of the table in
// packages/core/src/issues.ts, the AGENTS.md docs index names exactly the top-level pages, the prose rules, and issues
// point at their page. No test checks for the client name: the test would have to hold the name it keeps out of public
// files.
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { cli, parseEnvelope, project } from '../src/commands/testing.js'
import { agentsBlock } from '../src/lib/templates/agents.js'

const docs = fileURLToPath(new URL('../docs/', import.meta.url))
const packages = fileURLToPath(new URL('../../', import.meta.url))
const root = fileURLToPath(new URL('../../../', import.meta.url))

function files(dir: string, extension: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => join(entry.parentPath, entry.name))
}

// Every E_ or W_ word in the source of both packages, outside the table itself.
const raised = new Set(
  ['cli/src', 'core/src']
    .flatMap((dir) => files(join(packages, dir), '.ts'))
    .filter((file) => !file.endsWith('issues.ts'))
    .flatMap((file) => readFileSync(file, 'utf8').match(/\b[EW]_[A-Z_]+\b/g) ?? []),
)
const mdExtension = /\.md$/
const pages = readdirSync(join(docs, 'errors')).map((name) => name.replace(mdExtension, ''))

test('the committed issue pages and the website errors reference match the table in @kalup/core', () => {
  const gen = spawnSync(
    process.execPath,
    ['--experimental-strip-types', join(root, 'scripts/gen-docs.mjs'), '--check'],
    {
      encoding: 'utf8',
    },
  )
  expect(gen.status, gen.stderr).toBe(0)
})

test('every code in the table is one the source raises', () => {
  expect(pages.filter((page) => !raised.has(page))).toEqual([])
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
  for (const issue of warned.issues) {
    expect(issue.docs).toBe(`errors/${issue.code}.md`)
  }
})
