---
"@kalup/core": minor
---

`defineObject` and `defineCustomObject` accept an export with no `properties`, typed as no properties. The canonical writer leaves out an empty `properties` block, as `kalup rm` does after removing an object's last property, so that file now compiles and loads in the app. The plan schema's held units document every reason a portal-side command is left out: a shadowed name, a property outside its pull scope, a type or `fieldType` its builder does not take, or a portal group in `kalup/removed.ts`.
