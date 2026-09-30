// The pull scope: which config keys are standard objects, which portal properties the scope asks for, and --only.
import type { ObjectScope } from '@kalup/core'

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
  /** Whether `exclude` names this internal name, a pattern's `*` matching any run of characters. */
  exclude: (name: string) => boolean
  include: ReadonlySet<string>
}

export function scopeOf(scope: ObjectScope = {}): Scope {
  return { custom: scope.custom ?? true, exclude: excluder(scope.exclude), include: new Set(scope.include ?? []) }
}

/**
 * A portal property is in scope when `include` names it, or when it is custom, `custom` is on and `exclude` does not
 * name it. `include` wins over a pattern of `exclude`; validate refuses a name both lists hold.
 */
export function inScope(scope: Scope, property: { name: string; hubspotDefined: boolean }): boolean {
  return scope.include.has(property.name) || (scope.custom && !property.hubspotDefined && !scope.exclude(property.name))
}

/** The `exclude` patterns of one object as a predicate over internal names. */
export function excluder(patterns: readonly string[] = []): (name: string) => boolean {
  const matchers = patterns.map(addressMatcher)
  return (name) => matchers.some((matches) => matches(name))
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
