# orchard\-crm data dictionary

Source: a snapshot of target sandbox, portal 1111111, observed at 2026\-09\-23T10\:15\:30\.123Z.

## Coverage

The read was complete: every object in scope was read.

- Unsupported properties, which no builder carries: plot\_shape on companies (type object\_coordinates, field type text).
- Out of scope, not captured: 2 properties on companies, 1 property on harvest.
- Custom objects in the portal that config does not name: press\_run.
- Reference properties, HubSpot-defined or calculated, record only their options.
- Fields not captured: property: archivedAt, createdAt, createdUserId, dateDisplayHint, modificationMetadata, sensitiveDataCategories, updatedAt, updatedUserId; group: displayOrder; object: allowsSensitiveProperties, associations, createdAt, createdByUserId, description, fullyQualifiedName, id, properties, updatedAt, updatedByUserId; pipeline: archived, createdAt, updatedAt; stage: archived, createdAt, isClosed, updatedAt, writePermissions; association: cardinality, category, createdAt, hasUserEnforcedMaxFromObjectIds, hasUserEnforcedMaxToObjectIds, inverseCardinality, maxFromObjectIds, maxToObjectIds, updatedAt.

## companies

### Groups

| Internal name | Label |
| --- | --- |
| companyinformation | Company information |
| orchard | Orchard details |
| plots | Plots |

### Properties

| Internal name | Label | Type | Field type | Group | Managed or reference | Description |
| --- | --- | --- | --- | --- | --- | --- |
| irrigation\_notes | Irrigation notes | string | textarea | orchard | managed |  |
| lifecyclestage |  |  |  |  | reference |  |
| name |  |  |  |  | reference |  |
| plot\_count | Plot count | number | number | plots | managed | Number of plots on the estate |
| plot\_tags | Plot tags | string | text | orchard | managed |  |
| plot\_total | Plot total | number | number | orchard | managed |  |
| pruned | Pruned this season | bool | booleancheckbox | orchard | managed |  |
| row\_meta | Row meta | string | textarea | orchard | managed | Row layout as JSON |
| soil\_ph |  |  |  |  | reference |  |
| yield\_tier | Yield band | enumeration | select | orchard | managed | Set by the yield sync |

#### Options of lifecyclestage

| Value | Label | Hidden | Description |
| --- | --- | --- | --- |
| subscriber | Subscriber | no |  |
| lead | Lead | no |  |
| customer | Customer | no |  |

#### Options of yield\_tier

| Value | Label | Hidden | Description |
| --- | --- | --- | --- |
| low | Low | no |  |
| HIGH | High | no |  |
| peak | Peak | yes |  |

## harvest

- Singular label: Harvest
- Plural label: Harvests
- Primary display property: batch\_code
- Required properties: batch\_code
- Searchable properties: batch\_code, orchard\_ref
- Secondary display properties: picked\_on

### Groups

| Internal name | Label |
| --- | --- |
| harvest\_details | Harvest details |
| harvestinformation | Harvest information |

### Properties

| Internal name | Label | Type | Field type | Group | Managed or reference | Description |
| --- | --- | --- | --- | --- | --- | --- |
| batch\_code | Batch code | string | text | harvest\_details | managed |  |
| orchard\_ref | Orchard ref | string | text | harvest\_details | managed |  |
| picked\_on | Picked on | date | date | harvest\_details | managed |  |
| weight\_kg | Weight \(kg\) | number | number | harvest\_details | managed |  |
