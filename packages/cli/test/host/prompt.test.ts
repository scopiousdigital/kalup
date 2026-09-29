import { PassThrough, Readable } from 'node:stream'
import { expect, test } from 'vitest'
import { createPrompter } from '../../src/host/prompt.js'

// biome-ignore lint/suspicious/noControlCharactersInRegex: the test looks for the control characters it planted
const controls = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/

const choices = [
  { label: 'acme-eu  portal 1111111', value: 'acme-eu' },
  { label: 'client_b  portal 2222222', value: 'client_b' },
  { label: 'Staging 2  portal 3333333', value: 'Staging 2' },
]

async function ask(input: NodeJS.ReadableStream, list = choices): Promise<{ answer?: string; written: string }> {
  const written: string[] = []
  const answer = await createPrompter(input, { write: (text) => written.push(text) }).choose('Which target?', list)
  return { answer, written: written.join('') }
}

test.each([
  ['a number', '2\n', 'client_b'],
  ['the last number', '3\n', 'Staging 2'],
  ['the exact value', 'Staging 2\n', 'Staging 2'],
  ['a value with CRLF', 'acme-eu\r\n', 'acme-eu'],
  ['a number without a final newline', '1', 'acme-eu'],
  ['a wrong answer, then a number', 'bogus\n2\n', 'client_b'],
  ['an out-of-range number, then a value', '4\nacme-eu\n', 'acme-eu'],
])('%s picks its choice', async (_name, input, expected) => {
  expect((await ask(Readable.from([input]))).answer).toBe(expected)
})

test('the question, the numbered choices and the prompt are written, and a wrong answer is one line', async () => {
  const { written } = await ask(Readable.from(['bogus\n2\n']))
  expect(written).toMatchInlineSnapshot(`
    "Which target?
      1) acme-eu  portal 1111111
      2) client_b  portal 2222222
      3) Staging 2  portal 3333333
    Enter 1-3 or a name: 'bogus' is not one of the 3 choices.
    Enter 1-3 or a name: "
  `)
})

test.each([
  ['the end of input', ''],
  ['three wrong answers', 'x\n0\n-1\n2\n'],
])('%s cancels: undefined, whatever comes after', async (_name, input) => {
  const { answer, written } = await ask(Readable.from(input === '' ? [] : [input]))
  expect(answer).toBeUndefined()
  expect(written.split('Enter 1-3 or a name: ').length - 1).toBe(input === '' ? 1 : 3)
})

test('Ctrl-C at a terminal cancels, and the input is released', async () => {
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => input })
  const pending = ask(input)
  setTimeout(() => input.write('\u0003'), 10)
  expect((await pending).answer).toBeUndefined()
  expect(input.isPaused()).toBe(true)
})

test('an answer typed at a terminal is read the same way', async () => {
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => input })
  const pending = ask(input)
  setTimeout(() => input.write('client_b\r'), 10)
  expect((await pending).answer).toBe('client_b')
})

test('control characters in a label, the question or an echoed answer never reach the terminal', async () => {
  const hostile = [{ label: 'evil\u001b[2J\u0007name  portal 1', value: 'evil' }, ...choices]
  const { written } = await ask(Readable.from(['\u001b]0;TITLE\u0007\n1\n']), hostile)
  expect(controls.test(written)).toBe(false)
  expect(written).toContain('  1) evilname  portal 1\n')
})

test('ask writes the question and returns the typed line; two answers piped at once serve two questions', async () => {
  const written: string[] = []
  const prompter = createPrompter(Readable.from(['sandbox\n2\n']), { write: (text) => written.push(text) })
  expect(await prompter.ask('Type the target name to apply:')).toBe('sandbox')
  expect(await prompter.ask('Type the number of destructive steps (2):')).toBe('2')
  expect(written.join('')).toBe('Type the target name to apply: Type the number of destructive steps (2): ')
})

test('ask returns undefined at the end of input', async () => {
  const written: string[] = []
  const prompter = createPrompter(Readable.from([]), { write: (text) => written.push(text) })
  expect(await prompter.ask('Type the target name to apply:')).toBeUndefined()
  expect(written.join('')).toBe('Type the target name to apply: \n')
})

test('tell writes each line sanitized, before a question', () => {
  const written: string[] = []
  createPrompter(Readable.from([]), { write: (text) => written.push(text) }).tell([
    'Apply plan pl_0a1b2c3d4e5f to target sandbox',
    '  s1 safe Create property "Soil\u001b[2J pH"',
  ])
  expect(written.join('')).toBe('Apply plan pl_0a1b2c3d4e5f to target sandbox\n  s1 safe Create property "Soil pH"\n')
})
