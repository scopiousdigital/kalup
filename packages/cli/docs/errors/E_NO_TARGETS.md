# E_NO_TARGETS

`kalup.config.ts` declares no targets, so a command that reads a portal has none to read. Exit 3.

## When

`pull`, `plan` and `snapshot`, after the config validates and before any request. `validate`, `ir`, `fmt` and `docs` need no target.

## Fix

Declare one under `targets` with the portal's Hub ID, for example `targets: { prod: { portalId: 1111111 } }`. The name is yours to choose. `kalup init --portal <id>` writes one for a new project.

## Example

```
E_NO_TARGETS: kalup.config.ts declares no targets (fix: declare one under targets, for example targets: { prod: { portalId: <Hub ID> } }) (docs: errors/E_NO_TARGETS.md)
```
