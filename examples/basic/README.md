# Example: basic

A small Kalup project with invented names. It shows the config files, the app that imports them, and the tests that keep both honest.

## What it shows

- [`kalup.config.ts`](kalup.config.ts): two targets, `sandbox` (portal `1111111`) and `production` (portal `2222222`, `protected: true`), each with a read key named by environment variable, and a pull scope of `companies` plus the custom object `subscription`.
- [`kalup/objects/companies.ts`](kalup/objects/companies.ts): a standard object with a `billing` group, managed properties of four kinds, an enum option with an alias (`PAST DUE` reads as `past_due` in the app), and two HubSpot-defined properties, `domain` and `name`, kept as references that Kalup never writes.
- [`kalup/objects/subscription.ts`](kalup/objects/subscription.ts): a custom object with its labels, display property and a `.required()` property.
- [`kalup/index.ts`](kalup/index.ts): the barrel the tool writes.
- [`src/index.ts`](src/index.ts): the app side. It reads and writes property bags through the codecs, typed by the files above with no generate step.

## How the files were made

The files under `kalup/` are what `kalup pull` writes from the fake portal in [`test/fixtures/portal`](test/fixtures/portal), JSON shaped like HubSpot's API responses, plus three hand edits: the comment on `billingStatus`, the alias `as: 'past_due'`, and `.required()` on `planName`. A pull keeps all three.

To regenerate the files, build the CLI and run pull through the fake portal from this directory. The key can be any value, since no request leaves the machine:

```sh
pnpm --filter kalup build
HUBSPOT_SANDBOX_KEY=any-value node --import ./test/fake-portal.ts ../../packages/cli/dist/index.mjs pull --target sandbox
```

## Check it

From the repo root:

```sh
pnpm --filter @kalup/example-basic typecheck   # the app and the config files type-check
pnpm --filter kalup build                      # the tests run the built CLI
pnpm --filter @kalup/example-basic test
```

The tests check that `kalup ir` still derives the committed golden IR in [`test/fixtures/ir.json`](test/fixtures/ir.json), that a pull of the fake portal would change no file, that the terminal output, the `companies.ts` snippet and the command table in the [main README](../../README.md) match what the built CLI does, and that the pages directly in `apps/web/content/docs` stay free of em dashes and carry the disclaimer. Pages in its subfolders are not checked. After `pnpm install` and `pnpm build` at the root, `pnpm exec kalup validate` and `pnpm exec kalup fmt --check` from this directory run the CLI on the files directly.

Kalup is an independent open-source project maintained by Scopious. It is not affiliated with, endorsed by, or sponsored by HubSpot, Inc. HubSpot is a registered trademark of HubSpot, Inc.
