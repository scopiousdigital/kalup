# E_SETTING_LEVEL

A setting in kalup.config.ts is at a level that does not allow it. Exit 3.

## When

Each setting has the levels it may stand at. `mode` goes at the top level, under `objects.<object>`, under `targets.<target>` or under `targets.<target>.objects.<object>`. `include`, `exclude`, `custom` and `as` go under `objects.<object>`, and are never per target. `protected`, `drift`, `adopt`, `allowDestroy` and `yesLimit` go under `targets.<target>` only: a portal opts itself in, so none of them is inherited from the project or an object. No setting goes in an override or a property definition.

## Fix

Move the setting to one of the levels the fix lists, each with a snippet. The most specific statement of `mode` wins: `targets.<target>.objects.<object>`, then `targets.<target>`, then `objects.<object>`, then the top level.

## Example

```ts
objects: { companies: { allowDestroy: true } },
```

```
kalup.config.ts:6: E_SETTING_LEVEL: allowDestroy is not allowed in objects.companies (fix: move it to targets.<target> (targets: { sandbox: { allowDestroy: true } })) (docs: errors/E_SETTING_LEVEL.md)
```
