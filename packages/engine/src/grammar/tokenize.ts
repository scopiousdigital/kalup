import { IssueError } from './types.js'

export interface Token {
  end: number
  kind: 'ident' | 'string' | 'number' | 'punct' | 'comment' | 'opaque' | 'eof'
  line: number
  start: number
  value: string
}

type Fail = (message: string, fix?: string) => never

const punct = '{}[]()<>,:;.=&|?!+-*/%~^@#'
const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' }
// A JS engine ends a line comment at any of these, so the reader must too.
const lineEnd = /[\n\u{2028}\u{2029}]/gu
const leadingSpace = /^ /
const digit = /[0-9]/
// A decimal number the way JS writes one: an underscore only between two digits, and none after a leading 0.
const numberForm = /^-?(0[0-9]+|[1-9](_?[0-9])*|0)(\.[0-9](_?[0-9])*)?/
const identStart = /[A-Za-z_$]/
const identPart = /[A-Za-z0-9_$]/
const invisible = /\p{C}|\p{Z}/u
const hexByte = /^[0-9A-Fa-f]{2}/
const hexUnit = /^([0-9A-Fa-f]{4}|\{[0-9A-Fa-f]{1,6}\})/
const braces = /[{}]/g
const operandEnd = /[\w$)\]}]/

export function notData(file: string, line: number, message: string, fix: string, configPath?: string): never {
  throw new IssueError([{ code: 'E_NOT_DATA', message, file, line, configPath, fix }])
}

export function tokenize(text: string, file: string): Token[] {
  const toks: Token[] = []
  let i = 0
  let line = 1
  while (i < text.length) {
    const c = text[i] as string
    if (c === '\n') {
      line += 1
      i += 1
    } else if (c === ' ' || c === '\t') {
      i += 1
    } else if (afterJsonComma(toks)) {
      const end = scanOpaque(text, i, file, line)
      const source = text.slice(i, end)
      toks.push({ kind: 'opaque', value: source.trimEnd(), line, start: i, end })
      line += source.split('\n').length - 1
      i = end
    } else {
      const { kind, value, end } = scan(text, i, file, line)
      toks.push({ kind, value, line, start: i, end })
      i = end
    }
  }
  toks.push({ kind: 'eof', value: '', line, start: i, end: i })
  return toks
}

// The token that starts at `i`, which is neither a blank nor a p.json validator.
function scan(text: string, i: number, file: string, line: number): Pick<Token, 'kind' | 'value' | 'end'> {
  const c = text[i] as string
  if (c === '/' && text[i + 1] === '/') {
    lineEnd.lastIndex = i
    const end = lineEnd.exec(text)?.index ?? text.length
    const value = text
      .slice(i + 2, end)
      .replace(leadingSpace, '')
      .trimEnd()
    return { kind: 'comment', value, end }
  }
  if (c === '/' && text[i + 1] === '*') {
    notData(file, line, 'block comments are not allowed', 'use a // comment above the entry it describes')
  }
  if (c === "'" || c === '"') {
    return { kind: 'string', ...readString(text, i, file, line) }
  }
  if (c === '`') {
    notData(file, line, 'template strings are not allowed', 'use a single-quoted string')
  }
  if (digit.test(c) || (c === '-' && digit.test(text[i + 1] ?? ''))) {
    return readNumber(text, i, file, line)
  }
  if (identStart.test(c)) {
    let end = i + 1
    while (end < text.length && identPart.test(text[end] as string)) {
      end += 1
    }
    return { kind: 'ident', value: text.slice(i, end), end }
  }
  if (punct.includes(c)) {
    return { kind: 'punct', value: c, end: i + 1 }
  }
  const ch = String.fromCodePoint(text.codePointAt(i) as number)
  const code = (ch.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, '0')
  const shown = invisible.test(ch) ? `U+${code}` : `'${ch}'`
  return notData(file, line, `unexpected character ${shown}`, 'remove it; only the config grammar is allowed here')
}

// The token keeps the underscores so messages quote the source; the reader drops them for the value.
function readNumber(text: string, i: number, file: string, line: number): Pick<Token, 'kind' | 'value' | 'end'> {
  const [value] = numberForm.exec(text.slice(i)) as RegExpExecArray
  const end = i + value.length
  if (text[end] === '_' || text.startsWith('._', end)) {
    notData(file, line, "'_' is not allowed here in a number", 'write single underscores between digits, or none')
  }
  return { kind: 'number', value, end }
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
    if (c === undefined || c === '\n') {
      fail('unterminated string')
    }
    i += 1
    if (c === quote) {
      return { value: out, end: i }
    }
    if (c === '\\') {
      const decoded = readEscape(text, i, fail)
      out += decoded.value
      i = decoded.end
    } else {
      out += c
    }
  }
}

// The escape whose letter is at `i`, just after the backslash.
function readEscape(text: string, i: number, fail: Fail): { value: string; end: number } {
  const e = text[i]
  if (e === undefined) {
    fail('unterminated string')
  }
  if (e === '\n') {
    fail('a string cannot continue on the next line', 'write the string on one line')
  }
  if (e !== 'x' && e !== 'u') {
    return { value: escapes[e] ?? e, end: i + 1 }
  }
  const m = (e === 'x' ? hexByte : hexUnit).exec(text.slice(i + 1, i + 9))
  const code = m ? Number.parseInt(m[0].replace(braces, ''), 16) : Number.NaN
  if (!m || code > 0x10_ff_ff) {
    fail(`bad escape \\${e}`, 'write \\xHH, \\uHHHH or \\u{H...} with hex digits')
  }
  return { value: String.fromCodePoint(code), end: i + 1 + m[0].length }
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
  for (let i = from; i < text.length; i += 1) {
    const c = text[i] as string
    if (c === '/' && text[i + 1] === '/') {
      fail('a // comment inside a validator would comment out what the writer puts after it', 'use /* */ instead')
    }
    if (c === '/' && text[i + 1] === '*') {
      i = skipComment(text, i, fail)
    } else if (c === "'" || c === '"' || c === '`' || (c === '/' && !operand)) {
      i = skipLiteral(text, i, fail)
      operand = true
    } else if (depth === 0 && (c === ',' || c === ')')) {
      return i
    } else if (!' \t\n'.includes(c)) {
      depth += bracket(c)
      if (depth < 0) {
        fail('unbalanced brackets in the p.json validator')
      }
      operand = operandEnd.test(c)
    }
  }
  return fail('unbalanced brackets in the p.json validator')
}

// How a character changes the bracket depth.
function bracket(c: string): number {
  if ('([{'.includes(c)) {
    return 1
  }
  return ')]}'.includes(c) ? -1 : 0
}

// Skips a block comment opening at `i`; returns the index of its closing '/'.
function skipComment(text: string, i: number, fail: Fail): number {
  const end = text.indexOf('*/', i + 2)
  if (end === -1) {
    fail('unterminated comment in the validator', 'close the comment with */')
  }
  return end + 1
}

// Skips a quoted string, template or regex literal opening at `i`; returns the index of its closing delimiter.
function skipLiteral(text: string, i: number, fail: Fail): number {
  const open = text[i] as string
  let cls = false // inside a regex character class, where '/' does not close the literal
  for (let j = i + 1; j < text.length; j += 1) {
    const c = text[j]
    if (c === '\\') {
      j += 1
    } else if (c === '\n' && open !== '`') {
      break
    } else if (open === '/' && cls) {
      cls = c !== ']'
    } else if (open === '/' && c === '[') {
      cls = true
    } else if (c === open) {
      return j
    }
  }
  return fail(`unterminated ${open === '/' ? 'regex' : 'string'} in the validator`, `close it with ${open}`)
}
