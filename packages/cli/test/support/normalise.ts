// Human output with the parts that change between runs replaced, so a test can hold it as an inline snapshot:
// temporary directories, timestamps, state lineages, plan IDs and digests (both follow the lineage) and the kalup
// version.
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'

const temp = [...new Set([realpathSync(tmpdir()), tmpdir()])].sort((a, b) => b.length - a.length)

export function normalise(text: string): string {
  let out = text
  for (const dir of temp) {
    out = out.replaceAll(dir, '<tmp>')
  }
  return out
    .replace(/<tmp>\/[^/\s'"]+/g, '<dir>')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '<time>')
    .replace(/\d{8}T\d{6,9}Z/g, '<time>')
    .replace(/\blineage [0-9a-f]{16}\b/g, 'lineage <lineage>')
    .replace(/\bpl_[0-9a-f]{12}\b/g, 'pl_<id>')
    .replace(/\bsha256:[0-9a-f]{64}\b/g, 'sha256:<digest>')
    .replace(/\bkalup \d+\.\d+\.\d+(?:-[\w.]+)?/g, 'kalup <version>')
}
