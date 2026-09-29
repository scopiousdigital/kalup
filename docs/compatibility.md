# Compatibility

Within a major version, Kalup's contracts change only by addition: a project, a script or a saved document that works with 1.x keeps working with every later 1.x. Removing or reinterpreting anything waits for a major release, which ships a JSON transform or an error that names the change to make. This page lists what the promise covers and what it does not. Anything it does not list is not a contract.

**Status.** The contracts freeze when 1.0.0 is published. Until then, in 0.x releases and release candidates, any of them may change in a minor release, and that release's changeset says so. [The identity spike](conformance/identity-spike.md) lists one change `plan/1` needs before the freeze.

**Scope.** The promise covers what this version supports: properties, property groups and custom object schemas (custom objects are read and compared, never written), and the commands below. Features the docs describe as not built yet (`bind`, `attest`, runbook steps, executors, pipelines, lists, workflows) are not covered, even where a schema already names a field for them.

**Deprecation.** Anything a major release removes is deprecated first. For at least one minor release before the removal, using it still works and returns a warning issue that names the replacement.

## Config files

Covered:

- `kalup.config.ts`: `export default defineConfig({...})` with `name`, `prefix`, `defaultTarget`, `objects` (per object: `custom`, `include`, `as`) and `targets` (per target: `portalId`, `protected`, `drift`, `allowDestroy`, `credentials.read.env`, `credentials.write.env`, and `overrides` by address with `skip`, `name` and `definition`).
- Object files under `kalup/objects/`: the grammar in [config.md](../packages/cli/docs/config.md). That is the `defineObject` and `defineCustomObject` exports and their type lines; the `p.*` builders with `.required()`, `.readonly()` and `.managed(false)`; the definition fields `label`, `group`, `fieldType`, `description`, `options` (`value`, `label`, `as`, `hidden`, `description`), `hasUniqueValue`, `formField` and `lifecycle` (`options`, `removedOptions`, `ignoreChanges`, `preventDestroy`); and a custom object's `labels`, `primaryDisplayProperty`, `requiredProperties`, `searchableProperties` and `secondaryDisplayProperties`.
- `kalup/removed.ts`: `export default defineRemoved({...})`, one tombstone per address with `action` (`destroy` or `release`) and an optional `reason`.
- `kalup/blueprints.lock.json`, the `blueprints-lock/1` document below, and the stored originals under `kalup/.blueprints/`, which are `blueprint/1` documents. `kalup add` and `kalup blueprint upgrade` write them; people do not.

A minor release may add a field, a builder or an allowed value. A file that uses one this version does not know is refused with a config issue that names it, exit 3: `E_NOT_DATA` for a field or value, `E_UNKNOWN_BUILDER` for a builder, `E_BAD_CHAIN` for a chained call, `E_OVERRIDE_DEFINITION` for a field in a target's definition override, and the like. It is never read with the addition ignored. A project written for a newer minor release therefore fails loudly on an older CLI; when that is the cause, upgrade the CLI.

A major release that removes a field or changes what one means ships a JSON transform over the config files, or an error that names the field and the edit to make.

Not covered: the exact text `fmt`, `pull`, `add` and `rm` write. The canonical form (order, quotes, line breaks) may change in a minor release. Its changeset says so, and `kalup fmt --check` then lists the files to rewrite.

## The command line

Covered:

- **Commands**: `init`, `pull`, `validate`, `ir`, `fmt`, `status`, `compare`, `plan`, `snapshot`, `docs`, `apply`, `rm`, `add`, `blueprint upgrade`, `state rebuild` and `target rebind`, and the root flags `--help`, `--version` and `--json`.
- **Flags and arguments**, as `kalup <command> --help` lists them. Each command accepts only its own flags; any other is `E_USAGE`, exit 1.
- **Exit codes**:

  | Exit | Meaning |
  |---|---|
  | 0 | Done. Includes differences found and manual steps pending |
  | 1 | Error |
  | 2 | Differences pending, only with `--exit-code` |
  | 3 | Config or IR invalid |
  | 4 | Nothing can proceed without a person |
  | 5 | Partial apply: run `plan` again |

- **Issue codes**: every `E_` and `W_` code is a stable identifier with a page under `docs/errors/` in the `kalup` package. A code keeps its meaning. Its `message` and `fix` may be reworded in any release, so match on `code`, never on text. A minor release may add codes.
- **`--json`**: exactly one `envelope/1` document on stdout per invocation, usage errors, `--help` and `--version` included, and nothing else on stdout. Its fields are `format`, `ok`, `data` (left out when the command has none, never `null`) and `issues`, each issue with `code` and `message` and, when they apply, `file`, `line`, `configPath`, `fix`, `docs` and `humanRequired`.
- **`data`**: the fields in the table below.

Within `envelope/1` a minor release may add fields to the envelope, an issue or `data`, and may add a value to a set of values such as a step `outcome` or a change `kind`. Read the fields you need and ignore the rest; treat a value you do not know as something a person should look at.

Not covered: human text on stdout and stderr (reports, plan text, help, prompts), the wording of messages and fixes, and `data` fields the table does not name.

### `data` by command

| Command | Fields you may rely on |
|---|---|
| `init` | `target`, `portalId`, `account` (`portalId`, `accountType`, `uiDomain`, `timeZone`), `objects`, `scopes` (`scope`, `neededFor`), `files`, and `pull` with the first pull's `data` (absent when that pull failed) |
| `pull` | `target`, `portalId`, `files`, and `objects` by object key, each with `added`, `changed`, `missing`, `unchanged` and `changes` (`address`, `kind`, and `field`, `before`, `after` when present) |
| `pull --discover` | `target`, `portalId`, `objects`, `properties` |
| `validate` | `valid`, `counts.errors`, `counts.warnings` |
| `ir` | The `ir/1` document. Absent with `--check` |
| `fmt` | `changed` |
| `status` | `config` (`valid`, `counts.objects`, `counts.properties`, `counts.groups`) and `targets`, each with `name`, `portalId`, `keyVariable`, `check`, `scopes` (`scope`, `ok`, `neededFor`, `error`), `state` (`path`, `exists`, `lineage`, `serial`, `lastApply` with `planId`, `at` and `outcome`, `error`), and `default`, `account`, `protected`, `protectedBy`, `reason` when present |
| `compare` | `a` and `b` (`kind`, and `name`, `portalId`, `file`, `observedAt` as the side has them), `complete`, `counts` (`differs`, `equal`, `excluded`, `onlyA`, `onlyB`, `unknown`, `unmanaged`), `differences` (`address`, `status`, and `changes`, `held`, `notes`, `reason` when present) |
| `plan` | The `plan/1` document |
| `snapshot` | `file`, `target`, `portalId`, `observedAt`, `complete`, `counts` (`objects`, `groups`, `properties`) |
| `docs` | `markdown`, or with `--out`, `file` |
| `apply` | `planId`, `target` (`name`, `portalId`), `approval`, `outcome`, `steps` (`id`, `address`, `action`, `outcome`, and `issue`, `units` when present), `state` (`path`, `serial`, `changed`, or `null`), `journal` |
| `rm` | `address`, `action`, `files`, and `from`, `previous` when present |
| `add` | `blueprint` (`name`, `version`, `source`, `hash`, `prefix`), `dryRun`, `files`, `objects`, `resources` (`address`, `sourceAddress`, `status`, and `units` when present) |
| `blueprint upgrade` | `from` and `to` (as `add`'s `blueprint`), `dryRun`, `files`, `removed`, `objects`, `held`, `resources` (`address`, `sourceAddress`, `status`, and `updated`, `kept`, `converged`, `conflicts`, `notes` when present) |
| `state rebuild` | `target`, `portalId`, `statePath`, `written`, `found` (`address`, `id`, `units`, `agreed`), `missing`, `stale` (`address`, `id`, `reason`), `excluded` (`address`, `reason`), and `loses` (`bases`, `created`, `dropped`), `archived`, `lineage` when present |
| `target rebind` | `target`, `from`, `portalId`, `accountType`, `statePath`, `lineage`, `found`, `missing`, `stale`, `excluded` (as in `state rebuild`), and `archived` when present |
| `--help` | `usage`, whose text is not a contract |
| `--version` | `name`, `version`, `disclaimer`, `formats` |

## Documents

Each document Kalup writes or reads has a format version and a JSON Schema that `@kalup/core` ships and exports as `@kalup/core/schemas/<file>`, for example `@kalup/core/schemas/plan-1.schema.json`. `kalup --version --json` lists the formats a version reads and writes in `data.formats`, so a tool can check before it relies on one.

| Format | Document | Schema |
|---|---|---|
| `ir/1` | The IR `kalup ir` prints, and a snapshot: an `ir/1` document with `generator.frontend: 'portal'` and an `observation` block | `ir-1.schema.json` |
| `plan/1` | A plan: `kalup plan --out` and the `data` of `kalup plan` | `plan-1.schema.json` |
| `kalup.state/1` | State, `.kalup/state/portal-<portalId>.json` | `state-1.schema.json` |
| `blueprint/1` | A blueprint (`blueprintVersion: 1`) | `blueprint-1.schema.json` |
| `blueprints-lock/1` | `kalup/blueprints.lock.json` (`lockVersion: 1`) | `blueprints-lock-1.schema.json` |
| `envelope/1` | The `--json` output, above | None; the fields above |

Within a format version every document an earlier release wrote stays valid, and changes are additive only where the schema is open:

- **Open**: the top level of an `ir/1` document, each IR resource, and `x` fields anywhere they are allowed. A new optional field may appear within the version, and readers keep fields they do not know.
- **Closed**: `plan/1`, `kalup.state/1`, `blueprint/1` and `blueprints-lock/1` at every level, apart from the free-form values a plan step carries in `desired` and `expect.values` and a state entry carries in `base` and `rewrites`; and everything below an IR resource, except its `x` and the `definition` of a resource type `ir-1.schema.json` does not describe. That definition stays open until a later `ir/1` release describes the type, which the [identity spike](conformance/identity-spike.md) relies on. An older reader refuses a field it does not know, so a new field, or a new value in a fixed list such as a plan `action`, is a new format version.
- Anything else, such as a removed field or one that means something new, is a new format version too.

Some fields are reserved for work that is not built: in `plan/1`, `manual`, `fulfilment`, `expect.revisionId`, `expect.baseHash` and the blocked reasons `no-credential` and `ambiguous`; in `kalup.state/1`, `via`, `baseHash` and `attested`. This version never writes them. They stay valid, and their meaning is settled when the feature that writes them ships. A target override's `lookup` in `kalup.config.ts` is reserved the same way: it is read, validated and carried into the IR, but `plan` blocks the resource it names and `compare` reports it unknown, since this version manages no lookup resources.

## Older and newer documents

Kalup never reads a document of another format version as if it were this one, and never converts one silently. Each refusal names the file, or for a blueprint the source it was read from, the version it found and the version this one reads, and says what to do.

| Document | Refused when | Code and exit | What to do |
|---|---|---|---|
| Saved plan | Its `format` is another plan version, or its `generator.version` is on another release line than the running CLI. Checked first, before the schema and any request | `E_PLAN_VERSION`, 1 | Plan again with this version: `kalup plan --target <name> --out <file>`, review it and apply that file |
| Saved plan | It does not match `plan/1` | `E_PLAN_INVALID`, 1 | Plan again, as above |
| Saved plan | After the portal guard: a step's API version is not the one this version sends, its pin has expired, or a normalizer version differs | `E_PLAN_VERSION`, 1 | Plan again with this version. An expired pin needs a newer release |
| State file | Its `format` is not `kalup.state/1`: a newer version wrote it | `E_STATE_INVALID`, 1 | Use the version of Kalup that wrote it, or a newer one. Keep the file: a rebuild would lose what it records |
| State file | It is not JSON, or it names `kalup.state/1` and does not match the schema | `E_STATE_INVALID`, 1 | Move the file away and run `kalup state rebuild --target <name>`, or restore it from where you keep state |
| Snapshot | Its `irVersion` is not 1 | `E_SNAPSHOT`, 3 | Take the snapshot again with this version, or read it with the version that wrote it |
| Snapshot | It does not match `ir/1` | `E_IR_SCHEMA`, 3, naming the file | Take the snapshot again |
| Blueprint | Its `blueprintVersion` is not 1 | `E_BLUEPRINT_SCHEMA`, 1 | Ask its author for a `blueprint/1` version, or add it with a version of Kalup that reads it |
| Stored original | A file under `kalup/.blueprints/` that matches the lock's hash has a `blueprintVersion` other than 1: another version of Kalup added it | `E_BLUEPRINT_ORIGINAL`, 1 | Use the version of Kalup that wrote it, or a newer one |
| Lock | Its `lockVersion` is not 1: another version of Kalup wrote it | `E_BLUEPRINT_LOCK`, 3 | Use the version of Kalup that wrote it, or a newer one |
| Config files | They use a field, builder or value this version does not know | `E_NOT_DATA`, `E_UNKNOWN_BUILDER`, `E_BAD_CHAIN`, `E_OVERRIDE_DEFINITION` and the like, 3 | Fix the file the issue names; if the project was written for a newer release, upgrade the CLI |

Saved plans are short-lived. A plan applies only under the release line of Kalup that made it and only when it matches `plan/1`. A release line is one major version from 1.0.0 and one minor version before it, since any 0.x minor release may change what a `plan/1` field means. A pre-release is a line of its own. After an upgrade to another line, plan again. From 1.0.0, a plan made by another minor release of the same major applies, subject to the API pin and normalizer checks above.

State is read as is from any older format this version supports; today there is one, `kalup.state/1`. A newer release that introduces another state format keeps reading the older one. An older release refuses the newer one, as the table says.

## TypeScript APIs

Covered, from `@kalup/core`:

- **For the app**: `defineObject`, `defineCustomObject`, `p` and `propertyNames`, and the types `InferProperties`, `Codec`, `Codecs`, `ReadonlyCodec`, `DefinedObject`, `DefinedCustomObject`, `PropertyBuilder`, `RequiredPropertyBuilder`, `ReadonlyPropertyBuilder`, `PropertyEntry`, `EnumValues`, `EnumAlias`, `StandardSchema`, `StandardResult`, `StandardOutput`, `PropertyDefinition`, `GroupDefinition`, `EnumOption`, `EnumReference` and `PropertyLifecycle`.
- **For tools that read Kalup's files**: `loadFiles`, `validate`, `read`, `write`, `IssueError` and the types `Issue`, `Loaded`, `LoadOptions`, `Source`, `Validation`, `ValidateOptions`, `ReadResult`, `ConfigFile`, `ObjectFile`, `RemovedFile`, `ObjectExport`, `ObjectScope`, `Target`, `Override`, `Tombstone`, `Group`, `Property`, `Definition`, `Option`, `LifecycleFields`, `BarrelEntry` and `BuilderKind`. `write` is covered as a function; the text it returns follows the canonical form, which is not.
- **For tools that read Kalup's documents**: `validateIR`, `validatePlan`, `validateState`, `validateBlueprint`, `validateLock`, `parseLock`, `stableStringify`, `escapeJson`, `DEFAULTS`, `LOCK_FILE` and `originalPath`, and the document types `IR` (with `IRResource`, `IRTarget`, `IROverride`, `IRTombstone`, `IROption`, `IRObservation`, `Coverage`, `ObjectCoverage`, `UnsupportedProperty`, `UnsupportedSchema`, `Binding`, `Lifecycle`, `Provenance`, `Ref` and `Address`), `Plan` (with `PlanStep`, `PlanTarget`, `PlanBinding`, `PlanChange`, `PlanHeld`, `PlanNote`, `PlanExpect`, `PlanCoverage`, `PlanMissing`, `PlanOrphan`, `PlanLabel`, `PlanAction`, `Risk`, `BlockedReason`, `LimitReading` and `ManualStep`), `TargetState` (with `ResourceState`, `Base` and `Origin`), `Blueprint`, `BlueprintResource`, `BlueprintLock`, `LockEntry` and `LockHeld`.
- The JSON Schemas, as `@kalup/core/schemas/<file>`: `ir-1.schema.json`, `plan-1.schema.json`, `state-1.schema.json`, `blueprint-1.schema.json` and `blueprints-lock-1.schema.json`.

Covered, from `kalup`: `defineConfig`, `defineRemoved`, and the `KalupConfig` type (with `KalupRemoved`, the type `defineRemoved` takes).

Not covered, though exported, because the CLI's engine uses them and they will change as it does: `toCreatePayload`, whose body follows the API pins, `classify`, `advanceBase`, `specOfBase`, `Rules`, `Spec`, `UnitClass`, `UnitResult`, `effectiveResources`, `OVERRIDABLE`, `selectTarget`, `TargetChoice`, `TargetSelection`, `applyPrefix`, `defaultCodec`, `definitionToIR`, `byCodeUnit`, `address`, `isAddress`, `parseAddress`, `builderKinds`, `FIELD_TYPES`, `HUBSPOT_TYPES`, and `StateStore`, which nothing implements yet. Nor is anything reached by a deep import, or any module of the `kalup` package other than its library entry: command handlers, the engine, the host and the files under `dist/`.

## Not covered

- **HubSpot's behaviour.** Kalup pins each API it calls to a dated version and tracks what HubSpot does in the [conformance record](conformance/hubspot-reference.md). A release may move a pin; a plan saved under the old pin is then refused with `E_PLAN_VERSION`.
- **Human text**: terminal output, plan text, help, prompts and the wording of issues.
- **The canonical form** of the files Kalup writes, as above.
- **Other files under `.kalup/`**: the journal, history copies and the default snapshot paths. Of that directory, only the state file's format is covered.
