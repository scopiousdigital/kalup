// Test helpers shared by the command tests. Not exported from the package.
import { cpSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fresh } from '@kalup/tsconfig/stamp'
import type * as Host from '../host/host.js'
import type { Envelope } from '../lib/output.js'

const fixtures = fileURLToPath(new URL('../../test/fixtures/projects/', import.meta.url))

/** The root of a fixture project. Read-only: commands that write run on a `copy`. */
export function project(name: string): string {
  return join(fixtures, name)
}

/** A throwaway copy of a fixture project. */
export function copy(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'kalup-cli-'))
  cpSync(project(name), dir, { recursive: true })
  return dir
}

/** An empty throwaway directory, with no kalup.config.ts above it. */
export function empty(): string {
  return mkdtempSync(join(tmpdir(), 'kalup-cli-empty-'))
}

/** A project whose kalup/ is a file, so reading it throws a plain Node error: the E_UNEXPECTED path. */
export function broken(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kalup-cli-broken-'))
  writeFileSync(
    join(dir, 'kalup.config.ts'),
    "import { defineConfig } from 'kalup'\n\nexport default defineConfig({})\n",
  )
  writeFileSync(join(dir, 'kalup'), 'not a directory\n')
  return dir
}

/** Where a run happens: the directory, and for a prompt, the input and whether a person is at a terminal. */
export interface Where {
  cwd: string
  interactive?: boolean
  stdin?: NodeJS.ReadableStream
}

/** Runs the built host in `where`, a directory or a directory with a terminal, and returns what it printed. */
export async function cli(
  where: string | Where,
  ...argv: string[]
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const stdout: string[] = []
  const stderr: string[] = []
  const { cwd, ...terminal } = typeof where === 'string' ? { cwd: where } : where
  const exitCode = await host().run(argv, {
    cwd,
    ...terminal,
    stdout: { write: (text) => stdout.push(text) },
    stderr: { write: (text) => stderr.push(text) },
  })
  return { exitCode, stdout: stdout.join(''), stderr: stderr.join('') }
}

/** Parses `--json` output, which must be one envelope/1 document that leaves `data` out rather than set it to null. */
export function parseEnvelope<T = unknown>(stdout: string): Envelope<T> {
  const env = JSON.parse(stdout) as Envelope<T>
  if (env.format !== 'envelope/1') {
    throw new Error(`stdout is not an envelope/1 document: format is ${JSON.stringify(env.format)}`)
  }
  if (env.data === null) {
    throw new Error('the envelope has data: null, and a command leaves data out instead')
  }
  return env
}

const root = fileURLToPath(new URL('../../', import.meta.url))
let loaded: typeof Host | undefined

/**
 * The built host, loaded by Node itself rather than through vitest, so it shares one module graph with the command
 * module oclif discovers from dist/commands.mjs. The contract tests run the artifact that ships, and it imports the
 * dist of @kalup/core, which is why both builds must match the sources on disk: a stale dist fails here instead of
 * passing old behaviour.
 */
export function host(): typeof Host {
  if (loaded) {
    return loaded
  }
  checkBuild(root, 'pnpm --filter kalup build')
  checkBuild(realpathSync(join(root, 'node_modules/@kalup/core')), 'pnpm --filter @kalup/core build')
  // require() of an ES module without top-level await, which Node supports: it bypasses vitest's transform.
  loaded = createRequire(import.meta.url)(join(root, 'dist/host.mjs')) as typeof Host
  return loaded
}

/** Throws unless the package in `dir` was built from its sources as they are now, compared by content. */
export function checkBuild(dir: string, fix: string): void {
  if (!fresh(dir)) {
    throw new Error(`${join(dir, 'dist')} does not match its sources: run ${fix} before the tests`)
  }
}
