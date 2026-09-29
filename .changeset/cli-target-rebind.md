---
"kalup": minor
---

`kalup target rebind <target> --portal <id>` points a target at a recreated test portal or sandbox (ADR 0021). A terminal only; the target's write key must belong to the new portal, which may not be pinned by another target (`E_DUPLICATE_PORTAL`) or be a `STANDARD` account (`E_REBIND_STANDARD`, exit 4). It takes both portal locks in ascending order, refuses an unreadable old state file (`E_STATE_INVALID`) or an incomplete read (`E_INCOMPLETE`) before any write, reports how many managed resources the new portal holds by name, writes the new portal's state as `state rebuild --write` does, rewrites `portalId` in `kalup.config.ts` through the staged write, and archives the old portal's state. A plan saved for the old portal is then refused by apply. `state` and `target` are oclif topics: `kalup state rebuild`, `kalup target rebind`.
