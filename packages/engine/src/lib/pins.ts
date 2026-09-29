// The API pins: a warning when a registry row's date-versioned pin is close to its expiry. status checks every row;
// plan checks the rows its steps use.
import { bin } from '../brand.js'
import type { Issue } from './errors.js'
import type { RegistryRow } from './registry.js'

const pinWarningDays = 90

/** One warning per API family whose pin expires within 90 days. `expires` is a month; its first day counts. */
export function pinWarnings(rows: readonly RegistryRow[], now = Date.now()): Issue[] {
  const out: Issue[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const pin = `${row.family} ${row.version}`
    const expires = new Date(`${row.expires}-01T00:00:00Z`)
    if (seen.has(pin) || expires.getTime() - now > pinWarningDays * 86_400_000) {
      continue
    }
    seen.add(pin)
    out.push({
      code: 'W_PIN_EXPIRES',
      message: `the ${row.family} API pin ${row.version} expires ${row.expires}`,
      fix: `upgrade ${bin} to a release that pins a newer version`,
    })
  }
  return out
}
