# W_LARGE_SCOPE

A warning from `init`: the first pull wrote more than 200 properties for one object. Exit stays 0.

## When

`init` writes `{}` for each object, so every custom property is in the pull scope.

## Fix

If the app needs only some of them, set `custom: false` for that object and list the ones it needs under `include`. Properties already in the file stay; pull never removes a property.

## Example

```ts
objects: {
  companies: { custom: false, include: ['plot_count', 'soil_type'] },
},
```

```
W_LARGE_SCOPE: the first pull wrote 312 properties for companies: every custom property is in the pull scope (fix: set objects.companies.custom to false and list the properties the app needs under objects.companies.include) (docs: errors/W_LARGE_SCOPE.md)
```
