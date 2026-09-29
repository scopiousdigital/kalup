# E_TARGET_REQUIRED

A command that runs against one target found several, none selected by `--target` or `defaultTarget`, and no person at a terminal to choose. Exit 1.

## When

`pull`, `plan` and `snapshot`, after the config validates and before any request or file write. With `--json`, without a terminal, or with `CI` set, the command cannot ask, so it lists the names and portal IDs instead. At a terminal it asks on stderr. Kalup never picks the first target for you. See [Choosing a target](../targets.md#choosing-a-target).

## Fix

Pass `--target <name>` with one of the listed names, or set `defaultTarget` in `kalup.config.ts`. An agent should ask the user which portal to use, then pass `--target`.

## Example

```
E_TARGET_REQUIRED: kalup.config.ts declares 2 targets and none is selected: sandbox (portal 1111111), production (portal 2222222) (fix: pass --target <name>, or set defaultTarget in kalup.config.ts. An agent should ask the user which portal to use.) (docs: errors/E_TARGET_REQUIRED.md)
```
