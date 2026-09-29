# HubSpot vendor reference: properties and groups, API 2026-09 (latest)

Retrieved 2026-09-24 from developers.hubspot.com (HubSpotDev MCP `fetch-doc` plus the same pages as `.md`). Each reference page embeds the OpenAPI spec `specs/2026-09/crm-properties-v2026-09.json`; "spec" below means that embedded YAML. **UNVERIFIED** marks anything the docs do not state. **Observed** marks what the first live conformance run saw on 2026-09-29 on one developer test account, with a key holding `crm.schemas.*` scopes only (run `89b45da9`, [evidence](runs/2026-09-29-89b45da9.json)); other account types stay unverified.

Abbreviations: `REF` = `https://developers.hubspot.com/docs/api-reference/latest`.

## 1. Standard object type IDs

Source: `REF/crm/understanding-the-crm` ("Object type ID values" accordion).

| Object | ID | Object | ID |
|---|---|---|---|
| Appointments | 0-421 | Line items | 0-8 |
| Calls | 0-48 | Listings | 0-420 |
| Carts | 0-142 | Marketing events | 0-54 |
| Communications | 0-18 | Meetings | 0-47 |
| Companies | 0-2 | Notes | 0-46 |
| Contacts | 0-1 | Orders | 0-123 |
| Courses | 0-410 | Payments | 0-101 |
| Custom objects | 2-XXX | Postal mail | 0-116 |
| Deals | 0-3 | Products | 0-7 |
| Discounts | 0-84 | Projects | 0-970 |
| Emails | 0-49 | Quotes | 0-14 |
| Feedback submissions | 0-19 | Services | 0-162 |
| Fees | 0-85 | Subscriptions | 0-69 |
| Goals | 0-74 | Tasks | 0-27 |
| Invoices | 0-53 | Taxes | 0-86 |
| Leads | 0-136 | Tickets | 0-5 |
| | | Users | 0-115 |

- Custom object IDs: "make a `GET` request to `/crm-object-schemas/2026-09/schemas`".
- Names vs IDs: "You can always use the numerical type ID value, but for contacts, companies, deals, tickets, or notes, in some cases you can also use the object's fully qualified name (FQN)." The properties guide itself uses `contacts` in a path (`/crm/properties/2026-09/contacts/favorite_food`, `REF/crm/properties/guide`). Which names the properties endpoints accept beyond those examples: **UNVERIFIED**.

## 2. Properties API 2026-09

Guide: `REF/crm/properties/guide`. All endpoints are on `https://api.hubapi.com`.

### Endpoint inventory (spec)
| Op | Method and path | Success | Page |
|---|---|---|---|
| List | `GET /crm/properties/2026-09/{objectType}` | 200 `{results: Property[]}` (`CollectionResponsePropertyNoPaging`, no paging) | `REF/crm/properties/get-properties` |
| Read | `GET /crm/properties/2026-09/{objectType}/{propertyName}` | 200 `Property` | `REF/crm/properties/get-property` |
| Create | `POST /crm/properties/2026-09/{objectType}` | **201** `Property`, `Location` header | `REF/crm/properties/create-property` |
| Update | `PATCH /crm/properties/2026-09/{objectType}/{propertyName}` | 200 `Property` | `REF/crm/properties/update-property` |
| Archive | `DELETE /crm/properties/2026-09/{objectType}/{propertyName}` | **204** | `REF/crm/properties/delete-property` |
| Batch create | `POST .../{objectType}/batch/create` `{inputs: PropertyCreate[]}` | 201, or **207** with `errors[]`, `numErrors` | `REF/crm/properties/batch/create-properties` |
| Batch read | `POST .../{objectType}/batch/read` `{archived, dataSensitivity, inputs:[{name}]}` (all three required) | 200 / 207 | `REF/crm/properties/batch/get-properties` |
| Batch archive | `POST .../{objectType}/batch/archive` `{inputs:[{name}]}` | 204 | `REF/crm/properties/batch/delete-properties` |

There is **no batch update** endpoint in the 2026-09 index (`https://developers.hubspot.com/docs/_llms/apis/2026-09/crm.md`). Every endpoint's non-success response is `default: Error` only. The spec lists no specific 400, 404 or 409 responses.

### List and read query params (spec)
- `archived` (boolean, default `false`): "Whether to return only results that have been archived." Present on both list and single read.
- `dataSensitivity` (enum `highly_sensitive | non_sensitive | sensitive`, default `non_sensitive`). Guide: "When retrieving all properties, by default only non-sensitive properties are returned." The sensitive-data page says the same for the list: "If you don't include this parameter when retrieving properties, only non-sensitive properties will be returned" (`REF/crm/properties/sensitive-data`).
- `locale` (string), `properties` (string): both have empty descriptions. Semantics are **UNVERIFIED**.
- Unknown `propertyName` on read: the spec has only `200` and `default`. **Observed** (observed 2026-09-29 on a developer test account, run `89b45da9`, [evidence](runs/2026-09-29-89b45da9.json)): 404, category `OBJECT_NOT_FOUND`, without `dataSensitivity` and with each value. A sensitive property read without its `dataSensitivity` stays **UNVERIFIED**.

### Create body (`PropertyCreate`, spec)
- Required: `name`, `label`, `type`, `fieldType`, `groupName`. The guide says the same.
- Optional: `description`, `displayOrder` (int32, "-1 will cause the property to be displayed after any positive values"), `options` (`OptionInput[]`: required `label`, `value`, `displayOrder`, `hidden`; optional `description`), `hasUniqueValue`, `hidden`, `formField`, `calculationFormula`, `dataSensitivity`, `externalOptions`, `referencedObjectType`, `currencyPropertyName`, `numberDisplayHint` (`currency|duration|formatted|percentage|probability|unformatted`), `textDisplayHint` (`domain_name|email|ip_address|multi_line|phone_number|physical_address|postal_code|unformatted_single_line`), `showCurrencySymbol`.
- `type` enum: `bool, date, datetime, enumeration, number, phone_number, string`. The guide says `object_coordinates` and `json` "cannot be created or edited".
- `fieldType` enum: `booleancheckbox, calculation_equation, checkbox, date, file, html, number, phonenumber, radio, select, text, textarea`. The guide has a table of valid type to fieldType pairs.
- `options`: "This field is required for enumerated properties."
- `externalOptions`: "Should be set to true in conjunction with a 'referencedObjectType' of 'OWNER'."
- Mismatch: the guide documents `dateDisplayHint` (`absolute`, `absolute_with_relative`, `time_since`, `time_until`), but `PropertyCreate` and `PropertyUpdate` do not include it. It appears only on the response `Property`. Whether writes accept it is **UNVERIFIED**.
- Unique IDs: "You can have up to ten unique ID properties per object" (guide).
- Calculation properties: "Calculation properties created via API cannot be edited within HubSpot. You can only edit these properties via the properties API" (guide).

### Response `Property` (spec)
Fields: `name, label, type, fieldType, groupName, description, options[], displayOrder, hasUniqueValue, hidden, formField, calculated, calculationFormula, externalOptions, referencedObjectType, dataSensitivity, sensitiveDataCategories[], showCurrencySymbol, currencyPropertyName, number/text/dateDisplayHint, hubspotDefined, archived, archivedAt, createdAt, updatedAt, createdUserId, updatedUserId, modificationMetadata {archivable, readOnlyDefinition, readOnlyValue, readOnlyOptions?}`. Required: `name, label, type, fieldType, groupName, description, options`. `hubspotDefined`: "true for default object properties built into HubSpot."

### Update (`PropertyUpdate`, spec)
- Description: "Perform a partial update of a property identified by { propertyName }. Provided fields will be overwritten."
- Updatable fields, with none required: `label, description, groupName, displayOrder, hidden, formField, options, calculationFormula, currencyPropertyName, numberDisplayHint, textDisplayHint, showCurrencySymbol, type, fieldType`.
- **Not in the update schema:** `name`, `hasUniqueValue`, `dataSensitivity`, `externalOptions`, `referencedObjectType`.
- `name`: the schema has no field for it and the path identifies the property. No sentence states "name is immutable" (**UNVERIFIED as a statement**).
- `hasUniqueValue`: "Whether or not the property's value must be unique. Once set, this can't be changed" (spec field description). The GraphQL page adds: "Existing properties cannot be updated to have this parameter" (`https://developers.hubspot.com/docs/cms/start-building/features/data-driven-content/graphql/use-graphql-data-in-your-website-pages`).
- `dataSensitivity`: "Once you've created a property as sensitive, you cannot change the sensitivity setting" and "You cannot edit the `dataSensitivity` field" (`REF/crm/properties/sensitive-data`).
- `type` and `fieldType` are in the update schema, so they can be sent. The guide says "When creating or updating properties, both `type` and `fieldType` values are required", but the update schema marks neither as required. Which type conversions are allowed, and what happens to existing values, is **UNVERIFIED**. **Observed** (observed 2026-09-29 on a developer test account, run `89b45da9`, [evidence](runs/2026-09-29-89b45da9.json)): a `fieldType` change from `text` to `textarea` on a string property answered 200 and read back.
- `options`: described only as "A list of valid options for the property." With "Provided fields will be overwritten", this implies that sending `options` replaces the whole list. The docs never say directly whether omitted options are removed, hidden or kept. **Observed** (observed 2026-09-29 on a developer test account, run `89b45da9`, [evidence](runs/2026-09-29-89b45da9.json)): a PATCH without `options` keeps them, and an option left out of the list is removed, so the list is replaced whole.
- Read-only definitions: `modificationMetadata.readOnlyDefinition` ("cannot be modified"), `readOnlyOptions`, `archivable`. The error returned for a write that violates these is **UNVERIFIED**.

### Archive
- The single-property spec says "Move a property identified by {propertyName} to the recycling bin." and returns 204.
- Batch archive: "This method will return a 204 No Content response on success regardless of the initial state of the property (e.g. active, already archived, non-existent)." The single DELETE's behaviour on a missing or already-archived property is **UNVERIFIED**.
- 90 days: "Once archived, properties will be permanently deleted after 90 days" (`REF/crm/properties/sensitive-data`, written about Sensitive Data properties). The Knowledge Base says it generally: "Once archived, properties are stored in the Archived tab and will be permanently deleted after 90 days." and "properties archived 90 or more days ago have been deleted and cannot be restored" (`https://knowledge.hubspot.com/properties/organize-and-export-properties`).
- KB: "You can only archive properties if they are not used in assets or tools that prevent archiving (e.g., in a segment, form, or workflow)" (same URL). **Observed** (observed 2026-09-29 on a developer test account, run `89b45da9`, [evidence](runs/2026-09-29-89b45da9.json)) for a property a calculation property's formula uses: 400, category `VALIDATION_ERROR`, subCategory `PropertyValidationError.CANNOT_DELETE_PROPERTY_IN_USE`, message "... is currently used in 1 places and cannot be deleted"; both properties stay active. The error for use in segments, forms and workflows stays **UNVERIFIED**.
- **No restore or unarchive endpoint** exists in 2026-09. Restore is a UI action ("click Restore", KB). **Observed** (observed 2026-09-29 on a developer test account, run `89b45da9`, [evidence](runs/2026-09-29-89b45da9.json)): POSTing an archived property's name answers 201 and restores that property (the active read then answers 200 with its old `createdAt`, the archived read 404), on companies and on a custom object. Whether record values come back is **UNVERIFIED**.

### Creating a property whose name already exists
Not documented anywhere in the 2026-09 docs. **Observed** (observed 2026-09-29 on a developer test account, run `89b45da9`, [evidence](runs/2026-09-29-89b45da9.json)): 409, category `OBJECT_ALREADY_EXISTS`, subCategory `Properties.PROPERTY_WITH_NAME_EXISTS`, message "A property named '<name>' already exists."; the property is unchanged.

### Admin validation rule enforcement (2026-09)
- Guide warning (`REF/crm/properties/guide`, in the record-values section): "Starting with the GA release of API version `/2026-09/` on September 8, 2026, HubSpot will enforce admin-configured validation rules on all CRM API write paths."
- Changelog (`https://developers.hubspot.com/changelog/crm-api-write-validation-enforcement`, announced Aug 11, 2026): "If your integration creates or updates CRM records, please make sure that it conforms…" It enforces three behaviors: conditional required properties (400, `code: MISSING_CONDITIONAL_REQUIRED_PROPERTY`), record creator settings on POST (`MISSING_REQUIRED_PROPERTY`), and the "Edit Associations" permission for user-level OAuth ("This does not affect portal-level app tokens"). "If no conditional required property rules, record creator requirements, or association permission restrictions exist on a portal, there is no behavior change."
- Every example is a record write. The changelog does not say whether property-definition writes are affected (**UNVERIFIED**, most likely not affected).

### Scopes
- Writes (create, update, archive, batch create, batch archive) need one of the following, per object (page "Required Scopes"): `crm.schemas.contacts.write`, `crm.schemas.companies.write`, `crm.schemas.deals.write`, `crm.schemas.custom.write`, `tickets` (plus `tickets.sensitive.v2`, `tickets.highly_sensitive.v2`), `crm.schemas.quotes.write`, `crm.schemas.invoices.write`, `crm.schemas.orders.write`, `crm.schemas.carts.write`, `crm.schemas.appointments.write`, `crm.schemas.courses.write`, `crm.schemas.listings.write`, `crm.schemas.services.write`, `crm.schemas.subscriptions.write`, `crm.schemas.commercepayments.write`, `crm.schemas.projects.write`, `e-commerce`, `crm.objects.users.write`, `crm.objects.carts.write`, `crm.objects.orders.write`, `crm.pipelines.orders.write`. The embedded spec also lists `crm.schemas.tickets.write`, `crm.schemas.calls/emails/meetings/notes/tasks.write`, and `crm.objects.tickets.(highly_)sensitive.write` (`REF/crm/properties/create-property`).
- Reads (list, read, batch read, groups read) accept "one of" a long list that includes both `crm.schemas.<obj>.read` and `crm.objects.<obj>.read` or `.write`, for example `crm.schemas.contacts.read` or `crm.objects.contacts.read` (`REF/crm/properties/get-properties`).
- Scope meanings (`https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/scopes`): `crm.schemas.contacts.write` = "Create, delete, or make changes to property settings for contacts." `crm.schemas.custom.read` is "Available to Enterprise accounts only." `tickets` is tagged Legacy.
- Sensitive: "Sensitive and highly sensitive scopes are not required to retrieve schema information for a Sensitive Data or Highly Sensitive Data property, but are required to create or edit" such properties. "You must have the `sensitive.write` scope for the given object to create or edit its properties" (`REF/crm/properties/sensitive-data`).
- Which exact scope gates each object (for example, whether `crm.objects.companies.write` alone can create company properties): the pages list alternatives only, with no mapping from object to scope (**UNVERIFIED**). **Observed** (observed 2026-09-29 on a developer test account, run `89b45da9`, [evidence](runs/2026-09-29-89b45da9.json)): `crm.schemas.companies.*` and `crm.schemas.custom.*` were enough for every property and group read and write the run sent on companies and on a custom object.

### Error shape
- Spec `Error`: required `category`, `correlationId` (uuid), `message`. Optional `subCategory`, `context` (map of string to string[]), `links` (map), `errors[]` (`ErrorDetail`: required `message`; optional `code`, `in`, `subCategory`, `context`). Example `category: VALIDATION_ERROR`.
- Batch 207 `StandardError`: `status`, `category`, `message`, `errors[]`, `context`, `links`, optional `id`, `subCategory` (`REF/crm/properties/batch/create-properties`).
- Error handling page (`REF/error-handling`): example includes `"status": "error"`. "the fields in the example response above should all be treated as optional in any error parsing." Documented common codes: 207, 401, 403 (missing scope), 414, 423 ("Locks will last for 2 seconds"), 429, 477 (`Retry-After`), 502/504, 503, 521 to 526.

## 3. Property groups 2026-09
| Op | Method and path | Body | Success | Page |
|---|---|---|---|---|
| List | `GET /crm/properties/2026-09/{objectType}/groups` | query `locale` only | 200 `{results: PropertyGroup[]}` | `REF/crm/properties/property-groups/get-properties` |
| Read | `GET .../groups/{groupName}` | query `locale` only | 200 | `REF/crm/properties/property-groups/get-property` |
| Create | `POST .../groups` | `PropertyGroupCreate`: required `name`, `label`; optional `displayOrder` | **201** plus `Location` | `REF/crm/properties/property-groups/create-property` |
| Update | `PATCH .../groups/{groupName}` | `PropertyGroupUpdate`: `label`, `displayOrder` only | 200 | `REF/crm/properties/property-groups/update-property` |
| Archive | `DELETE .../groups/{groupName}` | none | **204** | `REF/crm/properties/property-groups/delete-property` |

- `PropertyGroup` response: `name`, `label`, `archived` (all required), `displayOrder`.
- **No `archived` query parameter** on group list or read in 2026-09. Archived groups cannot be listed through the documented API. **Observed** (observed 2026-09-29 on a developer test account, run `89b45da9`, [evidence](runs/2026-09-29-89b45da9.json)): after an archive (204) the group is absent from the list. What a create of an archived group's name does is **UNVERIFIED**.
- Group `name` is not updatable (not in the update schema).
- Archive: "Move a property group identified by {groupName} to the recycling bin." **Observed** (observed 2026-09-29 on a developer test account, run `89b45da9`, [evidence](runs/2026-09-29-89b45da9.json)): archiving a group that holds an active property answers 400, with its error body nested as JSON text in `message`: category `VALIDATION_ERROR`, subCategory `PropertyGroupError.GROUP_WITH_ACTIVE_PROPERTIES`, "Can't delete or purge a group with active properties"; the group and the property stay active. **Observed** in the same run's cleanup (see `cleanup` in the [evidence](runs/2026-09-29-89b45da9.json)): a group whose properties were all archived archives (the DELETE succeeded and the group left the list), for example `group:companies/kalupconf_89b45da9_holder` after its one property. A restore of a group, and what a later restore of those archived properties does, are **UNVERIFIED**. The KB only says "To delete a group, hover over the group, then click Delete" (`https://knowledge.hubspot.com/properties/organize-and-export-properties`). There are no group batch endpoints.
- Scopes are the same as for properties (read list and write list above).

## 4. Account info 2026-09
Guide: `REF/account/account-information/guide`.
- `GET /account-info/2026-09/details` (`REF/account/account-information/get-account-details`). Scope: `oauth`. **Observed** (observed 2026-09-29 on a developer test account, run `89b45da9`, [evidence](runs/2026-09-29-89b45da9.json)): 200 for a service key with `crm.schemas.*` scopes only. Response `PortalInformationResponseSeptember2026`. Required: `portalId` (int32), `accountType` (`STANDARD|DEVELOPER_TEST|SANDBOX|APP_DEVELOPER`), `timeZone`, `companyCurrency`, `additionalCurrencies[]`, `utcOffset`, `utcOffsetMilliseconds`, `uiDomain`, `dataHostingLocation`. Optional: `portalName`, `createdAt` (epoch ms).
- `GET /account-info/2026-09/api-usage/daily/private-apps` (`REF/account/account-information/get-usage-details`). Scope: `oauth`. Response `{results:[{name, usageLimit, currentUsage, collectedAt, fetchStatus (CACHED|FAILURE|NOTFOUND|SUCCESS|TIMEOUT), resetsAt}]}`. The guide says it returns "the aggregate API calls that all legacy private apps have made for the current day". Example `name: "private-apps-api-calls-daily"`. Whether it covers service keys or 2025.2+ private apps is **UNVERIFIED**. Whether a service key can hold the `oauth` scope is also **UNVERIFIED**.

## 5. Rate limits
Source: `https://developers.hubspot.com/docs/developer-tooling/platform/usage-guidelines`.
- Privately distributed apps (legacy private apps plus 2025.2/2026.03 private distribution): Free/Starter 100 per 10 s per app and 250,000 per day per account. Professional 190 per 10 s and 625,000 per day. Enterprise 190 per 10 s and 1,000,000 per day. With the API Limit Increase add-on, 250 per 10 s and +1,000,000 per day per increase (maximum two). "The burst limit … applies individually per app. The daily limit … is shared across all apps within the same HubSpot account."
- Public OAuth marketplace apps: "110 requests every 10 seconds" per installing account.
- Headers: `X-HubSpot-RateLimit-Daily`, `-Daily-Remaining` ("not included in the response to API requests authorized using OAuth"), `-Interval-Milliseconds`, `-Max`, `-Remaining`. The `-Secondly` and `-Secondly-Remaining` headers are "deprecated". Search API responses carry none of these headers.
- 429 body: `{status:"error", message, errorType:"RATE_LIMIT", correlationId, policyName:"DAILY", requestId}`. "The `message` and `policyName` will indicate which limit you hit (either daily or secondly)". The page names `TEN_SECONDLY_ROLLING` in the throttling advice. The daily limit "resets at midnight based on your time zone setting". Error responses "shouldn't exceed 5% of your total daily requests". The page defines no `Retry-After` for 429 on REST calls (**UNVERIFIED**). **Observed** (observed 2026-09-29 on a developer test account, run `89b45da9`, [evidence](runs/2026-09-29-89b45da9.json)): a service key's answers carry `X-HubSpot-RateLimit-Daily` and `-Daily-Remaining`, with the interval, max, remaining and secondly headers.
- The page still says "2025.2 and 2026.03". It does not mention 2026.09.

## 6. Service keys
Source: `https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/account-service-keys`.
- Title "(BETA)": "This functionality is currently in public beta … subject to change."
- Authentication: "include your service key as a *Bearer* token". The example header is `Authorization: Bearer pat-na1-…`.
- Scopes: "Service keys are still configured with object-specific scopes (e.g., `crm.objects.contacts.read`)". Scopes are chosen in the UI (Development > Keys > Service keys) and can be edited later. Creators: Super admins or users with "Developer tools access".
- Limits: "subject to the same limits as privately distributed apps built on version `2025.2` and `2026.03`".
- They cannot be used for webhooks, UI extensions or other platform features ("other than making REST API requests"). Rotation: "Rotate and expire now" or "Rotate and expire later" (expires in 7 days).
- Legacy private apps: "Legacy apps are still supported by HubSpot, but don't have access to the latest app features" (`https://developers.hubspot.com/docs/apps/legacy-apps/private-apps/overview`). **No deprecation date for legacy private apps is stated.** Only project-built 2025.1 private apps were "sunset on August 1, 2026" (`https://developers.hubspot.com/docs/developer-tooling/platform/versioning`).

## 7. Limits Tracking
Guide: `REF/crm/limits-tracking/guide`.
- `GET /crm/limits/2026-09/custom-properties` (`REF/crm/limits-tracking/get-custom-properties`). Response `{overallLimit, overallUsage, overallPercentage, byObjectType:[{objectTypeId, singularLabel, pluralLabel, limit, usage, percentage}]}` (int64 counts). "The `overallLimit` and by object `limit` values are distinct and separate, so the overall limit may not equal the sum of by object limits." Supported products: all hubs from FREE. Scopes: one of many `crm.objects.*` read or write scopes, `tickets`, `e-commerce`, `media_bridge.read`. **No `crm.schemas.*` scope is listed**. **Observed** (observed 2026-09-29 on a developer test account, run `89b45da9`, [evidence](runs/2026-09-29-89b45da9.json)): 403 for a key with `crm.schemas.*` scopes only. Whether one `crm.objects.*` read scope, such as `crm.objects.companies.read`, is enough is **UNVERIFIED**.
- `GET /crm/limits/2026-09/custom-object-types` (`REF/crm/limits-tracking/get-custom-object-types`). Response `{limit, usage, percentage}`. Scopes: one of `crm.schemas.custom.read`, `crm.schemas.custom.write`, `crm.objects.custom.read`, `crm.objects.custom.write`, or a sensitive variant.
- Non-Enterprise: the guide says "Custom objects (*Enterprise* only)" and "If your account has an *Enterprise* subscription, you can view limits and usage for the number of custom objects". What the endpoint returns otherwise (403, zero limit, or other) is **UNVERIFIED**. **Observed** (observed 2026-09-29 on a developer test account, run `89b45da9`, [evidence](runs/2026-09-29-89b45da9.json)): 200 with `crm.schemas.custom.read` on a developer test account, limit 20, usage 2. Calculated properties (`/crm/limits/2026-09/calculated-properties`) are "Professional and Enterprise only".

## 8. Idempotency and concurrency
- No property or group endpoint documents an idempotency key, `If-Match`, `ETag`, revision or version field. None is in any spec or guide read here. **There is no documented conditional update.** The response `updatedAt` is the only change marker.
- The only idempotent-by-contract behavior is batch archive, which returns 204 "regardless of the initial state of the property (e.g. active, already archived, non-existent)".
- `objectWriteTraceId` for multi-status belongs to the object batch-create APIs, not the properties API (`REF/error-handling`).
