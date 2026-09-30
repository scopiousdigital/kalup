import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { packageName, repoDirs } from '../../src/lib/repo.js'

function tree(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'kalup-repo-')))
}

test.each([
  ['.git', (dir: string) => mkdirSync(join(dir, '.git'))],
  ['pnpm-workspace.yaml', (dir: string) => writeFileSync(join(dir, 'pnpm-workspace.yaml'), "packages: ['apps/*']\n")],
  ['a package.json with workspaces', (dir: string) => writeFileSync(join(dir, 'package.json'), '{"workspaces":[]}')],
])('the repository root is the first directory up with %s', (_, mark) => {
  const root = tree()
  mark(root)
  const project = join(root, 'apps', 'crm')
  mkdirSync(project, { recursive: true })
  expect(repoDirs(project)).toEqual([project, join(root, 'apps'), root])
  expect(repoDirs(root)).toEqual([root])
})

test('outside a repository only the directory itself is looked at', () => {
  const dir = join(tree(), 'crm')
  mkdirSync(dir)
  expect(repoDirs(dir)).toEqual([dir])
})

test('the project name is the nearest package.json name up to the repository root, never above it', () => {
  const root = tree()
  mkdirSync(join(root, '.git'))
  writeFileSync(join(root, 'package.json'), '{"name":"orchard-monorepo"}')
  const project = join(root, 'apps', 'crm')
  mkdirSync(project, { recursive: true })
  expect(packageName(project)).toBe('orchard-monorepo')
  writeFileSync(join(project, 'package.json'), '{"name":"@orchard/crm"}')
  expect(packageName(project)).toBe('@orchard/crm')
  const outside = join(tree(), 'crm')
  mkdirSync(outside)
  expect(packageName(outside)).toBeUndefined()
})
