<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/banner-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset=".github/assets/banner-light.svg">
    <img alt="Kalup: configuration as code for HubSpot" src=".github/assets/banner-light.svg" width="100%">
  </picture>
</p>

<p align="center">
  <b>Keep a HubSpot portal's configuration in TypeScript files, review every change as a diff, apply it to any portal, and give your app its types from the same files.</b>
</p>

<p align="center">
  <a href="https://github.com/scopiousdigital/kalup/actions/workflows/ci.yml"><img alt="CI status" src="https://img.shields.io/github/actions/workflow/status/scopiousdigital/kalup/ci.yml?branch=main&style=flat-square&label=ci&labelColor=141413&logo=githubactions&logoColor=F0F0EB"></a>
  <a href="LICENSE"><img alt="Licence: Apache-2.0" src="https://img.shields.io/badge/licence-Apache--2.0-3A3A37?style=flat-square&labelColor=141413"></a>
  <a href="docs/roadmap.md"><img alt="Status: pre-alpha" src="https://img.shields.io/badge/status-pre--alpha-FF8000?style=flat-square&labelColor=141413"></a>
  <a href=".nvmrc"><img alt="Node 22 or later" src="https://img.shields.io/badge/node-%3E%3D22-3A3A37?style=flat-square&labelColor=141413&logo=nodedotjs&logoColor=F0F0EB"></a>
</p>

<p align="center">
  <a href="packages/cli/docs/"><b>Docs</b></a>
  &nbsp;·&nbsp;
  <a href="#getting-started"><b>Getting started</b></a>
  &nbsp;·&nbsp;
  <a href="docs/architecture.md"><b>Architecture</b></a>
  &nbsp;·&nbsp;
  <a href="docs/roadmap.md"><b>Roadmap</b></a>
  &nbsp;·&nbsp;
  <a href="CONTRIBUTING.md"><b>Contributing</b></a>
</p>

> [!NOTE]
> **Status: pre-alpha.** Not published to npm. Milestone 1 (`init`, `pull`, `validate`, `ir`, `fmt`, `status`, all read-only) is built. `compare`, `plan`, `snapshot`, `docs` and `apply` are not built; each exits 1 with `not implemented yet`.

## Why Kalup

HubSpot's own tools change a portal in place. Kalup is the layer above them: a desired-state file, a diff, a plan, named targets and drift detection.

<table>
  <tr>
    <td width="50%" valign="top">
      <b>Changes are reviewed as diffs.</b><br>
      Properties, groups and custom objects live in git. A change is a pull request with a plan attached, whether a person or an AI agent made it. Rollback is a revert and a new plan.
    </td>
    <td width="50%" valign="top">
      <b>One config, any portal.</b><br>
      A project names its targets (<code>sandbox</code>, <code>production</code>, a client's portal) and the same files apply to each one.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <b>Drift is held, not reverted.</b><br>
      People keep editing in the HubSpot UI. Kalup reports the difference and never overwrites it unless you tell it to. Absence never deletes.
    </td>
    <td width="50%" valign="top">
      <b>The same file types the app.</b><br>
      No generate step. A typed CRM client, <code>@kalup/client</code>, is planned on top.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <b>Parsed, never executed.</b><br>
      The tool reads a small grammar and prints it back in one canonical form, so an agent can edit it safely and <code>pull</code> can write it back without losing your comments.
    </td>
    <td width="50%" valign="top">
      <b>Built for agents.</b><br>
      Every command takes <code>--json</code> and prints one <code>envelope/1</code> document, with fixed exit codes and issues that name the file, the line and the fix.
    </td>
  </tr>
</table>

## What it looks like

`kalup/objects/companies.ts`:

```ts
import { defineObject, type InferProperties, p } from '@kalup/core'

export const Company = defineObject('companies', {
  groups: {
    billing: { label: 'Billing' },
  },
  properties: {
    // Set by the billing sync. Do not edit by hand.
    billingStatus: p.enum('billing_status', {
      label: 'Billing status',
      group: 'billing',
      fieldType: 'select',
      options: [
        { value: 'active', label: 'Active' },
        { value: 'PAST DUE', label: 'Past due', as: 'past_due' },
        { value: 'cancelled', label: 'Cancelled' },
      ],
    }),
    // HubSpot-defined: no definition, so Kalup reads it and never writes it.
    domain: p.string('domain'),
    name: p.string('name'),
    renewalDate: p.date('renewal_date', {
      label: 'Renewal date',
      group: 'billing',
      fieldType: 'date',
    }),
    seatCount: p.number('seat_count', {
      label: 'Seat count',
      group: 'billing',
      fieldType: 'number',
    }),
  },
})

export type CompanyData = InferProperties<typeof Company.properties> & { id: string }
```

The tool parses this file and writes it back in one canonical form. It never executes it. Your app imports it, and `CompanyData` is typed from it with no build step: `CompanyData['billingStatus']` is `'active' | 'past_due' | 'cancelled' | null`.

```ts
import { Company } from './kalup'

Company.properties.billingStatus.get(record.properties) // 'past_due' when HubSpot stores 'PAST DUE'
Company.properties.billingStatus.set(update, 'past_due') // writes 'PAST DUE' into the property bag
```

Checking the files, in [`examples/basic`](examples/basic):

```console
$ pnpm exec kalup validate
Config valid (0 errors, 0 warnings)
$ pnpm exec kalup ir --check
$ pnpm exec kalup fmt --check
All files are canonical
```

A mistake names the file, the line and the fix, and exits 3. This is the same example with one group name changed:

```console
$ pnpm exec kalup validate
Config invalid (1 error, 0 warnings)
kalup/objects/companies.ts:33: E_UNKNOWN_GROUP: group 'licensing' is not in the groups of companies (fix: add licensing: { label: '...' } to the groups block) (docs: errors/E_UNKNOWN_GROUP.md)
```

Example output of `pull`, run against the example's fake portal after someone renamed a label in the HubSpot UI and a property existed in the portal but not yet in the file:

```console
$ pnpm exec kalup pull --target sandbox
companies: 1 added, 1 changed, 5 unchanged, 0 missing in portal
  changed: property:companies/billing_status#label "Billing status" -> "Billing state"
  added: property:companies/renewal_date
subscription: 0 added, 0 changed, 6 unchanged, 0 missing in portal
wrote kalup/objects/companies.ts
```

`pull` takes the portal's side, keeps your keys, aliases, comments and `.required()` calls, and copies every file it overwrites to `.kalup/history/` first.

## How it works

```mermaid
flowchart LR
  files["kalup.config.ts<br/>kalup/objects/*.ts"]
  ir["IR<br/>ir/1"]
  plan["plan<br/>plan/1"]
  portal[("HubSpot portal<br/>one per target")]
  app["your app<br/>types and codecs"]

  files -- "parse, never execute" --> ir
  ir -- "diff against a read of the portal" --> plan
  plan -- "apply, after a person confirms" --> portal
  portal -. "pull: read, normalize, merge" .-> files
  files -- "import" --> app

  classDef built fill:#F0F0EB,stroke:#141413,color:#141413
  classDef planned fill:#F0F0EB,stroke:#6B6B64,color:#6B6B64,stroke-dasharray:5 4
  classDef metal fill:#FF8000,stroke:#141413,color:#141413
  class files,ir,app built
  class plan planned
  class portal metal
```

Two versioned JSON documents hold the system together. The IR (`ir/1`) is what the config files mean. The plan (`plan/1`) is what `apply` would do to one target. Everything else (docs, the typed client, AI agents) reads the IR or the plan and never the TypeScript. `pull` is the reverse arrow: it reads a target and merges what it finds into the files. The dashed box is not built yet: `plan` arrives in milestone 2 and `apply` in milestone 4. The full contract is in [docs/architecture.md](docs/architecture.md).

## Commands

| Command | What it does | Status |
|---|---|---|
| `kalup init` | Create `kalup.config.ts` and pull the first target | Built, milestone 1 |
| `kalup pull` | Read a target and write `kalup/objects/*.ts` | Built, milestone 1 |
| `kalup validate` | Check the config files and report every issue | Built, milestone 1 |
| `kalup ir` | Print the IR document derived from the config files | Built, milestone 1 |
| `kalup fmt` | Rewrite config files in canonical form | Built, milestone 1 |
| `kalup status` | Show targets, portal checks and state | Built, milestone 1 |
| `kalup compare` | Compare two sides: a target, a snapshot or config | Planned, milestone 2 |
| `kalup plan` | Show what apply would change on a target | Planned, milestone 2 |
| `kalup snapshot` | Save a full pull of a target as a file | Planned, milestone 2 |
| `kalup docs` | Generate a data dictionary from the config | Planned, milestone 2 |
| `kalup apply` | Push a plan to a target | Planned, milestone 4 |

Milestones 1 and 2 are read-only: only requests the endpoint registry tags `read` ever leave the machine. The loop once milestone 4 ships:

```sh
kalup init --portal <portal-id>                 # writes kalup.config.ts, kalup/ and AGENTS.md
kalup pull --target sandbox                     # read a target, write kalup/objects/*.ts
kalup compare sandbox production                # what differs between two targets, or a target and config
kalup plan --target production --out plan.json  # every change, classified, with held drift listed
kalup apply plan.json                           # write, after a person confirms at a terminal
```

<details>
<summary><b>Options and exit codes</b></summary>

| Option | What it does |
|---|---|
| `--json` | Print one `envelope/1` document to stdout and nothing else |
| `--portal <id>` | The Hub ID of the portal to set up (`init`) |
| `--objects <a,b,c>` | The objects to pull, default `contacts,companies,deals` (`init`) |
| `--target <name>` | The target to run against |
| `--only <glob>` | Limit pull to the addresses that match, for example `property:companies/*` |
| `--discover` | List in-portal resources outside the pull scope and write nothing (`pull`) |
| `--check` | Report what would change and write nothing (`ir`, `fmt`, `pull`) |
| `--exit-code` | Exit 2 when `fmt --check` or `pull --check` finds changes |
| `--help` | Print the usage text |
| `--version` | Print the version |

| Exit code | Meaning |
|---|---|
| 0 | Done |
| 1 | Error |
| 2 | Differences pending, only with `--exit-code` |
| 3 | Config or IR invalid |
| 4 | A person is needed, for example when the key belongs to a portal other than the pinned one |
| 5 | Partial apply (milestone 4) |

</details>

## Packages

| Package | Path | What it is | Status |
|---|---|---|---|
| `kalup` | [`packages/cli`](packages/cli) | The CLI, bin `kalup`. Also exports `defineConfig` and the `KalupConfig` type for `kalup.config.ts` | Built, milestone 1 |
| `@kalup/core` | [`packages/core`](packages/core) | The runtime: property codecs, `InferProperties`, the config reader and writer, the IR. Zero runtime dependencies, no HTTP | Built, milestone 1 |
| `@kalup/client` | none yet | A typed CRM client built on the same files | Planned, milestone 3 |

## Kalup and HubSpot's own tools

Kalup works next to HubSpot's own tools and calls HubSpot's public REST APIs directly.

- **The HubSpot Agent CLI and the MCP configuration tools** let an agent create, update and delete properties, pipelines and more from a prompt. They have no desired-state file, no diff against a portal, no plan over a whole change set, no targets and no drift detection. After a quick change with them, run `kalup pull` so the files catch up.
- **Sandbox deploy to production** is Enterprise only, moves new assets only and cannot push an edit to anything that already exists. Kalup's `compare`, `plan` and `apply` will work between any two portals, including edits.
- **The `hs` CLI and the projects framework** are configuration as code for apps and CMS assets. Kalup does not rebuild any of that. Use `hs` for the app and Kalup for the portal.

## Roadmap

The order is the promise. The calendar is not.

| Milestone | Goal | Status |
|---|---|---|
| 1. Read-only foundation | `kalup pull` reads a portal into `kalup/objects/*.ts`, and the app gets its types from those files with no generate step | Built, not released |
| 2. Compare, plan, snapshot, docs | Show what differs between config and a portal, or between two portals, in the plan format milestone 4 will apply | Next, still read-only |
| 3. `@kalup/client` | A typed CRM client for reads, writes and search, typed by the same files | Planned |
| 4. Apply | `kalup apply` writes a reviewed plan to a target, keeps state, and holds drift instead of reverting it | Planned |
| Later | Blueprints, runbooks with `attest`, lists, forms and workflows, `generate <language>`, an MCP server and a Claude Code plugin | No fixed order |

Details, acceptance checks and what is not planned: [docs/roadmap.md](docs/roadmap.md).

## Getting started

Kalup is not on npm yet, so run it from a checkout. Requires Node 22 or later and pnpm.

### Build from source

```sh
git clone https://github.com/scopiousdigital/kalup.git
cd kalup
pnpm install
pnpm build
node packages/cli/dist/index.mjs --help
```

### Try it on the example

The example project needs no HubSpot account for these commands:

```sh
cd examples/basic
pnpm exec kalup validate
pnpm exec kalup ir
```

### Point it at a portal

You need the portal's Hub ID and a service key with read scopes. In your project directory, install both packages from the checkout: `kalup` gives you the CLI and the types for `kalup.config.ts`, and `@kalup/core` is what the files under `kalup/` and your app import.

```sh
npm init -y   # only if the directory has no package.json yet
npm install <path-to-kalup>/packages/cli <path-to-kalup>/packages/core
```

Put the key in `.env` in the same directory as `HUBSPOT_SERVICE_KEY`, then run:

```sh
npx kalup init --portal <portal-id> --objects companies
```

`init` reads the account behind the key first and stops with exit 4 if it is not that portal. Otherwise it writes `kalup.config.ts`, `kalup/`, the `.kalup/` line in `.gitignore`, `AGENTS.md` with the rules an AI agent follows in the project, and a `CLAUDE.md` that points at it, then runs the first pull. Nothing is written to the portal.

<details>
<summary><b>Example output of <code>init</code></b></summary>

Run against the example's fake portal, a sandbox account with a billing group on companies:

```console
Portal 1111111: SANDBOX, app-eu1.hubspot.com, Europe/Ljubljana
Target sandbox: companies
Read scopes the key in HUBSPOT_SERVICE_KEY needs (Development > Keys > Service keys, see https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/account-service-keys):
  crm.schemas.companies.read (companies)
wrote kalup.config.ts
wrote .gitignore
wrote AGENTS.md
wrote CLAUDE.md
No biome.json or prettier config found. If you add a formatter, ignore kalup/ in it: the writer keeps those files in its own format.
companies: 5 added, 0 changed, 0 unchanged, 0 missing in portal
  added: property:companies/billing_notes
  added: property:companies/billing_status
  added: property:companies/renewal_date
  added: property:companies/seat_count
  added: group:companies/billing
wrote kalup/index.ts
wrote kalup/objects/companies.ts
```

</details>

The user docs ship with the CLI: [config files](packages/cli/docs/config.md), [pull](packages/cli/docs/pull.md) and [targets and keys](packages/cli/docs/targets.md).

## Contributing

Pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first: it covers the setup, the house rules and the DCO sign-off (`git commit -s`). Questions go to [GitHub Discussions](https://github.com/scopiousdigital/kalup/discussions), bugs to [issues](https://github.com/scopiousdigital/kalup/issues/new/choose), and security problems through [private reporting](SECURITY.md), never a public issue. Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md). See [SUPPORT.md](SUPPORT.md) for where to ask what. If you are an AI agent working in this repo, read [`CLAUDE.md`](CLAUDE.md) first.

## Licence

Apache-2.0. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).

> Everything that runs on your machine or in your CI against HubSpot's public APIs is free and stays free. The licence will not tighten.

Blueprint content, when it exists, will carry its own permissive licence (MIT or 0BSD) so copied files carry no notice obligations into your repo.

Built by [Scopious](https://scopious.dev). A hosted service for teams is planned.

---

<sub>Kalup is an independent open-source project maintained by Scopious. It is not affiliated with, endorsed by, or sponsored by HubSpot, Inc. HubSpot is a registered trademark of HubSpot, Inc.</sub>
