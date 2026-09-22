// The brand lives here only, so a rename never touches the rest of the CLI.
export const bin = 'kalup'

// Milestone 1 and 2 commands. See docs/roadmap.md. All are stubs today.
export const commands = {
  init: `Create ${bin}.config.ts and pull the first target`,
  pull: `Read a target and write ${bin}/objects/*.ts`,
  validate: 'Check the config files and report every issue',
  ir: 'Print the IR document derived from the config files',
  fmt: 'Rewrite config files in canonical form',
  status: 'Show targets, portal checks and state',
  compare: 'Compare two sides: a target, a snapshot or config',
  plan: 'Show what apply would change on a target',
  snapshot: 'Save a full pull of a target as a file',
  docs: 'Generate a data dictionary from the config',
  apply: 'Push a plan to a target',
} as const

export function usage(): string {
  const lines = Object.entries(commands).map(([name, description]) => `  ${name.padEnd(10)}${description}`)
  return [`Usage: ${bin} <command>`, '', 'Commands:', ...lines].join('\n')
}
