/*
  Facts for the site's pages, from docs/architecture.md, docs/hubspot.md and the README roadmap. When the docs do not
  say something, the field is left out, never guessed.

  Availability has one source: STAGE. Every label on the site reads it, so when a release ships, change its entries
  there and nowhere else.
*/

// The released version is never written here: lib/version.ts reads it from npm.
export const npmUrl = 'https://www.npmjs.com/package/kalup'

/**
 * released: on npm.
 * design: documented in the guides as a recipe, and run on GitHub Actions against a test account only.
 * next: the next work on the roadmap, in the order the roadmap gives. Not built.
 * later: planned after the next work. Not built.
 */
export type Availability = 'released' | 'design' | 'next' | 'later'

export type Stage = { availability: Availability }

export const STAGE: Record<'shipped' | 'design' | 'next' | 'later', Stage> = {
  shipped: { availability: 'released' },
  // The CI recipe for apply: documented in the several-portals guide, run on GitHub Actions against a test account.
  design: { availability: 'design' },
  next: { availability: 'next' },
  later: { availability: 'later' },
}

export const AVAILABILITY_TEXT: Record<Availability, { label: string; meaning: string }> = {
  released: { label: 'Released', meaning: 'Released and on npm.' },
  design: {
    label: 'Recipe',
    meaning: 'Documented in the guides. Run in CI against a test account, not yet a production portal.',
  },
  next: { label: 'Next', meaning: 'Next on the roadmap, in order. Not built yet.' },
  later: { label: 'Later', meaning: 'Planned after the next work. Not built yet.' },
}

export type Item = { text: string; stage: Stage }

function items(stage: Stage, texts: string[]): Item[] {
  return texts.map((text) => ({ text, stage }))
}

export type Phase = {
  name: string
  goal: string
  stage: Stage
  ships: Item[]
}

// The README roadmap, in order.
export const ROADMAP: Phase[] = [
  {
    name: 'The local CLI',
    goal: 'Keep properties and property groups in TypeScript files, review every change as a plan, and apply it to any portal you name. Edits made in the HubSpot UI are held, not reverted.',
    stage: STAGE.shipped,
    ships: [
      ...items(STAGE.shipped, [
        '`init` without a key, then `pull`, `validate`, `compare`, `snapshot`, `docs` and more. The tool parses config and never executes it.',
        'Reads and writes of properties and property groups, with every writable field, on standard and custom objects. Custom object schemas are read and compared.',
        '`plan` with the values it writes, held drift with both ways out, and `apply` that plans and asks in one step.',
        "Object files in `hubspot/` or any folder you name, a monorepo package included, and state on your machine or committed with `state: 'repo'`.",
        'Takeover mode, `adopt` and `yesLimit`. A delete needs a tombstone, `allowDestroy` and a person at a terminal.',
        'Blueprints with `add` and `blueprint upgrade`.',
        'Codecs and `InferProperties` with zero runtime dependencies, and `--json` on every command.',
      ]),
      {
        text: 'A CI recipe: one writer per portal, state on a branch, `--approve` with a reviewed digest. Documented, and run on GitHub Actions against a test account.',
        stage: STAGE.design,
      },
    ],
  },
  {
    name: 'Pipelines and stages',
    goal: 'Deal, ticket and custom object pipelines and their stages in the same files, planned and applied the same way.',
    stage: STAGE.shipped,
    ships: items(STAGE.shipped, [
      'Reads, plans and writes of pipelines and stages on deals, tickets and custom objects, with live evidence and recovery tests. The pipelines of other objects are read and compared.',
      'A plan that names what the API cannot copy: required properties per stage, conditional stage properties, pipeline automation and permissions.',
    ]),
  },
  {
    name: 'Custom object schema writes',
    goal: 'Create and change custom object schemas from config, where today they are read and compared.',
    stage: STAGE.next,
    ships: items(STAGE.next, [
      'Creates and updates of custom object schemas: labels, display properties and property lists.',
    ]),
  },
  {
    name: 'Association labels',
    goal: 'Association labels between objects in config, bound per portal to the IDs HubSpot assigns.',
    stage: STAGE.next,
    ships: items(STAGE.next, ['Reads and writes of association labels, with the IDs HubSpot assigns held in state.']),
  },
  {
    name: 'Cloud for agencies',
    goal: 'A hosted service for agencies running the same open engine: shared state, scheduled snapshots, approvals and history across client portals.',
    stage: STAGE.later,
    ships: items(STAGE.later, [
      'Workspace and portal permissions, and OAuth connections.',
      'Shared state and coordination, running the same open engine.',
      'Scheduled observations with coverage, approvals bound to saved plans, history, and export for handover.',
    ]),
  },
]

// The home page strip. A released entry with no name shows the version on npm.
export const RELEASES: { name?: string; detail: string; stage: Stage }[] = [
  { detail: 'Pull, plan, apply, drift and blueprints', stage: STAGE.shipped },
  { name: 'Pipelines', detail: 'Deal, ticket and custom object pipelines and stages', stage: STAGE.shipped },
  { name: 'Schemas and labels', detail: 'Custom object writes, association labels', stage: STAGE.next },
  { name: 'Cloud', detail: 'Shared execution for agency teams', stage: STAGE.later },
]

export const OPEN_SOURCE: string[] = [
  'The CLI and the engine, with `init`, `pull` and `validate`',
  '`compare`, `plan`, `snapshot` and `docs`',
  '`apply`, and state on your machine or in the repository',
  'The CI recipe for `apply`, with state on a branch per portal',
  'Blueprints and `blueprint upgrade`',
  'Later, the typed client and code generators',
  'Every future command that runs locally or in CI',
]

export const LATER: { name: string; detail: string }[] = [
  {
    name: 'The typed record client',
    detail:
      '`@kalup/client`: typed record reads and writes, batches, search and associations over the same codecs. The types and codecs in `@kalup/core` work without it.',
  },
  {
    name: 'Lists, forms, workflows',
    detail:
      'In that order, each with reads before writes. Workflows sit behind a per-resource flag because the API is beta.',
  },
  {
    name: 'Runbooks and attest',
    detail:
      'Steps in the words of the HubSpot UI for settings with no API, and `attest` to record that a person did them.',
  },
  {
    name: 'generate <language>',
    detail: 'Native types and codecs from the IR, with no Node at run time. Research points at Python, then PHP.',
  },
  {
    name: 'Keychain credentials',
    detail: 'Keys read from the operating system keychain instead of environment variables.',
  },
  {
    name: 'Blueprint sources and a registry',
    detail: 'More ways to fetch a blueprint, and a registry, once reuse needs distribution.',
  },
  {
    name: 'MCP server and Claude Code plugin',
    detail: 'Read-mostly, with apply off by default and never for protected targets.',
  },
  {
    name: 'Hosted service',
    detail: 'Beyond the agency cloud, a hosted service for any team. It gets its own pages.',
  },
]

export const NOT_PLANNED: { name: string; detail: string }[] = [
  {
    name: 'Record data migration',
    detail:
      'Copying values between properties, bulk record edits, seed data. The rename recipe names the steps and stops there.',
  },
  {
    name: 'Rebuilding the HubSpot CLI',
    detail:
      'Projects, apps, CMS themes, serverless functions, test account creation. Use `hs` for the app and Kalup for the portal.',
  },
  {
    name: 'Claims beyond a runbook',
    detail:
      'For assets with no public write API, the most Kalup will do is print the manual steps and record that a person did them.',
  },
  { name: 'rollback, resume and promote', detail: 'Recovery is running `plan` again.' },
  {
    name: 'Promises about undocumented behaviour',
    detail: 'An unverified HubSpot behaviour stays labelled until a live test settles it.',
  },
]

export type Transport = 'public-api' | 'public-beta' | 'runbook' | 'undecided'
export type Identity = 'natural' | 'bound'

export type ResourceTypeData = {
  type: string
  name: string
  read: Stage
  write: Stage
  transport: Transport
  identity: Identity
  note?: string
}

// Kept by hand, not generated. Properties, groups and custom object schemas follow their endpoint registry rows in
// packages/engine; the other types have no registry row yet and follow the README roadmap.
export const RESOURCE_TYPES: ResourceTypeData[] = [
  {
    type: 'property',
    name: 'Properties',
    read: STAGE.shipped,
    write: STAGE.shipped,
    transport: 'public-api',
    identity: 'natural',
    note: "Every writable field, display hints and formulas included. Recreating an archived property's name restores it with its record values, so Kalup blocks that create and says so.",
  },
  {
    type: 'group',
    name: 'Property groups',
    read: STAGE.shipped,
    write: STAGE.shipped,
    transport: 'public-api',
    identity: 'natural',
  },
  {
    type: 'object',
    name: 'Custom object schemas',
    read: STAGE.shipped,
    write: STAGE.next,
    transport: 'public-api',
    identity: 'natural',
  },
  {
    type: 'pipeline',
    name: 'Pipelines',
    read: STAGE.shipped,
    write: STAGE.shipped,
    transport: 'public-api',
    identity: 'natural',
    note: 'Natural: HubSpot honours pipeline and stage IDs on create (observed 2026-10-01 on the developer test account). Written on deals, tickets and custom objects; the pipelines of other objects are read and compared.',
  },
  {
    type: 'stage',
    name: 'Pipeline stages',
    read: STAGE.shipped,
    write: STAGE.shipped,
    transport: 'public-api',
    identity: 'natural',
    note: 'Every stage needs an ID in config. Required properties per stage and pipeline automation have no API, and a plan says so.',
  },
  {
    type: 'association',
    name: 'Association labels',
    read: STAGE.next,
    write: STAGE.next,
    transport: 'public-api',
    identity: 'bound',
    note: "Bound: the label's name never comes back on read. HubSpot's type ID is the identity, and a label is a pair.",
  },
  {
    type: 'list',
    name: 'Lists',
    read: STAGE.later,
    write: STAGE.later,
    transport: 'undecided',
    identity: 'bound',
    note: 'HubSpot assigns the ID, and listing lists is a POST. Reads come before writes.',
  },
  {
    type: 'form',
    name: 'Forms',
    read: STAGE.later,
    write: STAGE.later,
    transport: 'undecided',
    identity: 'bound',
    note: 'Legacy v3 and the 2027-03 beta create the same legacy-editor form; Kalup will pin the dated path.',
  },
  {
    type: 'workflow',
    name: 'Workflows',
    read: STAGE.later,
    write: STAGE.later,
    transport: 'public-beta',
    identity: 'bound',
    note: 'Will sit behind a per-resource flag. Update is a full replace, delete cannot be undone, names are not unique.',
  },
]

export const IDENTITY_TEXT: Record<Identity, string> = {
  natural: 'You set a permanent key, and Kalup matches on it.',
  bound: 'HubSpot assigns the ID. State will tie the address to it per target.',
}

export const TRANSPORT_TEXT: Record<Transport, string> = {
  'public-api': 'The change goes through a public API.',
  'public-beta': 'A documented beta API. It will stay off until you turn it on per type in config.',
  runbook: 'No API. The plan will print the steps for a person to do.',
  undecided: 'Not decided yet.',
}

// Verified in research (2026-09): these assets have no public write API. `stage` is when a plan names each one: today's
// plan names those on the types it reads, the rest wait for their types.
export const MANUAL_ONLY: { name: string; stage: Stage }[] = [
  { name: 'Record page layouts', stage: STAGE.shipped },
  { name: 'Saved views', stage: STAGE.shipped },
  { name: 'Conditional property logic', stage: STAGE.shipped },
  { name: 'Required properties per stage', stage: STAGE.shipped },
  { name: 'Pipeline automation', stage: STAGE.shipped },
  { name: 'Permission sets', stage: STAGE.later },
]

const OBSERVED = 'Observed 2026-10-01 on the developer test account: '

// Still open. Everything else once listed here was seen live on 2026-10-01 and moved into the notes above or the docs.
// `observed` is the nearest thing a live run saw: the question is what stays open.
export const UNVERIFIED: { question: string; decides: string; observed?: string }[] = [
  {
    question:
      'Does a single read of a sensitive property without its data sensitivity answer 404 on a portal with the feature on, and does highly sensitive need its own scope?',
    decides:
      "Apply's check before a write and its read-back. Until settled, a 404 means not found by that query, never gone.",
    observed: `${OBSERVED}the single read filters by sensitivity: a non-sensitive property read with dataSensitivity=sensitive answers 404. The test portal has the feature switched off, so the direct case waits.`,
  },
]
