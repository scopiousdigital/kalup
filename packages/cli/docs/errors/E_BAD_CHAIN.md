# E_BAD_CHAIN

A builder call is followed by a chain call Kalup does not accept. Exit 3.

## When

After `p.<kind>(...)` only `.required()`, `.readonly()` and `.managed(false)` are allowed, each once. `.optional()`, `.managed(true)`, `.required` without parentheses or `.required()` twice are errors.

## Fix

Use one of the three calls, once each. A property is nullable unless it has `.required()`, so there is no `.optional()`.

## Example

```ts
plotCount: p.number('plot_count').optional(),
```

```
kalup/objects/companies.ts:5: E_BAD_CHAIN: .optional() is not a chain call (fix: use .required(), .readonly() or .managed(false)) (docs: errors/E_BAD_CHAIN.md)
```
