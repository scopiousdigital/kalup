---
'kalup': minor
---

Reads that settle after a write. A plan right after an apply no longer shows what apply just wrote as held drift, or a custom object it just created as missing. For some minutes after a write HubSpot can serve the copy from before it, and nothing in its answer tells that copy from a colleague's edit.

- Apply records in state, per resource, each value it wrote and verified and when. For 5 minutes after that write, a read that shows another value there, or leaves out a resource apply created, makes the resource settling. A settling resource is unknown to every command.
- `plan` blocks its step with the new reason `settling` and a fix that says when to plan again, and `W_SETTLING` warns. Nothing is held, created, deleted or written for it.
- `pull` keeps the file's side of it and records no base for it. `compare` reports it unknown and says when to compare again. `snapshot` lists it. `state rebuild --write` and `target rebind` refuse the read, as for any incomplete read.
- A change to a value apply did not write is drift as before, inside the window too. After the window the read is believed again.
- An association label HubSpot's schema read does not name yet, a few minutes after its create, is blocked `settling` instead of `scope`, makes the read incomplete and warns `W_SETTLING`.

Document formats changed in place in this release: a `kalup.state/1` resource entry may hold `written`, each unit apply wrote and the time it did. In `ir/1`, `coverage.settling` names each settling resource with its reason (`stale` or `missing`) and when its window ends. In `plan/1`, `blocked.reason` gains `settling`. `W_SETTLING` is a new issue code. As after any minor release, plan again before applying a plan saved with an earlier one.
