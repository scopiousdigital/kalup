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
  return [...parts, singular(last)].map(capitalize).join('')
}

function singular(word: string): string {
  if (word.endsWith('ies')) {
    return `${word.slice(0, -3)}y`
  }
  if (word.endsWith('s') && !word.endsWith('ss')) {
    return word.slice(0, -1)
  }
  return word
}

function capitalize(part: string): string {
  return part.charAt(0).toUpperCase() + part.slice(1)
}
