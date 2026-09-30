# kalup

Kalup: configuration as code for HubSpot. This is the CLI, bin `kalup`.

Kalup keeps a HubSpot portal's properties, property groups and custom object schemas in TypeScript files in your repository. It reads a portal into those files, shows every change as a plan, and applies the plan you approve to any portal you name. Edits made in the HubSpot UI are held, not reverted. The tool parses the files and never executes them; your app imports the same files for its types through [`@kalup/core`](https://www.npmjs.com/package/@kalup/core).

## Install

```sh
npm install -D kalup @kalup/core   # or: pnpm add -D kalup @kalup/core, or: yarn add -D kalup @kalup/core
```

Node 22.13.1 or later. If your app imports the files at run time, put `@kalup/core` in `dependencies` instead.

## First run

Create a service key in HubSpot under Development > Keys > Service keys, with `crm.schemas.<object>.read` for each object you manage, the matching `.write` scopes to apply changes, and one `crm.objects.<object>.read` so `plan` can check the property limit. Put it in `.env` as `HUBSPOT_SERVICE_KEY`, then:

```sh
npx kalup init --portal <portal-id>   # check the key's portal, write kalup.config.ts, pull into kalup/objects/
npx kalup plan --out plan.json        # edit a file first; review every step
npx kalup apply plan.json             # type the target name to confirm
```

`init` prints the exact scopes the key needs. Nothing is written to the portal until `apply`, and `apply` asks for one approval: a person at a terminal, `--yes` for a small safe change on an unprotected target, or `--approve` from a reviewed CI job. Every delete needs the person.

## Commands

| Command | What it does |
|---|---|
| `kalup init` | Create kalup.config.ts and pull the first target. |
| `kalup pull` | Read a target and write kalup/objects/*.ts. |
| `kalup validate` | Check the config files and report every issue. |
| `kalup ir` | Print the IR document derived from the config files. |
| `kalup fmt` | Rewrite config files in canonical form. |
| `kalup status` | Show targets, portal checks and state. |
| `kalup compare` | Compare two sides: what would change in B to match A. |
| `kalup plan` | Show what apply would change on a target. |
| `kalup snapshot` | Save a read of a target as a snapshot file. |
| `kalup docs` | Write a Markdown data dictionary of the config or a snapshot. |
| `kalup apply` | Apply a saved plan to its target, or plan and apply an unprotected target in one run. |
| `kalup rm` | Take a property or group out of config and write its tombstone in kalup/removed.ts. |
| `kalup state rebuild` | Report what a target's portal holds against its state; --write replaces the state file. |
| `kalup target rebind` | Point a target at a recreated test portal or sandbox. A terminal only. |
| `kalup add` | Write a blueprint from a JSON file or https URL into the config files. Never touches a portal. |
| `kalup blueprint upgrade` | Merge a new version of an added blueprint into the config files. Never touches a portal. |

`kalup <command> --help` lists each command's flags.

## What 0.1.0 covers

- Reads and writes properties and property groups on standard and custom objects. Custom object schemas are read and compared, not written.
- Takeover mode, `exclude`, `adopt: 'overwrite'` and `yesLimit` per target, lenient enums, blueprints and per-target overrides.
- Every command takes `--json` and prints one `envelope/1` document with stable issue codes and exit codes. The JSON Schemas ship as `kalup/schemas/<file>`.

The pull, plan, apply and drift workflow passed [live runs](https://github.com/scopiousdigital/kalup/blob/main/docs/hubspot.md#live-runs) on a HubSpot developer test account; other account types are not verified yet. Pipelines, custom object schema writes and association labels are next. Before 1.0, a minor release may change the config grammar or the JSON output, and its release notes say so.

## Docs

- [kalup.dev/docs](https://kalup.dev/docs): getting started, guides for one portal, several portals with CI, and agencies with blueprints, and every command.
- Offline, in this package under `docs/`: one page per topic and one per error code, which `issues[].docs` points at. The `AGENTS.md` that `init` writes indexes them for AI agents.
- [The repository](https://github.com/scopiousdigital/kalup#readme): the overview, the roadmap and how to build from source.

## Licence

Apache-2.0. Everything that runs on your machine or in your CI against HubSpot's public APIs is free and stays free.

Kalup is an independent open-source project maintained by Scopious. It is not affiliated with, endorsed by, or sponsored by HubSpot, Inc. HubSpot is a registered trademark of HubSpot, Inc.
