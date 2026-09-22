# 0013. Licence

## Status

accepted

## Date

2026-09-22

## Context

The repo is MIT today: `LICENSE` at the root and the `license` field in both `packages/cli/package.json` and `packages/core/package.json`. Nothing has been published, so the licence can still change at no cost. It cannot change cheaply later: HashiCorp (MPL to BSL, 2023) and Liquibase (Apache-2.0 to FSL, 2025) both took public damage from tightening, and HashiCorp's provider ecosystem, which was its moat, left with the OpenTofu fork. dbt moved its new engine to a source-available licence in 2025 and reversed to Apache-2.0 in June 2026.

Kalup's buyers are agencies, and its adoption depends on rival agencies trusting that the open core stays open. Three research dossiers want a "this licence will never change" line in the README, and one wants the free boundary written down: everything that runs on the user's machine or in CI against public APIs is free.

Two facts shape the recommendation. Apache-2.0 carries an express patent grant and a trademark clause; the trademark clause supports the neutral-brand plan in ADR 0012, since the mark becomes the one lever left once the code is free. And blueprint content is source that gets copied into user repos, where Apache's NOTICE rules are awkward.

## Decision

Decided by the founder on 2026-09-22:

- Engine, CLI, client and code generators: **Apache-2.0**, with a Developer Certificate of Origin on contributions. `LICENSE` and `NOTICE` at the repo root, `"license": "Apache-2.0"` in every published package.
- Blueprint content: **MIT or 0BSD**, with a statement that generated output belongs to the user. The file lands with the first blueprint.
- A DCO, not a Contributor Licence Agreement. Apache-2.0 already lets the maintainer build closed products on top. A CLA adds little and signals a future rug pull; HashiCorp's CLA is what made its relicense possible. The DCO check in CI lands with the first outside contribution.

Still open:

1. Whether to write the public promise into the README: that features running on the user's machine or in CI against public APIs stay free, and that the licence will not tighten. It costs nothing to write today and removes options later.
2. Whether any future closed component needs a licence of its own. Nothing of the kind is planned in the next two milestones, so this can wait.

## Alternatives considered

- **Stay on MIT.** Simplest and most familiar. No patent grant and no trademark clause. Rejected: the trademark clause is the one lever left once the code is free, and the patent grant costs nothing.
- **A source-available licence (BSL, FSL, ELv2) for the core.** Blocks or spooks the agencies who are the buyers, and every precedent above lost ecosystem trust for it. Rejected for the core.
- **Apache-2.0 for blueprint content too.** NOTICE obligations follow the copied files into every client repo. Rejected in favour of MIT or 0BSD.
- **A CLA.** See above. Rejected.
- **Deciding later, after publication.** Every install, blog post and backlink raises the cost of a change. Rejected; the decision is due before the first public commit.

## Consequences

- `LICENSE` is the Apache-2.0 text, `NOTICE` names Scopious, and both published packages declare `Apache-2.0`. Done on 2026-09-22.
- A DCO check in CI and a separate licence file for blueprint content are owed when those become relevant.
- The public promise in open question 1 is a separate line in the README and a separate decision. Writing it is irreversible in practice.
- Changing this licence later would cost the trust the project is built on. Treat it as permanent.
