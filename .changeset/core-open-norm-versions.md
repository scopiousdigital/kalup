---
"@kalup/core": patch
"kalup": patch
---

`plan/1` records normalizer versions as a map keyed by resource type (property, group and object always present), so a later resource type needs no new plan format. `kalup apply` refuses a plan that names a normalizer this version does not have, with `E_PLAN_VERSION`.
