# Apply

`kalup apply <plan-file> [--yes | --approve <writesHash>]` applies a plan saved by `kalup plan --out` to the target it names. `kalup apply [--target <name>] [--take config <selector>] [--yes]` plans an unprotected target now and applies that plan through the same checks. Apply writes property groups and properties, on custom objects too, and never a custom object schema.

## Approval

A plan with any effect (a write, adoption, release, delete or base record) needs one approval:

- **A person at a terminal**: stdin and stderr are terminals, no `--json`, `CI` unset. Apply prints the target, portal, account type, protection, each step in words from its data (never the plan's titles, with a differing portal name) and the counts, then asks for the target name and, for deletes and takeover option removals, the number of destructive steps. A wrong answer or the end of input is `E_CANCELLED`.
- **`--yes`**: an unprotected target, no step Kalup derives as risky or destructive, at most the target's `yesLimit` (default 25; `0` turns `--yes` off) writes, adoptions and releases. It trusts the file once its digest matches, never past the risk or delete rules.
- **`--approve <writesHash>`**: a reviewed CI job. The digest must equal the file's recomputed `writesHash` (`E_APPROVE_MISMATCH`), and the target must name its own `credentials.write`, read from the process environment, with no `.env` defining it (`E_APPROVE_CREDENTIAL`). It covers protected targets and risky steps, and shows only that the writes equal a reviewed digest, not that a review happened. A write key exported in a workstation shell satisfies it too, so keep that key only in CI. Agents never pass it.

Every delete, and every option removal takeover asks for, needs the person at a terminal. Otherwise apply stops with `E_APPROVAL_REQUIRED`, exit 4, printing the command. A protected target accepts only a saved plan (`E_PROTECTED_SAVED_PLAN`).

The terminal question stops an over-eager agent, not a hostile one: anything with a shell on the machine can read its keys.

## What apply checks

Before any write, in order:

1. The file is `plan/1` from this release line (`E_PLAN_VERSION`, `E_PLAN_INVALID`), and `writesHash` and `planId` recomputed from it match (`E_PLAN_DIGEST`). A plan with nothing to apply exits 0 with no request.
2. `kalup.config.ts`: the target is declared and pins the plan's portal (`E_PLAN_DESTINATION`). Later config edits change nothing it writes.
3. The write key (`credentials.write`, else the read key) passes the portal guard. Every request, reads included, uses it.
4. The policy equals the plan's: `protected`, `drift`, `adopt`, `allowDestroy`, `yesLimit` and the objects in takeover (`E_POLICY_CHANGED`); each step's API version is current and unexpired, and the normalizer versions match (`E_PLAN_VERSION`).
5. Every step but a release is on an object `kalup.config.ts` declares, the name bindings match the target's name overrides, and no two steps but releases resolve to one portal resource (`E_BINDING_CHANGED`).
6. Each delete has a `destroy` tombstone in `kalup/removed.ts` or takeover's leave (takeover mode, in the pull scope, not excluded), is gone from config, and no address in config names its portal resource, read as data (`E_PLAN_DELETE`). The object files also tell takeover's option removals from config's own.
7. Approval, then the portal lock (`E_LOCKED`).
8. State: a plan already applied with outcome `done` exits 0 ("Already applied"); otherwise lineage and serial equal the plan's (`E_STATE_CHANGED`).
9. A fresh read of each object the plan changes, and of the schemas list for a custom object (`E_INCOMPLETE` on a 403, `E_BINDING_CHANGED` for another type ID). Every `expect` must hold (`E_PLAN_STALE`), a delete's covering each field its base holds. Kalup derives each step's risk, labels and blocked status again (`E_PLAN_RISK` when the plan states less); a takeover removal needs `allowDestroy`, and never takes a HubSpot-defined property.
10. Three calls per write plus the reads use at most half of HubSpot's daily remainder (`E_BUDGET`).

## Running the steps

Apply records `lastApply.outcome: running`, then runs the steps one at a time: groups, properties, releases, then deletes, properties before groups. Each write reads the resource again and compares it with `expect`, builds the request from that read, sends it once, and reads it back for up to 60 seconds, saying so on stderr after a few seconds.

- A property update sends the approved fields with the live `type` and `fieldType`; options go as the full live list with the approved changes, new ones last.
- A 429, 423 or 477 is waited out three times, reading again before each resend. A daily 429 stops the run.
- A timeout, network failure or 5xx is `uncertain` and never resent: HubSpot documents no idempotency keys. Only reading back the approved values settles it (`E_UNCERTAIN_WRITE`).
- A value HubSpot stores differently is `W_UNVERIFIED`: state records both, and the next plan notes it instead of writing again.
- A delete runs only once every earlier step verified. HubSpot keeps an archived property restorable in its UI for 90 days.

State is saved after each step that changes an entry, then the outcome: `done`, `partial` or `uncertain`. Each request is journaled in `.kalup/journal/portal-<id>/`, never with a key or body. SIGINT or SIGTERM stops before the next request and saves state. A second one exits at once, unless it comes within a second (npx passes one Ctrl-C on twice).

## Outcomes and exit codes

Each step in `data.steps` is `done`, `unverified`, `uncertain`, `rejected`, `stale`, `not-run` or `blocked`; a blocked one carries the plan's `reason`. The text ends every run, `Nothing to apply` included, with `N blocked, not run:` and each blocked address, reason and detail, and with `N held units, not written:` and the `kalup plan` command that shows them and how to settle them.

| Exit | When |
|---|---|
| 0 | Every effect verified, nothing to apply, or already applied |
| 1 | A check refused, or no write could have landed and no state entry changed |
| 3 | Config invalid |
| 4 | The portal guard, `E_APPROVAL_REQUIRED`, `E_APPROVE_CREDENTIAL` |
| 5 | A write landed or may have, or a state entry changed, and not every effect verified |

## Recovery

There is no resume and no rollback. After a run that did not finish, run `kalup plan --target <name>`: it compares the portal with the kept state. A property an interrupted create made shows as an adopt, never a second create.

## Limits

A read and the write after it are not atomic: an edit in HubSpot between the two is overwritten for that field. The lock keeps apart one user's commands on one machine only; in CI, one workflow per portal applies, in a concurrency group. A delete checks no use first; HubSpot refused to archive a property a calculation property used (developer test account, 2026-09-29).
