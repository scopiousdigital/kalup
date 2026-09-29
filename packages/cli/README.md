# kalup

Kalup: configuration as code for HubSpot. This is the CLI, bin `kalup`.

Kalup keeps a HubSpot portal's properties, property groups and custom object schemas in TypeScript files. It reads a portal into those files, checks them, compares and plans changes, and applies property and group changes to any portal you name. The tool parses the files and never executes them; your app imports the same files for its types through [`@kalup/core`](https://github.com/scopiousdigital/kalup/tree/main/packages/core).

## Status

Pre-alpha: build it from a source checkout, as the [main README](https://github.com/scopiousdigital/kalup#getting-started) shows. Every command below is implemented with offline tests. The first live run on a developer test account passed pull, plan, saved-plan apply and drift reconciliation; conformance, coordination and release gates remain open. Before 1.0, anything can change between minor versions.

| Command | What it does |
|---|---|
| `kalup init` | Create `kalup.config.ts` and pull the first target |
| `kalup pull` | Read a target and write `kalup/objects/*.ts` |
| `kalup validate` | Check the config files and report every issue |
| `kalup ir` | Print the IR document derived from the config files |
| `kalup fmt` | Rewrite config files in canonical form |
| `kalup status` | Show targets, portal checks and state |
| `kalup compare` | Compare two sides: what would change in B to match A |
| `kalup plan` | Show what apply would change on a target |
| `kalup snapshot` | Save a read of a target as a snapshot file |
| `kalup docs` | Write a Markdown data dictionary of the config or a snapshot |
| `kalup apply` | Apply a saved plan to its target, or plan and apply an unprotected target in one run |
| `kalup rm` | Take a property or group out of config and write its tombstone in `kalup/removed.ts` |
| `kalup state rebuild` | Report what a target's portal holds against its state; `--write` replaces the state file |
| `kalup target rebind` | Point a target at a recreated test portal or sandbox, at a terminal only |
| `kalup add` | Write a blueprint from a JSON file or https URL into the config files |
| `kalup blueprint upgrade` | Merge a new version of an added blueprint into the config files |

Every command but `apply` never writes to a portal. `apply` writes property groups and properties, never custom object schemas, and only after an approval: a person at a terminal, `--yes` for a small safe change on an unprotected target, or `--approve` from a reviewed CI job; every delete needs the person. Every command takes `--json` and prints one `envelope/1` document. Each command accepts only its own flags; `kalup <command> --help` lists them.

The package also exports `defineConfig` and the `KalupConfig` type, so `kalup.config.ts` gets editor types, and `defineRemoved` with the `KalupRemoved` type for `kalup/removed.ts`:

```ts
import { defineConfig } from 'kalup'

export default defineConfig({
  objects: {
    companies: { include: ['name', 'domain'] },
  },
  targets: {
    sandbox: {
      portalId: 1111111,
      credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },
    },
  },
})
```

## Docs

- [Config files](docs/config.md): the files, the grammar and the builders.
- [Pull](docs/pull.md): the scope, the merge rules, the flags and the output.
- [Targets](docs/targets.md): portal pins, keys and overrides.
- [Compare](docs/compare.md): the sides, the direction, unmanaged and incomplete results.
- [Plan](docs/plan.md): the steps, held and blocked units, limits and the approval digest.
- [Apply](docs/apply.md): the approval contract, what apply checks, outcomes, exit codes and recovery.
- [Remove](docs/rm.md): `kalup rm`, destroy and release tombstones.
- [State](docs/state.md): state files, `kalup state rebuild` and `kalup target rebind`.
- [Snapshot](docs/snapshot.md): a saved read of a target and its coverage.
- [Data dictionary](docs/dictionary.md): `kalup docs`.
- [Blueprints](docs/blueprints.md): the format, `kalup add`, `kalup blueprint upgrade`, the prefix and the lock.
- [Guides](https://github.com/scopiousdigital/kalup/tree/main/apps/web/content/docs/guides): one admin with one portal, a developer with a sandbox, production and CI, and an agency with blueprints.
- [The main README](https://github.com/scopiousdigital/kalup#readme): the overview, the roadmap and how to build from source.

## Licence

Apache-2.0.

Kalup is an independent open-source project maintained by Scopious. It is not affiliated with, endorsed by, or sponsored by HubSpot, Inc. HubSpot is a registered trademark of HubSpot, Inc.
