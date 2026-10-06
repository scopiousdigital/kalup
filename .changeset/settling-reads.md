---
'kalup': minor
---

Reads that settle after a write. A plan right after an apply no longer shows what apply just wrote as held drift, or a custom object it just created as missing. For some minutes after a write HubSpot can serve the copy from before it, and nothing in its answer tells that copy from a colleague's edit.

- Apply records in state, per resource, each value it wrote and verified and when, and when it last wrote the resource at all. For 5 minutes after that write, a read that shows another value there, or leaves out the resource, makes the resource settling, whatever its origin. A settling resource is unknown to every command. A write time ahead of the reading clock counts as now, and one more than 5 minutes ahead settles nothing.
- `plan` blocks its step with the new reason `settling` and a fix that says when to plan again, and `W_SETTLING` warns. Nothing is held, created, deleted or written for it, and a destroy tombstone on it neither deletes nor releases it until the window ends. A release tombstone still releases.
- `pull` keeps the file's side of it and records no base for it, and `pull --check --exit-code` exits 2 while anything settles. `compare` reports it unknown and says when to compare again, or to take a new snapshot. `snapshot` lists it and says when to take the next one.
- Takeover waits only while something on the object it removes from settles. `state rebuild --write` and `target rebind` refuse only while something config names settles, and say when to run again.
- A change to a value apply did not write is drift as before, inside the window too. After the window the read is believed again.
- An association label HubSpot's schema read does not name yet, a few minutes after its create, is blocked `settling` instead of `scope`, makes the read incomplete and warns `W_SETTLING`.

Document formats changed in place in this release: a `kalup.state/1` resource entry may hold `written`, each unit apply wrote and the time it did, and `writtenAt`, when apply last wrote the resource. In `ir/1`, `coverage.settling` names each settling resource with its reason (`stale` or `missing`) and when its window ends. In `plan/1`, `blocked.reason` gains `settling`. `W_SETTLING` is a new issue code. `coverage.complete` keeps its meaning: false whenever the read leaves anything unknown. As after any minor release, plan again before applying a plan saved with an earlier one.
