# basic data dictionary

Source: the config files.

## Coverage

Describes the config files, not a portal. A field a definition omits belongs to the portal and is not listed.

## companies

### Groups

| Internal name | Label |
| --- | --- |
| billing | Billing |

### Properties

| Internal name | Key | Label | Type | Field type | Group | Managed or reference | Codec | Required | Description |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| billing\_notes | billingNotes | Billing notes | string | textarea | billing | managed | string | no |  |
| billing\_status | billingStatus | Billing status | enumeration | select | billing | managed | enum | no | Set by the billing sync |
| domain | domain |  |  |  |  | reference | string | no |  |
| name | name |  |  |  |  | reference | string | no |  |
| renewal\_date | renewalDate | Renewal date | date | date | billing | managed | date | no |  |
| seat\_count | seatCount | Seat count | number | number | billing | managed | number | no |  |

#### Options of billing\_status

| Value | Alias | Label | Hidden | Description |
| --- | --- | --- | --- | --- |
| active |  | Active |  |  |
| PAST DUE | past\_due | Past due |  |  |
| cancelled |  | Cancelled |  |  |

## subscription

- Singular label: Subscription
- Plural label: Subscriptions
- Primary display property: plan\_name
- Required properties: plan\_name
- Searchable properties: plan\_name

### Groups

| Internal name | Label |
| --- | --- |
| subscription\_information | Subscription information |

### Properties

| Internal name | Key | Label | Type | Field type | Group | Managed or reference | Codec | Required | Description |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| monthly\_amount | monthlyAmount | Monthly amount | number | number | subscription\_information | managed | number | no |  |
| plan\_name | planName | Plan name | string | text | subscription\_information | managed | string | yes |  |
| started\_on | startedOn | Started on | date | date | subscription\_information | managed | date | no |  |
| status | status | Status | enumeration | select | subscription\_information | managed | enum | no |  |

#### Options of status

| Value | Alias | Label | Hidden | Description |
| --- | --- | --- | --- | --- |
| trial |  | Trial |  |  |
| paying |  | Paying |  |  |
| churned |  | Churned |  |  |
