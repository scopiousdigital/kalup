---
"@kalup/core": patch
---

The JSON Schemas are exported as `@kalup/core/schemas/<file>`, for example `@kalup/core/schemas/plan-1.schema.json`, so a tool reaches them without a deep import. The descriptions in `state-1.schema.json`, `plan-1.schema.json` and `ir-1.schema.json` now match the compatibility policy: `kalup.state/1` is a covered format, a new field in a closed schema is a new format version, and below an IR resource the `x` field and the definition of a type the schema does not describe stay open.
