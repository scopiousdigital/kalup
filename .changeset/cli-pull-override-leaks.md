---
"kalup": patch
---

`pull --target <name>` no longer carries one target's values into the shared object file through its `definition` override (ADR 0022):

- A field only the override's `lifecycle.ignoreChanges` names is left to that portal. The file keeps its value, printed `ignored on this target, kept as written` (`kind: 'ignored'`), which is no difference for `--check --exit-code`. Before, the portal's value went into the shared file and every other target's next plan pushed it.
- A property whose `group` the override states, moved in HubSpot into a group config does not declare, keeps the override's group, printed `its portal group is not in config, override kept` (`kind: 'override-group'`), a difference. Before, pull added that group to the shared file, so every other target's plan created it.
- An explicit `options: []` in the object file survives a pull where state holds a base, as `fmt` keeps it.
- The changed files, `kalup.config.ts` and the object files together, are written as one staged write: a failed write puts every file back with `E_PROJECT_WRITE`, exit 1, instead of leaving `kalup.config.ts` naming a group the object file lacks.
- `E_INCOMPLETE` docs name a `lookup` override, not a `definition` override, as what makes a compare address unknown. `config.md` and `pull.md` are back under 900 words.
