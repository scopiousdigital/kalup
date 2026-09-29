---
"kalup": minor
---

`kalup pull` reads the target's state (never writes it) and merges each resource state owns against its base, as `plan` classifies it: drift takes the portal's value, a config change keeps the file's (`kept`), a conflict keeps the file's and is a difference for `--check --exit-code` (`conflict`). An option config dropped stays dropped; an option HubSpot removed stays in the file (`removed-in-hubspot`).

An option config added is kept the same way (`kept`), so it is no difference for `--check --exit-code`, as `plan` writes it.

`--accept <address[#unit]>` (repeatable, `*` as in `--only`) takes the portal side of those units; one that matches nothing is `E_ACCEPT_UNMATCHED`, exit 1, followed by the warnings that may explain it, such as `E_SCOPE` and `E_INCOMPLETE`. Every kept line prints its `--accept` command. `plan` now prints `pull --accept` for an option HubSpot removed as well as for a conflict, so every portal-side command a plan prints converges its unit. Where no pull can take the portal side, `plan` prints no command and notes why: a property outside its object's pull scope, one whose portal type or `fieldType` its builder does not take, or one HubSpot moved into a group in `kalup/removed.ts`.
