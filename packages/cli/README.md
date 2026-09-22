# kalup

Kalup: configuration as code for HubSpot. This is the CLI, bin `kalup`.

Kalup keeps a HubSpot portal's properties, property groups and custom object schemas in TypeScript files. It reads a portal into those files, checks them, and later plans and applies changes to any portal you name. The tool parses the files and never executes them; your app imports the same files for its types through [`@kalup/core`](https://github.com/scopiousdigital/kalup/tree/main/packages/core).

## Status

Pre-alpha. Before 1.0, anything can change between minor versions.

| Command | What it does | Status |
|---|---|---|
| `kalup init` | Create `kalup.config.ts` and pull the first target | Built |
| `kalup pull` | Read a target and write `kalup/objects/*.ts` | Built |
| `kalup validate` | Check the config files and report every issue | Built |
| `kalup ir` | Print the IR document derived from the config files | Built |
| `kalup fmt` | Rewrite config files in canonical form | Built |
| `kalup status` | Show targets, portal checks and state | Built |
| `kalup compare`, `plan`, `snapshot`, `docs` | Read-only comparison, plans and a data dictionary | Planned, milestone 2 |
| `kalup apply` | Push a plan to a target | Planned, milestone 4 |

The built commands are read-only: they never write to a portal. A planned command prints `not implemented yet` and exits 1. Every command takes `--json` and prints one `envelope/1` document.

The package also exports `defineConfig` and the `KalupConfig` type, so `kalup.config.ts` gets editor types:

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
- [The main README](https://github.com/scopiousdigital/kalup#readme): the overview, the roadmap and how to build from source.

## Licence

Apache-2.0.

Kalup is an independent open-source project maintained by Scopious. It is not affiliated with, endorsed by, or sponsored by HubSpot, Inc. HubSpot is a registered trademark of HubSpot, Inc.
