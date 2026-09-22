// Test helpers shared by the command tests. Not exported from the package.
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Envelope } from '../lib/index.js'
import { run } from './run.js'

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

export async function cli(
  cwd: string,
  ...argv: string[]
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const stdout: string[] = []
  const stderr: string[] = []
  const exitCode = await run(argv, {
    cwd,
    stdout: { write: (text) => stdout.push(text) },
    stderr: { write: (text) => stderr.push(text) },
  })
  return { exitCode, stdout: stdout.join(''), stderr: stderr.join('') }
}

export function parseEnvelope<T = unknown>(stdout: string): Envelope<T> {
  return JSON.parse(stdout) as Envelope<T>
}
