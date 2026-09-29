# orchard\-crm data dictionary

Source: the config files.

## Coverage

Describes the config files, not a portal. A field a definition omits belongs to the portal and is not listed.

## companies

### Groups

| Internal name | Label |
| --- | --- |
| legacy | Legacy |
| orchard | Orchard |

### Properties

| Internal name | Key | Label | Type | Field type | Group | Managed or reference | Codec | Required | Description |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| harvest\_window | harvestWindow | Harvest window | string | text | orchard | managed | string | no |  |
| lifecyclestage | lifecyclestage |  |  |  |  | reference | enum | no |  |
| name | name |  |  |  |  | reference | string | no |  |
| plot\_tags | plotTags | Plot tags | string | text | orchard | managed | stringArray | no |  |
| plot\_total | plotCount | Plot total | number | number | orchard | managed | number | no |  |
| row\_meta | rowMeta | Row meta | string | textarea | orchard | managed | json | no |  |
| yield\_tier | yieldTier | Yield tier | enumeration | select | orchard | managed | enum | yes |  |

#### Options of lifecyclestage

| Value | Alias | Label | Hidden | Description |
| --- | --- | --- | --- | --- |
| lead |  | Lead |  |  |
| customer | paying | Customer |  |  |

#### Options of yield\_tier

| Value | Alias | Label | Hidden | Description |
| --- | --- | --- | --- | --- |
| low |  | Low |  |  |
| HIGH | high | High |  |  |
| trial |  | Trial |  |  |

## harvest

- Singular label: Harvest
- Plural label: Harvests
- Primary display property: batch\_code
- Required properties: batch\_code

### Groups

| Internal name | Label |
| --- | --- |
| harvest\_details | Harvest details |

### Properties

| Internal name | Key | Label | Type | Field type | Group | Managed or reference | Codec | Required | Description |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| batch\_code | batchCode | Batch code | string | text | harvest\_details | managed | string | no |  |
| picked\_on | pickedOn | Picked on | date | date | harvest\_details | managed | date | no |  |
