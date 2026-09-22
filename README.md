# Kalup: configuration as code for HubSpot

Keep a HubSpot portal's configuration in TypeScript files, review every change as a diff, apply it to any portal, and give your app its types from the same files.

**Status: pre-alpha.** Nothing is published and the CLI commands are stubs.

## Why

HubSpot's own tools change a portal in place. Kalup is the layer above them: a desired-state file, a diff, a plan, named targets and drift detection.

- **Changes are reviewed as diffs.** Properties, groups and custom objects live in git. A change is a pull request with a plan attached, whether a person or an AI agent made it. Rollback is a revert and a new plan.
- **One config, any portal.** A project names its targets (`sandbox`, `production`, a client's portal) and the same files apply to each one.
- **Drift is held, not reverted.** People keep editing in the HubSpot UI. Kalup reports the difference and never overwrites it unless you tell it to. Absence never deletes.
- **The same file types the app.** No generate step. A typed CRM client, `@kalup/client`, is planned on top.

## What it looks like

`kalup/objects/companies.ts`:

```ts
import { defineObject, p, type InferProperties } from '@kalup/core'

export const Company = defineObject('companies', {
  groups: {
    billing: { label: 'Billing' },
  },
  properties: {
    billingId: p.string('billing_id', {
      label: 'Billing ID',
      group: 'billing',
      fieldType: 'text',
      hasUniqueValue: true,
    }).required(),

    billingStatus: p.enum('billing_status', {
      label: 'Billing status',
      group: 'billing',
      fieldType: 'select',
      options: [
        { value: 'active', label: 'Active' },
        { value: 'PAST DUE', label: 'Past due', as: 'past_due' },
      ],
    }),

    // HubSpot-defined. No definition, so Kalup never writes them.
    domain: p.string('domain'),
    name: p.string('name'),
  },
})

export type CompanyData = InferProperties<typeof Company.properties> & { id: string }
```

The tool parses this file and writes it back in one canonical form. It never executes it. Your app imports it, and `CompanyData` is typed from it with no build step.

## Commands

```sh
npx kalup init --portal <portal-id>                 # writes kalup.config.ts, kalup/ and AGENTS.md
npx kalup pull --target sandbox                     # read a target, write kalup/objects/*.ts
npx kalup compare sandbox production                # what differs between two targets, or a target and config
npx kalup plan --target production --out plan.json  # every change, classified, with held drift listed
npx kalup apply plan.json                           # write, after a person confirms at a terminal
```

None of these run today. The binary prints usage, and every command it knows exits 1 with `not implemented yet`. Milestone 1 delivers `init`, `pull`, `validate`, `ir`, `fmt` and `status`, all read-only. `compare`, `plan`, `snapshot` and `docs` follow in milestone 2, still read-only. `apply` is milestone 4. See `docs/roadmap.md`.

## Repo layout

| Path | What it holds |
|---|---|
| `packages/core` | `@kalup/core`: property codecs, `InferProperties`, the config reader and writer, the IR |
| `packages/cli` | `kalup`: the CLI |
| `packages/tsconfig` | shared TypeScript config |
| `apps/docs` | docs site (Fumadocs on Next.js) |
| `examples/` | example projects, type-checked in CI |
| `docs/` | vision, architecture, roadmap and ADRs for contributors |

`@kalup/client` is planned and has no package yet.

## Development

Requires Node 22+ and pnpm.

```sh
pnpm install
pnpm build
pnpm check    # lint + typecheck
pnpm test
pnpm --filter @kalup/docs dev
```

Add a changeset with `pnpm changeset` for any change that should ship in a release. If you are an AI agent working in this repo, read `CLAUDE.md` first.

## License

Apache-2.0. See `LICENSE` and `NOTICE`. Blueprint content, when it exists, will carry its own permissive licence (MIT or 0BSD) so copied files carry no notice obligations into your repo.

Built by [Scopious](https://scopious.dev). A hosted service for teams is planned.

Kalup is an independent open-source project maintained by Scopious. It is not affiliated with, endorsed by, or sponsored by HubSpot, Inc. HubSpot is a registered trademark of HubSpot, Inc.
