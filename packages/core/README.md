# @kalup/core

Kalup: configuration as code for HubSpot. This is the runtime your config files and your app import.

Kalup keeps a HubSpot portal's configuration in files such as `kalup/objects/companies.ts`. The [`kalup`](https://www.npmjs.com/package/kalup) CLI reads and writes those files. `@kalup/core` is what they import, and what makes them type your app with no generate step:

- `defineObject`, `defineCustomObject` and the `p.*` property builders, with `.strict()` (enums), `.required()`, `.readonly()` and `.managed(false)`.
- Property codecs: `get` reads a CRM property bag into typed values, `set` writes them back.
- `InferProperties`, the type of an object's property bag, and `propertyNames`, the list to request on a CRM read.
- `defineConfig` and `defineRemoved` with their types (`KalupConfig`, `Target`, `ObjectScope`, `Override`, `KalupRemoved`, `Tombstone`), so `kalup.config.ts` and `kalup/removed.ts` get editor types. Hover a field to see its docs and its default.

Zero runtime dependencies. No HTTP and no file system, so it runs anywhere your app does.

## Install

```sh
npm install -D kalup @kalup/core   # or: pnpm add -D kalup @kalup/core, or: yarn add -D kalup @kalup/core
```

If your app imports the files at run time for their codecs, put `@kalup/core` in `dependencies`: `npm install @kalup/core`.

## Use

```ts
import { Company, type CompanyData } from './kalup/index.js' // a bundler also resolves './kalup'

const status: CompanyData['billingStatus'] = Company.properties.billingStatus.get(record.properties)
// 'active' | 'past_due' | 'cancelled' | Unlisted | null
```

An enum reads a value its options do not list, such as an option an admin added in HubSpot, as `Unlisted`, and `set` writes it back unchanged. `.strict()` on the builder makes `get` and `set` throw on such a value and drops `Unlisted` from the type.

## Status

Version 0.1.0. Before 1.0, a minor release may change these exports, and its release notes say so. The `ir/1` document changes only by addition within its version. [Compatibility](https://github.com/scopiousdigital/kalup/blob/main/docs/compatibility.md) lists what is covered.

## Docs

- [Types and codecs](https://kalup.dev/docs/concepts/types-and-codecs) and [Property builders](https://kalup.dev/docs/config/property-builders): what each builder and codec does on the wire.
- [kalup.config.ts](https://kalup.dev/docs/config/kalup-config): every config field and its default.
- [The repository](https://github.com/scopiousdigital/kalup#readme): the overview and the roadmap.

## Licence

Apache-2.0.

Kalup is an independent open-source project maintained by Scopious. It is not affiliated with, endorsed by, or sponsored by HubSpot, Inc. HubSpot is a registered trademark of HubSpot, Inc.
