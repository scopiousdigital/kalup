// Target selection through the built host: the flag, defaultTarget or the only target, a prompt only for a
// person at a terminal, and E_TARGET_REQUIRED, E_CANCELLED, E_DEFAULT_TARGET and E_NO_TARGETS before any request.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { Plan } from '@kalup/core'
import { afterEach, expect, test, vi } from 'vitest'
import type { PullData } from '../../src/commands/pull.js'
import type { SnapshotData } from '../../src/commands/snapshot.js'
import { cli, copy, parseEnvelope } from '../../src/commands/testing.js'
import { planText } from '../../src/engine/plan.js'
import { fixture } from '../../src/lib/testing.js'
import { type Bodies, key, orchard, portal, refused, routes, tree } from './orchard.js'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const commands = ['pull', 'plan', 'snapshot'] as const
type Command = (typeof commands)[number]

// One read key per target of the three-target project, each answering for its own portal.
const keys = { acme: 'kalup-test-secret-a1c3', client: 'kalup-test-secret-b2d4', staging: 'kalup-test-secret-c3e5' }
const three = [
  "    'acme-eu': { portalId: 1111111, credentials: { read: { env: 'HUBSPOT_ACME_KEY' } } },",
  "    client_b: { portalId: 2222222, credentials: { read: { env: 'HUBSPOT_CLIENT_KEY' } } },",
  "    'Staging 2': { portalId: 3333333, credentials: { read: { env: 'HUBSPOT_STAGING_KEY' } } },",
]
const listed = 'acme-eu (portal 1111111), client_b (portal 2222222), Staging 2 (portal 3333333)'
// One issue line in text mode: the code, the message and fix, and the page.
const requiredLine = /^E_TARGET_REQUIRED: [^\n]*\(docs: errors\/E_TARGET_REQUIRED\.md\)\n$/
const cancelledLine = /\nE_CANCELLED: [^\n]*\(docs: errors\/E_CANCELLED\.md\)\n$/
const required = {
  code: 'E_TARGET_REQUIRED',
  message: expect.stringContaining(listed),
  configPath: 'targets',
  fix: expect.stringMatching(/--target <name>.*ask the user/),
  docs: 'errors/E_TARGET_REQUIRED.md',
}
const production = "    production: { portalId: 2222222, credentials: { read: { env: 'HUBSPOT_PROD_READ_KEY' } } },"
const prodKey = 'kalup-test-secret-7b19'
// biome-ignore lint/suspicious/noControlCharactersInRegex: the test looks for the control characters it planted
const controls = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/

/** The orchard portal answering as the portal `portalId`. */
function at(portalId: number): Bodies {
  return { ...orchard(), [routes.account]: { ...fixture('account-info.json'), portalId } }
}

/** A copy of the pull project with these target lines, and `head` lines (defaultTarget) after its name. */
function project(targets: string[], head: string[] = []): string {
  const dir = copy('pull')
  const lines = [
    "import { defineConfig } from 'kalup'",
    '',
    'export default defineConfig({',
    "  name: 'orchard-crm',",
    ...head,
    '  objects: {',
    "    companies: { include: ['name', 'lifecyclestage'] },",
    '    harvest: {},',
    '  },',
    ...(targets.length > 0 ? ['  targets: {', ...targets, '  },'] : []),
    '})',
    '',
  ]
  writeFileSync(join(dir, 'kalup.config.ts'), lines.join('\n'))
  return dir
}

/** The three-target project and a portal per key, each key set in its variable. */
function threeTargets(head: string[] = []): { dir: string; sent: ReturnType<typeof portal> } {
  const sent = portal({ [keys.acme]: at(1_111_111), [keys.client]: at(2_222_222), [keys.staging]: at(3_333_333) })
  vi.stubEnv('HUBSPOT_ACME_KEY', keys.acme)
  vi.stubEnv('HUBSPOT_CLIENT_KEY', keys.client)
  vi.stubEnv('HUBSPOT_STAGING_KEY', keys.staging)
  return { dir: project(three, head), sent }
}

/** A person at a terminal typing `input`, then the end of input. */
function terminal(cwd: string, input: string) {
  return { cwd, interactive: true, stdin: Readable.from(input === '' ? [] : [input]) }
}

/** The target and portal a command's data names. */
function targetOf(command: Command, data: unknown): [string, number] {
  if (command === 'plan') {
    const { name, portalId } = (data as Plan).target
    return [name, portalId]
  }
  const { target, portalId } = data as PullData | SnapshotData
  return [target, portalId]
}

// The one clock snapshot reads, fixed, so two snapshots of one portal write the same file and text.
function fixClock(): void {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-24T08:00:00.000Z'))
}

test.each(commands)(
  'one target and no flag: %s sends exactly the requests of --target and names the only target',
  async (command) => {
    fixClock()
    const flagged = portal()
    const withFlag = await cli(copy('pull'), command, '--target', 'sandbox')
    expect(withFlag.exitCode).toBe(0)
    const bare = portal()
    const without = await cli(copy('pull'), command)
    expect(without.exitCode).toBe(0)
    expect(bare.calls).toEqual(flagged.calls)
    expect(bare.keys).toEqual(flagged.keys)
    expect(without.stderr).toBe(withFlag.stderr)
    // pull always names its target; plan and snapshot do when the flag did not.
    const head = 'Target sandbox, portal 1111111'
    const rest = command === 'pull' ? withFlag.stdout.slice(`${head}\n`.length) : withFlag.stdout
    if (command === 'pull') {
      expect(withFlag.stdout.startsWith(`${head}\n`)).toBe(true)
    }
    expect(without.stdout).toBe(`${head} (the only target)\n${rest}`)

    portal()
    const json = await cli(copy('pull'), command, '--json')
    portal()
    const flaggedJson = await cli(copy('pull'), command, '--target', 'sandbox', '--json')
    // JSON carries the target in the command's data and nothing else.
    expect(parseEnvelope(json.stdout)).toEqual(parseEnvelope(flaggedJson.stdout))
    expect(targetOf(command, parseEnvelope(json.stdout).data)).toEqual(['sandbox', 1_111_111])
  },
)

test.each(commands)(
  'two targets and defaultTarget: %s uses the default, and --target of the other wins',
  async (command) => {
    const dir = project(
      ["    sandbox: { portalId: 1111111, credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } } },", production],
      ["  defaultTarget: 'production',"],
    )
    vi.stubEnv('HUBSPOT_PROD_READ_KEY', prodKey)
    const byDefault = portal({ [key]: orchard(), [prodKey]: at(2_222_222) })
    const json = await cli(dir, command, '--json')
    expect(json.exitCode).toBe(0)
    expect(targetOf(command, parseEnvelope(json.stdout).data)).toEqual(['production', 2_222_222])
    expect(byDefault.keys.length).toBeGreaterThan(0)
    expect(new Set(byDefault.keys)).toEqual(new Set([prodKey]))

    const byFlag = portal({ [key]: orchard(), [prodKey]: at(2_222_222) })
    const other = await cli(dir, command, '--target', 'sandbox', '--json')
    expect(other.exitCode).toBe(0)
    expect(targetOf(command, parseEnvelope(other.stdout).data)).toEqual(['sandbox', 1_111_111])
    expect(new Set(byFlag.keys)).toEqual(new Set([key]))

    portal({ [key]: orchard(), [prodKey]: at(2_222_222) })
    const human = await cli(dir, command)
    expect(human.exitCode).toBe(0)
    expect(human.stdout.startsWith('Target production, portal 2222222 (defaultTarget)\n')).toBe(true)
  },
)

test.each(
  commands.flatMap((command) => [
    { command, json: false },
    { command, json: true },
  ]),
)(
  'three targets, no default, no terminal: $command (--json $json) is E_TARGET_REQUIRED naming each target, before any request or write',
  async ({ command, json }) => {
    const { dir, sent } = threeTargets()
    const before = tree(dir)
    const out = await cli(dir, command, ...(json ? ['--json'] : []))
    expect(out.exitCode).toBe(1)
    expect(sent.calls).toEqual([])
    expect(tree(dir)).toEqual(before)
    if (json) {
      expect(out.stderr).toBe('')
      expect(parseEnvelope(out.stdout)).toEqual({ format: 'envelope/1', ok: false, issues: [required] })
    } else {
      expect(out.stdout).toBe('')
      expect(out.stderr).toMatch(requiredLine)
      expect(out.stderr).toContain(listed)
    }
  },
)

test('at a terminal, several targets and none selected ask on stderr, and the answer is the target', async () => {
  const { dir } = threeTargets()
  const flagged = parseEnvelope<Plan>((await cli(dir, 'plan', '--target', 'client_b', '--json')).stdout).data as Plan
  const { sent } = threeTargets()
  const out = await cli(terminal(dir, '2\n'), 'plan')
  expect(out.exitCode).toBe(0)
  expect(new Set(sent.keys)).toEqual(new Set([keys.client]))
  // stdout holds the command's text alone; the question, the choices and the prompt are on stderr.
  expect(out.stdout).toBe(`Target client_b, portal 2222222 (chosen)\n${planText(flagged)}`)
  expect(
    out.stderr.startsWith(
      [
        'Which target?',
        '  1) acme-eu  portal 1111111',
        '  2) client_b  portal 2222222',
        '  3) Staging 2  portal 3333333',
        'Enter 1-3 or a name: ',
      ].join('\n'),
    ),
  ).toBe(true)
  expect(out.stdout).not.toContain('Which target?')
})

test.each([
  ['the exact name', 'Staging 2\n', 'Staging 2', 3_333_333],
  ['a number with spaces around it', ' 1 \n', 'acme-eu', 1_111_111],
  ['a wrong answer, then a number', 'bogus\n2\n', 'client_b', 2_222_222],
  ['two wrong answers, then a name', '0\n4\nclient_b\n', 'client_b', 2_222_222],
])('at a terminal, %s selects the target', async (_name, input, name, portalId) => {
  const { dir, sent } = threeTargets()
  const out = await cli(terminal(dir, input), 'plan')
  expect(out.exitCode).toBe(0)
  expect(out.stdout.startsWith(`Target ${name}, portal ${portalId} (chosen)\n`)).toBe(true)
  expect(sent.keys.length).toBeGreaterThan(0)
  const wrong = input.split('\n').length - 2
  expect(out.stderr.split('Enter 1-3 or a name: ').length - 1).toBe(wrong + 1)
  expect(out.stderr.split('is not one of the 3 choices.').length - 1).toBe(wrong)
  if (input.startsWith('bogus')) {
    expect(out.stderr).toContain("'bogus' is not one of the 3 choices.\n")
  }
})

test.each(
  commands.flatMap((command) => [
    { command, how: 'the end of input', input: '' },
    { command, how: 'three wrong answers', input: 'bogus\n9\nnope\n' },
  ]),
)(
  'at a terminal, $command cancelled by $how is E_CANCELLED before any request or write',
  async ({ command, input }) => {
    const { dir, sent } = threeTargets()
    const before = tree(dir)
    const out = await cli(terminal(dir, input), command)
    expect(out.exitCode).toBe(1)
    expect(out.stdout).toBe('')
    expect(out.stderr).toContain('Which target?\n')
    expect(out.stderr).toMatch(cancelledLine)
    expect(sent.calls).toEqual([])
    expect(tree(dir)).toEqual(before)
  },
)

test.each(commands)(
  'a terminal with --json never prompts: %s is E_TARGET_REQUIRED and stdin stays unread',
  async (command) => {
    const { dir, sent } = threeTargets()
    const stdin = Readable.from(['2\n'])
    const out = await cli({ cwd: dir, interactive: true, stdin }, command, '--json')
    expect(out.exitCode).toBe(1)
    expect(out.stderr).toBe('')
    expect(parseEnvelope(out.stdout)).toEqual({ format: 'envelope/1', ok: false, issues: [required] })
    expect(sent.calls).toEqual([])
    expect(stdin.readableFlowing).toBe(null)
  },
)

test('a terminal is never asked when the rule selects: the flag, the default and the only target', async () => {
  const { dir, sent } = threeTargets(["  defaultTarget: 'Staging 2',"])
  const byDefault = terminal(dir, '1\n')
  const out = await cli(byDefault, 'plan')
  expect(out.exitCode).toBe(0)
  expect(out.stdout.startsWith('Target Staging 2, portal 3333333 (defaultTarget)\n')).toBe(true)
  expect(out.stderr).not.toContain('Which target?')
  expect(new Set(sent.keys)).toEqual(new Set([keys.staging]))
  expect(byDefault.stdin.readableFlowing).toBe(null)
  const byFlag = threeTargets()
  const flaggedTerminal = terminal(dir, '1\n')
  const flagged = await cli(flaggedTerminal, 'plan', '--target', 'client_b')
  expect(flagged.exitCode).toBe(0)
  expect(flagged.stdout.startsWith('Plan ')).toBe(true)
  expect(flagged.stderr).not.toContain('Which target?')
  expect(new Set(byFlag.sent.keys)).toEqual(new Set([keys.client]))
  expect(flaggedTerminal.stdin.readableFlowing).toBe(null)
  portal()
  const onlyTerminal = terminal(copy('pull'), '1\n')
  const only = await cli(onlyTerminal, 'plan')
  expect(only.exitCode).toBe(0)
  expect(only.stdout.startsWith('Target sandbox, portal 1111111 (the only target)\n')).toBe(true)
  expect(only.stderr).not.toContain('Which target?')
  expect(onlyTerminal.stdin.readableFlowing).toBe(null)
})

test.each(commands)(
  'an invalid defaultTarget is E_DEFAULT_TARGET, exit 3, before any request, with or without --target: %s',
  async (command) => {
    const { dir, sent } = threeTargets(["  defaultTarget: 'acme',"])
    const issue = {
      code: 'E_DEFAULT_TARGET',
      message: expect.stringContaining("defaultTarget 'acme'"),
      file: 'kalup.config.ts',
      line: 5,
      configPath: 'defaultTarget',
      fix: expect.stringContaining('acme-eu, client_b, Staging 2'),
      docs: 'errors/E_DEFAULT_TARGET.md',
    }
    const bare = await cli(dir, command, '--json')
    expect(bare.exitCode).toBe(3)
    expect(parseEnvelope(bare.stdout).issues).toEqual([issue])
    const flagged = await cli(dir, command, '--target', 'client_b', '--json')
    expect(flagged.exitCode).toBe(3)
    expect(parseEnvelope(flagged.stdout).issues).toEqual([issue])
    expect(sent.calls).toEqual([])
  },
)

test.each(commands)('no targets is E_NO_TARGETS, exit 3, before any request: %s', async (command) => {
  const sent = portal()
  const dir = project([])
  const out = await cli(dir, command, '--json')
  expect(out.exitCode).toBe(3)
  expect(parseEnvelope(out.stdout).issues).toEqual([
    {
      code: 'E_NO_TARGETS',
      message: 'kalup.config.ts declares no targets',
      configPath: 'targets',
      fix: expect.any(String),
      docs: 'errors/E_NO_TARGETS.md',
    },
  ])
  expect(sent.calls).toEqual([])
})

test('an undeclared --target is E_UNKNOWN_TARGET, exit 3: it never falls back to the default or the only target', async () => {
  const { dir, sent } = threeTargets(["  defaultTarget: 'client_b',"])
  const out = await cli(dir, 'plan', '--target', 'acme', '--json')
  expect(out.exitCode).toBe(3)
  expect(parseEnvelope(out.stdout).issues.map((issue) => issue.code)).toEqual(['E_UNKNOWN_TARGET'])
  expect(sent.calls).toEqual([])
  const oneSent = portal()
  const one = await cli(copy('pull'), 'plan', '--target', 'sandbox2', '--json')
  expect(one.exitCode).toBe(3)
  expect(parseEnvelope(one.stdout).issues.map((issue) => issue.code)).toEqual(['E_UNKNOWN_TARGET'])
  expect(oneSent.calls).toEqual([])
})

test('pull --discover with one target and no flag starts with the only target and sends what the flagged run sends', async () => {
  const flagged = portal()
  const withFlag = await cli(copy('pull'), 'pull', '--discover', '--target', 'sandbox')
  expect(withFlag.exitCode).toBe(0)
  const bare = portal()
  const without = await cli(copy('pull'), 'pull', '--discover')
  expect(without.exitCode).toBe(0)
  expect(without.stdout.startsWith('Target sandbox, portal 1111111 (the only target)\n')).toBe(true)
  expect(without.stdout.endsWith('Nothing written.\n')).toBe(true)
  expect(without.stdout).toBe(
    withFlag.stdout.replace('Target sandbox, portal 1111111\n', 'Target sandbox, portal 1111111 (the only target)\n'),
  )
  expect(bare.calls).toEqual(flagged.calls)
})

test('at a terminal, a long target name is capped on its own, so its portal ID stays on its line', async () => {
  const long = 'a'.repeat(130)
  const dir = project([
    `    ${long}: { portalId: 1111111, credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } } },`,
    production,
  ])
  const sent = portal()
  const out = await cli(terminal(dir, ''), 'plan')
  expect(out.exitCode).toBe(1)
  expect(out.stderr).toContain(`  1) ${'a'.repeat(119)}…  portal 1111111\n`)
  expect(out.stderr).toContain('  2) production  portal 2222222\n')
  expect(sent.calls).toEqual([])
})

test('a defaultTarget with terminal escapes is E_DEFAULT_TARGET, and the issue line on stderr carries none of them', async () => {
  const { dir, sent } = threeTargets(["  defaultTarget: 'sand\\u001b[31mRED\\u0007',"])
  const out = await cli(dir, 'plan')
  expect(out.exitCode).toBe(3)
  expect(out.stderr).toContain("E_DEFAULT_TARGET: defaultTarget 'sandRED'")
  expect(out.stderr).not.toMatch(controls)
  expect(sent.calls).toEqual([])
})

test('a fix that prints a command quotes a target name with a space, so it pastes as it reads', async () => {
  const { dir } = threeTargets()
  const bodies = at(3_333_333)
  bodies[routes.harvest] = refused()
  portal({ [keys.acme]: at(1_111_111), [keys.client]: at(2_222_222), [keys.staging]: bodies })
  const out = await cli(dir, 'pull', '--target', 'Staging 2', '--json')
  expect(out.exitCode).toBe(1)
  expect(parseEnvelope(out.stdout).issues.at(-1)).toMatchObject({
    code: 'E_INCOMPLETE',
    fix: expect.stringContaining("npx kalup pull --target 'Staging 2'"),
  })
})
