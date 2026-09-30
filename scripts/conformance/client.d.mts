// Types of client.mjs for the TypeScript that imports it: the live e2e journeys (packages/cli/test/e2e/hubspot.ts).

export declare const API: string
export declare const MANIFEST_FORMAT: 'kalup-conformance-manifest/1'
export declare const READ_DEADLINE_MS: number
export declare const CONFORMANCE: 'kalupconf'
export declare const E2E: 'kalup_e2e'
export declare const ACCOUNT_TYPES: ReadonlySet<string>

export declare const paths: {
  accountInfo: string
  group: (objectType: string, name: string) => string
  groups: (objectType: string) => string
  limits: (kind: string) => string
  properties: (objectType: string) => string
  property: (objectType: string, name: string) => string
  record: (objectType: string, id: string) => string
  records: (objectType: string) => string
  schema: (objectType: string) => string
  schemas: string
}

/** An answer. A network failure, a timeout or a body cut short has no status, and `error` says which. */
export interface Answer {
  body: unknown
  correlationId: string | null
  error: 'timeout' | 'network' | null
  headers: Headers
  rateHeaders: string[]
  status: number | null
}

export interface Resource {
  dataSensitivity?: string
  /** A record's ID, once its create has answered. */
  id?: string
  /** Every resource's internal name; a record's `name` property. */
  name: string
  objectType: string
  sentAt?: string
  type: 'group' | 'property' | 'record'
}

export type Named = Pick<Resource, 'type' | 'objectType' | 'name'>

export interface Cleaned {
  complete: boolean
  resources: { address: string; detail?: string; result: string; status?: number | null }[]
}

export interface ManifestData {
  cleanup?: Cleaned & { at?: string }
  createdAt: string
  format: typeof MANIFEST_FORMAT
  prefix: string
  resources: Resource[]
  runId: string
  [field: string]: unknown
}

export interface Manifest {
  add: (resource: Resource) => void
  data: ManifestData
  file: string
  holds: (resource: Named) => boolean
  record: (cleaned: Cleaned & { at?: string }) => void
}

export interface Client {
  create: (resource: Resource, path: string, body: unknown) => Promise<Answer>
  log: unknown[]
  manifest: Manifest | undefined
  read: (path: string, options?: { hide?: string; query?: Record<string, string> }) => Promise<Answer>
  write: (resource: Named, method: string, path: string, body?: unknown) => Promise<Answer>
}

export interface Polled<T> {
  ms: number
  polls: number
  value?: T
  visible: boolean
}

export type Poll = <T>(
  probe: () => Promise<T | undefined | false>,
  overrides?: { deadlineMs?: number; intervalMs?: number },
) => Promise<Polled<T>>

export declare function createClient(options: {
  fetch: typeof globalThis.fetch
  gapMs: number
  key: string
  sleep: (ms: number) => Promise<void>
}): Client

export declare function poller(options: {
  deadlineMs: number
  intervalMs: number
  now: () => number
  sleep: (ms: number) => Promise<void>
}): Poll

export declare function guard(
  client: Client,
  portalId: number,
  variable: string,
): Promise<{ account: { accountType: string }; refusal?: undefined } | { account?: undefined; refusal: string }>

export declare function answered(answer: Answer): string
export declare function prefixOf(runId: string, namespace?: typeof CONFORMANCE | typeof E2E): string
export declare function refuseWrite(manifest: Manifest | undefined, resource: Named): string | undefined
export declare function addressOf(resource: Named): string
export declare function newManifest(
  file: string,
  fields: { prefix: string; runId: string } & Record<string, unknown>,
): Manifest
export declare function readManifest(file: string, namespace?: typeof CONFORMANCE | typeof E2E): Manifest
export declare function cleanup(client: Client, manifest: Manifest, poll: Poll): Promise<Cleaned>
