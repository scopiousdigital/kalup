---
"kalup": minor
---

Per-target `definition` overrides are applied (ADR 0022). One effective configuration per target is used everywhere:

- `plan` and `apply` plan from the target's effective config, so a step's `desired` values, which the approval digest covers, are that target's own. A `definition` override no longer blocks a resource. A `lookup` override still does, with reason `override` and the detail that this version manages no lookup resources.
- `compare config <target>` (and `<target> config`) compares that target's effective config. A target side with a `definition` override is no longer `unknown`; one with a `lookup` override still is. `compare config config` and snapshot sides are unchanged.
- `pull --target <name>` writes the portal value of each field that target overrides into its override in `kalup.config.ts`, through the canonical writer, never into the shared object file. Other fields follow the normal rules, the base included, and another target's overrides are never read or written. The candidate project, config included, validates before any file is written, `kalup.config.ts` gets a history copy, and `--check --exit-code` counts a change there as a difference.
- `state rebuild` and `target rebind` record a base where the target's effective config and its portal agree, and a skipped group takes a property by the group it has on that target.
- `kalup docs` adds a `## Per-target overrides` table (address, field, target, value) when config has definition overrides.
- New pages `docs/errors/E_OVERRIDE_DEFINITION.md` and `W_OVERRIDE_OPTION.md`; `config.md`, `targets.md`, `pull.md`, `plan.md`, `compare.md` and `dictionary.md` describe the rules.
