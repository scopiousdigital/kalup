---
"kalup": minor
---

Milestone 1 of the CLI, read-only. `init --portal <id>` checks the key against the portal, writes `kalup.config.ts`, `kalup/`, the `.kalup/` gitignore line, the formatter ignore and AGENTS.md, then runs the first pull. `pull --target <name>` reads properties, property groups and custom object schemas through the 2026-09 APIs and merges them into `kalup/objects/*.ts` without losing keys, aliases, chains, comments or lifecycle blocks, with `--only`, `--discover`, `--check` and per-target `name` overrides. `validate`, `ir`, `fmt` and `status` complete the set. Every command takes `--json` and prints one `envelope/1` document; exit codes are 0 done, 1 error, 2 differences with `--exit-code`, 3 invalid config, 4 a person must act. Only read-tagged registry paths are ever sent, the portal guard stops a command whose key belongs to another portal, and old files are copied to `.kalup/history/` before they are overwritten.
