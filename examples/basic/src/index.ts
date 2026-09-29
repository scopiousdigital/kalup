// The app side. The files under kalup/ describe the portal to the CLI and type the property bags here, with no
// generate step: the codecs read and write the `properties` object of a CRM record.
import { propertyNames } from '@kalup/core'
import { Company, type CompanyData, Subscription } from '../kalup/index.js'

/** A record's property bag as the CRM API returns it: every value a string, or null when unset. */
type Bag = Record<string, string | null>

/** The internal names to request when reading a company, for the `properties` query parameter. */
export const companyProperties: string[] = propertyNames(Company)

/** `get` decodes one property: the enum reads as its alias, the number as a number, unset as null. */
export function billingSummary(properties: Bag): { status: CompanyData['billingStatus']; seats: number | null } {
  return {
    status: Company.properties.billingStatus.get(properties),
    seats: Company.properties.seatCount.get(properties),
  }
}

/** `set` encodes the typed value into the bag a CRM write takes: the alias `past_due` becomes `PAST DUE`. */
export function markPastDue(properties: Record<string, string>): void {
  Company.properties.billingStatus.set(properties, 'past_due')
}

/** A required property reads without null: `plan_name` is `.required()` in kalup/objects/subscription.ts. */
export function planLabel(properties: Bag): string {
  const status = Subscription.properties.status.get(properties)
  return `${Subscription.properties.planName.get(properties)} (${status ?? 'no status'})`
}
