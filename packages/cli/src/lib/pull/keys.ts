// The app-side names pull picks: the default property key and the default export name. One function each, so the
// rule is the same everywhere it applies.

/** camelCase of an internal name: `billing_status` to `billingStatus`, `hs_lead_status` to `hsLeadStatus`. */
export function camelCase(name: string): string {
  return name
    .split('_')
    .filter(Boolean)
    .map((part, i) => (i === 0 ? part : capitalize(part)))
    .join('')
}

/** The default export name, PascalCase singular: `companies` to `Company`, `line_items` to `LineItem`. */
export function exportName(object: string): string {
  const parts = object.split('_').filter(Boolean)
  const last = parts.pop() ?? ''
  const singular = last.endsWith('ies')
    ? `${last.slice(0, -3)}y`
    : last.endsWith('s') && !last.endsWith('ss')
      ? last.slice(0, -1)
      : last
  return [...parts, singular].map(capitalize).join('')
}

function capitalize(part: string): string {
  return part.charAt(0).toUpperCase() + part.slice(1)
}
