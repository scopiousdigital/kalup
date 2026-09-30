# E_SETTING_VALUE

A setting in kalup.config.ts has a value it does not allow. Exit 3.

## When

`mode` takes `'addon'` or `'takeover'`; `drift` and `adopt` take `'hold'` or `'overwrite'`; `yesLimit` takes an integer from 0 to 1000. The fix names the nearest allowed value.

`validate` also reports a name that `include` and `exclude` of one object both list, and a `targets.<target>.objects` key that `objects` does not declare.

## Fix

Write the value the fix suggests, or another allowed one. Remove a name from one of `include` and `exclude`.

## Example

```ts
mode: 'take-over',
```

```
kalup.config.ts:5: E_SETTING_VALUE: 'take-over' is not a value of mode (fix: did you mean 'takeover'? write 'addon' or 'takeover') (docs: errors/E_SETTING_VALUE.md)
```
