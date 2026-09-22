# @kalup/core

Kalup: configuration as code for HubSpot. This is the runtime your app imports.

Kalup keeps a HubSpot portal's configuration in files such as `kalup/objects/companies.ts`. The [`kalup`](https://github.com/scopiousdigital/kalup/tree/main/packages/cli) CLI reads and writes those files. `@kalup/core` is what they import, and what makes them type your app with no generate step:

- `defineObject`, `defineCustomObject` and the `p.*` property builders, with `.required()`, `.readonly()` and `.managed(false)`.
- Property codecs: `get` decodes a CRM property bag into typed values, `set` encodes them back.
- `InferProperties`, the type of an object's property bag, and `propertyNames`, the list to request on a CRM read.
- The config grammar reader and canonical writer, the `ir/1` document with its JSON Schema, and `loadFiles` and `validate`, which turn file text into the IR and report every issue with the file, the line and a fix.

Zero runtime dependencies. No HTTP and no file system, so it runs anywhere your app does.

```ts
import { Company, type CompanyData } from './kalup'

const status: CompanyData['billingStatus'] = Company.properties.billingStatus.get(record.properties)
// 'active' | 'past_due' | 'cancelled' | null
```

## Status

Pre-alpha. Before 1.0, anything can change between minor versions, except the `ir/1` document, which changes only additively inside its version.

## Docs

- [The main README](https://github.com/scopiousdigital/kalup#readme): the overview, the roadmap and how to build from source.
- [Config files](https://github.com/scopiousdigital/kalup/blob/main/packages/cli/docs/config.md): the grammar, the builders and what each codec does on the wire.
- [Architecture](https://github.com/scopiousdigital/kalup/blob/main/docs/architecture.md): the IR and the contracts around it.

## Licence

Apache-2.0.

Kalup is an independent open-source project maintained by Scopious. It is not affiliated with, endorsed by, or sponsored by HubSpot, Inc. HubSpot is a registered trademark of HubSpot, Inc.
