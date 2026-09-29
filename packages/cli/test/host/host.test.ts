import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, test, vi } from 'vitest'
import { bin, disclaimer } from '../../src/brand.js'
import { broken, cli, copy, empty, host, parseEnvelope, project } from '../../src/commands/testing.js'
import { fakeFetch, fixture, jsonResponse } from '../../src/lib/testing.js'
import { formats, version, versionText } from '../../src/version.js'
import { printed } from '../support/printed.js'

const key = 'kalup-test-secret-9f2c'
const oneUnexpectedLine = /^E_UNEXPECTED: [^\n]+\n$/
const blueprintTopic = /^ {2}blueprint {2}\S/m
const built = [
  'init',
  'pull',
  'validate',
  'ir',
  'fmt',
  'status',
  'compare',
  'plan',
  'snapshot',
  'docs',
  'apply',
  'rm',
  'add',
]
const dist = fileURLToPath(new URL('../../dist/', import.meta.url))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

/** A copy of the valid project indented twice as deep: the same meaning, not canonical, so fmt --check differs. */
function unformatted(): string {
  const dir = copy('valid')
  for (const file of ['kalup.config.ts', 'kalup/objects/companies.ts']) {
    const path = join(dir, file)
    writeFileSync(
      path,
      readFileSync(path, 'utf8').replace(/^ +/gm, (indent) => indent + indent),
    )
  }
  return dir
}

// Help

test.each([[[]], [['--help']], [['-h']]])(
  'the root help lists every command and ends with the disclaimer: %j',
  async (argv) => {
    const out = await cli(project('valid'), ...argv)
    expect(out.exitCode).toBe(0)
    expect(out.stderr).toBe('')
    const lines = out.stdout.split('\n')
    for (const id of built) {
      const line = lines.find((text) => text.trimStart().startsWith(`${id} `))
      expect(line, id).toBeDefined()
      expect(line?.endsWith('(not implemented yet)'), id).toBe(false)
    }
    expect(out.stdout.trimEnd().endsWith(disclaimer)).toBe(true)
  },
)

test('command help comes from the command definition and lists only its own flags', async () => {
  const validate = await cli(project('valid'), 'validate', '--help')
  expect(validate.exitCode).toBe(0)
  expect(validate.stdout).toContain('--target=<name>')
  expect(validate.stdout).toContain('--json')
  expect(validate.stdout).not.toContain('--portal')
  const pull = await cli(project('valid'), '--help', 'pull')
  expect(pull.stdout).toContain('--only=<glob>')
  expect(pull.stdout).toContain('--discover')
  expect(pull.stdout).toContain('--exit-code')
  expect(pull.stdout.trimEnd().endsWith(disclaimer)).toBe(true)
  const compare = await cli(project('valid'), 'compare', '--help')
  expect(compare.stdout).toContain('kalup compare A B')
  expect(compare.stdout).toContain('--exit-code')
  expect(compare.stdout).not.toContain('--target')
  const plan = await cli(project('valid'), 'plan', '--help')
  expect(plan.stdout).toContain('--target=<name>')
  expect(plan.stdout).toContain('--out=<file>')
  const docs = await cli(project('valid'), 'docs', '--help')
  expect(docs.stdout).toContain('kalup docs [SOURCE]')
  expect(docs.stdout).toContain('--out=<file>')
  expect(docs.stdout).not.toContain('--target')
})

test.each([[[]], [['--help']], [['-h']], [['validate', '--help']], [['--help', 'pull']], [['deploy', '--help']]])(
  '--json help is one envelope whose data.usage is the human help: %j',
  async (argv) => {
    const human = await cli(project('valid'), ...argv)
    const out = await cli(project('valid'), ...argv, '--json')
    expect(out.exitCode).toBe(0)
    expect(out.stderr).toBe('')
    expect(parseEnvelope(out.stdout)).toEqual({
      format: 'envelope/1',
      ok: true,
      data: { usage: human.stdout.slice(0, -1) },
      issues: [],
    })
  },
)

test('--help naming an unknown command shows the root help', async () => {
  const root = await cli(project('valid'))
  const out = await cli(project('valid'), 'deploy', '--help')
  expect(out.exitCode).toBe(0)
  expect(out.stdout).toBe(root.stdout)
})

// Version

test.each([[['--version']], [['validate', '--version']]])(
  '--version prints the name, the version and the disclaimer: %j',
  async (argv) => {
    vi.stubEnv('HUBSPOT_SERVICE_KEY', key)
    const out = await cli(project('valid'), ...argv)
    expect(out.exitCode).toBe(0)
    expect(out.stdout).toBe(versionText())
    expect(out.stdout).not.toContain(key)
  },
)

test.each([[['--version', '--json']], [['--json', '--version']]])('%j prints one envelope', async (argv) => {
  const out = await cli(project('valid'), ...argv)
  expect(out.exitCode).toBe(0)
  expect(out.stderr).toBe('')
  expect(parseEnvelope(out.stdout)).toEqual({
    format: 'envelope/1',
    ok: true,
    data: { name: bin, version, disclaimer, formats: [...formats] },
    issues: [],
  })
})

test('--version --json lists the format versions this version reads and writes, so a tool can check', async () => {
  const out = await cli(project('valid'), '--version', '--json')
  expect(parseEnvelope<{ formats: string[] }>(out.stdout).data?.formats).toEqual([
    'ir/1',
    'plan/1',
    'kalup.state/1',
    'envelope/1',
    'blueprint/1',
    'blueprints-lock/1',
  ])
})

// Flag positions

test('flags may come before or after the command, and --flag=value works', async () => {
  const expected = (await cli(project('valid'), 'validate', '--json', '--target', 'sandbox')).stdout
  const argvs = [
    ['--json', 'validate', '--target', 'sandbox'],
    ['--target', 'sandbox', 'validate', '--json'],
    ['validate', '--target=sandbox', '--json'],
    ['--target=sandbox', '--json', 'validate'],
  ]
  // Concurrent on purpose: the runner keeps no state between invocations.
  const outs = await Promise.all(argvs.map((argv) => cli(project('valid'), ...argv)))
  outs.forEach((out, index) => {
    expect(out.exitCode, argvs[index]?.join(' ')).toBe(0)
    expect(out.stdout, argvs[index]?.join(' ')).toBe(expected)
  })
})

// Usage errors: exit 1, E_USAGE, the relevant help on stderr in human mode, one envelope and no stderr with --json.

const usageErrors: [string, string[], string, string][] = [
  ['unknown command', ['deploy'], "unknown command 'deploy'", 'COMMANDS'],
  ['Object.prototype name', ['toString'], "unknown command 'toString'", 'COMMANDS'],
  ['Object.prototype name', ['constructor'], "unknown command 'constructor'", 'COMMANDS'],
  ['unknown flag without a command', ['--bogus'], 'unknown flag --bogus', 'COMMANDS'],
  ['command flag without a command', ['--target', 'sandbox'], '--target needs a command', 'COMMANDS'],
  ['command flag without a command', ['--target=sandbox'], '--target needs a command', 'COMMANDS'],
  ['command flag without a command', ['--check'], '--check needs a command', 'COMMANDS'],
  ['command flag without a command or value', ['--target'], '--target needs a command', 'COMMANDS'],
  ['a shortcut where the value goes', ['--target', '--help'], '--target needs a command', 'COMMANDS'],
  ['--version with an unknown flag', ['--bogus', '--version'], 'unknown flag --bogus', 'COMMANDS'],
  ['--help with an unknown flag', ['--help', '--bogus'], 'unknown flag --bogus', 'COMMANDS'],
  ['-h with a command flag', ['-h', '--portal', '1'], '--portal needs a command', 'COMMANDS'],
  ['unexpected positional', ['fmt', 'check'], "unexpected argument 'check'", '--exit-code'],
  ['missing compare side', ['compare', 'config'], 'missing argument B', 'kalup compare A B'],
  ['missing compare sides', ['compare'], 'missing arguments A, B', 'kalup compare A B'],
  ['extra compare side', ['compare', 'config', 'sandbox', 'staging'], "unexpected argument 'staging'", '--exit-code'],
  ['extra docs source', ['docs', 'config', 'other.json'], "unexpected argument 'other.json'", '--out=<file>'],
  ['positional to plan', ['plan', 'sandbox'], "unexpected argument 'sandbox'", '--target=<name>'],
  ['--out without its value', ['docs', '--out'], 'Flag --out expects a value', '--out=<file>'],
  [
    '--out with an empty value',
    ['plan', '--target', 'sandbox', '--out', ''],
    'Flag --out expects a value',
    '--out=<file>',
  ],
  [
    'a flag where --out needs a value',
    ['snapshot', '--out', '--target', 'sandbox'],
    'Flag --out expects a value',
    '--out=<file>',
  ],
  [
    'flag of another command',
    ['compare', 'config', 'sandbox', '--target', 'sandbox'],
    'unknown flag --target',
    '--exit-code',
  ],
  ['unknown flag', ['validate', '--strict'], 'unknown flag --strict', '--target=<name>'],
  ['flag of another command', ['ir', '--target', 'sandbox'], 'unknown flag --target', '--check'],
  [
    'flag of another command',
    ['pull', '--target', 'sandbox', '--portal', '1'],
    'unknown flag --portal',
    '--only=<glob>',
  ],
  ['missing value at the end', ['validate', '--target'], 'Flag --target expects a value', '--target=<name>'],
  [
    'a flag where the value goes',
    ['validate', '--target', '--check'],
    'Flag --target expects a value',
    '--target=<name>',
  ],
  ['empty value', ['validate', '--target', ''], 'Flag --target expects a value', '--target=<name>'],
  [
    'repeated flag',
    ['validate', '--target', 'a', '--target', 'b'],
    'Flag --target can only be specified once',
    '--target=<name>',
  ],
]

test.each(usageErrors)('usage error, %s: %j', async (_name, argv, message, helpMark) => {
  const dir = copy('valid')
  const human = await cli(dir, ...argv)
  expect(human.exitCode).toBe(1)
  expect(human.stdout).toBe('')
  expect(human.stderr).toContain(`E_USAGE: ${message}`)
  expect(human.stderr).toContain(helpMark)
  const json = await cli(dir, ...argv, '--json')
  expect(json.exitCode).toBe(1)
  expect(json.stderr).toBe('')
  expect(parseEnvelope(json.stdout)).toEqual({
    format: 'envelope/1',
    ok: false,
    issues: [{ code: 'E_USAGE', message, fix: `run ${bin} --help`, docs: 'errors/E_USAGE.md' }],
  })
})

test('a rejected fmt rewrites nothing', async () => {
  const dir = unformatted()
  const before = readFileSync(join(dir, 'kalup/objects/companies.ts'), 'utf8')
  await cli(dir, 'fmt', 'check')
  expect(readFileSync(join(dir, 'kalup/objects/companies.ts'), 'utf8')).toBe(before)
})

test('apply help names the plan file argument and its approval flags', async () => {
  const help = await cli(project('valid'), 'apply', '--help')
  expect(help.exitCode).toBe(0)
  expect(help.stdout).toContain('kalup apply [PLAN]')
  for (const flag of [
    '--target=<name>',
    '--take=config <address[#unit]>',
    '--yes',
    '--approve=<writesHash>',
    '--json',
  ]) {
    expect(help.stdout, flag).toContain(flag)
  }
})

test.each([
  [['plan.json', '--target', 'sandbox'], '--target is not accepted with a plan file'],
  [['plan.json', '--take', 'config', 'property:companies/name'], '--take belongs to kalup plan'],
  [['--approve', `sha256:${'0'.repeat(64)}`], '--approve applies a saved plan file'],
  [['plan.json', '--yes', '--approve', `sha256:${'0'.repeat(64)}`], '--yes and --approve'],
])('apply %j is E_USAGE before anything is read', async (argv, message) => {
  const out = await cli(project('valid'), 'apply', ...argv, '--json')
  expect(out.exitCode).toBe(1)
  const [issue] = parseEnvelope(out.stdout).issues
  expect(issue?.code).toBe('E_USAGE')
  expect(issue?.message).toContain(message)
})

test('state and target are topics: a space separates the command, their help lists it, and a typo is E_USAGE', async () => {
  const root = await cli(project('valid'), '--help')
  expect(printed(root)).toMatchInlineSnapshot(`
    "Kalup: configuration as code for HubSpot.

    VERSION
      kalup/<version> <machine>

    USAGE
      $ kalup [COMMAND]

    TOPICS
      blueprint  Upgrade a blueprint added with kalup add.
      state      Inspect and rebuild the state file of a target's portal.
      target     Change a target's portal.

    COMMANDS
      add       Write a blueprint from a JSON file or https URL into the config files. Never touches a
                portal.
      apply     Apply a saved plan to its target, or plan and apply an unprotected target in one run.
      compare   Compare two sides: what would change in B to match A.
      docs      Write a Markdown data dictionary of the config or a snapshot.
      fmt       Rewrite config files in canonical form.
      init      Create kalup.config.ts and pull the first target.
      ir        Print the IR document derived from the config files.
      plan      Show what apply would change on a target.
      pull      Read a target and write kalup/objects/*.ts.
      rm        Take a property or group out of config and write its tombstone in kalup/removed.ts.
      snapshot  Save a read of a target as a snapshot file.
      status    Show targets, portal checks and state.
      validate  Check the config files and report every issue.

    Kalup is an independent open-source project maintained by Scopious. It is not affiliated with, endorsed by, or sponsored by HubSpot, Inc. HubSpot is a registered trademark of HubSpot, Inc.
    "
  `)
  const alone = await cli(project('valid'), 'state')
  expect(alone.exitCode).toBe(0)
  expect(alone.stdout).toContain('$ kalup state COMMAND')
  expect(alone.stdout).toContain('  state rebuild  ')
  expect((await cli(project('valid'), 'state', '--help')).stdout).toBe(alone.stdout)
  const rebuild = await cli(project('valid'), 'state', 'rebuild', '--help')
  expect(rebuild.stdout).toContain('kalup state rebuild [--json] [--target <name>] [--write]')
  const rebind = await cli(project('valid'), 'target', 'rebind', '--help', '--json')
  expect(rebind.exitCode).toBe(0)
  expect(parseEnvelope<{ usage: string }>(rebind.stdout).data?.usage ?? '').toContain(
    'kalup target rebind TARGET [--json] [--portal <id>]',
  )
  const typo = await cli(project('valid'), 'state', 'rebuidl', '--json')
  expect(typo.exitCode).toBe(1)
  expect(parseEnvelope(typo.stdout).issues[0]).toMatchObject({
    code: 'E_USAGE',
    message: "unknown command 'state rebuidl'",
  })
  const missing = await cli(project('valid'), 'target', 'rebind', '--json')
  expect(missing.exitCode).toBe(1)
  expect(parseEnvelope(missing.stdout).issues[0]).toMatchObject({ code: 'E_USAGE', message: 'missing argument TARGET' })
})

test('blueprint is a topic: blueprint upgrade takes a name and a source, and add takes a source', async () => {
  const root = await cli(project('valid'), '--help')
  expect(root.stdout).toMatch(blueprintTopic)
  const upgrade = await cli(project('valid'), 'blueprint', 'upgrade', '--help')
  expect(upgrade.exitCode).toBe(0)
  expect(upgrade.stdout).toContain('kalup blueprint upgrade NAME SOURCE')
  expect(upgrade.stdout).toContain('--take=remote <address[#unit]>')
  const missing = await cli(project('valid'), 'blueprint', 'upgrade', 'acme/renewals', '--json')
  expect(missing.exitCode).toBe(1)
  expect(parseEnvelope(missing.stdout).issues[0]).toMatchObject({ code: 'E_USAGE', message: 'missing argument SOURCE' })
  const add = await cli(project('valid'), 'add', '--json')
  expect(parseEnvelope(add.stdout).issues[0]).toMatchObject({ code: 'E_USAGE', message: 'missing argument SOURCE' })
})

// Exit codes

test('invalid config exits 3 with ok false', async () => {
  const human = await cli(project('invalid'), 'validate')
  expect(human.exitCode).toBe(3)
  const json = await cli(project('invalid'), 'validate', '--json')
  expect(json.exitCode).toBe(3)
  expect(parseEnvelope(json.stdout).ok).toBe(false)
})

test('differences exit 2 only with --exit-code, and stay ok: true', async () => {
  const dir = unformatted()
  expect((await cli(dir, 'fmt', '--check')).exitCode).toBe(0)
  expect((await cli(dir, 'fmt', '--check', '--exit-code')).exitCode).toBe(2)
  const json = await cli(dir, 'fmt', '--check', '--exit-code', '--json')
  expect(json.exitCode).toBe(2)
  expect(parseEnvelope(json.stdout).ok).toBe(true)
})

test('a portal mismatch exits 4 with humanRequired, after only the account-info request', async () => {
  vi.stubEnv('HUBSPOT_PROD_READ_KEY', key)
  const fake = fakeFetch(jsonResponse(200, { ...fixture('account-info.json'), portalId: 3_333_333 }))
  vi.stubGlobal('fetch', fake.fetch)
  const out = await cli(project('status'), 'status', '--target', 'production', '--json')
  expect(out.exitCode).toBe(4)
  const issue = parseEnvelope(out.stdout).issues.find((found) => found.code === 'E_TARGET_PORTAL_MISMATCH')
  expect(issue?.humanRequired).toBe(true)
  expect(fake.calls).toHaveLength(1)
  expect(out.stdout).not.toContain(key)
})

test('an unexpected error exits 1 with one sanitized line', async () => {
  const dir = broken()
  const human = await cli(dir, 'validate')
  expect(human.exitCode).toBe(1)
  expect(human.stdout).toBe('')
  expect(human.stderr).toMatch(oneUnexpectedLine)
  const json = await cli(dir, 'validate', '--json')
  expect(json.exitCode).toBe(1)
  expect(json.stderr).toBe('')
  expect(parseEnvelope(json.stdout).issues.map((issue) => issue.code)).toEqual(['E_UNEXPECTED'])
})

// biome-ignore lint/suspicious/noControlCharactersInRegex: the test looks for the control characters it planted
const controls = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/
const hostilePath = 'snaps/x\u001b]0;TITLE\u0007\u001b[2Jy\u009b31m.json'

// A directory holding a file that is not JSON under the hostile path.
function hostileDir(): string {
  const dir = empty()
  mkdirSync(join(dir, 'snaps'))
  writeFileSync(join(dir, hostilePath), 'not json\n')
  return dir
}

test.each([
  ['a file that is not JSON', ['docs', hostilePath]],
  ['a missing file', ['docs', `${hostilePath}.missing`]],
  ['a compare side that is no file', ['compare', 'x.json', `${hostilePath}.missing`]],
])('a text-mode issue line strips control characters from the file it names: %s', async (_, argv) => {
  const human = await cli(hostileDir(), ...argv)
  expect(human.exitCode).toBe(1)
  expect(human.stderr).toContain('E_SNAPSHOT: ')
  expect(controls.test(human.stderr), JSON.stringify(human.stderr)).toBe(false)
})

test('--json keeps the file of an issue exact', async () => {
  const json = await cli(hostileDir(), 'docs', hostilePath, '--json')
  expect(parseEnvelope(json.stdout).issues[0]?.file).toBe(hostilePath)
})

test('without a TTY nothing prompts: init without --portal fails at once and sends nothing', async () => {
  const fake = fakeFetch()
  vi.stubGlobal('fetch', fake.fetch)
  const out = await cli(empty(), 'init', '--json')
  expect(out.exitCode).toBe(1)
  expect(parseEnvelope(out.stdout).issues[0]?.code).toBe('E_USAGE')
  expect(fake.calls).toHaveLength(0)
})

// The runner as a library: repeated and concurrent calls with their own cwd and streams.

test('repeated and concurrent runner calls keep their own cwd and output, and never exit the process', async () => {
  const exit = vi.spyOn(process, 'exit')
  const [valid, invalid] = await Promise.all([
    cli(project('valid'), 'validate', '--json'),
    cli(project('invalid'), 'validate'),
  ])
  expect(valid.exitCode).toBe(0)
  expect(parseEnvelope(valid.stdout).ok).toBe(true)
  expect(valid.stderr).toBe('')
  expect(invalid.exitCode).toBe(3)
  expect(invalid.stdout).not.toContain('envelope/1')
  expect((await cli(project('valid'), 'validate', '--json')).stdout).toBe(valid.stdout)
  expect((await cli(project('valid'), 'deploy')).exitCode).toBe(1)
  expect((await cli(project('valid'), 'validate')).exitCode).toBe(0)
  expect(exit).not.toHaveBeenCalled()
  expect(process.exitCode ?? 0).toBe(0)
  exit.mockRestore()
})

test.each([
  { stdin: true, stderr: true, env: {}, interactive: true },
  { stdin: true, stderr: false, env: {}, interactive: false },
  { stdin: false, stderr: true, env: {}, interactive: false },
  { stdin: false, stderr: false, env: {}, interactive: false },
  { stdin: undefined, stderr: undefined, env: {}, interactive: false },
  { stdin: true, stderr: true, env: { CI: '1' }, interactive: false },
  { stdin: true, stderr: true, env: { CI: 'true' }, interactive: false },
])(
  'a person is at a terminal only when stdin and stderr are terminals and CI is not set: $stdin, $stderr, $env',
  ({ stdin, stderr, env, interactive }) => {
    expect(host().isInteractive({ isTTY: stdin }, { isTTY: stderr }, env)).toBe(interactive)
  },
)

test('execute returns the result without printing', async () => {
  const result = await host().execute(['validate'], project('valid'))
  expect(result.data).toEqual({ valid: true, counts: { errors: 0, warnings: 0 } })
})

test.each([[['validate']], [['ir']], [['ir', '--check']], [['fmt']], [['fmt', '--check']], [['docs']]])(
  'validate, ir, fmt and docs send no request at all: %j',
  async (argv) => {
    const fake = fakeFetch()
    vi.stubGlobal('fetch', fake.fetch)
    await cli(copy('valid'), ...argv)
    expect(fake.calls).toHaveLength(0)
  },
)

// Success, exit 3, E_NO_CONFIG, E_USAGE and E_UNEXPECTED, each with and without --json.
const projects: Record<string, () => string> = {
  valid: () => copy('valid'),
  invalid: () => copy('invalid'),
  warned: () => copy('warned'),
  empty,
  broken,
}
const argvs = [
  ['validate'],
  ['ir'],
  ['fmt'],
  ['deploy'],
  ['fmt', 'extra'],
  ['toString'],
  ['validate', '--bogus'],
].flatMap((argv) => [argv, [...argv, '--json']])

test.each(Object.entries(projects).flatMap(([name, make]) => argvs.map((argv) => ({ name, make, argv }))))(
  'no output of any code path carries the key: $name project, $argv',
  async ({ make, argv }) => {
    vi.stubEnv('HUBSPOT_SERVICE_KEY', key)
    const dir = make()
    writeFileSync(join(dir, '.env'), `HUBSPOT_SANDBOX_KEY=${key}\n`)
    const out = await cli(dir, ...argv)
    expect(`${out.stdout}${out.stderr}`, argv.join(' ')).not.toContain(key)
  },
)

// The executable: only a spawn proves the bin entry, its exit status and its discovery from dist/.

function spawn(...argv: string[]): { status: number | null; stdout: string; stderr: string } {
  const out = spawnSync(process.execPath, [join(dist, 'index.mjs'), ...argv], {
    cwd: project('valid'),
    encoding: 'utf8',
  })
  return { status: out.status, stdout: out.stdout, stderr: out.stderr }
}

test('the built executable prints the version, the help, and sets its exit status', () => {
  expect(spawn('--version').stdout).toBe(versionText())
  const help = spawn('--help')
  expect(help.status).toBe(0)
  expect(help.stdout).toContain('validate')
  const bad = spawn('validate', '--bogus', '--json')
  expect(bad.status).toBe(1)
  expect(bad.stderr).toBe('')
  expect(JSON.parse(bad.stdout).issues[0].code).toBe('E_USAGE')
  expect(spawn('validate').status).toBe(0)
})
