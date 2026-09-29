// The manifest's prepack, run as pnpm runs it before a pack or a publish: with no build it fails, so a publish never
// ships a package without dist, and with one it copies the repository's LICENSE and NOTICE into the package.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'

const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  scripts: { prepack: string }
}
let root = ''

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

// A repository with LICENSE and NOTICE at its root and this package under packages/, built or not.
function prepack(built: boolean) {
  root = mkdtempSync(join(tmpdir(), 'kalup-prepack-'))
  const dir = join(root, 'packages/cli')
  mkdirSync(join(dir, 'dist'), { recursive: true })
  writeFileSync(join(root, 'LICENSE'), 'The license.\n')
  writeFileSync(join(root, 'NOTICE'), 'The notice.\n')
  if (built) {
    writeFileSync(join(dir, 'dist/index.mjs'), '')
  }
  const { status } = spawnSync('sh', ['-c', scripts.prepack], { cwd: dir })
  return { status, license: existsSync(join(dir, 'LICENSE')), notice: existsSync(join(dir, 'NOTICE')) }
}

test('prepack fails when dist/index.mjs is missing, and copies nothing', () => {
  expect(prepack(false)).toEqual({ status: 1, license: false, notice: false })
})

test('prepack copies LICENSE and NOTICE into a built package', () => {
  expect(prepack(true)).toEqual({ status: 0, license: true, notice: true })
})
