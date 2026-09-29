---
"kalup": patch
---

The bin, the AGENTS.md rules and the shipped docs.

- The `kalup` bin is now `bin/kalup.mjs`, a committed file that runs `dist/index.mjs`. pnpm links it at install time, so `pnpm exec kalup` works in a fresh clone after `pnpm install && pnpm build`; before the build it exits 1 and says to run `pnpm build` first.
- AGENTS.md runs Kalup as `npx --no-install kalup` until the first release, so npx never downloads an unrelated package that holds the name. Rule 6 warns that a key a target names in `credentials.write` satisfies `--approve` when a shell on the machine exports it, so that key belongs only in the CI environment.
- `docs/apply.md` and `docs/errors/E_APPROVE_CREDENTIAL.md` give the same warning. `docs/errors/W_LIMIT_HEADROOM.md` says plan no longer reads the custom object limit, since custom object creates are unsupported. `docs/state.md` says `--json` never carries a rebuild's write or a rebind, since both run only at a terminal.
- The shipped docs run Kalup as `npx --no-install kalup` too, except where they quote the fix text the CLI prints.
