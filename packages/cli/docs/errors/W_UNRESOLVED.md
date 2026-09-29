# W_UNRESOLVED

A warning from validate: a resource carries an `$unresolved` marker. Exit stays 0.

## When

The marker stands for a portal ID that could not be mapped to an address. In this version no command writes it and the config grammar has no place for it, so it should not appear.

## Fix

If you see it, report it with the command you ran. The `kalup bind` command its fix names does not exist yet.

## Example

```
W_UNRESOLVED: workflow:renewal_reminder carries team ID 8841 from target production, which no address maps to (fix: run kalup bind workflow:renewal_reminder 8841 --target <target> to map it, or replace it with a $ref) (docs: errors/W_UNRESOLVED.md)
```
