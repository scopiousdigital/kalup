/** JSON with keys sorted at every level, two-space indent, no trailing newline. The one way an IR or state file is written. */
export function stableStringify(value: unknown): string {
  const text = JSON.stringify(sortKeys(value), null, 2) as string | undefined
  // JSON.stringify(undefined) is undefined, and validateSchema compares such a value against consts and enums.
  return (text === undefined ? text : escapeJson(text)) as string
}

// JSON allows these raw. A C1 control can drive a terminal, and the separators end a line in JavaScript.
const UNSAFE = /[\u007f-\u009f\u2028\u2029]/g

/**
 * Writes DEL, the C1 controls, U+2028 and U+2029 in JSON text as \uXXXX escapes. They can only occur inside strings,
 * so the text parses to the same value. Every JSON document Kalup writes or prints passes through here.
 */
export function escapeJson(json: string): string {
  return json.replace(UNSAFE, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys)
  }
  if (value === null || typeof value !== 'object') {
    return value
  }
  const record = value as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, sortKeys(record[key])]),
  )
}
