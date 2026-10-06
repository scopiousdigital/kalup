// The installed-package smoke test. It packs kalup and @kalup/core with pnpm, installs the tarballs with npm into a
// clean project outside the repository, and checks what a user gets: the bin, command discovery, the @kalup/core
// entry, the declaration files, the schemas, the shipped docs, LICENSE and NOTICE, and the offline workflow against the
// example's fake portal. Run it from the repository root after `pnpm build`:
//
//   node scripts/pack-smoke.mjs [--node <path>] [--out <dir>] [--registry <version>]
//
// --node runs every check of the installed packages with that Node binary, so one checkout checks Node 22 and 24;
// pnpm, npm and tsc run on this one. --out copies the tarballs into <dir>, for the release workflow to publish what was
// checked. --registry installs that published version or dist-tag of both packages from npm instead of packing, for the
// check after a release. npm fetches @oclif/core and typescript from the registry, the only network use; no request
// reaches HubSpot. A passing run on tarballs proves the tarballs, not an install from the registry.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, delimiter, dirname, join, relative, resolve, sep } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual, parseArgs } from 'node:util'
import { inTerminal, noPseudoTerminal } from '../packages/cli/test/support/terminal.ts'

// What the docs promise, restated so that changing either is deliberate: docs/compatibility.md lists the formats and
// the schemas, apps/web/content/docs/commands/ir.mdx gives the $id.
const FORMATS = ['ir/1', 'plan/1', 'kalup.state/1', 'envelope/1', 'blueprint/1', 'blueprints-lock/1']
const SCHEMAS = [
  'blueprint-1.schema.json',
  'blueprints-lock-1.schema.json',
  'ir-1.schema.json',
  'plan-1.schema.json',
  'state-1.schema.json',
]
const SCHEMA_ID = 'https://kalup.dev/schemas/'
const DISCLAIMER = 'It is not affiliated with, endorsed by, or sponsored by HubSpot, Inc.'
// Invented values, as in the example's tests. No run may print them.
const KEYS = { HUBSPOT_SANDBOX_KEY: 'kalup-test-secret-9f2c', HUBSPOT_PROD_READ_KEY: 'kalup-test-secret-5a81' }
const RUNS = 5

const README_ROW = /^\| `kalup /
const BACKTICKED = /`([^`]+)`/g
const ISSUE_CODE = /\b[EW]_[A-Z_]+\b/g
const AGENTS_DOCS = /Docs \(node_modules\/kalup\/docs\): ([^"'\n]+)/
const ANY_IMPORT = /\bimport\b/
const MAP_COMMENT = /[#@] sourceMappingURL=/
// CI reads the floor it installs from engines.node, so it has to be one plain lower bound.
const FLOOR = /^>=\d+\.\d+\.\d+$/

const repo = fileURLToPath(new URL('..', import.meta.url))
const example = join(repo, 'examples/basic')
const { values: options } = parseArgs({
  options: { node: { type: 'string' }, out: { type: 'string' }, registry: { type: 'string' } },
})
const node = options.node ? resolve(options.node) : process.execPath
const work = mkdtempSync(join(tmpdir(), 'kalup-pack-smoke-'))
const project = join(work, 'project')
const tarballs = join(work, 'tarballs')
const typescript = join(work, 'typescript')
const core = readJson(join(repo, 'packages/core/package.json'))
const cli = readJson(join(repo, 'packages/cli/package.json'))
const installed = {
  kalup: join(project, 'node_modules/kalup'),
  '@kalup/core': join(project, 'node_modules/@kalup/core'),
}
const env = { ...process.env, ...KEYS, KALUP_LOCK_DIR: join(work, 'locks') }
env.KALUP_STATE_DIR = undefined
const results = []

function say(line) {
  process.stdout.write(`${line}\n`)
}

function expect(condition, reason) {
  if (!condition) {
    throw new Error(reason)
  }
}

// One named check: pass, or fail with the reason, and the run goes on. A body that returns a promise makes the check
// return one, to await.
function check(name, body) {
  const pass = (note) => {
    results.push(true)
    say(`pass  ${name}${note ? `: ${note}` : ''}`)
  }
  const fail = (error) => {
    results.push(false)
    say(`FAIL  ${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
  try {
    const note = body()
    if (note instanceof Promise) {
      return note.then(pass, fail)
    }
    pass(note)
  } catch (error) {
    fail(error)
  }
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

// A setup command: its stdout, or an error with the end of its output.
function run(command, args, cwd) {
  const out = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (out.status !== 0) {
    const tail = (out.stderr || out.stdout || String(out.error)).trim().split('\n').slice(-5).join(' ')
    throw new Error(`${command} ${args.join(' ')} exited ${out.status}: ${tail}`)
  }
  return out.stdout
}

// Every file under `dir`, as a relative path with forward slashes.
function files(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
}

function size(dir) {
  return files(dir).reduce((sum, file) => sum + statSync(join(dir, file)).size, 0)
}

function megabytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

// The content of every project file outside node_modules, to show a command wrote nothing.
function tree(dir) {
  return Object.fromEntries(
    files(dir)
      .filter((file) => !file.startsWith('node_modules/'))
      .map((file) => [
        file,
        createHash('sha256')
          .update(readFileSync(join(dir, file)))
          .digest('hex'),
      ]),
  )
}

function pack() {
  for (const dir of ['packages/core', 'packages/cli']) {
    expect(existsSync(join(repo, dir, 'dist/index.mjs')), `${dir}/dist is missing: run pnpm build first`)
    run('pnpm', ['pack', '--pack-destination', tarballs], join(repo, dir))
  }
  const packed = [`kalup-core-${core.version}.tgz`, `kalup-${cli.version}.tgz`].map((name) => join(tarballs, name))
  if (options.out) {
    mkdirSync(options.out, { recursive: true })
    for (const file of packed) {
      cpSync(file, join(options.out, basename(file)))
    }
  }
  return packed
}

function install() {
  const specs = options.registry ? [`@kalup/core@${options.registry}`, `kalup@${options.registry}`] : pack()
  mkdirSync(project)
  writeFileSync(join(project, 'package.json'), `${JSON.stringify({ name: 'smoke', private: true, type: 'module' })}\n`)
  run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error', ...specs], project)
  // typescript goes apart, so the project holds what a user installs and its size is theirs.
  const { version } = readJson(join(repo, 'node_modules/typescript/package.json'))
  mkdirSync(typescript)
  writeFileSync(join(typescript, 'package.json'), `${JSON.stringify({ name: 'tsc', private: true })}\n`)
  run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error', `typescript@${version}`], typescript)
  const sources = options.registry
    ? specs
    : specs.map((file) => `${basename(file)} ${(statSync(file).size / 1024).toFixed(0)} kB`)
  return `${sources.join(', ')}; typescript ${version} for the type check`
}

say(`kalup pack smoke on Node ${run(node, ['--version']).trim()} (${node}), in ${work}`)
check(
  options.registry ? 'install both packages from npm' : 'pack both packages and install the tarballs with npm',
  install,
)
if (results.includes(false)) {
  say(`kept ${work}`)
  process.exit(1)
}

const shipped = Object.fromEntries(
  Object.entries(installed).map(([name, dir]) => [name, readJson(join(dir, 'package.json'))]),
)
const bin = join(installed.kalup, shipped.kalup.bin.kalup)
const fakePortal = prepareFakePortal()
const installedSize = size(join(project, 'node_modules'))

// The example's fake portal, made JavaScript so that any Node loads it: it answers the example's reads from its
// fixtures and throws on every other request, so nothing reaches the network and nothing is written.
function prepareFakePortal() {
  const dir = join(work, 'fake-portal')
  cpSync(join(example, 'test/fixtures/portal'), join(dir, 'fixtures/portal'), { recursive: true })
  const ts = createRequire(join(typescript, 'package.json'))('typescript')
  const source = readFileSync(join(example, 'test/fake-portal.ts'), 'utf8')
  const compilerOptions = { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  writeFileSync(join(dir, 'fake-portal.mjs'), ts.transpileModule(source, { compilerOptions }).outputText)
  return pathToFileURL(join(dir, 'fake-portal.mjs')).href
}

// The installed bin under the chosen Node, with the fake portal unless `portal` is false. No run has a terminal.
function kalup(args, { cwd = project, portal = true } = {}) {
  const out = spawnSync(node, [...(portal ? ['--import', fakePortal] : []), bin, ...args], {
    cwd,
    encoding: 'utf8',
    env,
  })
  const printed = `${out.stdout}${out.stderr}`
  expect(!Object.values(KEYS).some((key) => printed.includes(key)), `kalup ${args.join(' ')} printed a key`)
  return out
}

// `kalup <args> --json`: exactly one envelope/1 on stdout, nothing on stderr, and the expected exit.
function json(args, exit, how) {
  const command = `kalup ${args.join(' ')} --json`
  const out = kalup([...args, '--json'], how)
  expect(out.status === exit, `${command} exited ${out.status}, not ${exit}: ${out.stdout.slice(0, 400)}`)
  expect(out.stderr === '', `${command} wrote to stderr: ${out.stderr.slice(0, 400)}`)
  let envelope
  try {
    envelope = JSON.parse(out.stdout)
  } catch (error) {
    throw new Error(`${command}: stdout is not one JSON document`, { cause: error })
  }
  expect(envelope.format === 'envelope/1', `${command}: stdout is not an envelope/1 document`)
  return envelope
}

// A script run as a module in the project, under the chosen Node, so bare imports resolve as an app's do.
function script(source, ...args) {
  const out = spawnSync(node, ['--input-type=module', '-e', source, ...args], { cwd: project, encoding: 'utf8', env })
  expect(out.status === 0, `the script exited ${out.status}: ${out.stderr.trim().split('\n').slice(-3).join(' ')}`)
  return out
}

// The issues a validator of the engine finds in a document. The engine is private and ships only inside the CLI's
// bundle, so the check imports the repository's build of it, the one the packed CLI inlines.
function validated(validator, document) {
  const file = join(work, `${validator}.json`)
  writeFileSync(file, JSON.stringify(document))
  const source = [
    `import * as engine from ${JSON.stringify(pathToFileURL(join(repo, 'packages/engine/dist/index.mjs')).href)}`,
    "import { readFileSync } from 'node:fs'",
    "const issues = engine[process.argv[1]](JSON.parse(readFileSync(process.argv[2], 'utf8')))",
    'process.stdout.write(JSON.stringify(issues))',
  ].join('\n')
  return JSON.parse(script(source, validator, file).stdout)
}

// The decision is no source maps, so a map or a comment pointing at one is a mistake either way.
check(
  'package contents: no source maps or map comments, no build stamp, no devDependencies, @kalup/core as a version, one floor',
  () => {
    for (const [name, dir] of Object.entries(installed)) {
      const own = files(dir).filter((file) => !file.startsWith('node_modules/'))
      const stray = own.filter((file) => file.endsWith('.map') || file.endsWith('build-stamp.json'))
      expect(stray.length === 0, `${name} ships ${stray.join(', ')}`)
      const mapped = own.filter(
        (file) =>
          (file.endsWith('.mjs') || file.endsWith('.d.mts')) && MAP_COMMENT.test(readFileSync(join(dir, file), 'utf8')),
      )
      expect(mapped.length === 0, `${name} has a sourceMappingURL comment in ${mapped.join(', ')}`)
      // .pnpmfile.cjs leaves them out: they name workspace packages that are never published.
      expect(shipped[name].devDependencies === undefined, `${name} lists devDependencies`)
      const ranges = Object.values({ ...shipped[name].dependencies, ...shipped[name].peerDependencies })
      expect(!ranges.some((value) => value.startsWith('workspace:')), `${name} keeps a workspace: range`)
    }
    const deps = Object.keys(shipped.kalup.dependencies).sort()
    expect(isDeepStrictEqual(deps, ['@kalup/core', '@oclif/core']), `kalup depends on ${deps.join(', ')}`)
    const engine = files(join(installed.kalup, 'dist')).filter((file) =>
      readFileSync(join(installed.kalup, 'dist', file), 'utf8').includes('@kalup/engine'),
    )
    expect(engine.length === 0, `kalup's dist names @kalup/engine in ${engine.join(', ')}`)
    const range = shipped.kalup.dependencies['@kalup/core']
    const { version } = shipped['@kalup/core']
    expect(range === version, `kalup depends on @kalup/core ${range}, not the installed ${version}`)
    const floor = shipped.kalup.engines.node
    expect(FLOOR.test(floor), `kalup's engines.node ${floor} is not one >= bound`)
    const coreFloor = shipped['@kalup/core'].engines.node
    expect(coreFloor === floor, `kalup requires Node ${floor}, @kalup/core ${coreFloor}`)
    return `kalup ${shipped.kalup.version} depends on @kalup/core ${range}, engines ${floor}`
  },
)

check('LICENSE and NOTICE in both packages, as in the repository', () => {
  for (const file of ['LICENSE', 'NOTICE']) {
    const text = readFileSync(join(repo, file), 'utf8')
    for (const [name, dir] of Object.entries(installed)) {
      expect(existsSync(join(dir, file)), `${name} has no ${file}`)
      expect(readFileSync(join(dir, file), 'utf8') === text, `${name}'s ${file} is not the repository's`)
    }
  }
})

check('kalup --version --json: name, version and formats', () => {
  const { data } = json(['--version'], 0, { portal: false })
  expect(data.name === 'kalup', `name ${data.name}`)
  expect(data.version === shipped.kalup.version, `version ${data.version}, not ${shipped.kalup.version}`)
  expect(isDeepStrictEqual(data.formats, FORMATS), `formats ${JSON.stringify(data.formats)}`)
  return `${data.name} ${data.version}`
})

// The bin as npm links it and `npx kalup` runs it: the committed shim bin/kalup.mjs, which imports dist/index.mjs,
// through its shebang, not through `node`. The chosen Node comes first on PATH, where `#!/usr/bin/env node` finds it.
check('node_modules/.bin/kalup --version --json runs the bin/kalup.mjs shim through its shebang', () => {
  expect(shipped.kalup.bin.kalup === './bin/kalup.mjs', `the bin is ${shipped.kalup.bin.kalup}, not the shim`)
  const [first] = readFileSync(bin, 'utf8').split('\n', 1)
  expect(first === '#!/usr/bin/env node', `the bin's first line is ${first}`)
  const out = spawnSync(join(project, 'node_modules/.bin/kalup'), ['--version', '--json'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...env, PATH: `${dirname(node)}${delimiter}${env.PATH}` },
  })
  expect(out.status === 0, `exit ${out.status}: ${out.error?.message ?? out.stderr}`)
  const { data } = JSON.parse(out.stdout)
  expect(data.version === shipped.kalup.version, `version ${data.version}, not ${shipped.kalup.version}`)
})

// A fresh clone links the shim before `pnpm build` has made dist: it names the fix instead of a module error.
check('the bin shim without dist: exit 1, "run pnpm build first"', () => {
  const shim = join(work, 'unbuilt/bin/kalup.mjs')
  mkdirSync(dirname(shim), { recursive: true })
  cpSync(bin, shim)
  const out = spawnSync(node, [shim, '--version'], { cwd: work, encoding: 'utf8', env })
  expect(out.status === 1, `exit ${out.status}`)
  expect(out.stderr === 'kalup is not built: run pnpm build first\n', `stderr ${out.stderr}`)
})

check('kalup --help', () => {
  const out = kalup(['--help'], { portal: false })
  expect(out.status === 0, `exit ${out.status}`)
  expect(out.stdout.includes('USAGE') && out.stdout.includes(DISCLAIMER), 'the help has no usage or no disclaimer')
})

check('kalup --bogus is E_USAGE, exit 1, with and without --json', () => {
  const envelope = json(['--bogus'], 1, { portal: false })
  expect(envelope.ok === false && envelope.issues[0]?.code === 'E_USAGE', JSON.stringify(envelope.issues))
  const human = kalup(['--bogus'], { portal: false })
  expect(human.status === 1 && human.stderr.startsWith('E_USAGE: '), `exit ${human.status}: ${human.stderr}`)
})

check('kalup plan --help --json', () => {
  const { data } = json(['plan', '--help'], 0, { portal: false })
  expect(data.usage.includes('$ kalup plan'), 'the usage does not name kalup plan')
})

// The commands the README's table documents are the ones oclif discovers through the package's oclif config, and each
// has its help. The root help lists each command, or the topic that holds it.
check('command discovery: every documented command is discovered and has help', () => {
  const documented = readFileSync(join(installed.kalup, 'README.md'), 'utf8')
    .split('\n')
    .filter((line) => README_ROW.test(line))
    .flatMap((line) => [...line.split('|')[1].matchAll(BACKTICKED)].map(([, name]) => name.replace('kalup ', '')))
  expect(documented.length > 0, 'the README documents no command')
  const { commands } = shipped.kalup.oclif
  const target = pathToFileURL(join(installed.kalup, commands.target)).href
  const source =
    'const m = await import(process.argv[1])\nprocess.stdout.write(JSON.stringify(Object.keys(m[process.argv[2]])))'
  const ids = JSON.parse(script(source, target, commands.identifier).stdout).map((id) => id.replaceAll(':', ' '))
  expect(isDeepStrictEqual([...ids].sort(), [...documented].sort()), `discovered ${ids}; documented ${documented}`)
  const root = kalup(['--help'], { portal: false }).stdout
  for (const id of documented) {
    const [word] = id.split(' ')
    expect(root.includes(`\n  ${word} `), `kalup --help does not list ${word}`)
    const { data } = json([...id.split(' '), '--help'], 0, { portal: false })
    expect(data.usage.includes(`$ kalup ${id}`), `kalup ${id} --help has no usage line for it`)
  }
  return `${documented.length} commands`
})

check("kalup has no library entry: import 'kalup' is refused", () => {
  const source = [
    "const seen = await import('kalup').then(() => 'loaded', (error) => error.code)",
    'process.stdout.write(JSON.stringify([seen, process.exitCode ?? null]))',
  ].join('\n')
  const out = script(source)
  expect(out.stderr === '', `stderr: ${out.stderr}`)
  expect(out.stdout === '["ERR_PACKAGE_PATH_NOT_EXPORTED",null]', `got ${out.stdout}`)
})

check(
  "import { p, defineObject, defineConfig, defineRemoved, ... } from '@kalup/core': nothing else, no imports",
  () => {
    const entry = shipped['@kalup/core'].exports['.'].default
    expect(
      !ANY_IMPORT.test(readFileSync(join(installed['@kalup/core'], entry), 'utf8')),
      `${entry} imports another module`,
    )
    const source = [
      "import * as core from '@kalup/core'",
      "const company = core.defineObject('companies', { properties: { seats: core.p.number('seat_count') } })",
      'const config = { targets: {} }',
      'const seen = [Object.keys(core).sort(), core.defineConfig(config) === config, company.properties.seats.get({ seat_count: "3" })]',
      'process.stdout.write(JSON.stringify(seen))',
    ].join('\n')
    const out = script(source)
    const expected =
      '[["defineAssociations","defineConfig","defineCustomObject","defineObject","definePipeline","defineRemoved","p","propertyNames"],true,3]'
    expect(out.stdout === expected, `got ${out.stdout}`)
  },
)

const CHECK_TS = `import {
  defineConfig,
  defineObject,
  defineRemoved,
  type InferProperties,
  type KalupConfig,
  p,
} from '@kalup/core'
import planSchema from 'kalup/schemas/plan-1.schema.json' with { type: 'json' }

export const config: KalupConfig = defineConfig({
  defaultTarget: 'sandbox',
  targets: { sandbox: { portalId: 1111111, credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } } } },
})
export const removed = defineRemoved({ 'property:companies/legacy_score': { action: 'destroy' } })

export const Company = defineObject('companies', {
  groups: { billing: { label: 'Billing' } },
  properties: {
    billingStatus: p.enum('billing_status', {
      label: 'Billing status',
      group: 'billing',
      fieldType: 'select',
      options: [
        { value: 'active', label: 'Active' },
        { value: 'PAST DUE', label: 'Past due', as: 'past_due' },
      ],
    }),
    seatCount: p.number('seat_count', { label: 'Seat count', group: 'billing', fieldType: 'number' }),
  },
})

export type CompanyData = InferProperties<typeof Company.properties>
export const status: CompanyData['billingStatus'] = 'past_due'
// @ts-expect-error the alias replaces the stored value in the app's type
export const stored: CompanyData['billingStatus'] = 'PAST DUE'
export const seats: CompanyData['seatCount'] = 12
export const schemaId: string = planSchema.$id
`

check('declaration files type-check with module NodeNext and with moduleResolution Bundler', () => {
  const dir = join(project, 'types')
  mkdirSync(dir)
  writeFileSync(join(dir, 'check.ts'), CHECK_TS)
  const shared = {
    strict: true,
    noEmit: true,
    skipLibCheck: false,
    resolveJsonModule: true,
    target: 'ES2022',
    types: [],
  }
  const settings = {
    nodenext: { module: 'NodeNext', moduleResolution: 'NodeNext' },
    bundler: { module: 'ESNext', moduleResolution: 'Bundler' },
  }
  const tsc = join(typescript, 'node_modules/typescript/bin/tsc')
  for (const [name, resolution] of Object.entries(settings)) {
    const config = join(dir, `tsconfig.${name}.json`)
    writeFileSync(config, JSON.stringify({ compilerOptions: { ...shared, ...resolution }, files: ['check.ts'] }))
    run(process.execPath, [tsc, '-p', config], dir)
  }
})

check('each kalup/schemas/*.json imports with type json and has its documented $id', () => {
  const schemas = readdirSync(join(installed.kalup, 'dist/schemas')).sort()
  expect(isDeepStrictEqual(schemas, SCHEMAS), `the package ships ${schemas.join(', ')}`)
  const source = [
    'const ids = {}',
    'for (const file of process.argv.slice(1)) {',
    "  ids[file] = (await import('kalup/schemas/' + file, { with: { type: 'json' } })).default.$id",
    '}',
    'process.stdout.write(JSON.stringify(ids))',
  ].join('\n')
  const ids = JSON.parse(script(source, ...SCHEMAS).stdout)
  for (const file of SCHEMAS) {
    expect(ids[file] === `${SCHEMA_ID}${file}`, `${file} has $id ${ids[file]}`)
  }
})

// Issue.docs names errors/<CODE>.md for every code, so every E_ or W_ word in the installed bundles needs its page.
check('shipped docs: a page for every issue code, and the AGENTS.md index names only shipped pages', () => {
  const docs = join(installed.kalup, 'docs')
  const bundles = Object.values(installed).flatMap((dir) =>
    files(join(dir, 'dist'))
      .filter((file) => file.endsWith('.mjs'))
      .map((file) => readFileSync(join(dir, 'dist', file), 'utf8')),
  )
  const codes = [...new Set(bundles.join('\n').match(ISSUE_CODE))]
  expect(codes.length > 0, 'no issue code in the installed bundles')
  const missing = codes.filter((code) => !existsSync(join(docs, 'errors', `${code}.md`)))
  expect(missing.length === 0, `no page for ${missing.join(', ')}`)
  const index = AGENTS_DOCS.exec(bundles.join('\n'))?.[1]
  expect(index !== undefined, 'the AGENTS.md docs index is not in the installed bundles')
  const listed = index.split(' | ').map((entry) => entry.slice(0, entry.indexOf(': ')))
  const unshipped = listed.filter((page) => page !== 'errors/<CODE>.md' && !existsSync(join(docs, page)))
  expect(unshipped.length === 0, `AGENTS.md names ${unshipped.join(', ')}, which the package does not ship`)
  return `${codes.length} codes, ${listed.length} index entries`
})

// init needs no key and sends nothing: in a folder of the project, with no fake portal loaded and no key set.
check('kalup init: offline, the project files and a pending target', () => {
  const dir = join(project, 'fresh')
  mkdirSync(dir)
  const out = spawnSync(node, [bin, 'init', '--objects', 'companies', '--json'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...env, HUBSPOT_SANDBOX_KEY: undefined, HUBSPOT_PROD_READ_KEY: undefined, HUBSPOT_SERVICE_KEY: undefined },
  })
  expect(out.status === 0, `init exited ${out.status}: ${out.stdout.slice(0, 400)}`)
  const { data } = JSON.parse(out.stdout)
  expect(data.portalId === undefined && data.target === 'production', JSON.stringify(data))
  for (const file of ['kalup.config.ts', 'hubspot/index.ts', '.gitignore', 'AGENTS.md', 'CLAUDE.md']) {
    expect(existsSync(join(dir, file)), `init wrote no ${file}`)
  }
  const pull = spawnSync(node, [bin, 'pull', '--json'], { cwd: dir, encoding: 'utf8', env })
  const issues = JSON.parse(pull.stdout).issues.map((issue) => issue.code)
  expect(pull.status === 3 && issues.includes('E_PENDING_TARGET'), `pull exited ${pull.status}: ${issues}`)
  rmSync(dir, { recursive: true })
  return data.files.join(', ')
})

// The offline workflow in a copy of the example, as a user runs it after npm install.
cpSync(join(example, 'kalup.config.ts'), join(project, 'kalup.config.ts'))
cpSync(join(example, 'hubspot'), join(project, 'hubspot'), { recursive: true })

check('kalup validate', () => {
  const { data } = json(['validate'], 0)
  expect(data.valid === true, JSON.stringify(data))
})

check("kalup ir: a valid ir/1 document, the example's golden IR", () => {
  const { data } = json(['ir'], 0)
  expect(validated('validateIR', data).length === 0, 'validateIR finds issues')
  const golden = readJson(join(example, 'test/fixtures/ir.json'))
  expect(isDeepStrictEqual({ ...data, generator: golden.generator }, golden), 'the IR is not the golden one')
})

check('kalup fmt --check', () => {
  const { data } = json(['fmt', '--check'], 0)
  expect(data.changed.length === 0, `would change ${data.changed}`)
})

check('kalup pull --target sandbox --check --exit-code', () => {
  const { data } = json(['pull', '--target', 'sandbox', '--check', '--exit-code'], 0)
  expect(data.files.length === 0, `would write ${data.files}`)
})

check('kalup plan --target sandbox --out plan.json: valid for validatePlan', () => {
  json(['plan', '--target', 'sandbox', '--out', 'plan.json'], 0)
  const plan = readJson(join(project, 'plan.json'))
  const issues = validated('validatePlan', plan)
  expect(issues.length === 0, `validatePlan: ${JSON.stringify(issues).slice(0, 400)}`)
  return `${plan.steps.length} steps`
})

check('kalup compare config sandbox --exit-code', () => {
  const { data } = json(['compare', 'config', 'sandbox', '--exit-code'], 0)
  expect(data.complete === true && data.counts.differs === 0, JSON.stringify(data.counts))
})

check('kalup snapshot --target sandbox: a valid ir/1 snapshot', () => {
  const { data } = json(['snapshot', '--target', 'sandbox'], 0)
  const file = join(project, data.file)
  expect(existsSync(file), `no file at ${data.file}`)
  expect(validated('validateIR', readJson(file)).length === 0, 'validateIR finds issues in the snapshot')
})

check("kalup docs: the example's data dictionary", () => {
  const out = kalup(['docs'])
  expect(out.status === 0, `exit ${out.status}: ${out.stderr}`)
  expect(out.stdout === readFileSync(join(example, 'DATA-DICTIONARY.md'), 'utf8'), 'the dictionary differs')
})

check('kalup status: both targets answer', () => {
  const { data } = json(['status'], 0)
  const seen = data.targets.map((target) => `${target.name} ${target.check}`)
  expect(isDeepStrictEqual(seen, ['sandbox ok', 'production ok']), seen.join(', '))
})

const PRODUCTION = `    production: {
      portalId: 2222222,
      protected: true,
      credentials: { read: { env: 'HUBSPOT_PROD_READ_KEY' } },
    },
`
const STAGING = `    'Staging 2': {
      portalId: 3333333,
      credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },
    },
`
const SANDBOX = `    sandbox: {
      portalId: 1111111,
      credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },
    },
`

// The config with defaultTarget where the canonical writer puts it, after name.
function withDefault(text, name) {
  return text.replace("  name: 'basic',\n", `  name: 'basic',\n  defaultTarget: '${name}',\n`)
}

// A project with the example's files and its config changed by `edit`.
function targets(name, edit) {
  const dir = join(work, name)
  cpSync(join(example, 'hubspot'), join(dir, 'hubspot'), { recursive: true })
  const config = readFileSync(join(example, 'kalup.config.ts'), 'utf8')
  const text = edit(config)
  expect(text !== config, `the ${name} edit left kalup.config.ts as it was`)
  writeFileSync(join(dir, 'kalup.config.ts'), text)
  return dir
}

check('target selection, one target: plan runs against it with no flag', () => {
  const dir = targets('one-target', (text) => text.replace(PRODUCTION, ''))
  const { data } = json(['plan'], 0, { cwd: dir })
  expect(data.target.name === 'sandbox' && data.target.portalId === 1_111_111, JSON.stringify(data.target))
  const human = kalup(['plan'], { cwd: dir })
  expect(human.stdout.startsWith('Target sandbox, portal 1111111 (the only target)\n'), human.stdout.slice(0, 200))
})

check('target selection, two targets and defaultTarget: the default, and --target wins', () => {
  const dir = targets('default-target', (text) => withDefault(text, 'production'))
  const byDefault = json(['plan'], 0, { cwd: dir }).data.target
  expect(byDefault.name === 'production' && byDefault.portalId === 2_222_222, JSON.stringify(byDefault))
  const byFlag = json(['plan', '--target', 'sandbox'], 0, { cwd: dir }).data.target
  expect(byFlag.name === 'sandbox', JSON.stringify(byFlag))
})

check('target selection, three targets and no default: E_TARGET_REQUIRED, exit 1, no prompt', () => {
  const dir = targets('three-targets', (text) => text.replace(PRODUCTION, `${PRODUCTION}${STAGING}`))
  const envelope = json(['plan'], 1, { cwd: dir })
  expect(envelope.issues[0]?.code === 'E_TARGET_REQUIRED', JSON.stringify(envelope.issues))
  const human = kalup(['plan'], { cwd: dir })
  expect(human.status === 1 && human.stderr.startsWith('E_TARGET_REQUIRED: '), `exit ${human.status}: ${human.stderr}`)
})

check('target selection, a defaultTarget that is not declared: E_DEFAULT_TARGET, exit 3', () => {
  const dir = targets('invalid-default', (text) => withDefault(text, 'staging'))
  const envelope = json(['plan'], 3, { cwd: dir })
  expect(envelope.issues[0]?.code === 'E_DEFAULT_TARGET', JSON.stringify(envelope.issues))
  const human = kalup(['plan'], { cwd: dir })
  expect(human.status === 3 && human.stderr.includes('E_DEFAULT_TARGET'), `exit ${human.status}: ${human.stderr}`)
})

check('target selection, one protected target named production: plan runs against it with no flag', () => {
  const dir = targets('only-production', (text) => text.replace(SANDBOX, ''))
  const { target } = json(['plan'], 0, { cwd: dir }).data
  const seen = [target.name, target.portalId, target.protected]
  expect(isDeepStrictEqual(seen, ['production', 2_222_222, true]), JSON.stringify(target))
  const human = kalup(['plan'], { cwd: dir })
  expect(human.stdout.startsWith('Target production, portal 2222222 (the only target)\n'), human.stdout.slice(0, 200))
})

check('fmt keeps defaultTarget: kalup.config.ts byte for byte', () => {
  const dir = targets('fmt-default', (text) => withDefault(text, 'production'))
  const before = readFileSync(join(dir, 'kalup.config.ts'), 'utf8')
  const { data } = json(['fmt'], 0, { cwd: dir, portal: false })
  expect(data.changed.length === 0, `fmt rewrote ${data.changed}`)
  expect(readFileSync(join(dir, 'kalup.config.ts'), 'utf8') === before, 'fmt changed kalup.config.ts')
})

// The installed bin in a pseudo-terminal, with the example's fake portal, typing `answers` at its prompts.
function kalupInTerminal(args, cwd, answers) {
  return inTerminal([node, '--import', fakePortal, bin, ...args], { cwd, env, answers })
}

const noTerminal = noPseudoTerminal()
if (noTerminal === undefined) {
  await check(
    'target selection, Ctrl-C at the selector in a pseudo-terminal: E_CANCELLED, exit 1, nothing written',
    async () => {
      const dir = targets('cancel', (text) => text.replace(PRODUCTION, `${PRODUCTION}${STAGING}`))
      const before = tree(dir)
      const { status, printed } = await kalupInTerminal(['plan'], dir, [{ after: 'Enter 1-', type: '\u0003' }])
      expect(!Object.values(KEYS).some((key) => printed.includes(key)), 'kalup plan printed a key')
      expect(printed.includes('Which target?'), `no selector: ${printed.slice(0, 400)}`)
      expect(
        status === 1 && printed.includes('E_CANCELLED: No target chosen.'),
        `exit ${status}: ${printed.slice(-400)}`,
      )
      expect(isDeepStrictEqual(tree(dir), before), 'the cancelled plan changed a file')
    },
  )
} else {
  check(`target selection, not cancelled at the selector (${noTerminal}): E_TARGET_REQUIRED with no terminal`, () => {
    const dir = targets('cancel', (text) => text.replace(PRODUCTION, `${PRODUCTION}${STAGING}`))
    const envelope = json(['plan'], 1, { cwd: dir })
    expect(envelope.issues[0]?.code === 'E_TARGET_REQUIRED', JSON.stringify(envelope.issues))
  })
}

// No terminal and no --yes or --approve: a person has to apply it. The fake portal throws on any write, and the
// project, state included, is byte for byte what it was.
check('kalup apply plan.json with no terminal and no flag: exit 4, humanRequired, nothing written', () => {
  const before = tree(project)
  const envelope = json(['apply', 'plan.json'], 4)
  const refusal = envelope.issues.find((issue) => issue.humanRequired === true)
  expect(envelope.ok === false && refusal !== undefined, JSON.stringify(envelope.issues))
  const human = kalup(['apply', 'plan.json'])
  expect(human.status === 4 && human.stderr.includes(`${refusal.code}: `), `exit ${human.status}: ${human.stderr}`)
  expect(isDeepStrictEqual(tree(project), before), 'apply changed a file in the project')
  return refusal.code
})

const times = []
for (let i = 0; i < RUNS; i += 1) {
  const start = performance.now()
  spawnSync(node, [bin, '--version'], { cwd: project })
  times.push(performance.now() - start)
}
times.sort((a, b) => a - b)
say(`note  startup: kalup --version, median of ${RUNS} runs: ${times[Math.floor(RUNS / 2)].toFixed(0)} ms`)
say(
  `note  installed size: node_modules ${megabytes(installedSize)}, of which kalup ${megabytes(size(installed.kalup))} and @kalup/core ${megabytes(size(installed['@kalup/core']))}`,
)

const failed = results.filter((ok) => !ok).length
say(`${results.length - failed} passed, ${failed} failed`)
if (failed === 0) {
  rmSync(work, { recursive: true, force: true })
} else {
  say(`kept ${work}`)
  process.exitCode = 1
}
