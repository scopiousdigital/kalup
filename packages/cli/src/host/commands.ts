// The oclif adapters: one class per command, holding its flags, summary and examples, which oclif parses and turns
// into help. Each adapter hands plain values to its framework-free handler in src/commands. `COMMANDS` is the export
// oclif's explicit discovery strategy reads from dist/commands.mjs (package.json, `oclif.commands`).

import { bin } from '@kalup/engine'
import { Args, Command, Flags } from '@oclif/core'
import { add } from '../commands/add.js'
import { apply } from '../commands/apply.js'
import { blueprintUpgrade } from '../commands/blueprint-upgrade.js'
import { compare } from '../commands/compare.js'
import type { Handler, Flags as HandlerFlags, Prompter, Result } from '../commands/context.js'
import { usageError } from '../commands/context.js'
import { docs } from '../commands/docs.js'
import { fmt } from '../commands/fmt.js'
import { init } from '../commands/init.js'
import { ir } from '../commands/ir.js'
import { plan } from '../commands/plan.js'
import { pull } from '../commands/pull.js'
import { rm } from '../commands/rm.js'
import { snapshot } from '../commands/snapshot.js'
import { stateRebuild } from '../commands/state.js'
import { status } from '../commands/status.js'
import { targetRebind } from '../commands/target-rebind.js'
import { validate } from '../commands/validate.js'

// pull, plan and snapshot run against one target, which the shared rule picks when the flag is absent.
const selected = Flags.string({
  summary: 'The target to run against. Defaults to defaultTarget, or to the only target.',
  helpValue: '<name>',
})
const check = Flags.boolean({ summary: 'Report what would change and write nothing.' })

function out(what: string) {
  return Flags.string({
    summary: `Write ${what} to this file, relative to the current directory.`,
    helpValue: '<file>',
  })
}

/**
 * The base of every Kalup command. The host sets `cwd`, `prompt` when a person is at a terminal, `progress` without
 * --json, and `signal` for an interruptible command, before it calls `run`; nothing reads process.cwd(), stdin or the
 * process's signals.
 */
export abstract class KalupCommand extends Command {
  static override baseFlags = {
    json: Flags.boolean({ summary: 'Print one envelope/1 document to stdout and nothing else.' }),
  }
  /** Stops cleanly on SIGINT or SIGTERM through `signal`. Any other command keeps the default: the signal ends it. */
  static interruptible = false
  /** Accepts `--out` with no value, as `outDefault`. oclif has no flag whose value is optional. */
  static bareOut = false

  cwd = ''
  progress: ((line: string) => void) | undefined
  prompt: Prompter | undefined
  signal: AbortSignal | undefined

  abstract override run(): Promise<Result>

  /** Parses this command's argv with oclif and runs the handler with plain arguments and flags. */
  protected async handle(handler: Handler): Promise<Result> {
    const bare = bareOut(this.argv, (this.ctor as typeof KalupCommand).bareOut)
    const { argv, flags } = await this.parse(this.ctor, bare.argv)
    // oclif accepts an empty value, an unset shell variable, and takes a flag it does not know as the value of the
    // one before it. Neither is a value: `--target --check` means --target is missing its name.
    for (const [name, value] of Object.entries(flags)) {
      const values: unknown[] = Array.isArray(value) ? value : [value]
      if (values.some((v) => typeof v === 'string' && (v === '' || v.startsWith('-')))) {
        throw usageError(`Flag --${name} expects a value`)
      }
    }
    const values = flags as Record<string, unknown>
    if (bare.found && values.out !== undefined) {
      throw usageError('--out is given twice')
    }
    const plain: HandlerFlags = {
      accept: values.accept as string[] | undefined,
      approve: values.approve as string | undefined,
      check: values.check === true,
      dir: values.dir as string | undefined,
      discover: values.discover === true,
      dryRun: values['dry-run'] === true,
      exitCode: values['exit-code'] === true,
      objects: values.objects as string | undefined,
      only: values.only as string | undefined,
      out: values.out as string | undefined,
      outDefault: bare.found,
      portal: values.portal as string | undefined,
      prefix: values.prefix as string | undefined,
      release: values.release === true,
      take: values.take as string[] | undefined,
      target: values.target as string | undefined,
      write: values.write === true,
      yes: values.yes === true,
    }
    return handler({
      cwd: this.cwd,
      args: argv as string[],
      flags: plain,
      progress: this.progress,
      prompt: this.prompt,
      signal: this.signal,
    })
  }
}

export class InitCommand extends KalupCommand {
  static override summary = `Create ${bin}.config.ts and the project files. Offline: no key, no request.`
  static override flags = {
    portal: Flags.string({
      summary: 'The Hub ID of the portal to pin. Without it the target is pending until you set portalId.',
      helpValue: '<id>',
    }),
    objects: Flags.string({
      summary: 'The objects to pull, comma-separated. Default contacts,companies,deals.',
      helpValue: '<a,b,c>',
    }),
    target: Flags.string({
      summary: 'The name of the target to write. Default production.',
      helpValue: '<name>',
    }),
    dir: Flags.string({
      summary: 'The folder for the object files, relative to the project directory. Default hubspot.',
      helpValue: '<path>',
    }),
  }
  static override examples = [
    '<%= config.bin %> init --portal 1111111 --objects companies',
    '<%= config.bin %> init --target sandbox --dir lib/config/hubspot',
  ]

  run(): Promise<Result> {
    return this.handle(init)
  }
}

export class PullCommand extends KalupCommand {
  static override summary = 'Read a target and write the object files.'
  static override flags = {
    target: selected,
    only: Flags.string({
      summary: 'Limit pull to the addresses that match, for example property:companies/*.',
      helpValue: '<glob>',
    }),
    discover: Flags.boolean({ summary: 'List in-portal resources outside the pull scope and write nothing.' }),
    accept: Flags.string({
      summary: 'Take the portal side of a kept config change, a conflict or an option removed in HubSpot. Repeatable.',
      helpValue: '<address[#unit]>',
      multiple: true,
    }),
    check,
    'exit-code': Flags.boolean({ summary: 'Exit 2 when --check finds changes.' }),
  }
  static override examples = [
    '<%= config.bin %> pull',
    '<%= config.bin %> pull --target sandbox --check',
    "<%= config.bin %> pull --target sandbox --accept 'property:companies/billing_status#label'",
  ]

  run(): Promise<Result> {
    return this.handle(pull)
  }
}

export class ValidateCommand extends KalupCommand {
  static override summary = 'Check the config files and report every issue.'
  static override flags = {
    target: Flags.string({ summary: 'Also check that this target is declared.', helpValue: '<name>' }),
  }

  run(): Promise<Result> {
    return this.handle(validate)
  }
}

export class IrCommand extends KalupCommand {
  static override summary = 'Print the IR document derived from the config files.'
  static override flags = { check: Flags.boolean({ summary: 'Validate the IR and print nothing but issues.' }) }

  run(): Promise<Result> {
    return this.handle(ir)
  }
}

export class FmtCommand extends KalupCommand {
  static override summary = 'Rewrite config files in canonical form.'
  static override flags = {
    check: Flags.boolean({ summary: 'Report what would change, write nothing, and exit 2 when a file would change.' }),
    // 0.1 needed it for exit 2; kept so a script that passes it still runs.
    'exit-code': Flags.boolean({
      summary: 'Accepted for older scripts: --check exits 2 on changes already.',
      hidden: true,
    }),
  }

  run(): Promise<Result> {
    return this.handle(fmt)
  }
}

export class StatusCommand extends KalupCommand {
  static override summary = 'Show targets, portal checks and state.'
  static override flags = {
    target: Flags.string({ summary: 'Check this target only. Default: every target.', helpValue: '<name>' }),
  }

  run(): Promise<Result> {
    return this.handle(status)
  }
}

export class CompareCommand extends KalupCommand {
  static override summary = 'Compare two sides: what would change in B to match A.'
  static override args = {
    a: Args.string({ description: 'The desired side: config, a target or a snapshot file.', required: true }),
    b: Args.string({ description: 'The side compared with it: config, a target or a snapshot file.', required: true }),
  }
  static override flags = { 'exit-code': Flags.boolean({ summary: 'Exit 2 when anything differs.' }) }
  static override examples = [
    '<%= config.bin %> compare config sandbox',
    '<%= config.bin %> compare .kalup/snapshots/sandbox/20260923T101530123Z.json sandbox',
  ]

  run(): Promise<Result> {
    return this.handle(compare)
  }
}

// Greedy: `--take config a b` takes both, as `--take config a --take config b` does.
const take = Flags.string({
  summary:
    'Write config over held units, or recreate a missing resource: --take config <address[#unit]>; * in the address matches any run, as in --only.',
  helpValue: 'config <address[#unit]>',
  multiple: true,
})

export class PlanCommand extends KalupCommand {
  static override summary = 'Show what apply would change on a target.'
  static override bareOut = true
  static override flags = {
    target: selected,
    out: Flags.string({
      summary:
        'Write the plan/1 document to this file, relative to the current directory. With no file: .kalup/plans/<target>-<planId>.json.',
      helpValue: '[<file>]',
    }),
    take,
    'exit-code': Flags.boolean({ summary: 'Exit 2 when anything is pending: steps to apply, blocked or held.' }),
  }
  static override examples = [
    '<%= config.bin %> plan',
    '<%= config.bin %> plan --target production --out plan.json',
    '<%= config.bin %> plan --target production --out',
    "<%= config.bin %> plan --target production --take config 'property:companies/billing_status#label'",
    "<%= config.bin %> plan --target sandbox --take config 'property:companies/*'",
  ]

  run(): Promise<Result> {
    return this.handle(plan)
  }
}

export class SnapshotCommand extends KalupCommand {
  static override summary = 'Save a read of a target as a snapshot file.'
  static override flags = { target: selected, out: out('the snapshot') }
  static override examples = ['<%= config.bin %> snapshot', '<%= config.bin %> snapshot --target production']

  run(): Promise<Result> {
    return this.handle(snapshot)
  }
}

export class DocsCommand extends KalupCommand {
  static override summary = 'Write a Markdown data dictionary of the config or a snapshot.'
  static override args = {
    source: Args.string({ description: 'config, the default, or a snapshot file.' }),
  }
  static override flags = { out: out('the Markdown') }
  static override examples = [
    '<%= config.bin %> docs --out DATA-DICTIONARY.md',
    '<%= config.bin %> docs .kalup/snapshots/production/20260923T101530123Z.json',
  ]

  run(): Promise<Result> {
    return this.handle(docs)
  }
}

export class ApplyCommand extends KalupCommand {
  static override summary =
    'Apply a saved plan, or plan a target and apply it in one run after a person at a terminal confirms it.'
  static override args = {
    plan: Args.string({ description: `A plan file saved by ${bin} plan --out. It names its target.` }),
  }
  static override flags = {
    target: selected,
    take,
    yes: Flags.boolean({
      summary:
        'Approve without a prompt: an unprotected target, no risky or destructive step, at most 25 writes, adoptions and releases.',
    }),
    approve: Flags.string({
      summary: "A reviewed CI job's approval: the saved plan's writesHash. Never covers a delete.",
      helpValue: '<writesHash>',
    }),
  }
  static override examples = ['<%= config.bin %> apply plan.json', '<%= config.bin %> apply --target sandbox']
  static override interruptible = true

  run(): Promise<Result> {
    return this.handle(apply)
  }
}

export class RmCommand extends KalupCommand {
  static override summary = 'Take a resource out of config and write its tombstone in removed.ts.'
  static override args = {
    address: Args.string({ description: 'The address, for example property:companies/legacy_score.', required: true }),
  }
  static override flags = {
    release: Flags.boolean({ summary: 'Stop managing it and leave it in the portal, instead of deleting it there.' }),
  }
  static override examples = [
    '<%= config.bin %> rm property:companies/legacy_score',
    '<%= config.bin %> rm group:companies/legacy --release',
  ]

  run(): Promise<Result> {
    return this.handle(rm)
  }
}

export class StateRebuildCommand extends KalupCommand {
  static override summary = "Report what a target's portal holds against its state; --write replaces the state file."
  static override flags = {
    target: selected,
    write: Flags.boolean({
      summary: 'Archive the state file and adopt every config resource the portal holds. A terminal only.',
    }),
  }
  static override examples = [
    '<%= config.bin %> state rebuild',
    '<%= config.bin %> state rebuild --target sandbox --write',
  ]

  run(): Promise<Result> {
    return this.handle(stateRebuild)
  }
}

export class TargetRebindCommand extends KalupCommand {
  static override summary = 'Point a target at a recreated test portal or sandbox. A terminal only.'
  static override args = {
    target: Args.string({ description: 'The target to rebind.', required: true }),
  }
  static override flags = {
    portal: Flags.string({ summary: 'The Hub ID of the new portal.', helpValue: '<id>' }),
  }
  static override examples = ['<%= config.bin %> target rebind sandbox --portal 3333333']

  run(): Promise<Result> {
    return this.handle(targetRebind)
  }
}

const dryRun = Flags.boolean({ summary: 'Show what would change and write nothing.' })

export class AddCommand extends KalupCommand {
  static override summary =
    'Write a blueprint from a JSON file or https URL into the config files. Never touches a portal.'
  static override args = {
    source: Args.string({ description: 'A path to the blueprint JSON file, or an https:// URL.', required: true }),
  }
  static override flags = {
    prefix: Flags.string({
      summary: "Put this before every group and property name the blueprint adds. Overrides config's prefix.",
      helpValue: '<prefix>',
    }),
    'dry-run': dryRun,
  }
  static override examples = [
    '<%= config.bin %> add ./blueprints/renewals-1.1.0.json',
    '<%= config.bin %> add https://example.com/renewals-1.1.0.json --prefix acme_ --dry-run',
  ]

  run(): Promise<Result> {
    return this.handle(add)
  }
}

export class BlueprintUpgradeCommand extends KalupCommand {
  static override summary = 'Merge a new version of an added blueprint into the config files. Never touches a portal.'
  static override args = {
    name: Args.string({ description: 'The blueprint name the lock holds, for example acme/renewals.', required: true }),
    source: Args.string({ description: 'A path to the new version, or an https:// URL.', required: true }),
  }
  static override flags = {
    // Greedy, as plan's --take: `--take remote a b` takes both.
    take: Flags.string({
      summary: "Take the blueprint's value of a conflict: --take remote <address[#unit]>.",
      helpValue: 'remote <address[#unit]>',
      multiple: true,
    }),
    'dry-run': dryRun,
    'exit-code': Flags.boolean({ summary: 'Exit 2 when the lock holds conflicts after the upgrade.' }),
  }
  static override examples = [
    '<%= config.bin %> blueprint upgrade acme/renewals ./blueprints/renewals-1.2.0.json --dry-run',
    "<%= config.bin %> blueprint upgrade acme/renewals ./blueprints/renewals-1.2.0.json --take remote 'property:deals/renewal_date#label'",
  ]

  run(): Promise<Result> {
    return this.handle(blueprintUpgrade)
  }
}

export const COMMANDS: Record<string, typeof KalupCommand> = {
  init: InitCommand,
  pull: PullCommand,
  validate: ValidateCommand,
  ir: IrCommand,
  fmt: FmtCommand,
  status: StatusCommand,
  compare: CompareCommand,
  plan: PlanCommand,
  snapshot: SnapshotCommand,
  docs: DocsCommand,
  apply: ApplyCommand,
  rm: RmCommand,
  add: AddCommand,
  'blueprint:upgrade': BlueprintUpgradeCommand,
  'state:rebuild': StateRebuildCommand,
  'target:rebind': TargetRebindCommand,
}

// `--out` as the last argument or before another flag has no value: for a command that `accepts` it, it is taken out
// of argv and reported as found.
function bareOut(argv: string[], accepts: boolean): { argv: string[]; found: boolean } {
  if (!accepts) {
    return { argv, found: false }
  }
  const bare = (arg: string, at: number) =>
    arg === '--out' && (argv[at + 1] === undefined || argv[at + 1]?.startsWith('-'))
  return { argv: argv.filter((arg, at) => !bare(arg, at)), found: argv.some(bare) }
}
