# E_TARGET_PORTAL_MISMATCH

The key belongs to another portal than the one pinned. Exit 4, `humanRequired: true`.

## When

Every command that reads a target first checks account-info with its key; `target rebind` checks the portal `--portal` gives. The key's portal differs, so nothing more is sent with that key and nothing is written. `status` still checks the other targets with their own keys.

## Fix

Stop. A person checks which key is in the variable and which portal `portalId` names. Agents: hand this to the user. Do not edit `portalId` or the key yourself, and do not run `target rebind`: it needs a person at a terminal. Changing the pin to match the key is how the wrong portal gets read.

When a test portal or sandbox was recreated under a new Hub ID, the person moves the target to it with `kalup target rebind <target> --portal <id>` at a terminal (see [state.md](../state.md#target-rebind)). Rebind accepts only a test portal or sandbox (`E_REBIND_STANDARD`), checks the key against the new portal and rebuilds state there.

## Example

```
E_TARGET_PORTAL_MISMATCH: The key in HUBSPOT_PROD_READ_KEY belongs to portal 3333333, not portal 2222222 pinned for target production. (fix: The key in HUBSPOT_PROD_READ_KEY belongs to portal 3333333. Ask the user to check the key and the pinned portalId for target production. For a recreated test portal or sandbox, the user can run kalup target rebind production --portal <id> in a terminal; it refuses STANDARD accounts.) (docs: errors/E_TARGET_PORTAL_MISMATCH.md)
```
