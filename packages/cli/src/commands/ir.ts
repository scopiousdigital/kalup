// kalup ir: load, validate, print the IR as deterministic JSON. --check validates only and prints nothing but issues.
import { type IR, stableStringify, validateIR } from '@kalup/core'
import { exitCodes, KalupError } from '../lib/index.js'
import type { Context, Result } from './run.js'
import { check } from './validate.js'

export function ir(ctx: Context): Result<IR> {
  const { loaded, issues, warnings } = check(ctx)
  const all = loaded ? [...issues, ...validateIR(loaded.ir)] : issues
  if (!loaded || all.length > 0) throw new KalupError([...all, ...warnings], exitCodes.invalid)
  if (ctx.flags.check) return { issues: warnings }
  return { data: loaded.ir, issues: warnings, text: `${stableStringify(loaded.ir)}\n` }
}
