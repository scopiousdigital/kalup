// Portal strings are untrusted. This is the one function they pass through before reaching a terminal or JSON.

// biome-ignore lint/suspicious/noControlCharactersInRegex: this regex exists to strip them
const ansi = /\u001b\[[0-?]*[ -/]*[@-~]/g
// Bidirectional embeddings, overrides and isolates (U+202A to U+202E, U+2066 to U+2069) go too: they can reorder
// what a terminal line or a docs cell shows.
// biome-ignore lint/suspicious/noControlCharactersInRegex: this regex exists to strip them
const control = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g

/** Strips ANSI sequences, control and bidirectional formatting characters and newlines, and caps the length. */
export function sanitize(text: string, max = 120): string {
  const clean = text.replace(ansi, '').replace(control, '')
  const chars = Array.from(clean)
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : clean
}
