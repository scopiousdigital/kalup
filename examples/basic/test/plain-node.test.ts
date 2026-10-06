// The app side with no bundler: tsc compiles src/ and the hubspot/ files it imports, and plain Node runs the output. The
// barrel's relative specifiers carry .js, so Node resolves them with no loader. `pnpm --filter @kalup/core build` comes
// first.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const example = fileURLToPath(new URL('../', import.meta.url))
const out = mkdtempSync(join(tmpdir(), 'kalup-plain-node-'))
after(() => rmSync(out, { recursive: true, force: true }))

test('the app compiled by tsc runs under plain Node and reads the objects through the barrel', async () => {
  const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc')
  const options = ['--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', '--strict']
  // Run from the output folder: TypeScript 6 refuses files named on the command line while a tsconfig.json sits in
  // the working directory (TS5112), and this compile is meant to use none.
  execFileSync(
    process.execPath,
    [tsc, ...options, '--rootDir', example, '--outDir', out, join(example, 'src/index.ts')],
    { cwd: out },
  )
  // The output sits outside the example, so it gets the example's package type and dependencies.
  writeFileSync(join(out, 'package.json'), '{ "type": "module" }\n')
  symlinkSync(join(example, 'node_modules'), join(out, 'node_modules'), 'dir')

  const barrel = await import(pathToFileURL(join(out, 'hubspot/index.js')).href)
  assert.deepEqual(Object.keys(barrel).sort(), ['Company', 'Subscription'])
  const app = await import(pathToFileURL(join(out, 'src/index.js')).href)
  assert.deepEqual(app.billingSummary({ billing_status: 'PAST DUE', seat_count: '12' }), {
    status: 'past_due',
    seats: 12,
  })
  const patch: Record<string, string> = {}
  app.markPastDue(patch)
  assert.deepEqual(patch, { billing_status: 'PAST DUE' })
  assert.ok(app.companyProperties.includes('billing_status'))
})
