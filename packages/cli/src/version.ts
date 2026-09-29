// The CLI's version, read from package.json. Apart from brand.ts, so the engine can name the CLI without the disk.
import { readFileSync } from 'node:fs'
import { bin, disclaimer } from './brand.js'

// package.json sits one level above both src/ and dist/.
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
export const version: string = pkg.version

/** The document formats this version reads and writes, in `kalup --version --json`, so a tool can check before use. */
export const formats: readonly string[] = [
  'ir/1',
  'plan/1',
  'kalup.state/1',
  'envelope/1',
  'blueprint/1',
  'blueprints-lock/1',
]

export function versionText(): string {
  return `${bin} ${version}\n${disclaimer}\n`
}
