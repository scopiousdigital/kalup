---
'kalup': minor
---

The document formats are ready for 1.x additions. After 1.0 a minor release may add a resource type or an optional field without a new format version, and an earlier 1.x handles what a later one wrote:

- `kalup.state/1` is open for additions: top-level fields, entries of any type and fields on an entry are accepted, and an entry's `origin` is any lowercase word (one this version does not know owns nothing). Plan, apply and pull keep what they do not know; `state rebuild` and `target rebind` keep an entry of a type this version does not manage as it is and list it in a new `kept` field. A state file still never holds a key or a target name.
- `ir/1` is open below each resource, coverage included. The values HubSpot defines (a property's `type`, `fieldType`, display hints and `dataSensitivity`, a stage's states) and a binding's `codec` are now strings, so a later version can record a value HubSpot adds. `compare` reports an address of a type it does not handle as `unknown`, which makes the comparison incomplete, and says to compare with a later version. Credentials on a target and an alias inside an option stay refused.
- `plan/1` stays closed: a plan is what apply runs. A saved plan with a step of a type this version does not handle is refused with `E_PLAN_INVALID`, naming the step and the version that made the plan; before, apply failed with an unexpected error.
- `docs/compatibility.md` says what is open, what stays closed and why, and what an earlier 1.x does with a later document.
