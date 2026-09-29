// The prompts the host offers: a numbered choice and a typed answer, on stderr, answered on stdin. stdout keeps only
// the command's text or envelope. The host builds a Prompter only when a person is at a terminal.
import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'
import type { Prompter } from '../commands/context.js'
import { sanitize } from '../lib/sanitize.js'

interface Out {
  write: (text: string) => unknown
}

const ATTEMPTS = 3
const NUMBER = /^\d+$/
/** How much of an unrecognised answer the retry line quotes back. */
const ANSWER_MAX = 40
/** Room for a name sanitize capped at 120 characters and the portal ID the target selector puts after it. */
const LABEL_MAX = 160
/** Room for a line of a summary shown before a question: a step title with its risk and labels. */
const LINE_MAX = 400

/** Asks one question and returns the answer, or undefined when the input ended or was cancelled. */
type Next = (prompt: string) => Promise<string | undefined>

/**
 * A Prompter reading answers from `input` and writing the questions, the choices, any summary and any retry line to
 * `output`. Lines read ahead of a question, such as a second answer piped in with the first, wait for the next one.
 */
export function createPrompter(input: NodeJS.ReadableStream, output: Out): Prompter {
  const lines = lineQueue(input, output)
  return {
    choose(question, choices) {
      return lines.session(async (next) => {
        const ask = `Enter 1-${choices.length} or a name: `
        output.write(`${sanitize(question)}\n`)
        choices.forEach((choice, i) => {
          output.write(`  ${i + 1}) ${sanitize(choice.label, LABEL_MAX)}\n`)
        })
        // One prompt and one answer; a wrong answer asks again while attempts are left.
        const attempt = async (left: number): Promise<string | undefined> => {
          const answer = left > 0 ? await next(ask) : undefined
          if (answer === undefined) {
            return undefined
          }
          const picked = pick(answer, choices)
          if (picked !== undefined) {
            return picked
          }
          output.write(`'${sanitize(answer, ANSWER_MAX)}' is not one of the ${choices.length} choices.\n`)
          return await attempt(left - 1)
        }
        return await attempt(ATTEMPTS)
      })
    },
    ask(question) {
      return lines.session((next) => next(`${sanitize(question)} `))
    },
    tell(text) {
      for (const line of text) {
        output.write(`${sanitize(line, LINE_MAX)}\n`)
      }
    },
  }
}

interface LineQueue {
  /** Runs `ask` with a readline interface open on the input, and closes it after. */
  session: <T>(ask: (next: Next) => Promise<T>) => Promise<T>
}

// Lines the input gave that no question took yet, kept across questions. Readline reads a whole chunk at once, so the
// second of two piped answers arrives while the first question is still open.
function lineQueue(input: NodeJS.ReadableStream, output: Out): LineQueue {
  const queued: string[] = []
  // The input ended, or Ctrl-C cancelled it: no further line comes.
  let ended = false

  async function session<T>(ask: (next: Next) => Promise<T>): Promise<T> {
    // A stream that already ended emits no end to a new interface, which would then wait for ever.
    ended ||= (input as { readableEnded?: boolean }).readableEnded === true
    if (ended) {
      return ask((prompt) => {
        output.write(prompt)
        return Promise.resolve(take())
      })
    }
    // Readline echoes what a person types to its output, so a terminal gets one. It must be a stream.
    const terminal = (input as { isTTY?: boolean }).isTTY === true
    const rl = createInterface({ input, output: toStream(output), terminal })
    const waiting: ((line: string | undefined) => void)[] = []
    let closing = false
    let closed = false
    rl.on('line', (line) => {
      const waiter = waiting.shift()
      if (waiter) {
        waiter(line)
      } else {
        queued.push(line)
      }
    })
    rl.once('close', () => {
      closed = true
      // Not this session's own close: the input ended, or Ctrl-C closed it.
      ended ||= !closing
      for (const waiter of waiting.splice(0)) {
        output.write('\n')
        waiter(undefined)
      }
    })
    // Without a listener, Ctrl-C in a terminal only pauses the input. Here it cancels, as the end of input does.
    rl.on('SIGINT', () => rl.close())
    const next: Next = (prompt) => {
      // A closed interface cannot prompt, but the lines read before the input ended are still queued.
      if (closed) {
        output.write(prompt)
      } else {
        rl.setPrompt(prompt)
        rl.prompt()
      }
      if (queued.length > 0 || closed) {
        return Promise.resolve(take())
      }
      return new Promise((resolve) => waiting.push(resolve))
    }
    try {
      return await ask(next)
    } finally {
      closing = true
      rl.close()
    }
  }

  // The next queued line, or undefined, with the line break an answer at the end of input never typed.
  function take(): string | undefined {
    const line = queued.shift()
    if (line === undefined) {
      output.write('\n')
    }
    return line
  }

  return { session }
}

// The number shown beside a choice, or its exact value.
function pick(answer: string, choices: { value: string }[]): string | undefined {
  const trimmed = answer.trim()
  const n = NUMBER.test(trimmed) ? Number(trimmed) : 0
  if (n >= 1 && n <= choices.length) {
    return choices[n - 1]?.value
  }
  return choices.find((choice) => choice.value === answer || choice.value === trimmed)?.value
}

// Readline writes to a stream. The host's stderr may be a plain object with a write method, as in the tests.
function toStream(out: Out): NodeJS.WritableStream {
  if (out instanceof Writable) {
    return out
  }
  return new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      out.write(chunk.toString())
      callback()
    },
  })
}
