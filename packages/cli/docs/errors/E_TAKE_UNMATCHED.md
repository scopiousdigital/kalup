# E_TAKE_UNMATCHED

A `--take` selector names nothing it can take. Exit 1. Nothing was written.

## When

`kalup plan --take config <address[#unit]>` writes config over held units and recreates a missing property. Each selector must match a held unit (`drift`, `conflict` or `diverged`) or a resource listed in `missing`; a unit that already agrees, a config change or a typo matches nothing. The message lists the units held on the addresses the selector names, and names a missing resource a `#unit` selector matched: only the address alone recreates it.

`kalup blueprint upgrade --take remote <address[#unit]>` must match a conflict of the upgrade, or one the lock holds when the version is unchanged.

## Fix

Run the command without `--take`, pick a held unit, missing resource or conflict from its output, and pass that. A selector without `#unit` takes every unit on the address; `*` in the address works as in `--only`.

## Example

```
E_TAKE_UNMATCHED: --take config property:companies/billing_status#description matches no held unit and no missing resource; held there: property:companies/billing_status#label (fix: take a held unit or a missing resource that kalup plan --target production lists, or leave the selector out) (docs: errors/E_TAKE_UNMATCHED.md)
```
