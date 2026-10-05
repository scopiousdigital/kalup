// The pull scope: which config keys are standard objects, which portal properties the scope asks for, and --only.
// The properties the object files define are always in scope; `objects` in kalup.config.ts adds the rest.
import type { ObjectScope } from '@kalup/core'
import type { IR } from '../../ir/types.js'

/**
 * The objects whose properties the properties API lists by name. A config key outside this set names a custom object
 * schema. The set is the 2026-09 `crm.schemas.<object>.read` scope list plus the objects that carry their own scopes
 * (products, leads, goals, marketing events, feedback submissions, users).
 */
export const STANDARD_OBJECTS: ReadonlySet<string> = new Set([
  'appointments',
  'calls',
  'carts',
  'commerce_payments',
  'communications',
  'companies',
  'contacts',
  'courses',
  'deals',
  'emails',
  'feedback_submissions',
  'goals',
  'invoices',
  'leads',
  'line_items',
  'listings',
  'marketing_events',
  'meetings',
  'notes',
  'orders',
  'postal_mail',
  'products',
  'projects',
  'quotes',
  'services',
  'subscriptions',
  'tasks',
  'tickets',
  'users',
])

/**
 * The object type ID of each standard object, by config key. Limits Tracking keys its per-object entries by these.
 * Source: "Object type ID values", retrieved 2026-09-24:
 * https://developers.hubspot.com/docs/api-reference/latest/crm/understanding-the-crm
 * A plain record: look a key up with `Object.hasOwn`, so `constructor` finds nothing.
 */
export const STANDARD_OBJECT_TYPE_IDS: Readonly<Record<string, string>> = {
  appointments: '0-421',
  calls: '0-48',
  carts: '0-142',
  commerce_payments: '0-101',
  communications: '0-18',
  companies: '0-2',
  contacts: '0-1',
  courses: '0-410',
  deals: '0-3',
  emails: '0-49',
  feedback_submissions: '0-19',
  goals: '0-74',
  invoices: '0-53',
  leads: '0-136',
  line_items: '0-8',
  listings: '0-420',
  marketing_events: '0-54',
  meetings: '0-47',
  notes: '0-46',
  orders: '0-123',
  postal_mail: '0-116',
  products: '0-7',
  projects: '0-970',
  quotes: '0-14',
  services: '0-162',
  subscriptions: '0-69',
  tasks: '0-27',
  tickets: '0-5',
  users: '0-115',
}

export interface Scope {
  custom: boolean
  /** The properties of the object the object files define, local names: always in scope. */
  defined: ReadonlySet<string>
  /** Whether `exclude` names this internal name, a pattern's `*` matching any run of characters. */
  exclude: (name: string) => boolean
  include: ReadonlySet<string>
}

/** One object's pull scope from its settings under `objects` and the property names its object file defines. */
export function scopeOf(scope: ObjectScope = {}, defined: Iterable<string> = []): Scope {
  return {
    custom: scope.custom ?? true,
    defined: new Set(defined),
    exclude: excluder(scope.exclude),
    include: new Set(scope.include ?? []),
  }
}

/** The names of the properties the object files define on `object`, references included. */
export function definedOn(ir: Pick<IR, 'resources'>, object: string): string[] {
  const prefix = `property:${object}/`
  return Object.keys(ir.resources)
    .filter((address) => address.startsWith(prefix))
    .map((address) => address.slice(prefix.length))
}

/**
 * A portal property is in scope when the object files define it or `include` names it, whatever `custom` and
 * `exclude` say, or when it is custom, `custom` is on and `exclude` does not name it. validate refuses a name both
 * `include` and `exclude` hold.
 */
export function inScope(scope: Scope, property: { name: string; hubspotDefined: boolean }): boolean {
  const { name } = property
  return (
    scope.defined.has(name) ||
    scope.include.has(name) ||
    (scope.custom && !property.hubspotDefined && !scope.exclude(name))
  )
}

/** The `exclude` patterns of one object as a predicate over internal names. */
export function excluder(patterns: readonly string[] = []): (name: string) => boolean {
  const matchers = patterns.map(addressMatcher)
  return (name) => matchers.some((matches) => matches(name))
}

/**
 * Whether an object's pipelines are in scope: `pipelines: true` under `objects`, or a pipeline or stage of it in the
 * files or in removed.ts. Unlike `custom`, which filters what pull writes while the properties are read anyway, a
 * pipelines list nobody asked for is never read: an upgrade must not widen what a project manages without a line in
 * config saying so.
 */
export function pipelinesInScope(
  scope: ObjectScope | undefined,
  ir: Pick<IR, 'resources' | 'tombstones'>,
  object: string,
): boolean {
  const ours = (address: string) => address.startsWith(`pipeline:${object}/`) || address.startsWith(`stage:${object}/`)
  return scope?.pipelines === true || Object.keys(ir.resources).some(ours) || Object.keys(ir.tombstones).some(ours)
}

/** The --only glob as a predicate over addresses. `*` matches any run of characters, `/` included. */
export function addressMatcher(glob: string | undefined): (address: string) => boolean {
  if (glob === undefined) {
    return () => true
  }
  const literals = glob.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(`^${literals.join('.*')}$`)
  return (address) => pattern.test(address)
}
