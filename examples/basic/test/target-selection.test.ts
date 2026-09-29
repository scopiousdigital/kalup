// Target selection through the built executable, against the fake portal, in throwaway copies of the
// example with one target, two with defaultTarget, and three with no default. stdio is piped, so no run has a terminal
// and none may prompt. `pnpm --filter kalup build` comes first.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const example = fileURLToPath(new URL('../', import.meta.url))
const cli = fileURLToPath(new URL('../../../packages/cli/dist/index.mjs', import.meta.url))
const fakePortal = new URL('./fake-portal.ts', import.meta.url).href
const keys = { HUBSPOT_SANDBOX_KEY: 'kalup-test-secret-9f2c', HUBSPOT_PROD_READ_KEY: 'kalup-test-secret-5a81' }
const config = readFileSync(join(example, 'kalup.config.ts'), 'utf8')
const production = `    production: {
      portalId: 2222222,
      protected: true,
      credentials: { read: { env: 'HUBSPOT_PROD_READ_KEY' } },
    },
`
const staging = `    'Staging 2': {
      portalId: 3333333,
      credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },
    },
`

/** A copy of the example's config and object files, with its config changed by `edit`. */
function project(edit: (text: string) => string): string {
  const dir = mkdtempSync(join(tmpdir(), 'kalup-example-'))
  cpSync(join(example, 'kalup'), join(dir, 'kalup'), { recursive: true })
  const text = edit(config)
  if (text === config) {
    throw new Error('the edit left kalup.config.ts as it was')
  }
  writeFileSync(join(dir, 'kalup.config.ts'), text)
  return dir
}

const one = () => project((text) => text.replace(production, ''))
const withDefault = () =>
  project((text) => text.replace("  name: 'basic',\n", "  name: 'basic',\n  defaultTarget: 'production',\n"))
const three = () => project((text) => text.replace(production, `${production}${staging}`))

function kalup(cwd: string, ...args: string[]): { status: number | null; stdout: string; stderr: string } {
  return spawnSync(process.execPath, ['--import', fakePortal, cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...keys },
  })
}

// All of stdout as one envelope/1 document, from output that carries neither key.
function envelopeOf(out: { stdout: string; stderr: string }) {
  if (Object.values(keys).some((key) => `${out.stdout}${out.stderr}`.includes(key))) {
    throw new Error('the output carries a key')
  }
  const envelope = JSON.parse(out.stdout)
  if (envelope.format !== 'envelope/1') {
    throw new Error(`stdout is not one envelope/1 document: ${out.stdout}`)
  }
  return envelope
}

// Every file under a directory, with its text.
function files(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const full = join(entry.parentPath, entry.name)
      out[full.slice(dir.length + 1)] = readFileSync(full, 'utf8')
    }
  }
  return out
}

test('one target and no flag: plan, pull and snapshot run against it and say it is the only target', () => {
  const dir = one()
  const plan = kalup(dir, 'plan', '--json')
  assert.equal(plan.status, 0, plan.stdout)
  const envelope = envelopeOf(plan)
  assert.equal(envelope.data.target.name, 'sandbox')
  assert.equal(envelope.data.target.portalId, 1_111_111)
  const human = kalup(dir, 'plan')
  assert.equal(human.status, 0, human.stderr)
  assert.ok(human.stdout.startsWith('Target sandbox, portal 1111111 (the only target)\n'), human.stdout)
  const pull = kalup(dir, 'pull', '--check')
  assert.equal(pull.status, 0, pull.stderr)
  assert.ok(pull.stdout.startsWith('Target sandbox, portal 1111111 (the only target)\n'), pull.stdout)
  const snapshot = envelopeOf(kalup(dir, 'snapshot', '--json'))
  assert.equal(snapshot.ok, true)
  assert.equal(snapshot.data.target, 'sandbox')
  assert.ok(existsSync(join(dir, snapshot.data.file)))
})

test('two targets and defaultTarget: the default is used, and --target of the other wins', () => {
  const dir = withDefault()
  const byDefault = envelopeOf(kalup(dir, 'plan', '--json'))
  assert.equal(byDefault.ok, true)
  assert.deepEqual([byDefault.data.target.name, byDefault.data.target.portalId], ['production', 2_222_222])
  const byFlag = envelopeOf(kalup(dir, 'plan', '--target', 'sandbox', '--json'))
  assert.deepEqual([byFlag.data.target.name, byFlag.data.target.portalId], ['sandbox', 1_111_111])
  const human = kalup(dir, 'pull', '--check')
  assert.equal(human.status, 0, human.stderr)
  assert.ok(human.stdout.startsWith('Target production, portal 2222222 (defaultTarget)\n'), human.stdout)
})

test('three targets and no default: E_TARGET_REQUIRED lists each with its portal, and nothing is read or written', () => {
  const dir = three()
  const before = files(dir)
  const listed = 'sandbox (portal 1111111), production (portal 2222222), Staging 2 (portal 3333333)'
  for (const command of ['plan', 'pull', 'snapshot']) {
    const json = kalup(dir, command, '--json')
    assert.equal(json.status, 1, json.stdout)
    assert.equal(json.stderr, '')
    const envelope = envelopeOf(json)
    assert.equal(envelope.ok, false)
    const issues = envelope.issues as { code: string; message: string }[]
    assert.deepEqual(
      issues.map((issue) => issue.code),
      ['E_TARGET_REQUIRED'],
    )
    assert.ok(
      issues.every((issue) => issue.message.includes(listed)),
      JSON.stringify(issues),
    )
    // Piped stdin is no terminal: the human run fails the same way and never asks.
    const human = kalup(dir, command)
    assert.equal(human.status, 1)
    assert.equal(human.stdout, '')
    assert.ok(human.stderr.startsWith('E_TARGET_REQUIRED: '), human.stderr)
    assert.ok(human.stderr.includes(listed), human.stderr)
    assert.ok(human.stderr.includes('--target <name>'), human.stderr)
    assert.ok(!human.stderr.includes('Which target?'))
  }
  assert.deepEqual(files(dir), before)
})
