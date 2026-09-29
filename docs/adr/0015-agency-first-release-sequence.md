# 0015. Release the agency workflow before the full SDK and cloud

## Status

accepted

## Date

2026-09-22

## Context

The product review found that the previous order put a full typed record client before the first configuration write, and left reusable configurations and hosted collaboration unordered. That delays testing the recurring agency job: understand an existing portal, review a change, apply it, and maintain the same setup across clients.

The founder accepted the review and is open to releasing an MVP before cloud. Existing Scopious infrastructure is a reuse candidate; choosing or migrating its database is not a prerequisite for the local product.

## Decision

Agencies with a technical HubSpot lead are the initial customer. Developers remain an adoption channel, and plans and documentation must be understandable to admins who do not author config.

Build in this order:

1. Harden the read-only foundation, then deliver compare, plan, snapshot and documentation. A clearly labelled read-only preview can reach design partners here.
2. Deliver a narrow local MVP with reviewed apply for properties and groups, state, coordination and recovery. Cloud is not a launch dependency.
3. Deliver versioned blueprints and upgrades that preserve client exceptions.
4. Run a hosted agency pilot for shared execution, scheduled observations, approvals and history.
5. Expand resource coverage, the typed record client and interfaces in response to observed use.

The codecs and inference remain in core. The complete typed CRM client is deferred. No marketplace, general executor plugin system or infrastructure rewrite is required for the MVP.

Public claims follow released functionality. A read-only preview does not advertise working apply. Cloud is not presented as shipped before the pilot exists. Apache-2.0 and the stays-free promise in ADRs 0013 and 0014 remain unchanged.

## Alternatives considered

- Wait for the complete cloud product. Delays learning from real portals and couples engine correctness to onboarding, billing and hosting.
- Finish the complete typed client before apply. Useful to developers, but does not test the primary agency workflow.
- Copy an existing Scopious application and migrate it upfront. The reusable infrastructure and the product's data model need separate decisions.

## Consequences

- The roadmap owns milestone numbering and scope. Architecture describes the target system, not a claim that every part is implemented.
- No cloud database or provider is selected by this ADR.
- An agent finishes its assigned coherent change, reports what remains and stops before taking another milestone. Existing work is preserved; changed priorities do not authorize a broad rewrite.
