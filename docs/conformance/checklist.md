# Live conformance checklist

How to run the conformance runner against one authorized HubSpot test portal, read its evidence, clean up after an interrupted run, and record what the run settled. The runner is `scripts/conformance/run.mjs`. It answers the questions in section 13 of [architecture.md](../architecture.md).

The first authorized live run, [89b45da9 on 2026-09-29](runs/2026-09-29-89b45da9.md), recorded 45 pass, 6 fail and 4 not applicable, with cleanup complete. The runner is also tested offline in simulate mode (`packages/cli/test/conformance/runner.test.ts`). The original scope-only baseline below is historical: the next run should add the candidate `crm.objects.companies.read` scope, exercise a sensitive property and a limited write key, and include a person at a terminal for the delete check. Record the exact scopes and retain both runs; a new live run still needs an authorized test portal. That run's six failed checks are now the checks' assumptions, so a repeat of it passes and a change in HubSpot fails.

## Before you start

- **An authorized portal.** The founder names one HubSpot developer test account, or a sandbox, by its portal ID, in writing. Run against that portal and no other. Never a client portal. The runner refuses a `STANDARD` account, and anything but `DEVELOPER_TEST` or `SANDBOX`, with no override.
- **A service key of that portal**, created under Development, Keys, Service keys. For the first run, grant only the scopes Kalup tells its users to grant, and nothing else:

  | Scope | Why |
  |---|---|
  | `crm.schemas.companies.read`, `crm.schemas.companies.write` | Company properties and groups: the lists, the single reads and the write lifecycle |
  | `crm.schemas.custom.read`, `crm.schemas.custom.write` | Only when the portal has a custom object (Enterprise only): the custom object schemas list, Limits Tracking `custom-object-types`, and the lifecycle on the custom object |
  | `crm.objects.companies.read` | From the second run on. Limits Tracking `custom-properties` answered 403 to the first run's key, which held `crm.schemas.*` scopes only, so Kalup's property limit check cannot run without one `crm.objects.*` scope. Kalup now recommends one; that one is enough is not yet confirmed live, and the run checks it |

  Grant no other `crm.objects.*` scope and no `oauth`. The run then tests a key set up the way Kalup documents: `read.scopes` lists every 403 it got, and fails only on one that the scopes named in `--scopes` should have covered. It shows whether the granted scopes were enough, not which ones are needed, so a run with extra scopes answers nothing about the scope questions. On a portal without a custom object, a 403 on the schemas list and on `custom-object-types` is an answer to record, not a broken run. Pass the scopes you granted with `--scopes`, so the evidence records them. A sensitive-data scope is optional. With `crm.objects.companies.sensitive.write` (or its `.v2` form) granted and named in `--scopes`, the run creates a sensitive property of its own for `read.sensitive-property-without-sensitivity`; without it, that check needs a sensitive property already in the portal and otherwise records not applicable.
- **A second run only after a 403 on account-info or Limits Tracking.** When account-info answers 403, the runner stops with `E_GUARD`, exit 2, and prints the status, HubSpot's category and correlation ID. When Limits Tracking `custom-properties` answers 403 although `--scopes` names a `crm.objects.*` scope, `read.limits-custom-properties` and `read.scopes` fail: that scope was not enough. Record that answer first (see "After a run"), then add the candidate scope and run again: `oauth` for account-info, if the key setup offers it; another `crm.objects.*` read scope for Limits Tracking `custom-properties`, whose reference lists only `crm.objects.*` scopes. Record both runs, each with the scopes it had.
- **The key in the environment only.** Put it in `KALUP_CONFORMANCE_KEY` without writing it to a file or your shell history, for example `read -rs KALUP_CONFORMANCE_KEY && export KALUP_CONFORMANCE_KEY` and paste. Never pass it as a flag: the runner refuses any argument that holds or looks like a key. Rotate or delete the key when you are done.
- **Optionally, a second key of the same portal without `crm.schemas.companies.write`,** in `KALUP_CONFORMANCE_LIMITED_KEY` (environment only, like the first; it is redacted the same way). The runner checks that it belongs to the same portal before any write and refuses the run if not. With it, `write.companies.missing-write-scope` records the 403 and the scopes HubSpot names. Without it, that check is not applicable.
- **A build.** From the repository root: `pnpm install && pnpm build`. The runner runs `packages/cli/dist/index.mjs`, or the CLI `--cli` names (an installed `node_modules/kalup/dist/index.mjs`, for example). Building needs Node 22.18 or later; running Kalup needs 22.13.1 or later.
- **A terminal.** The last check needs a person to confirm a delete. Without a terminal it is reported as not applicable.
- **A simulated run first.** It runs every check against the CLI tests' simulator, sends nothing to HubSpot, and shows what the live run will do:

  ```sh
  node scripts/conformance/run.mjs --simulate --portal 7000001 --i-own-this-test-portal 7000001
  ```

## Running it

From the repository root, with `<id>` the authorized portal ID:

```sh
node scripts/conformance/run.mjs --portal <id> --i-own-this-test-portal <id> \
  --scopes crm.schemas.companies.read,crm.schemas.companies.write,crm.objects.companies.read
```

Add `crm.schemas.custom.read,crm.schemas.custom.write` to `--scopes` when the key has them.

The runner first reads account-info with the key and refuses to go on unless the key belongs to `<id>` and the account is a developer test account or a sandbox. Every refusal exits 2 before anything is written.

| Option | Meaning |
|---|---|
| `--portal <id>` | The authorized portal. Required |
| `--i-own-this-test-portal <id>` | Repeats `--portal`, as a deliberate confirmation. Required |
| `--scopes <list>` | The scopes the key was given, comma-separated, for the evidence |
| `--out <dir>` | Where the evidence goes. Default `docs/conformance/runs/`; with `--simulate`, the work directory |
| `--work <dir>` | The run manifest and the generated Kalup project. Default a new directory under the system temp directory |
| `--cli <path>` | The Kalup CLI to run. Default `packages/cli/dist/index.mjs` |
| `--simulate` | Every check against the simulator; nothing is sent to HubSpot |
| `--cleanup <manifest>` | Archive what an interrupted run's manifest names (below) |

| Exit | Meaning |
|---|---|
| 0 | Every check passed or was not applicable, and cleanup is complete |
| 1 | At least one check failed; cleanup is complete |
| 2 | Refused before any write: a missing or mismatched flag, a key in an argument, no key, the key of another portal, an account that is not a test account or sandbox, or account-info answering 401 or 403. A 403 may be a scope the key lacks: record it as the answer for the scopes account-info needs, with the correlation ID the runner printed |
| 3 | Cleanup left resources behind; the runner prints the `--cleanup` command |

### What it creates and changes

Every resource the run creates is named `kalupconf_<run id>_<name>`, with an eight-character hexadecimal run ID. The runner writes each one to the run manifest, `<work>/manifest.json`, with the time, and flushes the file to disk before it sends the create. It changes and archives only resources the manifest names and whose names carry the run prefix; any other write is refused before it is sent. Before any `kalup apply`, it checks every effect of the saved plan against the manifest, and applies nothing when one is outside it. It reads, but never changes, the portal's other properties, groups and custom objects, and it touches no records.

With `<prefix>` for `kalupconf_<run id>_`, on companies, and on the portal's first custom object when there is one:

- groups `<prefix>group`, `<prefix>holder`, and on companies `<prefix>empty` and `<prefix>reused`;
- properties `<prefix>text` (a string) and `<prefix>choice` (an enumeration) in `<prefix>group`, and `<prefix>held` in `<prefix>holder`.

For the Kalup commands, on companies: the group `<prefix>cli` and property `<prefix>cli_seed`, which the runner creates for `kalup pull` to read, and the group `<prefix>kalup` and property `<prefix>kalup_count`, which `kalup apply` creates.

At the end the runner archives every manifest resource that still exists, properties before groups, and checks each one reads archived. A resource the reads do not show is polled until 60 seconds after its last create was sent, so a create HubSpot applied late, or applied while answering with an error, is still found. HubSpot keeps an archived property in its archive for 90 days, so a test portal collects archived `kalupconf_` properties; that is expected.

### The delete at a terminal

The last check needs a person. After `kalup rm` and `allowDestroy: true`, the runner saves a plan with one delete and prints a command like this:

```sh
cd '<work>/project' && node '<repo>/packages/cli/dist/index.mjs' apply delete-plan.json
```

Run it in another terminal, with `KALUP_CONFORMANCE_KEY` set there too and `KALUP_STATE_DIR` unset. Kalup asks for the target name, `conformance`, and the number of destructive steps, `1`. The runner waits up to 15 minutes for the property to read archived. Type `skip` and Enter in the runner's terminal to skip the check instead.

## What each check means

Pass means HubSpot behaved as Kalup's code and the CLI tests' simulator assume. Fail means it did not, or a request failed; the facts say which. Not applicable means the check could not run here, with the reason: no custom object in the portal, no sensitive property to read, a check it depends on that failed, or no person at a terminal.

### Read gates

| Check | The question | Settles |
|---|---|---|
| `read.unknown-property-404` | Does a single read of a name the object does not hold answer 404, without `dataSensitivity` and with each value? | Architecture 13.12 |
| `read.sensitive-property-without-sensitivity` | Does a sensitive property read without its `dataSensitivity` answer 404? Needs a sensitive property in the portal | Architecture 13.12 |
| `read.sensitive-lists` | Do the `sensitive` and `highly_sensitive` lists answer 200 on this account? | The sensitive lists gate |
| `read.limits-custom-properties` | With a `crm.objects.*` scope in `--scopes`, does `custom-properties` return integer figures, and does `byObjectType` list standard objects, with which type IDs? Without one, is it still the 403 of run `89b45da9`? With no `--scopes`, either answer passes, and the facts record which, with a 403's category and the scopes it names | ADR 0018, and whether one `crm.objects.*` read scope is enough |
| `read.limits-custom-object-types` | What does `custom-object-types` answer on this account type? | The non-Enterprise gate |
| `read.custom-object-schemas` | Can the key read the schemas list, and is there a custom object for the lifecycle? | Architecture 13.9 |
| `read.secondary-display-properties-order` | Do the list read and two single reads give one order? Needs a custom object with two or more | The `secondaryDisplayProperties` gate |
| `read.archived-list-sensitivity` | Does the archived properties list filter by `dataSensitivity`? | The archived list gate |
| `read.archived-groups-in-list` | Does an archived group still leave the groups list, as in run `89b45da9`? | The archived groups gate |
| `read.rate-limit-headers` | Which `X-HubSpot-RateLimit-*` headers arrive, the daily ones included? | Architecture 13.4 |
| `read.scopes` | Which requests got a 403 under the scopes granted, and did one that those scopes should cover get one? It shows whether those scopes were enough, not which ones are needed | Architecture 13.9 and 13.15, for the scopes the run had |

### Write lifecycle

Each runs on companies as `write.companies.<check>` and, when the portal has a custom object, as `write.custom-object.<check>`. The request bodies are the ones `kalup apply` builds, and a PATCH carries the live `type` and `fieldType` as apply's does.

| Check | The question | Settles |
|---|---|---|
| `group-create`, `property-create` | Status and body of a create (201 expected) | Write adapters have live evidence |
| `group-label-update`, `label-description-update` | Do the updates apply writes read back? | Write adapters have live evidence |
| `read-after-write-lag` | How long until a new property shows in the single read and in the list, against apply's 60-second read-back? | Architecture 13.5 |
| `create-round-trip` | Does Kalup's normalizer give back every owned field sent, and which raw fields did HubSpot rewrite? | Architecture 13.3 |
| `modification-metadata` | Is a property the run created archivable and not read-only? | ADR 0021 write matrix |
| `archive-property-in-use` | Is archiving a property that one of the run's own calculation properties uses still refused, 400 `CANNOT_DELETE_PROPERTY_IN_USE`, as in run `89b45da9`? Not applicable when the portal refuses the calculation property | Architecture 13.7, for use by a calculation property |
| `missing-write-scope` (companies only) | With the second key, which lacks `crm.schemas.companies.write`: does a group create answer 403 with nothing created, and which scopes does HubSpot name? Not applicable without `KALUP_CONFORMANCE_LIMITED_KEY` | Architecture 13.9, for a write key's scopes |
| `patch-without-options` | Does a PATCH without `options` keep them? | Architecture 13.13 |
| `option-added`, `option-label-changed` | Do option edits in the full list read back? | Architecture 13.13 |
| `option-left-out` | Is an option left out of the PATCH removed, hidden or kept? | Architecture 13.13 |
| `field-type-change` | Does a `fieldType` change from text to textarea apply? | ADR 0021 write matrix |
| `create-existing-name` | Status and category of a create of an active name; is the property unchanged? | Architecture 13.11 |
| `archive`, `archived-single-read` | 204 on archive; 404 without `archived`, 200 with `archived=true`? | Deletes and read-back |
| `create-archived-name` | Does a create of an archived name still restore the property, as in run `89b45da9`, or is it refused or recreated? The facts put the label and field type the property had when archived, the ones the create posted and the ones that read back side by side, so they show which definition a restore keeps | Architecture 13.6: name reuse only; the run touches no records, so whether values come back is not tested |
| `archive-group-holding-property` | Is an archive of a group that holds an active property refused, and what happens to the group and the property? | Architecture 13.14: the API archive and its effect on the property; restoring a group in the UI is not tested |
| `create-archived-group-name` (companies only) | After a run group is archived, does a create of its name restore it, make a new group, or get refused? Any definite answer passes; the facts say which | What a create of an archived group's name does, which plan cannot see coming while the list leaves archived groups out |

### Kalup commands

| Check | What it runs |
|---|---|
| `cli.pull` | `kalup pull` on a generated project whose config includes the seed property |
| `cli.plan` | `kalup plan --out plan.json`: two adopts and two creates, every one in the manifest, or apply does not run |
| `cli.apply-saved-plan` | `kalup apply plan.json --yes` on the unprotected test target |
| `cli.second-plan-no-effect` | A second `kalup plan` with nothing to do |
| `cli.drift-held` | A label edited through the API, as in the HubSpot UI, held as drift by the next plan |
| `cli.pull-only-takes-drift` | `kalup pull --only` takes the edit into config; the base-only apply after it leaves nothing to do. A plan with any other effect, or one outside the manifest, is not applied |
| `cli.rm-destroy-plan` | `kalup rm` and `allowDestroy: true` plan one delete, which `apply --yes` refuses with `E_APPROVAL_REQUIRED`. A plan with any other effect is not applied |
| `cli.delete-at-terminal` | The delete a person confirms at a terminal: the property reads archived and state drops its entry |

### Not answered by this run

The run leaves these open. Do not mark them settled from its evidence:

- Architecture 13.6, whether values come back when an archived property's name is reused: the run touches no records.
- Architecture 13.14, whether a group can be restored in the HubSpot UI: no API check can answer it.
- Architecture 13.7 beyond calculation properties: `archive-property-in-use` covers a property one of the run's own calculation properties uses (refused in run `89b45da9`); use in workflows, lists and forms, and any "where used" read, stay open, because the run creates none of those.
- Architecture 13.9 and 13.15 for scopes the run did not have: `read.scopes` answers only for the scopes granted, and `write.companies.missing-write-scope` only for the one scope the second key lacks.

## Reading the evidence

A run writes two files into `docs/conformance/runs/` (or `--out`): `<date>-<run id>.json` and a Markdown summary with the same name. The summary has one row per check, what was observed, the failed and not applicable checks, and the cleanup.

The JSON holds:

- `format` (`kalup-conformance/1`), `runId`, `mode` (`live` or `simulate`), `date`, the start and finish times, and `accountType`;
- `versions`: Kalup, Node, and the API version each family was pinned to;
- `key`: the variable the key came from and the scopes passed with `--scopes`, never the key;
- `summary`: counts of pass, fail and not applicable;
- `checks`: per check its `id`, `title`, `gate`, the `assumption` it tests, `status`, `reason` when not applicable, a short `note`, the observed `facts`, and every request the runner sent for it with method, path, status, time and HubSpot's `correlationId`. For the `cli.*` checks, `requests` holds only the runner's own requests. The requests each `kalup apply` sent come from Kalup's apply journal and sit under `journal` in the facts, with step, address, method, path template, status, category, subCategory, correlation ID, outcome and time. The requests `kalup pull` and `kalup plan` send are not recorded, only their exit codes and issue codes;
- `cleanup`: each manifest resource and what cleanup did to it;
- `requests`: the total and a count by status.

Before either file is written, the portal ID becomes `test-portal`, a custom object's type ID `custom-object`, HubSpot user IDs `[user]` and any email address `[email]`. The key never reaches them. The correlation IDs stay: HubSpot support can find a request by one. Other portal properties appear only as counts, and a portal property the run read by name shows as `{name}` in its request path.

## Cleaning up an interrupted run

The runner prints the cleanup command when it starts. If it stops early, or cleanup exits 3, run:

```sh
node scripts/conformance/run.mjs --cleanup <work>/manifest.json --portal <id> --i-own-this-test-portal <id>
```

It passes the same guard, refuses a manifest of another portal or one whose prefix is not `kalupconf_` and its own eight-character run ID, then archives each resource the manifest names that still exists, properties before groups, and prints one line per resource:

| Result | Meaning |
|---|---|
| `archived` | Archived now, and read back archived |
| `already-archived` | Already archived |
| `absent` | Not in the portal: the reads did not show it until 60 seconds after its last create was sent, so the create never landed |
| `unverified` | Archived, but it did not read back archived within 60 seconds; run the cleanup again |
| `failed` | The read or the archive failed; the status says why |
| `refused` | The manifest names it without the run prefix; it is never archived |

A manifest records every create before it is sent, so it can name resources that never existed; those come back `absent`. Right after an interrupted run, cleanup polls each missing resource for up to 60 seconds before it calls it absent. For a `failed` resource that keeps failing, archive it in HubSpot and note it in the evidence.

## After a run

The runner never commits. The founder decides what goes into the repository.

1. Read the Markdown summary, then the JSON of each failed check. A failed check is a finding about HubSpot, not a broken run.
2. Review both evidence files before committing them to `docs/conformance/runs/`: they are redacted, but read them once for anything that should not be public.
3. The conformance record, [hubspot-reference.md](hubspot-reference.md): replace each **UNVERIFIED** the run answered with what was observed, citing the evidence file.
4. [architecture.md](../architecture.md), section 13: mark each question the run settled, with the answer, and leave open the parts listed under "Not answered by this run".
5. For each failed check, change the simulator's choice in `packages/cli/test/support/portal-sim.ts` and its tests to what HubSpot did, then the adapter, as a separate reviewed change.

## Data rules

Fixtures, examples and tests keep invented data: invented names, portal IDs and keys. Live evidence is recorded separately, under `docs/conformance/runs/`, and redacted as described above. Never copy a value from a live run into a fixture or a test. The run's own resources carry invented `kalupconf_` names, and nothing from a client portal is ever read or recorded.
