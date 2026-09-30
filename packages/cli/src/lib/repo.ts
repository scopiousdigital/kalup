// The repository a project sits in, for a project in a subfolder of a monorepo: its root is the first directory from
// the project upwards that holds .git or a workspace file. Files init edits there (.gitignore, the formatter config)
// and the package.json that names the project are looked for between the two, never above the root.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** Files that mark the top of a workspace. A package.json marks it when it has `workspaces`. */
const WORKSPACE_FILES = ['.git', 'pnpm-workspace.yaml']

/**
 * `dir` and the directories above it up to the repository root, nearest first. Just `dir` when no directory above it
 * is a repository root, so nothing outside a repository (a home directory's .gitignore) is ever edited.
 */
export function repoDirs(dir: string): string[] {
  const dirs = [resolve(dir)]
  for (let at = dirs[0] as string; !isRepoRoot(at); ) {
    const parent = dirname(at)
    if (parent === at) {
      return dirs.slice(0, 1)
    }
    at = parent
    dirs.push(at)
  }
  return dirs
}

function isRepoRoot(dir: string): boolean {
  if (WORKSPACE_FILES.some((name) => existsSync(join(dir, name)))) {
    return true
  }
  const pkg = readJson(join(dir, 'package.json'))
  return typeof pkg === 'object' && pkg !== null && Object.hasOwn(pkg, 'workspaces')
}

/** The name in the nearest package.json from `root` up to the repository root, or undefined when none has one. */
export function packageName(root: string): string | undefined {
  for (const dir of repoDirs(root)) {
    const pkg = readJson(join(dir, 'package.json')) as { name?: unknown } | undefined
    if (typeof pkg?.name === 'string' && pkg.name !== '') {
      return pkg.name
    }
  }
  return undefined
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}
