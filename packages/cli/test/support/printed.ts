// What a run printed, as one text for an inline snapshot: stdout, then stderr under a marker, normalised.
import { normalise } from '../../../engine/test/support/normalise.js'

// The help's VERSION line names the machine that runs it.
const machine = /\bkalup\/\S+ \S+ node-v\S+/g
// An archived state file's name holds the old lineage before its stamp.
const archived = /-[0-9a-f]{16}-(?=<time>)/g

export function printed(out: { stdout: string; stderr: string }): string {
  const stderr = out.stderr === '' ? '' : `--- stderr\n${out.stderr}`
  return normalise(`${out.stdout}${stderr}`)
    .replace(machine, 'kalup/<version> <machine>')
    .replace(archived, '-<lineage>-')
}
