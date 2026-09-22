# E_TARGET_PORTAL_MISMATCH

The key belongs to another portal than the one pinned. Exit 4, `humanRequired: true`.

## When

`pull` and `status` read account-info with the target's key before anything else; `init` does the same against `--portal`. The key's portal differs from the pin, so nothing more is sent with that key and nothing is written. `status` still checks the other targets with their own keys.

## Fix

Stop. A person checks which key is in the variable and which portal `portalId` names. Agents: hand this to the user and do not edit `portalId` or the key yourself. Changing the pin to match the key is how the wrong portal gets read.

## Example

```
E_TARGET_PORTAL_MISMATCH: The key in HUBSPOT_PROD_READ_KEY belongs to portal 3333333, not portal 2222222 pinned for target production. (fix: The key in HUBSPOT_PROD_READ_KEY belongs to portal 3333333. Ask the user to check the key and the pinned portalId for target production.) (docs: errors/E_TARGET_PORTAL_MISMATCH.md)
```
