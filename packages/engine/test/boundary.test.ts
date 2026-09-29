// The engine boundary, read from the sources: no file under src reaches the file system, the operating system, a child
// process, the terminal, the process or oclif. Hosts inject those: the CLI passes its file-backed state store, lock
// and journal, its clock and its fetch. index.test.ts checks the same of the built bundle.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const src = fileURLToPath(new URL('../src/', import.meta.url))
const SPECIFIER = /(?:from|import)\s*\(?\s*'([^']+)'/g
const FORBIDDEN = /^(node:)?(fs|os|child_process|readline|tty)(\/|$)|^@oclif\//
const HOST = /\bprocess\.|\bconsole\./

function sources(): string[] {
  return readdirSync(src, { recursive: true, encoding: 'utf8' })
    .map((file) => file.split('\\').join('/'))
    .filter((file) => file.endsWith('.ts'))
    .sort()
}

test('no engine source imports the file system, the OS, a child process, the terminal or oclif', () => {
  const offenders = sources().flatMap((file) =>
    [...readFileSync(join(src, file), 'utf8').matchAll(SPECIFIER)]
      .map(([, specifier = '']) => specifier)
      .filter((specifier) => FORBIDDEN.test(specifier))
      .map((specifier) => `${file}: ${specifier}`),
  )
  expect(offenders).toEqual([])
})

test('no engine source reads the process or writes to the console', () => {
  const offenders = sources().filter((file) =>
    readFileSync(join(src, file), 'utf8')
      .split('\n')
      .some((line) => !line.trimStart().startsWith('//') && HOST.test(line)),
  )
  expect(offenders).toEqual([])
})

test('the planner and the executor are among the sources scanned', () => {
  expect(sources()).toEqual(expect.arrayContaining(['engine/plan.ts', 'engine/apply.ts', 'lib/http.ts']))
})
