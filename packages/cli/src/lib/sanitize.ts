// Portal strings are untrusted. This is the one function they pass through before reaching a terminal or JSON.

// biome-ignore lint/suspicious/noControlCharactersInRegex: this regex exists to strip them
const ansi = /\u001b\[[0-?]*[ -/]*[@-~]/g
// biome-ignore lint/suspicious/noControlCharactersInRegex: this regex exists to strip them
const control = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g

/** Strips ANSI sequences, control characters and newlines, and caps the length with an ellipsis. */
export function sanitize(text: string, max = 120): string {
  const clean = text.replace(ansi, '').replace(control, '')
  const chars = Array.from(clean)
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : clean
}
