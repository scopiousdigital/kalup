---
"kalup": patch
---

AGENTS.md rules and command help that match what the CLI does.

- AGENTS.md rule 3: never pass `--approve` or confirm for the user, and when any command exits 4, stop and show the user the command it prints. Rule 5: only `npx kalup rm <address>` asks for a delete, run only when the user asks for it, and the delete also needs `allowDestroy: true` and the user at a terminal.
- `--help` summaries: `init --target` names the target it writes, `validate --target` only checks that the target is declared, `status --target` checks one target, `ir --check` validates and prints only issues, and `apply --yes` covers at most 25 writes, adoptions and releases together.
- `docs/config.md`: `preventDestroy` blocks a destroy tombstone from `kalup rm`, where it said the field did nothing yet.
