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

export interface Scope {
  custom: boolean
  include: ReadonlySet<string>
}

export function scopeOf(scope: ObjectScope = {}): Scope {
  return { custom: scope.custom ?? true, include: new Set(scope.include ?? []) }
}

/** A portal property is in scope when `include` names it, or when it is custom and `custom` is on. */
export function inScope(scope: Scope, property: { name: string; hubspotDefined: boolean }): boolean {
  return scope.include.has(property.name) || (scope.custom && !property.hubspotDefined)
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
