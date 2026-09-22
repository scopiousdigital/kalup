// The example as a golden project, checked through the built CLI: the committed IR is what `kalup ir` derives, and a
// pull of the fake portal under test/fixtures/portal changes nothing. `pnpm --filter kalup build` comes first.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const example = fileURLToPath(new URL('../', import.meta.url))
const cli = fileURLToPath(new URL('../../../packages/cli/dist/index.mjs', import.meta.url))
const fakePortal = new URL('./fake-portal.ts', import.meta.url).href

function kalup(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  return spawnSync(process.execPath, ['--import', fakePortal, cli, ...args], {
    cwd: example,
    encoding: 'utf8',
    env: { ...process.env, HUBSPOT_SANDBOX_KEY: 'kalup-test-secret-9f2c' },
  })
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
