// The conformance checks against the HubSpot API: the read questions of docs/architecture.md section 13 and the
// property and group write lifecycle apply relies on (ADR 0021). Each check records pass, fail or not-applicable, the
// assumption it tests (what Kalup's code and the CLI tests' simulator take as HubSpot's answer), the observed facts and
// the requests it sent. Pass means the portal behaved as assumed; fail means it did not, or a request failed, and the
// facts say how. Only the run's own resources are created, changed or archived.
import { isDeepStrictEqual } from 'node:util'
import { paths } from './client.mjs'

export class NotApplicable extends Error {}

/** `value`, or the check is not applicable for `reason`. */
export function need(value, reason) {
  if (!value) {
    throw new NotApplicable(reason)
  }
  return value
}

/** `value`, or the check fails with `message`: a request that failed, or an answer that makes the rest meaningless. */
export function must(value, message) {
  if (!value) {
    throw new Error(message)
  }
  return value
}

const STATUS_LABEL = { pass: 'pass', fail: 'FAIL', 'not-applicable': 'n/a ' }
const MESSAGE_LIMIT = 300

/**
 * Runs one check: `body` returns { pass, note, facts, value }. A NotApplicable throw is not-applicable with its reason;
 * any other throw fails the check with the error. Returns `value`, or undefined when the check did not run.
 */
export async function check(ctx, spec, body) {
  const from = ctx.client.log.length
  let outcome
  try {
    const { pass, note, facts = {}, value } = await body()
    outcome = { status: pass ? 'pass' : 'fail', note, facts, value }
  } catch (error) {
    outcome =
      error instanceof NotApplicable
        ? { status: 'not-applicable', reason: error.message, facts: {} }
        : { status: 'fail', note: 'the check stopped on an error', facts: { error: messageOf(error) } }
  }
  const requests = ctx.client.log.slice(from).map(requestFact)
  ctx.results.push({
    id: spec.id,
    title: spec.title,
    gate: spec.gate,
    assumption: spec.assumption,
    status: outcome.status,
    ...(outcome.reason ? { reason: outcome.reason } : {}),
    ...(outcome.note ? { note: outcome.note } : {}),
    facts: outcome.facts,
    requests,
  })
  ctx.say(`${STATUS_LABEL[outcome.status]}  ${spec.id}${outcome.reason ? `: ${outcome.reason}` : ''}`)
  return outcome.value
}

function requestFact(entry) {
  return {
    method: entry.method,
    path: entry.path,
    ...(Object.keys(entry.query).length > 0 ? { query: entry.query } : {}),
    status: entry.status,
    ...(entry.error ? { error: entry.error } : {}),
    ...(entry.correlationId ? { correlationId: entry.correlationId } : {}),
    ms: entry.ms,
  }
}

export function messageOf(error) {
  return (error instanceof Error ? error.message : String(error)).slice(0, MESSAGE_LIMIT)
}

/** Runs `fn` over `items` one at a time. */
export async function serial(items, fn) {
  const out = []
  for (const item of items) {
    // biome-ignore lint/performance/noAwaitInLoops: serial HubSpot requests, paced by the client
    out.push(await fn(item))
  }
  return out
}

/**
 * A poll over `probe` until it returns a truthy value: { visible, ms, polls, value }. It stops at `deadlineMs`, and
 * after one poll per 500 ms of the deadline at most, so a sleep that returns at once still ends.
 */
export function poller({ sleep, now, intervalMs, deadlineMs }) {
  return function poll(probe, overrides = {}) {
    const interval = overrides.intervalMs ?? intervalMs
    const deadline = overrides.deadlineMs ?? deadlineMs
    const maxPolls = Math.ceil(deadline / Math.max(interval, 500))
    const started = now()
    async function attempt(polls) {
      const value = await probe()
      const ms = Math.round(now() - started)
      if (value) {
        return { visible: true, ms, polls, value }
      }
      if (ms >= deadline || polls >= maxPolls) {
        return { visible: false, ms, polls }
      }
      await sleep(interval)
      return attempt(polls + 1)
    }
    return attempt(1)
  }
}

// The request bodies: Kalup's create payload (packages/cli/src/engine/apply-payload.ts createBody) for invented
// definitions. A test holds them equal to what createBody builds.

export function groupBody(name, label) {
  return { name, label }
}

export function textBody(name, groupName) {
  return {
    name,
    label: 'Kalup conformance text',
    type: 'string',
    fieldType: 'text',
    groupName,
    description: 'Created by a Kalup conformance run',
  }
}

export function numberBody(name, groupName) {
  return {
    name,
    label: 'Kalup conformance number',
    type: 'number',
    fieldType: 'number',
    groupName,
    description: 'Created by a Kalup conformance run',
  }
}

/** A calculation property whose formula uses the number property `used`: the one use a run can make of its own. */
export function calculationBody(name, groupName, used) {
  return {
    name,
    label: 'Kalup conformance calculation',
    type: 'number',
    fieldType: 'calculation_equation',
    groupName,
    calculationFormula: formulaUsing(used),
  }
}

function formulaUsing(used) {
  return `${used} * 2`
}

export function choiceBody(name, groupName) {
  return {
    name,
    label: 'Kalup conformance choice',
    type: 'enumeration',
    fieldType: 'select',
    groupName,
    options: [
      { value: 'alpha', label: 'Alpha', displayOrder: 0, hidden: false },
      { value: 'beta', label: 'Beta', description: 'The second option', displayOrder: 1, hidden: false },
      { value: 'gamma', label: 'Gamma', hidden: true, displayOrder: 2 },
    ],
  }
}

/**
 * A property as Kalup's pull normalizer sees it (packages/cli/src/lib/pull/normalize.ts, definitionOf and
 * normalizeOptions), with its `type`: the owned fields a create is compared on. A test holds the two equal.
 */
export function normalizeProperty(raw) {
  const options = raw.type === 'enumeration' ? normalizeOptions(raw.options ?? []) : undefined
  return compact({
    type: raw.type,
    label: raw.label,
    group: raw.groupName,
    fieldType: raw.fieldType,
    description: raw.description || undefined,
    options: options?.length ? options : undefined,
    hasUniqueValue: raw.hasUniqueValue || undefined,
    formField: raw.formField || undefined,
  })
}

// Display order: lowest non-negative first, a negative or missing one last, ties in the order given.
function normalizeOptions(raw) {
  const order = (o) => (o.displayOrder === undefined || o.displayOrder < 0 ? Number.MAX_SAFE_INTEGER : o.displayOrder)
  return [...raw]
    .sort((a, b) => order(a) - order(b))
    .map((o) =>
      compact({
        value: o.value,
        label: o.label,
        hidden: o.hidden || undefined,
        description: o.description || undefined,
      }),
    )
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined))
}

/**
 * The live options as the OptionInput list a PATCH sends, each as apply completes it (apply-payload.ts, complete): a
 * missing displayOrder is -1, a missing hidden false, and a description goes when HubSpot returned one. A test holds
 * it equal to apply's optionsPatch with no changes.
 */
export function optionInputs(options = []) {
  return options.map((o) => ({
    label: o.label,
    value: o.value,
    displayOrder: o.displayOrder ?? -1,
    hidden: o.hidden ?? false,
    ...(typeof o.description === 'string' ? { description: o.description } : {}),
  }))
}

function isInteger(value) {
  return Number.isInteger(value)
}

function errorFacts(answer) {
  const body = errorOf(answer.body)
  return {
    status: answer.status,
    ...(answer.error ? { error: answer.error } : {}),
    ...(body.category ? { category: body.category } : {}),
    ...(body.subCategory ? { subCategory: body.subCategory } : {}),
    ...(typeof body.message === 'string' ? { message: body.message.slice(0, MESSAGE_LIMIT) } : {}),
    correlationId: answer.correlationId,
  }
}

/**
 * An error body's fields. HubSpot refused a group archive with its error body nested, as JSON text, in `message`
 * (run 89b45da9): the nested fields fill in what the outer body lacks, and the nested message replaces the JSON text,
 * as Kalup's HTTP client reads it.
 */
function errorOf(body) {
  const outer = typeof body === 'object' && body !== null ? body : {}
  let inner = {}
  try {
    const parsed = typeof outer.message === 'string' ? JSON.parse(outer.message) : undefined
    inner = typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    inner = {}
  }
  const field = (name) => (typeof outer[name] === 'string' ? outer[name] : inner[name])
  return {
    category: field('category'),
    subCategory: field('subCategory'),
    message: typeof inner.message === 'string' ? inner.message : outer.message,
  }
}

/** Whether `scopes`, the --scopes list, names a crm.objects scope, which Limits Tracking custom-properties needs. */
function namesObjectsScope(scopes) {
  return scopes?.some((scope) => scope.startsWith('crm.objects.')) ?? false
}

/**
 * The status Limits Tracking custom-properties should answer: 403 when --scopes names no crm.objects scope, as observed
 * (run 89b45da9), 200 when it names one. With no --scopes the key's scopes are unknown, so `expected` is null: a 403
 * and a reading with figures both pass, and the facts say which came back.
 */
function limitExpectation(scopes) {
  if (!Array.isArray(scopes)) {
    return { expected: null, named: 'no --scopes, so a 403 or a reading passes' }
  }
  const objectsScope = namesObjectsScope(scopes)
  return { expected: objectsScope ? 200 : 403, named: `--scopes names ${objectsScope ? 'a' : 'no'} crm.objects scope` }
}

const PROPERTIES_PATH = /^\/crm\/properties\/[^/]+\/([^/]+)/
const CUSTOM_SCOPE = /^crm\.(schemas|objects)\.custom\./
const STANDARD_OBJECT = /^[a-z_]+$/

/**
 * Whether the declared `scopes` should have let the key read `path`: a crm.objects scope for Limits Tracking
 * custom-properties, which answered 403 to crm.schemas scopes alone (run 89b45da9); a custom scope for the schemas, the
 * custom object limit and a custom object's lists; the object's own scope for a standard object's lists. A path the run
 * knows no scope for (account-info) is always covered, and with no --scopes nothing else is.
 */
function covers(scopes, path) {
  const any = (test) => scopes?.some(test) ?? false
  const custom = (scope) => CUSTOM_SCOPE.test(scope)
  if (path === paths.limits('custom-properties')) {
    return namesObjectsScope(scopes)
  }
  if (path === paths.limits('custom-object-types') || path.startsWith(paths.schemas)) {
    return any(custom)
  }
  const object = PROPERTIES_PATH.exec(path)?.[1]
  if (object === undefined) {
    return true
  }
  const standard = STANDARD_OBJECT.test(object)
  return any((scope) =>
    standard ? scope.startsWith(`crm.schemas.${object}.`) || scope.startsWith(`crm.objects.${object}.`) : custom(scope),
  )
}

function isRejection(status) {
  return typeof status === 'number' && status >= 400 && status < 500
}

// The specs of the read checks. `gate` names the release gate and the item in docs/architecture.md section 13.
export const READ_CHECKS = {
  unknownProperty: {
    id: 'read.unknown-property-404',
    title: 'A single property read of a name the object does not hold, with and without dataSensitivity',
    gate: 'A 404 for an unknown property name (architecture 13.12)',
    assumption: 'Every read answers 404, which apply reads as "not found by this query", never as absence.',
  },
  sensitiveLists: {
    id: 'read.sensitive-lists',
    title: 'The sensitive and highly_sensitive properties lists of each object the run reads',
    gate: 'The sensitive and highly_sensitive properties lists',
    assumption: 'Both lists answer 200 on this account; a 403 would make every object an incomplete read.',
  },
  sensitiveWithout: {
    id: 'read.sensitive-property-without-sensitivity',
    title:
      "A single read of a sensitive property without its dataSensitivity: the run's own when --scopes names the companies sensitive write scope, else one the portal holds",
    gate: 'A 404 for a sensitive property read without its dataSensitivity (architecture 13.12)',
    assumption: 'The read without dataSensitivity answers 404; with its sensitivity it answers 200.',
  },
  limitsProperties: {
    id: 'read.limits-custom-properties',
    title: 'Limits Tracking custom-properties: figures, and whether byObjectType carries standard objects',
    gate: 'Limits Tracking readings (ADR 0018)',
    assumption:
      '403 when --scopes names no crm.objects scope, as observed on 2026-09-29, and plan warns W_LIMIT_UNREADABLE. When it names one: 200 with integer overallLimit and overallUsage; byObjectType entries carry objectTypeId, limit and usage. With no --scopes, either answer passes; the facts record which, and for a 403 its category and the scopes it names.',
  },
  limitsObjectTypes: {
    id: 'read.limits-custom-object-types',
    title: 'Limits Tracking custom-object-types on this account type',
    gate: 'Limits Tracking custom-object-types on a non-Enterprise portal',
    assumption: '200 with integer limit and usage; anything else is an unreadable reading that blocks nothing.',
  },
  customObjects: {
    id: 'read.custom-object-schemas',
    title: 'The custom object schemas list',
    gate: 'The scopes a service key needs (architecture 13.9)',
    assumption: '200; the first custom object, if any, gets the write lifecycle too.',
  },
  secondaryOrder: {
    id: 'read.secondary-display-properties-order',
    title: "The order of a custom object schema's secondaryDisplayProperties across reads",
    gate: 'The order of secondaryDisplayProperties',
    assumption: 'The list read and repeated single reads return one order, so compare can treat it as ordered.',
  },
  archivedSensitivity: {
    id: 'read.archived-list-sensitivity',
    title: 'Whether the archived properties list filters by dataSensitivity',
    gate: 'Whether the archived properties list filters by dataSensitivity as the live list does',
    assumption:
      'It filters: an archived non-sensitive property is in the non_sensitive archived list and not in the other two.',
  },
  archivedGroups: {
    id: 'read.archived-groups-in-list',
    title: 'Whether an archived group appears in the groups list',
    gate: 'Whether archived groups appear in the groups list',
    assumption:
      'It leaves the list, as observed on 2026-09-29, so plan cannot see the archived name; plan keeps its check for an account that lists one.',
  },
  rateHeaders: {
    id: 'read.rate-limit-headers',
    title: "Which X-HubSpot-RateLimit headers the key's responses carry, daily included",
    gate: 'Rate-limit headers for service keys (architecture 13.4)',
    assumption: 'Max, Remaining, Interval-Milliseconds and Daily-Remaining arrive, so plan and apply can budget.',
  },
  scopes: {
    id: 'read.scopes',
    title: 'The 403s the key met on account-info, Limits Tracking and the lists',
    gate: 'The scopes a service key needs for account-info and Limits Tracking (architecture 13.9, 13.15)',
    assumption:
      'No 403 on a read the --scopes list should cover: a crm.objects scope for Limits Tracking custom-properties (a 403 without one was observed on 2026-09-29), a custom scope for the schemas and custom object reads, the object scope for its lists. With no --scopes, no 403 is a finding.',
  },
}

// The specs of one object's write lifecycle checks, by key. The id carries the object: write.<object>.<key>.
const WRITE_CHECKS = {
  'group-create': {
    title: 'Group create: status and body',
    gate: 'Properties and groups first; each write adapter has live conformance evidence',
    assumption: '201 with name, label and archived: false, and the group in the groups list.',
  },
  'group-label-update': {
    title: 'Group label update',
    gate: 'Properties and groups first; each write adapter has live conformance evidence',
    assumption: '200, and the groups list shows the new label.',
  },
  'property-create': {
    title: 'Property create, a text and an enumeration: status and body',
    gate: 'Properties and groups first; each write adapter has live conformance evidence',
    assumption: '201 with the Property body for each.',
  },
  'read-after-write-lag': {
    title: 'Read-after-write lag after a property create, for the single read and the list',
    gate: 'Read-after-write lag for single reads and for lists (architecture 13.5)',
    assumption: 'Both show the property within the 60 seconds apply reads back for.',
  },
  'create-round-trip': {
    title: 'normalize(read(create(x))) equals x for each owned field, and every field HubSpot rewrote',
    gate: 'What HubSpot rewrites on create (architecture 13.3)',
    assumption: "Kalup's normalizer gives back every owned field sent; the simulator stores what it is sent.",
  },
  'modification-metadata': {
    title: 'modificationMetadata on the created properties',
    gate: 'Read-only definitions (ADR 0021 write matrix)',
    assumption: 'archivable true, readOnlyDefinition false and readOnlyValue false on a property the run created.',
  },
  'label-description-update': {
    title: 'Property label and description update, as apply sends it with the live type and fieldType',
    gate: 'Properties and groups first; each write adapter has live conformance evidence',
    assumption: '200, and the single read shows both values.',
  },
  'patch-without-options': {
    title: 'A property PATCH that carries no options',
    gate: 'Options left out of a property PATCH (architecture 13.13)',
    assumption: 'The options stay as they were.',
  },
  'option-added': {
    title: 'An option added: the full live list plus one, after the highest displayOrder',
    gate: 'Options left out of a property PATCH (architecture 13.13)',
    assumption: '200, and the new option reads back.',
  },
  'option-label-changed': {
    title: 'An option label changed in the full live list',
    gate: 'Options left out of a property PATCH (architecture 13.13)',
    assumption: '200, and the new label reads back.',
  },
  'option-left-out': {
    title: 'An option left out of the options a PATCH sends',
    gate: 'Options left out of a property PATCH (architecture 13.13)',
    assumption: 'It is removed: HubSpot replaces the whole list, which is why apply always sends the full list.',
  },
  'field-type-change': {
    title: 'A fieldType change on a test property (text to textarea)',
    gate: 'ADR 0021 write matrix: fieldType is written, at risk risky',
    assumption: '200, and the new fieldType reads back.',
  },
  'create-existing-name': {
    title: 'A create of a name the object already holds, active',
    gate: 'A create of a name that already exists (architecture 13.11)',
    assumption:
      'A definite 4xx, and the property unchanged. Observed on 2026-09-29: 409 OBJECT_ALREADY_EXISTS, subCategory Properties.PROPERTY_WITH_NAME_EXISTS.',
  },
  archive: {
    title: 'Property archive',
    gate: 'Deletes: HubSpot archives a deleted property',
    assumption: '204, and the archived read shows it archived.',
  },
  'archived-single-read': {
    title: 'The single read of an archived property, without and with archived=true',
    gate: 'A 404 for an unknown property name (architecture 13.12); apply settles a delete by the archived read',
    assumption: '404 without archived; 200 with archived=true, archived: true and an archivedAt.',
  },
  'create-archived-name': {
    title: "A create of an archived property's name within the restore window",
    gate: "Whether an archived property's name can be reused (architecture 13.6)",
    assumption:
      '201, and the archived property is restored, as observed on 2026-09-29: it reads active with its old createdAt, and the archived read answers 404. plan blocks such a create and says so.',
  },
  'archive-group-holding-property': {
    title: 'Archiving a group that still holds an active property',
    gate: 'Archiving a group that still holds properties (architecture 13.14)',
    assumption:
      'A definite 4xx, and the group and its property stay active. Observed on 2026-09-29: 400, subCategory PropertyGroupError.GROUP_WITH_ACTIVE_PROPERTIES in an error body nested in the message.',
  },
  'archive-property-in-use': {
    title: "Archiving a property a calculation property's formula uses, both the run's own",
    gate: 'Whether the API archive of an in-use property is refused (architecture 13.7)',
    assumption:
      '400 VALIDATION_ERROR, subCategory PropertyValidationError.CANNOT_DELETE_PROPERTY_IN_USE, and both properties stay active, as observed on 2026-09-29: Kalup checks no use before a delete, and apply reports the refusal in plain words. Uses in workflows, lists and forms stay open.',
  },
  'create-archived-group-name': {
    title: "A group create of an archived group's name",
    gate: "What a create of an archived group's name does (architecture 13.14)",
    assumption:
      "Not yet known, so any definite answer passes and the facts say which: restored (the old label reads back), created (the new label reads back: a new group, or the old one restored with the new label) or refused (the group stays out of the list). plan cannot see an archived group's name in the list, so it would plan such a create.",
  },
}

/** The check a second key without crm.schemas.companies.write makes, when KALUP_CONFORMANCE_LIMITED_KEY holds one. */
export const SCOPE_CHECK = {
  id: 'write.companies.missing-write-scope',
  title: 'A group create on companies with a second key that lacks crm.schemas.companies.write',
  gate: 'The scopes a write key needs (architecture 13.9)',
  assumption:
    "403 and nothing created. Kalup's E_SCOPE names crm.schemas.companies.write from its registry and quotes HubSpot's message; the facts record the scopes HubSpot names.",
}

/** The scope the companies group create needs, as the CLI's endpoint registry names it. */
const GROUP_WRITE_SCOPE = 'crm.schemas.companies.write'
const SENSITIVE_WRITE = /^crm\.objects\.companies\.sensitive\.write(?:\.v2)?$/
const SCOPE_FIELD = /scopes/i
const SCOPE_NAME = /^[a-z][a-z0-9_.-]{0,99}$/
/** Why a run that cannot create a use leaves the in-use question open, as docs/conformance/checklist.md states it. */
const IN_USE_OPEN =
  'so whether the API archive of an in-use property is refused stays open (architecture 13.7): the run archives only its own properties, which nothing else uses'

function writeSpec(key, label) {
  return { id: `write.${label}.${key}`, ...WRITE_CHECKS[key] }
}

/** The read checks that need no write. Returns the custom object the lifecycle also runs on, or why there is none. */
export async function readChecks(ctx) {
  const { client, prefix } = ctx
  await check(ctx, READ_CHECKS.unknownProperty, async () => {
    const path = paths.property('companies', `${prefix}absent`)
    const asked = await serial([undefined, 'non_sensitive', 'sensitive', 'highly_sensitive'], async (sensitivity) => {
      const answer = await client.read(path, sensitivity ? { query: { dataSensitivity: sensitivity } } : {})
      return { dataSensitivity: sensitivity ?? 'none', status: answer.status, category: answer.body?.category }
    })
    const statuses = asked.map(
      (a) => `${a.status} ${a.dataSensitivity === 'none' ? 'without dataSensitivity' : `with ${a.dataSensitivity}`}`,
    )
    return { pass: asked.every((a) => a.status === 404), note: statuses.join(', '), facts: { reads: asked } }
  })

  const custom = await check(ctx, READ_CHECKS.customObjects, async () => {
    const answer = await client.read(paths.schemas)
    const results = Array.isArray(answer.body?.results) ? answer.body.results.filter((s) => s.archived !== true) : []
    const [first] = [...results].sort((a, b) => String(a.objectTypeId).localeCompare(String(b.objectTypeId)))
    const value =
      answer.status === 200
        ? { schema: first, absent: first ? undefined : 'no custom object in the test portal' }
        : { absent: `the schemas list answered ${answer.status ?? answer.error}` }
    return {
      pass: answer.status === 200,
      note: answer.status === 200 ? `${results.length} custom objects` : `answered ${answer.status ?? answer.error}`,
      facts: { status: answer.status, customObjects: results.length },
      value,
    }
  })

  const objects = [
    { objectType: 'companies', label: 'companies' },
    ...(custom?.schema ? [{ objectType: custom.schema.objectTypeId, label: 'custom-object' }] : []),
  ]
  const sensitive = await check(ctx, READ_CHECKS.sensitiveLists, async () => {
    const lists = await serial(
      objects.flatMap((o) => ['sensitive', 'highly_sensitive'].map((s) => ({ ...o, sensitivity: s }))),
      async ({ objectType, label, sensitivity }) => {
        const answer = await client.read(paths.properties(objectType), { query: { dataSensitivity: sensitivity } })
        const results = Array.isArray(answer.body?.results) ? answer.body.results : []
        return {
          object: label,
          dataSensitivity: sensitivity,
          status: answer.status,
          count: results.length,
          results,
          objectType,
        }
      },
    )
    const found = lists.find((l) => l.status === 200 && l.results.length > 0)
    return {
      pass: lists.every((l) => l.status === 200),
      note: lists.map((l) => `${l.object} ${l.dataSensitivity} ${l.status}`).join(', '),
      facts: {
        lists: lists.map(({ object, dataSensitivity, status, count }) => ({ object, dataSensitivity, status, count })),
      },
      value: {
        readable: lists.every((l) => l.status === 200),
        property: found && {
          objectType: found.objectType,
          name: found.results[0].name,
          sensitivity: found.dataSensitivity,
        },
      },
    }
  })

  await check(ctx, READ_CHECKS.sensitiveWithout, async () => {
    need(sensitive?.readable, 'needs read.sensitive-lists')
    const { mine, property: created, why } = await ownSensitive(ctx)
    const property = mine
      ? created
      : need(sensitive.property, `no sensitive or highly sensitive property in the test portal to read, and ${why}`)
    const path = paths.property(property.objectType, property.name)
    // A portal property the run did not create shows as {name} in the log.
    const hide = mine ? undefined : property.name
    const without = await client.read(path, { hide })
    const withIt = await client.read(path, { query: { dataSensitivity: property.sensitivity }, hide })
    return {
      pass: without.status === 404 && withIt.status === 200,
      note: `${mine ? "the run's own: " : ''}${without.status} without dataSensitivity, ${withIt.status} with ${property.sensitivity}`,
      facts: {
        dataSensitivity: property.sensitivity,
        without: without.status,
        with: withIt.status,
        runProperty: mine,
        ...(mine ? {} : { why }),
      },
    }
  })

  await check(ctx, READ_CHECKS.limitsProperties, async () => {
    const answer = await client.read(paths.limits('custom-properties'))
    const body = answer.body ?? {}
    const entries = Array.isArray(body.byObjectType) ? body.byObjectType : []
    const standard = entries.filter((e) => typeof e?.objectTypeId === 'string' && e.objectTypeId.startsWith('0-'))
    const read = answer.status === 200 && isInteger(body.overallLimit) && isInteger(body.overallUsage)
    const { expected, named } = limitExpectation(ctx.scopes)
    return {
      pass: expected === 200 ? read : answer.status === 403 || (expected === null && read),
      note:
        answer.status === 200
          ? `byObjectType lists ${standard.length} standard and ${entries.length - standard.length} custom objects; ${named}`
          : `answered ${answer.status ?? answer.error}; ${named}`,
      facts: {
        expected,
        ...(answer.status === 200 ? {} : { ...errorFacts(answer), scopesNamed: scopesNamed(answer.body) }),
        status: answer.status,
        overallLimit: body.overallLimit ?? null,
        overallUsage: body.overallUsage ?? null,
        byObjectType: entries.length,
        standardObjects: standard
          .map((e) => ({
            objectTypeId: e.objectTypeId,
            singularLabel: e.singularLabel,
            limit: e.limit,
            usage: e.usage,
          }))
          .sort((a, b) => a.objectTypeId.localeCompare(b.objectTypeId)),
        customObjects: entries.length - standard.length,
      },
    }
  })

  await check(ctx, READ_CHECKS.limitsObjectTypes, async () => {
    const answer = await client.read(paths.limits('custom-object-types'))
    const body = answer.body ?? {}
    const figures = isInteger(body.limit) && isInteger(body.usage)
    return {
      pass: answer.status === 200 && figures,
      note:
        answer.status === 200
          ? `limit ${body.limit}, usage ${body.usage}`
          : `answered ${answer.status ?? answer.error}`,
      facts: {
        accountType: ctx.accountType,
        status: answer.status,
        limit: body.limit ?? null,
        usage: body.usage ?? null,
        ...(answer.status === 200 ? {} : errorFacts(answer)),
      },
    }
  })

  await check(ctx, READ_CHECKS.secondaryOrder, async () => {
    const schema = need(custom?.schema, custom?.absent ?? 'the schemas list was not read')
    const listed = schema.secondaryDisplayProperties
    need(
      Array.isArray(listed) && listed.length >= 2,
      'the custom object has fewer than two secondary display properties',
    )
    const reads = await serial([1, 2], () => client.read(paths.schema(schema.objectTypeId)))
    const orders = reads.map((r) => r.body?.secondaryDisplayProperties)
    const same = orders.every((order) => isDeepStrictEqual(order, listed))
    return {
      pass: reads.every((r) => r.status === 200) && same,
      note: same
        ? `one order of ${listed.length} across the list and two single reads`
        : 'the order differs between reads',
      facts: { count: listed.length, statuses: reads.map((r) => r.status), sameOrder: same },
    }
  })

  return (
    objects[1] ?? {
      objectType: undefined,
      label: 'custom-object',
      absent: custom?.absent ?? 'the schemas list was not read',
    }
  )
}

/**
 * A sensitive property of the run's own for the read without its dataSensitivity, in a group of its own: created when
 * --scopes names the companies sensitive write scope. Otherwise, or when a create fails, why there is none, and the
 * check reads one the portal already holds.
 */
async function ownSensitive(ctx) {
  if (!ctx.scopes?.some((scope) => SENSITIVE_WRITE.test(scope))) {
    return {
      mine: false,
      why: '--scopes names no crm.objects.companies.sensitive.write, so the run created no sensitive property of its own',
    }
  }
  const { client, prefix } = ctx
  const group = `${prefix}sensitive`
  const name = `${prefix}secret`
  const grouped = await client.create(
    { type: 'group', objectType: 'companies', name: group },
    paths.groups('companies'),
    groupBody(group, 'Kalup conformance sensitive'),
  )
  if (grouped.status !== 201) {
    return {
      mine: false,
      why: `the group create for the run's sensitive property answered ${grouped.status ?? grouped.error}`,
    }
  }
  const created = await client.create(
    { type: 'property', objectType: 'companies', name, dataSensitivity: 'sensitive' },
    paths.properties('companies'),
    { ...textBody(name, group), label: 'Kalup conformance sensitive', dataSensitivity: 'sensitive' },
  )
  if (created.status !== 201) {
    const category = created.body?.category ? ` ${created.body.category}` : ''
    return {
      mine: false,
      why: `the run's sensitive property create answered ${created.status ?? created.error}${category}`,
    }
  }
  const path = paths.property('companies', name)
  const seen = await ctx.poll(
    async () => (await client.read(path, { query: { dataSensitivity: 'sensitive' } })).status === 200,
  )
  if (!seen.visible) {
    return { mine: false, why: "the run's sensitive property did not read back within the deadline" }
  }
  return { mine: true, property: { objectType: 'companies', name, sensitivity: 'sensitive' } }
}

/**
 * The write lifecycle on one object: `{ objectType, label, absent? }`. With `absent` every check is not applicable
 * for that reason. The two read gates that need an archived property and an archived group, the in-use archive and the
 * create of an archived group's name run on companies only.
 */
export async function lifecycle(ctx, object) {
  const { client, prefix } = ctx
  const ot = object.objectType
  const spec = (key) => writeSpec(key, object.label)
  const names = {
    group: `${prefix}group`,
    text: `${prefix}text`,
    choice: `${prefix}choice`,
    holder: `${prefix}holder`,
    held: `${prefix}held`,
    empty: `${prefix}empty`,
    used: `${prefix}used`,
    uses: `${prefix}uses`,
    reused: `${prefix}reused`,
  }
  const resource = (type, name) => ({ type, objectType: ot, name })
  const needs = (value, id) => {
    need(!object.absent, object.absent)
    return need(value, `needs write.${object.label}.${id}`)
  }
  const readProperty = (name, query) => client.read(paths.property(ot, name), query ? { query } : {})
  const listGroups = async () => {
    const answer = await client.read(paths.groups(ot))
    return Array.isArray(answer.body?.results) ? answer.body.results : []
  }
  const bodies = { text: textBody(names.text, names.group), choice: choiceBody(names.choice, names.group) }

  const grouped = await check(ctx, spec('group-create'), async () => {
    need(!object.absent, object.absent)
    const created = await client.create(
      resource('group', names.group),
      paths.groups(ot),
      groupBody(names.group, 'Kalup conformance group'),
    )
    const listed = await ctx.poll(async () => (await listGroups()).find((g) => g.name === names.group))
    const pass = created.status === 201 && created.body?.name === names.group && created.body?.archived === false
    return {
      pass: pass && listed.visible,
      note: `${created.status}; in the groups list after ${listed.ms} ms (${listed.polls} reads)`,
      facts: {
        status: created.status,
        body: created.body,
        location: created.headers.has('location'),
        list: { visible: listed.visible, afterMs: listed.ms, reads: listed.polls },
      },
      value: created.status === 201,
    }
  })

  await check(ctx, spec('group-label-update'), async () => {
    needs(grouped, 'group-create')
    const label = 'Kalup conformance group, renamed'
    const answer = await client.write(resource('group', names.group), 'PATCH', paths.group(ot, names.group), { label })
    const seen = await ctx.poll(async () =>
      (await listGroups()).find((g) => g.name === names.group && g.label === label),
    )
    return {
      pass: answer.status === 200 && seen.visible,
      note: `${answer.status}; the list shows the label after ${seen.ms} ms`,
      facts: {
        status: answer.status,
        body: answer.body,
        list: { visible: seen.visible, afterMs: seen.ms, reads: seen.polls },
      },
    }
  })

  const created = await check(ctx, spec('property-create'), async () => {
    needs(grouped, 'group-create')
    const answers = await serial(['text', 'choice'], (key) =>
      client.create(resource('property', names[key]), paths.properties(ot), bodies[key]),
    )
    const [text, choice] = answers
    return {
      pass: answers.every((a) => a.status === 201 && a.body?.name !== undefined),
      note: `text ${text.status}, choice ${choice.status}`,
      facts: { text: { status: text.status, body: text.body }, choice: { status: choice.status, body: choice.body } },
      value: { text: text.status === 201, choice: choice.status === 201 },
    }
  })

  await check(ctx, spec('read-after-write-lag'), async () => {
    needs(created?.choice, 'property-create')
    const single = await ctx.poll(async () => (await readProperty(names.choice)).status === 200)
    const list = await ctx.poll(async () => {
      const answer = await client.read(paths.properties(ot))
      return answer.body?.results?.some((p) => p.name === names.choice)
    })
    return {
      pass: single.visible && list.visible,
      note: `single read after ${single.ms} ms (${single.polls} reads), list after ${list.ms} ms (${list.polls} reads)`,
      facts: {
        deadlineMs: ctx.deadlineMs,
        single: { visible: single.visible, afterMs: single.ms, reads: single.polls },
        list: { visible: list.visible, afterMs: list.ms, reads: list.polls },
      },
    }
  })

  const reads = await check(ctx, spec('create-round-trip'), async () => {
    needs(created?.text && created?.choice, 'property-create')
    const observed = await serial(['text', 'choice'], async (key) => {
      const seen = await ctx.poll(async () => {
        const answer = await readProperty(names[key])
        return answer.status === 200 && answer.body
      })
      const read = must(seen.value, `the ${key} property did not read back within the deadline`)
      return { key, read, ...roundTrip(bodies[key], read) }
    })
    const differs = observed.filter((o) => o.owned.length > 0)
    return {
      pass: differs.length === 0,
      note:
        differs.length === 0
          ? `every owned field round-trips; raw rewrites: ${observed.map((o) => `${o.key} ${o.rewritten.map((r) => r.field).join(' ') || 'none'}`).join(', ')}`
          : `owned fields rewritten: ${differs.map((o) => `${o.key} ${o.owned.map((d) => d.field).join(' ')}`).join(', ')}`,
      facts: Object.fromEntries(observed.map(({ key, owned, rewritten }) => [key, { owned, rewritten }])),
      value: Object.fromEntries(observed.map(({ key, read }) => [key, read])),
    }
  })

  await check(ctx, spec('modification-metadata'), () => {
    needs(reads, 'create-round-trip')
    const metadata = {
      text: reads.text.modificationMetadata ?? null,
      choice: reads.choice.modificationMetadata ?? null,
    }
    const writable = (m) => m?.archivable === true && m.readOnlyDefinition === false && m.readOnlyValue === false
    return {
      pass: writable(metadata.text) && writable(metadata.choice),
      note: `text ${JSON.stringify(metadata.text)}, choice ${JSON.stringify(metadata.choice)}`,
      facts: metadata,
    }
  })

  // A PATCH of `name` built from its live read, then reads until `settled` holds of the read. A definite 4xx changed
  // nothing, so it is not read back. `unsettled` is why no read-back holds: the PATCH was rejected, or its effect is
  // unknown (an error without a definite answer, or a read that never settled).
  async function patch(name, build, settled) {
    const live = await readProperty(name)
    must(live.status === 200, `the property read before the PATCH answered ${live.status ?? live.error}`)
    const body = build(live.body)
    const answer = await client.write(resource('property', name), 'PATCH', paths.property(ot, name), body)
    const rejected = isRejection(answer.status)
    const seen = rejected
      ? { visible: false, ms: 0, polls: 0 }
      : await ctx.poll(async () => {
          const after = await readProperty(name)
          return after.status === 200 && settled(after.body, answer.body) && after.body
        })
    const unsettled = rejected ? 'rejected' : 'unknown'
    return {
      before: live.body,
      sent: body,
      answer,
      seen,
      after: seen.value,
      unsettled: seen.visible ? null : unsettled,
    }
  }

  await check(ctx, spec('label-description-update'), async () => {
    needs(created?.text, 'property-create')
    const label = 'Kalup conformance text, renamed'
    const description = 'Changed by a Kalup conformance run'
    const done = await patch(
      names.text,
      (live) => ({ label, description, type: live.type, fieldType: live.fieldType }),
      (read) => read.label === label && read.description === description,
    )
    return {
      pass: done.answer.status === 200 && done.seen.visible,
      note: `${done.answer.status}; read back after ${done.seen.ms} ms`,
      facts: {
        status: done.answer.status,
        sent: done.sent,
        readBack: { visible: done.seen.visible, afterMs: done.seen.ms },
      },
    }
  })

  await check(ctx, spec('patch-without-options'), async () => {
    needs(created?.choice, 'property-create')
    const label = 'Kalup conformance choice, renamed'
    const done = await patch(
      names.choice,
      (live) => ({ label, type: live.type, fieldType: live.fieldType }),
      (read) => read.label === label,
    )
    const before = normalizeProperty(done.before).options
    const after = done.after ? normalizeProperty(done.after).options : undefined
    // Whether the options were kept is known only once the PATCH was accepted and read back.
    const kept = done.unsettled ? null : isDeepStrictEqual(before, after)
    let result = `the PATCH was ${done.unsettled}`
    if (kept !== null) {
      result = `options ${kept ? 'kept' : 'changed'}`
    }
    return {
      pass: done.answer.status === 200 && kept === true,
      note: `${done.answer.status ?? done.answer.error}; ${result}`,
      facts: {
        status: done.answer.status,
        sent: done.sent,
        optionsKept: kept,
        before,
        after: after ?? null,
        ...(kept === null ? errorFacts(done.answer) : {}),
      },
    }
  })

  await check(ctx, spec('option-added'), async () => {
    needs(created?.choice, 'property-create')
    const done = await patch(
      names.choice,
      (live) => {
        const options = optionInputs(live.options)
        const next = Math.max(-1, ...options.map((o) => o.displayOrder ?? -1)) + 1
        return {
          options: [...options, { label: 'Delta', value: 'delta', displayOrder: next, hidden: false }],
          type: live.type,
          fieldType: live.fieldType,
        }
      },
      (read) => read.options?.some((o) => o.value === 'delta'),
    )
    const added = done.after?.options?.find((o) => o.value === 'delta')
    return {
      pass: done.answer.status === 200 && added?.label === 'Delta',
      note: `${done.answer.status}; ${added ? `delta reads back at displayOrder ${added.displayOrder}` : 'delta does not read back'}`,
      facts: { status: done.answer.status, sent: done.sent.options, readBack: done.after?.options ?? null },
    }
  })

  await check(ctx, spec('option-label-changed'), async () => {
    needs(created?.choice, 'property-create')
    const label = 'Alpha, renamed'
    const done = await patch(
      names.choice,
      (live) => ({
        options: optionInputs(live.options).map((o) => (o.value === 'alpha' ? { ...o, label } : o)),
        type: live.type,
        fieldType: live.fieldType,
      }),
      (read) => read.options?.some((o) => o.value === 'alpha' && o.label === label),
    )
    return {
      pass: done.answer.status === 200 && done.seen.visible,
      note: `${done.answer.status}; ${done.seen.visible ? 'the label reads back' : 'the label does not read back'}`,
      facts: { status: done.answer.status, readBack: done.after?.options ?? null },
    }
  })

  await check(ctx, spec('option-left-out'), async () => {
    needs(created?.choice, 'property-create')
    const done = await patch(
      names.choice,
      (live) => ({
        options: optionInputs(live.options).filter((o) => o.value !== 'beta'),
        type: live.type,
        fieldType: live.fieldType,
      }),
      // Settled when the read agrees with the PATCH answer, whatever HubSpot did with beta.
      (read, answered) =>
        isDeepStrictEqual(normalizeProperty(read).options, answered ? normalizeProperty(answered).options : undefined),
    )
    // What happened to beta is read only from a read-back of an accepted PATCH; otherwise the PATCH is the outcome.
    const beta = done.after?.options?.find((o) => o.value === 'beta')
    let outcome = done.unsettled ?? 'removed'
    if (beta && !done.unsettled) {
      outcome = beta.hidden === true ? 'hidden' : 'kept'
    }
    const settled = !done.unsettled
    return {
      pass: done.answer.status === 200 && outcome === 'removed',
      note: `${done.answer.status ?? done.answer.error}; ${settled ? `the option left out was ${outcome}` : `the PATCH was ${outcome}`}`,
      facts: {
        status: done.answer.status,
        leftOut: 'beta',
        outcome,
        readBack: done.after?.options ?? null,
        ...(settled ? {} : errorFacts(done.answer)),
      },
    }
  })

  await check(ctx, spec('field-type-change'), async () => {
    needs(created?.text, 'property-create')
    const done = await patch(
      names.text,
      (live) => ({ type: live.type, fieldType: 'textarea' }),
      (read) => read.fieldType === 'textarea',
    )
    return {
      pass: done.answer.status === 200 && done.seen.visible,
      note: `${done.answer.status}; fieldType reads back ${done.after?.fieldType ?? done.before.fieldType}`,
      facts: {
        status: done.answer.status,
        before: done.before.fieldType,
        after: done.after?.fieldType ?? null,
        ...(done.answer.status === 200 ? {} : errorFacts(done.answer)),
      },
    }
  })

  await check(ctx, spec('create-existing-name'), async () => {
    needs(created?.text, 'property-create')
    const before = await readProperty(names.text)
    const answer = await client.create(resource('property', names.text), paths.properties(ot), bodies.text)
    const after = await readProperty(names.text)
    const unchanged =
      after.status === 200 &&
      isDeepStrictEqual(normalizeProperty(before.body ?? {}), normalizeProperty(after.body ?? {}))
    return {
      pass: isRejection(answer.status) && unchanged,
      note: `${answer.status}${answer.body?.category ? ` ${answer.body.category}` : ''}; the property ${unchanged ? 'is unchanged' : 'changed'}`,
      facts: { ...errorFacts(answer), unchanged },
    }
  })

  const archived = await check(ctx, spec('archive'), async () => {
    needs(created?.text, 'property-create')
    const answer = await client.write(resource('property', names.text), 'DELETE', paths.property(ot, names.text))
    const seen = await ctx.poll(async () => {
      const read = await readProperty(names.text, { archived: 'true' })
      return read.status === 200 && read.body?.archived === true
    })
    return {
      pass: answer.status === 204 && seen.visible,
      note: `${answer.status}; the archived read shows it after ${seen.ms} ms`,
      facts: {
        status: answer.status,
        archivedRead: { visible: seen.visible, afterMs: seen.ms, reads: seen.polls },
        ...(answer.status === 204 ? {} : errorFacts(answer)),
      },
      value: answer.status === 204 && seen.visible,
    }
  })

  await check(ctx, spec('archived-single-read'), async () => {
    needs(archived, 'archive')
    const plain = await readProperty(names.text)
    const withArchived = await readProperty(names.text, { archived: 'true' })
    const body = withArchived.body ?? {}
    return {
      pass:
        plain.status === 404 &&
        withArchived.status === 200 &&
        body.archived === true &&
        typeof body.archivedAt === 'string',
      note: `${plain.status} without archived, ${withArchived.status} with archived=true (archived ${body.archived})`,
      facts: {
        without: plain.status,
        with: withArchived.status,
        archived: body.archived ?? null,
        archivedAt: typeof body.archivedAt === 'string',
      },
    }
  })

  if (object.label === 'companies') {
    await check(ctx, READ_CHECKS.archivedSensitivity, async () => {
      needs(archived, 'archive')
      const lists = await serial(['non_sensitive', 'sensitive', 'highly_sensitive'], async (sensitivity) => {
        const answer = await client.read(paths.properties(ot), {
          query: { archived: 'true', dataSensitivity: sensitivity },
        })
        return {
          dataSensitivity: sensitivity,
          status: answer.status,
          holds: answer.body?.results?.some((p) => p.name === names.text) ?? false,
        }
      })
      const [plain, ...others] = lists
      const filters = plain.holds && others.every((l) => !l.holds)
      return {
        pass: lists.every((l) => l.status === 200) && filters,
        note: lists.map((l) => `${l.dataSensitivity} ${l.holds ? 'lists it' : 'does not list it'}`).join(', '),
        facts: { lists, filters },
      }
    })
  }

  await check(ctx, spec('create-archived-name'), async () => {
    needs(archived, 'archive')
    const before = await readProperty(names.text, { archived: 'true' })
    const answer = await client.create(resource('property', names.text), paths.properties(ot), bodies.text)
    // A definite 4xx created nothing, so one read shows the name; any other answer may have created it, so the active
    // read is polled for the read-after-write deadline before the outcome is chosen.
    const refused = isRejection(answer.status)
    let active
    const readActive = async () => {
      active = await readProperty(names.text)
      return active.status === 200
    }
    await (refused ? readActive() : ctx.poll(readActive))
    const still = await readProperty(names.text, { archived: 'true' })
    let outcome = refused ? 'refused' : 'unknown'
    if (active.status === 200) {
      outcome = active.body?.createdAt === before.body?.createdAt ? 'restored' : 'recreated'
    }
    const result =
      outcome === 'unknown' ? 'nothing reads back active, so its effect is unknown' : `the name was ${outcome}`
    // The text property was renamed and made a textarea before its archive, and the create posts the first definition,
    // so these show which one a restore keeps.
    const definitionOf = (property) => ({ label: property?.label ?? null, fieldType: property?.fieldType ?? null })
    return {
      pass: answer.status === 201 && outcome === 'restored' && still.status === 404,
      note: `${answer.status ?? answer.error}${answer.body?.category ? ` ${answer.body.category}` : ''}; ${result}`,
      facts: {
        ...errorFacts(answer),
        outcome,
        activeRead: active.status,
        archivedRead: still.status,
        definition: {
          archived: definitionOf(before.body),
          posted: definitionOf(bodies.text),
          active: active.status === 200 ? definitionOf(active.body) : null,
        },
      },
    }
  })

  await check(ctx, spec('archive-group-holding-property'), async () => {
    need(!object.absent, object.absent)
    const group = await client.create(
      resource('group', names.holder),
      paths.groups(ot),
      groupBody(names.holder, 'Kalup conformance holder'),
    )
    must(group.status === 201, `the holder group create answered ${group.status ?? group.error}`)
    const held = { ...textBody(names.held, names.holder), label: 'Kalup conformance held' }
    const property = await client.create(resource('property', names.held), paths.properties(ot), held)
    must(property.status === 201, `the held property create answered ${property.status ?? property.error}`)
    await ctx.poll(async () => (await readProperty(names.held)).status === 200)
    const answer = await client.write(resource('group', names.holder), 'DELETE', paths.group(ot, names.holder))
    const left = await afterGroupDelete(answer)
    const moved = left.propertyGroup !== null && left.propertyGroup !== names.holder
    return {
      pass: isRejection(answer.status) && left.group === 'active' && left.property === 'active' && !moved,
      note: `${answer.status}; the group is ${left.group}, its property ${left.property}${moved ? ` in ${left.propertyGroup}` : ''}`,
      facts: { ...errorFacts(answer), ...left },
    }
  })

  // Whether `uses` reads back with a formula that uses `used`: `create` when the create set it, `patch` when one PATCH
  // did (HubSpot documents editing a calculation formula through the properties API), undefined when neither shows it.
  async function formulaUses(uses, used) {
    const shows = (shown) => typeof shown?.calculationFormula === 'string' && shown.calculationFormula.includes(used)
    const seen = await ctx.poll(async () => {
      const answer = await readProperty(uses)
      return answer.status === 200 && answer.body
    })
    const read = must(seen.value, 'the calculation property did not read back within the deadline')
    if (shows(read)) {
      return 'create'
    }
    const body = { calculationFormula: formulaUsing(used) }
    const patched = await client.write(resource('property', uses), 'PATCH', paths.property(ot, uses), body)
    if (patched.status !== 200) {
      return undefined
    }
    const again = await ctx.poll(async () => {
      const answer = await readProperty(uses)
      return answer.status === 200 && shows(answer.body)
    })
    return again.visible ? 'patch' : undefined
  }

  // A property of the run as the reads show it: active, archived or unreadable, with the body read.
  async function stateOf(name) {
    const live = await readProperty(name)
    if (live.status === 200) {
      return { state: 'active', body: live.body }
    }
    const archivedRead = await readProperty(name, { archived: 'true' })
    const state = archivedRead.body?.archived === true ? 'archived' : `unreadable (${live.status ?? live.error})`
    return { state, body: archivedRead.body }
  }

  // What a DELETE of the holder group left: the group in the list, and the property it held. An accepted DELETE is
  // waited out until the list stops showing the group active, so the reads see what HubSpot settled on.
  async function afterGroupDelete(answer) {
    if (answer.status !== null && answer.status < 300) {
      await ctx.poll(async () => !(await listGroups()).some((g) => g.name === names.holder && g.archived !== true))
    }
    const listed = (await listGroups()).find((g) => g.name === names.holder)
    let group = 'absent'
    if (listed) {
      group = listed.archived ? 'archived' : 'active'
    }
    const active = await readProperty(names.held)
    if (active.status === 200) {
      return { group, property: 'active', propertyGroup: active.body?.groupName ?? null }
    }
    const archivedRead = await readProperty(names.held, { archived: 'true' })
    const property = archivedRead.body?.archived === true ? 'archived' : `unreadable (${active.status})`
    return { group, property, propertyGroup: archivedRead.body?.groupName ?? null }
  }

  if (object.label === 'companies') {
    await check(ctx, spec('archive-property-in-use'), async () => {
      needs(grouped, 'group-create')
      const used = await client.create(
        resource('property', names.used),
        paths.properties(ot),
        numberBody(names.used, names.group),
      )
      must(used.status === 201, `the used property create answered ${used.status ?? used.error}`)
      const calculation = await client.create(
        resource('property', names.uses),
        paths.properties(ot),
        calculationBody(names.uses, names.group, names.used),
      )
      if (isRejection(calculation.status)) {
        const category = calculation.body?.category ? ` ${calculation.body.category}` : ''
        throw new NotApplicable(
          `the calculation property create answered ${calculation.status}${category}: this key and portal cannot create a use of a run property, ${IN_USE_OPEN}`,
        )
      }
      must(
        calculation.status === 201,
        `the calculation property create answered ${calculation.status ?? calculation.error}`,
      )
      const formulaSetBy = need(
        await formulaUses(names.uses, names.used),
        `the calculation property does not read back with a formula that uses ${names.used}, ${IN_USE_OPEN}`,
      )
      const answer = await client.write(resource('property', names.used), 'DELETE', paths.property(ot, names.used))
      if (answer.status !== null && answer.status < 300) {
        await ctx.poll(async () => (await readProperty(names.used, { archived: 'true' })).body?.archived === true)
      }
      const [usedState, calculationState] = await serial([names.used, names.uses], stateOf)
      return {
        pass: refusedInUse(answer) && usedState.state === 'active' && calculationState.state === 'active',
        note: `${answer.status ?? answer.error}${categoryOf(answer)}; the property in use is ${usedState.state}, the calculation ${calculationState.state}`,
        facts: {
          ...errorFacts(answer),
          formulaSetBy,
          used: usedState.state,
          calculation: calculationState.state,
          formulaAfter: calculationState.body?.calculationFormula ?? null,
        },
      }
    })

    await check(ctx, READ_CHECKS.archivedGroups, async () => {
      const group = await client.create(
        resource('group', names.empty),
        paths.groups(ot),
        groupBody(names.empty, 'Kalup conformance empty'),
      )
      must(group.status === 201, `the empty group create answered ${group.status ?? group.error}`)
      await ctx.poll(async () => (await listGroups()).some((g) => g.name === names.empty))
      const answer = await client.write(resource('group', names.empty), 'DELETE', paths.group(ot, names.empty))
      const seen = await ctx.poll(async () => {
        const found = (await listGroups()).find((g) => g.name === names.empty)
        return found?.archived === true ? 'archived' : !found && 'absent'
      })
      const listed = seen.value ?? 'active'
      const shown = {
        archived: 'is in the list with archived: true',
        absent: 'is absent from the list',
        active: 'still reads active in the list',
      }
      return {
        pass: answer.status === 204 && listed === 'absent',
        note: `${answer.status}; the group ${shown[listed]}`,
        facts: { status: answer.status, listed, afterMs: seen.ms },
      }
    })

    // A run group created with `label`, then archived, waited out until the list no longer shows it active.
    async function archivedGroup(group, label) {
      const create = await client.create(group, paths.groups(ot), groupBody(group.name, label))
      must(create.status === 201, `the group create answered ${create.status ?? create.error}`)
      await ctx.poll(async () => (await listGroups()).some((g) => g.name === group.name))
      const archive = await client.write(group, 'DELETE', paths.group(ot, group.name))
      must(archive.status === 204, `the group archive answered ${archive.status ?? archive.error}`)
      await ctx.poll(async () => !(await listGroups()).some((g) => g.name === group.name && g.archived !== true))
    }

    await check(ctx, spec('create-archived-group-name'), async () => {
      need(!object.absent, object.absent)
      const reused = resource('group', names.reused)
      await archivedGroup(reused, GROUP_LABELS.first)
      const answer = await client.create(reused, paths.groups(ot), groupBody(names.reused, GROUP_LABELS.second))
      // A definite 4xx created nothing, so one read shows the list; any other answer may have, so it is polled.
      const refused = isRejection(answer.status)
      const activeOf = async () => (await listGroups()).find((g) => g.name === names.reused && g.archived !== true)
      const active = refused ? await activeOf() : (await ctx.poll(activeOf)).value
      const outcome = groupOutcome(refused, active)
      return {
        pass: outcome !== 'unknown' && (refused || answer.status === 201),
        note: `${answer.status ?? answer.error}${categoryOf(answer)}; ${GROUP_OUTCOMES[outcome]}`,
        facts: { ...errorFacts(answer), outcome, label: active?.label ?? null },
      }
    })
  }
}

// The labels of a group created, archived and created again by name.
const GROUP_LABELS = { first: 'Kalup conformance reused', second: 'Kalup conformance reused again' }

const GROUP_OUTCOMES = {
  restored: 'the archived group was restored with its old label',
  created: 'a group with the new label reads back',
  refused: 'the group stays out of the list',
  unknown: 'nothing reads back, so its effect is unknown',
}

// What a group create of an archived group's name did: the group is active again with its old label or with the new
// one, or it was refused and stays out of the list; unknown when an accepted create never reads back.
function groupOutcome(refused, active) {
  if (active) {
    return active.label === GROUP_LABELS.first ? 'restored' : 'created'
  }
  return refused ? 'refused' : 'unknown'
}

// HubSpot's refusal to archive a property in use (run 89b45da9): 400, subCategory ...CANNOT_DELETE_PROPERTY_IN_USE.
function refusedInUse(answer) {
  const { subCategory } = errorOf(answer.body)
  return answer.status === 400 && String(subCategory ?? '').endsWith('.CANNOT_DELETE_PROPERTY_IN_USE')
}

// HubSpot's category of an answer, nested or not, for a note: ' <category>', or nothing.
function categoryOf(answer) {
  const { category } = errorOf(answer.body)
  return category ? ` ${category}` : ''
}

// The owned fields that differ after Kalup's normalizer, and every raw field the read shows otherwise than it was sent.
function roundTrip(sent, read) {
  const want = normalizeProperty(sent)
  const got = normalizeProperty(read)
  const fields = [...new Set([...Object.keys(want), ...Object.keys(got)])]
  const owned = fields
    .filter((field) => !isDeepStrictEqual(want[field], got[field]))
    .map((field) => ({ field, sent: want[field] ?? null, read: got[field] ?? null }))
  const rewritten = Object.keys(sent)
    .filter((field) => !isDeepStrictEqual(sent[field], read[field]))
    .map((field) => ({ field, sent: sent[field], read: read[field] ?? null }))
  return { owned, rewritten }
}

/**
 * The missing-scope check: one group create on companies with the second key, which lacks crm.schemas.companies.write.
 * Not applicable when no second key is set. The create is in the manifest first, so cleanup archives the group if the
 * key could create it after all.
 */
export async function missingScope(ctx) {
  const { limited, prefix } = ctx
  await check(ctx, SCOPE_CHECK, async () => {
    need(!limited.absent, limited.absent)
    must(!limited.unguarded, `${limited.unguarded}, so nothing was sent with the second key`)
    const name = `${prefix}limited`
    const from = limited.client.log.length
    const answer = await limited.client.create(
      { type: 'group', objectType: 'companies', name },
      paths.groups('companies'),
      groupBody(name, 'Kalup conformance limited'),
    )
    const listed = await ctx.client.read(paths.groups('companies'))
    must(listed.status === 200, `the groups list answered ${listed.status ?? listed.error}`)
    const created = listed.body?.results?.some((g) => g.name === name && g.archived !== true) ?? false
    const named = scopesNamed(answer.body)
    const category = answer.body?.category ? ` ${answer.body.category}` : ''
    return {
      pass: answer.status === 403 && !created,
      note: `${answer.status ?? answer.error}${category}; HubSpot names ${named.join(', ') || 'no scope'}; the group was ${created ? '' : 'not '}created`,
      facts: {
        ...errorFacts(answer),
        scopesNamed: named,
        registryScope: GROUP_WRITE_SCOPE,
        sameScope: named.includes(GROUP_WRITE_SCOPE),
        created,
        secondKeyRequests: limited.client.log.slice(from).map(requestFact),
      },
    }
  })
}

// The scopes a 403 body names: HubSpot lists them in errors[].context, under a field such as requiredGranularScopes.
function scopesNamed(body) {
  const errors = Array.isArray(body?.errors) ? body.errors : []
  const named = errors.flatMap((error) =>
    Object.entries(error?.context ?? {})
      .filter(([field, value]) => SCOPE_FIELD.test(field) && Array.isArray(value))
      .flatMap(([, value]) => value),
  )
  return [...new Set(named.filter((scope) => typeof scope === 'string' && SCOPE_NAME.test(scope)))].sort()
}

/** The two checks over every response the run's own client received: rate-limit headers and 403s on reads. */
export async function logChecks(ctx) {
  const { log } = ctx.client
  await check(ctx, READ_CHECKS.rateHeaders, () => {
    const answered = log.filter((e) => e.status !== null)
    const counts = {}
    for (const name of answered.flatMap((e) => e.rateHeaders)) {
      counts[name] = (counts[name] ?? 0) + 1
    }
    const needed = ['max', 'remaining', 'interval-milliseconds', 'daily-remaining'].map(
      (h) => `x-hubspot-ratelimit-${h}`,
    )
    const missing = needed.filter((h) => !counts[h])
    return {
      pass: answered.length > 0 && missing.length === 0,
      note:
        missing.length === 0 ? 'every header Kalup reads arrived, daily included' : `missing: ${missing.join(', ')}`,
      facts: {
        responses: answered.length,
        headers: counts,
        daily: Boolean(counts['x-hubspot-ratelimit-daily-remaining']),
      },
    }
  })
  // Only a read fails this check, and only one the declared scopes should have covered. A write's 403 belongs to the
  // check that sent it, which records it as a finding, or as not applicable when the key and portal cannot make what
  // the check needs. The facts still list every 403.
  await check(ctx, READ_CHECKS.scopes, () => {
    const first = (predicate) => log.find(predicate)?.status ?? null
    const get = (path) => (e) => e.method === 'GET' && e.path === path
    const forbidden = [...new Set(log.filter((e) => e.status === 403).map((e) => `${e.method} ${e.path}`))]
    const reads = forbidden.filter((request) => request.startsWith('GET '))
    const covered = reads.filter((request) => covers(ctx.scopes, request.slice('GET '.length)))
    const uncovered = reads.filter((request) => !covered.includes(request))
    let note = 'no 403 on any read'
    if (covered.length > 0) {
      note = `403 on ${covered.join(', ')}, which the declared scopes cover`
    } else if (uncovered.length > 0) {
      note = `403 only where the declared scopes do not reach: ${uncovered.join(', ')}`
    }
    return {
      pass: covered.length === 0,
      note,
      facts: {
        declaredScopes: ctx.scopes,
        covered,
        uncovered,
        accountInfo: first(get(paths.accountInfo)),
        limitsCustomProperties: first(get(paths.limits('custom-properties'))),
        limitsCustomObjectTypes: first(get(paths.limits('custom-object-types'))),
        schemasList: first(get(paths.schemas)),
        companiesList: first(get(paths.properties('companies'))),
        companiesGroups: first(get(paths.groups('companies'))),
        forbidden,
      },
    }
  })
}
