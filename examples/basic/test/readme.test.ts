// The main README, checked next to the example it shows, since the repo root has no test runner: every console block
// is what the built CLI prints, the companies.ts snippet is valid and canonical, the promise and the disclaimer match
// their sources word for word, and every link into the repo resolves. `pnpm --filter kalup build` comes first.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const example = fileURLToPath(new URL('../', import.meta.url))
const cli = join(root, 'packages/cli/dist/index.mjs')
const scratch = mkdtempSync(join(tmpdir(), 'kalup-readme-'))
after(() => rmSync(scratch, { recursive: true, force: true }))

const readme = readFileSync(join(root, 'README.md'), 'utf8')
const consoleBlocks = [...readme.matchAll(/^```console\n([\s\S]*?)^```$/gm)].map((m) => m[1] ?? '')
const prompt = '$ pnpm exec kalup '
const seatCountGroup = /(seatCount: [^}]*?group: )'billing'/
const renewalDateEntry = /\n {4}renewalDate: [^}]*\}\),/
const companiesSnippet = /`kalup\/objects\/companies\.ts`:\n\n```ts\n([\s\S]*?)```/
const disclaimerStart = /^Kalup is an independent open-source project/
const scheme = /^[a-z]+:/

// Runs the built CLI through a fake portal, stdout and stderr on one descriptor, so the text is what a terminal shows.
function kalup(cwd: string, args: string[]): { status: number | null; output: string } {
  const portal = pathToFileURL(join(existsSync(join(cwd, 'test')) ? cwd : example, 'test/fake-portal.ts')).href
  const log = join(scratch, 'output.txt')
  const fd = openSync(log, 'w')
  const { status } = spawnSync(process.execPath, ['--import', portal, cli, ...args], {
    cwd,
    env: { ...process.env, HUBSPOT_SANDBOX_KEY: 'kalup-readme-key', HUBSPOT_SERVICE_KEY: 'kalup-readme-key' },
    stdio: ['ignore', fd, fd],
  })
  closeSync(fd)
  return { status, output: readFileSync(log, 'utf8') }
}

// A copy of the example's config files and fake portal, free to edit.
function copyExample(name: string): string {
  const dir = join(scratch, name)
  for (const path of ['kalup', 'kalup.config.ts', 'test/fake-portal.ts', 'test/fixtures/portal']) {
    cpSync(join(example, path), join(dir, path), { recursive: true })
  }
  return dir
}

function edit(file: string, from: string | RegExp, to: string): void {
  const text = readFileSync(file, 'utf8')
  const next = text.replace(from, to)
  if (next === text) {
    throw new Error(`${file}: nothing matched ${from}`)
  }
  writeFileSync(file, next)
}

// Runs each `$ pnpm exec kalup` line of a console block and returns the block as a terminal would show it.
function replay(block: string, cwd: string, status: number): string {
  return block
    .split('\n')
    .filter((line) => line.startsWith(prompt))
    .map((line) => {
      const out = kalup(cwd, line.slice(prompt.length).split(' '))
      if (out.status !== status) {
        throw new Error(`expected exit ${status}, got ${out.status}: ${line}\n${out.output}`)
      }
      return `${line}\n${out.output}`
    })
    .join('')
}

test('the README has exactly the four console blocks this file replays', () => {
  assert.equal(consoleBlocks.length, 4, 'a console block added to README.md needs a replay here')
})

test('validate, ir --check and fmt --check on the example print what the README shows', () => {
  const block = consoleBlocks[0] ?? ''
  assert.equal(replay(block, copyExample('clean'), 0), block)
})

test('with one group name changed, validate prints what the README shows and exits 3', () => {
  const dir = copyExample('group')
  edit(join(dir, 'kalup/objects/companies.ts'), seatCountGroup, "$1'licensing'")
  const block = consoleBlocks[1] ?? ''
  assert.equal(replay(block, dir, 3), block)
})

test('pull after a label rename in the portal, with a property not in the file, prints what the README shows', () => {
  const dir = copyExample('pull')
  edit(
    join(dir, 'test/fixtures/portal/companies.properties.json'),
    '"label": "Billing status"',
    '"label": "Billing state"',
  )
  edit(join(dir, 'kalup/objects/companies.ts'), renewalDateEntry, '')
  const block = consoleBlocks[2] ?? ''
  assert.equal(replay(block, dir, 0), block)
})

test('init in an empty directory prints what the README shows', () => {
  const dir = join(scratch, 'init')
  mkdirSync(dir)
  const out = kalup(dir, ['init', '--portal', '1111111', '--objects', 'companies'])
  assert.equal(out.status, 0, out.output)
  assert.equal(out.output, consoleBlocks[3])
})

test('the companies.ts snippet in the README is valid and already canonical', () => {
  const snippet = companiesSnippet.exec(readme)?.[1]
  assert.ok(snippet, 'README.md lost the companies.ts snippet')
  const dir = copyExample('snippet')
  writeFileSync(join(dir, 'kalup/objects/companies.ts'), snippet)
  assert.deepEqual(kalup(dir, ['validate']), { status: 0, output: 'Config valid (0 errors, 0 warnings)\n' })
  assert.deepEqual(kalup(dir, ['fmt', '--check']), { status: 0, output: 'All files are canonical\n' })
})

const commandRow = /^\| `kalup ([a-z ]+)` \| (.+?) \| \d \|$/gm
const helpSection = (help: string, heading: string) => help.split(`\n${heading}\n`)[1]?.split('\n\n')[0] ?? ''
const helpEntry = /^ {2}([a-z]+(?: [a-z]+)?) {2,}/gm

// The command names a help section lists, one per entry; a wrapped summary's second line holds no name.
function helpNames(help: string, heading: string): string[] {
  return [...helpSection(help, heading).matchAll(helpEntry)].map((m) => m[1] ?? '')
}

test('the README command table lists every command kalup --help lists, each with its own help summary', () => {
  const rows = new Map([...readme.matchAll(commandRow)].map((m) => [m[1] ?? '', m[2] ?? '']))
  const help = kalup(example, ['--help']).output
  const topics = helpNames(help, 'TOPICS')
  const commands = [
    ...helpNames(help, 'COMMANDS'),
    ...topics.flatMap((topic) => helpNames(kalup(example, [topic, '--help']).output, 'COMMANDS')),
  ]
  assert.ok(topics.length > 0 && commands.length > topics.length, help)
  assert.deepEqual([...rows.keys()].sort(), commands.sort())
  for (const command of commands) {
    const [summary] = kalup(example, [...command.split(' '), '--help']).output.split('\n')
    assert.equal(rows.get(command), summary, command)
  }
})

test('the stays-free promise matches ADR 0014 and the disclaimer matches kalup --version, word for word', () => {
  const adr = readFileSync(join(root, 'docs/adr/0014-the-stays-free-promise.md'), 'utf8')
  const promise = adr.split('\n').find((line) => line.startsWith('> '))
  assert.ok(promise, 'ADR 0014 lost its quoted promise')
  assert.ok(readme.split('\n').includes(promise), 'README.md lacks the promise from ADR 0014')
  const disclaimer = kalup(example, ['--version']).output.split('\n')[1] ?? ''
  assert.match(disclaimer, disclaimerStart)
  for (const page of ['README.md', 'packages/core/README.md', 'packages/cli/README.md', 'examples/basic/README.md']) {
    assert.ok(readFileSync(join(root, page), 'utf8').includes(disclaimer), `${page} lacks the disclaimer`)
  }
})

const pages = [
  'README.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'SECURITY.md',
  'SUPPORT.md',
  '.github/PULL_REQUEST_TEMPLATE.md',
  'packages/core/README.md',
  'packages/cli/README.md',
  'examples/basic/README.md',
]
const repo = /^https:\/\/github\.com\/scopiousdigital\/kalup\/(?:blob|tree)\/main\//

// The text outside code fences, where links render.
function prose(file: string): string {
  return readFileSync(file, 'utf8').replace(/^```[\s\S]*?^```$/gm, '')
}

// GitHub's heading anchors: tags and backticks dropped, lowercase, punctuation dropped, spaces to hyphens.
function anchors(file: string): string[] {
  return [...prose(file).matchAll(/^#{1,6} (.+)$/gm)].map((m) =>
    (m[1] ?? '')
      .replace(/<[^>]+>|`/g, '')
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N} _-]/gu, '')
      .replaceAll(' ', '-'),
  )
}

test('every relative link, and every GitHub link into this repo, points at a path and a heading that exist', () => {
  let checked = 0
  for (const page of pages) {
    const file = join(root, page)
    for (const m of prose(file).matchAll(/\]\(([^)\s]+)\)|(?:href|src|srcset)="([^"]+)"/g)) {
      const link = m[1] ?? m[2] ?? ''
      if (scheme.test(link) && !repo.test(link)) {
        continue
      }
      const [path = '', anchor] = link.split('#')
      const target = path === '' ? file : join(repo.test(path) ? root : dirname(file), path.replace(repo, ''))
      assert.ok(existsSync(target), `${page}: ${link} points at nothing`)
      if (anchor !== undefined) {
        assert.ok(anchors(target).includes(anchor), `${page}: ${link} names no heading`)
      }
      checked += 1
    }
  }
  assert.ok(checked > 50, `only ${checked} links found`)
})
