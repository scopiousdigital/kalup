// The build stamp: a content fingerprint of a package's build inputs, written into dist by its tsdown config and
// checked by the CLI's test helper. Content only, never timestamps, so a cached or freshly checked out build of the
// same sources matches and an edited source does not, whatever its mtime.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const STAMP = 'build-stamp.json'

/**
 * A sha256 over the sorted relative paths and contents of every file in `inputs`: files or directories in `root`, and
 * `!path` to leave out one file that sits among the sources but never feeds the bundle.
 */
export function fingerprint(root: string, inputs: readonly string[]): string {
  const skip = new Set(inputs.filter((input) => input.startsWith('!')).map((input) => input.slice(1)))
  const included = inputs.filter((input) => !input.startsWith('!')).flatMap((input) => files(root, input))
  const hash = createHash('sha256')
  for (const file of included.filter((path) => !skip.has(path)).sort()) {
    const bytes = readFileSync(join(root, file))
    hash.update(`${file}\0${bytes.length}\0`)
    hash.update(bytes)
  }
  return hash.digest('hex')
}

// A hidden file or folder in a directory is left out: .DS_Store and the like never feed the bundle, and git ignores
// them, so turbo's cache key does too. Counting them would refuse a build turbo restores for the same sources.
function files(root: string, input: string): string[] {
  const path = join(root, input)
  if (!statSync(path).isDirectory()) {
    return [input]
  }
  return readdirSync(path, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .filter((file) => !file.split('/').some((part) => part.startsWith('.')))
}

interface Build {
  options: { cwd: string; outDir: string }
}

/**
 * tsdown hooks that stamp dist with the fingerprint of `inputs`. The fingerprint is taken before the build reads the
 * sources and again when it is done, and a build whose sources changed in between gets no stamp. That covers an edit
 * made during the build and `tsdown --watch`, which prepares once and is done after every rebuild.
 */
export function stamp(inputs: readonly string[]) {
  let sha256 = ''
  return {
    'build:prepare': ({ options }: Build) => {
      sha256 = fingerprint(options.cwd, inputs)
    },
    'build:done': ({ options }: Build) => {
      const path = join(options.outDir, STAMP)
      if (fingerprint(options.cwd, inputs) === sha256) {
        writeFileSync(path, `${JSON.stringify({ inputs, sha256 })}\n`)
      } else {
        rmSync(path, { force: true })
      }
    },
  }
}

/** Whether `root`/dist carries a stamp that matches its inputs now. A missing stamp or input is not fresh. */
export function fresh(root: string): boolean {
  try {
    const { inputs, sha256 } = JSON.parse(readFileSync(join(root, 'dist', STAMP), 'utf8')) as {
      inputs: string[]
      sha256: string
    }
    return sha256 === fingerprint(root, inputs)
  } catch {
    return false
  }
}
