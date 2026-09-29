// The blueprint files on disk: the stored original a lock entry names, and the .gitattributes rule that keeps git from
// changing its bytes. Parsing and the lock rules are the engine's.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Blueprint, LOCK_FILE, type LockEntry, originalError, parseOriginal } from '@kalup/engine'
import { sha256 } from './source.js'

const GITATTRIBUTES = '.gitattributes'
/** The rule that keeps git from converting line endings in the stored originals, which are checked byte for byte. */
const ORIGINALS_RULE = 'kalup/.blueprints/** -text'
// The rule, or one that does the same: -text or binary on the files in the folder. A pattern for the folder itself does
// not reach the files inside it in .gitattributes.
const ORIGINALS_RULE_PRESENT = /^\/?kalup\/\.blueprints\/\*{1,2}[ \t]+(-text|binary)[ \t\r]*$/m

/**
 * The stored original of a lock entry, checked: present, the hash the lock records, and a valid blueprint of that
 * name. Anything else is E_BLUEPRINT_ORIGINAL (exit 1), fixed by restoring the file from git, except another blueprint
 * version, which the version of kalup that wrote it reads.
 */
export function readOriginal(root: string, name: string, entry: LockEntry): Blueprint {
  const path = join(root, entry.original)
  if (!existsSync(path)) {
    throw originalError(name, entry, 'is missing')
  }
  const bytes = new Uint8Array(readFileSync(path))
  if (sha256(bytes) !== entry.hash) {
    throw originalError(name, entry, `does not match the hash in ${LOCK_FILE}`)
  }
  return parseOriginal(new TextDecoder().decode(bytes), name, entry)
}

/**
 * .gitattributes with the rule that stops git from converting line endings under kalup/.blueprints/, or nothing when
 * the file has it. With core.autocrlf (the Git for Windows default) a checkout would otherwise change a stored original's
 * bytes, and every upgrade would stop with E_BLUEPRINT_ORIGINAL.
 */
export function gitattributes(root: string): Record<string, string> {
  const path = join(root, GITATTRIBUTES)
  const text = existsSync(path) ? readFileSync(path, 'utf8') : ''
  if (ORIGINALS_RULE_PRESENT.test(text)) {
    return {}
  }
  const gap = text === '' || text.endsWith('\n') ? '' : '\n'
  return { [GITATTRIBUTES]: `${text}${gap}${ORIGINALS_RULE}\n` }
}
