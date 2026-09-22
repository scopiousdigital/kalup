# 0007. Date-versioned API paths and one endpoint registry

## Status

accepted

## Date

2026-09-22

## Context

The first draft built on `/crm/v3/properties` and a private app token. Both are on a clock. Since 30 March 2026 HubSpot's REST APIs are versioned by release date (`/crm/properties/2026-09/`, `/crm-object-schemas/2026-09/schemas`). A new version ships every March and September, each is supported for 18 months, and versions change behaviour as well as paths: `2026-09` enforces admin-configured property validation on API writes and blocks deletes of in-use pipelines and stages. Legacy v1 to v3 paths go unsupported in September 2027, v4 on 30 March 2027. Legacy private app creation is switched off on 28 September and 26 October 2026; service keys replace them and are still in public beta.

Coverage is uneven per family. Forms exist only as legacy v3 and `2027-03-beta`; workflows only as legacy v4 beta and `2027-03-beta`. The version segment sits in a different place per family. HubSpot's OpenAPI spec collection is marked proprietary.

## Decision

One endpoint registry, one row per resource type, with a version pin per row. The fields are fixed; the exact shape below is illustrative:

```ts
{
  type: 'property',
  identity: 'natural',
  family: 'crm.properties',
  version: '2026-09',
  status: 'ga',                      // 'ga' | 'beta' | 'legacy'; beta and legacy require `expires`
  expires: '2028-03',
  paths: {
    list:   { method: 'GET',    path: '/crm/properties/2026-09/{objectType}',        tag: 'read' },
    read:   { method: 'GET',    path: '/crm/properties/2026-09/{objectType}/{name}', tag: 'read' },
    create: { method: 'POST',   path: '/crm/properties/2026-09/{objectType}',        tag: 'write' },
    update: { method: 'PATCH',  path: '/crm/properties/2026-09/{objectType}/{name}', tag: 'write' },
    delete: { method: 'DELETE', path: '/crm/properties/2026-09/{objectType}/{name}', tag: 'write' },
  },
  scopes: { read: ['crm.schemas.{object}.read'], write: ['crm.schemas.{object}.write'] },
  tier: 'any',
  limitKey: 'customProperties',
  auth: 'account',                    // or 'user' for sequences and sales email templates
  delete: 'archive-restorable',
}
```

Rules:

- Date-versioned paths from day one. A `legacy` or `beta` row is allowed per resource type and must carry an `expires` date, because a `-beta` path dies when its version goes GA and a legacy path dies on HubSpot's published date. The CLI warns as a row nears expiry.
- Paths are tagged `read` or `write`. Read mode (milestones 1 and 2) allows `read`-tagged paths of any HTTP method, since listing lists is a POST. Tests never touch the network.
- Service keys first. Each target names `credentials.read` and optional `credentials.write`, each `{ env }` now and `{ keychain }` on paper. A target may later also hold a user-level OAuth credential for the APIs that need one. No credential can be created by API.
- Beta-backed resource types sit behind a per-resource flag in project config.
- Thin clients are hand-written from the public docs. The OpenAPI specs are never vendored, and no spec-derived code enters the repo.
- Every plan step records the API version it was planned against, and `apply` compares that with the current row before writing. The registry as a whole is not hashed into the approval, because any registry edit would void every plan waiting in CI.
- A twice-yearly upgrade pass, tied to HubSpot's March and September releases, bumps pins and retires expired rows.

Preflight before any plan reads `account-info` (the `portalId` must equal the pinned one, plus `accountType`, `uiDomain`, time zone), the Limits Tracking API for tier-gated features and headroom, and the token's scopes. A tier gap is `blocked` with the exact `overrides` JSON that excludes the resource on that target. A 403 on `list` is a reported gap, not a failure.

## Alternatives considered

- **`/crm/v3` paths (the draft).** Unsupported from September 2027. Rejected.
- **One global version pin.** The segment position and the available versions differ per family, and forms would have no pin at all. Rejected.
- **Legacy paths with no expiry.** A path that dies on a known date must carry the date. Rejected.
- **Clients generated from HubSpot's OpenAPI specs.** Proprietary. Rejected for an open-source repo. Whether a private CI job may read them needs a legal read and is not assumed.
- **Private app tokens first.** Creation ends within weeks of this decision. Rejected.

## Consequences

- Each row's expiry is a release chore, and the March and September cadence sets Kalup's own release rhythm.
- If workflows are still beta when v4 goes unsupported, there is no supported workflows path. The registry makes that visible.
- Service key rate-limit headers are undocumented. The HTTP layer adapts to headers when present, falls back to 8 requests per second when they are missing, and refuses a run when `estimatedCalls > maxShare * dailyRemaining`.
- Tier and limits are read from the portal at plan time, never hardcoded.
- One live check per resource type in a developer test account, run by a person and kept out of the test suite, is the rule. A nightly suite is on paper: how CI gets a credential and how the account survives its 90-day expiry are open.
- The coverage matrix is generated from the registry, so it cannot claim more than the code does.
