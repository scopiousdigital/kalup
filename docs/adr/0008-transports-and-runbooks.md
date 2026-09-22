# 0008. Transports per resource type, and runbooks for the rest

## Status

accepted

## Date

2026-09-22

## Context

HubSpot has no metadata API. Coverage is built one resource type at a time, and much of what an admin configures has no public write API: record page layouts, saved views, conditional property logic, stage required properties, pipeline automation, permission sets, playbooks and more. Other types exist only in a beta that changes twice a year.

A tool that is silent about those gaps misleads the person reading the plan. An admin who promotes a pipeline will believe its stage required properties came across. They did not, and nothing can copy them.

## Decision

Every plan step names its `transport`, an open string. The open-source core documents three values and writes only these:

- `public-api`: a GA, date-versioned endpoint from the registry.
- `public-beta`: a documented beta endpoint, enabled per resource type by a flag in project config.
- `runbook`: no endpoint can carry the change. The plan emits the exact manual steps.

A runbook is the exact manual steps for one change: the settings URL built from the target's `uiDomain`, the fields, the values, and a verify check. Runbook types have no live side. `plan` compares config with the `baseHash` in state (later milestone) and emits a `manual` step when they differ. `kalup attest <address> --target X` records that a person did the step and sets `baseHash` and `attested { by, at }`. These resources are labelled `unverifiable`, because UI edits to them are invisible.

Each resource type also carries a static `notCovered` list, printed once per type in any plan that touches it:

```
1 SAFE   Create deal pipeline "Renewal" with 5 stages
         Not copied, HubSpot has no API: required properties per stage, stage automation.
```

The executor seam. A `RunbookExecutor` registered from project config may fulfil a runbook step instead of a person. The core sets the rules and names no executor:

- The core's vocabulary has no `remote`. A plan made with no executor registered is the plan every open-source user gets.
- `run()` returns `done`, `pending`, `failed` or `unavailable`. `pending` behaves like a printed runbook step waiting for confirmation.
- Jobs and results carry canonical attrs only, validated against the type's JSON Schema. Resource types for no-API assets stay in the core, in HubSpot UI vocabulary, so the runbook works for everyone.
- An executor must carry a `disclosure` string. The core refuses an empty one and prints its own fixed sentence first.
- First use on a target needs the same human confirmation as a destructive step, bound to the hash of the disclosure text. An agent cannot acknowledge it.
- Exactly one dynamic import exists, in the CLI (`load-executors.ts`), fed from project config.

Disclosure lives where users decide: each plan step's `transport` and `fulfilment`, the state entry's `via`, the apply record, a per-target switch in config, and one paragraph on the coverage docs page. It stays out of the README, the homepage, AGENTS.md, `fix` strings, MCP tool descriptions, registry items and release notes.

## Alternatives considered

- **A closed `transport` enum in the public plan schema.** A new kind would need `plan/2`. Rejected. Consumers treat unknown values as opaque.
- **Silence on what an API cannot carry.** Rejected. `notCovered` prints every time.
- **Executors shipping their own resource types.** The plan format would depend on what is installed, and users without the executor would have no runbook. Rejected.
- **Raw payloads across the seam.** Anything outside the type's schema would land in the journal. Rejected; the core fails closed.
- **A CLI flag standing in for the disclosure.** The reader of the plan is often an agent, and the duty is to inform the person. Rejected.
- **HubSpot's own Agent CLI as a transport.** Not assessed. Open for a spike.

## Consequences

- The coverage matrix is generated from the registry and shows `runbook` for every type without an endpoint. It cannot overstate coverage.
- Drift on runbook types is invisible. Generated docs print "marked done, not verified".
- Runbook deep links depend on undocumented settings URLs that differ per data region.
- A policy tool that wants to forbid machine-driven manual steps looks at `fulfilment`, not `transport`.
- A runbook type that gains a public endpoint moves to `public-api` with no format change.
