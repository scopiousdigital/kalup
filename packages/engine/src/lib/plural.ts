// Counts in human output: one helper so every command says `1 write` and `2 writes` the same way.

/** A count and its noun: `1 write`, `2 writes`. The plural is the noun plus `s` unless `many` gives another. */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}
