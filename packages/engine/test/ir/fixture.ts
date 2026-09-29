// Test helper: reads test/fixtures/ir/<name>. Not exported from the package.
import { readFileSync } from 'node:fs'

export function fixtureText(name: string): string {
  return readFileSync(new URL(`../fixtures/ir/${name}`, import.meta.url), 'utf8')
}

export function fixture<T = unknown>(name: string): T {
  return JSON.parse(fixtureText(name)) as T
}
