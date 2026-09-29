# E_REBIND_STANDARD

`kalup target rebind` was pointed at an account that is not a test portal or a sandbox. Exit 4, `humanRequired: true`. Nothing was written.

## When

Rebind is for a test portal or sandbox that was recreated under a new Hub ID. It rewrites the pin in `kalup.config.ts` and adopts, by name, every config resource the new portal holds. It accepts only a `DEVELOPER_TEST` or `SANDBOX` account. Any other type, `STANDARD`, `APP_DEVELOPER` or one Kalup does not know, is refused: a `STANDARD` account is usually a production portal, where adopting by name alone is not a safe way to move a target.

## Fix

Stop and ask the user to check the portal ID. To move a target to a production portal on purpose, a person changes `portalId` in `kalup.config.ts`, runs `kalup plan` and reviews every adoption before applying it.

## Example

```
E_REBIND_STANDARD: portal 2222222 is a STANDARD account; rebind is only for recreated test portals (DEVELOPER_TEST) and sandboxes (SANDBOX). Nothing was written. (fix: ask the user to check the portal ID; to move a target to a production portal, change portalId in kalup.config.ts by hand and review the plan) (docs: errors/E_REBIND_STANDARD.md)
```
