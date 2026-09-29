# 0020. Select the target from the flag, a default, or the only target

## Status

accepted

## Date

2026-09-24

## Context

`pull`, `plan` and `snapshot` required `--target <name>` even in a project with one portal. A solo admin typed the name of the only portal on every command, and the error for a missing flag came before the config was read, so it could not say which names exist. The founder's v1 assignment specifies the replacement rule: targets are names the user chooses for pinned portals, with no required sandbox, production target, portal count, naming convention or deployment order.

## Decision

`kalup.config.ts` takes an optional top-level `defaultTarget`, a string that must name a declared target. An undeclared name is `E_DEFAULT_TARGET`, a config error (exit 3). The reader, the canonical writer and `fmt` keep it. It stays out of the IR: it picks a target for a command, it is not part of what the config means, and carrying it would change `irHash` without changing a plan.

A command that needs one target resolves it once, through one shared rule, after the config loads and validates:

| Situation | Result |
|---|---|
| `--target <name>` | That target. An undeclared name is `E_UNKNOWN_TARGET` (exit 3) with no fallback |
| No flag, `defaultTarget` set | The default |
| No flag or default, one target | The only target |
| Several targets, none selected, an interactive terminal | A selector on stderr listing each name with its portal ID; the command continues with the choice |
| Several targets, none selected, `--json`, no terminal, or `CI` set | `E_TARGET_REQUIRED` (exit 1) listing the names and portal IDs, before any request |
| No targets | `E_NO_TARGETS` (exit 3) |

Interactive means stdin and stderr are terminals, `--json` is absent and `CI` is not set. Cancelling the selector (end of input or Ctrl-C) is `E_CANCELLED` (exit 1) before any request or file write. The first of several targets is never chosen for the user.

Selection is local to one invocation. Kalup keeps no active target and does not remember a previous choice.

A name carries no meaning. Protection, drift policy and deployment order come from explicit config and from the documented conservative default for verified account facts (`protected` defaults to true for a `STANDARD` account). Selecting a target automatically never approves a write.

The pure rule is `selectTarget(config, requested?)` in `@kalup/core`, which returns the selection or the reason there is none, with the choices. Prompts live in the CLI host only, so a host without a terminal gets the same deterministic result.

Scope:

- `pull`, `plan`, `snapshot` and every later command that needs one target use the rule.
- `status` lists every target unless `--target` filters it, and marks the default.
- `compare <a> <b>` names both sides.
- `validate`, `ir`, `fmt` and `docs` stay offline and need no target.
- `init --target <name>` names the new target; without it, the account type suggests a name, which is a convenience and not a role.
- `apply` of a saved plan uses the destination pinned in the plan. Changing `defaultTarget`, adding a target or selecting another one cannot redirect an approved plan.

Human output names the resolved target and its portal ID, and says how it was chosen when it was not the flag. JSON output carries the target in the command's existing data and adds nothing else.

## Alternatives considered

- **Keep `--target` required.** Safe but tedious for the most common project, a single portal, and the error cannot list the names because it runs before the config is read. Rejected.
- **Pick the first declared target.** Declaration order is an accident of editing, and a reordered file would silently change the portal a command reads. Rejected.
- **Remember the last choice, like a `use` command.** Hidden state that makes the same command read different portals on different days. Rejected.
- **Exit 4 when several targets and no selection.** Exit 4 means only a person can proceed. Here an agent can pass `--target` once the user says which portal, so the error is exit 1 and its fix tells the agent to ask.
- **`default: true` on a target.** Two targets could claim it, and the target schema in the IR is closed. Rejected for one top-level name.

## Consequences

- A one-portal project runs `kalup pull`, `kalup plan` and `kalup snapshot` with no flag.
- Fix hints and printed commands still name the target explicitly, so they mean the same thing if the default changes later.
- Tests cover one, two and three targets, arbitrary names, an explicit flag over a default, an invalid default, cancellation, and JSON and non-terminal runs, through the built executable as well as the resolver.
- State and approval are bound to the verified portal ID, not to the name (see the apply records), so renaming a target cannot create a second owner of the same resources.
