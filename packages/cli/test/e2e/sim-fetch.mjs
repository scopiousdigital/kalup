// Loaded with `node --import` into a kalup run of the e2e journeys: fetch sends each HubSpot request over the Unix
// socket named by KALUP_E2E_SOCKET to the test process, which answers it from its simulator. A socket, not the IPC
// channel of ../scenarios/ipc-fetch.mjs, because a run in a pseudo-terminal from `script` inherits the environment but
// not an IPC channel. Nothing reaches the network. Plain JavaScript, so it loads on every Node the engines field allows.
import { request } from 'node:http'

const socketPath = process.env.KALUP_E2E_SOCKET
if (!socketPath) {
  throw new Error('sim-fetch needs KALUP_E2E_SOCKET, the socket of the test process')
}

/**
 * @param {string | URL | Request} input
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
globalThis.fetch = (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (url.hostname !== 'api.hubapi.com') {
    return Promise.reject(new TypeError(`sim-fetch answers api.hubapi.com only, not ${url.hostname}`))
  }
  return new Promise((resolve, reject) => {
    const headers = Object.fromEntries(new Headers(init.headers))
    const req = request({ socketPath, method: init.method ?? 'GET', path: `${url.pathname}${url.search}`, headers })
    req.on('response', (res) => {
      /** @type {Buffer[]} */
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('error', reject)
      res.on('end', () => {
        const status = res.statusCode ?? 500
        /** @type {[string, string][]} */
        const pairs = Object.entries(res.headers).map(([name, value]) => [name, String(value)])
        resolve(new Response(status === 204 ? null : Buffer.concat(chunks), { status, headers: pairs }))
      })
    })
    req.on('error', (error) => reject(new TypeError('fetch failed', { cause: error })))
    init.signal?.addEventListener(
      'abort',
      () => {
        req.destroy()
        reject(init.signal?.reason)
      },
      { once: true },
    )
    req.end(typeof init.body === 'string' ? init.body : undefined)
  })
}
