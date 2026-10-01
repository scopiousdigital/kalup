# HubSpot behaviour

What Kalup relies on in HubSpot's APIs, what live runs confirmed, what is still unverified, and how to run the live journeys and the conformance runner that check it. Kalup pins API version 2026-09 for properties, groups, custom object schemas, account info and Limits Tracking.

Three labels mark every statement:

- **Documented**: HubSpot's reference or guide says so. Pages retrieved 2026-09-24 from developers.hubspot.com; `REF` is `https://developers.hubspot.com/docs/api-reference/latest`. Each reference page embeds the OpenAPI spec `specs/2026-09/crm-properties-v2026-09.json`, called "spec" below.
- **Observed**: a live run saw it on the developer test account. By the founder's ruling of 2026-10-01, that counts for every account type.
- **Unverified**: nobody has tested it. Kalup never presents it as fact and blocks or warns where it matters.

## Live runs

Both runs are on one developer test account on 2026-09-29, with evidence in [`conformance/runs/`](conformance/runs/). Those four files stay as the record of the first runs. Later runs, of the conformance runner and of the live journeys, write raw evidence to the gitignored `live-runs/` folder, and the live workflow uploads it as a CI artifact. This page cites a later run by its ID and date.

| Run | Key scopes | Result |
|---|---|---|
| [`89b45da9`](conformance/runs/2026-09-29-89b45da9.md) | `crm.schemas.{contacts,companies,deals,custom}.{read,write}` | 45 pass, 6 fail, 4 not applicable. The six failures were Kalup's assumptions, since changed to match HubSpot |
| [`fb6155db`](conformance/runs/2026-09-29-fb6155db.md) | the same plus `crm.objects.companies.read` | 52 pass, 0 fail, 4 not applicable |

Run `2fa7001e` (2026-09-30, the same account, key scopes `crm.schemas.companies.{read,write}` and `crm.objects.companies.{read,write}`) added the `write.companies.field.*` checks for the property definition fields below: 61 pass, 0 fail, 4 not applicable. The same day, a scratch Kalup journey on that account planned and applied one property of each new kind and field (number display fields, a currency number, a text hint, rich text, a phone number, an owner, a boolean, an enumeration with `displayOrder`, a calculation), found the next plan and pull empty, then applied a display change and a formula change confirmed at a terminal. Its first apply created the calculation before the property its formula uses and HubSpot refused it (404); apply now runs formula properties last.

On 2026-10-01 a sweep of live runs on the same account answered the questions this page had left open: pipelines and association labels, restore by recreating an archived name, archiving a property a workflow, a list or a form uses, group restore, sensitive reads, scope introspection, a write-only key, Limits Tracking scopes, `secondaryDisplayProperties` order, the canonical form of a formula, `currencyPropertyName`, formulas over associated objects, reserved name prefixes, read-after-write lag under a burst, the object names the properties endpoints accept, forms on the legacy v3 and the 2027-03 beta APIs, and a pipeline stage holding a deal. Its evidence is in the gitignored `live-runs/` folder, and this page cites it as "live runs, 2026-10-01". Two service keys created in that sweep with `oauth` left off both carried it: HubSpot adds `oauth` to every service key.

The two 2026-09-29 runs passed the Kalup workflow end to end: `pull`, `plan`, saved-plan `apply`, a second plan with nothing to do, drift held after a UI-style edit, `pull --only` taking the drift, and `rm` planning a delete that `apply --yes` refuses. Not applicable in both: a sensitive property read (no sensitive property in the portal), the order of `secondaryDisplayProperties` (fewer than two), a write key missing a scope (no second key), and the delete at a terminal (no person at the terminal).

## What Kalup relies on

| Behaviour | Status | What Kalup does with it |
|---|---|---|
| A single read of an unknown property name answers 404, with or without `dataSensitivity` | Observed (both runs): 404 `OBJECT_NOT_FOUND` | A 404 means "not found by this query", never proof of absence |
| The property list returns only non-sensitive definitions unless `dataSensitivity` is set | Documented; sensitive lists answer 200 (observed) | Lists once per sensitivity value and merges |
| A create answers 201 and HubSpot rewrites nothing Kalup owns | Observed (both runs): every owned field round-trips | Read-back still verifies; a difference goes to `rewrites` with `W_UNVERIFIED` |
| A new property or group is readable within a second | Observed: 250 to 700 ms, single read and list. Ten concurrent creates were all in the list within a quarter second of the last 201, each single read 200 on the first try (live runs, 2026-10-01) | 60-second read-back deadline; this is not a latency guarantee |
| A create of an existing name is refused and changes nothing | Observed: 409 `OBJECT_ALREADY_EXISTS`, `Properties.PROPERTY_WITH_NAME_EXISTS` | After any rejected create, apply reads again; a present resource is `uncertain` |
| A PATCH without `options` keeps them; a PATCH with `options` replaces the list, removing any left out | Observed (both runs) | Sends options only when one changes, then the full live list plus approved edits |
| A `fieldType` change from `text` to `textarea` applies | Observed | Allowed, at risk `risky`; the effect on values is not checked |
| Archiving a property answers 204; the single read then answers 404 without `archived` and 200 with `archived=true` | Observed. A DELETE of a missing name and of an already archived one both answer 404 `OBJECT_NOT_FOUND` with the same message; only `archived=true` tells them apart (live runs, 2026-10-01) | A delete is done when the archived read shows it. A 404 on a delete means "not active", never "never existed" |
| Creating a property with an archived property's name restores that property, with the definition the create posted | Observed (both runs, and 2026-10-01: record values survive the archive and return with the restore; a create with another type retypes the property in place) | Plan blocks such a create: restore in HubSpot and pull, or choose another name |
| Archiving a property something uses is refused | Observed for a calculation property (2026-09-29) and for a draft workflow, an active list and an unpublished form (2026-10-01): 400 `VALIDATION_ERROR`, `PropertyValidationError.CANNOT_DELETE_PROPERTY_IN_USE`. The body lists each use (`errors[].context.parentType`, `parentName`). No public where-used read exists | Apply names each use |
| Archiving a group that holds an active property is refused | Observed: 400, `PropertyGroupError.GROUP_WITH_ACTIVE_PROPERTIES`, error body nested as JSON in `message` | Plan blocks a group delete while an active property names the group; archived ones do not block (observed 2026-10-01: 204) |
| An archived group leaves the groups list | Observed | A group gone from the list counts as deleted; plan cannot see an archived group's name |
| Creating a group with an archived group's name creates a group with the new label | Observed (fb6155db) | Nothing to block |
| Service key answers carry `X-HubSpot-RateLimit-Daily` and `-Daily-Remaining`, plus the interval headers | Observed | Budget check against half the daily remainder; `W_RATE_HEADERS` when missing |
| `crm.schemas.<object>.*` scopes cover every property and group read and write on that object | Observed on companies and a custom object | `init` lists these scopes |
| Limits Tracking `custom-properties` answers 403 to a key with `crm.schemas.*` scopes only, and 200 once one `crm.objects.*` read scope is added | Observed (89b45da9 403, fb6155db 200 with `crm.objects.companies.read`). One `crm.objects.<object>.read` scope of any object answers every Limits Tracking endpoint (live runs, 2026-10-01) | `init` recommends one `crm.objects.<object>.read` scope; an unreadable limit warns `W_LIMIT_UNREADABLE` |
| Limits Tracking `custom-properties` lists standard objects in `byObjectType` | Observed: `0-1`, `0-2`, `0-3`, `0-5`, `0-8` and two custom objects, limit 1,000 each, overall 10,000 | Checks a create against the overall and per-object figures |
| Limits Tracking `custom-object-types` answers with `crm.schemas.custom.read` | Observed: 200, limit 20 | Read when config defines a custom object |
| Account info answers for a service key with `crm.schemas.*` scopes only | Observed; the documented scope is `oauth`, and every service key carries it: HubSpot adds it when the creator leaves it off (2026-10-01) | The portal guard runs on every networked command |
| No idempotency key, `If-Match`, ETag or revision on property and group endpoints | Documented by omission | Uncertain writes are never resent |

## Properties API 2026-09

| Op | Method and path | Success |
|---|---|---|
| List | `GET /crm/properties/2026-09/{objectType}` | 200 `{results: Property[]}`, no paging |
| Read | `GET /crm/properties/2026-09/{objectType}/{propertyName}` | 200 `Property` |
| Create | `POST /crm/properties/2026-09/{objectType}` | 201 `Property`, `Location` header |
| Update | `PATCH /crm/properties/2026-09/{objectType}/{propertyName}` | 200 `Property` |
| Archive | `DELETE /crm/properties/2026-09/{objectType}/{propertyName}` | 204 |
| Batch create, read, archive | `POST .../{objectType}/batch/{create,read,archive}` | 201 or 207, 200 or 207, 204 |

There is no batch update and no restore endpoint. A create of an archived property's name is the API's restore (observed): record values and history return, and the definition is the one the create posted. In the UI, restore is an action on the archived list. Every non-success response is `default: Error` in the spec.

- **Query params.** `archived` (default `false`) and `dataSensitivity` (`non_sensitive`, `sensitive`, `highly_sensitive`; default `non_sensitive`) on list and read. `locale` and `properties` have no documented meaning.
- **Create body.** Required: `name`, `label`, `type`, `fieldType`, `groupName`. `options` is required for enumerations, each with `label`, `value`, `displayOrder`, `hidden` and optional `description`. `type` is one of `bool`, `date`, `datetime`, `enumeration`, `number`, `phone_number`, `string`. Up to ten unique ID properties per object. Calculation properties created by API can be edited only through the API.
- **Response.** Includes `hubspotDefined`, `calculated`, `archived`, `archivedAt`, `updatedAt`, `updatedUserId` and `modificationMetadata { archivable, readOnlyDefinition, readOnlyValue, readOnlyOptions? }`.
- **`archived` can be absent.** A single read of a HubSpot-defined property (`name` on companies) answered without an `archived` field, while custom properties answered `archived: false` (live journeys, 2026-09-30). Kalup treats only `archived: true` as archived.
- **Update.** "Provided fields will be overwritten." A field left out keeps its value (observed). What each field does on create and update is in the next section.
- **Archive.** Archived properties are permanently deleted after 90 days (knowledge base). A property used in "a segment, form, or workflow" cannot be archived (knowledge base; observed 2026-10-01 for a draft workflow, an active list and an unpublished form, with each use named in the body). An asset in HubSpot's trash no longer counts as a use.
- **Admin validation rules.** From 2026-09, HubSpot enforces admin-configured validation on record writes. The changelog's examples are all record writes; its effect on property-definition writes is unverified, most likely none.
- **Errors.** `Error` has `category`, `correlationId` and `message`, optional `subCategory`, `context`, `links`, `errors[]`. Treat every field as optional when parsing. Documented codes include 401, 403 (missing scope), 423 (a lock of 2 seconds), 429, 477 (`Retry-After`) and 5xx.
- **Scopes.** Writes need `crm.schemas.<object>.write` for the object (`crm.schemas.custom.write` for custom objects). Reads accept either `crm.schemas.<object>.read` or `crm.objects.<object>.*`. Creating or editing a sensitive property needs the object's `sensitive.write` scope. `crm.schemas.custom.*` is Enterprise only. A key with `crm.schemas.<object>.write` only creates, updates and archives, but every read answers 403 with a body that names no scope (live runs, 2026-10-01), so a write key needs the read scopes too. Scope introspection exists: `POST /oauth/v2/private-apps/get/access-token-info` with the key in the body returns the key's scope list; sensitive scopes carry a `.v2` suffix there (2026-10-01).

## Property definition fields

Every field of the 2026-09 `Property` response, what HubSpot does with it, and what Kalup does with it. Create and update are as documented in `PropertyCreate` and `PropertyUpdate` and observed in run `2fa7001e` (checks `write.companies.field.*`) unless the row says otherwise. "Managed" means Kalup captures it, compares it and writes it when config states it; a field config leaves out belongs to the portal.

| Field | Create | Update | Kalup |
|---|---|---|---|
| `name` | required | no | the address |
| `label`, `groupName`, `description`, `formField` | yes | yes | managed (`group` for `groupName`) |
| `type` | required | yes (observed: `string` to `phone_number`) | implied by the builder; a difference blocks with a migration |
| `fieldType` | required | yes | managed; a change is risky |
| `options` | required for an enumeration; a `bool` needs exactly `true` and `false` (observed: 400 `INVALID_BOOLEAN_OPTION` without them) | yes, replaces the list | managed on `p.enum` and `p.multiEnum`; a `p.boolean` create sends `Yes`/`true` and `No`/`false` |
| `displayOrder` | yes (default -1) | yes; other properties keep theirs (observed) | managed, `displayOrder` |
| `hidden` | yes | yes | managed, `hidden` |
| `hasUniqueValue` | yes | ignored: 200, value kept (observed) | managed on create; a difference blocks with a migration |
| `dataSensitivity` | yes; `sensitive` without the sensitive write scope answers 403 `Missing required scope for: sensitive-data-property-create` (observed), and with the scope but on a portal with the Sensitive data feature off 400 `PORTAL_NOT_ENABLED_FOR_SENSITIVE_DATA` (live runs, 2026-10-01) | ignored: 200, value kept (observed) | managed on create, read back under that sensitivity; a difference blocks with a migration; no target override |
| `numberDisplayHint` | yes | yes; `null` keeps the value, `''` answers 400; no value removes a hint (observed) | managed on `p.number`; `formatted` means the same as none |
| `showCurrencySymbol` | yes | yes, but never off again once `currencyPropertyName` was ever set (observed: 400) | managed on `p.number` |
| `currencyPropertyName` | only with `showCurrencySymbol: true`, else 400 `ONLY_CURRENCY_PROPERTIES_CAN_SPECIFY_CURRENCY` (observed). The name is not validated: any name, a missing one or the property itself is 201, and `''` is stored as `''` (live runs, 2026-10-01) | the same; `null` and omission keep the value. Once any value was set, `''` included, `showCurrencySymbol: false` is refused for good, and nothing clears the name (2026-10-01) | managed on `p.number`; validate requires `showCurrencySymbol: true` and refuses `''`; plan blocks turning the symbol off once a name was ever set |
| `textDisplayHint` | yes | yes; `''` answers 400 (observed) | managed on `p.string`, `p.stringArray`, `p.json` and `p.phoneNumber` |
| `dateDisplayHint` | ignored (observed); the guide lists it, the spec does not | ignored (observed) | not captured |
| `calculationFormula` | yes; it makes the property `calculation_equation` whatever `fieldType` says, and HubSpot stores a canonical form (live runs, 2026-10-01): keywords and functions lower-cased; strings single-quoted; `+` on strings becomes `concatenate`; `=` becomes `equals`; `!=` becomes `not (x equals y)`; implicit multiplication made explicit (`10a` to `10 * a`); redundant parentheses removed; number literals reprinted (`2.50` to `2.5`, visible on GET only, the create response echoes the sent spelling); a newline before `elseif`. Square brackets and `if(...)` are 400. Only the same object's properties: `TARGET.x` is refused and `calculation_rollup` is not a creatable field type. A formula naming a property HubSpot does not hold yet answers 404 | yes | managed with `fieldType: 'calculation_equation'` on `p.number`, `p.boolean`, `p.string` and `p.enum`; a change is risky; apply runs formula properties after the others |
| `externalOptions`, `referencedObjectType` | yes; `externalOptions` needs a reference type and no options (observed: 400) | `referencedObjectType` ignored (observed) | implied by `p.owner` (`true`, `OWNER`); a difference blocks with a migration |
| `calculated` | returned | returned | a HubSpot-defined property or a custom one with another calculated field type (a rollup) is a reference. HubSpot marks a custom `calculation_equation` property calculated as well (observed), and Kalup manages it |
| `hubspotDefined`, `modificationMetadata` | returned | returned | read as meta: references, `.readonly()`, blocks |
| `archived`, `archivedAt`, `createdAt`, `createdUserId`, `updatedAt`, `updatedUserId`, `sensitiveDataCategories` | returned | returned | not captured (`coverage.notCaptured`) |

Kinds Kalup still does not write, each a `p.string` reference with `W_UNSUPPORTED_TYPE`: a custom `externalOptions` property that is not an owner select or radio (a multi-owner checkbox, or options from elsewhere), a custom `calculation_rollup` or other computed field type, and the types `object_coordinates` and `json`, which the guide says cannot be created.

## Property groups 2026-09

| Op | Method and path | Body | Success |
|---|---|---|---|
| List | `GET /crm/properties/2026-09/{objectType}/groups` | | 200 |
| Read | `GET .../groups/{groupName}` | | 200 |
| Create | `POST .../groups` | `name`, `label`, optional `displayOrder` | 201 |
| Update | `PATCH .../groups/{groupName}` | `label`, `displayOrder` | 200 |
| Archive | `DELETE .../groups/{groupName}` | | 204 |

No `archived` parameter on the list or read, so archived groups cannot be listed. `name` is not updatable. No batch endpoints. Scopes are the same as for properties. A group whose properties are all archived can be archived (observed in cleanup, and 204 on 2026-10-01).

A group cannot be restored, by UI or API (live runs, 2026-10-01). Recreating its name makes a fresh group. A property restore into an archived group is refused with "group does not exist", and the UI forces "Restore and Move" into an active group. A restore applies the posted body, not the archived definition: `formField` read back `false` after a restore although the archived definition had `true`.

## Account info, service keys and rate limits

- **Account info.** `GET /account-info/2026-09/details` returns `portalId`, `accountType` (`STANDARD`, `DEVELOPER_TEST`, `SANDBOX`, `APP_DEVELOPER`), `timeZone`, `uiDomain`, `dataHostingLocation` and currencies. No subscription tier. The daily usage endpoint answers a service key but reported zero usage after dozens of calls, so it does not count service-key requests (2026-10-01).
- **Service keys** are public beta. Bearer auth, object-specific scopes chosen in the UI (Development, Keys, Service keys), the limits of privately distributed apps, REST only. Creation of legacy private apps ended in autumn 2026; the docs state no deprecation date for existing ones, and Kalup accepts their tokens.
- **Rate limits.** Privately distributed apps: 100 requests per 10 seconds and 250,000 per day on Free and Starter, 190 and 625,000 on Professional, 190 and 1,000,000 on Enterprise. The daily limit is shared across the account and resets at midnight in the portal's time zone. A 429 body names `policyName` (`DAILY` or a rolling window). No `Retry-After` is documented for 429.
- **Date-versioned APIs.** A new version ships every March and September and is supported for 18 months. Legacy v4 paths go unsupported on 30 March 2027 and v1 to v3 in September 2027. The 2026-09 Pipelines API blocks deletes of in-use pipelines and stages; the observed shape is under "Later resource types" below. Sequences and sales email templates need user-level OAuth.

## Limits Tracking

- `GET /crm/limits/2026-09/custom-properties`: `{overallLimit, overallUsage, overallPercentage, byObjectType: [{objectTypeId, singularLabel, pluralLabel, limit, usage, percentage}]}`. The overall limit need not equal the sum of per-object limits. Scopes: one of many `crm.objects.*` scopes, no `crm.schemas.*` one.
- `GET /crm/limits/2026-09/custom-object-types`: `{limit, usage, percentage}`. Scopes include `crm.schemas.custom.read`.
- Neither reports a tier or entitlement. What `custom-object-types` returns on a portal without custom objects is unverified.

## Standard object type IDs

| Object | ID | Object | ID | Object | ID |
|---|---|---|---|---|---|
| Contacts | 0-1 | Companies | 0-2 | Deals | 0-3 |
| Tickets | 0-5 | Products | 0-7 | Line items | 0-8 |
| Quotes | 0-14 | Calls | 0-48 | Emails | 0-49 |
| Meetings | 0-47 | Notes | 0-46 | Tasks | 0-27 |
| Invoices | 0-53 | Subscriptions | 0-69 | Payments | 0-101 |
| Orders | 0-123 | Carts | 0-142 | Leads | 0-136 |
| Users | 0-115 | Services | 0-162 | Projects | 0-970 |

Custom objects are `2-<n>`, from `GET /crm-object-schemas/2026-09/schemas`. The properties endpoints accept plural and singular names in any case (`companies`, `company`, `COMPANIES`) and type IDs; a custom object's bare name is 400 "Unable to infer object type"; an object the key has no scope for is 403 `view_schema` (live runs, 2026-10-01). So a 403 on a list means a missing scope for that object, never an unknown object, and a 400 "Unable to infer" means the name is wrong.

## Still unverified

Resolve each before promising what depends on it.

- The direct read of a sensitive property without `dataSensitivity`, on a portal with the Sensitive data feature on, and whether `highly_sensitive` needs its own scope. The mirror case is proven: a single read filters by sensitivity, so a non-sensitive property read with `dataSensitivity=sensitive` answers 404 (live runs, 2026-10-01). The test portal has the feature off: a sensitive create with the sensitive scopes answers 400 `PORTAL_NOT_ENABLED_FOR_SENSITIVE_DATA`, and without them 403 `Missing required scope for: sensitive-data-property-create`.
- Admin validation rules on property-definition writes (see "Properties API 2026-09").
- What `custom-object-types` returns on a portal with no custom objects.

## Later resource types (observed 2026-10-01)

What the live runs saw of the types Kalup does not write yet. Each still needs its adapter, conformance checks and recovery tests before its writes ship.

- **Pipelines are natural.** `pipelineId` and every `stageId` are honoured verbatim on create and are what every read returns. PUT keeps a stage whose ID is named, gives a numeric ID to a stage sent without one, and hard-deletes stages left out. Stage IDs are unique portal-wide: a reused one is 409 `STAGE_ID_EXISTS_IN_ANOTHER_PIPELINE`. A duplicate `pipelineId` is 400, not 409. PATCH cannot rename an ID. Delete is a purge, with no archive and no restore. A stage holding a record refuses a PUT that drops it, the stage DELETE and the pipeline DELETE alike, with 400 `STAGE_ID_IN_USE` naming the stage and record IDs in `context`; the bypass flag has no effect on 2026-09, and a record in the recycle bin stops counting. So config carries a `stageId` on every stage, stage changes go through the stage endpoints and never a pipeline PUT, and a pipeline delete is the most destructive class.
- **Association labels are bound.** `name` is required and unique on create, never returned by any read (2026-09 or v4), and ignored by PUT: the `typeId` is the identity. A label is a pair: create returns two type IDs, deleting either removes both, and a PUT without `inverseLabel` collapses both sides to one label. The 2026-09 associations path returns `fromObjectTypeId` and `toObjectTypeId` as null; v4 fills them.
- **Forms.** The legacy v3 API and the 2027-03 beta create the same legacy-editor form in one store: a form made by either reads back from both with the same ID and body. Both creates demand `createdAt`, `updatedAt` and a `validation` object before they accept the body. The new form editor exposes two company properties only, so a custom property goes on a form only with `formField: true` and the legacy editor. Delete is an archive: 404 plain and 200 with `archived=true` afterwards.
- **Custom object schemas.** `secondaryDisplayProperties` is stored as sent, at most two (400 for three), no duplicates. After a PATCH the single schema GET flipped between the old and the new order for over a minute while the list stayed current, so read back from the list and treat a single-GET mismatch in the first minutes as lag. A schema DELETE works with active properties; the purge leaves the archived list and the Limits Tracking count stale for about 30 seconds.
- **Open:** the ID positions inside workflow and list payloads.

## Server-assigned IDs and cross-target references

`plan/1` and `kalup.state/1` can carry a resource whose ID HubSpot assigns and a reference that resolves to another ID on each target. A contract test proves it offline (`packages/cli/test/spike/identity.test.ts`): a test-only bound type `list:renewals_due` with ID `4412` on one portal and `9981` on another, and a property that refers to it.

- Each portal's state binds the address to its own ID, with the editable name as a unit of the base.
- Each plan carries `bindings: { "list:renewals_due": { "id": "..." } }` while the step keeps the `$ref`, so the steps of both plans are the same bytes.
- The binding is part of `writesHash`: a plan rebound to another ID, or sent to another portal, has another digest and is refused.
- A planned create keeps its logical identity until apply records the ID HubSpot returns.
- Association labels are the first real bound type, and a label is a pair (observed 2026-10-01), so its binding holds two IDs, one per direction.

Two limits. `ir/1` cannot hold a new reference field on an existing type (a property definition is closed), so that needs `ir/2`; references in the definitions of new types fit. And a real bound adapter still needs live verification, the resolver, `bind`, recovery by name, and trusted derivation rating a create with no binding `risky`.

## Live journeys

The live journeys run seven of the offline e2e journeys (`packages/cli/test/e2e/`) through the built `kalup` bin against an authorized HubSpot test portal: J1 (init and pull), J2 (edit after pull), J3 (updates), J4 (drift), J5 (delete), J8 (takeover) and J12 (a CRM record decoded by the generated codecs). They are the `*.live.test.ts` files, run only by `vitest.live.config.ts`, so `pnpm test` never picks them up. The default suite still runs them once against the simulator (`test/e2e/live-tier.e2e.test.ts` sets `KALUP_LIVE_BACKEND=sim`), so their code paths are proven without a key or a network.

**Before you start.**

- A developer test account or sandbox the founder authorizes in writing. The run refuses every other account type after reading account info, before it writes anything, with no override.
- A service key of that portal with `crm.schemas.companies.read` and `.write`, `crm.objects.companies.read`, and `crm.objects.companies.write` for the J12 record. Put it in `KALUP_LIVE_KEY`, and the portal's ID in `KALUP_LIVE_PORTAL`, in the environment or in the gitignored `.env` at the repository root. Both are required: the run and the cleanup refuse to start without the portal ID, and refuse a key of any other portal, so a key left in `.env` for other work never starts a live run on its own. The key is never printed, and every kalup run in a journey fails if its output holds it.

**Run it** from the repository root:

```sh
pnpm test:live
```

It builds the CLI, then runs one journey at a time. Against the simulator instead, with nothing sent to HubSpot: `KALUP_LIVE_BACKEND=sim pnpm test:live`.

**What it touches.** Each journey is one run with its own prefix, `kalup_e2e_<run id>_`. It creates its group and properties through HubSpot's API, with the conformance runner's client, account guard, manifest and cleanup (`scripts/conformance/client.mjs`), and every group, property and record the journey or `kalup apply` creates carries the prefix. Each is written to the run manifest, `live-runs/e2e/<run id>.manifest.json`, and flushed to disk before its create is sent; before each apply, the journey checks the plan and refuses to run it if any step touches a name without the prefix. The project's pull scope is `custom: false` with `include` listing the run's own names, so plan and takeover (J8) never see anything else in the portal. J1 alone runs `kalup init` and then the first pull, which reads every custom company property; neither writes to HubSpot. After each journey, pass or fail, `afterAll` archives what the manifest names (records first, then properties, then groups) and reads each back. Archived properties stay in the portal's archive for 90 days.

**Cleaning up.** A run stopped before its cleanup leaves a manifest without a complete cleanup. `pnpm test:live:cleanup` finishes every such run under `live-runs/e2e/`, after the same account guard. It archives only names with a run prefix that the manifest lists. A record whose create was sent but whose ID never came back is reported for you to delete in HubSpot.

**Evidence.** Next to each manifest, `<run id>.transcript.jsonl` holds every kalup command of the journey with its exit code, time and output, with the key replaced by `[key]` and the portal ID by `test-portal`. The manifest holds no portal ID.

**In CI.** `.github/workflows/live.yml` runs the live journeys when started by hand (`workflow_dispatch`), never on a push, a pull request or a fork. It reads the repository secrets `KALUP_LIVE_KEY` and `KALUP_LIVE_PORTAL` into the steps that check them, run the journeys and clean up, and no other: checkout, install and build never see them. It runs `pnpm test:live:cleanup` whatever the result, and uploads `live-runs/` as the `live-runs` artifact. Only one live run goes at a time.

**What overlaps.** The live journeys cover the Kalup workflow the conformance runner's `cli.*` checks cover, and more. The runner stays for its API-level checks (`read.*`, `write.*`) until the journeys cover those too.

## Running the conformance runner

`scripts/conformance/run.mjs` runs every check against one authorized test portal and writes redacted evidence. It is never part of `pnpm test`.

**Before you start.**

- An authorized portal: a developer test account or sandbox the founder names in writing. Never a client portal. The runner refuses every other account type, with no override.
- A service key of that portal, in `KALUP_CONFORMANCE_KEY` only (for example `read -rs KALUP_CONFORMANCE_KEY && export KALUP_CONFORMANCE_KEY`). The runner refuses any argument that looks like a key. Grant the scopes Kalup tells users to grant and nothing more: `crm.schemas.companies.read` and `.write`, `crm.objects.companies.read`, and `crm.schemas.custom.read` and `.write` when the portal has a custom object. Pass them with `--scopes` so the evidence records them. Rotate or delete the key afterwards.
- Optionally a second key of the same portal without `crm.schemas.companies.write`, in `KALUP_CONFORMANCE_LIMITED_KEY`, for the missing-scope check; and `crm.objects.companies.sensitive.write` for the sensitive-read check.
- A build (`pnpm install && pnpm build`) and a terminal for the delete check.
- A simulated run first, which sends nothing to HubSpot:

  ```sh
  node scripts/conformance/run.mjs --simulate --portal 7000001 --i-own-this-test-portal 7000001
  ```

**Run it** from the repository root:

```sh
node scripts/conformance/run.mjs --portal <id> --i-own-this-test-portal <id> \
  --scopes crm.schemas.companies.read,crm.schemas.companies.write,crm.objects.companies.read
```

| Option | Meaning |
|---|---|
| `--portal <id>` and `--i-own-this-test-portal <id>` | The authorized portal, twice as a deliberate confirmation. Required |
| `--scopes <list>` | The key's scopes, for the evidence |
| `--out <dir>` | Evidence directory. Default `live-runs/conformance/`, gitignored |
| `--work <dir>` | The run manifest and generated project. Default a new temp directory |
| `--cli <path>` | The Kalup CLI to run. Default `packages/cli/dist/index.mjs` |
| `--simulate` | Every check against the CLI tests' simulator |
| `--cleanup <manifest>` | Archive what an interrupted run's manifest names |

| Exit | Meaning |
|---|---|
| 0 | Every check passed or was not applicable, and cleanup is complete |
| 1 | At least one check failed; cleanup is complete |
| 2 | Refused before any write: flags, key, portal, account type, or account info answering 401 or 403 |
| 3 | Cleanup left resources behind; the runner prints the `--cleanup` command |

**What it touches.** Every resource it creates is named `kalupconf_<run id>_<name>` and recorded in `<work>/manifest.json`, flushed before the create goes out. It changes and archives only manifest resources carrying the run prefix, checks every effect of a saved plan against the manifest before `kalup apply`, never changes other properties, groups or custom objects, and touches no records. At the end it archives every manifest resource, properties before groups, and checks each reads archived. Archived `kalupconf_` properties stay in the portal's archive for 90 days.

**The checks.** Read gates (`read.*`): unknown and sensitive single reads, sensitive lists, both Limits Tracking readings, the schemas list, `secondaryDisplayProperties` order, archived list filtering, archived groups in the list, rate-limit headers, and which reads got a 403. Write lifecycle (`write.companies.*`, and `write.custom-object.*` when the portal has one): group and property create and update, read-after-write lag, create round trip, modification metadata, PATCH with and without options, option add, relabel and removal, `fieldType` change, create of an existing name, archive and archived read, create of an archived name, archive of a property in use and of a group holding a property, create of an archived group's name, and a write with a key missing the scope. Definition fields (`write.companies.field.*`): number display fields with `displayOrder`, `hidden` and `formField`, the currency symbol and property, the text and date hints, phone number, rich text and boolean creates, an owner property, a calculation formula, a PATCH of the fields HubSpot keeps, and a sensitive create. Kalup commands (`cli.*`): pull, plan, saved-plan apply, a second plan, drift held, `pull --only`, `rm` with `allowDestroy`, and the delete at a terminal. Pass means HubSpot behaved as Kalup assumes; fail is a finding about HubSpot, not a broken run.

**The delete at a terminal.** The runner prints a command such as `cd '<work>/project' && node '<repo>/packages/cli/dist/index.mjs' apply delete-plan.json`. Run it in another terminal with the key set and `KALUP_STATE_DIR` unset, type the target name `conformance` and the count `1`. The runner waits up to 15 minutes; type `skip` in its terminal to skip.

**Evidence.** Each run writes `<date>-<run id>.json` (format `kalup-conformance/1`: versions, key variable and scopes, summary, each check with its assumption, status, facts and requests with correlation IDs, the apply journal for `cli.*` checks, cleanup) and a Markdown summary. The portal ID becomes `test-portal`, a custom object type ID `custom-object`, user IDs `[user]` and emails `[email]`. The key never reaches either file.

**Cleaning up an interrupted run:**

```sh
node scripts/conformance/run.mjs --cleanup <work>/manifest.json --portal <id> --i-own-this-test-portal <id>
```

Each manifest resource ends `archived`, `already-archived`, `absent` (never created), `unverified` (run cleanup again), `failed` or `refused` (no run prefix, never touched).

**After a run.** The runner never commits, and raw evidence stays out of the repository: keep it as a CI artifact or on your machine. Read the summary and each failed check's facts, then update this page: move each answered question out of "Still unverified" and cite the run. For a failed check, change the simulator in `packages/engine/test/support/portal-sim.ts` to what HubSpot did, then the adapter, as its own reviewed change. Never copy a value from a live run into a fixture or test.
