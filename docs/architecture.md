# Kalup architecture

Kalup: configuration as code for HubSpot. This is the design reference: what the system is, the rules it keeps, and why. Code follows this file. When a decision changes, this file changes in the same pull request. Before re-arguing a rule here, bring a new fact: a measurement, a HubSpot change or a live test result.

HubSpot behaviour Kalup relies on, what live runs confirmed and what is still unverified is in [hubspot.md](hubspot.md). What Kalup promises to keep stable is in [compatibility.md](compatibility.md).

## 1. Rules that hold everywhere

1. **Config is parsed, never executed.** The tool reads a restricted TypeScript grammar and prints it back in one canonical form. No evaluator, child process or sandbox. Why: evaluating config runs code on every reviewer's machine, needs a working `package.json` in an admin's folder, lets blueprint text reach executed source, and would stop a hosted service from ever touching customer config. Node cannot sandbox untrusted code. The cost is no loops, helpers or spreads in config.
2. **Two JSON contracts.** The IR (`ir/1`) says what the config means; the plan (`plan/1`) says what `apply` would do to one target. Docs, generators, agents and a hosted service read these, never the TypeScript. Why: no consumer should have to run customer code. The adapter interface stays internal, because HubSpot changes its API twice a year and a public adapter shape would freeze the wrong thing.
3. **Absence never deletes.** A delete needs four keys: a `destroy` tombstone written by `kalup rm`, an owning state entry in that portal, `allowDestroy: true` on the target, and a person at a terminal typing the target name and the destructive count. A resource missing from config is an orphan note, and a portal resource config does not name is unmanaged. Why: one dropped line would otherwise archive a property holding values on thousands of records, and a flag is something an agent can pass. Takeover mode (section 7) is the one opt-in exception, and it needs `allowDestroy` and the person too.
4. **Drift is held, not reverted.** People keep editing the portal in the HubSpot UI. A unit that differs because the portal moved is reported and left alone until someone picks a side. Why: a tool that reverts an admin's label on the next CI merge gets switched off within a month.
5. **State describes the portal and holds a three-way base.** One file per verified portal records what config and the portal last agreed on. Safety never depends on it: a missing or stale base makes plan hold and ask, never overwrite. Why: only a base answers "who moved this value?", which is what separates drift from a config change.
6. **Incomplete observations prove nothing.** A read that could not see an object cannot establish absence or equality, and cannot authorize a create. Machine results carry completeness separately from success. Neither does a read that disagrees with what apply wrote minutes ago (section 8, settling). Why: a 403 read as an empty portal would plan a mass create or report a clean diff, and HubSpot serves an older copy for minutes after a write.
7. **Every HubSpot request goes through the endpoint registry, and writes only through the write client.** Read commands get a client that refuses write-tagged paths. Why: one choke point makes the read-only guarantee and the write allowlist testable.
8. **No secrets or portal IDs where they do not belong.** No token in output, logs, the journal, state or plans. No portal-specific ID, credential or transport name in the IR. No person's email address in a request header or payload.
9. **Nothing destructive runs without a person at a terminal.** `--yes` and `--approve` never cover a delete, on any host.

```
                       parse, never execute
  kalup.config.ts  ─────────────┐
  hubspot/objects/*.ts ─────────┼──> reader ──> IR (ir/1) ──> engine ──> plan (plan/1) ──> executor ──> portal
  hubspot/pipelines/*.ts ───────┤                             ^   ^                            │
  hubspot/removed.ts ───────────┘                             │   │                            │
                                                              │   │                            │ read-back,
                                             .kalup/state ────┘   └── live (normalized) <──────┘ advanceBase
                                                                            ^
                                                                            │ list + normalize
                                                                          portal

  pull (the reverse arrow):
  portal ──list + normalize──> live IR ──merge3 (base from state)──> writer ──> config files

  the app:
  hubspot/objects/*.ts ──import, executed by the app──> types + codecs (@kalup/core)
```

## 2. Project layout and the config grammar

```
kalup.config.ts              defineConfig({ ... })   parsed, never executed
hubspot/
  index.ts                   tool-written barrel, re-exports every object, pipeline and the associations
  objects/companies.ts       export const Company = defineObject('companies', {...})
  objects/subscription.ts    export const Subscription = defineCustomObject('subscription', {...})
  pipelines/deals.ts         export const RenewalsPipeline = definePipeline('deals', {...})
  associations.ts            export const Associations = defineAssociations({...})
  removed.ts                 tombstones, written by `kalup rm`
  blueprints.lock.json       provenance, written by `kalup add` and `kalup blueprint upgrade`
  .blueprints/               stored originals for upgrades, byte-exact (a .gitattributes rule keeps git from converting them)
.kalup/                      gitignored
  state/portal-<portalId>.json   one per verified portal, section 5 (in hubspot/state/ with state: 'repo')
  plans/<target>-<planId>.json   `plan --out` with no file
  journal/portal-<portalId>/     one file per apply run, section 8
  history/<timestamp>/       copies of files before the tool overwrote them, last 20
  snapshots/<target>/        one file per `kalup snapshot`
```

`hubspot/` is the default folder of object files; `dir` in `kalup.config.ts` (or `kalup init --dir`) moves it, and every path under it moves with it. The engine never looks at the disk: the host resolves the folder (`projectLayout` in the CLI, which keeps a 0.1 project's `kalup/` with `W_LEGACY_DIR` while `dir` is unset and `hubspot/` is absent) and passes it to `loadFiles` as a `Layout`, which `Loaded.layout` carries to every command that writes project files.

`kalup.config.ts`:

```ts
import { defineConfig } from '@kalup/core'

export default defineConfig({
  name: 'acme-crm',                             // optional, default the nearest package.json name, else the directory name
  state: 'local',                               // or 'repo': state in hubspot/state/, committed, section 5
  prefix: '',                                   // optional, default none
  defaultTarget: 'sandbox',                     // optional: the target a command uses without --target
  mode: 'addon',                                // or 'takeover', section 7; also per object, target, target object
  objects: {
    companies: { include: ['name', 'domain'], exclude: ['zi_*'] }, // pull scope: custom properties plus these
    deals: { pipelines: true },                 // pull every deal pipeline, not only those the files define
    contacts: { associations: true },           // pull every label between contacts and the other objects here
    subscription: {},
  },
  targets: {
    sandbox: {
      portalId: 1111111,
      allowDestroy: true,                       // default false: no delete on this portal
      yesLimit: 50,                             // the most effects one --yes covers, default 25
      credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } },
    },
    production: {
      portalId: 2222222,
      protected: true,
      drift: 'hold',                            // or 'overwrite', per target
      adopt: 'hold',                            // or 'overwrite': write config over units never agreed on
      credentials: { read: { env: 'HUBSPOT_PROD_READ_KEY' }, write: { env: 'HUBSPOT_PROD_WRITE_KEY' } },
      overrides: { 'property:subscription/customer_status': { name: 'customerstatus' } },
    },
  },
})
```

**Pull scope.** Every property an object file defines is in scope, whatever the settings say. `custom` (default `true`) pulls every other property where `hubspotDefined` is false; `include` adds named properties the files lack, typically HubSpot-defined ones to reference; `exclude` leaves out internal names, `*` matching any run (a name in both lists is `E_SETTING_VALUE`, and `include` wins over a pattern); `as` sets the export name, default PascalCase singular. The scope never differs per target: under takeover it is also what takeover may archive. `pull` writes what the scope says, including in-scope resources that are new in the portal. A file property the portal lacks is kept and reported missing in the portal, and plan creates it; `E_UNKNOWN_INCLUDE` is only for an `include` name that neither the portal nor the files have. Why the files count: with `custom: false` a project had to repeat every property it defined in `include`, or pull failed on the ones not created yet. Takeover's reach does not grow: it never archives what an object file lists. `kalup rm <address> --release` excludes one resource from pull for good. `pull --discover` lists portal resources outside the scope.

**Pipeline scope.** An object's pipelines are read when its files define a pipeline, when `pipelines: true` is set on it, or when `hubspot/removed.ts` names one of its pipelines or stages. `pipelines` defaults to `false`, unlike `custom`. Pull refreshes every pipeline the files define, and adds the portal's other pipelines only with `pipelines: true`; `pull --discover` reads the pipelines of every object in `objects` and lists those outside the scope. `kalup init` writes `pipelines: true` for deals and tickets. Why the asymmetry with `custom`: a project made before this release must not grow new files and a batch of adoption steps, which count against `yesLimit`, on its next pull without a line in config saying so. Setting `pipelines` on an object HubSpot gives no pipelines, such as products, is `E_SETTING_VALUE`.

**Association scope.** An object pair's associations are read when `associations.ts` or `hubspot/removed.ts` names an association of the pair, or when both objects are under `objects` and either sets `associations: true`. `associations` defaults to `false`, as `pipelines` does and for the same reason. Pull refreshes every association the file defines, and adds the portal's other associations of a pair only when an object of the pair sets `associations: true`; `pull --discover` reads every pair of the objects in `objects` and lists what pull does not write. `kalup init` writes `associations: true` on every object it writes. A pair of one object with itself is not read in this release.

An object file:

```ts
// hubspot/objects/companies.ts
import { defineObject, p, type InferProperties } from '@kalup/core'

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
      ],
      lifecycle: { options: 'additive' },
    }).required(),
    // HubSpot-defined. Reference only, never written.
    name: p.string('name'),
  },
})

export type CompanyData = InferProperties<typeof Company.properties> & { id: string }
```

A custom object file is the same with `defineCustomObject('<name>', {...})`, whose spec also holds the schema: `labels` (`singular` and `plural`) and `primaryDisplayProperty`, both required, and optional `description`, `secondaryDisplayProperties`, `requiredProperties` and `searchableProperties`. The name is the address (`object:subscription`), and HubSpot never changes it. Validate warns about a name or label HubSpot would refuse (`W_OBJECT_FIELD`: a letter, then letters, digits and underscores, at most 50 characters; labels at most 50; at most two secondary display properties, each once), since an object HubSpot holds can already break them, and plan blocks a create or update that would send one. It also warns when a display field names a property the file does not list and HubSpot does not give every custom object (`W_OBJECT_PROPERTY`). Only a warning, because the property may be in the portal outside the pull scope; plan blocks the write when it is not. A new custom object gets HubSpot's own properties, the group `<name>_information` and associations with activities; an association with another object, plain or labelled, is an entry of `associations.ts`.

A pipeline file, `<dir>/pipelines/<object>.ts`, one export per pipeline:

```ts
// hubspot/pipelines/deals.ts
import { definePipeline } from '@kalup/core'

// Renewals for existing customers.
export const RenewalsPipeline = definePipeline('deals', {
  id: 'renewals',
  label: 'Renewals',
  displayOrder: 2,
  stages: {
    open: { id: 'renewals_open', label: 'Open', probability: 0.2 },
    // Signed and paid.
    won: { id: 'renewals_won', label: 'Won', probability: 1 },
    lost: { id: 'renewals_lost', label: 'Lost', probability: 0 },
  },
})
```

The first argument is the object key as in `objects`. `id` is HubSpot's pipeline or stage ID: required, immutable and the address (`pipeline:deals/renewals`, `stage:deals/renewals/renewals_won`), so a changed ID is another resource, as a changed internal name is. The export name and the stage keys are free; labels update in place. `displayOrder` is required, since HubSpot requires it on create. Stage order is the order of the entries, as option order is, with no per-stage `displayOrder`; the writer never sorts stages. Each stage takes one metadata field, by object: `probability` on a deal stage (required, 0 to 1), `ticketState` on a ticket stage (`'OPEN'` or `'CLOSED'`, default `'OPEN'`) and `state` on a custom object stage (the same values and default). HubSpot derives `isClosed` from them, so it is never in config, never sent and never compared. `validate` refuses any other metadata key (`E_PIPELINE_FIELD`), since HubSpot drops an unknown key without a word and the next plan would propose it again. Validate also refuses, before anything is sent (live runs, 2026-10-05): a pipeline with no stage or a ticket pipeline with no closed stage (`E_PIPELINE_STAGES`); two stages of a pipeline whose labels match ignoring case and surrounding spaces, or two pipelines of an object whose labels match ignoring case (`E_DUPLICATE_LABEL`); a pipeline ID longer than 36 characters, a stage ID longer than 100, an ID holding whitespace or a slash, a pipeline ID used twice in the project and a stage ID used twice on one object (`E_PIPELINE_ID`). `definePipeline` returns the spec with literal types, so `RenewalsPipeline.stages.won.id` is typed `'renewals_won'`, and `StageId<typeof RenewalsPipeline>` is the union of its stage IDs.

The associations file, `<dir>/associations.ts`, a reserved name like `removed.ts`, holds one export:

```ts
// hubspot/associations.ts
import { defineAssociations } from '@kalup/core'

export const Associations = defineAssociations({
  // The person who signed the contract.
  signer: { from: 'deals', to: 'contacts', name: 'deal_signer', label: 'Signer', inverseLabel: 'Signed deal' },
  colleague: { from: 'companies', to: 'contacts', name: 'colleague', label: 'Colleague' },
  visitCompany: { from: 'visit', to: 'companies', name: 'visit_to_company' },
})
```

An entry is one association of a pair: `from` and `to` are object keys as in `objects`, and `name` is HubSpot's internal name, set on create, unique in the portal and never changed, so it is the address (`association:deals/contacts/deal_signer`). `label` is the text the `from` side shows and `inverseLabel` the text the `to` side shows; left out, it is the label, as HubSpot then shows the label on both sides. An entry with no `label` is the plain association of the pair: on a pair with a custom object HubSpot keeps it as an editable association of its own, while between two standard objects HubSpot defines it, so the file cannot. The keys are free and the writer sorts entries by name. `defineAssociations` returns the map with literal names, so the app can type the label it asks for. Validate refuses (`E_ASSOCIATION_FIELD`): an object not under `objects`, a pair of one object with itself, an empty label, a plain association between two standard objects, and two plain associations of one pair; and a label text two entries of a pair show from one side, ignoring case (`E_DUPLICATE_LABEL`, as HubSpot refuses it, live runs 2026-10-01 and 2026-10-05). A name or object holding whitespace or a slash is `E_ASSOCIATION_NAME`, and a name used twice is `E_DUPLICATE_KEY`.

**The grammar.** Anything outside it is `E_NOT_DATA` with file, line and a fix hint.

- Import statements. The `@kalup/core` and `kalup` imports are tool-owned, and the writer writes `@kalup/core` (`kalup` is the specifier before 0.1.0, so an older file loads the same; `kalup fmt` rewrites its import, as does any command that rewrites that file: `rm` for `hubspot/removed.ts`, and `target rebind`, an `add` that adds an object scope or a `pull` that changes an override for `kalup.config.ts`. A plain `pull` leaves it alone); other imports are kept verbatim (they exist for `p.json` validators).
- `export const <Name> = defineObject('<object>', {...})` and `defineCustomObject('<name>', {...})`, one or more per file, and once per export `export type <Name>Data = InferProperties<typeof <Name>.properties> & { id: string }`.
- `export const <Name> = definePipeline('<object>', {...})`, one or more per file, only under `<dir>/pipelines/`; a `definePipeline` file anywhere else is `E_UNSUPPORTED_FILE`. Leading comments on a pipeline export and on a stage entry are kept.
- `export const <Name> = defineAssociations({...})`, once, only in `<dir>/associations.ts`; anywhere else it is `E_UNSUPPORTED_FILE`. Leading comments on an entry are kept.
- Inside: object literals, arrays, string, number and boolean literals (numeric separators allowed; the writer writes plain digits), and builder calls `p.<kind>('<internal name>', {<definition>}?)` followed by any of `.strict()` (enums only), `.required()`, `.readonly()`, `.managed(false)`, each once.
- `p.json('<name>', <expression>, {<definition>}?)`: the second argument is kept as opaque source text.
- A comment block before the imports is the file header. Leading comments on a property, group or object entry are kept in place. Comments anywhere else are an error.
- No other identifiers, spreads, calls, template strings or loops.

**The writer** emits one canonical form: properties sorted by internal name, options in display order, every string through one escape function, quotes and line breaks following biome's rules at 120 columns. Explicit values are preserved, including empty strings, false and empty arrays, because presence controls ownership; a default is omitted only when omission means the same thing. The app imports tool-written files, so escaping is a security boundary and is fuzz-tested.

**Round-trip invariants:** `write(parse(t)) === t` for canonical text; formatting preserves the semantic IR and owned field presence; a repeat `pull` with no portal change is byte-identical. Pull validates the complete candidate project before saving any file. `kalup fmt` validates first, then rewrites and regenerates the barrel; on exit 3 it writes nothing.

**Property definition fields** (HubSpot terms): `label`, `group`, `fieldType`, `description`, `options` (`value`, `label`, `hidden`, `description`; order is display order), `hasUniqueValue`, `formField`, `hidden`, `displayOrder`, `numberDisplayHint`, `showCurrencySymbol` and `currencyPropertyName` (`p.number`), `textDisplayHint` (the text builders), `calculationFormula` (with `fieldType: 'calculation_equation'`), `dataSensitivity`, and `lifecycle: { options: 'additive' | 'exact', removedOptions: [...], ignoreChanges: [...], preventDestroy: true }`. Fields present are owned; omitted fields belong to the portal. `options` defaults to `additive`. A definition needs `label`, `group` and `fieldType`, otherwise the builder is a reference: never created, changed or removed. A `p.enum` or `p.multiEnum` whose definition holds only `options` is a reference with typed options, refreshed by `pull`. HubSpot `type` is implied by the builder, and `p.owner` implies `externalOptions: true` and `referencedObjectType: 'OWNER'`. HubSpot's field names are kept so its docs map onto config. `hasUniqueValue`, `dataSensitivity`, `type` and the owner fields are fixed once HubSpot creates the property (a PATCH answers 200 and keeps the old value), so a difference in them blocks with a migration. `validate` refuses a field the builder or another field rules out (`E_DEFINITION_FIELD`). [hubspot.md](hubspot.md#property-definition-fields) has what HubSpot does with each field; `dateDisplayHint` is not captured, since HubSpot ignores it on create and update.

**App binding.** The key is the TypeScript property key; the codec comes from the builder; enum aliases from `as`; then `required`, `readonly`, `managed`. The default key on pull is camelCase of the internal name. Two properties that map to one key fail `validate`.

**Codecs.** `p.<kind>(name, definition?)` returns a chain object; `defineObject` unwraps `.codec`, so `Company.properties.billingStatus` is the codec. Every codec exposes `property` (the internal name as a string literal type), `definition`, `managed`, `get(properties)`, `set(properties, value)` and `clear(properties)`; enum codecs add `enumValues`. `set` with `null` or `undefined` leaves the bag untouched. `clear` writes `''`, HubSpot's clear, and is typed `never` on a `.required()` codec. Why a separate call: a `null` from a partial object must never wipe a value.

| Builder | HubSpot `type` / `fieldType` | TypeScript type | Wire rules |
|---|---|---|---|
| `p.string` | `string` / `text`, `textarea`, `file`, `phonenumber`, `html`, `calculation_equation` | `string \| null` | empty or whitespace reads as `null` |
| `p.number` | `number` / `number`, `calculation_equation` | `number \| null` | `Number(value)`, throws on `NaN` |
| `p.boolean` | `bool` / `booleancheckbox`, `calculation_equation` | `boolean \| null` | `'true'` / `'false'` |
| `p.phoneNumber` | `phone_number` / `phonenumber` | `string \| null` | passed through |
| `p.owner` | `enumeration` / `select`, `radio`, HubSpot fills the options with users | `string \| null` | the owner ID, passed through |
| `p.date` | `date` | `string \| null` | ISO `YYYY-MM-DD`, passed through |
| `p.datetime` | `datetime` | `string \| null` | ISO 8601 UTC, passed through |
| `p.enum` | `enumeration` / `select`, `radio`, `booleancheckbox`, `calculation_equation` | union of `as ?? value`, `Unlisted`, or `null` | a stored value that is not an option reads as `Unlisted`, and `set` writes it back |
| `p.multiEnum` | `enumeration` / `checkbox` | array of aliases and `Unlisted`, or `null` | `;`-separated on the wire, each member as `p.enum` |
| `p.stringArray` | `string` | `string[] \| null` | reads split on `,` or `;`, writes `,`-joined |
| `p.json` | `string` | inferred from the Standard Schema, or `null` | `JSON.parse` then validate |

`Unlisted` is a branded string: a plain string is not one, so `set` still rejects a typo. `get` throws on an unlisted value that equals another option's alias, since `set` would write that option. `.strict()`, on `p.enum` and `p.multiEnum` only (`E_BAD_CHAIN` elsewhere, `E_STRICT_WITHOUT_OPTIONS` without options), makes `get` and `set` throw on an unlisted value and drops `Unlisted` from the type. It lives on the chain, not in `kalup.config.ts`, because the app runs object files and never the config; pull keeps the chain, so it survives a re-pull, and the IR records it as `binding.strict`. Why lenient by default: the additive option lifecycle keeps admin-added options on purpose, so throwing on them was a wrong default. The cost: `tier === 'gold'` is quietly false for an unlisted value, and an exhaustive `switch` must handle `Unlisted`. `.required()` drops `| null` and makes `get` throw on a missing value. `.readonly()` makes `set` a type error; pull writes it wherever HubSpot marks a value read-only (`modificationMetadata.readOnlyValue`) or the property is calculated, and never removes one. `pull` never emits `.required()`, `p.stringArray` or `p.json`; those are hand edits. `InferProperties` reads a type carried by the codec itself. Also exported: `propertyNames(object)` and `PropertyName<typeof Company>`, the union of internal names. The engine holds `toCreatePayload(address, resource)` (the exact create body) and `loadFiles(files, options)`, the loader as a pure function over a map of path to text.

## 3. The IR

`kalup ir` derives it from the config files. A TypeScript project does not commit it.

```json
{
  "irVersion": 1,
  "project": "acme-crm",
  "generator": { "name": "kalup", "version": "0.1.0", "frontend": "ts" },
  "resources": {
    "group:companies/billing": { "type": "group", "managed": true, "definition": { "label": "Billing" } },
    "property:companies/billing_status": {
      "type": "property",
      "managed": true,
      "definition": {
        "label": "Billing status",
        "group": { "$ref": "group:companies/billing" },
        "type": "enumeration",
        "fieldType": "select",
        "options": [{ "value": "active", "label": "Active" }, { "value": "PAST DUE", "label": "Past due" }]
      },
      "binding": { "key": "billingStatus", "codec": "enum", "aliases": { "PAST DUE": "past_due" }, "required": true },
      "lifecycle": { "options": "additive" },
      "provenance": { "blueprint": "acme/billing", "version": "1.0.0", "sourceAddress": "property:companies/billing_status", "prefix": "", "hash": "sha256:..." }
    },
    "pipeline:deals/renewals": {
      "type": "pipeline",
      "managed": true,
      "definition": { "label": "Renewals", "displayOrder": 2, "stages": ["renewals_open", "renewals_won", "renewals_lost"] },
      "binding": { "export": "RenewalsPipeline" }
    },
    "stage:deals/renewals/renewals_won": {
      "type": "stage",
      "managed": true,
      "definition": { "label": "Won", "probability": 1 },
      "binding": { "key": "won" }
    },
    "team:sales_emea": { "type": "team", "managed": false, "lookup": { "name": "Sales EMEA" } }
  },
  "targets": {
    "production": { "portalId": 2222222, "protected": true, "drift": "hold",
      "overrides": { "property:subscription/customer_status": { "name": "customerstatus" } } }
  },
  "tombstones": { "property:companies/legacy_score": { "action": "destroy" } }
}
```

```ts
type Address = string                          // '<type>:<path>', section 4
type Ref = { $ref: Address }                   // allowed anywhere inside a definition

interface IR {
  irVersion: 1
  project: string
  generator: { name: string; version: string; frontend: 'ts' | 'portal' }
  resources: Record<Address, Resource>         // sorted keys, no timestamps
  targets: Record<string, Target>
  tombstones: Record<Address, { action: 'destroy' | 'release'; reason?: string }>
  observation?: Observation                    // snapshots only: required when frontend is 'portal'
  x?: Record<string, unknown>                  // namespaced, passed through untouched
}
interface Resource {
  type: string                                 // must be known to the endpoint registry
  managed: boolean                             // false: reference only, never planned
  definition?: Record<string, unknown>         // HubSpot terms. All that plan and apply read
  lookup?: Record<string, string>              // found per target by name or email, never created
  binding?: Binding                            // app terms: key, codec, aliases, required, readonly, export
  lifecycle?: { options?: 'additive' | 'exact'; removedOptions?: string[]; ignoreChanges?: string[]; preventDestroy?: true }
  provenance?: { blueprint: string; version: string; sourceAddress: Address; prefix: string; hash: string }
  x?: Record<string, unknown>
}
interface Target {
  portalId: number                             // the wrong-portal guard, reviewed in git
  protected?: boolean                          // default true unless accountType is DEVELOPER_TEST, SANDBOX or APP_DEVELOPER
  drift?: 'hold' | 'overwrite'                 // default 'hold'
  adopt?: 'hold' | 'overwrite'                 // default 'hold'
  allowDestroy?: boolean                       // default false
  yesLimit?: number                            // 0 to 1000, default 25
  overrides?: Record<Address, { skip?: true; name?: string; definition?: Record<string, unknown>; lookup?: Record<string, string> }>
}

// @kalup/engine. Pure: text in, no node:fs. Throws IssueError with every issue found when the files cannot yield one IR
function loadFiles(files: Record<string, string>, options?: { root?: string; version?: string }): Loaded
function validate(loaded: Loaded, options?: { target?: string }): { issues: Issue[]; warnings: Issue[] }
// kalup CLI: reads kalup.config.ts and hubspot/**/*.ts from disk and calls loadFiles
function load(dir: string): Loaded
```

`loadFiles` throws for problems one IR cannot hold (`E_NO_CONFIG`, `E_UNSUPPORTED_FILE`, the reader's errors, `E_DUPLICATE_ADDRESS`, `E_DUPLICATE_KEY`, `E_REFERENCE_DEFINITION`, a custom object missing `labels` or `primaryDisplayProperty`); `validate` returns every other rule. The `credentials` block and `defaultTarget` never enter the IR: credentials are secrets, and `defaultTarget` picks a target for one command without changing what the config means. `mode` stays in `kalup.config.ts` with the pull scope it resolves against (section 7), and a plan records its result.

**Versioning.** `irVersion` is an integer with a published JSON Schema. Change inside a version is additive; readers keep unknown fields; `x` fields pass through. Serialization is deterministic: sorted keys, no timestamps except a snapshot's `observedAt`. Every JSON document Kalup writes or prints also escapes U+007F to U+009F, U+2028 and U+2029 as `\uXXXX` (`escapeJson`), so no terminal control survives raw. A version bump ships a JSON transform over the config files.

**Snapshots.** `kalup snapshot` writes one read of a target as an `ir/1` document with `generator.frontend: 'portal'`, empty `targets` and `tombstones`, and a top-level `observation`. `observedAt` is the one timestamp an IR document may hold. Why: without it, "drift since the snapshot" has no meaning and two snapshots cannot be ordered from their content.

```ts
interface Observation {
  target: { name: string; portalId: number }
  observedAt: string
  coverage: {
    complete: boolean                            // no object unreadable, no config property unaddressable
    objects: Record<string, ObjectCoverage>      // one per config object key
    otherObjects: string[] | 'unknown'           // custom objects config does not name
    notCaptured: Record<'property' | 'group' | 'object' | 'pipeline' | 'stage' | 'association', string[]>  // documented response fields Kalup drops
  }
}
interface ObjectCoverage {
  status: 'read' | 'unreadable' | 'absent' | 'excluded'
  missingScope?: string; issue?: string; objectTypeId?: string
  outOfScope?: string[]; shadowed?: string[]; unaddressable?: string[]
  unsupported?: UnsupportedProperty[]; unsupportedSchema?: UnsupportedSchema
  excluded?: Address[]; renamed?: Record<Address, string>
  pipelines?: { status: 'read' | 'unreadable'; missingScope?: string }  // only when the read covered pipelines
  associations?: {                             // only when a pair with the object was in association scope
    with: Record<string, {                     // per object this one's pair with was in scope
      status: 'read' | 'unreadable'; missingScope?: string; issue?: string
      unnamed?: { typeId: number; label?: string }[]  // this direction's user types no name, nor state, reaches
    }>
    typeIds?: Record<Address, [number, number]> // per association addressed from this object, its two type IDs
  }
}
```

A pipeline's definition holds `label`, `displayOrder` and `stages`, the ordered list of its stage IDs; its binding holds the export name. A stage's definition holds `label` and its one metadata field; its binding holds the stage key, and its parent is the pipeline in its path. A stage's `probability` is a number in the IR, though HubSpot stores and sends it as a string. These are new types inside `ir/1`. A custom object's definition holds `labels`, `description`, `primaryDisplayProperty`, `secondaryDisplayProperties`, `requiredProperties` and `searchableProperties`: every field a schema PATCH writes except `restorable`. `description`, as in `coverage.objects.<o>.unsupportedSchema`, was added in place (compatibility.md, Status). `coverage.notCaptured.pipeline` and `.stage` list what the normalizer drops (`createdAt`, `updatedAt`, `archived`, and a stage's `isClosed` and `writePermissions`). `ObjectCoverage.pipelines` is present only when the read covered the object's pipelines: a 403 on the pipelines list makes them `unreadable` and the observation incomplete, and leaves the object's properties as read. An association's definition holds `label` and `inverseLabel`, or nothing for a plain association; its binding holds the entry key and the export. `ObjectCoverage.associations` records, pair by pair, whether the pair was read, and the user-defined types of its direction no name reached (`unnamed`, with the label each shows), and the type IDs of each association addressed from the object. An association the read did not find on a pair that holds an unnamed type is unknown (`statusOf` gives `unreadable`), never absent: it may be that type, so plan neither creates, releases nor deletes beside it, and says to plan again in a few minutes. A 403 on a labels list or on a schema read the pair needs, or another refusal of a labels list (HubSpot's answer for a pair it does not support is unobserved), makes that pair `unreadable` and the observation incomplete; the other pairs stay read. A skip override on either object of a pair excludes its associations. `coverage.notCaptured.association` lists what the normalizer drops (the category, the cardinalities and the association limits, section 13). These are additions inside `ir/1`.

Captured resources carry no binding or lifecycle. A HubSpot-defined property, and a custom one HubSpot calculates with a field type other than `calculation_equation` (a rollup), is `managed: false` with at most its options. A custom `calculation_equation` property is managed, though HubSpot marks it `calculated`: its formula is config. An owner property (an enumeration select or radio with `externalOptions` and `referencedObjectType: 'OWNER'`) is `p.owner`. Unsupported properties and label-less schemas live only in coverage. A property is unsupported when Kalup does not write it: its `type` has no builder (`object_coordinates`, `json`), it is custom with a `fieldType` no builder takes (a `calculation_rollup`), or it is a custom `externalOptions` property that is no owner select or radio; coverage records `externalOptions` and `referencedObjectType` for it. A HubSpot-defined `externalOptions` property that is no owner is a reference read as a string. Pull writes every such property as a `p.string` reference (a file reference keeps its builder), and plan never creates, changes or archives one. Why a rule and not a setting: widening the builder tables would let Kalup write fieldTypes nobody has checked against HubSpot, and a custom owner property pulled as a managed select would be created as a plain select on another target. Each builder and field type Kalup writes was checked live (hubspot.md). `toSnapshot` validates its own output, so an unreadable snapshot is never written.

**References** are `{ "$ref": "<address>" }` wherever HubSpot wants an ID. `pull` swaps known ID positions for refs through state. An ID that matches nothing becomes a `lookup` resource (team by name, owner by email); one it cannot map is written as `{ "$unresolved": { "kind": "team", "id": "8841", "from": "<target>" } }`, the one stated exception to "no portal IDs in config". `validate` warns and `plan` against another target blocks that resource with the `kalup bind` fix.

**Per-target overrides** take four keys:

- `skip` drops the resource and its dependents on that target: `object:<k>` is not read, `group:<k>/<g>` takes its config properties with it, `pipeline:<k>/<id>` takes its stages, and every read lists what it left out.
- `name` points the address at a differently named resource in that portal (for a pipeline or stage, another ID: a pipeline made in the UI of each portal has an ID HubSpot assigned there). The address is present only when that name exists; otherwise the step is `blocked`, never `create`. A portal resource under the address's own name is then `shadowed`; wherever another resource refers to it, the read records `shadowed:<name>`, which never equals a config name, so plan sees a difference and pull keeps the file's side. A held unit on such a resource carries no `pull` command, because no pull can take it: the fix is to correct the override. A portal holding both names is `E_OVERRIDE_AMBIGUOUS`, unless another override claims the own name. `validate` rejects clashing names (`E_OVERRIDE_NAME`). A skip wins over a name.
- `definition` replaces whole fields on that target (validate checks the pipeline and association rules on what a target's overrides leave: a label two pipelines, two stages or two associations of a pair would share, a ticket pipeline with no closed stage, a `displayOrder` below 0): `label`, `description`, `group`, `fieldType`, `formField`, `options` (as a list, in the override's order), `hidden`, `displayOrder`, the number and text display fields and `calculationFormula` for a property, `label` for a group, `label` and `displayOrder` for a pipeline, `label` and the metadata field for a stage, `label` and `inverseLabel` for an association label (a plain association takes none; `label` alone leaves the other side as the file has it), and `lifecycle` field by field. A field present is owned on that target, and an explicit empty value is data. `type`, `hasUniqueValue` and `dataSensitivity` cannot differ per target; references and custom object schemas take no definition override; option aliases stay in the shared file. Invalid overrides are `E_OVERRIDE_DEFINITION`; an override option the shared list lacks is `W_OVERRIDE_OPTION` on a `.strict()` enum, because the app's codec throws on it; a lenient one reads it as `Unlisted`. `effectiveResources(ir, target)` applies them, and validate, compare, plan (so `desired` and the approval digest), apply and the data dictionary all use it; `kalup ir` still prints the shared IR. Pulling a target writes the portal value of an overridden field into that target's override, never into the shared file; a field the target's own `ignoreChanges` releases is kept (`ignored`), and a property HubSpot moved out of an overridden group into a group config lacks keeps its override group (`override-group`). Why whole fields: a deep merge of options needs a second syntax to remove a shared option on one target and is harder to review.
- `lookup` re-points a lookup resource. No managed type references one yet, so `plan` blocks such a resource with reason `override` and `compare` reports it `unknown`.

**Provenance** is merged from `hubspot/blueprints.lock.json` by the loader. No record means authored by hand.

**Blueprints** are `blueprint/1` JSON fragments of groups and properties in IR form, validated by `validateBlueprint`. Nothing in them runs. Why: an agency adds a blueprint to thirty client repos, and `add` must never execute third-party code; as data, the prefix becomes a rename over addresses and `$ref`s. `kalup add <path | https URL>` checks integrity against the lock (same source and version with another hash is refused), applies the prefix (none by default: internal names are permanent, and a client should never inherit another agency's prefix), refuses a colliding resource that differs, renders the rest through the canonical writer, records provenance and the stored original, and writes every file through one staged write after the candidate project validates. `kalup blueprint upgrade <name> <source>` merges per unit with the stored original as base, config as local and the new version as remote: an unchanged side takes the other; both changed differently is a conflict kept local and held in the lock until `--take remote`; an upstream removal detaches, never deletes; per-target overrides are untouched. Neither command sends a HubSpot request. Blueprint content will carry MIT or 0BSD so copied files bring no notice obligations.

## 4. Addresses and identity classes

An address is the logical ID of a resource, `<type>:<path>`, used in the IR, state and plans. Paths use HubSpot's caller-set internal names where they exist and a config-chosen slug otherwise. Why: portal IDs differ per target, and a display name is an editable field, not an identity.

```
property:companies/billing_status      group:companies/billing        object:subscription
pipeline:deals/renewals                stage:deals/renewals/won       association:companies/contacts/primary_contact
list:renewals_due                      workflow:renewal_reminder      team:sales_emea
```

The endpoint registry gives each type one identity class:

- **natural**: the caller sets an immutable key (properties, groups, custom objects, pipelines and stages: HubSpot honours pipeline and stage IDs on create, observed 2026-10-01; association labels: HubSpot keeps the `name` sent on create for both type IDs of a label, unique in the portal and never changed, observed 2026-10-05). Matched by key. A custom object's name is its key; HubSpot also assigns it an `objectTypeId`, which a plan carries in `bindings` and every path of its groups, properties and pipelines uses. A stage path has three segments, `<object>/<pipelineId>/<stageId>`; a `name` override on the pipeline renames the middle one on that target. HubSpot keeps pipeline IDs unique across objects and stage IDs unique across one object's pipelines (observed 2026-10-05), so a create whose ID another pipeline or stage holds is blocked `unsupported`, naming the holder.
- **bound**: HubSpot assigns the ID and the name is editable (lists, forms, workflows, teams). State binds address to portal ID per target.

An association label is a pair of type IDs HubSpot assigns per portal, one per direction, sharing one name. The labels lists give the type IDs and the texts, never the name; only the schema reads give each type ID's name, keyed by its direction, since HubSpot numbers its own types like user ones (one test account held a user-defined 279 and a HubSpot-defined 279), and they list a new name only some minutes after the create (observed 2026-10-05). So the state entry of an association records its two type IDs (section 5), which name it before any schema read does, and apply also names it by the type IDs its own create was answered with. A plan carries no type IDs: apply finds them by name, as the read does, with the one pairing pull uses. The name is the identity, never the address's direction: an entry rewritten from the other side is the same association, so state follows the new address (its labels and type IDs swapped), plan neither adopts it nor calls the old address an orphan, a tombstone on the old address is `E_TOMBSTONE_CONFLICT`, and apply refuses a delete config holds under the other direction. Why natural and not bound: the name is set by the caller and never changes, so it holds across portals, and a bound type would need `kalup bind` for every label of every portal.
- **lookup**: never written; resolved per target by name or email (owners, unmanaged teams).

Natural is "bound with a free default", so moving a type between classes is one registry row. The resolution chain before every plan step: the state binding, then the natural key, then for bound types exactly one live resource with the same name. A name match plans `adopt`; several are blocked `ambiguous` with the `kalup bind` fix; none plans a `create` at risk `risky`. Pipelines apply that last rule before bound identity exists: a pipeline or stage create whose ID is all digits is `risky`, because such an ID was assigned by HubSpot in another portal, and on a portal holding the same pipeline under its own IDs the create makes a copy. Its note names the `name` override, and the portal's pipeline with the same label when the read finds exactly one. Only natural types exist today; [hubspot.md](hubspot.md) records the offline proof that `plan/1` and `kalup.state/1` can carry a bound type.

**Three names, three rules.** The TypeScript key is free to change. The label updates in place. The internal name is immutable: a changed internal name is an error with a migration recipe (create new, copy values, repoint references, tombstone old), never a silent destroy and create.

## 5. State

`.kalup/state/portal-<portalId>.json`, format `kalup.state/1`, one file per verified portal. It holds no target name. Why per portal, not per target: a renamed target or two names for one portal would otherwise create a second owner and a second lock for the same resources. Two targets may not pin one portal (`E_DUPLICATE_PORTAL`, exit 3). In a linked git worktree the path resolves to the main worktree, so the worktrees of one clone share state, but only when the main checkout holds the project and ignores its `.kalup/`: state is never written where another checkout would commit it. Separate clones keep separate state. `KALUP_STATE_DIR` overrides the directory. The first `pull` that creates a state file prints its path.

**`state: 'repo'`** puts the files in `<dir>/state/` beside the object files, committed with them, so teammates and CI read the same bases and ownership without a state branch. The trade-off: every apply and every pull that records a base changes a committed file, so two branches that apply to one portal conflict in git. Nothing detects a stale or wrongly merged file: the serial compare-and-swap only catches a change during one command, and a plan's `stateSerial` comes from the same checkout, so an old copy passes and what it lacks returns as adopt steps. The docs say to keep the side that applied last and check it with `state rebuild`. Switching to `repo` does not move the local file; commands warn `W_STATE_NOT_MOVED` while the repo file is missing and a local one exists. The file holds no key, no record data and no portal ID beyond the one in its name. The portal lock, the journal, `.bak` copies and archived files stay local, since git holds the previous versions. The default stays `local` because one repository applying from several machines is the case state was designed around: one authoritative writer per portal. Every read checks the file against `state-1.schema.json` and the verified portal ID (`E_STATE_INVALID`).

```json
{
  "format": "kalup.state/1",
  "lineage": "b0a1c6e2f4d80913",
  "serial": 42,
  "portalId": 2222222,
  "lastApply": { "planId": "pl_7f3a0b1c2d4e", "writesHash": "sha256:7f3a...", "actor": "--approve",
                 "at": "2026-09-21T18:02:11.000Z", "outcome": "done" },
  "resources": {
    "group:companies/billing": { "origin": "created", "id": "billing", "normVersion": 1, "base": { "label": "Billing" } },
    "property:companies/billing_status": { "origin": "adopted", "id": "billing_status", "normVersion": 1,
      "base": { "group": { "$ref": "group:companies/billing" },
                "options": { "active": { "hidden": false, "label": "Active" } }, "optionsOrder": ["active"] },
      "rewrites": { "label": { "sent": "Billing  status", "stored": "Billing status" } } }
  }
}
```

`origin` is `created`, `adopted`, `pulled` or `reference`. `pulled` owns nothing: `pull` recorded the base of a resource no entry owned (below). `id` is the portal name the entry owns, or for `pulled`, names. `base` holds, per owned unit, the value config and portal last agreed on, and may be partial. `rewrites` records units HubSpot stores differently than sent. `typeIds`, on an association's entry only, holds its two type IDs, its direction's first, which name it while HubSpot's schema read does not list its name yet (section 4). `written` maps each unit apply wrote and verified within the settling window before its last write to when it did, so a read in that window that disagrees on the unit is settling (section 8); a unit drops out of it at the next write after its window ended. `writtenAt` is when apply last verified a write to the resource, a create or a change sent, whatever units it named, so a read in that window that does not show the resource is settling; a step that sends nothing keeps it. `lastApply.actor` says how the run was approved (`terminal`, `--yes`, `--approve`), never who. `lineage` changes on rebuild and rebind; `serial` rises with every save.

`FileStateStore` saves atomically: it compares the serial the caller read (`E_STATE_CONFLICT`), validates, skips unchanged bytes, writes a temporary file, fsyncs, keeps one `.bak`, renames and fsyncs the directory. A failed save leaves the previous file intact (`E_STATE_WRITE`).

**Rules.**

1. Safety never depends on state. A missing or stale base makes plan hold and ask.
2. State never lives inside the portal, nor on a working branch unless `state: 'repo'` says so.
3. `apply` and the repair commands (`state rebuild --write`, `target rebind`) write state, and `pull` records bases in it (below). `plan` and `status` only read it.
4. No tokens, record data, unowned fields or unmanaged resources in state.
5. The base moves only where the approved value and the live value agree, read back or observed. Held drift, conflicts and failed steps leave it alone, so an admin's edit stays held across any number of applies. A `normVersion` mismatch makes the base count as absent for one cycle, with no migration code.

**Ownership.** An entry owns a resource only when its origin is `created` or `adopted` and its `id` equals the portal name the address resolves to on that target. An entry recording another name owns nothing there: a `destroy` tombstone on it is blocked `not-owned`, and only a `release` drops it.

**Planning with state**, per managed property, group, pipeline and stage:

| State entry | Portal | Plan |
|---|---|---|
| none | absent | `create` |
| none | present | `adopt`: config's owned values in `desired`; differing units held as `diverged`; agreeing units in `baseUnits` |
| `pulled`, same name | present | `adopt`, each unit classified against the pulled base, so a file edit since the pull is a `config-change` |
| owned | present | `update`: units classified against the base (section 6). No step when nothing is written, held, noted or recorded |
| owned | absent, by a complete read | no step; a `missing` entry with the exits: restore in HubSpot, `kalup rm <address> --release`, or `plan --take config <address>` for a group, or a property HubSpot does not hold archived |
| owned, `destroy` tombstone | present | `delete`, destructive; labelled `existed-before-kalup` when adopted; blocked `policy` without `allowDestroy: true` |
| none or another name, `destroy` tombstone | present | blocked `not-owned` |
| owned or another name, `release` tombstone | any | `release`: drops the entry, no request |
| owned, `destroy` tombstone | absent, by a complete read | `release`, expecting `exists: false` |
| owned, not in config, no tombstone | any | an `orphans` entry naming both `rm` commands, no step |
| any | unreadable | blocked `scope`, action `unknown` |
| none, not in config | present | unmanaged; counted by `status` and `compare`, listed by `pull --discover`. Under takeover, in the pull scope: a `delete` labelled `takeover` (section 7) |

A delete is also blocked `unsupported` when HubSpot marks the property not archivable, when active properties still name the group (archived ones do not block: HubSpot archives a group once every property in it is archived, observed 2026-09-29 and 2026-10-01), or when the resource is HubSpot-defined, calculated or unsupported. A custom object delete archives the schema, and HubSpot refuses it while the object holds records (`EXISTING_OBJECT_RECORDS`, which apply reports). Its tombstone covers everything on the object: no steps and no orphan notes for its groups, properties, pipelines and stages, and apply drops their entries with the object's. A pipeline or stage delete is a purge: HubSpot keeps no archive and has no restore (observed 2026-10-01), and refuses it while a record sits in the stage (`STAGE_ID_IN_USE`, which apply explains with the stage and record IDs HubSpot names). A stage delete is blocked `unsupported` when it would leave the pipeline with no stage or a ticket pipeline with no closed stage, counting what the steps before it leave: the stages they create, the closed states they set and the stages they delete. A pipeline delete expects the full live list of its stages, compared whole, since it purges every one: a stage added in HubSpot since the review stops it stale. A pipeline's tombstone covers its stages: no stage steps and no orphan notes for them, and apply drops their entries with the pipeline's. A tombstone that asks otherwise than its custom object's or its pipeline's (a destroy under a release, or a release under a destroy) is blocked with the reason, never dropped. An association delete is a purge too: a DELETE of either type ID removes both directions, and the records lose that association. A custom object's tombstone covers the associations on either side of it, as HubSpot removes them with the object. A plain association delete is blocked `unsupported` while a label of its pair remains, unless a step before it deletes that label, since HubSpot refuses it. A destroy tombstone on a pipeline or stage of an object whose pipelines Kalup does not write is blocked `unsupported`, with the release fix.

`kalup rm <address>` writes a `destroy` tombstone in `hubspot/removed.ts` and removes the definition; `--release` writes `release`. It works offline, never touches state, refuses a resource with `preventDestroy` (`E_PREVENT_DESTROY`) or one config still depends on (`E_RM_DEPENDENTS`), validates the result and writes through one staged write. `kalup rm object:<name>` removes the export, every pipeline export on the object, and each file left empty, and writes one tombstone that covers all of it, refusing a destroy while anything on the object sets `preventDestroy`; validate refuses an object tombstone while config holds anything on the object (`E_TOMBSTONE_CONFLICT`), and apply refuses the archive then (`E_PLAN_DELETE`); `kalup rm pipeline:<o>/<id>` removes the export, and the file when it was the last one, and writes one tombstone that covers the stages; `kalup rm stage:<o>/<p>/<s>` removes the entry and refuses the pipeline's last stage or a ticket pipeline's last closed stage (`E_PIPELINE_STAGES`), which HubSpot refuses too. `kalup rm association:<from>/<to>/<name>` removes the entry from `associations.ts`, and the file when it was the last one; `kalup rm object:<name>` also removes every association entry on either side of the object.

**Lost state.** `kalup state rebuild` reports, read-only, which config resources the portal holds, which are missing, and which entries are stale. `--write` runs only at a terminal, refuses an incomplete read, takes the portal lock, archives the current file and writes a new lineage that adopts every config resource the portal holds, with a base where config and portal agree. Lost for good: the `created` origin and the direction of fields that differ now. On a portal with no state, the first plan adopts instead, as reviewed steps.

**Recreated sandbox.** `kalup target rebind <target> --portal <id>` runs only at a terminal, accepts only `DEVELOPER_TEST` and `SANDBOX` accounts, refuses a portal another target pins, takes both portal locks in ascending order, writes the new portal's state as a rebuild does, rewrites the pin in `kalup.config.ts` and archives the old file.

**Coordination.** `apply`, `state rebuild --write`, `target rebind` and a `pull` that may record bases take a lock named by the verified portal ID in a per-user directory (`~/.kalup/locks/portal-<id>.lock`, or `KALUP_LOCK_DIR`), created exclusively and recording process, host, command, plan and start time. Kalup never waits and never takes a lock over: a lock file that exists is `E_LOCKED`, naming the holder and the file, even when its holder has ended. A person deletes a lock left by a crashed command, only when no Kalup command is running on the host it names. An unwritable directory is `E_LOCK_DIR`, never a fallback into the project. The lock serializes cooperating writers of one user on one machine, across clones, worktrees and target names; it does not coordinate other users or machines. Behind it, a plan binds the state lineage and serial (`E_STATE_CHANGED`) and every save compares the serial.

**CI.** One repository and workflow is the authoritative writer for a portal. It runs in a concurrency group named by the portal ID, never cancels a run in progress, keeps state on a branch `kalup-state/portal-<id>` checked out where `KALUP_STATE_DIR` points, applies a reviewed plan with `--approve`, and pushes state and uploads state and journal whether or not apply succeeded. A rejected push is a recovery incident after possible side effects, never a lock. GitHub keeps one waiting run per group and cancels it when a newer one queues; the newer run plans what both merged and applies only if that matches its own reviewed digest. The recipe is in the several-portals guide. It ran on GitHub Actions on 2026-10-05 (kalup 0.3.0, a developer test account as the protected target): reviewed plans applied and the state branch advanced, a stale review stopped at `E_APPROVE_MISMATCH` and a delete at exit 4, both writing nothing. The local commands that read the state branch, and a delete at a terminal from it, have not run against a real state branch.

## 6. Classification

A unit is one owned top-level field or one part of the options: `options[<value>]` (membership), `options[<value>].label`, `.hidden` and `.description`, and `options.order` (the order of options both sides hold). `requiredProperties` and `searchableProperties` compare as sets. A pipeline's `stages` is an order unit like `options.order`: the order of the stages both sides hold, with its own base, so a stage added on one side never makes the order differ. A stage is its own resource, with `label` and its metadata field as units. `classify` in the engine is shared by plan, pull and apply's trusted checks.

| Base for the unit | Config vs base | Live vs base | Class | Default |
|---|---|---|---|---|
| any | config equals live | | `converged` | none; recorded in `baseUnits` when the base is missing or differs |
| yes | changed | same | `config-change` | write |
| yes | same | changed | `drift` | hold |
| yes | changed | changed | `conflict` | hold |
| none | config differs from live | | `diverged` | hold |

A field the files leave out while HubSpot holds what omitting it means (`description: ''`, `formField: false`, `hasUniqueValue: false`, `hidden: false`, `displayOrder: -1`, `dataSensitivity: 'non_sensitive'`, on a number `numberDisplayHint: 'formatted'` and `showCurrencySymbol: false`, an option's empty description) is agreed at that value: `advanceBase` records it whenever it records a base (pull, apply, rebuild), unless the base holds a value for it already. Why: pull leaves such a field out of the file, so a description added after `init` is config's move, a `config-change`, where it would otherwise be `diverged` and held. A value set in the UI is not the default, so it is never recorded this way, and a field the files state that the portal does not agree on (a unit held at adoption) stays out of the base and stays held. Agreement is recorded, never inferred from what the base lacks.

Option members, `additive` being the default:

| Member | Result |
|---|---|
| in config, not live, not in base | `add`, written, safe |
| in config, not live, in base | `drift`: removed in HubSpot, held |
| in live, not in config, not in base | kept, noted with the `pull` command |
| in live, not in config, in base | kept, noted: add it to `removedOptions` to remove it |
| in `removedOptions` or under `exact`, in live | `remove`, risk `risky`, because records keep the stale value; `destructive` and labelled `takeover` when only takeover made the options `exact` |

HubSpot replaces the whole options array on update, so apply builds the payload from a fresh read plus the approved changes. A held order is never reverted to make room for a new option.

**Hold and its exits.** A held unit is reported with both exits and not written. Held units never block other units or resources: the rest of the step and every other step still plan and apply. The portal side is `kalup pull --only <address>`, or `kalup pull --accept <address>#<unit>` for a conflict or an option HubSpot removed; a held unit carries no pull command when no pull would take it (a shadowed name, a builder that does not take the portal's type, a group in `hubspot/removed.ts`), and a note says why. The config side is `plan --take config <address[#unit]>` (the address may hold `*`), which writes the held units at risk `risky`, labelled `reverts-ui-edit` for drift and conflicts and `overwrites-portal` for a `diverged` unit, which config and the portal never agreed on, so nothing is reverted. A target with `drift: 'overwrite'` writes `drift` and `conflict` units labelled `reverts-ui-edit`; one with `adopt: 'overwrite'` writes `diverged` units labelled `overwrites-portal`, risky, so `--yes` never covers them: a stated policy for rolling a blueprint onto a client portal. No policy recreates a missing resource. A unit in `rewrites` whose live value is the stored one becomes a note and is never written again. `ignoreChanges` fields are set on create, then unowned.

**Pull with a base.** For a resource whose owning or `pulled` entry has a base, pull classifies each unit as plan does: `drift` and `diverged` take the portal value; a `config-change` keeps the file's value; a `conflict` keeps it too and counts as a difference for `--exit-code`; an option HubSpot removed stays in the file. `--accept <address[#unit]>` takes the portal side of those units.

**Pull records the base** (`recordPulled` in `engine/pull-base.ts`) for the target it pulled. After the files are written, and only after a complete read, it advances the base over every unit the files and the portal now agree on, a field the files leave out at HubSpot's default included, for the addresses `--only` selects, as `advanceBase` does after an apply: under the portal lock, taken before the read, with the serial compare-and-swap. An owning entry keeps its origin. An address no entry owns gets a `pulled` entry, which owns nothing: the next plan still proposes the adoption, as a reviewed step, but classifies against that base. `--check` and `--discover` record nothing. Why not adopt: an adoption widens what Kalup owns, which counts toward `yesLimit` and lets a tombstone delete, so it stays a step a person or a reviewed job approves; pull runs without either. Why record at all: without a base, an edit made after `init` or a pull would be `diverged` and held, and a pull that took the portal side of drift would leave a stale base, so the next file edit would be a `conflict`.

## 7. Plan

Format `plan/1`, with a published JSON Schema closed at every level and `validatePlan` in the engine. `kalup plan` validates every plan before printing or writing it (`E_PLAN_SCHEMA` is a bug). A plan is self-contained: apply uses the saved plan, trusted policy, credentials, state and fresh observations, never current config or IR. Why: approval must bind to exactly what was reviewed.

```json
{
  "format": "plan/1",
  "planId": "pl_3f9a1c07b2e4",
  "generator": { "name": "kalup", "version": "0.1.0" },
  "target": { "name": "production", "portalId": 2222222, "accountType": "STANDARD", "uiDomain": "app-eu1.hubspot.com",
              "protected": true, "drift": "hold", "allowDestroy": false },
  "stateLineage": "b0a1c6e2f4d80913",
  "stateSerial": 42,
  "normVersions": { "group": 1, "object": 1, "property": 1 },
  "bindings": {},
  "counts": { "safe": 1, "risky": 0, "destructive": 0, "blocked": 0, "manual": 0, "held": 1 },
  "writesHash": "sha256:3f9a1c07b2e40b7e...",
  "steps": [
    {
      "id": "s1",
      "address": "property:companies/billing_status",
      "action": "update",
      "risk": "safe",
      "transport": "public-api",
      "api": { "family": "crm.properties", "version": "2026-09" },
      "title": "Update property \"Billing status\" (billing_status) on companies, add options \"Reseller\"",
      "desired": { "label": "Billing status", "group": { "$ref": "group:companies/billing" }, "fieldType": "select",
                   "options": [{ "value": "active", "label": "Active" }, { "value": "reseller", "label": "Reseller" }] },
      "changes": [{ "unit": "options[reseller]", "class": "config-change", "op": "add",
                    "before": null, "after": { "value": "reseller", "label": "Reseller" } }],
      "held": [{ "unit": "label", "class": "drift", "config": "Billing status", "live": "Billing state",
                 "resolve": { "portal": "kalup pull --target production --only property:companies/billing_status" } }],
      "expect": { "exists": true, "values": { "fieldType": "select", "options": [{ "value": "active", "label": "Active" }],
                                              "type": "enumeration" } }
    }
  ]
}
```

**Header.** `planId` is `pl_` plus 12 hex characters of `writesHash`. `target` holds the verified `portalId`, `accountType` and `uiDomain` and the effective policy: `protected` (from config, else true for every account type except `DEVELOPER_TEST`, `SANDBOX` and `APP_DEVELOPER`, so an unknown type fails closed), `drift` and `adopt` (else `hold`), `allowDestroy` (else `false`), `yesLimit` (else 25) and `takeover`, the objects whose mode on the target is takeover. `stateLineage` and `stateSerial` are `null` when there is no state. `normVersions` maps each resource type to the normalizer version used. `bindings` lists, for every effect step, each address whose portal identity is not its logical key: `{ name }` for a name override, `{ id }` for a custom object's type ID. Also: `irHash` (display only), `counts` by risk plus `held`, `permanentNames` (creates on a `STANDARD` portal, whose internal names can never change), `budget` (`estimatedCalls`, `dailyRemaining`), `preflight.limits`, `coverage`, `notCovered` (once per type, what HubSpot has no API for), `orphans` and `missing`. No tokens, no expiry, no timestamps.

**Steps.** Ordered objects, groups, properties, pipelines and their stages, associations, then releases, then deletes. Each carries `address`, `action` (`create`, `adopt`, `update`, `delete`, `release`, `manual`, or `unknown` for an unreadable resource), `risk` (`safe`, `risky`, `destructive`, `blocked`, `manual`), `transport`, `api` (its registry row's family and version; none on a release), `title` in HubSpot UI wording, and `expect`: `exists`, and for a write the live value of each field it sets (the full live options when any option changes, plus the live `type` and `fieldType` a PATCH carries). `desired` holds config's owned values in logical form (`$ref`s resolved at apply). `labels` are `reverts-ui-edit` (writes over a value HubSpot moved, or recreates), `overwrites-portal` (writes a `diverged` unit), `takeover` (an archive or option removal takeover asks for) and `existed-before-kalup`. `baseUnits` lists units apply records without writing. `changes[]` are `{ unit, class, op, before, after }` with `op` `set`, `add` or `remove`. `held[]` are `{ unit, class, config, live, base?, resolve? }`, `base` from state when it holds one for the unit. `blocked` is `{ reason, detail, blocks[], fix? }`. A pipeline create carries `stages[]`, `{ address, desired }` for each config stage it creates in the same request, in order, since HubSpot refuses a pipeline with no stage; those stages get no steps of their own, and apply records an entry for each from the read-back, with any unit HubSpot stored otherwise in `rewrites`. A pipeline step whose stage order changes or is held carries `stageLabels`, the label of each stage the order names: display only and outside the digest, so the plan text shows a stage order by label, never by IDs HubSpot assigned in its UI. Each stage the order names is a dependency of the step, so a stage's `name` override is among the step's `bindings`, and apply moves the stage by its portal ID.

Blocked reasons: `limit`, `scope`, `dependency-blocked`, `no-credential`, `ambiguous`, `override`, `unsupported`, `not-owned`, `policy`, `settling`. `limit` comes from a Limits Tracking reading, never a subscription tier. Why: HubSpot reports usage and headroom, not entitlements, so a tier would be a claim Kalup cannot back.

**Blocking rules.** Only managed config resources of type object, group, property, pipeline, stage and association are planned, plus the tombstones' steps. The first rule that matches decides: a `skip` gives no step and an `excluded` entry; a `lookup` override blocks with `override`; an unreadable object blocks with `scope`; a blocked parent blocks its dependents with `dependency-blocked`; an unsupported property (the fix makes it a `p.string` reference) or label-less schema blocks with `unsupported`. An absent resource is blocked when its `name` override finds nothing (`override`), when HubSpot holds an archived property of that name (`unsupported`: a create would restore it), when it is a custom object whose name HubSpot holds archived or in another case, or whose display fields name a property HubSpot will not hold (`unsupported`, below), or when a limit has no room (`limit`); otherwise it is a `create`. A present resource is blocked `unsupported` when HubSpot holds it as HubSpot-defined or calculated, when its `type` or `hasUniqueValue` differs (with the migration recipe), when a written unit has no update in the write matrix, or when HubSpot marks the definition or options read-only. Otherwise it is an `adopt` or `update`.

**Pipelines and stages.** A pipeline is a stage's parent, and a custom object is its pipelines' parent. Kalup writes the pipelines of deals, tickets and custom objects, the ones the live runs wrote. **Objects whose pipelines are read only**: contacts and companies (their lifecycle pipelines), appointments, services, listings, courses, orders and leads are read and compared, never written: a create is blocked `unsupported` and a unit that would be written becomes a note with the reason. A stage create in an existing pipeline goes after the highest live `displayOrder`, a free slot, so nothing renumbers; when the creates would not leave config order (a new stage before one HubSpot holds, or new stages that apply creates in another order: closing stages first, then by address), the pipeline's step also sets the `stages` order. A pipeline create whose every stage a `skip` override leaves out on the target is blocked `override`. A deal or ticket pipeline create notes the other object's pipelines when the plan did not read them, since HubSpot keeps pipeline IDs unique across the two and only then names the holder. Risk: a create is safe unless its ID is all digits (section 4); a label, `displayOrder` or order update is safe; a change of `probability`, `ticketState` or `state` is risky, because it moves how existing records count in forecasts and in open and closed reports; a delete is destructive. A pipeline create on a custom object with no pipeline yet carries a note: HubSpot adds the HubSpot-defined properties `hs_pipeline` and `hs_pipeline_stage` to the object for good (observed 2026-10-05). Takeover never archives a pipeline or a stage in this release. `notCovered` names what HubSpot has no API for: stage required properties, conditional stage properties, pipeline automation and pipeline permissions.

**Custom objects.** A custom object is its groups', properties' and pipelines' parent. A create is one step on `object:<name>`, because one step per address is what the planner and apply key on. HubSpot refuses a display field naming a property it does not hold, and the object's properties cannot exist before the object (hubspot.md, "Custom object schemas 2026-09"). So apply creates the schema bare: its name, labels and description, and its primary display property when that is one HubSpot gives every custom object, else `hs_object_id`. Its groups and properties then run with the type ID the create returned, and once every property step has run, apply's display step (section 8), one full schema PATCH, sets the display, required and searchable fields the bare create could not. HubSpot also makes the group `<name>_information` with the object, and pull writes that group into the object file once an in-scope property sits in it, so a project pulled from one portal and applied to another plans its create. Apply gives that group config's label instead, in one PATCH or none, once the run's own create has returned the object's type ID: only that answer, never the plan file, tells apply the group is the create's, and the group step's note says so. State records that group `adopted`, since HubSpot made it, so a delete of it carries `existed-before-kalup`. The create's notes say what HubSpot adds to a new object and which fields wait for the display step. HubSpot answers a create of an active schema's exact name with that schema, so a create answered with a type ID a schemas list read in the run held, or with a schema the list shows made before the answer (hubspot.md), made nothing: apply reports it `uncertain`, keeps no type ID for it and runs nothing on the object. An update is one full schema PATCH. A create is blocked `unsupported` when HubSpot holds an archived schema of that name, since the create would purge it with its records in the recycle bin and its labels; when HubSpot holds an active schema whose name differs only in case, since names are unique ignoring case; and when a display field names a property neither the portal holds nor the plan creates. An update writing such a field is blocked the same way. A property whose create the plan itself blocks (a limit, say) does not count as created: plan decides objects before their properties, so a second pass blocks such an object step `dependency-blocked`, naming the property, and what is on the object follows it. `kalup rm object:<name>` removes the export, with every property, group and pipeline the files define on the object, and writes one tombstone; that tombstone covers everything on the object, so plan makes one destructive step, apply archives the schema, and the entries of what is on it go with the object's. The archive step says what goes with it, by count, in its title and in the confirmation: the object's own properties, its groups and its pipelines (plan reads the pipelines of an object removed.ts names), and that HubSpot keeps no properties on an archived custom object. The counts sit in the step's `expect` as `takes`, all three, so they are approved with it: a plan file without them is `E_PLAN_INVALID`, and plan blocks the archive `scope` when the key cannot read the object's pipelines, since it cannot count them. Apply's read after approval must find the same three counts, else `E_PLAN_STALE` before any write. HubSpot refuses the archive while the object holds records, and apply reports that. Kalup never purges, and takeover never archives a custom object. Risk: a create and every update are safe (display fields change forms and record views, not values); a delete is destructive.

**Associations.** An association's parents are its two objects: a step waits on a custom object the plan creates on either side, and an unreadable pair blocks it `scope`. A plain association config gives a label, or a label config holds as a plain association, is blocked `unsupported` and refused by apply: what HubSpot does with a label written on a plain association's type is unobserved and could relabel every association of the pair, so the fix is a new entry under another name. A create HubSpot would refuse is blocked `unsupported`: a label text another association of the pair shows from the same object (ignoring case, as validate compares), a second plain association on a pair that holds one, or a label the pair has room for only once a delete in this plan has run; since deletes run last, the fix is to apply the delete first and plan again. A create answered with types the pair's lists held right before it is `uncertain`, and nothing is recorded as created. A create sends the name and both labels, or an empty label for the plain association; apply creates a pair's plain association before its labels. A label created on a pair with a custom object and no plain association makes one too, under a name HubSpot picks (observed 2026-10-05): when the plan creates no plain association there, the step notes it, and pull writes it once an object of the pair sets `associations: true`. An update sends both labels, since a PUT without the inverse label puts the label on both sides (observed 2026-10-01). Risk: a create and an update are safe; a delete is destructive, as records lose the association: the title and the confirmation say records lose that label, or for a plain association every association between them. A delete expects the labels the read found, whatever the base holds, so it is titled, ordered and confirmed as what HubSpot holds. Plan reads the association label counts of Limits Tracking for the pairs it creates labels on, one reading per direction HubSpot lists (`association-labels/<from>/<to>` in `preflight.limits`), and warns `W_LIMIT_HEADROOM` when the fuller direction has less room than the creates: never a block, since HubSpot counts a label deleted in the last 40 seconds. HubSpot refuses the 51st label of a pair with HTTP 437, which apply reports as a refusal. Takeover never deletes an association in this release. `notCovered` names association limits, the most records one record may have under a label (section 13).

**writesHash.** Approval binds to a canonical digest of the verified destination, the effective policy, the state lineage and serial, the normalizer versions, the relevant bindings, and every step with an effect: its writes, expected live preconditions and ownership effects (an adoption, a release and a base-only update change what state owns even when no request goes out). `writesHash` is `sha256:` of `stableStringify` of that approval context (`approvalContext` in `engine/digest.ts`). Titles, risk, classes, `before` values, counts, held values, notes, coverage, budget, `irHash`, the generator and step ids stay out, so presentation changes never void an approval; apply checks ids and risk separately.

**Strings.** Structured values keep exact normalized strings: `desired`, `changes`, `held`, `expect`, bindings, comparison units, snapshot resources. `sanitize` applies to human text only (titles, `blocked.detail` and `fix`, `Issue.message` and `fix`, printed output): it strips ANSI sequences, controls, line separators and bidirectional overrides, and caps the length. Why: sanitizing data would make a plan write a label the portal does not hold and let compare call different values equal. Plan never prints a command whose result is destructive.

**Plan text** (`planText`) renders from the `plan/1` document alone, so every host prints the same: a `Settings:` line from `target` (the mode per object, `adopt`, `drift`, `allowDestroy`, `yesLimit`), and under each step its writes as `unit: portal -> config`, `+ option` and `- option`, a create's label, group, `fieldType` and options, and each held unit's class with config, portal and base. Every value it prints is in the document, except one project fact the host may pass: the targets the project declares, so that in a project of several targets a step holding a `diverged` unit adds a `shared:` line naming the `definition` override that keeps the portal's values on one target, since a pull writes the file every target shares. Any `diverged` unit adds a line naming `adopt: 'overwrite'` and `--take config` with a glob. The coverage line counts `skipped` resources, `coverage.excluded`: what a `skip` override leaves out. `plan --exit-code` exits 2 when `planPending` finds anything: a step with an effect, a blocked or manual step, a held unit, a `missing` entry, or an incomplete read; the text's last line names them, blocked steps included. An incomplete read counts because what the unread objects need, takeover's archives included, is unknown. Orphans and notes do not count, as unmanaged addresses do not for `compare`. Why: a blocked step is work a person has not done, and a CI check that passes over it hides it.

**The approval contract** (`engine/approval.ts`). A plan with no effect exits 0 with no question. Otherwise approval comes from exactly one of:

1. **A person at a terminal**: stdin and stderr are terminals, no `--json`, `CI` unset. Apply prints the target, portal, account type, protection and each effect step with a title redrawn from step data, then asks for the target name, and for the number of destructive steps when there are any. It covers any plan.
2. **`--yes`**: an unprotected target, no step risky or destructive, at most the target's `yesLimit` writes, adoptions and releases (25 by default; `0` turns `--yes` off).
3. **`--approve <writesHash>`**: a reviewed CI job. The digest must equal the saved plan's (`E_APPROVE_MISMATCH`). The target must name its own `credentials.write`, read from the process environment only; a `.env` that defines it is refused (`E_APPROVE_CREDENTIAL`), because the key is then on this machine. It covers protected targets and risky steps, never a delete or an option removal takeover asks for, which only the person approves, typing the number of destructive steps too.

Otherwise apply exits 4 with `humanRequired` (`E_APPROVAL_REQUIRED`) and the exact command for a person to run. No fix text suggests `--approve`. Without a plan file, a protected target applies only for a person at a terminal, who reads the plan made in that run and confirms it there; with no terminal, apply stops after the guard, before it plans (`E_PROTECTED_SAVED_PLAN`, exit 4), and its fix points CI at a saved plan. Why this shape: pasting a write key at every production apply puts the friction on the admin least able to absorb it and invites pasting the key into an agent chat, and an environment variable such as `CI` proves nothing about review. The honest limit: `--approve` shows the writes equal a digest someone reviewed, not that a review happened; its boundary is custody of the write key in a CI environment limited to the protected branch. An agent with a shell on the same machine can read any key there, so the terminal confirmation is an interlock against an over-eager agent, not a wall against a hostile one.

**What apply checks.** `kalup apply <plan.json>` reads the saved plan and `kalup.config.ts`, and for a delete also `hubspot/removed.ts` and the object files as data. Config can refuse a plan but never changes what it writes. It sends every request, reads included, with the write key (`credentials.write`, else the read key). Before any write, in order:

1. Schema, step numbering, unique effect addresses, and each change's `after` equal to the step's `desired` (`E_PLAN_INVALID`); the recomputed digest (`E_PLAN_DIGEST`); the release line that made the plan (`E_PLAN_VERSION`).
2. The plan's target is still declared and pins the same portal (`E_PLAN_DESTINATION`); no other target pins it (`E_DUPLICATE_PORTAL`).
3. The write key passes the portal guard (`E_TARGET_PORTAL_MISMATCH`, exit 4).
4. Unchanged policy, `takeover` included (`E_POLICY_CHANGED`); each step's API row, pin expiry and normalizer versions (`E_PLAN_VERSION`); name bindings and custom object type IDs match config and the portal (`E_BINDING_CHANGED`); every delete has a `destroy` tombstone or takeover's leave, is out of config and not protected by `preventDestroy`, and a delete labelled `takeover` has takeover's leave whatever removed.ts says (`E_PLAN_DELETE`). A plan that deletes or removes an option loads the object files as data for this, and to tell takeover's option removals from config's own.
5. Approval.
6. The portal lock (`E_LOCKED`). Under it, state is read again: a plan whose `writesHash` equals `lastApply.writesHash` with outcome `done` prints "Already applied" and exits 0; otherwise a changed lineage or serial is `E_STATE_CHANGED`.
7. A fresh read of every object an effect step touches: a 403 is `E_INCOMPLETE`; a step whose `expect` no longer holds, or whose create name is now archived, is `E_PLAN_STALE`.
8. Trusted code (`engine/derive.ts`, shared with the planner) derives each effect step's blocked status, risk and labels. A blocked step, a higher risk than stated or an omitted label is `E_PLAN_RISK`. A delete no entry owns runs only as a takeover archive of a managed, non-HubSpot-defined resource, and every takeover removal needs `allowDestroy`. A delete labelled `takeover`, owned or not, is a property or a group on an object in takeover mode on the plan's target that removed.ts neither names nor covers, so it is never a custom object, a pipeline, a stage or an association; without the command's takeover rules apply runs none. A takeover archive meets the planner's rules against this read (`takeover.ts` `keptByRead`): never a property in a group a `skip` override covers or one its custom object schema names, and never a group that held no property; a delete no tombstone asks for must carry the `takeover` label (`E_PLAN_DELETE`). A create on an owned address runs only as a recreate: labelled `reverts-ui-edit`, absent in this read, and for a property not archived. A custom object step writes display fields naming only properties HubSpot gives every custom object, properties this read found on the object, or properties the plan creates there.
9. Three calls per write plus the reads made must fit in half the daily remainder (`E_BUDGET`); with no daily figure, `W_RATE_HEADERS`.

`kalup apply [--target <name>] [--take config <selector>] [--yes]` without a file plans with the write key and applies through the same checks, like `terraform apply`: at a terminal it prints the whole plan before the confirmation. Saved plans stay for review and CI; `plan --out` with no file writes `.kalup/plans/<target>-<planId>.json`. Why: a saved plan made every production change a two-command ritual for the admin, while the terminal confirmation is what guards it either way.

**Takeover.** `mode: 'addon' | 'takeover'` resolves per target and object (`engine/settings.ts`): `targets.<t>.objects.<o>`, then `targets.<t>`, then `objects.<o>`, then the top level, then `addon`. A target `mode` that differs from an object's, where the target says nothing more about that object, is `W_MODE_SHADOWED`. Under takeover, plan archives each custom property and group a complete read found in the object's pull scope that config lacks and `hubspot/removed.ts` does not name (`engine/takeover.ts`): a `delete` labelled `takeover`, with a `mode` note naming the statement, after the tombstones' deletes, properties before groups. It never archives a HubSpot-defined or calculated property, a kind Kalup does not write, anything an object file lists, a name `exclude` covers or a name override reads, a resource a `skip` override covers or a property in a skipped group, or a property a custom object schema names; a group only when every property HubSpot holds in it goes with it, since HubSpot marks no group as its own. `lifecycle.options` defaults to `exact` there, unless the property or the target's override states it; its option removals carry the `mode` note too, and one `Takeover on` heading precedes the first takeover step. Every takeover removal is destructive: blocked `policy` without `allowDestroy` (the fix leads with the `pull --only` that keeps it in config, then `exclude` or additive options, then `allowDestroy`), blocked `scope` when the read was not complete, and approved only by a person at a terminal. HubSpot refuses to archive a property something uses (400, observed 2026-09-29 and 2026-10-01); apply reports its answer and names each use HubSpot lists. Why a mode and not per-resource flags: a portal accumulates properties nobody owns, and takeover lets config be the whole truth for a scope while `allowDestroy` keeps each portal's consent separate. `pull` ends with a note on what takeover would archive once the files are as it leaves them.

## 8. Engine, execution and HubSpot I/O

**Normalize.** Each resource type turns live JSON into canonical attrs: drop server-only fields, sort keyed sets, replace portal IDs with refs, and keep observable defaults needed to compare owned fields. It is a pure function of the raw response and a reverse ID index, so fixtures test it offline. A sloppy normalizer makes phantom drift, which costs trust faster than missing drift detection does.

**Observation.** One read pipeline serves `pull`, `snapshot`, `compare` and `plan` (`lib/pull/read.ts`, wrapped by `engine/observe.ts`). Per object it lists properties once per `dataSensitivity` value, because HubSpot lists only non-sensitive definitions by default, and merges the lists. A 403 on any list or the groups list makes that object `unreadable` (`E_SCOPE`) and the rest continue; a 403 on the schemas list makes every custom object unreadable; any other error fails the command. Absence is proven only when all lists succeeded. A name holding whitespace forms no address and is left out with `W_UNADDRESSABLE_NAME`. That warning, for a property, and `W_UNSUPPORTED_TYPE` are raised only for a property in the pull scope or named in the files: the rest of the portal is no concern of the project, and a portal with hundreds of HubSpot-defined phone and coordinate properties made every command noisy. `statusOf(observation, address)` answers `present`, `absent`, `unreadable`, `unsupported`, `excluded` or `not-observed`. An object's pipelines come from one more list, read only for an object in pipeline scope (section 2): the list holds every stage, has no paging and is not sorted, so the normalizer orders pipelines by `displayOrder` then ID and stages by `displayOrder`. A 403 on it makes the object's pipelines `unreadable` and leaves its properties as read. A pipeline or stage of an object whose pipelines were not read is `not-observed`. Each pair in association scope is read from its two labels lists, one per direction, and each object of a pair from its schema read, once per object, never per pair, and only for a pair whose lists hold a user-defined type (the companies schema is about 400 KB): the lists give type IDs and texts, the schema reads the names by direction, and one name pairs the two type IDs of a label. A labels request needs the read scope of both its objects, which plan and apply both name. HubSpot's own associations and labels are left out. A 403 on a labels list makes the pair `unreadable` and leaves the objects' properties as read; an association of a pair that was not read is `not-observed`.

**Settling** (`engine/settling.ts`). For some minutes after a write HubSpot may serve an older copy of what was written: a custom object schema's fields from before a PATCH, a schemas list without a custom object just created, a schema read without a new label's name for about 5 minutes (live runs, 2026-10-05). So apply records, per state entry, each unit it wrote and verified and when (`written`), and when it last wrote the resource at all (`writtenAt`, section 5), and a read of a target takes the verified portal's state, as plan follows it (followAssociations), and the time the read began. Within 5 minutes (`SETTLE_MS`, longer than every lag observed) after a write, a read that shows another value than the base on a unit apply wrote, or does not show a resource apply wrote, makes the resource settling, whatever the entry's origin and whatever `removed.ts` asks: `coverage.settling` names it with `stale` or `missing` and the time it ends, `statusOf` answers `unreadable`, `coverage.complete` is false, and `W_SETTLING` says until when. What the entries own under a custom object the read leaves out that way, or on a pair with it, settles with it, since that read saw none of it. What is under a resource settling on an older copy is read as ever and waits on no step of it, a display field naming it included: HubSpot holds the parent. A write time ahead of the reading clock counts as now, and one more than `SETTLE_MS` ahead is a wrong clock and settles nothing, so a clock running fast where apply ran cannot hold a resource settling for its skew. Every command then treats a settling resource as unknown: `plan` blocks its step with reason `settling` and never creates, deletes or writes it, a destroy tombstone's release or delete included (a release tombstone still releases: it never rested on the absence); `pull` keeps the file's side of it as for an address `--only` leaves out, records no base for it, and `--check --exit-code` counts it as pending; `compare` reports it `unknown` and says when to compare again, or for a snapshot side when to take a new snapshot; `snapshot` records it and says when to take the next one. A type HubSpot lists between two objects that its schema read does not name yet settles the same way: unknown on that pair, `W_SETTLING`, and a `settling` block. Both leave `coverage.complete` false, which keeps its meaning, and neither stops a command that does not act on what they leave unknown (`listsRead`, `waitingOn` in `engine/observe.ts`): takeover blocks its removals on an object only while a property or group of that object settles (reason `settling`, plan again after the time it names), and never for an unnamed type, since it deletes no association; `state rebuild --write` and `target rebind` refuse only while something config names settles or may be an unnamed type, and say when to run again. A list the read could not read still stops all three, as before. A difference on a unit apply did not write in that window is drift as ever, and after the window the read is believed again. Why: a plan right after an apply showed what apply had just verified as held drift, and the pull it suggested would have copied the older copy into config; nothing in HubSpot's answers tells an older copy from a new edit (both carry the same `updatedAt`), so the window is the only evidence, and it errs toward waiting, never toward writing or deleting. Apply's own reads need no window: a step runs only when a plan decided it, a settling resource gets no step, and a step whose `expect` an older copy breaks stops as stale.

**Preflight**, before any plan or apply: account-info, whose `portalId` must equal the pin (`E_TARGET_PORTAL_MISMATCH`, exit 4; the fix never says to change the pin, and names `target rebind` only for a recreated test portal or sandbox). It records `accountType`, `uiDomain` and time zone. Limits Tracking is read for `custom-object-types` when the plan creates a custom object, for `custom-properties` when the plan creates a property, and for `pipelines` when it creates a pipeline (a standard object against its own entry, custom objects against the overall figure). Headroom is `limit - usage`; no room blocks each create it covers with reason `limit` and a `skip` fix; less room than creates is `W_LIMIT_HEADROOM`; an unreadable reading blocks nothing and warns `W_LIMIT_UNREADABLE`, because HubSpot's answer on portals without the feature is undocumented. Archived property names are read so a create of one is blocked: it would restore the archived property. Archived schema names are read when the plan creates a custom object, for the same reason: such a create purges the archived schema. A create of an archived group's name makes a group with the new label (observed), so nothing blocks it. Write scopes are not verified in advance by plan or apply. `status` reports them: its list probes stay the read-scope check, since they test the real request and not Kalup's scope-name table, and on top of them it posts the key to HubSpot's token-info endpoint (`POST /oauth/v2/private-apps/get/access-token-info`), which returns the scopes the key holds. That is the one request whose body carries the key, sent to the same host the `Authorization` header already reaches; it is registered as a read, no code logs or journals request bodies, and when it fails `status` falls back to the probes alone. With an answer, `status` checks the limit scope and, when the write key is the read key, each write scope by name; a separate write key is never resolved, so its scopes stay unchecked.

**Executor rules** (`engine/apply.ts`). Under the lock, apply records `lastApply.outcome: running`, then runs effect steps one at a time in a trusted order derived from actions and addresses, never the file's order: custom object creates, groups, properties, the display steps of the custom object creates (below), custom object updates, pipeline creates, stage creates and updates (those that leave a stage closed first, so a ticket pipeline always keeps a closed stage), pipeline updates (label, `displayOrder` and stage order, after that pipeline's new stages exist), plain association creates, label creates, label updates, releases, label deletes, plain association deletes, property deletes, group deletes, stage deletes, pipeline deletes, custom object deletes. A delete runs only when every step before it is `done`. A rejected or uncertain step does not stop independent later steps; deletes wait. A step with no write records ownership and base from the fresh observation. For each step that writes:

1. Read the resource again (a property singly, with its `dataSensitivity`; a group through the list; a pipeline or stage through the single read of its pipeline, which carries every stage; a custom object through the schemas list, since the single read lags; an association through both labels lists of its pair, named by the schema read of its `from` object, read once per run, else by the type IDs state records or the run's create was answered with). A 404 is "not found by this query", never proof of absence. A mismatch with `expect` stops the run before this write (`E_PLAN_STALE`).
2. Build the payload from that read (`engine/apply-payload.ts`). A create is `toCreatePayload`. A property PATCH carries exactly the approved units, the live `type`, and the live `fieldType` unless the step sets it. When any option changes, it carries the full live list with the approved edits, new options after the highest live `displayOrder`. A schema PATCH carries all seven fields it takes, from that read with the approved changes applied, since a PATCH of some fields can set the others back to older values. A label PUT carries the type ID of its direction and both labels, the approved over that read's; an association delete sends the type ID of its direction.
3. Send it once. A non-daily 429, a 423 or a 477 is waited out: read again, compare, rebuild and resend, three times, then stop (`E_RATE_LIMIT`). A daily 429 stops at once (`E_DAILY_LIMIT`). Any other 4xx is `rejected`; after a rejected create Kalup reads again, and a resource that is present makes the step `uncertain`. A custom object create answered with a type ID the run already knows is `uncertain` too: HubSpot answers a create of an active schema's name with that schema. A timeout, network failure, 5xx or non-JSON 2xx is `uncertain` and never resent. Why: HubSpot documents no idempotency keys, so a retried create can collide with the first attempt and a retried options list can undo an edit made in between.
4. Read back, 250 ms doubling to 8 s, until 60 seconds. The step is `done` when every written unit reads back as approved (for a delete, the property reads archived, the group has left its list, the custom object shows `archived: true` in the list read with `archived=true`, never merely missing from a list, or the pipeline read no longer holds the pipeline or stage, or neither labels list of the pair holds the association's type IDs). A pipeline or stage is always read back with a GET: a write response echoes the spelling sent, keys HubSpot then drops and a stale `isClosed` (observed 2026-10-05). A stage DELETE answers 204 for anything, a stage that never existed included, so only that read proves the delete. An acknowledged write whose read-back differs is `unverified` (`W_UNVERIFIED`) and the unit goes to `rewrites`. With no evidence by the deadline, an acknowledged write is `unverified` and any other `uncertain` (`E_UNCERTAIN_WRITE`).
5. Save state after each step that changes an entry, advancing the base only over units that read back as approved. A failed save stops the run (`E_STATE_WRITE`). The entries of steps that send no request (a release, an adoption or update with nothing to write) wait for one save, made before the next request goes out or at the end of the run. Why: a crash before that save loses nothing the portal holds, since the next plan proposes those steps again, and one save per step made the first adoption of a 600-property portal take ten seconds, growing with the square of the count.

The run ends with `lastApply.outcome` `done`, `uncertain` or `partial`. Each step reports `done`, `unverified`, `uncertain`, `rejected`, `stale`, `not-run` or `blocked`, a blocked one with the plan's `reason`; the text, `Nothing to apply` included, ends with `N blocked, not run:` and each address, reason and detail, so a blocked step is never silent, and with `N held units, not written:` and the plan command that shows them, so a held unit is not either. Exit 0 when every effect is done (also for "already applied" and nothing to apply); 5 when a write that may have landed was sent or a state entry changed, and not every effect verified; 1 when a check refused or nothing landed; 3 for invalid config; 4 for the guard, missing approval and the `--approve` credential rule. The first SIGINT or SIGTERM stops before the next request, saves state and releases the lock; a second exits at once with 5.

**The display step.** A custom object create sends the bare schema (section 7), and the display, required and searchable fields config states that name the object's own properties wait for them. Apply derives one more step from each such create, from the create step alone, so a plan file can neither add one nor drop one: id `<create id>.display`, the same address, action `update`, `changes` the fields the bare create left at HubSpot's defaults, from those defaults to config's values. The plan document keeps one step per address; the display step exists only in apply's run order, after every property step and with the schema updates. `steps[].id` keeps meaning one report per plan step: the display step reports inside the create's report as `display` (`outcome`, `units`, `issue`), on an indented line under the create in the text, while the create's own `outcome` stays the create's and the run's outcome and exit code count both. It runs through the same write path as any update: the full schema PATCH from a read made right before it, sent once, read back. It waits on the create and on each property it names; when one did not finish, it reports `not-run` and sends nothing. Its success advances the base of its own units only, in the entry the create saved; its failure leaves the create's report and entry as the create left them, so the base still holds HubSpot's defaults and the next plan writes config's values as an update. Because the schemas list can leave out an object it showed seconds before, or show it as it was before a write (hubspot.md), the display step reads the list again until the read-back deadline when the object is missing, and its read-back, like that of HubSpot's own group, waits for a change from the read made right before the write: a lagging copy of what the create made is never taken for what HubSpot stored. Only a 400 that says a named property does not exist is tried again; any other refusal is final. The budget counts it as a write.

**The stage order write** is one of two writes of several requests; the other is a custom object create with its display step (above). HubSpot never stores two stages at one `displayOrder`: a write to a taken slot places the stage right after the stage that held it and renumbers the pipeline 0 to n-1, while a write to a free slot moves only that stage (observed 2026-10-05). So with D the order the step leaves (config's stages in config order, a stage only HubSpot holds kept after the stage it follows now), apply moves each stage that is not right after its predecessor in D onto that predecessor's slot, one PATCH each, each sent once, and reads the pipeline before each move; it is done when a read shows D. A label or `displayOrder` change of the pipeline goes first, in one PATCH. Nothing follows a request whose outcome is uncertain, and a wait counts against the step's retries. Once a request of the step has landed, the retry's read no longer meets the step's `expect`, so the step stops stale and the report says to plan again, which shows what is left. Why not a pipeline PUT: it hard-deletes every stage it does not name (observed 2026-10-01), and a stage made in the UI since the plan would go with it.

A read-then-write is not atomic with edits in the HubSpot UI: an edit that lands between the precondition read and the write is overwritten for that unit. Rebuilding the payload after every wait narrows the window; nothing closes it.

**Journal.** `.kalup/journal/portal-<id>/<planId>-<time>.jsonl`, one line per request, fsynced before the next: plan, digest, portal, approval mode, time, step, address, method, registry path template (never a URL), status, HubSpot's `category`, `subCategory` and `correlationId`, outcome and duration. It refuses a line that contains a key and never holds a body or an email address (`E_JOURNAL_WRITE`).

**Recovery.** No rollback and no resume: recovery is a new plan, and every unfinished run prints `kalup plan`. A crash leaves `outcome: running`, and the next plan warns `W_UNFINISHED_APPLY`. A resource an interrupted create made is present with no entry, so the next plan adopts it: a reviewed adoption, never a claim Kalup created it. Why: a pending marker proves intent, not that a request landed.

**The write matrix** (`engine/derive.ts`, from HubSpot's update schemas as live runs confirmed them). A property update may set `label`, `description`, `group` (as `groupName`), `formField`, `fieldType`, options, `hidden`, `displayOrder`, the number and text display fields and `calculationFormula`; a group update, `label` only; a pipeline update, `label`, `displayOrder` and the stage order; a stage update, `label` and its metadata field (a metadata PATCH keeps keys it does not send); a custom object update, every field of its definition; an association label update, `label` and `inverseLabel` (a plain association has no update). `readOnlyDefinition`, `readOnlyOptions` and `archivable: false` block the affected change. Risk: create safe, recreate risky, delete destructive, release safe; an update is risky when it removes an option, sets `fieldType` or `calculationFormula` (either rewrites record values), or writes a held unit. Apply runs a property whose step writes a formula after the other property steps, and after the formula properties it names, since HubSpot refuses a formula naming a property it does not hold yet.

**HTTP.** `createWriteHttp` in `lib/http.ts` is the read client plus `send`, which sends only the writes its allowlist names (create, update and delete of properties, groups, pipelines, stages, custom objects and association labels, never a pipeline or stage PUT and never a write with a query, so never a schema purge; anything else is `E_WRITE_NOT_ALLOWED` before a request), sends each once and maps every answer to `ok`, `rejected`, `wait` or `uncertain`. Every attempt times out after 30 seconds. Reads retry a 429, 5xx, timeout or network failure up to three times, never a daily 429. One token bucket per run adapts to the rate-limit headers and falls back to 8 requests per second.

**Credentials.** `credentials.read` and optional `credentials.write` per target, each `{ env }`. Service keys first; a legacy private app token is accepted while they exist. Writes use `credentials.write` when named, else the read key, and `apply`, `state rebuild --write` and `target rebind` send every request with that key, so it needs the read scopes too. Read commands never resolve the write key. A key holding a character a header cannot carry is `E_KEY_INVALID`, naming the variable, never the value.

**Endpoint registry** (`lib/registry.ts`). One row per resource type, as data, keyed by type, plus path-only rows for `accountInfo` and `limits`. Why: HubSpot versions its REST paths by date (`/crm/properties/2026-09/...`), ships a version every March and September with 18 months of support, and changes behaviour between versions, so each type needs its own pin and expiry.

```ts
interface RegistryRow {
  identity?: 'natural' | 'bound' | 'lookup'
  family: string                               // 'crm.properties'
  version: string                              // '2026-09'
  status: 'ga' | 'beta' | 'legacy'
  expires: string                              // '2028-03'
  paths: Record<string, { method: string; path: string; tag: 'read' | 'write' }>
  scopes?: { read: string[]; write: string[] }
  limitKey?: string                            // Limits Tracking key checked in preflight
  auth?: 'account' | 'user'
  delete?: 'archive-restorable' | 'guarded' | 'permanent' | 'none'
}
```

Read mode allows `read`-tagged paths of any method (listing lists is a POST). A step's transport comes from its row: `ga` with a write path is `public-api`, `beta` is `public-beta` behind a per-type flag, no write path is `runbook`. Every plan warns when a pin is within 90 days of expiry; a twice-yearly pass bumps pins. HubSpot's OpenAPI specs are marked proprietary: clients are hand-written and no spec-derived code enters the repo.

**Transports and runbooks.** Much of what an admin configures has no public write API (record page layouts, saved views, conditional property logic, stage required properties, pipeline automation, permission sets). The design names three transports: `public-api`, `public-beta` and `runbook`, a `manual` step with the exact URL, fields, values and a verify check in HubSpot UI wording. Every plan prints, once per type touched, what the API cannot copy. Why: a plan silent about what it cannot do misleads more than a wrong label. Not built yet: runbook types, `kalup attest`, and the `RunbookExecutor` seam, which may fulfil a runbook step but has no delete action, no credential field, and needs a disclosure the person confirms on first use per target.

**Reference resolution.** Refs are logical in config, base and normalized live, and resolved per target at apply time: state binding, IDs created earlier in the run, lookup (owner by email, team by name). An unresolved ref blocks that resource only and prints the `kalup bind` fix. Not built yet: the resolver for bound types, `RefSite` catalogs for IDs inside opaque payloads, and `bind`.

## 9. Command surface and the machine contract

| Group | Commands |
|---|---|
| Set up (offline) | `init` |
| Read a portal and check files | `pull`, `validate`, `ir`, `fmt`, `status` |
| Compare and document | `compare <a> <b>`, `plan`, `snapshot`, `docs` |
| Write | `apply [plan-file]`, `rm <address> [--release]`, `state rebuild [--write]`, `target rebind` |
| Reuse | `add`, `blueprint upgrade` |

`diff` and `drift` are docs recipes over `compare`, not verbs.

**compare** (`engine/compare.ts`). Each side is `config`, a declared target (read now), or a snapshot file. Direction: `a` is desired, `b` observed; a change's `before` is `b`'s value. An address only an observation holds, against config, is `unmanaged`, never a difference. A side that could not read an object makes its addresses `unknown`. An incomplete comparison is exit 1 with `E_INCOMPLETE`, whatever the flags; otherwise `--exit-code` makes any difference exit 2.

**Target selection.** A command that needs one target resolves it after config loads, through `selectTarget` in the engine: `--target <name>` (undeclared is `E_UNKNOWN_TARGET`, exit 3), else `defaultTarget` (undeclared is `E_DEFAULT_TARGET`, exit 3), else the only target, else a selector at an interactive terminal, else `E_TARGET_REQUIRED` (exit 1) listing the choices. No targets is `E_NO_TARGETS`. Nothing is remembered between invocations and the first declared target is never chosen. A saved plan applies to the portal it names. Why: a target is just a name the user chose for a pinned portal, so names never decide protection, drift policy or order; declaration order is an accident of editing; a remembered active target is hidden state; and exit 1, not 4, because an agent can pass `--target` once the user says which.

**The envelope.** Every command takes `--json` and prints exactly one `envelope/1` on stdout, including usage errors, `--help` and `--version`.

```ts
interface Envelope<T = unknown> {
  format: 'envelope/1'
  ok: boolean
  data?: T                  // left out when the command has none, never null
  issues: Issue[]
}
interface Issue {
  code: string              // stable, for example 'E_NOT_DATA'
  message: string           // plain HubSpot terms, may be reworded
  file?: string
  line?: number
  configPath?: string
  fix?: string              // one imperative sentence, or the exact command
  docs?: string             // path of the bundled docs page
  humanRequired?: boolean   // an agent must stop and hand this to the person
}
```

An issue on an `ok: true` envelope is a warning or a recorded scope gap. `ok` alone never means verified equality. Third-party strings never reach `fix` or `message` unsanitized.

| Exit | Meaning |
|---|---|
| 0 | Done. Includes differences found and manual steps pending |
| 1 | Error |
| 2 | Differences pending, only with `--exit-code` |
| 3 | Config or IR invalid |
| 4 | Nothing can proceed without a person |
| 5 | Partial apply. Run `plan` again |

**Agent-native by design.** Why: agents read any non-zero exit as failure, follow any command printed in output, read portal text as instructions, and pass any flag they know. So differences are exit 0 unless `--exit-code` asks; fix hints never tell an agent to switch off a safety check; no command prompts without a TTY (it exits 4 with `humanRequired` and the command for a person to run outside the agent harness); portal and blueprint text is data, never instructions.

**What `init` writes.** `init` needs no key and sends no request; `pull` is the first command that reads the portal. It writes `kalup.config.ts` with one target (`--target`, default `production`) pinned to `--portal`, or pending without it: a target with no `portalId`, which `validate` warns about (`W_PENDING_TARGET`), the IR leaves out, and every command that would contact HubSpot for it refuses (`E_PENDING_TARGET`, exit 3). No `protected`: the account type decides until config says otherwise. Then the folder with an empty barrel, gitignore lines for `.kalup/` and `.env`, a formatter ignore for `hubspot/`, `kalup.config.ts` and `.kalup/` (the first pull records bases there), in a monorepo in the `.gitignore` and formatter config it finds up to the repository root (the first directory with `.git` or a workspace file) with paths from there, and AGENTS.md with an index of the bundled docs and the agent rules: change config and run `kalup plan`, never write to the portal through HubSpot's own tools or the API yourself (after a quick change the user asked for there, run `kalup pull`); apply only to targets the user names; never pass `--approve`; when a command exits 4, show the user the command it prints. CLAUDE.md gets `@AGENTS.md`. No SKILL.md: agents skip skills in more than half of runs, and every harness reads AGENTS.md. Before a project file is overwritten, the old one is copied to `.kalup/history/<timestamp>/`; credential files never enter history.

## 10. Packages and boundaries

| Package | Holds | Runtime dependencies |
|---|---|---|
| `@kalup/core` | What user files and apps import, and nothing else: codecs, `defineObject`, `defineCustomObject`, `p`, `InferProperties`, `PropertyName`, `propertyNames`; `defineConfig`, `defineRemoved` and the config types (`KalupConfig`, `Target`, `ObjectScope`, `Override`, `Definition`, `KalupRemoved`, `Tombstone`) | none. No HTTP, no file system. The app imports it at run time |
| `@kalup/engine` (private, never published for now) | The grammar reader and writer; `loadFiles`, `validate`, `effectiveResources`, `selectTarget`; IR, plan, state and blueprint types, validators and JSON Schemas (`schemas/`); `parseState` for state text; blueprint parsing, prefixing and the lock rules (`parseBlueprint`, `prepare`, `checkIntegrity`, `parseOriginal`); `classify`, `advanceBase`, `toCreatePayload`; the issues table; the brand constant; the HTTP clients, the registry, pull, the planner, trusted derivation, executor and rebuild (`src/engine/`, `src/lib/`). No `process`, terminal, oclif or file system: the executor takes its state store, portal lock, journal, clock and sleep as arguments (`ApplyDeps`), and the HTTP client takes its fetch and warning sink | `@kalup/core`. Bundled into the CLI's dist, so the published `kalup` never depends on it |
| `kalup` (bin `kalup`) | The oclif command layer; `load(dir)`; the envelope; the bundled `docs/` pages; the JSON Schemas as `kalup/schemas/<file>`; keys from the environment and `.env`; the file-backed state store, portal lock, journal and staged writes; blueprint sources on disk or at a URL. No library entry | `@kalup/core`, `@oclif/core` |

**oclif owns the command shell.** Parsing, command discovery and generated help run on oclif; thin adapters in `src/host/commands.ts` hand plain values to handlers in `src/commands/`, and the host owns output, error translation and exit codes without ending the process. Each command accepts only its own flags (`E_USAGE`). Why: maintaining a home-grown parser and help registry grows with every command. The rule that keeps it contained: core and engine never import oclif or load project code.

Rules enforced by tests: no engine source imports `node:fs`, `node:os`, `node:child_process`, `node:readline`, `node:tty` or oclif, or reads `process` or the console, and its bundle imports only `@kalup/core` and `node:crypto`; core has no runtime dependency, imports nothing, never calls `fetch` and exports only the app runtime and the config authoring surface; the CLI's dist imports only `@kalup/core`, `@oclif/core` and Node's built-ins; the read client rejects any write-tagged path; the write client sends only allowlisted writes; nothing imports HubSpot's OpenAPI specs.

**Known limit of `ApplyDeps`.** The host contracts are synchronous and shaped around files: `StateStore.read` and `write`, `Journal.append` and the lock's `release` return values, not promises, and `StateStore.path`, `Journal.path` and the `state.path` and `journal` fields of the apply result are file paths. A hosted service that keeps state and the journal in a database cannot implement them. Before the cloud milestone, the `StateStore` and `Journal` methods and `release` become promise-returning and each path becomes an opaque location string. The pure orchestration still in the CLI's `pull` and `rm` commands (merging pulled files, placing new ones, finding tombstone dependents) moves to the engine in the same milestone.

CLI, MCP and a hosted service use the same planner and executor, with credentials, approval and state supplied by the host. Terminal prompts stay in the CLI. A future MCP server has no `approve` tool, has `apply` off by default, and is never available for protected targets. No database-specific types belong in core or the engine.

## 11. Brand and licence

**The name is Kalup**, always "Kalup: configuration as code for HubSpot". Why: HubSpot's trademark, partner and marketplace rules ban names that combine "Hub" or "HubSpot" with another word or abbreviate its marks, and a rule-breaking name hands HubSpot the cheapest takedown route. "HubSpot" appears only as a plain-text descriptor with a capital S; no `hs` in package or binary names, no HubSpot orange or sprocket imagery. The brand string lives in one constant, in the engine's `brand.ts`. The README, the docs footer and `kalup --version` carry the disclaimer: "Kalup is an independent open-source project maintained by Scopious. It is not affiliated with, endorsed by, or sponsored by HubSpot, Inc. HubSpot is a registered trademark of HubSpot, Inc."

**Licence: Apache-2.0**, with a Developer Certificate of Origin on contributions and no CLA. Why: agencies adopt the open core only if they trust it stays open. Apache-2.0 adds a patent grant and a trademark clause over MIT; a CLA is what made other projects' relicensing possible. Blueprint content will be MIT or 0BSD. The README carries the stays-free promise word for word; it is permanent, and a feature that runs locally or in CI can never move to a hosted service only. A hosted service charges for what a laptop cannot provide: shared state with locking and history, and scheduled snapshots.

**Before anything is published**, in order: a formal trademark search on EUIPO TMview and USPTO for classes 9 and 42, then registering npm `kalup` and the `@kalup` scope, the GitHub org and the domain. The name is accepted subject to that search, which has not been done yet. It is a 0.1.0 release gate.

**Public claims follow released functionality.** Docs say what is built and what is planned, and a HubSpot behaviour nobody has tested live stays labelled unverified. An observation on the developer test account counts for every account type (founder ruling, 2026-10-01).

## 12. Contracts

[compatibility.md](compatibility.md) defines what is stable: JSON output, exit codes, issue codes, the config grammar, commands and flags, and the document formats with their schemas. Human-readable text is not. Saved plans apply only under the release line that made them.

## 13. Not built yet

Association limits (the most records one record may have under a label, `maxToObjectIds` per type ID: writable with `batch/update` and `batch/purge`, live runs 2026-10-05), associations between two records of one object, and takeover of associations; lists, forms and workflows; custom objects in blueprints and a custom object purge; pipeline writes on objects other than deals, tickets and custom objects, pipeline takeover and pipelines in blueprints; bound resources, `bind` and the resolver for them; runbook types, `attest` and executors; `{ keychain }` credentials and user-level OAuth; the full typed CRM client; language generators; an MCP server; a hosted service. Each gets conformance evidence and recovery tests before its writes ship. For any asset that can send messages or trigger automation, such as a workflow or a list that feeds one, creation and activation are separate operations, and a config restore does not undo effects on records or recipients.
