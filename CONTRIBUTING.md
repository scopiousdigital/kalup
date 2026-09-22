# Contributing to Kalup

Thanks for helping. Kalup is pre-alpha and built part-time by one founder with AI agents, so small, focused pull requests land fastest. For anything bigger than a bug fix or a docs correction, open an issue or a [discussion](https://github.com/scopiousdigital/kalup/discussions) first, so nobody builds something the roadmap rules out.

Every commit needs a DCO sign-off (`git commit -s`). There is no CLA. Details are [below](#sign-off-developer-certificate-of-origin).

## Before you start

Read these once:

- [`docs/vision.md`](docs/vision.md): what Kalup is and is not, and who it is for.
- [`docs/architecture.md`](docs/architecture.md): the vocabulary, the IR, state, plans and the engine contracts. Read it before you touch `packages/core` or `packages/cli`.
- [`docs/roadmap.md`](docs/roadmap.md): what each milestone builds. Build only the milestone in progress.
- [`docs/adr/`](docs/adr/): settled decisions and their reasons. Check here before you re-argue one.

If you are an AI agent, read [`CLAUDE.md`](CLAUDE.md) first. It holds the same rules in short form.

## Set up

You need Node 22 or later (the repo has an [`.nvmrc`](.nvmrc)) and pnpm. The pnpm version is pinned in the root `package.json` under `packageManager`.

```sh
git clone https://github.com/scopiousdigital/kalup.git
cd kalup
pnpm install
pnpm build
```

## Commands

| Command | What it does |
|---|---|
| `pnpm build` | Build every package and app with turbo |
| `pnpm check` | Lint with biome, then type-check every package |
| `pnpm test` | Run every test suite |
| `pnpm lint:fix` | Apply biome's safe fixes and formatting |
| `pnpm --filter <package> test` | Test one package, for example `pnpm --filter @kalup/core test` |
| `pnpm --filter <package> typecheck` | Type-check one package |
| `pnpm --filter @kalup/web dev` | Run the website and docs locally |
| `pnpm changeset` | Describe a change for the next release |

`pnpm build && pnpm check && pnpm test` must pass before you open a pull request. CI runs the same three.

## Repo layout

| Path | What it holds |
|---|---|
| `packages/core` | `@kalup/core`: codecs, `InferProperties`, the config grammar reader and writer, the IR |
| `packages/cli` | `kalup`: the CLI, bin `kalup`, and the user docs it ships in `docs/` |
| `packages/tsconfig` | shared TypeScript config |
| `apps/web` | the website and docs site, `@kalup/web` (Fumadocs on Next.js) |
| `examples/` | example projects, type-checked in CI |
| `docs/` | vision, architecture, roadmap and ADRs |

## Tests

- Tests live under `packages/<pkg>/test/` and mirror `src/`: `src/codecs/builders.ts` is tested by `test/codecs/builders.test.ts`. Never put a test under `src/`.
- Fixtures go under `test/fixtures/` and use invented names: `acme-crm`, `companies`, `billing_status`, `renewal_date`, portal IDs `1111111` and `2222222`.
- Tests never touch the network. Commit JSON fixtures shaped like the HubSpot API responses instead.
- A guard fails the suite if the HTTP layer is called with a path the endpoint registry does not tag `read`. Milestones 1 and 2 are read-only, and that guard is how the suite proves it.
- A bug fix comes with a test that fails before the fix.

## Code style

Ultracite (a Biome preset) enforces formatting and linting, with our formatter settings kept: no semicolons, single quotes, 120 columns, trailing commas. `pnpm lint` runs `ultracite check` and `pnpm lint:fix` (or `pnpm format`) runs `ultracite fix`. Run `pnpm lint:fix` before you finish. A suppression needs a `biome-ignore` comment with the reason, and only for the cases the team allows: serial HubSpot requests, control-character handling, bit arithmetic where it is the point, and a tokenizer loop. `biome.jsonc` explains each override. Also:

- Function declarations, not arrow functions assigned to constants, for top-level functions.
- No default exports, except in config files.
- Minimum code. No abstraction for a single use, no option nobody asked for, no error handling for cases that cannot happen.
- Never print, log or commit a token or key, including in error and debug output.

## Changesets

Add a changeset with `pnpm changeset` for any change that should ship in a release of `kalup` or `@kalup/core`. Pick the package, the bump and write one plain paragraph about what changed for users. The pages in `packages/cli/docs/` ship inside the `kalup` package, so a change to them needs a changeset too. `@kalup/web`, the examples, the tests and the contributor docs are not released and need none.

## Sign-off (Developer Certificate of Origin)

Kalup uses the [Developer Certificate of Origin](https://developercertificate.org) instead of a Contributor Licence Agreement. By signing off a commit you state that you wrote it, or otherwise have the right to submit it under the project's licence, Apache-2.0.

Sign off each commit with `-s`:

```sh
git commit -s -m "Fix the escape of a tab in option labels"
```

This adds a line with the name and email from your git config:

```text
Signed-off-by: Your Name <you@example.com>
```

Forgot? Fix the last commit with `git commit --amend -s --no-edit`, or every commit on your branch with `git rebase --signoff main`, then force-push the branch.

## Architecture decision records

An ADR records one decision that shapes Kalup: the situation, the choice, the options that lost and why, and what it costs. They live in [`docs/adr/`](docs/adr/), are numbered, and are never edited after acceptance.

To propose one:

1. Copy the shape of an existing record: `# NNNN. Title`, then `Status`, `Date`, `Context`, `Decision`, `Alternatives considered` and `Consequences`.
2. Use the next free number and set the status to `proposed`.
3. Open a pull request with the record alone, or with the smallest change that shows why it is needed.

The founder decides. A change of mind gets a new ADR that supersedes the old one. Do not re-argue an accepted ADR without a new fact, such as a measurement, a HubSpot change or a live test result. Cite the fact.

## Writing docs and prose

- No em dashes. Use a comma, a colon or two sentences.
- Plain English, point first, no filler. "Use", not "leverage". "Help", not "facilitate".
- Use the vocabulary from `docs/architecture.md`. A portal in a project is a **target**, never an environment. A resource is addressed as `<type>:<path>`, for example `property:companies/billing_status`. Drift is **held**, not reverted.
- "HubSpot" appears only as a descriptor, with a capital S. Never in a feature name, never shortened to "Hub" or `hs` in a name of ours.
- Say what is built and what is planned. A HubSpot behaviour nobody has tested live stays labelled unverified.

## Hard rules

These are not style preferences. A pull request that breaks one is closed or sent back.

1. Never copy source from a client repository. Read it to understand behaviour, then write fresh.
2. Fixtures, examples, tests and docs use invented names. No client names, real portal IDs or property names from client work.
3. Tests never touch the network.
4. Milestones 1 and 2 are read-only. Only `read`-tagged requests from the endpoint registry go out.
5. Never print, log or commit a token. Never put a person's email address in a request header or payload.
6. Prose has no em dashes.
7. Build only the milestone in progress. When something is underspecified or looks wrong, ask in the issue.
8. Check `docs/adr/` before re-arguing a settled decision.
9. Absence never deletes. Nothing destructive runs without a person confirming it at a terminal.
10. Do not vendor HubSpot's OpenAPI specs or code generated from them. Write thin clients by hand.

## Pull requests

- One change per pull request. Explain what and why; the template has a checklist.
- Keep the diff to what the change needs. No drive-by refactors or reformatting of code you did not touch.
- Link the issue or ADR it belongs to.

## Licence

Kalup is Apache-2.0 (see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE)). Your contribution is licensed the same way, as the DCO sign-off states.

## Conduct

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md). Report a security problem privately, as [SECURITY.md](SECURITY.md) explains, never in a public issue.
