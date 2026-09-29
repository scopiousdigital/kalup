// Loaded with `node --import` into a spawned kalup: fetch asks the test process over the IPC channel, and the test
// process answers from its simulator, so a scenario can run the built executable in a process of its own against the
// same portal as the in-process runs, and pause or kill it at a chosen request. Nothing reaches the network. Plain
// JavaScript, so it loads on every Node the engines field allows, with or without type stripping.

/**
 * @typedef {{ body?: string, headers: Record<string, string>, id: number, method: string, url: string }} Asked
 * @typedef {{ body: string | null, headers: Record<string, string>, id: number, status: number } | { error: string, id: number }} Answer
 * @typedef {{ reject: (error: unknown) => void, resolve: (response: Response) => void }} Waiting
 */

const { channel } = process
if (!(channel && process.send)) {
  throw new Error('ipc-fetch needs an IPC channel: spawn the process with stdio "ipc"')
}
/** @type {Map<number, Waiting>} */
const pending = new Map()
let next = 0

/**
 * The channel keeps the process alive only while a request waits for its answer, so the CLI exits when it is done.
 * @param {number} id
 * @returns {Waiting | undefined}
 */
function settle(id) {
  const waiting = pending.get(id)
  pending.delete(id)
  if (pending.size === 0) {
    channel?.unref()
  }
  return waiting
}

process.on('message', (/** @type {Answer} */ answer) => {
  const waiting = settle(answer.id)
  if ('error' in answer) {
    waiting?.reject(new TypeError(answer.error))
    return
  }
  waiting?.resolve(new Response(answer.body, { status: answer.status, headers: answer.headers }))
})
channel.unref()

/**
 * @param {string | URL | Request} input
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
globalThis.fetch = (input, init = {}) => {
  next += 1
  const id = next
  /** @type {Asked} */
  const asked = {
    id,
    url: input instanceof Request ? input.url : String(input),
    method: (init.method ?? 'GET').toUpperCase(),
    headers: Object.fromEntries(new Headers(init.headers)),
    ...(typeof init.body === 'string' ? { body: init.body } : {}),
  }
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    channel.ref()
    init.signal?.addEventListener(
      'abort',
      () => {
        if (pending.has(id)) {
          settle(id)
          reject(init.signal?.reason)
        }
      },
      { once: true },
    )
    process.send?.(asked)
  })
}
