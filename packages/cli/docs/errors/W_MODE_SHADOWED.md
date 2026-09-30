# W_MODE_SHADOWED

A warning from validate: a target's `mode` overrides the mode an object states. Exit stays 0.

## When

`targets.<target>.mode` wins over `objects.<object>.mode` on that target. When the two differ and the target states nothing for that object under `targets.<target>.objects`, the object's statement has no effect there, which is easy to miss when you read `objects` alone.

## Fix

If that is intended, state it for the object on the target, under `targets.<target>.objects.<object>.mode`, and the warning goes. Otherwise remove one of the two statements.

## Example

```
kalup.config.ts:14: W_MODE_SHADOWED: targets.sandbox.mode 'addon' overrides objects.companies.mode 'takeover' on target sandbox (fix: state it under targets.sandbox.objects.companies.mode, or remove one of the two) (docs: errors/W_MODE_SHADOWED.md)
```
