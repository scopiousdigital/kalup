---
"kalup": patch
---

`kalup apply` checks a saved plan's objects and deletes against every address in config, and `--out` compares where the disk puts a path.

- A delete is refused (`E_PLAN_DELETE`) when another address in config names the same portal resource through a name override on the target. The message names `preventDestroy` when that address sets it.
- Every step but a release must be on an object `kalup.config.ts` declares under `objects`, and two steps that reach one portal resource through a custom object's type ID count as one (`E_BINDING_CHANGED`).
- `E_BINDING_CHANGED` and `E_PLAN_DELETE` say "Nothing was written": the portal guard has read the account by then.
- `--out` follows symbolic links, ignores case on macOS and Windows, and takes a relative `KALUP_STATE_DIR` from the project root, so no other spelling of a path reaches state, journals or locks. It refuses a symbolic link and the journal directory of `KALUP_STATE_DIR` too (`E_USAGE`).
