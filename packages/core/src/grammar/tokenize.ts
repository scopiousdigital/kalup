import { IssueError } from './types.js'

export interface Token {
  kind: 'ident' | 'string' | 'number' | 'punct' | 'comment' | 'opaque' | 'eof'
  value: string
  line: number
  start: number
  end: number
}

const punct = '{}[]()<>,:;.=&|?!+-*/%~^@#'
const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' }
// A JS engine ends a line comment at any of these, so the reader must too.
const lineEnd = /[\n\u{2028}\u{2029}]/gu

export function notData(file: string, line: number, message: string, fix: string, configPath?: string): never {
  throw new IssueError([{ code: 'E_NOT_DATA', message, file, line, configPath, fix }])
}

export function tokenize(text: string, file: string): Token[] {
  const toks: Token[] = []
  let i = 0
  let line = 1
  const push = (kind: Token['kind'], value: string, start: number) => toks.push({ kind, value, line, start, end: i })
  while (i < text.length) {
    const c = text[i] as string
    const start = i
    if (c === '\n') {
      line++
      i++
    } else if (c === ' ' || c === '\t') {
      i++
    } else if (afterJsonComma(toks)) {
      i = scanOpaque(text, i, file, line)
      push('opaque', text.slice(start, i).trimEnd(), start)
      line += text.slice(start, i).split('\n').length - 1
    } else if (c === '/' && text[i + 1] === '/') {
      lineEnd.lastIndex = i
      i = lineEnd.exec(text)?.index ?? text.length
      push(
        'comment',
        text
          .slice(start + 2, i)
          .replace(/^ /, '')
          .trimEnd(),
        start,
      )
    } else if (c === '/' && text[i + 1] === '*') {
      notData(file, line, 'block comments are not allowed', 'use a // comment above the entry it describes')
    } else if (c === "'" || c === '"') {
      const s = readString(text, i, file, line)
      i = s.end
      push('string', s.value, start)
    } else if (c === '`') {
      notData(file, line, 'template strings are not allowed', 'use a single-quoted string')
    } else if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(text[i + 1] ?? ''))) {
      const m = /^-?[0-9]+(\.[0-9]+)?/.exec(text.slice(i)) as RegExpExecArray
      i += m[0].length
      push('number', m[0], start)
    } else if (/[A-Za-z_$]/.test(c)) {
      while (i < text.length && /[A-Za-z0-9_$]/.test(text[i] as string)) i++
      push('ident', text.slice(start, i), start)
    } else if (punct.includes(c)) {
      i++
      push('punct', c, start)
    } else {
      const ch = String.fromCodePoint(text.codePointAt(i) as number)
      const code = (ch.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, '0')
      const shown = /\p{C}|\p{Z}/u.test(ch) ? `U+${code}` : `'${ch}'`
      notData(file, line, `unexpected character ${shown}`, 'remove it; only the config grammar is allowed here')
    }
  }
  toks.push({ kind: 'eof', value: '', line, start: i, end: i })
  return toks
}

function readString(text: string, from: number, file: string, line: number): { value: string; end: number } {
  const quote = text[from]
  function fail(message: string, fix = `close the string with ${quote}`): never {
    notData(file, line, message, fix)
  }
  let out = ''
  let i = from + 1
  for (;;) {
    const c = text[i]
    if (c === undefined || c === '\n') fail('unterminated string')
    i++
    if (c === quote) return { value: out, end: i }
    if (c !== '\\') {
      out += c
      continue
    }
    const e = text[i++]
    if (e === undefined) fail('unterminated string')
    if (e === '\n') fail('a string cannot continue on the next line', 'write the string on one line')
    if (e === 'x' || e === 'u') {
      const form = e === 'x' ? /^[0-9A-Fa-f]{2}/ : /^([0-9A-Fa-f]{4}|\{[0-9A-Fa-f]{1,6}\})/
      const m = form.exec(text.slice(i, i + 8))
      const code = m ? Number.parseInt(m[0].replace(/[{}]/g, ''), 16) : Number.NaN
      if (!m || code > 0x10ffff) fail(`bad escape \\${e}`, 'write \\xHH, \\uHHHH or \\u{H...} with hex digits')
      out += String.fromCodePoint(code)
      i += m[0].length
    } else {
      out += escapes[e] ?? e
    }
  }
}

// True right after `p.json('<name>',`: what follows is the validator, which the grammar's tokens cannot lex.
function afterJsonComma(toks: Token[]): boolean {
  const t = toks.slice(-6)
  const at = (i: number, kind: Token['kind'], value?: string) =>
    t[i]?.kind === kind && (value === undefined || t[i]?.value === value)
  return (
    t.length === 6 &&
    at(0, 'ident', 'p') &&
    at(1, 'punct', '.') &&
    at(2, 'ident', 'json') &&
    at(3, 'punct', '(') &&
    at(4, 'string') &&
    at(5, 'punct', ',')
  )
}

// The validator is opaque source: balanced brackets up to the ',' or ')' at depth zero, with strings, regex
// literals and block comments skipped so their brackets do not count. Returns the index of that ',' or ')'.
function scanOpaque(text: string, from: number, file: string, line: number): number {
  const fail = (message: string, fix = 'close every bracket in the validator'): never =>
    notData(file, line, message, fix)
  let depth = 0
  // Whether the last significant character ends an operand, so a '/' after it divides instead of opening a regex.
  let operand = false
  for (let i = from; i < text.length; i++) {
    const c = text[i] as string
    if (c === ' ' || c === '\t' || c === '\n') continue
    if (c === '/' && text[i + 1] === '/') {
      fail('a // comment inside a validator would comment out what the writer puts after it', 'use /* */ instead')
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      if (end === -1) fail('unterminated comment in the validator', 'close the comment with */')
      i = end + 1
      continue
    }
    if (c === "'" || c === '"' || c === '`' || (c === '/' && !operand)) {
      i = skipLiteral(text, i, fail)
      operand = true
      continue
    }
    if ('([{'.includes(c)) depth++
    else if (')]}'.includes(c)) {
      if (depth === 0) {
        if (c === ')') return i
        fail('unbalanced brackets in the p.json validator')
      }
      depth--
    } else if (c === ',' && depth === 0) return i
    operand = /[\w$)\]}]/.test(c)
  }
  return fail('unbalanced brackets in the p.json validator')
}

// Skips a quoted string, template or regex literal opening at `i`; returns the index of its closing delimiter.
function skipLiteral(text: string, i: number, fail: (message: string, fix?: string) => never): number {
  const open = text[i] as string
  let cls = false // inside a regex character class, where '/' does not close the literal
  for (let j = i + 1; j < text.length; j++) {
    const c = text[j]
    if (c === '\\') j++
    else if (c === '\n' && open !== '`') break
    else if (open === '/' && cls) cls = c !== ']'
    else if (open === '/' && c === '[') cls = true
    else if (c === open) return j
  }
  return fail(`unterminated ${open === '/' ? 'regex' : 'string'} in the validator`, `close it with ${open}`)
}
