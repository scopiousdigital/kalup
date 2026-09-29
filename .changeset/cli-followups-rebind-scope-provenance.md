---
"kalup": patch
---

Follow-ups to target rebind, the pull scope and blueprints.

- `E_TARGET_PORTAL_MISMATCH` for a named target adds to its fix that, for a recreated test portal or sandbox, the user can run `kalup target rebind <target> --portal <id>` in a terminal, which refuses `STANDARD` accounts. The fix still never says to change the pin. `init` has no target yet, and `target rebind` checks the portal `--portal` gives: both now word a mismatch against `--portal` and never suggest rebind.
- A property outside its object's pull scope (not in `include`, and HubSpot-defined or under `custom: false`) gets no `kalup pull --only` command, which would do nothing: `compare`'s note on an option only the portal holds, and `plan`'s blocked step for a property the portal holds as HubSpot-defined or calculated, say to add the name to `objects.<object>.include` in `kalup.config.ts` instead. The read records each property's `hubspotDefined` for this.
- A plan step for a resource a blueprint provides carries its `provenance` (create, adopt, update, delete). It is for display and not part of `writesHash`.
