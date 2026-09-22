# 0010. A stored write key plus a TTY confirmation

## Status

accepted

## Date

2026-09-22

## Context

Destructive changes need a human confirmation. The hard part is the admin persona: no CI, an AI agent in the same shell, and a production portal. The command-surface design proposed a local approval step with typed words and OS keychain storage. Its review took it apart: the agent runs as the same OS user, it produced the plan and knows every word in it, it can read anything the CLI can read, and `protected` lives in a file the agent edits. The review's replacement was a write key that is never stored and is pasted at a no-echo prompt for every production apply.

The founder decided against the paste on 2026-09-22. The persona least able to absorb friction would carry all of it, and an admin might paste the key into the agent chat by mistake.

## Decision

Each target names a read credential and an optional write credential. Both are `{ env }` now and `{ keychain }` on paper. The write key may live in `.env`.

```ts
production: {
  portalId: 2222222,
  protected: true,
  credentials: { read: { env: 'HUBSPOT_PROD_READ_KEY' }, write: { env: 'HUBSPOT_PROD_WRITE_KEY' } },
}
```

Rules:

- Risky and destructive steps, and the first use of an executor on a target, need a person at a real terminal (`process.stdin.isTTY`) to type the target name and the destructive count. Without a TTY the command exits 4 and prints the exact command to run in a new terminal window.
- Protected targets accept only saved plans. `STANDARD` accounts are protected by default; turning that off is a visible hand edit in config.
- CI applies from secrets. A GitHub environment with required reviewers is the approval, and the CLI trusts that the environment gate released the key.
- The approval binds to `writesHash = sha256(sorted [address, action, config-side values, expected live hash] over writing steps)`. `apply` recomputes the plan from config and portal and trusts nothing else in the file. Drift lines, counts and times do not void an approval, a tampered title changes nothing, and there is no `expiresAt`.
- `--yes` refuses plans with more than 25 writes.
- `kalup target rebind` needs a TTY, takes `--portal <id>`, refuses `STANDARD` accounts, archives the old state file and prints "N of M managed resources found by name" before writing.

The honest limit, stated in every document that touches it: an agent with a shell on the same machine can read the key. The confirmation is an interlock against an over-eager agent, not a wall against a hostile one. CI or a hosted service is the real boundary. The hand-holding for the admin persona lives in AGENTS.md and CLAUDE.md, written by `init`.

## Alternatives considered

- **Write key only at a no-echo prompt, never stored (the review).** Stronger on a laptop. Rejected by the founder for friction and the paste-into-chat risk. If interviews show admins accept it, this ADR can be superseded.
- **Three approval verifiers with key management.** Two too many for one part-time founder, and none beats custody of the key. Rejected.
- **Typed words that appear only in the rendered plan.** The agent rendered the plan. Kept as an attention check, and the docs call it that.
- **`/dev/tty` handling.** Does not exist on Windows. Dropped.
- **A plan `expiresAt` of one hour.** Cannot survive a review gate where a reviewer may take a day. Dropped. The recompute is the freshness test.
- **A `.env` loader that refuses a protected target's write key.** Overruled by the founder's decision that the key may live in `.env`.
- **Deny rules in the agent's settings as the control.** Bypassed by `npx`, by the binary path and by `sh -c`. Kept as a hint.

## Consequences

- A production apply by hand means leaving the agent harness: open a terminal, run the printed command, type the target name and the count.
- The docs compare fairly: HubSpot's own MCP confirmation is enforced by the chat client and lands in HubSpot's audit log, so for a single change it is the stronger control. Kalup's advantage is the whole change set and the hold rule.
- Custody stays the rule in CI: the production write key exists only in the protected environment, so an agent on a laptop cannot apply there at all.
- Blast-radius record counts need record read scopes, which widen the agent's read key. They are optional per target and off by default.
