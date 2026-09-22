# 0012. A neutral brand name

## Status

accepted

## Date

2026-09-22

## Context

The project's earlier working names combined "Hub" with a generic noun. HubSpot's written rules ban exactly that shape, and the ban binds Scopious three times over.

- The Trademark Usage Guidelines prohibit combining any HubSpot mark with your own name or a generic term, and registering a domain similar to a mark. HubSpot's own bad examples are "HubConnector", "HubSync", "SyncSpot" and "HubTheme".
- The Solutions Partner Promotion Guidelines, which the partner agreement makes binding, say: don't title a product "with the word HubSpot or 'Hub' in the title, or modify, imitate or abbreviate any HubSpot brands". A partner out of line must rename at its own cost. "Abbreviate" also rules out `hs` in package and binary names. The same guidelines ban "agency name + for HubSpot".
- The App Marketplace listing requirements say "do not combine HubSpot's name (including 'Hub' and 'HubSpot') with your app name or logo". Listings are reviewed by hand.

Enforcement is uneven. Several partners trade under Hub names today. HubSpot also sued over "Zoho MarketingHub" in 2020, and Zoho renamed the product 14 months later. The downside grows with success, and a name that breaks the rules hands HubSpot the cheapest takedown route there is: a trademark report to npm or GitHub. The Salesforce DevOps vendors (Gearset, Copado, Flosum, Salto) all won with neutral brands.

## Decision

The product is **Kalup**, always presented as "Kalup: configuration as code for HubSpot". The word is Slovenian for a mould, the thing you pour a portal into. It is distinctive enough to register as a mark later and short enough for the command line.

- "HubSpot" appears only as a descriptor, in plain text, with a capital S, never inside the brand, never in a logo. "Kalup for HubSpot" follows HubSpot's own approved pattern ("Hooli for HubSpot"). The fixed public form is still "Kalup: configuration as code for HubSpot". "CRM for HubSpot" (a generic word plus HubSpot) does not follow the pattern, and Kalup never uses that shape.
- Packages: `kalup` (CLI, binary `kalup`), `@kalup/core`, `@kalup/client`. The brand string lives in one constant in the CLI.
- Disclaimer in the README, the docs footer and `kalup --version`: "Kalup is an independent open-source project maintained by Scopious. It is not affiliated with, endorsed by, or sponsored by HubSpot, Inc. HubSpot is a registered trademark of HubSpot, Inc."
- Brand rules: no sprocket, gear or cog imagery, no HubSpot orange, no `hs` abbreviations in package or binary names, no HubSpot product names in feature names.
- Discoverability comes from the description, keywords and docs titles, not the name. That is referential use and it is where search traffic comes from anyway.
- The GitHub org is not decided. The research recommends a neutral org of the project's own, so rival agencies adopt it and the partner agreement stays at arm's length from the open-source brand. `repository.url` says `scopiousdigital/kalup` until that is settled.

Founder to-dos before anything is published, in order: a formal trademark search on EUIPO TMview and USPTO for classes 9 and 42; then register npm `kalup` and the `@kalup` scope, the GitHub org and `kalup.dev`; then publish a 0.0.0 placeholder on npm. The name is accepted subject to that search. No formal search has been done; web searches found no software product with the name, which is a weak signal only.

## Alternatives considered

- **Keep a Hub name.** Availability was never the problem; the handles were free. The rules and the takedown route were. Rejected.
- **"Scopious for HubSpot".** Named as a "don't" in the partner guidelines, and rival agencies would not adopt it. Rejected.
- **A descriptive name (a "crmplane" or "portalkit").** Passes HubSpot's rules but is a weak mark that is hard to register. Rejected.
- **Zasnova** ("design, blueprint" in Slovenian). Runner-up. Every handle including the GitHub org was free. Lost on sound and length for a CLI.

## Consequences

- File and folder names carry the brand (`kalup.config.ts`, `kalup/`, `.kalup/`), so a future rename would touch user repos. The trademark search is the guard against needing one.
- Every public surface carries the disclaimer, and design work starts from the brand rules.
- Nothing is published, and no org or domain is created, until the founder says so.
