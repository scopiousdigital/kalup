# 0014. The stays-free promise

## Status

accepted

## Date

2026-09-22

## Context

ADR 0013 chose Apache-2.0 and left one question open: whether to write a public promise that what runs on the user's machine or in CI stays free, and that the licence will not tighten. Writing it costs nothing today and removes options later. The website needs an answer, because the open-source page and the future cloud pages have to say where the line between them sits.

## Decision

Decided by the founder on 2026-09-22. Kalup makes this promise in the README and on the website:

> Everything that runs on your machine or in your CI against HubSpot's public APIs is free and stays free. The licence will not tighten.

The hosted service charges for what a laptop cannot provide: shared state with locking and history, and scheduled snapshots. It never charges for a feature the CLI already has.

## Alternatives considered

- **Leave the question open until the hosted service exists.** Keeps options, but agencies weigh adoption now, and every precedent in ADR 0013 lost trust by tightening later. Rejected.
- **Promise the licence only, not the free boundary.** Leaves room to move CLI features behind the hosted service. That room is exactly what the promise is meant to give up. Rejected.

## Consequences

- The README licence section and the website's open-source page carry the promise word for word.
- A feature that runs locally or in CI can never move to the hosted service only.
- Breaking the promise would cost the trust the project is built on. Treat it as permanent.
