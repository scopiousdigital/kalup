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
 * design: documented in the guides as a recipe, and not yet run in a real CI.
 * next: the next work on the roadmap, in the order the roadmap gives. Not built.
 * later: planned after the next work. Not built.
 */
export type Availability = 'released' | 'design' | 'next' | 'later'

export type Stage = { availability: Availability }

export const STAGE: Record<'shipped' | 'design' | 'next' | 'later', Stage> = {
  shipped: { availability: 'released' },
  // The CI recipe for apply: documented in the several-portals guide, not yet run in a real CI.
  design: { availability: 'design' },
  next: { availability: 'next' },
  later: { availability: 'later' },
}

export const AVAILABILITY_TEXT: Record<Availability, { label: string; meaning: string }> = {
  released: { label: 'Released', meaning: 'Released and on npm.' },
  design: { label: 'Recipe', meaning: 'Documented in the guides. Not yet run in a real CI.' },
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
        'Takeover mode, `adopt` and `yesLimit`. A delete needs a tombstone, `allowDestroy` and a person at a terminal.',
        'Blueprints with `add` and `blueprint upgrade`.',
        'Codecs and `InferProperties` with zero runtime dependencies, and `--json` on every command.',
      ]),
      {
        text: 'A CI recipe: one writer per portal, state on a branch, `--approve` with a reviewed digest. Documented, not yet run in a real CI.',
        stage: STAGE.design,
      },
    ],
  },
  {
    name: 'Pipelines and stages',
    goal: 'Deal and ticket pipelines and their stages in the same files, planned and applied the same way.',
    stage: STAGE.next,
    ships: items(STAGE.next, [
      'Reads, plans and writes of pipelines and stages, each with live evidence and recovery tests.',
      'A plan that names what the API cannot copy, such as required properties per stage and stage automation.',
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

// The home page strip. A released entry has no name: it shows the version on npm.
export const RELEASES: { name?: string; detail: string; stage: Stage }[] = [
  { detail: 'Pull, plan, apply, drift and blueprints', stage: STAGE.shipped },
  { name: 'Pipelines', detail: 'Pipelines and stages', stage: STAGE.next },
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
    note: 'A live test restored an archived property by creating its name again. Kalup blocks that create; whether record values return is unverified.',
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
    read: STAGE.next,
    write: STAGE.next,
    transport: 'public-api',
    identity: 'natural',
    note: 'Natural only if HubSpot honours a pipeline ID on create. Unverified; if not, pipelines become bound.',
  },
  {
    type: 'stage',
    name: 'Pipeline stages',
    read: STAGE.next,
    write: STAGE.next,
    transport: 'public-api',
    identity: 'natural',
    note: 'Required properties per stage and stage automation have no API, and a plan will say so.',
  },
  {
    type: 'association',
    name: 'Association labels',
    read: STAGE.next,
    write: STAGE.next,
    transport: 'public-api',
    identity: 'bound',
    note: 'Bound until a live test shows the label name comes back on read.',
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
    note: 'Legacy v3 or the 2027-03 beta, decided by a live test of both.',
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
  { name: 'Required properties per stage', stage: STAGE.next },
  { name: 'Pipeline automation', stage: STAGE.next },
  { name: 'Permission sets', stage: STAGE.later },
]

const OBSERVED = 'Observed 2026-09-29 on a developer test account: '

// Not verified. Each is treated as unknown until a live test settles it. `observed` is what the first live conformance
// run saw on one developer test account (run 89b45da9, docs/conformance/runs/): the question is what stays open.
export const UNVERIFIED: { question: string; decides: string; observed?: string }[] = [
  {
    question: 'Is a pipeline ID honoured on create, and what does PUT do to stage IDs?',
    decides: 'Whether pipelines are natural or bound.',
  },
  {
    question: "Does an association label's name come back on read?",
    decides: 'Whether association labels are natural or bound.',
  },
  {
    question: 'What does HubSpot rewrite when a property of another type is created, on other account types?',
    decides: 'How live properties are normalized.',
    observed: `${OBSERVED}nothing, for a text and an enumeration property. Every owned field read back as sent.`,
  },
  {
    question: 'Which scopes can a service key hold, and does every account type return the daily rate-limit headers?',
    decides: 'The daily budget check. Without a daily figure it is skipped with a warning.',
    observed: `${OBSERVED}a service key's answers carry X-HubSpot-RateLimit-Daily and -Daily-Remaining.`,
  },
  {
    question: 'How long is the read-after-write lag on other account types and under load?',
    decides: 'The read-back timeout.',
    observed: `${OBSERVED}a new property showed in the single read after about 0.4 seconds and in the list after about 0.65 seconds.`,
  },
  {
    question: "Do record values come back when an archived property's internal name is created again?",
    decides: 'Whether restoring is a real way back from a delete.',
    observed: `${OBSERVED}creating the name restores the archived property rather than making a new one, on companies and on a custom object. Plan blocks that create and says so.`,
  },
  {
    question:
      'Does the API refuse to archive a property used in a workflow, list or form, and is there any public "where used" read?',
    decides:
      'The docs for a delete say HubSpot refuses to archive a property in use and that Kalup does not check uses first; apply reports such a refusal as rejected.',
    observed: `${OBSERVED}HubSpot refused to archive a property a calculation property uses (400, CANNOT_DELETE_PROPERTY_IN_USE). Apply reports that delete as rejected, saying the property is in use.`,
  },
  {
    question: 'Which editor do forms created by the legacy v3 API and by the 2027-03 beta open in?',
    decides: 'Which forms API Kalup builds on.',
  },
  {
    question: 'Is there any scope introspection for service keys?',
    decides: 'Until then, the preflight probes each list path and reads a 403 as a missing scope.',
  },
  {
    question: 'Does a single read of a sensitive property without its data sensitivity answer 404?',
    decides:
      "Apply's check before a write and its read-back. Until settled, a 404 means not found by that query, never gone.",
    observed: `${OBSERVED}a single read answers 404 for an unknown name, with or without a data sensitivity.`,
  },
  {
    question: 'Do the sensitive and highly sensitive property lists answer on lower tiers?',
    decides: 'Whether a read is complete. Until settled, a 403 on either is a gap that leaves the object incomplete.',
    observed: `${OBSERVED}both lists answer with crm.schemas scopes, on companies and on a custom object.`,
  },
  {
    question: "What does a create of an archived group's name do, and does any account type list archived groups?",
    decides:
      "Which creates a plan blocks for a name HubSpot archived. Until settled, plan blocks an archived group's name only where the list shows it.",
    observed: `${OBSERVED}an archived group leaves the groups list, so plan's check for one never fires there. The archived properties list filters by data sensitivity.`,
  },
  {
    question:
      'Is one crm.objects read scope enough for Limits Tracking, and which scopes does a write key need for the reads apply makes?',
    decides:
      'The scopes init and the docs ask for. Until settled, a write key also needs the read scopes of what it manages.',
    observed: `${OBSERVED}account info answers a key with crm.schemas scopes only. Limits Tracking custom-properties answers it 403, so init and the docs recommend one crm.objects read scope, and plan warns when it cannot check the property limit.`,
  },
  {
    question: 'Does every account type answer a create of a name that already exists the same way?',
    decides: 'How apply settles a rejected create. It reads again and treats a present resource as uncertain.',
    observed: `${OBSERVED}409 OBJECT_ALREADY_EXISTS, with the property unchanged.`,
  },
  {
    question: 'Does every account type replace the whole options list on a property update?',
    decides: 'The options payload. Apply sends no options unless one changes, then the full live list.',
    observed: `${OBSERVED}an option left out of the list is removed, and an update without options keeps them.`,
  },
  {
    question:
      'Can a group be restored, and does every account type archive a group that holds only archived properties?',
    decides:
      'Group deletes. Until settled, plan and apply block one while any property, active or archived, names the group.',
    observed: `${OBSERVED}archiving a group that holds an active property is refused (400), and both stay active. The run's cleanup archived groups whose properties were all archived.`,
  },
]
