// kalup docs: the data dictionary, Markdown describing the config files or a snapshot file. The config is validated
// first; a snapshot needs no project. The output is deterministic, so a committed dictionary can be checked by
// generating it again. Reads no portal.
import type { IR } from '@kalup/core'
import { dictionary } from '../engine/dictionary.js'
import { incompleteIssues, parseSnapshot } from '../engine/snapshot.js'
import { exitCodes, type Issue, KalupError } from '../lib/output.js'
import { sanitize } from '../lib/sanitize.js'
import type { Context, Result } from './context.js'
import { readArgFile, shown, writeArgFile, wrote } from './files.js'
import { check } from './validate.js'

/** The Markdown, or with --out the file it was written to, relative to the directory the command ran in. */
export type DocsData = { markdown: string } | { file: string }

interface Source {
  ir: IR
  issues: Issue[]
}

export function docs(ctx: Context): Result<DocsData> {
  const [source = 'config'] = ctx.args
  const { ir, issues } = source === 'config' ? fromConfig(ctx) : fromSnapshot(ctx.cwd, source)
  const markdown = dictionary(ir)
  if (ctx.flags.out === undefined) {
    return { data: { markdown }, issues, text: markdown }
  }
  writeArgFile(ctx.cwd, ctx.flags.out, markdown)
  const file = shown(ctx.cwd, ctx.flags.out)
  return { data: { file }, issues, text: wrote(file) }
}

function fromConfig(ctx: Context): Source {
  const { loaded, issues, warnings } = check(ctx)
  if (!loaded || issues.length > 0) {
    throw new KalupError([...issues, ...warnings], exitCodes.invalid)
  }
  return { ir: loaded.ir, issues: warnings }
}

// What the snapshot does not cover is unknown, and W_INCOMPLETE says so.
function fromSnapshot(cwd: string, file: string): Source {
  const text = readArgFile(cwd, file)
  if (text === undefined) {
    throw new KalupError({
      code: 'E_SNAPSHOT',
      message: `'${sanitize(file)}' is not a file`,
      file,
      fix: 'pass a file the snapshot command wrote, or config for the config files',
    })
  }
  const snapshot = parseSnapshot(text, file)
  const { coverage, target } = snapshot.observation
  return { ir: snapshot, issues: incompleteIssues(coverage, target.name) }
}
