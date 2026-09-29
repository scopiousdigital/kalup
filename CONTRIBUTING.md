# Contributing to Kalup

Thanks for helping. Kalup is pre-alpha and built part-time by one founder with AI agents, so small, focused pull requests land fastest. For anything bigger than a bug fix or a docs correction, open an issue or a [discussion](https://github.com/scopiousdigital/kalup/discussions) first, so nobody builds something the [roadmap](README.md#roadmap) rules out.

Every commit needs a DCO sign-off (`git commit -s`). There is no CLA. Details are [below](#sign-off-developer-certificate-of-origin).

## Before you start

The documentation, and where each piece lives:

| Document | What it holds |
|---|---|
| [`README.md`](README.md) | What Kalup is, getting started and the roadmap |
| [`docs/architecture.md`](docs/architecture.md) | The design, the rules it keeps and why. Read it before you touch `packages/core` or `packages/cli`, and before you re-argue a decision |
| [`docs/compatibility.md`](docs/compatibility.md) | What stays stable across releases |
| [`docs/hubspot.md`](docs/hubspot.md) | HubSpot behaviour Kalup relies on, live evidence, and how to run the conformance runner |
| [`packages/cli/docs/`](packages/cli/docs/) | User docs and error pages shipped in the `kalup` package. `Issue.docs` points at them, so keep their paths stable |
| [`apps/web/content/docs/`](apps/web/content/docs/) | The public website docs |
| [`packages/core/src/issues.ts`](packages/core/src/issues.ts) | Every issue code and its docs in one table. `pnpm gen` writes the error pages in `packages/cli/docs/errors/` and `apps/web/content/docs/reference/errors.mdx` from it; never edit those by hand |
| [`.changeset/`](.changeset/README.md) | Release notes for the next version |

If you are an AI agent, read [`AGENTS.md`](AGENTS.md) first. It holds the same rules in short form.

## Set up

You need Node 22.18 or later to build and test the repository, because tsdown, the build tool, requires it (the repo has an [`.nvmrc`](.nvmrc)), and pnpm. The packages themselves run on Node 22.13.1 or later, the floor in `engines`, which `node scripts/pack-smoke.mjs --node <path>` checks. The pnpm version is pinned in the root `package.json` under `packageManager`.

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

`pnpm build && pnpm check && pnpm test` must pass before you open a pull request. CI runs the same three on Node 22 and 24, then `node scripts/pack-smoke.mjs`, which installs the packed packages in an empty project and checks them, and the website's production build.

## Repo layout

| Path | What it holds |
|---|---|
| `packages/core` | `@kalup/core`: codecs, `InferProperties`, the config grammar reader and writer, the IR |
| `packages/cli` | `kalup`: the CLI, bin `kalup`, and the user docs it ships in `docs/` |
| `packages/tsconfig` | shared TypeScript config |
| `apps/web` | the website and docs site, `@kalup/web` (Fumadocs on Next.js) |
| `examples/` | example projects, type-checked in CI |
| `docs/` | architecture, compatibility and HubSpot behaviour |

## Tests

- Tests live under `packages/<pkg>/test/` and mirror `src/`: `src/codecs/builders.ts` is tested by `test/codecs/builders.test.ts`. Never put a test under `src/`.
- Fixtures go under `test/fixtures/` and use invented names: `acme-crm`, `companies`, `billing_status`, `renewal_date`, portal IDs `1111111` and `2222222`.
- The default test run never touches the network. Commit JSON fixtures shaped like the HubSpot API responses instead. Live tests are opt-in, gated by an environment variable, against an authorized developer test account.
- The CLI's contract tests drive the built runner (`packages/cli/dist`), so oclif discovers the commands exactly as it does once installed. `pnpm test` builds first; run `pnpm --filter kalup build` (and `pnpm --filter @kalup/core build` after a core change) before `pnpm --filter kalup test` on its own. Each build writes a fingerprint of its sources' content into `dist/build-stamp.json`, and a CLI or core build that does not match the sources on disk fails the tests instead of passing old behaviour. Timestamps play no part, so a cached build of the same sources passes.
- Every HubSpot request goes through the endpoint registry. A guard fails the suite if a read command's HTTP layer is called with a path the registry does not tag `read`, and the write client sends only the writes its allowlist names.
- A bug fix comes with a test that fails before the fix.

## Code style

Ultracite (a Biome preset) enforces formatting and linting, with our formatter settings kept: no semicolons, single quotes, 120 columns, trailing commas. `pnpm lint` runs `ultracite check` and `pnpm lint:fix` (or `pnpm format`) runs `ultracite fix`. Run `pnpm lint:fix` before you finish. A suppression needs a `biome-ignore` comment with the reason, and only for the cases the team allows: serial HubSpot requests, control-character handling, bit arithmetic where it is the point, and a tokenizer loop. `biome.jsonc` explains each override. Also:

- Function declarations, not arrow functions assigned to constants, for top-level functions.
- No default exports, except in config files.
- Minimum code. No abstraction for a single use, no option nobody asked for, no error handling for cases that cannot happen.
- Never print, log or commit a token or key, including in error and debug output.

## Changesets

Add a changeset with `pnpm changeset` only for a user-visible change to released behaviour of `kalup` or `@kalup/core`. Pick the package and the bump, and write what changed for users in a few plain lines. The pages in `packages/cli/docs/` ship inside the `kalup` package, so a user-visible change to them counts. `@kalup/web`, the examples, the tests and the contributor docs are not released and need none. Keep one changeset per feature or fix and update it through review; it is a release note, not a development log.

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

## Design decisions

Settled decisions live in [`docs/architecture.md`](docs/architecture.md), each as a rule with its reason. To change one, open an issue or a pull request that edits that file and cites a new fact, such as a measurement, a HubSpot change or a live test result. The founder decides.

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
3. The default test run never touches the network. Live tests are opt-in, gated by an environment variable, against an authorized developer test account.
4. Every HubSpot request goes through the endpoint registry; writes only through the write client.
5. Never print, log or commit a token. Never put a person's email address in a request header or payload.
6. Prose has no em dashes.
7. When something is underspecified or looks wrong, ask in the issue before writing the code.
8. Check `docs/architecture.md` before re-arguing a settled decision.
9. Absence never deletes. The one planned exception is takeover mode ([architecture section 14](docs/architecture.md#14-decided-for-010), not built yet), which also needs `allowDestroy` on the target. Nothing destructive runs without a person confirming it at a terminal.
10. Do not vendor HubSpot's OpenAPI specs or code generated from them. Write thin clients by hand.

## Pull requests

- One change per pull request. Explain what and why; the template has a checklist.
- Keep the diff to what the change needs. No drive-by refactors or reformatting of code you did not touch.
- Link the issue it belongs to.

## Licence

Kalup is Apache-2.0 (see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE)). Your contribution is licensed the same way, as the DCO sign-off states.

## Conduct

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md). Report a security problem privately, as [SECURITY.md](SECURITY.md) explains, never in a public issue.
