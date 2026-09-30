// Enough of git's ignore rules to tell whether an ignore file covers one path, for .gitignore and .prettierignore,
// which use the same syntax: comments, negation, folder-only lines, anchoring, `*`, `?` and `**`. The last line that
// matches decides, and a path inside an ignored folder is ignored whatever follows, as git does not look inside it.

interface Rule {
  folder: boolean
  negate: boolean
  pattern: RegExp
}

const TRAILING_SPACES = /(?<!\\) +$/
const REGEXP_SPECIAL = /[.+^${}()|\\]/

/**
 * Whether the ignore file `text`, in some directory, ignores `path`: relative to that directory, with forward slashes.
 * `folder` says the path is a folder, which a line ending in `/` needs.
 */
export function ignores(text: string, path: string, folder = false): boolean {
  return verdict(text, path, folder) ?? false
}

/**
 * As `ignores`, but undefined when no line matches, so a caller can weigh ignore files at several levels: a deeper
 * file's verdict wins over one above it.
 */
export function verdict(text: string, path: string, folder = false): boolean | undefined {
  const rules = text.split('\n').flatMap(rule)
  const parts = path.split('/')
  for (let i = 1; i <= parts.length; i += 1) {
    const last = i === parts.length
    const found = decide(rules, parts.slice(0, i).join('/'), folder || !last)
    if (last || found) {
      return found
    }
  }
  return undefined
}

// The last rule that matches, or undefined when none does.
function decide(rules: Rule[], path: string, folder: boolean): boolean | undefined {
  let ignored: boolean | undefined
  for (const r of rules) {
    if ((folder || !r.folder) && r.pattern.test(path)) {
      ignored = !r.negate
    }
  }
  return ignored
}

// One line as git reads it: the \r of a CRLF line and unescaped trailing spaces go, a leading space or a trailing tab
// stays part of the name. A pattern with a slash before its end is anchored to the file's directory.
function rule(raw: string): Rule[] {
  let line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
  line = line.replace(TRAILING_SPACES, '')
  if (line === '' || line.startsWith('#')) {
    return []
  }
  const negate = line.startsWith('!')
  let body = negate ? line.slice(1) : line
  const folder = body.endsWith('/')
  body = folder ? body.slice(0, -1) : body
  const anchored = body.includes('/')
  body = body.startsWith('/') ? body.slice(1) : body
  const glob = toRegExp(body)
  try {
    return [{ negate, folder, pattern: new RegExp(anchored ? `^${glob}$` : `(?:^|/)${glob}$`) }]
  } catch {
    // An unclosed [ matches nothing in git either.
    return []
  }
}

function toRegExp(glob: string): string {
  let out = ''
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i] as string
    if (glob.startsWith('**/', i)) {
      out += '(?:.*/)?'
      i += 2
    } else if (glob.startsWith('/**', i) && i + 3 === glob.length) {
      out += '/.*'
      i += 2
    } else if (c === '*') {
      out += '[^/]*'
    } else if (c === '?') {
      out += '[^/]'
    } else if (c === '\\' && i + 1 < glob.length) {
      i += 1
      out += escaped(glob[i] as string)
    } else {
      out += c === '[' || c === ']' ? c : escaped(c)
    }
  }
  return out
}

function escaped(c: string): string {
  return REGEXP_SPECIAL.test(c) || c === '*' || c === '?' || c === '[' || c === ']' ? `\\${c}` : c
}
