# kalup

Kalup: configuration as code for HubSpot. This is the CLI, bin `kalup`.

Kalup keeps a HubSpot portal's properties, property groups and custom object schemas in TypeScript files in your repository. It reads a portal into those files, shows every change as a plan, and applies the plan you approve to any portal you name. Edits made in the HubSpot UI are held, not reverted. The tool parses the files and never executes them; your app imports the same files for its types through [`@kalup/core`](https://www.npmjs.com/package/@kalup/core).

## Install

```sh
npm install @kalup/core
npm install -D kalup
```

With pnpm, yarn or bun: `pnpm add @kalup/core && pnpm add -D kalup`, and the same with `yarn add` or `bun add`.

Node 22.13.1 or later. Your app imports `@kalup/core` at run time (7 kB, no dependencies), so it is a regular dependency. The `kalup` CLI is a dev tool. If you skip the first line, `kalup init` adds `@kalup/core` to `package.json` for you.

## First run

Create a service key in HubSpot under Development > Keys > Service keys, with `crm.schemas.<object>.read` for each object you manage, the matching `.write` scopes to apply changes, and one `crm.objects.<object>.read` so `plan` can check the property limit. Put it in `.env` as `HUBSPOT_SERVICE_KEY`, then:

```sh
npx kalup init --portal <portal-id>   # offline: write kalup.config.ts, hubspot/ and AGENTS.md
npx kalup pull                        # check the key's portal, write hubspot/objects/
npx kalup plan                        # edit a file first; review every step
npx kalup apply                       # plans again, then you type the target name to confirm
```

`init` needs no key and prints the exact scopes the key needs. `--dir lib/config/hubspot` puts the object files elsewhere. Nothing is written to the portal until `apply`, and `apply` asks for one approval: a person at a terminal, `--yes` for a small safe change on an unprotected target, or `--approve` from a reviewed CI job. Every delete needs the person. To review a plan before it runs, or to apply from CI, save it with `kalup plan --out` and apply the file.

Commit `kalup.config.ts` and `hubspot/`. Keep `.kalup/`, plan files and `.env` out of git; `init` adds the ignore lines.

## Commands

| Command | What it does |
|---|---|
| `kalup init` | Create kalup.config.ts and the project files. Offline: no key, no request. |
| `kalup pull` | Read a target and write the object files. |
| `kalup validate` | Check the config files and report every issue. |
| `kalup ir` | Print the IR document derived from the config files. |
| `kalup fmt` | Rewrite config files in canonical form. |
| `kalup status` | Show targets, portal checks and state. |
| `kalup compare` | Compare two sides: what would change in B to match A. |
| `kalup plan` | Show what apply would change on a target. |
| `kalup snapshot` | Save a read of a target as a snapshot file. |
| `kalup docs` | Write a Markdown data dictionary of the config or a snapshot. |
| `kalup apply` | Apply a saved plan, or plan a target and apply it in one run after a person at a terminal confirms it. |
| `kalup rm` | Take a property or group out of config and write its tombstone in removed.ts. |
| `kalup state rebuild` | Report what a target's portal holds against its state; --write replaces the state file. |
| `kalup target rebind` | Point a target at a recreated test portal or sandbox. A terminal only. |
| `kalup add` | Write a blueprint from a JSON file or https URL into the config files. Never touches a portal. |
| `kalup blueprint upgrade` | Merge a new version of an added blueprint into the config files. Never touches a portal. |

`kalup <command> --help` lists each command's flags.

## What 0.2 covers

- Reads and writes properties and property groups on standard and custom objects. Custom object schemas are read and compared, not written.
- Every property definition field HubSpot lets you write, such as display hints, `hidden`, `displayOrder` and calculation formulas, checked against a live developer test account.
- Takeover mode, `exclude`, `adopt: 'overwrite'` and `yesLimit` per target, lenient enums, blueprints and per-target overrides.
- State local to your machine by default, or committed with `state: 'repo'`. Monorepos and git worktrees.
- Every command takes `--json` and prints one `envelope/1` document with stable issue codes and exit codes. The JSON Schemas ship as `kalup/schemas/<file>`.

The pull, plan, apply and drift workflow passed [live runs](https://github.com/scopiousdigital/kalup/blob/main/docs/hubspot.md#live-runs) on a HubSpot developer test account; other account types are not verified yet. Pipelines, custom object schema writes and association labels are next. Before 1.0, a minor release may change the config grammar or the JSON output, and its release notes say so.

## Docs

- [kalup.dev/docs](https://kalup.dev/docs): getting started, guides for one portal, several portals with CI, and agencies with blueprints, and every command.
- Offline, in this package under `docs/`: one page per topic and one per error code, which `issues[].docs` points at. The `AGENTS.md` that `init` writes indexes them for AI agents.
- [The repository](https://github.com/scopiousdigital/kalup#readme): the overview, the roadmap and how to build from source.

## Licence

Apache-2.0. Everything that runs on your machine or in your CI against HubSpot's public APIs is free and stays free.

Kalup is an independent open-source project maintained by Scopious. It is not affiliated with, endorsed by, or sponsored by HubSpot, Inc. HubSpot is a registered trademark of HubSpot, Inc.
