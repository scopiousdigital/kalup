// Where a project keeps its object files: the folder `dir` in kalup.config.ts names, hubspot/ by default. Every path
// here is relative to the project root with forward slashes, as the file maps the loader and the commands pass hold.
import type { Issue } from '../ir/types.js'

/** The folder of object files when kalup.config.ts states no `dir`. */
export const DEFAULT_DIR = 'hubspot'
/** The folder Kalup 0.1 used. A project whose .ts files are there, and none in hubspot/, keeps it with W_LEGACY_DIR. */
export const LEGACY_DIR = 'kalup'

export interface Layout {
  /** `<dir>/associations.ts`, the association labels and plain associations. */
  associations: string
  /** `<dir>/index.ts`, the barrel that re-exports every object. */
  barrel: string
  /** The folder of object files, such as `hubspot` or `lib/config/hubspot`. */
  dir: string
  /**
   * Set when kalup.config.ts states no `dir`, kalup/ holds .ts files and hubspot/ holds none, as in a 0.1 project: the
   * layout keeps kalup/, and validate warns W_LEGACY_DIR.
   */
  legacy?: true
  /** `<dir>/blueprints.lock.json`. */
  lock: string
  /** `<dir>/removed.ts`, the tombstones. */
  removed: string
}

const WINDOWS_DRIVE = /^[A-Za-z]:/

/** The layout of a folder `normalDir` returned. */
export function layout(dir: string, legacy = false): Layout {
  return {
    dir,
    associations: `${dir}/associations.ts`,
    barrel: `${dir}/index.ts`,
    removed: `${dir}/removed.ts`,
    lock: `${dir}/blueprints.lock.json`,
    ...(legacy ? { legacy: true as const } : {}),
  }
}

/**
 * `dir` as the layout uses it: forward slashes, no `./` or trailing slash. Undefined for a path that is absolute,
 * leaves the project through `..`, or is the project directory itself.
 */
export function normalDir(dir: string): string | undefined {
  const slashed = dir.replaceAll('\\', '/')
  if (slashed.startsWith('/') || WINDOWS_DRIVE.test(slashed)) {
    return undefined
  }
  const parts = slashed.split('/').filter((part) => part !== '' && part !== '.')
  if (parts.length === 0 || parts.includes('..')) {
    return undefined
  }
  return parts.join('/')
}

/** E_SETTING_VALUE for a `dir` that normalDir refuses. */
export function dirIssue(dir: string, line: number | undefined): Issue {
  return {
    code: 'E_SETTING_VALUE',
    message: `dir '${dir}' is not a folder inside the project`,
    file: 'kalup.config.ts',
    ...(line === undefined ? {} : { line }),
    configPath: 'dir',
    fix: `write a path relative to kalup.config.ts, such as 'lib/config/hubspot', or remove dir to use ${DEFAULT_DIR}/`,
  }
}

/** Whether `file` is a TypeScript file under the layout's folder: an object file, the barrel or removed.ts. */
export function inDir(at: Layout, file: string): boolean {
  return file.startsWith(`${at.dir}/`) && file.endsWith('.ts')
}

/** The file pull and kalup add write for an object that has no file yet. */
export function objectPath(at: Layout, object: string): string {
  return `${at.dir}/objects/${object}.ts`
}

/** The file pull writes an object's new pipelines into: `<dir>/pipelines/<object>.ts`. */
export function pipelinePath(at: Layout, object: string): string {
  return `${at.dir}/pipelines/${object}.ts`
}

/** An object file's path from the barrel, without the extension, such as `./objects/companies`. */
export function barrelPath(at: Layout, file: string): string {
  return `./${file.slice(at.dir.length + 1, -'.ts'.length)}`
}
