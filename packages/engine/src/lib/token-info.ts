// Token introspection for `status`: the scopes a service key holds, from HubSpot's token-info endpoint. The key goes
// in the JSON body, as HubSpot requires, to the same host the Authorization header already reaches; no code logs or
// journals a request body, and the answer is scrubbed like every read. Any refusal or an answer without a scope list
// means "unknown", never an error: the list probes stay the check that sends real requests.
import type { HttpClient } from './http.js'
import { HubSpotApiError } from './http.js'
import { sanitize } from './sanitize.js'

export interface TokenInfo {
  /** The scopes the key holds, as HubSpot names them: sensitive scopes carry a `.v2` suffix (observed 2026-10-01). */
  scopes: string[]
}

/** The key's scopes, or undefined when HubSpot refused the request or answered without a scope list. */
export async function readTokenInfo(http: HttpClient, key: string): Promise<TokenInfo | undefined> {
  let answer: unknown
  try {
    answer = await http.request({ type: 'tokenInfo', path: 'read', body: { tokenKey: key } })
  } catch (error) {
    if (error instanceof HubSpotApiError) {
      return undefined
    }
    throw error
  }
  const scopes = typeof answer === 'object' && answer !== null ? (answer as { scopes?: unknown }).scopes : undefined
  if (!(Array.isArray(scopes) && scopes.every((scope) => typeof scope === 'string'))) {
    return undefined
  }
  return { scopes: scopes.map((scope) => sanitize(scope)) }
}

/** Whether `held` names `scope`, as is or with a version suffix HubSpot adds (`.sensitive.write.v2`). */
export function holdsScope(held: readonly string[], scope: string): boolean {
  return held.some((name) => name === scope || name.replace(VERSION_SUFFIX, '') === scope)
}

const VERSION_SUFFIX = /\.v\d+$/
