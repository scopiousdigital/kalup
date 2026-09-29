/*
  Facts for the site's pages. Every entry comes from docs/roadmap.md, docs/vision.md or docs/architecture.md. When the
  docs do not say something, the field is left out, never guessed. Keep this file in step with docs/roadmap.md.

  Availability has one source: STAGE, one entry per milestone plus `later`. Every label on the site reads it, so when a
  release ships, change its entries there and nowhere else.
*/

/**
 * released: on npm. Nothing is today.
 * unreleased: implemented in the repository and usable from a source checkout, not on npm yet. Live verification is
 * tracked separately; one conformance run does not verify every capability.
 * planned: assigned to a numbered milestone, not built.
 * later: no milestone yet.
 */
export type Availability = 'released' | 'unreleased' | 'planned' | 'later'

export type Stage = { availability: Availability; milestone?: number }

export const STAGE: Record<'m1' | 'm2' | 'm3' | 'm3ci' | 'm4' | 'm5' | 'later', Stage> = {
  m1: { availability: 'unreleased', milestone: 1 },
  m2: { availability: 'unreleased', milestone: 2 },
  m3: { availability: 'unreleased', milestone: 3 },
  // The executable CI workflow of milestone 3: documented as a design, not yet run in a real CI or tested.
  m3ci: { availability: 'planned', milestone: 3 },
  m4: { availability: 'unreleased', milestone: 4 },
  m5: { availability: 'planned', milestone: 5 },
  later: { availability: 'later' },
}

export const AVAILABILITY_TEXT: Record<Availability, { label: string; meaning: string }> = {
  released: { label: 'Released', meaning: 'On npm.' },
  unreleased: {
    label: 'Unreleased',
    meaning:
      'Implemented in the repository with offline tests. Not on npm: run it from a source checkout. Live conformance and release gates are tracked separately.',
  },
  planned: { label: 'Planned', meaning: 'Assigned to a numbered milestone. Not built yet.' },
  later: { label: 'Later', meaning: 'Planned, with no milestone yet.' },
}

export type Item = { text: string; stage: Stage }

function items(stage: Stage, texts: string[]): Item[] {
  return texts.map((text) => ({ text, stage }))
}

export type Milestone = {
  number: number
  name: string
  release: string
  goal: string
  stage: Stage
  ships: Item[]
}

// The delivery order from docs/roadmap.md. Milestones 1 and 2 together are the read-only agency preview.
export const MILESTONES: Milestone[] = [
  {
    number: 1,
    name: 'Read-only foundation',
    release: 'Read-only agency preview',
    goal: '`kalup pull` reads a portal into `kalup/objects/*.ts`, and the app gets its types from those files with no generate step.',
    stage: STAGE.m1,
    ships: items(STAGE.m1, [
      'The packages `kalup` (the CLI) and `@kalup/core`, not on npm yet.',
      'Commands `init`, `pull`, `validate`, `ir`, `fmt` and `status`.',
      'Reads of `property`, `group` and `object` (custom object schema).',
      'The config reader and canonical writer. The tool parses config and never executes it.',
      'Codecs, `InferProperties` and `toCreatePayload`, with zero runtime dependencies.',
      '`pull` scoped by config, with `--discover` for resources outside the scope, and a copy of every overwritten file in `.kalup/history/`.',
      '`--json` on every command as one `envelope/1`, and fixed exit codes.',
    ]),
  },
  {
    number: 2,
    name: 'Compare, plan, snapshot, docs',
    release: 'Read-only agency preview',
    goal: 'See what differs between your files and a portal, or between two portals. Every request is a read, and nothing is written to a portal.',
    stage: STAGE.m2,
    ships: items(STAGE.m2, [
      '`compare <a> <b>`, where each side is a target, a snapshot file or `config`.',
      '`plan --target X` in the full `plan/1` shape, with held fields, `expect`, counts by risk and the approval digest `apply` checks.',
      'A preflight before every plan: the account behind the key and Limits Tracking headroom. A create with no room left is `blocked`, with the override that leaves it out.',
      'Per-target `skip` and `name` overrides.',
      '`snapshot --target X`, a scoped observation of the configuration, with what could not be read listed.',
      '`docs`, a Markdown data dictionary from the config or a snapshot.',
    ]),
  },
  {
    number: 3,
    name: 'The local CLI with writes',
    release: 'Local CLI MVP',
    goal: '`kalup apply` writes a reviewed plan for properties and property groups to a target, keeps state, and holds drift instead of reverting it.',
    stage: STAGE.m3,
    ships: [
      ...items(STAGE.m3, [
        '`apply` of a reviewed plan, saved or made in the same run, for properties and property groups only.',
        "State per portal in `.kalup/state/portal-<id>.json`, so a plan can tell your change from someone else's.",
        "Drift held with a base. `plan --take config` takes your side, `pull --only` and `pull --accept` take the portal's.",
        '`rm` and `rm --release`, `state rebuild` and `target rebind`.',
        'Serial writes, destructive steps last, `expect` re-checked before each write and read back after it.',
        'One approval per plan: a person at a terminal, `--yes` for a small safe change, or `--approve` for a reviewed CI job. A delete needs four keys.',
        'A lock per portal for one user on one machine, and recovery by a new plan after any run that did not finish.',
      ]),
      {
        text: 'A CI recipe: one writer per portal and a state branch. Documented as a design, not yet run in a real CI.',
        stage: STAGE.m3ci,
      },
    ],
  },
  {
    number: 4,
    name: 'Agency reuse',
    release: 'Agency reuse',
    goal: "Keep one reusable setup across client portals, and keep each client's deliberate changes.",
    stage: STAGE.m4,
    ships: items(STAGE.m4, [
      'Versioned JSON blueprint fragments, added with `kalup add` from a pinned local file or URL.',
      'Provenance and stored originals for everything a blueprint adds.',
      '`blueprint upgrade` as a three-way merge. It edits config and never writes a portal.',
      "Per-target `definition` overrides, for one portal's own labels or options.",
    ]),
  },
  {
    number: 5,
    name: 'Hosted agency pilot',
    release: 'Hosted agency pilot',
    goal: 'A small group of agencies uses Kalup together for shared execution, client portal observations, review and history.',
    stage: STAGE.m5,
    ships: items(STAGE.m5, [
      'Workspace and portal permissions, and OAuth connections.',
      'Shared state and coordination, running the same open engine.',
      'Scheduled observations with coverage, approvals bound to saved plans, history, and export for handover.',
    ]),
  },
]

// The home page strip. The read-only preview is milestones 1 and 2; flip both in STAGE when it ships.
export const RELEASES: { name: string; detail: string; stage: Stage }[] = [
  { name: 'Read-only preview', detail: 'Pull, compare, plan, snapshot and docs', stage: STAGE.m2 },
  { name: 'Local CLI with writes', detail: 'Reviewed property and group writes', stage: STAGE.m3 },
  { name: 'Agency reuse', detail: 'Blueprints across client portals', stage: STAGE.m4 },
  { name: 'Hosted pilot', detail: 'Shared execution for agency teams', stage: STAGE.m5 },
]

// The free side of the line, on the open source page. The last entry is a promise, not a capability.
export const OPEN_SOURCE: { text: string; stage?: Stage }[] = [
  { text: 'The CLI and the engine, with `init`, `pull` and `validate`', stage: STAGE.m1 },
  { text: '`compare`, `plan`, `snapshot` and `docs`', stage: STAGE.m2 },
  { text: '`apply`, and state on your machine', stage: STAGE.m3 },
  { text: 'A CI recipe for `apply`, with state on a branch per portal', stage: STAGE.m3ci },
  { text: 'Blueprints and `blueprint upgrade`', stage: STAGE.m4 },
  { text: 'The typed client and code generators', stage: STAGE.later },
  { text: 'Every future command that runs locally or in CI' },
]

export const LATER: { name: string; detail: string }[] = [
  {
    name: 'The typed record client',
    detail:
      '`@kalup/client`: typed record reads and writes, batches, search and associations over the same codecs. The types and codecs in `@kalup/core` work without it.',
  },
  {
    name: 'Custom object, pipeline and association writes',
    detail:
      'Custom object schema writes, pipelines, stages and association labels, each with its own live evidence and recovery tests.',
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
    detail: 'Beyond the milestone 5 pilot, a hosted service for any team. It gets its own pages.',
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
// packages/cli; the other types have no registry row yet and follow docs/roadmap.md.
export const RESOURCE_TYPES: ResourceTypeData[] = [
  {
    type: 'property',
    name: 'Properties',
    read: STAGE.m1,
    write: STAGE.m3,
    transport: 'public-api',
    identity: 'natural',
    note: 'A live test restored an archived property by creating its name again. Kalup blocks that create; whether record values return is unverified.',
  },
  {
    type: 'group',
    name: 'Property groups',
    read: STAGE.m1,
    write: STAGE.m3,
    transport: 'public-api',
    identity: 'natural',
  },
  {
    type: 'object',
    name: 'Custom object schemas',
    read: STAGE.m1,
    write: STAGE.later,
    transport: 'public-api',
    identity: 'natural',
  },
  {
    type: 'pipeline',
    name: 'Pipelines',
    read: STAGE.later,
    write: STAGE.later,
    transport: 'public-api',
    identity: 'natural',
    note: 'Natural only if HubSpot honours a pipeline ID on create. Unverified; if not, pipelines become bound.',
  },
  {
    type: 'stage',
    name: 'Pipeline stages',
    read: STAGE.later,
    write: STAGE.later,
    transport: 'public-api',
    identity: 'natural',
    note: 'Required properties per stage and stage automation have no API, and a plan will say so.',
  },
  {
    type: 'association',
    name: 'Association labels',
    read: STAGE.later,
    write: STAGE.later,
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
  { name: 'Record page layouts', stage: STAGE.m2 },
  { name: 'Saved views', stage: STAGE.m2 },
  { name: 'Conditional property logic', stage: STAGE.m2 },
  { name: 'Required properties per stage', stage: STAGE.later },
  { name: 'Pipeline automation', stage: STAGE.later },
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
