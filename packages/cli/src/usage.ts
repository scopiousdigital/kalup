// The brand lives here only, so a rename never touches the rest of the CLI.
import { readFileSync } from 'node:fs'

export const bin = 'kalup'

// package.json sits one level above both src/ and dist/.
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
export const version: string = pkg.version

export const disclaimer =
  'Kalup is an independent open-source project maintained by Scopious. It is not affiliated with, endorsed by, or sponsored by HubSpot, Inc. HubSpot is a registered trademark of HubSpot, Inc.'

// Milestone 1 and 2 commands. See docs/roadmap.md. A command not in `built` prints "not implemented yet" and exits 1.
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

export const built = [
  'init',
  'validate',
  'ir',
  'fmt',
  'status',
  'pull',
] as const satisfies readonly (keyof typeof commands)[]

export const flags = {
  '--json': 'Print one envelope/1 document to stdout and nothing else',
  '--portal <id>': 'The Hub ID of the portal to set up (init)',
  '--objects <a,b,c>': 'The objects to pull, default contacts,companies,deals (init)',
  '--target <name>': 'The target to run against',
  '--only <glob>': 'Limit pull to the addresses that match, for example property:companies/*',
  '--discover': 'List in-portal resources outside the pull scope and write nothing (pull)',
  '--check': 'Report what would change and write nothing (ir, fmt, pull)',
  '--exit-code': 'Exit 2 when fmt --check or pull --check finds changes',
  '--help': 'Print this text',
  '--version': 'Print the version',
} as const

export function isBuilt(name: string): name is (typeof built)[number] {
  return (built as readonly string[]).includes(name)
}

export function usage(): string {
  const commandLines = Object.entries(commands).map(
    ([name, description]) => `  ${name.padEnd(10)}${description}${isBuilt(name) ? '' : ' (not implemented yet)'}`,
  )
  const flagLines = Object.entries(flags).map(([flag, description]) => `  ${flag.padEnd(18)}${description}`)
  return [`Usage: ${bin} <command> [options]`, '', 'Commands:', ...commandLines, '', 'Options:', ...flagLines].join(
    '\n',
  )
}

export function versionText(): string {
  return `${bin} ${version}\n${disclaimer}\n`
}
