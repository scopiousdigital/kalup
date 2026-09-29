# Kalup: configuration as code for HubSpot

Kalup keeps a HubSpot portal's configuration (properties, groups, custom objects, later pipelines and association labels) in TypeScript files that the tool parses and never executes. Changes are reviewed as plans, applied to any named target portal, and edits made in the HubSpot UI are held as drift instead of reverted. The same files type the app with no generate step. Agencies with a technical HubSpot lead are the initial customer; developers, admins and RevOps consultants use the same engine through different interfaces. This repo is the open-source core. The local MVP ships before cloud; cloud implementation requires its own assigned milestone.

## Layout

- `packages/core`: `@kalup/core`, the runtime. Codecs, `InferProperties`, the config grammar reader and writer, the IR.
- `packages/cli`: `kalup`, the CLI, bin `kalup`. The brand string lives in one constant.
- `packages/tsconfig`: shared TypeScript config, and `stamp.ts`, the build fingerprint both packages write into dist and the CLI tests check.
- `apps/web`: the website and docs site, `@kalup/web` (Fumadocs on Next.js).
- `examples/`: example projects, type-checked in CI.
- `docs/`: contributor documents, listed below.

Tooling: pnpm, turbo, biome, tsdown, vitest, changesets, and oclif for the CLI's command layer. Node 22+.

## Before you finish

`pnpm build && pnpm check && pnpm test` passes today and must pass when you are done. House style: Ultracite (a Biome preset) enforces formatting and linting, with our formatter settings kept (no semicolons, single quotes, 120 columns, trailing commas); function declarations, no default exports except config files. `pnpm lint` runs `ultracite check` and `pnpm lint:fix` (or `pnpm format`) runs `ultracite fix`. Run `pnpm lint:fix` before you finish. A suppression needs a `biome-ignore` comment with the reason, and only for the cases the team allows: serial HubSpot requests, control-character handling, bit arithmetic where it is the point, and a tokenizer loop. `biome.jsonc` explains each override. Tests live under `packages/<pkg>/test/` mirroring `src/` (`src/codecs/builders.ts` is tested by `test/codecs/builders.test.ts`), fixtures with invented names under `test/fixtures/`. Add a changeset for anything that should ship in a release.

## Read next

- `docs/README.md`: the documentation map; current work and reference.
- `docs/vision.md`: what Kalup is and is not, the personas, the positioning. Read once.
- `docs/architecture.md`: vocabulary, project layout, IR, state, plan, classification, engine contracts. Read before touching `packages/core` or `packages/cli`.
- `docs/roadmap.md`: the milestones and what each one delivers. Read to find out what you are building and what you are not.
- `docs/adr/`: settled decisions with their reasons. Check here before re-arguing one.

Use the vocabulary from `docs/architecture.md`. A portal in a project is a target, never an environment. A resource is addressed as `<type>:<path>`, for example `property:companies/billing_status`. Drift is held, not reverted. A tombstone written by `kalup rm` has `action: 'destroy'` or `'release'`.

## Hard rules

1. Never copy source from a client repository. Read it to understand behaviour, then write fresh.
2. Fixtures, examples, tests and docs use invented names. No client names, portal IDs or property names from client work.
3. Tests never touch the network. Commit JSON fixtures shaped like the API responses.
4. Milestones 1 and 2 are read-only. Only `read`-tagged requests from the endpoint registry go out (a `read` path may be a POST, listing lists is one).
5. Never print, log or commit a token, including in error and debug output. Never put a person's email address in a request header or payload.
6. Prose has no em dashes. Plain English, point first, no filler.
7. Do not publish to npm, create the GitHub org or push. Commit locally only when asked.
8. Build only the milestone you were given. Finish the assigned coherent change, report validation and remaining work, then stop before starting another milestone. Follow the current roadmap: narrow apply and blueprints precede the full typed client. When something is underspecified or looks wrong, stop and ask.
9. Check `docs/adr/` before re-arguing a settled decision.
10. Absence never deletes. Nothing destructive runs without a person confirming it at a terminal.

Kalup is an independent open-source project maintained by Scopious. It is not affiliated with, endorsed by, or sponsored by HubSpot, Inc. HubSpot is a registered trademark of HubSpot, Inc.
