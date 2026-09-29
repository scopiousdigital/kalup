// The example as a golden project, checked through the built CLI: the committed IR is what `kalup ir` derives, a pull
// of the fake portal under test/fixtures/portal changes nothing, the committed data dictionary is what `kalup docs`
// writes, a plan against the fake portal is a plan/1 document, compare prints one envelope for two targets or for
// config and a target, and the first apply of a saved plan adopts everything, the custom object included, in a copy.
// `pnpm --filter kalup build` comes first.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { validatePlan } from '@kalup/core'

const example = fileURLToPath(new URL('../', import.meta.url))
const cli = fileURLToPath(new URL('../../../packages/cli/dist/index.mjs', import.meta.url))
const fakePortal = new URL('./fake-portal.ts', import.meta.url).href
const keys = { HUBSPOT_SANDBOX_KEY: 'kalup-test-secret-9f2c', HUBSPOT_PROD_READ_KEY: 'kalup-test-secret-5a81' }
const sandbox = { kind: 'target', name: 'sandbox', portalId: 1_111_111 }

function kalup(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  return kalupIn(example, {}, ...args)
}

function kalupIn(cwd: string, env: Record<string, string>, ...args: string[]) {
  return spawnSync(process.execPath, ['--import', fakePortal, cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...keys, ...env },
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

test('the golden IR is what kalup ir derives from the files, generator.version aside', () => {
  const out = kalup('ir')
  assert.equal(out.status, 0, out.stderr)
  const derived = JSON.parse(out.stdout)
  const golden = JSON.parse(readFileSync(new URL('./fixtures/ir.json', import.meta.url), 'utf8'))
  // The version is the CLI package's, so a release bump alone must not make the golden stale.
  derived.generator.version = golden.generator.version
  assert.deepEqual(derived, golden)
})

test('a pull of the fake portal would change no file, so the fixture matches the files and the hand edits survive', () => {
  const out = kalup('pull', '--target', 'sandbox', '--check', '--exit-code', '--json')
  assert.equal(out.status, 0, out.stdout)
  const envelope = JSON.parse(out.stdout)
  assert.deepEqual(envelope.data.files, [])
  assert.deepEqual(envelope.issues, [])
})

test('DATA-DICTIONARY.md is what kalup docs generates from the config, byte for byte', () => {
  const out = kalup('docs')
  assert.equal(out.status, 0, out.stderr)
  assert.equal(out.stdout, readFileSync(new URL('../DATA-DICTIONARY.md', import.meta.url), 'utf8'))
})

test('a plan of the fake portal through the built CLI is a plan/1 document', () => {
  const out = kalup('plan', '--target', 'sandbox', '--json')
  assert.equal(out.status, 0, out.stdout)
  const envelope = JSON.parse(out.stdout)
  assert.equal(envelope.ok, true)
  assert.deepEqual(validatePlan(envelope.data), [])
  assert.equal(envelope.data.target.name, 'sandbox')
  // The fake portal answers Limits Tracking, but the plan creates nothing a limit covers: no new property, and no
  // custom object, which this version never creates.
  assert.deepEqual(envelope.data.preflight.limits, [])
})

test('compare sandbox production --json is one envelope: each target is guarded by its own key, both read alike', () => {
  const out = kalup('compare', 'sandbox', 'production', '--exit-code', '--json')
  assert.equal(out.status, 0, out.stdout)
  const envelope = envelopeOf(out)
  assert.equal(envelope.ok, true)
  assert.deepEqual(envelope.data.a, sandbox)
  assert.deepEqual(envelope.data.b, { kind: 'target', name: 'production', portalId: 2_222_222 })
  assert.equal(envelope.data.complete, true)
  assert.deepEqual(envelope.data.differences, [])
})

test('compare config sandbox --json is one envelope: the files and the fake portal agree', () => {
  const out = kalup('compare', 'config', 'sandbox', '--exit-code', '--json')
  assert.equal(out.status, 0, out.stdout)
  const envelope = envelopeOf(out)
  assert.equal(envelope.ok, true)
  assert.deepEqual(envelope.data.a, { kind: 'config' })
  assert.deepEqual(envelope.data.b, sandbox)
  assert.equal(envelope.data.complete, true)
})

test('the first apply of a saved plan adopts every resource, the custom object included, and writes nothing', () => {
  // A copy, so state and the journal stay out of the example, with a lock directory of its own.
  const dir = mkdtempSync(join(tmpdir(), 'kalup-example-'))
  cpSync(join(example, 'kalup'), join(dir, 'kalup'), { recursive: true })
  cpSync(join(example, 'kalup.config.ts'), join(dir, 'kalup.config.ts'))
  const env = { KALUP_LOCK_DIR: mkdtempSync(join(tmpdir(), 'kalup-locks-')), KALUP_STATE_DIR: '' }
  const plan = kalupIn(dir, env, 'plan', '--target', 'sandbox', '--out', 'plan.json')
  assert.equal(plan.status, 0, plan.stderr)
  // The fake portal refuses any write, so an apply that finishes wrote nothing.
  const applied = envelopeOf(kalupIn(dir, env, 'apply', 'plan.json', '--yes', '--json'))
  assert.equal(applied.ok, true, JSON.stringify(applied.issues))
  assert.equal(applied.data.outcome, 'done')
  const object = applied.data.steps.find((s: { address: string }) => s.address === 'object:subscription')
  assert.deepEqual([object.action, object.outcome], ['adopt', 'done'])
  const state = JSON.parse(readFileSync(join(dir, '.kalup', 'state', 'portal-1111111.json'), 'utf8'))
  assert.equal(state.resources['object:subscription'].origin, 'adopted')
  assert.equal(Object.keys(state.resources).length, applied.data.steps.length)
  const again = envelopeOf(kalupIn(dir, env, 'plan', '--target', 'sandbox', '--json'))
  assert.equal(again.data.budget.estimatedCalls, 0)
})
